/* "How red is Tony?" thermometer: fans set 0-100 per episode by tap, drag or arrow keys; the mercury is the room average.
   Text + emoji only (no photo or likeness). Works on its own in demo mode; realtime.js plugs in the shared vote via
   BPRed.onPick and paints the average with BPRed.set(). */
(function(){
'use strict';
const el=document.getElementById('redcard');if(!el)return;
const th=el.querySelector('.thermo'),merc=el.querySelector('.merc'),you=el.querySelector('.you'),
  avgEl=el.querySelector('.rc-avg'),wordEl=el.querySelector('.rc-word'),nEl=el.querySelector('.rc-n'),hint=el.querySelector('.rc-hint');
const LEVELS=[[0,'Pale','😐'],[20,'Blushing','😊'],[40,'Sunburnt','🥵'],[60,'Tomato','🍅'],[80,'Lobster','🦞']];
const word=v=>{let w=LEVELS[0];for(const l of LEVELS)if(v>=l[0])w=l;return w};
let S={avg:null,n:0,mine:null,enabled:true,why:''},drag=false,draft=null,demo=!window.BP_LIVE;
function horiz(){return th.offsetWidth>th.offsetHeight}
function paint(){const show=draft!=null?draft:S.avg!=null?+S.avg:null;
  merc.style.setProperty('--v',(show==null?0:Math.max(3,show))+'%');
  el.style.setProperty('--heat',show==null?0:show/100);
  const m=draft!=null?draft:S.mine;you.hidden=m==null;if(m!=null)you.style.setProperty('--v',m+'%');
  if(S.avg==null&&draft==null){avgEl.textContent='—';wordEl.textContent=S.enabled?'Be the first':'No votes';}
  else{const v=draft!=null?draft:Math.round(+S.avg),w=word(v);avgEl.textContent=v+'°';wordEl.textContent=w[2]+' '+w[1]}
  nEl.textContent=draft!=null?'your pick':(S.n?`${S.n.toLocaleString('en-US')} vote${S.n==1?'':'s'}`:'0 votes')+(S.mine!=null?` · you ${S.mine}°`:'');
  hint.textContent=S.enabled?(S.mine!=null?'Drag to change':'Tap or drag the tube'):(S.why||'Voting opens with the episode');
  th.setAttribute('aria-valuenow',m==null?(S.avg==null?0:Math.round(S.avg)):m);
  th.setAttribute('aria-valuetext',m==null?'not rated':`${m} degrees, ${word(m)[1]}`);
  th.setAttribute('aria-disabled',String(!S.enabled));el.classList.toggle('off',!S.enabled)}
function at(e){const r=th.getBoundingClientRect();
  const f=horiz()?(e.clientX-r.left)/r.width:(r.bottom-e.clientY)/r.height;return Math.max(0,Math.min(100,Math.round(f*100)))}
function commit(v){draft=null;S.mine=v;
  if(demo&&!S.voted){S.voted=true;S.n=(S.n||0)+1;S.avg=((S.avg||0)*(S.n-1)+v)/S.n}
  paint();el.classList.remove('pop');void el.offsetWidth;el.classList.add('pop');
  if(window.BPRed.onPick)window.BPRed.onPick(v)}
th.addEventListener('pointerdown',e=>{if(!S.enabled)return;drag=true;try{th.setPointerCapture(e.pointerId)}catch(x){}draft=at(e);paint();e.preventDefault()});
th.addEventListener('pointermove',e=>{if(!drag)return;draft=at(e);paint()});
const up=e=>{if(!drag)return;drag=false;const v=draft!=null?draft:at(e);commit(v)};
th.addEventListener('pointerup',up);th.addEventListener('pointercancel',()=>{drag=false;draft=null;paint()});
th.addEventListener('keydown',e=>{if(!S.enabled)return;const cur=S.mine!=null?S.mine:(S.avg!=null?Math.round(S.avg):50);let v=null;
  if(e.key==='ArrowUp'||e.key==='ArrowRight')v=cur+5;else if(e.key==='ArrowDown'||e.key==='ArrowLeft')v=cur-5;
  else if(e.key==='PageUp')v=cur+20;else if(e.key==='PageDown')v=cur-20;else if(e.key==='Home')v=0;else if(e.key==='End')v=100;
  if(v==null)return;e.preventDefault();commit(Math.max(0,Math.min(100,v)))});
window.BPRed={onPick:null,word:v=>word(v),
  set(o){if(drag)return;demo=false;Object.assign(S,o);paint()},
  get state(){return Object.assign({},S)}};
if(demo)S={avg:63,n:1204,mine:null,enabled:true,why:''};else S={avg:null,n:0,mine:null,enabled:false,why:'Connecting…'};
paint();
})();
