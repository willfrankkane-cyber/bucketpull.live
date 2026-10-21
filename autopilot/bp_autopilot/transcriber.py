"""Rolling, overlapping-window speech-to-text with faster-whisper.

Audio arrives as 16 kHz mono float32 with absolute stream offsets (seconds from premiere start).
Each window is W seconds long and advances by S seconds. Words are committed only from the
centre region of each window ([t0+(W-S)/2, t0+(W+S)/2)), so every word is transcribed with
context on both sides and never committed twice.
"""
import logging, time
import numpy as np

log = logging.getLogger("bp.stt")
SR = 16000

class Word:
    __slots__ = ("t", "end", "text", "p")
    def __init__(self, t, end, text, p):
        self.t, self.end, self.text, self.p = t, end, text, p
    def to_json(self):
        return {"t": round(self.t, 2), "e": round(self.end, 2), "w": self.text, "p": round(self.p, 3)}

class RollingTranscriber:
    def __init__(self, model="small.en", window=14.0, step=7.0, threads=6, prompt=""):
        from faster_whisper import WhisperModel
        t = time.time()
        self.model = WhisperModel(model, device="cpu", compute_type="int8", cpu_threads=threads)
        log.info("loaded %s in %.1fs", model, time.time() - t)
        self.W, self.S = window, step
        self.prompt = prompt
        self.buf = np.zeros(0, dtype=np.float32)
        self.buf_t0 = None          # stream offset of buf[0]
        self.next_t0 = None         # start of the next window
        self.first = True
        self.lag = 0.0              # processing time of last window

    def set_prompt(self, prompt):
        self.prompt = prompt

    def reset(self, t0):
        """Discontinuity (reconnect): drop the buffer and start fresh at offset t0."""
        self.buf = np.zeros(0, dtype=np.float32); self.buf_t0 = t0; self.next_t0 = t0; self.first = True

    def feed(self, samples, t0):
        """Append audio that starts at stream offset t0. Returns newly committed words."""
        if self.buf_t0 is None:
            self.reset(t0)
        expected = self.buf_t0 + len(self.buf) / SR
        if abs(t0 - expected) > 2.0:            # gap or jump: start over
            log.warning("audio discontinuity %.1fs -> %.1fs; resetting window", expected, t0)
            self.reset(t0)
        self.buf = np.concatenate([self.buf, samples.astype(np.float32)])
        out = []
        while self.buf_t0 + len(self.buf) / SR >= self.next_t0 + self.W:
            out.extend(self._window(self.next_t0))
            self.next_t0 += self.S
            # keep a little history before the next window only
            drop = int((self.next_t0 - self.buf_t0) * SR)
            if drop > 0:
                self.buf = self.buf[drop:]; self.buf_t0 += drop / SR
        return out

    def flush(self):
        """End of stream: transcribe what is left and commit everything after the last commit."""
        if self.buf_t0 is None or len(self.buf) < SR:
            return []
        return self._window(self.next_t0, final=True)

    def _window(self, t0, final=False):
        a = int((t0 - self.buf_t0) * SR); b = a + int(self.W * SR)
        chunk = self.buf[max(0, a):b]
        lo = t0 if self.first else t0 + (self.W - self.S) / 2
        hi = float("inf") if final else t0 + (self.W + self.S) / 2
        self.first = False
        t = time.time()
        segs, _ = self.model.transcribe(chunk, language="en", beam_size=1, vad_filter=False,
                                        word_timestamps=True, condition_on_previous_text=False,
                                        initial_prompt=self.prompt or None, temperature=0.0)
        words = []
        for s in segs:
            for w in (s.words or []):
                at = t0 + w.start
                if lo <= at < hi:
                    words.append(Word(at, t0 + w.end, w.word, w.probability))
        self.lag = time.time() - t
        return words
