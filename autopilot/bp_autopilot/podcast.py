"""Kill Tony audio podcast (Simplecast RSS): find the new main episode, download it, decode it.

The podcast is published at the same moment as the YouTube premiere (Mon 19:00 CST / Tue 01:00 UTC)
and is not behind YouTube's bot checks, so it is the autopilot's primary source.
"""
import email.utils, html, json, logging, os, re, subprocess, time
import xml.etree.ElementTree as ET
import requests
from .names import title_case

log = logging.getLogger("bp.pod")
FEED = "https://feeds.simplecast.com/JZSQrle9"
UA = "BucketPullAutopilot/1.0 (+https://bucketpull.live)"
MAIN_RE = re.compile(r"^\s*(?:KT\s*)?#\s*(\d+)\s*[-–—:]\s*(.+)$", re.I)
NS = {"itunes": "http://www.itunes.com/dtds/podcast-1.0.dtd"}

class Feed:
    """Conditional-GET poller (ETag / Last-Modified) so polling every 30-60 s stays light."""
    def __init__(self, url=FEED, state_file=None):
        self.url, self.state_file = url, state_file
        self.etag = self.last_mod = None; self.items = []
        self.s = requests.Session(); self.s.headers["User-Agent"] = UA

    def poll(self):
        h = {}
        if self.etag: h["If-None-Match"] = self.etag
        if self.last_mod: h["If-Modified-Since"] = self.last_mod
        r = self.s.get(self.url, headers=h, timeout=30)
        if r.status_code == 304:
            return False
        r.raise_for_status()
        self.etag, self.last_mod = r.headers.get("ETag"), r.headers.get("Last-Modified")
        self.items = parse_feed(r.content)
        return True

def _text(el, path, ns=None):
    x = el.find(path, ns or {})
    return (x.text or "").strip() if x is not None and x.text else ""

def parse_feed(xml_bytes):
    root = ET.fromstring(xml_bytes); out = []
    for it in root.find("channel").findall("item"):
        enc = it.find("enclosure")
        try:
            pub = email.utils.parsedate_to_datetime(_text(it, "pubDate")).timestamp()
        except Exception:
            pub = 0
        out.append({"guid": _text(it, "guid"), "title": _text(it, "title"), "pub_ts": pub,
                    "url": enc.get("url") if enc is not None else None,
                    "length": int(enc.get("length") or 0) if enc is not None else 0,
                    "duration": _text(it, "itunes:duration", NS), "description": _text(it, "description")})
    return out

def is_main(item):
    t = item["title"]
    return bool(MAIN_RE.match(t)) and "behind the tape" not in t.lower()

def newest_main(items, since_ts):
    for it in sorted(items, key=lambda i: -i["pub_ts"]):
        if is_main(it) and it["pub_ts"] >= since_ts and it["url"]:
            return it
    return None

def parse_item(item):
    """'#790 - YUNG GRAVY + ERIK GRIFFIN' -> (title, ['Yung Gravy', 'Erik Griffin'], roster, number)."""
    m = MAIN_RE.match(item["title"])
    num, tail = (m.group(1), m.group(2)) if m else (None, "")
    guests = [title_case(g.strip()) for g in re.split(r"\s*(?:\+|&|,|\band\b)\s*", tail, flags=re.I) if g.strip()]
    text = re.sub(r"<[^>]+>", "\n", html.unescape(item.get("description") or ""))
    first = next((ln.strip() for ln in text.splitlines() if "RECORDED" in ln.upper() or ln.count(",") >= 3), "")
    first = re.split(r"\s*-\s*RECORDED", first, flags=re.I)[0]
    roster = [n.strip() for n in first.split(",") if 1 < len(n.strip()) <= 40]
    title = f"KT #{num} - {' + '.join(g.upper() for g in guests)}" if num else item["title"]
    return item["title"].strip() or title, guests, roster, num

def duration_s(item):
    p = [int(x) for x in re.findall(r"\d+", item.get("duration") or "")]
    s = 0
    for x in p: s = s * 60 + x
    return s

def download(url, dest, tries=6):
    """Stream the MP3 to disk (resumes with Range on errors). ~130 MB takes a few seconds from the box."""
    s = requests.Session(); s.headers["User-Agent"] = UA
    got = os.path.getsize(dest) if os.path.exists(dest) else 0; total = None
    for i in range(tries):
        try:
            h = {"Range": f"bytes={got}-"} if got else {}
            with s.get(url, headers=h, stream=True, timeout=30, allow_redirects=True) as r:
                if r.status_code == 200 and got:
                    got = 0                     # server ignored Range: start over
                r.raise_for_status()
                cr = r.headers.get("Content-Range")
                total = int(cr.split("/")[-1]) if cr and "/" in cr else (int(r.headers.get("Content-Length", 0)) + got or None)
                with open(dest, "ab" if got else "wb") as f:
                    for chunk in r.iter_content(1 << 20):
                        f.write(chunk); got += len(chunk)
            if total is None or got >= total:
                return dest
        except Exception as ex:
            log.warning("download error (%s bytes so far): %s", got, ex)
        time.sleep(min(30, 2 ** i))
    raise RuntimeError(f"download failed after {tries} tries ({got} bytes)")

def decode(mp3, wav):
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", mp3, "-ac", "1", "-ar", "16000", wav], check=True)
    return wav
