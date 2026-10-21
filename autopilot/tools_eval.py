"""Offline evaluation of the detector on a cached word stream + the episode audio (crowd meter)."""
import sys, json, logging, numpy as np, soundfile as sf
sys.path.insert(0, '/workspace/bucketpull-autopilot')
from bp_autopilot.detector import Detector
from bp_autopilot.loudness import CrowdMeter, SR
from bp_autopilot.transcriber import Word
logging.basicConfig(level=logging.INFO if '-v' in sys.argv else logging.WARNING, format='%(message)s')
src = sys.argv[1]
if src.endswith('.json3'):
    d = json.load(open(src)); words = []
    for e in d['events']:
        if 'segs' not in e: continue
        t0 = e['tStartMs'] / 1000
        for sg in e['segs']:
            w = sg.get('utf8', '').strip()
            if w and w != '\n': words.append(Word(t0 + sg.get('tOffsetMs', 0) / 1000, 0, ' ' + w, 1))
else:
    words = [Word(w['t'], w['e'], w['w'], w['p']) for w in json.load(open(src))]
roster = (["Yung Gravy", "Erik Griffin"] + ["Pat O'Neill", "Dedrick Flynn", "Martin Phillips", "D Madness", "Michael A. Gonzales", "Jon Deas", "Matthew Muehling", "Joe White", "Troy Conrad", "Monica Colt", "Steve Glass"]) if "--790" in sys.argv else ["Tim Butterly", "Kirk Fox", "Pat O'Neill", "Dedrick Flynn", "Martin Phillips", "D Madness", "Michael A. Gonzales", "Jon Deas",
          "Matthew Muehling", "Joe White", "Troy Conrad", "Monica Colt", "Steve Glass"]
cm = CrowdMeter()
det = Detector(roster=roster, panel=(["Yung Gravy", "Erik Griffin"] if "--790" in sys.argv else ["Tim Butterly", "Kirk Fox"]) + ["Tony Hinchcliffe", "Brian Redban"], crowd=cm)
f = sf.SoundFile(next((a.split('=',1)[1] for a in sys.argv if a.startswith('--wav=')), '/workspace/ktresearch/kt789.wav')); t = 0.0; i = 0; evs = []
while True:
    a = f.read(SR * 7, dtype='float32')
    if len(a) == 0: break
    cm.feed(a, t); t += len(a) / SR
    batch = []
    while i < len(words) and words[i].t < t - 7:   # words arrive ~one step behind the audio (like live)
        batch.append(words[i]); i += 1
    evs += det.feed(batch) + det.tick(t - 7)
evs += det.feed(words[i:]) + det.tick(t + 60)
hms = lambda s: f"{int(s)//3600}:{int(s)%3600//60:02d}:{int(s)%60:02d}"
for e in evs:
    print(hms(e['t']), e['kind'], e.get('name', ''), e.get('conf', ''), e.get('why', '') or e.get('evidence', ''), ('(re-stage)' if e.get('match') and not str(e.get('match')).startswith('local') else ''))
