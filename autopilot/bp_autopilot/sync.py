"""Map podcast time -> YouTube video time.

Measured on #789/#790 (waveform cross-correlation against the YouTube audio): the podcast is the same
program audio with a different head (a ~30 s network pre-roll on some weeks, none on others) and no
mid-roll insertions, so the mapping is one constant per episode (drift < 0.15 s over 2 h).

Methods, best first:
  captions  align the podcast transcript with YouTube auto-captions (word 4-grams; piecewise, so it also
            absorbs any inserted mid-roll ads). Needs the captions to be reachable.
  anchor    the YouTube video's intro is fixed: "Hey, this is Redban coming to you live from the comedy
            MOTHERSHIP" - "Mothership" is at 38.92 s (#789) and 37.84 s (#790) of the video. Find that word
            in the podcast transcript.
  default   0 (no information yet).
"""
import json, re
from collections import defaultdict
import numpy as np

YT_ANCHOR = 38.4
ANCHOR_RE = re.compile(r"mother\s*-?\s*ship")

def _norm(w):
    return re.sub(r"[^a-z0-9']", "", w.lower())

def caption_words(json3_text):
    d = json.loads(json3_text) if isinstance(json3_text, str) else json3_text
    out = []
    for ev in d.get("events", []):
        t0 = ev.get("tStartMs", 0)
        for s in ev.get("segs", []) or []:
            w = _norm(s.get("utf8", ""))
            if w and not w.startswith("["):
                out.append(((t0 + s.get("tOffsetMs", 0)) / 1000.0, w))
    return out

class SyncMap:
    def __init__(self):
        self.method, self.points, self.info = "default", [(0.0, 0.0)], {}

    @property
    def delta(self):
        return self.points[0][1]

    def map(self, pod_t):
        d = self.points[0][1]
        for t, dd in self.points:
            if t <= pod_t: d = dd
            else: break
        return pod_t + d

    def to_info(self):
        return {"method": self.method, "delta": round(self.delta, 2),
                "segments": [[round(t, 1), round(d, 2)] for t, d in self.points][:12], **self.info}

    # ---------- anchor ----------
    def try_anchor(self, words):
        """words: [(t, text)] podcast transcript (absolute podcast seconds)."""
        if self.method == "captions":
            return False
        toks = [(t, _norm(w)) for t, w in words if t < 420]
        for i, (t, w) in enumerate(toks):
            two = w + (toks[i + 1][1] if i + 1 < len(toks) else "")
            if ANCHOR_RE.search(w) or two.startswith("mothership"):
                ctx = " ".join(x for _, x in toks[max(0, i - 8):i])
                if "comedy" in ctx or "live" in ctx or "redban" in ctx or "austin" in ctx:
                    self.method, self.points = "anchor", [(0.0, YT_ANCHOR - t)]
                    self.info = {"anchor_pod_t": round(t, 2)}
                    return True
        return False

    # ---------- captions ----------
    def try_captions(self, words, caps, n=4, min_matches=25):
        pw = [(t, _norm(w)) for t, w in words]
        pw = [(t, w) for t, w in pw if w]
        idx = defaultdict(list)
        for i in range(len(caps) - n + 1):
            idx[" ".join(w for _, w in caps[i:i + n])].append(caps[i][0])
        cnt = defaultdict(int)
        for i in range(len(pw) - n + 1):
            cnt[" ".join(w for _, w in pw[i:i + n])] += 1
        m = []
        for i in range(len(pw) - n + 1):
            g = " ".join(w for _, w in pw[i:i + n])
            if len(g) < 12 or cnt[g] != 1 or len(idx.get(g, [])) != 1:
                continue
            m.append((pw[i][0], idx[g][0] - pw[i][0]))
        if len(m) < min_matches:
            self.info["captions_matches"] = len(m)
            return False
        m.sort()
        d = np.array([x[1] for x in m]); t = np.array([x[0] for x in m])
        # robust piecewise-constant fit: running median over 25 matches, then merge steps < 3 s
        k = 25; med = np.array([np.median(d[max(0, i - k // 2):i + k // 2 + 1]) for i in range(len(d))])
        pts = [(0.0, float(np.median(med[:k])))]
        for ti, mi in zip(t, med):
            if abs(mi - pts[-1][1]) >= 3.0:
                pts.append((float(ti), float(mi)))
        # refine each piece with the median of its own matches
        out = []
        for j, (t0, _) in enumerate(pts):
            t1 = pts[j + 1][0] if j + 1 < len(pts) else 1e12
            sel = d[(t >= t0) & (t < t1)]
            sel_med = float(np.median(sel)) if len(sel) else pts[j][1]
            good = sel[np.abs(sel - sel_med) < 1.5] if len(sel) else sel
            out.append((t0, float(np.median(good)) if len(good) else sel_med))
        self.method, self.points = "captions", out
        resid = np.abs(d - np.array([self.map(x) - x for x in t]))
        self.info = {"captions_matches": len(m), "captions_mad": round(float(np.median(resid)), 2)}
        return True
