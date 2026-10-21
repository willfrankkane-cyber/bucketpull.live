"""Turns the committed word stream (+ crowd meter) into show events.

Events emitted (dicts):
  {"kind":"comic", "t":offset, "name":..., "heard":..., "conf":..., "match":existing_key_or_None, "pattern":...}
  {"kind":"set_end", "t":offset, "why":...}          (first comic's set over -> close betting)
  {"kind":"golden_ticket", "t":offset, "conf":..., "evidence":{...}}
"""
import re, logging
from .names import title_case, best_match, similarity, norm

log = logging.getLogger("bp.detect")

# --- comic intro patterns: (regex over normalised lowercase text, base confidence) -----------------
INTRO = [
    (r"next bucket pull,? (?:it'?s|it is|is|goes by the name of)", 0.85),
    (r"minute(?: long|-long)? set (?:from|for|by) ", 0.8),
    (r"(?:i )?present to you (?:the great and powerful |the great |the one and only )?", 0.8),
    (r"(?:comedian|comic|name) (?:out of|from) the bucket(?:,| is| it'?s| goes by the name of)", 0.85),
    (r"goes by the name of", 0.85),
    (r"(?:sixty|60|one minute|a minute) (?:seconds? )?(?:\w+ )?(?:un)?interrupted (?:going to|for)", 0.85),
    (r"(?:make|take) some noise for (?:the )?(?:(?:long ?-? ?awaited )?return of )?(?:your )?", 0.62),
    (r"here comes", 0.62),
    (r"please welcome", 0.62),
    (r"give it up for", 0.6),
    (r"(?:^| )this is (?:the (?:great |one and only )?)?", 0.5),
]
INTRO_RE = [(re.compile(p), c) for p, c in INTRO]
SET_END_RE = re.compile(r"(?:back )?to the bucket we go|there goes|joke book|back to the bucket")
BUCKET_RE = re.compile(r"bucket")
# award phrases (said about the comic in front of Tony), not passing mentions
GT_AWARD_RE = re.compile(
    r"(?:newest golden ticket (?:winner|holder))"
    r"|(?:(?:you|you've|you have|you are|you're) (?:just )?(?:won|earned|got|get|getting|are getting|receive|received) (?:a |the |your |yourself a |an official )?golden ticket)"
    r"|(?:here'?s (?:your|a) golden ticket)|(?:golden ticket for you)|(?:(?:give|giving) you (?:a |the )?golden ticket)"
    r"|(?:you(?:'re| are) (?:a |our )?(?:new |newest )?golden ticket winner)")
STOP = {"everybody", "everyone", "ladies", "gentlemen", "folks", "y'all", "guys", "the", "a", "an", "and", "he", "she",
        "here", "this", "that", "who", "with", "from", "on", "of", "to", "please", "now", "again", "back", "it's", "is",
        "make", "some", "noise", "one", "more", "time", "for", "uh", "um", "what's", "up", "comes", "just", "very", "so",
        "it", "i", "we", "you", "they", "what", "there", "where", "why", "how", "when", "my", "your", "our", "his", "her", "not", "no", "yes", "all", "right", "okay", "oh"}
COMEDY_CTX_RE = re.compile(r"comedian|comic|brand new minute|stand-up|standup|minute of|set from|first time")
AFTER_NAME_RE = re.compile(r"^(?:everybody|everyone|ladies and gentlemen|folks)")
NOT_NAMES = {"tony hinchcliffe", "brian redban", "redban", "tony", "kill tony", "the band", "everybody", "the bucket"}

class Detector:
    def __init__(self, roster=(), panel=(), threshold=0.75, crowd=None,
                 crowd_db=5.0, crowd_run=6.0, crowd_secs=8.0):
        self.words = []                 # (t, raw, low)
        self.roster = list(roster)      # known names (description list)
        self.panel = [n.lower() for n in panel]
        self.threshold = threshold
        self.crowd = crowd
        self.crowd_db, self.crowd_run, self.crowd_secs = crowd_db, crowd_run, crowd_secs
        self.comics = []                # [{"key","name","t"}] known comics (from DB + detected)
        self.current = None             # key of comic on stage
        self.current_t = None
        self.first_comic_t = None
        self.set_end_sent = False
        self.gt_done = False
        self.pending = []               # intro candidates waiting for look-ahead
        self.gt_pending = []
        self.seen_triggers = set()
        self.blocked = set()
        self.last_conf = None

    # ---- state sync from the DB (host edits, deletes, renames) ----
    def sync(self, comics, current, blocked=(), gt_done=None):
        self.comics = [{"key": c["id"], "name": c["name"], "heard": c.get("heard_as") or c["name"], "t": self._t_of(c["id"])} for c in comics]
        self.current = current
        self.blocked = set(b.lower() for b in blocked)
        if gt_done is not None:
            self.gt_done = gt_done

    def _t_of(self, key):
        for c in self.comics:
            if c["key"] == key:
                return c["t"]
        return None

    # ---- text helpers ----
    def _text_from(self, i):
        return " ".join(w[2] for w in self.words[i:])

    def feed(self, words):
        """words: iterable of transcriber.Word (absolute offsets). Returns list of events."""
        start = len(self.words)
        for w in words:
            raw = w.text.strip()
            if not raw:
                continue
            low = re.sub(r"[^a-z0-9' ,.-]", "", raw.lower()).strip(" .")
            self.words.append((w.t, raw, low))
        if len(self.words) > 4000:
            drop = len(self.words) - 3000
            self.words = self.words[drop:]
            start = max(0, start - drop)
            for p in self.pending:
                p["k"] = max(0, p["k"] - drop)
                if p.get("k_trig") is not None:
                    p["k_trig"] = max(0, p["k_trig"] - drop)
            self.seen_triggers = {k for k in self.seen_triggers if k >= self.words[0][0]}
        return self._scan(max(0, start - 12))

    def tick(self, now_t):
        """Call regularly with the latest stream offset so pending checks (look-ahead / crowd) can resolve."""
        return self._resolve(now_t)

    def _scan(self, i0):
        evs = []
        n = len(self.words)
        # build a joined lowercase string with char->word index map
        idx, parts, pos = [], [], 0
        for k in range(i0, n):
            tok = self.words[k][2]
            parts.append(tok); idx.append((pos, k)); pos += len(tok) + 1
        text = " ".join(parts).replace(",", "")
        # positions shift after removing commas; recompute map on the comma-free text
        idx, pos = [], 0
        for k in range(i0, n):
            tok = self.words[k][2].replace(",", "")
            idx.append((pos, k)); pos += len(tok) + 1
        def word_at(cpos):
            last = idx[0][1]
            for p, k in idx:
                if p > cpos: break
                last = k
            return last
        for rx, base in INTRO_RE:
            for m in rx.finditer(text):
                k_end = word_at(m.end())
                if text[m.end() - 1:m.end()] == " ":
                    k_end -= 1
                k_trig = word_at(m.start())
                t = self.words[k_trig][0]
                key = round(t, 1)
                if key in self.seen_triggers:
                    continue
                self.seen_triggers.add(key)
                self.pending.append({"t": t, "k": k_end + 1, "base": base, "pattern": m.group(0), "k_trig": k_trig, "rx": rx})
        for m in SET_END_RE.finditer(text):
            t = self.words[word_at(m.start())][0]
            if not self.set_end_sent and self.first_comic_t is not None and t > self.first_comic_t + 60:
                self.set_end_sent = True
                evs.append({"kind": "set_end", "t": t, "why": m.group(0)})
        for m in GT_AWARD_RE.finditer(text):
            t = self.words[word_at(m.start())][0]
            if any(abs(t - g["t"]) < 20 for g in self.gt_pending):
                continue
            self.gt_pending.append({"t": t, "phrase": m.group(0)})
            log.info("golden-ticket award phrase at %.1f: %r", t, m.group(0))
        return evs + self._resolve(self.words[-1][0] if self.words else 0)

    def _name_after(self, k, _retry=True):
        """Collect a name starting at word index k: capitalised tokens (or initials) until a stop word/punctuation.
        Whisper splits "O'Neill" -> "O", "'Neill" and "Danger-up-rus" -> "Danger", "-up", "-rus": glue those back.
        If the host makes an aside first ("make some noise for, this sounds promising, Danger Russ"), skip to the
        next comma once and try again."""
        toks, raw = [], []; j = k
        while j < min(k + 8, len(self.words)):
            r = self.words[j][1].strip(); j += 1
            if toks and re.match(r"^['’-][A-Za-z]", r):          # glue a split fragment onto the previous token
                w0, c0 = toks[-1]; frag = re.sub(r"[^A-Za-z'’-]", "", r)
                toks[-1] = (w0 + frag.replace("’", "'"), c0); raw.append(r)
                if re.search(r"[,!?]$", r) or r.endswith("."): break
                continue
            word = re.sub(r"[^A-Za-z'’.-]", "", r)
            lw = word.lower().strip(".")
            if not word:
                break
            if lw in STOP and not (toks and lw in ("de", "la")):
                if toks: break
                if lw in ("the",):  # "the return of" handled by regex; "the great X" -> skip 'the'
                    continue
                break
            cap = word[0].isupper()
            if not cap and toks and len(toks) >= 1:
                break
            toks.append(((word.strip(".’'") if not re.fullmatch(r"[A-Z]\.?", word) else word.strip(".")), cap))
            raw.append(r)
            if re.search(r"[,!?]$", r) or (r.endswith(".") and not re.fullmatch(r"[A-Za-z]\.", r)) or len(toks) >= 4:
                break
        caps = sum(1 for _, c in toks if c) / len(toks) if toks else 0
        if _retry and not toks:
            for jj in range(k, min(k + 7, len(self.words) - 1)):
                if self.words[jj][1].strip().endswith(","):
                    n2, c2, e2 = self._name_after(jj + 1, _retry=False)
                    if n2 and c2 == 1:
                        return n2, c2, e2
                    break
        if not toks:
            return None, 0, k
        name = " ".join(w for w, _ in toks)
        return name, caps, j

    def _resolve(self, now_t):
        evs = []
        keep = []
        for p in self.pending:
            enough = (len(self.words) - p["k"] >= 8) or (now_t - p["t"] >= 10)
            if not enough:
                keep.append(p); continue
            ev = self._judge_intro(p)
            if isinstance(ev, list):
                evs.extend(ev)
            elif ev:
                evs.append(ev)
        self.pending = keep
        # golden ticket: need the crowd window to be complete
        keep = []
        for g in self.gt_pending:
            if self.gt_done:
                continue
            if self.crowd is None:
                continue
            if self.crowd.latest < g["t"] + 20:
                keep.append(g); continue
            ev = self._judge_gt(g)
            if ev:
                evs.append(ev)
        self.gt_pending = keep
        return evs

    def _rematch(self, p):
        """Re-run the intro regex once look-ahead words exist: optional parts ("the return of", "long-awaited")
        may not have been transcribed yet when the trigger was first seen."""
        k0 = p.get("k_trig")
        if k0 is None or p.get("rx") is None:
            return
        k0 = max(0, min(k0, len(self.words) - 1))
        toks = [w[2].replace(",", "") for w in self.words[k0:k0 + 25]]
        starts, pos = [], 0
        for tok in toks:
            starts.append(pos); pos += len(tok) + 1
        m = p["rx"].search(" ".join(toks))
        if not m:
            return
        j = max(i for i, st in enumerate(starts) if st <= m.end())
        if m.group(0).endswith(" "):
            j -= 1
        p["k"] = k0 + j + 1
        p["pattern"] = m.group(0)

    def _judge_intro(self, p):
        self._rematch(p)
        name, caps, k_after = self._name_after(p["k"])
        if not name:
            log.debug("no name after trigger at %.1f", p["t"]); return None
        if name.lower().split()[0] in ("kill",) or name.lower() in ("tony",):
            return None
        tail = " ".join(w[2] for w in self.words[k_after:k_after + 3]).replace(",", "")
        low = name.lower()
        if low in NOT_NAMES or len(norm(name)) < 2:
            log.info("not a name: %s at %.1f", name, p["t"]); return None
        if any(similarity(name, pn) >= 0.86 for pn in self.panel):
            log.info("skip panel name %s at %.1f", name, p["t"]); return None
        conf = p["base"]
        why = [p["pattern"]]
        # context: the bucket was mentioned in the 60 s before (new pull), or a set just ended
        ctx = [w for w in self.words if p["t"] - 60 <= w[0] < p["t"]]
        if any(BUCKET_RE.search(w[2]) for w in ctx):
            conf += 0.13; why.append("bucket")
        # repeated name within ~15 s after the trigger
        after = [w for w in self.words if p["t"] < w[0] <= p["t"] + 15]
        seq = " ".join(w[1] for w in after)
        first_tok = norm(name).split()[0] if norm(name) else ""
        later = [w for w in after if norm(w[1]).startswith(first_tok[:4])] if first_tok else []
        if len(later) >= 2:
            conf += 0.12; why.append("repeated")
        if AFTER_NAME_RE.search(tail):
            conf += 0.1; why.append("name+everybody")
        if any(COMEDY_CTX_RE.search(w[2]) for w in self.words if p["t"] - 25 <= w[0] < p["t"]) or \
           COMEDY_CTX_RE.search(" ".join(w[2] for w in self.words if p["t"] - 25 <= w[0] < p["t"])):
            conf += 0.1; why.append("comedy-context")
        if caps < 1:
            conf -= 0.3; why.append("lowercase")
        roster_hit = best_match(name, [(r, r) for r in self.roster], 0.86)
        display = title_case(roster_hit[1] if roster_hit else name)
        if roster_hit:
            conf += 0.1; why.append("roster")
        conf = round(min(conf, 0.99), 2)
        self.last_conf = conf
        if norm(display) in self.blocked or norm(name) in self.blocked or low in self.blocked:
            log.info("blocked by host: %s", display); return None
        # same as somebody we already have?
        known = best_match(display, [(c["key"], c["name"]) for c in self.comics] + [(c["key"], c["heard"]) for c in self.comics], 0.84)
        if known and known[0] == self.current:
            log.info("already on stage: %s at %.1f", display, p["t"]); return None
        if conf < self.threshold:
            log.info("below threshold %.2f: %s at %.1f (%s)", conf, display, p["t"], ",".join(why))
            return None
        if known and p["base"] < 0.8:
            # only strong intro phrases may re-stage a comic who already performed
            log.info("weak re-intro of %s (matches %s) at %.1f ignored", display, known[1], p["t"]); return None
        if self.current_t is not None and p["t"] - self.current_t < 45 and p["base"] < 0.8:
            log.info("too soon after last comic: %s at %.1f", display, p["t"]); return None
        key = known[0] if known else None
        ev = {"kind": "comic", "t": p["t"], "name": known[1] if known else display, "heard": name, "conf": conf,
              "match": key, "why": ",".join(why)}
        # optimistic local state; the caller replaces the key with the DB id
        if not key:
            key = "local:" + display
            self.comics.append({"key": key, "name": display, "heard": name, "t": p["t"]})
        self.current, self.current_t = key, p["t"]
        if self.first_comic_t is None:
            self.first_comic_t = p["t"]
        elif not self.set_end_sent:
            self.set_end_sent = True
            return [ev, {"kind": "set_end", "t": p["t"] - 1, "why": "next comic"}]
        return ev

    def _judge_gt(self, g):
        t = g["t"]
        if self.current is None or self.current_t is None:
            log.info("gt phrase at %.1f but nobody on stage", t); return None
        on_stage_for = t - self.current_t
        if on_stage_for < 30 or on_stage_for > 20 * 60:
            log.info("gt phrase at %.1f not about the current comic (on stage %.0fs)", t, on_stage_for); return None
        sc = self.crowd.score(t - 5, t + 20, base_at=t - 5)
        ok = sc["base"] is not None and sc["run"] >= self.crowd_run and sc["secs"] >= self.crowd_secs
        log.info("gt check at %.1f phrase=%r crowd=%s -> %s", t, g["phrase"], sc, ok)
        if not ok:
            return None
        self.gt_done = True
        conf = round(min(0.99, 0.6 + 0.02 * sc["secs"]), 2)
        cur = next((c["name"] for c in self.comics if c["key"] == self.current), None)
        return {"kind": "golden_ticket", "t": t, "conf": conf, "name": cur,
                "evidence": {"phrase": g["phrase"], "crowd_secs": sc["secs"], "crowd_run": sc["run"], "crowd_peak_db": sc["peak"]}}
