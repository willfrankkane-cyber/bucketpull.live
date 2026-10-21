#!/workspace/ktvenv/bin/python
"""Bucket Pull Live autopilot.

  autopilot.py live                 Monday job: find the premiere, create the episode, follow the stream, end it.
  autopilot.py replay WAV [--speed N] [--title T] [--video ID]
                                    Feed a recorded episode through the same pipeline into a NEW test episode.
  autopilot.py keepalive            Tiny read so the free Supabase project never looks inactive.

Logs: logs/YYYY-MM-DD.log. Host secret: /workspace/bucketpull-host-secret.txt (never logged).
"""
import argparse, datetime as dt, fcntl, json, logging, os, random, sys, time
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from bp_autopilot.supa import Supa
from bp_autopilot.detector import Detector
from bp_autopilot.loudness import CrowdMeter
from bp_autopilot.names import title_case
from bp_autopilot import youtube as yt

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
        self.det = Detector(roster=roster, panel=panel, crowd=self.crowd)
        self.stt = RollingTranscriber(model=model, threads=6, prompt=self._prompt([]))
        self.hb_every, self.last_hb = hb_every, 0.0
        self.offset = 0.0; self.state = "listening"; self.last_event = None; self.events = []
        self.recent = []          # last words for the dashboard
        self.info = info or {}
        self.local_ids = {}
        self.words_log = open(os.path.join(HERE, "logs", time.strftime("words-%Y-%m-%d-") + mode + ".jsonl"), "a") if mode in ("replay", "live") else None

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
                                  p_conf=e["conf"], p_comic=cid)
                if r and r.get("ok") and r.get("comic"):
                    lk = "local:" + e["name"]
                    self.local_ids[lk] = r["comic"]
                    for c in self.det.comics:
                        if c["key"] == lk: c["key"] = r["comic"]
                    if self.det.current == lk: self.det.current = r["comic"]
                    self.stt.set_prompt(self._prompt([c["name"] for c in self.det.comics][-8:]))
                msg = f"{hms(t)} comic {e['name']} ({e['conf']:.2f}, heard '{e['heard']}', {e.get('why')}) -> {r}"
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

def cmd_live(a):
    logf = setup_logging("live")
    lock = open(os.path.join(HERE, "autopilot.lock"), "w")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        log.error("another autopilot is running; exiting"); return
    supa = Supa(SUPABASE_URL, SUPABASE_KEY, SECRET_FILE)
    started = time.time()
    give_up_find = started + a.find_hours * 3600
    log.info("autopilot live start; log %s", logf)
    hb = lambda st, ep=None, text=None: supa.rpc("auto_heartbeat", tries=2, p_episode=ep, p_state=st, p_offset=None, p_text=text, p_conf=None, p_event=None, p_info={"mode": "live"})

    # 1) find the premiere ------------------------------------------------------------------
    seen, meta, backoff = set(), None, a.poll
    while time.time() < give_up_find:
        try:
            hb("searching for the premiere")
        except Exception as ex:
            log.warning("heartbeat: %s", ex)
        try:
            meta = yt.find_premiere(seen)
            backoff = a.poll
        except yt.RateLimited:
            backoff = min(backoff * 2, 900); log.warning("YouTube rate limit; next try in %ss", backoff)
        except Exception as ex:
            log.warning("find_premiere error: %s", ex)
        if meta: break
        time.sleep(backoff + random.uniform(0, 30))
    if not meta:
        log.info("no premiere found tonight; exiting"); hb("idle: no premiere found tonight"); return
    vid = meta["id"]; title, guests, roster = yt.parse_episode(meta)
    start_ts = meta.get("release_timestamp") or meta.get("timestamp") or time.time()
    start = dt.datetime.fromtimestamp(start_ts, dt.timezone.utc)
    hard_stop = start_ts + a.max_hours * 3600
    log.info("found premiere %s %r at %s, guests %s, roster %d names", vid, title, start.isoformat(), guests, len(roster))

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
                  mode="live", info={"video": vid, "latency": a.latency})
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
    r = sub.add_parser("replay"); r.add_argument("wav"); r.add_argument("--speed", type=float, default=0); r.add_argument("--title", default="TEST replay")
    r.add_argument("--video"); r.add_argument("--start", type=float, default=0); r.add_argument("--stop", type=float, default=0)
    r.add_argument("--roster", default=""); r.add_argument("--guests", default=""); r.add_argument("--keep-live", action="store_true")
    sub.add_parser("keepalive")
    a = p.parse_args()
    {"live": cmd_live, "replay": cmd_replay, "keepalive": cmd_keepalive}[a.cmd](a)
