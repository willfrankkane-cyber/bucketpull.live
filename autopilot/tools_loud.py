import sys, numpy as np, soundfile as sf
sys.path.insert(0,'/workspace/bucketpull-autopilot')
from bp_autopilot.loudness import frame_features, SR, FRAME
f=sf.SoundFile(sys.argv[1]);n=int(FRAME*SR);rows=[];t=0
while True:
    x=f.read(n,dtype='float32')
    if len(x)<n:break
    rows.append((t,)+frame_features(x));t+=FRAME
np.save(sys.argv[2],np.array(rows,dtype=np.float32));print(len(rows))
