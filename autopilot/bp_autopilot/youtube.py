"""Find the Kill Tony premiere and stream its audio (yt-dlp + ffmpeg), gently (rate-limit aware)."""
import json, logging, os, re, subprocess, threading, time, queue, random
import numpy as np

log = logging.getLogger("bp.yt")
YTDLP = "/workspace/ktvenv/bin/yt-dlp"
CHANNEL = "https://www.youtube.com/@KillTony"
BASE_ARGS = ["--js-runtimes", "node", "--no-warnings", "--socket-timeout", "20"]
# Optional: a Netscape cookies.txt exported from a (throwaway) YouTube login, used only if present.
COOKIES = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "cookies.txt")
# audio client variants, rotated on every (re)connect: if YouTube bot-checks one, the next may still work
AUDIO_VARIANTS = [
    ("default", ["--js-runtimes", "node"]),
    ("no-js", []),
    ("web_safari", ["--js-runtimes", "node", "--extractor-args", "youtube:player_client=web_safari"]),
    ("tv", ["--js-runtimes", "node", "--extractor-args", "youtube:player_client=tv"]),
    ("mweb", ["--js-runtimes", "node", "--extractor-args", "youtube:player_client=mweb"]),
]

def _cookie_args():
    return ["--cookies", COOKIES] if os.path.exists(COOKIES) else []
TITLE_RE = re.compile(r"^\s*(?:KT|KILL TONY)\s*#\s*\d+", re.I)

class RateLimited(Exception):
    pass

def _run(args, timeout=90):
    p = subprocess.run([YTDLP] + BASE_ARGS + _cookie_args() + args, capture_output=True, text=True, timeout=timeout)
    err = p.stderr or ""
    if "429" in err or "Too Many Requests" in err:
        raise RateLimited(err[-200:])
    if "confirm you" in err and "bot" in err:
        log.warning("youtube bot check: %s", err.strip().splitlines()[-1][:200])
    return p

def metadata(video_id):
    """Full metadata without formats (works even when formats need tokens)."""
    for client in ("default", "web_safari"):
        args = ["-J", "--skip-download", "--ignore-no-formats-error"]
        if client != "default":
            args += ["--extractor-args", f"youtube:player_client={client}"]
        p = _run(args + [f"https://www.youtube.com/watch?v={video_id}"])
        if p.returncode == 0 and p.stdout.strip():
            try:
                return json.loads(p.stdout)
            except json.JSONDecodeError:
                pass
    return None

def channel_entries(n_videos=4, n_streams=2):
    """Flat listing of the newest uploads/streams (channel browse API; keeps working when watch pages are bot-checked)."""
    out = []
    for tab, n in (("videos", n_videos), ("streams", n_streams)):
        p = _run(["--flat-playlist", "-J", "--playlist-end", str(n), f"{CHANNEL}/{tab}"])
        if p.returncode != 0 or not p.stdout.strip():
            continue
        try:
            out += [e for e in json.loads(p.stdout).get("entries") or [] if e.get("id")]
        except json.JSONDecodeError:
            pass
    return out

def flat_status(video_id):
    """live_status of a video from the channel listing (None if not listed / unknown)."""
    for e in channel_entries():
        if e["id"] == video_id:
            return e.get("live_status")
    return None

def find_premiere(seen_ids=()):
    """Return metadata of an upcoming or live 'KT #...' video, or None."""
    cands = [e for e in channel_entries() if TITLE_RE.match(e.get("title") or "")]
    # upcoming/live first; otherwise check only titles we have not checked yet
    cands.sort(key=lambda e: 0 if e.get("live_status") in ("is_upcoming", "is_live") else 1)
    for e in cands[:3]:
        if e.get("live_status") not in ("is_upcoming", "is_live") and e["id"] in seen_ids:
            continue
        m = metadata(e["id"])
        if (m is None or m.get("live_status") is None) and e.get("live_status") in ("is_upcoming", "is_live"):
            # watch page blocked: fall back to what the channel listing says
            log.warning("metadata unavailable for %s; using channel listing", e["id"])
            return {"id": e["id"], "title": e.get("title"), "live_status": e.get("live_status"),
                    "release_timestamp": e.get("release_timestamp"), "description": e.get("description") or ""}
        if m is None:
            continue
        if m.get("live_status") in ("is_upcoming", "is_live"):
            return m
        seen_ids.add(e["id"]) if isinstance(seen_ids, set) else None
    return None

def parse_episode(meta):
    title = (meta.get("title") or "").strip()
    guests = []
    if " - " in title:
        tail = title.split(" - ", 1)[1]
        guests = [g.strip() for g in re.split(r"\s*(?:\+|&|,|\band\b)\s*", tail) if g.strip()]
    first = (meta.get("description") or "").split("\n", 1)[0]
    roster = [n.strip() for n in first.split(" - RECORDED")[0].split(",") if 1 < len(n.strip()) <= 40]
    return title, guests, roster

class AudioStream:
    """yt-dlp -> ffmpeg -> 16 kHz mono float32 blocks, read in a thread. Each block carries the wall time it arrived."""
    def __init__(self, video_id, block_s=0.5, attempt=0):
        self.video_id = video_id; self.block = int(16000 * block_s) * 2
        self.q = queue.Queue(maxsize=4000); self.procs = []; self.alive = False
        self.variant, self.vargs = AUDIO_VARIANTS[attempt % len(AUDIO_VARIANTS)]
        self.last_err = ""; self.got_audio = False

    @property
    def bot_blocked(self):
        return "not a bot" in self.last_err or "google.com/sorry" in self.last_err

    def start(self):
        url = f"https://www.youtube.com/watch?v={self.video_id}"
        log.info("audio: connecting with client %s%s", self.variant, " + cookies" if _cookie_args() else "")
        y = subprocess.Popen([YTDLP, "--no-warnings", "--socket-timeout", "20"] + self.vargs + _cookie_args() +
                             ["-f", "bestaudio/best", "-o", "-", "--quiet", url],
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        f = subprocess.Popen(["ffmpeg", "-loglevel", "error", "-i", "pipe:0", "-ac", "1", "-ar", "16000", "-f", "s16le", "pipe:1"],
                             stdin=y.stdout, stdout=subprocess.PIPE)
        y.stdout.close()
        self.procs = [y, f]; self.alive = True
        threading.Thread(target=self._reader, args=(f.stdout,), daemon=True).start()
        threading.Thread(target=self._errlog, args=(y.stderr,), daemon=True).start()

    def _errlog(self, pipe):
        for line in iter(pipe.readline, b""):
            t = line.decode(errors="ignore").strip()
            if t:
                self.last_err = t[:300]
                log.warning("yt-dlp: %s", t[:200])

    def _reader(self, pipe):
        while True:
            b = pipe.read(self.block)
            if not b:
                break
            a = np.frombuffer(b, dtype=np.int16).astype(np.float32) / 32768.0
            self.got_audio = True
            try:
                self.q.put((time.time(), a), timeout=5)
            except queue.Full:
                log.error("audio queue full; dropping")
        self.alive = False

    def get(self, timeout=1.0):
        try:
            return self.q.get(timeout=timeout)
        except queue.Empty:
            return None

    def stop(self):
        for p in self.procs:
            try:
                p.kill()
            except Exception:
                pass
        self.alive = False

# ---- light, usually-unblocked YouTube lookups (podcast-first mode) ----------------------------------
CHANNEL_ID = "UCwzCMiicL-hBUzyjWiJaseg"

def rss_find(ep_num=None, since_ts=0):
    """Newest 'KT #<n>' entry in the channel's public RSS feed -> {'id','title','published_ts'} or None."""
    import requests, email.utils, xml.etree.ElementTree as ET, datetime as _dt
    try:
        for i in range(4):          # this feed answers a random 404 now and then
            r = requests.get(f"https://www.youtube.com/feeds/videos.xml?channel_id={CHANNEL_ID}", timeout=20)
            if r.status_code == 200: break
            time.sleep(2 + 2 * i)
        if r.status_code != 200:
            log.warning("youtube rss %s", r.status_code); return None
        ns = {"a": "http://www.w3.org/2005/Atom", "yt": "http://www.youtube.com/xml/schemas/2015"}
        for e in ET.fromstring(r.content).findall("a:entry", ns):
            title = e.findtext("a:title", "", ns); vid = e.findtext("yt:videoId", "", ns)
            pub = _dt.datetime.fromisoformat(e.findtext("a:published", "", ns)).timestamp()
            m = re.match(r"^\s*(?:KT|KILL TONY)\s*#\s*(\d+)", title, re.I)
            if not m or "behind the tape" in title.lower():
                continue
            if (ep_num and m.group(1) == str(ep_num)) or (not ep_num and pub >= since_ts):
                return {"id": vid, "title": title, "published_ts": pub}
    except Exception as ex:
        log.warning("youtube rss error: %s", ex)
    return None

def captions_json3(video_id, workdir="/tmp"):
    """English auto-captions (json3) via yt-dlp, or None (not generated yet / blocked)."""
    import glob, tempfile
    d = tempfile.mkdtemp(dir=workdir, prefix="cap-")
    try:
        _run(["--skip-download", "--write-auto-subs", "--sub-langs", "en.*,en", "--sub-format", "json3",
              "-o", os.path.join(d, "c"), f"https://www.youtube.com/watch?v={video_id}"], timeout=120)
        fs = sorted(glob.glob(os.path.join(d, "*.json3")), key=lambda f: ("orig" in f, f))
        for f in fs:
            txt = open(f).read()
            if len(txt) > 5000:
                return txt
    except RateLimited:
        log.warning("captions: rate limited")
    except Exception as ex:
        log.warning("captions error: %s", ex)
    finally:
        subprocess.run(["rm", "-rf", d])
    return None
