#!/workspace/ktvenv/bin/python
"""Bucket Pull Live autopilot.

  autopilot.py live                 Monday job: find the premiere, create the episode, follow the stream, end it.
  autopilot.py replay WAV [--speed N] [--title T] [--video ID]
                                    Feed a recorded episode through the same pipeline into a NEW test episode.
  autopilot.py keepalive            Tiny read so the free Supabase project never looks inactive.

Logs: logs/YYYY-MM-DD.log. Host secret: /workspace/bucketpull-host-secret.txt (never logged).
"""
import argparse, datetime as dt, fcntl, json, logging, os, random, re, sys, time
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from bp_autopilot.supa import Supa
from bp_autopilot.detector import Detector
from bp_autopilot.loudness import CrowdMeter
from bp_autopilot.names import title_case
from bp_autopilot import youtube as yt
from bp_autopilot import podcast as pod
from bp_autopilot.sync import SyncMap, caption_words
from bp_autopilot.regulars import KNOWN as KNOWN_REGULARS, likely_from_roster

SUPABASE_URL = "https://zwdogpkjxhpsrocqdnel.supabase.co"
SUPABASE_KEY = "sb_publishable_3QWxRZ_v4fKh1w6dcCxkOQ_se7UJV4I"
SECRET_FILE = "/workspace/bucketpull-host-secret.txt"
SR = 16000
log = logging.getLogger("bp")

def setup_logging(tag):
    os.makedirs(os.path.join(HERE, "logs"), exist_ok=True)
    fn = os.path.join(HERE, "logs", f"{dt.date.today():%Y-%m-%d}-{tag}.log")
    fmt = logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s")
    root = logging.getLogger(); root.setLevel(logging.INFO)
    for h in (logging.FileHandler(fn), logging.StreamHandler(sys.stdout)):
        h.setFormatter(fmt); root.addHandler(h)
    for noisy in ("faster_whisper", "httpx", "urllib3", "huggingface_hub"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
    return fn

def hms(s):
    s = int(max(0, s)); return f"{s//3600}:{s%3600//60:02d}:{s%60:02d}"

class Pilot:
    """Shared core: audio -> STT -> detector -> Supabase. Used by live and replay."""
    def __init__(self, supa, episode, roster, panel, model="small.en", hb_every=15.0, mode="live", info=None):
        from bp_autopilot.transcriber import RollingTranscriber
        self.supa, self.ep, self.mode = supa, episode, mode
        self.roster, self.panel = roster, panel
        self.crowd = CrowdMeter()
        self.det = Detector(roster=roster, panel=panel, crowd=self.crowd, regulars=KNOWN_REGULARS,
                            likely_regulars=likely_from_roster(roster or [], panel or []))
        self.stt = RollingTranscriber(model=model, threads=6, prompt=self._prompt([]))
        self.hb_every, self.last_hb = hb_every, 0.0
        self.offset = 0.0; self.state = "listening"; self.last_event = None; self.events = []
        self.recent = []          # last words for the dashboard
        self.info = info or {}
        self.local_ids = {}
        self.words_log = open(os.path.join(HERE, "logs", time.strftime("words-%Y-%m-%d-") + mode + f"-{str(episode)[:8]}.jsonl"), "a") \
            if mode in ("replay", "live", "podcast") else None

    def _prompt(self, comics):
        names = ", ".join(list(dict.fromkeys(self.panel + self.roster + comics))[:30])
        return f"Kill Tony with Tony Hinchcliffe and Brian Redban. {names}. Back to the bucket we go, ladies and gentlemen. Next bucket pull. Golden ticket. Joke book."

    def feed(self, samples, offset):
        self.offset = offset + len(samples) / SR
        self.crowd.feed(samples, offset)
        words = self.stt.feed(samples, offset)
        if words:
            self.recent = (self.recent + [w.text.strip() for w in words])[-40:]
            if self.words_log:
                self.words_log.write("".join(json.dumps(w.to_json()) + "\n" for w in words)); self.words_log.flush()
        evs = self.det.feed(words) + self.det.tick(self.offset - self.stt.W)
        for e in evs:
            self.handle(e)
        self.heartbeat()

    def flush(self):
        words = self.stt.flush()
        for e in self.det.feed(words) + self.det.tick(self.offset + 60):
            self.handle(e)

    def handle(self, e):
        t = round(float(e["t"]), 1)
        try:
            if e["kind"] == "comic":
                match = e.get("match")
                match = self.local_ids.get(match, match)
                cid = match if match and not str(match).startswith("local:") else None
                r = self.supa.rpc("auto_comic", p_episode=self.ep, p_name=e["name"], p_heard=e["heard"], p_offset=t,
                                  p_conf=e["conf"], p_comic=cid, p_kind=e.get("role") or "bucket")
                if r and r.get("ok") and r.get("comic"):
                    lk = "local:" + e["name"]
                    self.local_ids[lk] = r["comic"]
                    for c in self.det.comics:
                        if c["key"] == lk: c["key"] = r["comic"]
                    if self.det.current == lk: self.det.current = r["comic"]
                    self.stt.set_prompt(self._prompt([c["name"] for c in self.det.comics][-8:]))
                msg = f"{hms(t)} {e.get('role') or 'bucket'} {e['name']} ({e['conf']:.2f}, heard '{e['heard']}', {e.get('why')}) -> {r}"
                log.info("role %s for %s: %s", e.get("role"), e["name"], e.get("role_why"))
            elif e["kind"] == "set_end":
                r = self.supa.rpc("auto_set_betting", p_episode=self.ep, p_open=False, p_offset=t, p_reason=f"opener done ({e['why']})")
                msg = f"{hms(t)} opener done ({e['why']}): close betting -> {r}"
            elif e["kind"] == "golden_ticket":
                r = self.supa.rpc("auto_golden_ticket", p_episode=self.ep, p_offset=t, p_conf=e["conf"], p_name=None,
                                  p_evidence={k: (float(v) if isinstance(v, (np.floating, np.integer)) else v) for k, v in e["evidence"].items()})
                msg = f"{hms(t)} GOLDEN TICKET ({e['conf']:.2f}, {e['evidence']}) -> {r}"
            else:
                return
        except Exception as ex:
            msg = f"{hms(t)} {e['kind']} FAILED: {ex}"
        log.info("EVENT %s", msg)
        self.last_event = msg[:200]
        self.events.append({"t": t, **{k: (v if not isinstance(v, (np.floating,)) else float(v)) for k, v in e.items() if k != "t"}, "result": msg})
        self.heartbeat(force=True)

    def heartbeat(self, force=False, state=None):
        if state: self.state = state
        now = time.time()
        if not force and now - self.last_hb < self.hb_every:
            return
        self.last_hb = now
        try:
            info = dict(self.info, lag=round(self.stt.lag, 2), mode=self.mode)
            r = self.supa.rpc("auto_heartbeat", tries=2, p_episode=self.ep, p_state=self.state, p_offset=round(self.offset, 1),
                              p_text=" ".join(self.recent[-30:]), p_conf=self.det.last_conf, p_event=self.last_event, p_info=info)
            if r:
                db_cur = r.get("current_comic_id")
                if db_cur != self.det.current and db_cur not in (None,) and not str(self.det.current or "").startswith("local:"):
                    self.det.current_t = self.offset      # host staged someone: treat as on stage from now
                self.det.sync(r.get("comics") or [], db_cur if db_cur else self.det.current, r.get("blocked") or [],
                              gt_done=bool(r.get("golden_ticket_at")) or not r.get("auto_gt", True) or not r.get("auto_enabled", True))
                if db_cur is None and self.det.current and not str(self.det.current).startswith("local:"):
                    self.det.current = None
                for c in self.det.comics:
                    if c["key"] == self.det.current and c["t"] is None:
                        c["t"] = self.det.current_t
                if self.det.first_comic_t is None and r.get("comics"):
                    self.det.first_comic_t = self.offset
        except Exception as ex:
            log.warning("heartbeat failed: %s", ex)

# ---------------------------------------------------------------------------------------------
class PodPilot(Pilot):
    """Podcast mode: the detector runs on the whole file far ahead of the premiere; events are queued and only
    released (written to the DB) when the premiere's video time reaches them, so nothing leaks early."""
    def __init__(self, *args, clock=time.time, video_t0=0.0, **kw):
        super().__init__(*args, **kw)
        self.clock, self.video_t0 = clock, video_t0
        self.sync = SyncMap(); self.adjust = 0.0
        self.words = []            # (pod_t, text)
        self.queue = []            # detector events, podcast time
        self.pod_t = 0.0; self.done = False; self.released_to = None
        self.extra = {}
        self.last_event = "podcast run started"

    def due(self, e):
        return round(self.sync.map(e["t"]) + self.adjust, 1)

    def video_now(self):
        return self.clock() - self.video_t0

    def enqueue(self, evs):
        for e in evs:
            k = len(self.queue)
            while k and self.queue[k - 1]["t"] > e["t"]: k -= 1
            self.queue.insert(k, e)
            log.info("queued %s at podcast %s (video ~%s)%s", e["kind"], hms(e["t"]), hms(self.due(e)),
                     f" {e.get('name')}" if e.get("name") else "")

    def release(self, lead=5.0):
        # events are written ~5 s (premiere clock) before they are due: fans' browsers poll every ~5 s and hold
        # each auto event until their own player (or, with no player, created_at + 5 s) reaches it
        vt = self.video_now()
        while self.queue and self.due(self.queue[0]) <= vt + lead:
            e = self.queue.pop(0); d = self.due(e)
            if e["kind"] == "end":
                r = self.supa.rpc("auto_end_episode", p_episode=self.ep, p_offset=d)
                msg = f"{hms(d)} episode end -> {r}"; log.info("EVENT %s", msg); self.last_event = msg
                self.events.append({"t": d, "kind": "end", "result": msg})
            else:
                self.handle(dict(e, t=d, pod_t=e["t"]))
            self.released_to = d

    def heartbeat(self, force=False, state=None):
        if state: self.state = state
        now = time.time()
        if not force and now - self.last_hb < self.hb_every:
            return
        self.last_hb = now
        vt = self.video_now()
        near = [w for t, w in self.words if self.sync.map(t) + self.adjust <= vt][-30:]
        info = dict(self.info, source="podcast", sync=dict(self.sync.to_info(), adjust=self.adjust),
                    transcribed_to=round(self.sync.map(self.pod_t) + self.adjust, 1), queued=len(self.queue),
                    next_in=round(self.due(self.queue[0]) - vt, 1) if self.queue else None,
                    lag=round(self.stt.lag, 2), **self.extra)
        try:
            r = self.supa.rpc("auto_heartbeat", tries=2, p_episode=self.ep, p_state=self.state, p_offset=round(vt, 1),
                              p_text=" ".join(x.strip() for x in near), p_conf=self.det.last_conf, p_event=self.last_event, p_info=info)
            if r:
                adj = float(r.get("sync_adjust") or 0)
                if abs(adj - self.adjust) > 0.05:
                    log.info("host sync adjust %+.1fs -> %+.1fs", self.adjust, adj); self.adjust = adj
                if r.get("starts_at") and self.clock is time.time:
                    t0 = dt.datetime.fromisoformat(r["starts_at"].replace("Z", "+00:00")).timestamp()
                    if abs(t0 - self.video_t0) > 1.0:
                        log.info("host moved the premiere start: %+.0fs", t0 - self.video_t0); self.video_t0 = t0
                if r.get("youtube_url") and not self.extra.get("video"):
                    self.extra["video"] = r["youtube_url"]
                if r.get("blocked"):
                    self.det.blocked = set(b.lower() for b in r["blocked"])
        except Exception as ex:
            log.warning("heartbeat failed: %s", ex)

def run_podcast(supa, ep, wav, roster, guests, video_t0, vid, clock=time.time, num=None, hard_stop=None, tag="live",
                captions=None, speed=0.0, no_youtube=False):
    """Transcribe the podcast in order, detect, map to video time, release on the premiere clock."""
    import soundfile as sf
    pilot = PodPilot(supa, ep, roster, guests + ["Tony Hinchcliffe", "Brian Redban"], mode="podcast" if tag == "live" else "replay",
                     info={"video": vid, "num": num}, clock=clock, video_t0=video_t0)
    f = sf.SoundFile(wav); total = f.frames / SR; step = 3.5
    cap_txt = captions; last_cap = -1e9; cap_words_at = 0.0; last_vid_try = clock()
    pilot.heartbeat(force=True, state="podcast: transcribing")
    t_wall = time.time()
    while True:
        now = clock()
        if hard_stop and now > hard_stop:
            log.warning("hard stop"); break
        if not pilot.done:
            x = f.read(int(step * SR), dtype="float32")
            if len(x) == 0:
                pilot.done = True
                ws = pilot.stt.flush()
                pilot.words += [(w.t, w.text) for w in ws]
                pilot.enqueue(pilot.det.feed(ws) + pilot.det.tick(1e9))
                pilot.enqueue([{"kind": "end", "t": total}])
                log.info("podcast transcribed: %s of audio in %.0fs", hms(total), time.time() - t_wall)
            else:
                t = pilot.pod_t
                pilot.crowd.feed(x, t)
                ws = pilot.stt.feed(x, t); pilot.pod_t = t + len(x) / SR
                if ws:
                    pilot.words += [(w.t, w.text) for w in ws]
                    if pilot.words_log:
                        pilot.words_log.write("".join(json.dumps(w.to_json()) + "\n" for w in ws))
                pilot.enqueue(pilot.det.feed(ws) + pilot.det.tick(pilot.pod_t - pilot.stt.W))
                if pilot.sync.method == "default" and pilot.pod_t > 60:
                    if pilot.sync.try_anchor(pilot.words):
                        log.info("sync by intro anchor: video = podcast %+.2fs", pilot.sync.delta)
                    elif pilot.pod_t > 420:
                        pilot.sync.info["anchor"] = "not found"
        else:
            time.sleep(0.5 if speed == 0 else 0.05)
        # YouTube captions: exact (piecewise) sync, retried every 5 min; refreshed as the transcript grows
        if vid and not no_youtube and (cap_txt is None) and clock() - last_cap > 300 and pilot.pod_t > 600:
            last_cap = clock(); cap_txt = yt.captions_json3(vid) or None
            log.info("captions %s", "fetched" if cap_txt else "not available yet")
        if cap_txt and pilot.pod_t - cap_words_at > 900 or (cap_txt and pilot.done and cap_words_at < pilot.pod_t):
            cap_words_at = pilot.pod_t
            if pilot.sync.try_captions(pilot.words, caption_words(cap_txt)):
                log.info("sync by captions: %s", pilot.sync.to_info())
        # no YouTube link yet? keep looking (channel RSS) every 5 min
        if not vid and not no_youtube and num and clock() - last_vid_try > 300:
            last_vid_try = clock(); r = yt.rss_find(num)
            if r:
                vid = r["id"]; pilot.info["video"] = vid
                supa.rpc("auto_set_video", p_episode=ep, p_video_id=vid, p_starts_at=None)
                log.info("found the YouTube video later: %s", vid)
        pilot.release()
        ahead = (pilot.sync.map(pilot.pod_t) + pilot.adjust) - pilot.video_now()
        st = ("podcast: done, following premiere" if pilot.done else f"podcast: transcribing, {hms(max(0, ahead))} ahead") \
            if pilot.video_now() >= 0 else f"podcast: ready, premiere in {hms(-pilot.video_now())}"
        pilot.heartbeat(state=st)
        if pilot.done and not pilot.queue:
            break
    pilot.heartbeat(force=True, state="finished: episode ended")
    out = os.path.join(HERE, "logs", f"{tag}-podcast-{int(time.time())}.json")
    json.dump({"episode": ep, "video": vid, "sync": pilot.sync.to_info(), "events": pilot.events,
               "wall_s": round(time.time() - t_wall), "audio_s": round(total)}, open(out, "w"), indent=1, default=str)
    log.info("podcast run done; report %s", out)
    return out

def cmd_podreplay(a):
    """Replay a podcast episode end to end into a NEW test episode with a virtual premiere clock."""
    setup_logging("podreplay")
    if a.no_youtube:
        yt.YTDLP = "/bin/false"          # simulate YouTube being completely unreachable
    supa = Supa(SUPABASE_URL, SUPABASE_KEY, SECRET_FILE)
    feed = pod.Feed(); feed.poll()
    item = next(i for i in feed.items if pod.is_main(i) and re.search(rf"#\s*{a.num}\b", i["title"]))
    title, guests, roster, num = pod.parse_item(item)
    base = os.path.join(HERE, "cache", f"replay{num}")
    os.makedirs(os.path.join(HERE, "cache"), exist_ok=True)
    t = time.time()
    if a.mp3:
        import shutil; shutil.copy(a.mp3, base + ".mp3")
    else:
        pod.download(item["url"], base + ".mp3")
    pod.decode(base + ".mp3", base + ".wav")
    log.info("podcast %r ready in %.0fs (guests %s)", title, time.time() - t, guests)
    vid = None if a.no_youtube else (yt.rss_find(num) or {}).get("id")
    real0 = time.time(); speed = a.speed
    clock = (lambda: real0 + (time.time() - real0) * speed) if speed > 0 else time.time
    video_t0 = real0 + a.lead
    panel = [{"name": "Tony", "role": "Host"}, {"name": "Redban", "role": "Co-host"}] + [{"name": g, "role": "Guest"} for g in guests]
    ep = supa.rpc("host_new_episode", p_title=f"TEST {title}"[:120], p_starts_at=dt.datetime.fromtimestamp(video_t0, dt.timezone.utc).isoformat(),
                  p_youtube_url=f"https://www.youtube.com/watch?v={vid}" if vid else None, p_panel=panel)
    log.info("test episode %s, video %s, clock x%s", ep, vid, speed or 1)
    cap = open(a.captions).read() if a.captions else None
    out = run_podcast(supa, ep, base + ".wav", roster, guests, video_t0, vid, clock=clock, num=num, tag="podreplay",
                      captions=cap, speed=speed, no_youtube=a.no_youtube)
    print(out)

def cmd_replay(a):
    import soundfile as sf
    setup_logging("replay")
    supa = Supa(SUPABASE_URL, SUPABASE_KEY, SECRET_FILE)
    roster = [x.strip() for x in (a.roster or "").split(",") if x.strip()]
    guests = [x.strip() for x in (a.guests or "").split(",") if x.strip()]
    panel = [{"name": "Tony", "role": "Host"}, {"name": "Redban", "role": "Co-host"}] + [{"name": g, "role": "Guest"} for g in guests]
    ep = supa.rpc("host_new_episode", p_title=a.title, p_starts_at=dt.datetime.now(dt.timezone.utc).isoformat(), p_youtube_url=None, p_panel=panel)
    if a.video:
        supa.rpc("auto_set_video", p_episode=ep, p_video_id=a.video, p_starts_at=None)
    log.info("replay into test episode %s (%s) at %sx", ep, a.title, a.speed)
    pilot = Pilot(supa, ep, roster, guests + ["Tony Hinchcliffe", "Brian Redban"], mode="replay", info={"video": a.video, "speed": a.speed})
    f = sf.SoundFile(a.wav); step = 3.5; t = a.start; f.seek(int(a.start * SR)); t0 = time.time()
    while True:
        if a.stop and t >= a.stop: break
        x = f.read(int(step * SR), dtype="float32")
        if len(x) == 0: break
        pilot.feed(x, t); t += len(x) / SR
        if a.speed > 0:
            ahead = (t - a.start) / a.speed - (time.time() - t0)
            if ahead > 0: time.sleep(ahead)
    pilot.flush()
    r = supa.rpc("auto_end_episode", p_episode=ep, p_offset=round(t, 1)) if not a.keep_live else None
    pilot.heartbeat(force=True, state="replay finished")
    out = os.path.join(HERE, "logs", f"replay-{int(time.time())}.json")
    json.dump({"episode": ep, "events": pilot.events, "wall_s": round(time.time() - t0), "audio_s": round(t - a.start)}, open(out, "w"), indent=1, default=str)
    log.info("replay done: %d events, %.0fs audio in %.0fs wall; end -> %s; report %s", len(pilot.events), t - a.start, time.time() - t0, r, out)
    print(out)

# ---------------------------------------------------------------------------------------------
def live_status(vid):
    """is_upcoming / is_live / was_live ... from the watch page, else from the channel listing, else None."""
    m = yt.metadata(vid)
    if m and m.get("live_status"):
        return m["live_status"]
    return yt.flat_status(vid)

COUNTDOWN = 120.0      # YouTube premieres play a 2:00 countdown; video 0:00 = release_timestamp + 120 s (#789, #790 chat replays)
STATE_FILE = os.path.join(HERE, "cache", "processed.json")

def _processed():
    try: return set(json.load(open(STATE_FILE)))
    except Exception: return set()

def _mark_processed(guid):
    os.makedirs(os.path.dirname(STATE_FILE), exist_ok=True)
    s = _processed(); s.add(guid); json.dump(sorted(s), open(STATE_FILE, "w"))

def cmd_live(a):
    logf = setup_logging("live")
    lock = open(os.path.join(HERE, "autopilot.lock"), "w")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        log.error("another autopilot is running; exiting"); return
    supa = Supa(SUPABASE_URL, SUPABASE_KEY, SECRET_FILE)
    started = time.time(); give_up = started + a.find_hours * 3600
    since = started - a.since_hours * 3600
    log.info("autopilot live start (podcast first, YouTube fallback); log %s", logf)
    def hb(st, ep=None, text=None, info=None):
        try:
            return supa.rpc("auto_heartbeat", tries=2, p_episode=ep, p_state=st, p_offset=None, p_text=text, p_conf=None,
                            p_event=None, p_info=dict({"mode": "live", "source": "searching"}, **(info or {})))
        except Exception as ex:
            log.warning("heartbeat: %s", ex)

    # 1) wait for the new main episode in the podcast feed (light conditional GETs) ----------------
    feed = pod.Feed(a.feed); done = _processed(); item = None; yt_meta = None; seen = set()
    last_yt = 0.0; n = 0
    while time.time() < give_up:
        n += 1
        try:
            feed.poll()
            item = pod.newest_main(feed.items, since)
            if item and item["guid"] in done:
                item = None
        except Exception as ex:
            log.warning("podcast feed error: %s", ex)
        if item:
            break
        if time.time() - last_yt > a.poll:      # YouTube side, gently: is the premiere already live without a podcast?
            last_yt = time.time()
            try:
                m = yt.find_premiere(seen)
                if m: yt_meta = m
            except yt.RateLimited:
                log.warning("YouTube rate limited")
            except Exception as ex:
                log.warning("find_premiere: %s", ex)
            if yt_meta and yt_meta.get("live_status") == "is_live" and \
               time.time() > (yt_meta.get("release_timestamp") or 0) + COUNTDOWN + a.podcast_grace:
                log.warning("premiere is live and no podcast after %ds: YouTube fallback", a.podcast_grace)
                hb("no podcast: following YouTube live audio", info={"source": "youtube"})
                return run_youtube(a, supa, hb, yt_meta)
        if n % 10 == 1:
            hb("waiting for the podcast to publish", info={"polls": n})
        time.sleep(a.feed_poll + random.uniform(0, 10))
    if not item:
        log.info("no new episode tonight; exiting"); hb("idle: no new episode tonight"); return

    # 2) podcast path -------------------------------------------------------------------------
    try:
        return run_podcast_live(a, supa, hb, item)
    except Exception as ex:
        log.exception("podcast path failed: %s", ex)
        hb(f"podcast path failed: {str(ex)[:40]}; trying YouTube", info={"source": "youtube"})
    m = None
    for _ in range(20):
        try:
            m = yt.find_premiere(set())
        except Exception as ex:
            log.warning("find_premiere: %s", ex)
        if m: break
        time.sleep(90)
    if m:
        return run_youtube(a, supa, hb, m)
    hb("autopilot stopped: use manual controls", info={"source": "manual"})

def run_podcast_live(a, supa, hb, item):
    title, guests, roster, num = pod.parse_item(item)
    log.info("podcast: %r published %s, guests %s, roster %d", title, dt.datetime.fromtimestamp(item["pub_ts"]).isoformat(), guests, len(roster))
    ytr = None
    for i in range(3):
        ytr = yt.rss_find(num) if num else None
        if ytr: break
        time.sleep(20)
    vid = ytr["id"] if ytr else None
    t0 = (ytr["published_ts"] if ytr else item["pub_ts"] + 6) + COUNTDOWN
    starts = dt.datetime.fromtimestamp(t0, dt.timezone.utc).isoformat()
    panel = [{"name": "Tony", "role": "Host"}, {"name": "Redban", "role": "Co-host"}] + [{"name": g, "role": "Guest"} for g in guests]
    cur = (supa.rpc("live_state", host=False, p_episode=None) or {}).get("episode") or {}
    if cur.get("title") == title and cur.get("status") != "ended":
        ep = cur["id"]; log.info("reusing episode %s", ep)
    else:
        ep = supa.rpc("host_new_episode", p_title=title[:120], p_starts_at=starts,
                      p_youtube_url=f"https://www.youtube.com/watch?v={vid}" if vid else None, p_panel=panel)
        log.info("created episode %s (video %s, video 0:00 at %s); betting open", ep, vid or "unknown", starts)
    if vid:
        supa.rpc("auto_set_video", p_episode=ep, p_video_id=vid, p_starts_at=starts)
    _mark_processed(item["guid"])
    hb("podcast: downloading", ep, info={"source": "podcast"})
    os.makedirs(os.path.join(HERE, "cache"), exist_ok=True)
    base = os.path.join(HERE, "cache", f"kt{num or 'x'}")
    t = time.time(); pod.download(item["url"], base + ".mp3"); pod.decode(base + ".mp3", base + ".wav")
    log.info("podcast downloaded + decoded in %.0fs", time.time() - t)
    run_podcast(supa, ep, base + ".wav", roster, guests, t0, vid, clock=time.time, num=num,
                hard_stop=t0 + pod.duration_s(item) + 1800 if pod.duration_s(item) else t0 + a.max_hours * 3600, tag="live")

def run_youtube(a, supa, hb, meta, hard_stop_cap=None):
    """Fallback: follow the YouTube premiere's live audio (the original pipeline)."""
    vid = meta["id"]; title, guests, roster = yt.parse_episode(meta)
    start_ts = (meta.get("release_timestamp") or meta.get("timestamp") or time.time()) + COUNTDOWN
    start = dt.datetime.fromtimestamp(start_ts, dt.timezone.utc)
    hard_stop = start_ts + a.max_hours * 3600
    if hard_stop_cap: hard_stop = min(hard_stop, hard_stop_cap)
    log.info("YouTube path: premiere %s %r video starts %s, guests %s, roster %d names", vid, title, start.isoformat(), guests, len(roster))

    # 2) create (or reuse) the episode ------------------------------------------------------
    cur = (supa.rpc("live_state", host=False, p_episode=None) or {}).get("episode") or {}
    if cur.get("video_id") == vid and cur.get("status") != "ended":
        ep = cur["id"]; log.info("reusing episode %s", ep)
    else:
        panel = [{"name": "Tony", "role": "Host"}, {"name": "Redban", "role": "Co-host"}] + [{"name": title_case(g), "role": "Guest"} for g in guests]
        ep = supa.rpc("host_new_episode", p_title=title[:120], p_starts_at=start.isoformat(),
                      p_youtube_url=f"https://www.youtube.com/watch?v={vid}", p_panel=panel)
        supa.rpc("auto_set_video", p_episode=ep, p_video_id=vid, p_starts_at=start.isoformat())
        log.info("created episode %s; betting open", ep)

    # 3) wait for it to go live -----------------------------------------------------------
    while time.time() < hard_stop:
        if time.time() < start_ts - 240:
            hb(f"premiere scheduled {start.astimezone():%H:%M}", ep); time.sleep(min(120, start_ts - 240 - time.time() + 1)); continue
        try:
            status = live_status(vid)
        except yt.RateLimited:
            time.sleep(120); continue
        if status == "is_live":
            break
        if status in ("was_live", "post_live", "not_live") and time.time() > start_ts + 600:
            log.warning("premiere is %s already; nothing to follow", status); break
        if status is None and time.time() > start_ts + 20:
            log.warning("live status unknown (YouTube blocking metadata); trying the audio anyway"); break
        hb("waiting for the premiere to start", ep); time.sleep(45)

    # 4) follow the audio --------------------------------------------------------------------
    pilot = Pilot(supa, ep, roster, [title_case(g) for g in guests] + ["Tony Hinchcliffe", "Brian Redban"],
                  mode="live", info={"video": vid, "latency": a.latency, "source": "youtube"})
    retry = 5; not_live = 0; attempt = 0; fails = 0; had_audio = False
    while time.time() < hard_stop:
        st = yt.AudioStream(vid, attempt=attempt); st.start(); off0 = None; n = 0
        pilot.heartbeat(force=True, state="listening")
        while True:
            item = st.get(timeout=2.0)
            if item is None:
                if not st.alive: break
                pilot.heartbeat(); continue
            wall, x = item
            if off0 is None:
                off0 = (wall - start_ts) - a.latency
                pilot.stt.reset(off0); log.info("audio connected at offset %s", hms(off0))
            # keep up: if we are > 45 s behind, drop the backlog
            if st.q.qsize() * 0.5 > 45:
                log.warning("falling behind by %.0fs; skipping ahead", st.q.qsize() * 0.5)
                while st.q.qsize() > 4: _w, _x = st.q.get(); n += len(_x)
            pilot.feed(x, off0 + n / SR); n += len(x)
            if time.time() > hard_stop: break
        st.stop()
        if st.got_audio:
            had_audio = True; fails = 0; retry = 5
        else:
            fails += 1; attempt += 1          # rotate to the next yt-dlp client
        status = None
        try: status = live_status(vid)
        except yt.RateLimited: pass
        if status is not None and status != "is_live":
            not_live += 1
            if not_live >= 2 or status in ("was_live", "post_live"):
                log.info("stream ended (%s)", status); break
        if status is None and had_audio and fails >= 10:
            log.info("audio gone for 10 tries and status unknown: treating the stream as ended"); break
        why = ("YouTube bot check: audio blocked" if st.bot_blocked else
               "YouTube refused the audio" if not st.got_audio else "audio stopped")
        log.warning("%s (client %s); reconnecting in %ss", why, st.variant, retry)
        pilot.heartbeat(force=True, state=f"{why}; retry in {retry}s (use manual controls if this persists)")
        time.sleep(retry); retry = min(retry * 2, 60)
    pilot.flush()
    r = supa.rpc("auto_end_episode", p_episode=ep, p_offset=round(pilot.offset, 1))
    pilot.heartbeat(force=True, state="finished: episode ended" if r and r.get("ok") else f"finished ({r})")
    json.dump({"episode": ep, "video": vid, "events": pilot.events}, open(os.path.join(HERE, "logs", f"live-{dt.date.today()}.json"), "w"), indent=1, default=str)
    log.info("done")

def cmd_keepalive(a):
    import requests
    r = requests.post(f"{SUPABASE_URL}/rest/v1/rpc/live_state", json={"p_episode": None},
                      headers={"apikey": SUPABASE_KEY, "Authorization": "Bearer " + SUPABASE_KEY}, timeout=20)
    print(dt.datetime.now().isoformat(timespec="seconds"), "keepalive", r.status_code)

if __name__ == "__main__":
    p = argparse.ArgumentParser(); sub = p.add_subparsers(dest="cmd", required=True)
    l = sub.add_parser("live"); l.add_argument("--find-hours", type=float, default=3.0); l.add_argument("--max-hours", type=float, default=3.25)
    l.add_argument("--poll", type=float, default=180); l.add_argument("--latency", type=float, default=12.0)
    l.add_argument("--feed-poll", type=float, default=40); l.add_argument("--since-hours", type=float, default=6)
    l.add_argument("--podcast-grace", type=float, default=900); l.add_argument("--feed", default=pod.FEED)
    pr = sub.add_parser("podreplay"); pr.add_argument("num"); pr.add_argument("--mp3"); pr.add_argument("--captions")
    pr.add_argument("--speed", type=float, default=0); pr.add_argument("--lead", type=float, default=0); pr.add_argument("--no-youtube", action="store_true")
    r = sub.add_parser("replay"); r.add_argument("wav"); r.add_argument("--speed", type=float, default=0); r.add_argument("--title", default="TEST replay")
    r.add_argument("--video"); r.add_argument("--start", type=float, default=0); r.add_argument("--stop", type=float, default=0)
    r.add_argument("--roster", default=""); r.add_argument("--guests", default=""); r.add_argument("--keep-live", action="store_true")
    sub.add_parser("keepalive")
    a = p.parse_args()
    {"live": cmd_live, "replay": cmd_replay, "podreplay": cmd_podreplay, "keepalive": cmd_keepalive}[a.cmd](a)
