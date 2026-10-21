"""Crowd-reaction meter: per-frame loudness and noisiness against a rolling baseline.

Applause and cheering are loud *and* broadband/noise-like (high spectral flatness, lots of energy
above 2 kHz), unlike speech or music. We keep 0.5 s frames, a rolling median baseline over the last
BASE seconds, and report a "crowd score" for any time span: how many seconds in that span were
>= DB_OVER dB above baseline with flatness >= FLAT_MIN.
"""
from collections import deque
import numpy as np

SR = 16000
FRAME = 0.5

def frame_features(x):
    """x: float32 mono, length = FRAME*SR. -> (db, flatness, hf_ratio)"""
    rms = float(np.sqrt(np.mean(x * x)) + 1e-9)
    db = 20 * np.log10(rms)
    spec = np.abs(np.fft.rfft(x * np.hanning(len(x)))) + 1e-9
    flat = float(np.exp(np.mean(np.log(spec))) / np.mean(spec))
    freqs = np.fft.rfftfreq(len(x), 1 / SR)
    p = spec ** 2
    hf = float(p[freqs >= 2000].sum() / p.sum())
    return db, flat, hf

class CrowdMeter:
    def __init__(self, base_seconds=120.0, db_over=5.0, flat_min=0.0, hf_min=0.0):
        self.frames = deque()            # (t, db, flat, hf)
        self.keep = base_seconds + 120
        self.base_seconds = base_seconds
        self.db_over, self.flat_min, self.hf_min = db_over, flat_min, hf_min
        self._pending = np.zeros(0, dtype=np.float32); self._pending_t = None

    def feed(self, samples, t0):
        if self._pending_t is None or abs(self._pending_t + len(self._pending) / SR - t0) > 1.0:
            self._pending = np.zeros(0, dtype=np.float32); self._pending_t = t0
        self._pending = np.concatenate([self._pending, samples])
        n = int(FRAME * SR)
        while len(self._pending) >= n:
            db, fl, hf = frame_features(self._pending[:n])
            self.frames.append((self._pending_t, db, fl, hf))
            self._pending = self._pending[n:]; self._pending_t += FRAME
        while self.frames and self.frames[-1][0] - self.frames[0][0] > self.keep:
            self.frames.popleft()

    @property
    def latest(self):
        return self.frames[-1][0] + FRAME if self.frames else 0.0

    def baseline(self, before):
        v = [db for (t, db, fl, hf) in self.frames if before - self.base_seconds <= t < before]
        return float(np.median(v)) if len(v) >= 20 else None

    def score(self, a, b, base_at=None):
        """Seconds of crowd-like loudness in [a, b) and the longest run, versus the baseline before base_at."""
        base = self.baseline(base_at if base_at is not None else a)
        if base is None:
            return {"base": None, "secs": 0.0, "run": 0.0, "peak": 0.0}
        secs = run = best = 0.0; peak = -99.0
        for (t, db, fl, hf) in self.frames:
            if a <= t < b:
                peak = max(peak, db - base)
                hit = db - base >= self.db_over and (fl >= self.flat_min or hf >= self.hf_min)
                if hit:
                    secs += FRAME; run += FRAME; best = max(best, run)
                else:
                    run = 0.0
        return {"base": round(base, 1), "secs": secs, "run": best, "peak": round(float(peak), 1)}
