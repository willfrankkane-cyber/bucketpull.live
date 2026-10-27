#!/usr/bin/env python3
"""Bucket Pull Live: build past episodes that fans asked for (pasted link or episode number).

Runs from cron every 10 minutes (run.sh archive). For each pending request in episode_requests:
  1. resolve the episode number (YouTube oEmbed title "KILL TONY #NNN ..." for a pasted link, or the number itself)
  2. reject anything before #791 (the room started with #791) or that isn't a Kill Tony episode
  3. find the podcast item for #NNN, download + decode + transcribe it (faster-whisper small.en, ~30 min per episode)
  4. build the lineup offline (bp_autopilot.lineup), map podcast time to video time (intro anchor)
  5. create an ENDED episode with comics, timestamps and golden ticket (host_archive_episode); voting is open on it
Never runs during the Monday premiere window or while the live autopilot holds autopilot.lock, and never runs two
whisper models at once. Episodes still inside the live window (published < 12 h ago) are left to the live autopilot.
"""
import datetime as dt, fcntl, json, logging, os, re, sys, time
import requests

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from autopilot import SUPABASE_URL, SUPABASE_KEY, SECRET_FILE, setup_logging       # noqa: E402
from bp_autopilot.supa import Supa                                                   # noqa: E402
from bp_autopilot import podcast as pod, youtube as yt, lineup                       # noqa: E402
from bp_autopilot.sync import SyncMap                                                # noqa: E402

log = logging.getLogger("bp")
MIN_EP = 791
SR = 16000
CACHE = os.path.join(HERE, "cache")
WORDS_DIR = os.path.join(HERE, "logs")

def premiere_window(now=None):
    """Box clock = America/El_Salvador (UTC-6, no DST). Live autopilot runs Monday 18:40 for up to 5 h.
    Stay off the CPU Mon 15:00 - Tue 03:00 so a 30-45 min transcription never overlaps the premiere."""
    n = now or dt.datetime.now()
    return (n.weekday() == 0 and n.hour >= 15) or (n.weekday() == 1 and n.hour < 3)

def live_locked():
    try:
        f = open(os.path.join(HERE, "autopilot.lock"), "a")
        fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
        fcntl.flock(f, fcntl.LOCK_UN); f.close()
        return False
    except OSError:
        return True

class Abort(Exception):
    pass

def oembed(video_id):
    r = requests.get("https://www.youtube.com/oembed", params={"url": f"https://www.youtube.com/watch?v={video_id}", "format": "json"}, timeout=20)
    if r.status_code in (400, 401, 403, 404):
        return None
    r.raise_for_status()
    return r.json()

def ep_num_from_title(title):
    m = re.search(r"#\s*(\d{2,5})\b", title or "")
    return int(m.group(1)) if m else None

def transcribe(wav, words_path):
    """Whole-file transcription with the same rolling windows as the live room. Caches words as jsonl."""
    if os.path.exists(words_path) and os.path.getsize(words_path) > 10000:
        return [json.loads(l) for l in open(words_path)]
    import soundfile as sf
    from bp_autopilot.transcriber import RollingTranscriber
    stt = RollingTranscriber(model="small.en", threads=6)
    f = sf.SoundFile(wav); t = 0.0; out = []; tmp = words_path + ".part"; t_wall = time.time()
    with open(tmp, "w") as fo:
        while True:
            x = f.read(int(7 * SR), dtype="float32")
            if len(x) == 0:
                ws = stt.flush()
            else:
                ws = stt.feed(x, t); t += len(x) / SR
            for w in ws:
                j = w.to_json(); out.append(j); fo.write(json.dumps(j) + "\n")
            if len(x) == 0:
                break
            if int(t) % 600 < 7:
                if live_locked():
                    raise Abort("live autopilot started")
                log.info("transcribed %d min", t // 60)
    os.replace(tmp, words_path)
    log.info("transcribed %.0f min of audio in %.0fs", t / 60, time.time() - t_wall)
    return out

def process(supa, feed, req):
    rid = req["id"]; vid = req.get("video_id"); num = req.get("ep_num"); title_yt = None
    if vid:
        meta = oembed(vid)
        if not meta:
            return "rejected", "That video could not be found on YouTube", None, num, vid
        author = (meta.get("author_name") or "").upper(); title_yt = meta.get("title") or ""
        if "KILL TONY" not in author:
            return "rejected", "That link isn't a Kill Tony episode", None, num, vid
        n2 = ep_num_from_title(title_yt)
        if not n2 or "behind the tape" in title_yt.lower():
            return "rejected", "That video isn't a numbered Kill Tony episode", None, num, vid
        num = n2
    if not num:
        return "rejected", "No episode number", None, num, vid
    if num < MIN_EP:
        return "rejected", f"too_old: Bucket Pull Live starts with #{MIN_EP}", None, num, vid
    have = supa.rpc("live_poll", host=False, p_known_ep=None, p_meta=-1, p_client=None, p_want=str(num)) or {}
    if have.get("want") == "ok":
        return "done", None, have.get("ep"), num, vid
    feed.poll()
    item = next((i for i in feed.items if pod.is_main(i) and re.search(rf"#\s*{num}\b", i["title"])), None)
    if not item or not item.get("url"):
        age = (time.time() - dt.datetime.fromisoformat(req["created_at"].replace("Z", "+00:00")).timestamp()) / 3600
        if age > 24 * 14:
            return "rejected", f"#{num} never showed up in the podcast feed", None, num, vid
        return "pending", f"waiting: #{num} is not out yet", None, num, vid
    if time.time() - item["pub_ts"] < 12 * 3600:
        return "pending", f"waiting: #{num} just aired, the live room covers it", None, num, vid
    title, guests, roster, _ = pod.parse_item(item)
    if not vid:
        r = yt.rss_find(num)
        vid = r["id"] if r else None
    supa.rpc("host_update_request", p_id=rid, p_status="processing", p_reason="transcribing", p_num=num, p_video=vid)
    os.makedirs(CACHE, exist_ok=True)
    base = os.path.join(CACHE, f"kt{num}")
    if not os.path.exists(base + ".wav"):
        pod.download(item["url"], base + ".mp3"); pod.decode(base + ".mp3", base + ".wav")
    words_path = os.path.join(WORDS_DIR, f"words-archive-{num}.jsonl")
    words = transcribe(base + ".wav", words_path)
    res = lineup.build(words, roster=roster, guests=guests)
    sm = SyncMap(); sm.try_anchor([(w["t"], w["w"]) for w in words])
    comics = [{"name": c["name"], "kind": c["kind"], "offset": round(max(0.0, sm.map(c["t"])), 1), "conf": c["conf"], "heard": c.get("heard")}
              for c in res["comics"]]
    gt = res.get("golden_ticket")
    gt = {"name": gt["name"], "offset": round(max(0.0, sm.map(gt["t"])), 1)} if gt else None
    panel = [{"name": "Tony Hinchcliffe", "role": "Host"}, {"name": "Redban", "role": "Co-host"}] + [{"name": g, "role": "Guest"} for g in guests]
    starts = dt.datetime.fromtimestamp(item["pub_ts"], dt.timezone.utc).isoformat()
    ep = supa.rpc("host_archive_episode", p_num=num, p_title=(title or title_yt or f"#{num}")[:120], p_video=vid,
                  p_starts_at=starts, p_panel=panel, p_comics=comics, p_gt=gt)
    log.info("archived #%s as %s: %d comics, golden ticket %s, sync %s %+.1fs", num, ep, len(comics), gt and gt["name"], sm.method, sm.delta)
    for p in (base + ".mp3",):
        try: os.remove(p)
        except OSError: pass
    return "done", None, ep, num, vid

def main():
    if premiere_window() or live_locked():
        return
    lk = open(os.path.join(HERE, "archive.lock"), "w")
    try:
        fcntl.flock(lk, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        return
    supa = Supa(SUPABASE_URL, SUPABASE_KEY, SECRET_FILE)
    reqs = supa.rpc("host_pending_requests") or []
    if not reqs:
        return
    setup_logging("archive")
    feed = pod.Feed()
    for req in reqs:
        if premiere_window() or live_locked():
            log.info("premiere window / live autopilot: stopping"); break
        if req.get("attempts", 0) >= 3 and req["status"] == "processing":
            supa.rpc("host_update_request", p_id=req["id"], p_status="rejected", p_reason="Could not build this episode (tried 3 times)")
            continue
        try:
            st, why, ep, num, vid = process(supa, feed, req)
        except Abort as ex:
            log.warning("aborted: %s", ex)
            supa.rpc("host_update_request", p_id=req["id"], p_status="pending", p_reason="paused for the live premiere"); break
        except Exception as ex:
            log.exception("request %s failed: %s", req["id"], ex)
            supa.rpc("host_update_request", p_id=req["id"], p_status="pending", p_reason=f"retrying: {str(ex)[:80]}")
            continue
        log.info("request %s -> %s %s (ep #%s %s)", req["id"], st, why or "", num, ep or "")
        supa.rpc("host_update_request", p_id=req["id"], p_status=st, p_reason=why, p_episode=ep, p_num=num, p_video=vid)

if __name__ == "__main__":
    main()
