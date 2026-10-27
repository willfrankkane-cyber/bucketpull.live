"""Offline lineup builder: the whole transcript is available, so we can look both ways.

Used by archive_job.py for past episodes fans paste in. Two passes, merged:
  1. the live Detector run over the full word stream (same rules as Monday night);
  2. a whole-transcript "NAME, everybody" scan: Tony's intros almost always end "<name>, everybody", preceded by
     an intro cue ("make some noise for", "bucket pull", "goes by the name of", "present to you", ...).
Each name is kept once (first intro wins; later mentions are sign-offs / callbacks). Regular vs bucket pull uses the
Detector's cue classifier. The golden ticket is the first award phrase while somebody has been on stage 30 s+.
Returns {"comics":[{name,t,kind,conf,heard,why}], "golden_ticket":{name,t}|None, "end":t}.
"""
import re, logging
from .detector import Detector, GT_AWARD_RE, NOT_NAMES, STOP
from .names import title_case, similarity, best_match, norm
from .regulars import KNOWN, likely_from_roster
from .transcriber import Word

log = logging.getLogger("bp.lineup")
CUE_RE = re.compile(r"(makes? some noise|take some noise|noise for|bucket pull|goes by the name of|present to you|here comes|please welcome|"
                    r"give it up|the return of|it is|it's|this is|going to|welcome)")
GT_EXTRA_RE = re.compile(r"this is (?:a|your) golden ticket|you get (?:a )?golden ticket")
NAME_TOK = re.compile(r"^[A-Z][A-Za-z'’.-]*$|^[A-Z]\.?$|^(?:de|la|del|van|von|da|di)$")
EVERY_RE = re.compile(r"^(?:everybody|everyone|ladies)\b", re.I)
BAD_FIRST = {"Kill", "Tony", "Redban", "The", "This", "That", "Make", "Here", "Ladies", "All", "Okay", "Alright", "Thank",
             "Austin", "Texas", "Mothership", "America", "God", "Jesus", "Netflix", "Comedy", "Happy", "Merry", "Big", "Good", "Wow", "Thanks", "Thank", "Yeah", "Yes", "No", "Oh", "Hey", "Hello", "Bye", "Everybody"}

def _clean(tok):
    return tok.strip().strip(",.!?\"").replace("’", "'")

def everybody_pass(words, panel):
    """words: [(t, raw)]. Candidates where up to 4 capitalised tokens are followed by 'everybody' and preceded by a cue."""
    out = []
    n = len(words)
    for i in range(n):
        if not EVERY_RE.match(_clean(words[i][1])):
            continue
        j = i - 1; toks = []
        while j >= 0 and len(toks) < 4:
            raw = words[j][1].strip(); c = _clean(raw)
            if not c:
                break
            if re.match(r"^['’-][A-Za-z]", c) and j > 0:          # "O 'Leary" split by whisper
                toks.insert(0, c); j -= 1; continue
            if not NAME_TOK.match(c):
                break
            if toks and re.search(r"[.!?]$", raw) and not re.fullmatch(r"[A-Z]\.", c + "."):                 # sentence end before the name
                break
            toks.insert(0, c); j -= 1
            if raw.endswith(",") and len(toks) > 1:
                toks.pop(0); j += 1; break
        if not toks:
            continue
        name = re.sub(r"\s+(['’-])", r"\1", " ".join(toks)).strip()
        name = re.sub(r"\.$", "", name)
        first = name.split()[0]
        if first in BAD_FIRST or first.lower() in STOP or name.lower() in NOT_NAMES or len(norm(name)) < 3:
            continue
        if any(similarity(name, p) >= 0.86 or norm(name) in norm(p).split() for p in panel):
            continue
        ctx = " ".join(_clean(w[1]).lower() for w in words[max(0, j - 14):j + 1])
        cue = CUE_RE.search(ctx)
        t = words[j + 1][0]
        after = " ".join(_clean(w[1]) for w in words[i + 1:i + 25] if w[0] <= t + 25)
        rep = norm(name).split()[-1][:4] in norm(after) or norm(name).split()[0][:4] in norm(after)
        if not cue:
            continue
        if len(set(norm(name).split())) < len(norm(name).split()):
            continue
        conf = 0.6 + (0.2 if cue else 0) + (0.15 if rep else 0) + (0.1 if "bucket" in ctx else 0)
        out.append({"t": t, "name": title_case(name), "heard": name, "conf": round(min(conf, 0.97), 2),
                    "why": "everybody" + (f",cue:{cue.group(0)}" if cue else "") + (",repeated" if rep else "")})
    return out

def build(words_json, roster=(), guests=(), crowd=None):
    """words_json: list of {"t","e","w","p"} (absolute seconds in the audio)."""
    panel = list(guests) + ["Tony Hinchcliffe", "Brian Redban", "Tony", "Redban"]
    ws = [Word(w["t"], w.get("e", w["t"]), w["w"], w.get("p", 1)) for w in words_json]
    det = Detector(roster=list(roster), panel=panel, crowd=crowd, regulars=KNOWN,
                   likely_regulars=likely_from_roster(list(roster), list(guests)))
    evs = []
    for k in range(0, len(ws), 40):
        evs += det.feed(ws[k:k + 40]) + det.tick(ws[min(k + 40, len(ws)) - 1].t - 10)
    evs += det.tick(1e9)
    cands = [{"t": e["t"], "name": e["name"], "heard": e.get("heard") or e["name"], "conf": e["conf"], "why": "detector:" + e.get("why", "")}
             for e in evs if e["kind"] == "comic"]
    cands += everybody_pass([(w.t, w.text) for w in ws], panel)
    cands.sort(key=lambda c: c["t"])
    # cluster by person: first intro wins; roster spelling when close
    people = []
    for c in cands:
        hit = None
        for p in people:
            s = max(similarity(c["name"], p["name"]), similarity(c["heard"], p["heard"]))
            lc, lp = norm(c["name"]).split(), norm(p["name"]).split()
            same_last = len(lc) > 1 and len(lp) > 1 and lc[-1][:4] == lp[-1][:4] and lc[0][:2] == lp[0][:2]
            one = len(lc) == 1 and len(lp) > 1 and lc[0] == lp[-1]
            if s >= 0.84 or same_last or one:
                hit = p; break
        if hit:
            hit["conf"] = max(hit["conf"], c["conf"]); hit["n"] += 1; hit["why"] += "|" + c["why"]
            continue
        rh = best_match(c["name"], [(r, r) for r in roster], 0.86) if roster else None
        people.append(dict(c, name=title_case(rh[1]) if rh else c["name"], n=1))
    # a 'person' introduced < 40 s before the next intro with a single weak mention is noise
    people.sort(key=lambda p: p["t"])
    keep = []
    for i, p in enumerate(people):
        nxt = people[i + 1]["t"] if i + 1 < len(people) else 1e9
        if p["conf"] < 0.75 or (nxt - p["t"] < 40 and p["n"] < 2 and p["conf"] < 0.9):
            log.info("drop %s at %.0f (conf %.2f, n %d)", p["name"], p["t"], p["conf"], p["n"]); continue
        keep.append(p)
    # classify with the full transcript in the detector's buffer
    det.words = [(w.t, w.text.strip(), re.sub(r"[^a-z0-9' ,.-]", "", w.text.strip().lower()).strip(" .")) for w in ws]
    for p in keep:
        k_after = next((i for i, w in enumerate(det.words) if w[0] > p["t"] + 3), len(det.words))
        p["kind"], p["role_why"] = det.classify(p["t"], p["name"], k_after)
        ctx = " ".join(w[2] for w in det.words if p["t"] - 20 <= w[0] < p["t"])
        if "golden ticket winner" in ctx or "golden ticket holder" in ctx:
            p["kind"] = "regular"; p["role_why"] += " +gt-winner-return"
    # golden ticket
    gt = None
    text_ws = det.words
    for i, w in enumerate(text_ws):
        seg = " ".join(x[2].replace(",", "") for x in text_ws[i:i + 9])
        if not (GT_AWARD_RE.match(seg) or GT_EXTRA_RE.match(seg)):
            continue
        on = [p for p in keep if p["t"] <= w[0]]
        if on and "gt-winner-return" not in on[-1]["role_why"] and 30 <= w[0] - on[-1]["t"] <= 20 * 60:
            gt = {"name": on[-1]["name"], "t": w[0], "phrase": seg[:60]}; break
    end = ws[-1].t if ws else 0
    return {"comics": [{k: p[k] for k in ("name", "t", "kind", "conf", "heard", "why", "role_why")} for p in keep],
            "golden_ticket": gt, "end": end}
