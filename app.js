// marquee bulbs: evenly spaced on the centre line of the bulb lane, a bulb on every corner.
// Count and spacing come from the sign's real size and are recomputed by a ResizeObserver.
(function(){const lane=document.getElementById('bulbs');if(!lane)return;const sign=lane.parentElement;
  const TARGET=14;let key='';
  function layout(){const cs=getComputedStyle(sign);const band=parseFloat(cs.getPropertyValue('--band'))||16;
    const W=sign.clientWidth,H=sign.clientHeight;if(!W||!H)return;   // padding box (inside the border)
    const off=band/2,w=W-band,h=H-band;                            // rectangle through the lane centre
    // pick the bulb counts whose horizontal and vertical spacing match best (near TARGET)
    let nx=2,ny=1,best=1e9;for(let s=TARGET*.8;s<=TARGET*1.25;s+=.25){const ax=Math.max(2,Math.round(w/s)),ay=Math.max(1,Math.round(h/s));
      const sx=w/ax,sy=h/ay;const cost=Math.abs(sx-sy)*4+Math.abs((sx+sy)/2-TARGET);if(cost<best){best=cost;nx=ax;ny=ay}}
    const pts=[];for(let i=0;i<=nx;i++){const x=off+w*i/nx;pts.push([x,off],[x,off+h])}
    for(let j=1;j<ny;j++){const y=off+h*j/ny;pts.push([off,y],[off+w,y])}
    const k=pts.length;if(lane.childElementCount!==k){lane.textContent='';for(let i=0;i<k;i++)lane.appendChild(document.createElement('i'))}
    pts.forEach((p,i)=>{lane.children[i].style.transform=`translate(${p[0].toFixed(2)}px,${p[1].toFixed(2)}px)`});
    key=`${nx}x${ny}`;sign.dataset.bulbs=`${k} bulbs · ${nx}×${ny} gaps · ${(w/nx).toFixed(1)}/${(h/ny).toFixed(1)}px`}
  layout();if(document.fonts&&document.fonts.ready)document.fonts.ready.then(layout);
  if('ResizeObserver' in window)new ResizeObserver(layout).observe(sign);else addEventListener('resize',layout)})();

// LIVE = Supabase configured (config.js). Demo sample data, fake chat and fake counters only run in demo mode.
const LIVE=!!window.BP_LIVE;
// distribution
const dist=LIVE?[0,0,0,0,0,0,0,0,0,0]:[2,2,3,5,8,13,22,24,14,7];const dc=['#ff2d55','#ff3d5f','#ff5a4a','#ff7a33','#ff9f1c','#ffc23d','#ffd76a','#c6ff5a','#8cff5a','#5fe7a3'];
const de=document.getElementById('dist');const mx=Math.max(...dist);
dist.forEach((v,i)=>{const e=document.createElement('i');e.style.height=(mx?v/mx*100:0)+'%';e.style.setProperty('--c',dc[i]);de.appendChild(e)});

// rate buttons
const words=['','yikes','rough','meh','eh','okay','decent','good','solid set','great','legendary'];
const re=document.getElementById('rate');for(let i=1;i<=10;i++){const b=document.createElement('button');b.textContent=i;if(i===8&&!LIVE)b.className='on';
b.onclick=e=>{re.querySelectorAll('button').forEach(x=>x.classList.remove('on'));b.classList.add('on');document.getElementById('mine').textContent=i+' · '+words[i];burst(e.clientX,e.clientY,dc[i-1],i>=8?'🔥':i<=3?'💣':'👏',i>=8?'+'+i:'')};re.appendChild(b)}

// panel
const panel=[
 {i:'T',n:'Tony',r:'Host',g:'linear-gradient(135deg,#ffc23d,#ff6a00)',rc:'#ffc23d',s:4,a:'8.6',d:'+0.2'},
 {i:'R',n:'Redban',r:'Co-host · soundboard',g:'linear-gradient(135deg,#ff4fd8,#8b5cff)',rc:'#ff4fd8',s:5,a:'9.1',d:'+0.4'},
 {i:'MV',n:'Mo Vance',r:'Guest (fictional)',g:'linear-gradient(135deg,#22e4ff,#2b6bff)',rc:'#22e4ff',s:4,a:'7.8',d:'+0.1'},
 {i:'JO',n:'Jules Ortega',r:'Guest (fictional)',g:'linear-gradient(135deg,#b6ff3b,#14b86a)',rc:'#b6ff3b',s:3,a:'6.9',d:'-0.3'}];
if(!LIVE)document.getElementById('panel').innerHTML=panel.map((p,k)=>`<div class="pm"><div class="av" style="--g:${p.g};--rc:${p.rc}">${p.i}</div>
<div class="info"><b>${p.n}</b><small>${p.r}</small><div class="stars" data-k="${k}">${[1,2,3,4,5].map(j=>`<button class="${j<=p.s?'on':''}" data-v="${j}">★</button>`).join('')}</div></div>
<div class="avg">${p.a}<small><span class="d ${p.d[0]=='+'?'up':'down'}">${p.d[0]=='+'?'▲':'▼'} ${p.d.slice(1)}</span> live</small></div></div>`).join('');
document.querySelectorAll('.stars').forEach(s=>s.addEventListener('click',e=>{const v=+e.target.dataset.v;if(!v)return;s.querySelectorAll('button').forEach((b,j)=>b.classList.toggle('on',j<v));burst(e.clientX,e.clientY,'#ffc23d','⭐','')}));

// chat
const users=[['bucketboi_99','#ffc23d','og'],['LaughTrackLarry','#22e4ff',''],['mic_drop_maria','#ff4fd8','sub'],['TulsaTornado','#b6ff3b',''],['heckler_hank','#ff7a33',''],['ModSquad_Kai','#22e4ff','mod'],['goldenticketgal','#ffd76a','sub'],['NoNotesNate','#a78bff',''],['crowdwork.carl','#5fe7a3',''],['spotlight_sue','#ff6b88','og']];
const lines=['TULSA IN THE HOUSE 🌪️🌪️','that callback to the bucket 💀💀💀','kill kill kill 🔥','bro is SHAKING but it\'s working lol','Redban hit the button at the perfect time 😂','8 from me, the closer saved it','rating him a 9 purely for the shoes','minute goes by so fast 😭','PANEL IS COOKING tonight','who else voted KILL instantly 🙋','golden ticket energy fr 🎟️','the pause before the punchline 👌','ok that one bombed but I respect it 💣','first timers always the best','Tony\'s face lmaooo'];
const ms=document.getElementById('msgs');
function addMsg(u,t){const[n,c,b]=u;const d=document.createElement('div');d.className='m';d.style.setProperty('--hc',c);
d.innerHTML=`<div class="a">${n[0].toUpperCase()}</div><div>${b?`<span class="badge ${b}">${b.toUpperCase()}</span>`:''}<span class="u">${n}</span><span class="t">${t}</span></div>`;ms.appendChild(d);while(ms.children.length>16)ms.removeChild(ms.firstChild)}
const seed=[[0,0],[1,1],[2,2],[3,3],[5,'Reminder: KILL / BOMB buttons are under the comic card 👈'],[4,12],[6,10],[7,4],[8,9],[9,5],[2,6]];
if(!LIVE)seed.forEach(([u,l],i)=>{addMsg(users[u],typeof l=='number'?lines[l]:l);if(i===4){const s=document.createElement('div');s.className='m sys';s.innerHTML='<span>🪣 <b>Comic #4</b> pulled from the bucket</span>';ms.appendChild(s)}});
if(!LIVE)document.getElementById('send').onclick=()=>{const i=document.getElementById('ci');if(!i.value.trim())return;addMsg(['you','#ffffff','sub'],i.value);i.value=''};
document.getElementById('ci').addEventListener('keydown',e=>{if(e.key==='Enter')document.getElementById('send').click()});
if(!LIVE&&!/static/.test(location.hash)){
setInterval(()=>addMsg(users[Math.random()*users.length|0],lines[Math.random()*lines.length|0]),2600);
// viewers + timer
let v=48213;setInterval(()=>{v+=(Math.random()*90-30)|0;document.getElementById('vc').textContent=v.toLocaleString()},1500);
let t=47;setInterval(()=>{t=t<=0?60:t-1;document.getElementById('tm').textContent='0:'+String(t).padStart(2,'0')},1000);
// floaters
const fl=document.getElementById('floaters');const em=['🔥','😂','💀','👏','🪣','⭐'];
setInterval(()=>{const s=document.createElement('span');s.textContent=em[Math.random()*em.length|0];s.style.left=(Math.random()*30)+'px';s.style.animationDuration=(3+Math.random()*2)+'s';fl.appendChild(s);setTimeout(()=>s.remove(),5000)},700);
}

// countdown to next Monday 8pm CT
function nextPremiere(){const now=new Date();
 const fmt=new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',hour12:false,weekday:'short',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'});
 for(let h=1;h<24*8;h++){const c=new Date(Math.floor(now.getTime()/3.6e6)*3.6e6+h*3.6e6);const p=Object.fromEntries(fmt.formatToParts(c).map(x=>[x.type,x.value]));if(p.weekday==='Mon'&&p.hour==='20')return c}}
const target=nextPremiere();
function tick(){if(!target)return;let s=Math.max(0,(target-new Date())/1000|0);const d=s/86400|0;s%=86400;const h=s/3600|0;s%=3600;const m=s/60|0;s%=60;
 document.getElementById('cd').textContent=`${d}d ${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`}
tick();setInterval(tick,1000);

// bursts + beeps
let ac;function beep(f){try{ac=ac||new (window.AudioContext||window.webkitAudioContext)();const o=ac.createOscillator(),g=ac.createGain();o.type='square';o.frequency.setValueAtTime(f,ac.currentTime);o.frequency.exponentialRampToValueAtTime(f*1.5,ac.currentTime+.12);g.gain.setValueAtTime(.08,ac.currentTime);g.gain.exponentialRampToValueAtTime(.0001,ac.currentTime+.25);o.connect(g).connect(ac.destination);o.start();o.stop(ac.currentTime+.26)}catch(e){}}
function burst(x,y,c,emo,word){const b=document.createElement('div');b.className='burst';b.style.left=x+'px';b.style.top=y+'px';b.style.setProperty('--c',c);
 let h='<div class="ring"></div>';const set=Array.isArray(emo)?emo:[emo];for(let i=0;i<10;i++){const a=Math.PI*2*i/10+Math.random()*.4,r=60+Math.random()*50;h+=`<span style="--x:${Math.cos(a)*r}px;--y:${Math.sin(a)*r}px;--r:${(Math.random()*80-40)|0}deg">${set[i%set.length]}</span>`}
 if(word)h+=`<div class="word">${word}</div>`;b.innerHTML=h;document.body.appendChild(b);setTimeout(()=>b.remove(),1000)}
// KILL / BOMB emoji fountains (Web Animations API, pointer-events:none, works on touch)
const FOUNTAIN={kill:{set:['🔪','❤️','💖','🗡️','❤️','🔪','💘'],word:'KILL!',c:'#9dff3b'},bomb:{set:['💣','💀','😭','☠️','😢','💣','💀'],word:'BOMB!',c:'#ff2d55'}};
function fountain(btn,kind){const cfg=FOUNTAIN[kind];const r=btn.getBoundingClientRect();const cx=r.left+r.width/2,cy=r.top+r.height/2;
  const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;const n=reduce?8:22;
  const layer=document.createElement('div');layer.className='fountain';layer.style.left=cx+'px';layer.style.top=cy+'px';layer.style.setProperty('--c',cfg.c);document.body.appendChild(layer);
  const flash=document.createElement('div');flash.className='f-flash';layer.appendChild(flash);
  flash.animate([{transform:'translate(-50%,-50%) scale(.2)',opacity:.9},{transform:'translate(-50%,-50%) scale(2.6)',opacity:0}],{duration:520,easing:'cubic-bezier(.2,.8,.2,1)',fill:'forwards'});
  const w=document.createElement('div');w.className='f-word';w.textContent=cfg.word;layer.appendChild(w);
  w.animate([{transform:'translate(-50%,-50%) scale(.4) rotate(-8deg)',opacity:0},{transform:'translate(-50%,-150%) scale(1.25) rotate(-4deg)',opacity:1,offset:.2},{transform:'translate(-50%,-190%) scale(1.1) rotate(-2deg)',opacity:1,offset:.7},{transform:'translate(-50%,-230%) scale(1) rotate(0deg)',opacity:0}],{duration:1050,fill:'forwards'});
  for(let i=0;i<n;i++){const s=document.createElement('span');s.className='f-p';s.textContent=cfg.set[i%cfg.set.length];
    const size=18+Math.random()*26;s.style.fontSize=size+'px';layer.appendChild(s);
    const bias=Math.max(-30,Math.min(30,(innerWidth/2-cx)/innerWidth*90));const ang=(-90+bias+(Math.random()*140-70))*Math.PI/180;const v=140+Math.random()*190;const dx=Math.cos(ang)*v,peak=Math.sin(ang)*v;
    const fall=90+Math.random()*120;const rot=(Math.random()*720-360)|0;const sx=(Math.random()*r.width*.7-r.width*.35);
    const dur=850+Math.random()*350;
    const X=f=>sx+dx*f;
    s.animate([
      {transform:`translate(calc(-50% + ${sx}px),-50%) scale(.3) rotate(0deg)`,opacity:0,easing:'cubic-bezier(.2,.9,.3,1)'},
      {transform:`translate(calc(-50% + ${X(.2)}px),calc(-50% + ${peak*.55}px)) scale(1.15) rotate(${rot*.2}deg)`,opacity:1,offset:.14,easing:'cubic-bezier(.2,.7,.4,1)'},
      {transform:`translate(calc(-50% + ${X(.55)}px),calc(-50% + ${peak}px)) scale(1) rotate(${rot*.55}deg)`,opacity:1,offset:.5,easing:'cubic-bezier(.5,0,.8,.6)'},
      {transform:`translate(calc(-50% + ${X(.85)}px),calc(-50% + ${peak+fall*.6}px)) scale(.92) rotate(${rot*.85}deg)`,opacity:1,offset:.82,easing:'linear'},
      {transform:`translate(calc(-50% + ${X(1)}px),calc(-50% + ${peak+fall}px)) scale(.8) rotate(${rot}deg)`,opacity:0}
    ],{duration:dur,delay:Math.random()*90,fill:'forwards'});}
  btn.animate([{transform:'scale(1)'},{transform:'scale(.92)'},{transform:'scale(1.06)'},{transform:'scale(1)'}],{duration:320,easing:'ease-out'});
  if(navigator.vibrate)try{navigator.vibrate(18)}catch(e){}
  setTimeout(()=>layer.remove(),1400)}
document.querySelectorAll('.quick button').forEach(b=>b.addEventListener('click',()=>fountain(b,b.classList.contains('kill')?'kill':'bomb')));
