# cache a full rolling transcription of a wav file (as the live listener would produce it)
import sys, json, time, logging, numpy as np, soundfile as sf
sys.path.insert(0, '/workspace/bucketpull-autopilot')
from bp_autopilot.transcriber import RollingTranscriber, SR
logging.basicConfig(level=logging.INFO, format='%(asctime)s %(message)s')
wav, out, prompt = sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else ""
rt = RollingTranscriber(prompt=prompt, threads=7)
f = sf.SoundFile(wav); words = []; t = 0.0; t_start = time.time(); blk = SR * 7
while True:
    d = f.read(blk, dtype='float32')
    if len(d) == 0: break
    words += rt.feed(d, t); t += len(d) / SR
    if int(t) % 600 < 7: print(f"{t/60:.0f} min audio, {time.time()-t_start:.0f}s wall, {len(words)} words", flush=True)
words += rt.flush()
json.dump([w.to_json() for w in words], open(out, 'w'))
print("done", len(words), "words in", round(time.time() - t_start), "s")
