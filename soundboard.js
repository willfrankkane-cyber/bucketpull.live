/* Bucket Pull LIVE: soundboard with swappable sounds.
   Playback uses HTMLAudioElement so it works from file:// (no fetch/XHR needed).
   Choices persist in localStorage; uploaded clips are stored in IndexedDB (fallback: localStorage data URL). */
(function(){
const LIB={
  'gunshots':      {name:'Gunshots',        label:'GUNSHOTS',         sub:'Bang bang bang',   em:'🔫', burst:'BANG BANG!',    fx:['💥','🔫','💨','😱'], cr:{t:'9mm pistol shot',by:'michorvath',u:'https://freesound.org/people/michorvath/sounds/427592/'}},
  'airhorn':       {name:'Airhorn',         label:'AIRHORN',          sub:'Stadium blast',    em:'📢', burst:'BWAAAMP!',      fx:['📢','🔊','🎉','🤯'], cr:{t:'DJ airhorn sound',by:'pfranzen',u:'https://freesound.org/people/pfranzen/sounds/528807/'}},
  'fanfare':       {name:'Triumphant horns',label:'TRIUMPHANT HORNS', sub:'Ta-ta-ta-TAAA',    em:'🎺', burst:'TA-DAAA!',      fx:['🎺','👑','🏆','✨'], cr:{t:'Success Fanfare Trumpets.mp3',by:'FunWithSound',u:'https://freesound.org/people/FunWithSound/sounds/456966/'}},
  'vader-breath':  {name:'Vader breath',    label:'VADER BREATH',     sub:'Heavy breathing',  em:'🫁', burst:'*kshhh-pahhh*', fx:['🖤','🌑','💨','⚫'], cr:{t:'Gas Mask breath',by:'Nuclearoid',u:'https://freesound.org/people/Nuclearoid/sounds/435825/'}},
  'rimshot':       {name:'Rimshot',         label:'RIMSHOT',          sub:'Ba-dum-tss',       em:'🥁', burst:'BA-DUM-TSS!',   fx:['🥁','😂','👏'], cr:{t:'Ba Dum Tss! (classic edition)',by:'DJczyszy',u:'https://freesound.org/people/DJczyszy/sounds/431811/'}},
  'crowd-ooh':     {name:'Crowd "ooooh"',   label:'CROWD OOOH',       sub:'Collective oooh',  em:'😮', burst:'OOOOOH!',       fx:['😮','😲','🙊'], cr:{t:'Crowd Oooh.wav',by:'deleted_user_2104797',u:'https://freesound.org/s/324890/'}},
  'sad-trombone':  {name:'Sad trombone',    label:'SAD TROMBONE',     sub:'Wah wah waaah',    em:'📯', burst:'WAH WAAAH…',    fx:['😢','💔','📉'], cr:{t:'wah wah sad trombone.wav',by:'kirbydx',u:'https://freesound.org/people/kirbydx/sounds/175409/'}},
  'record-scratch':{name:'Record scratch',  label:'RECORD SCRATCH',   sub:'Wait, what?',      em:'💿', burst:'SKRRRT!',       fx:['💿','⏪','🤨'], cr:{t:'Record Scratch #1',by:'musicvision31',u:'https://freesound.org/people/musicvision31/sounds/431774/'}},
  'applause':      {name:'Applause',        label:'APPLAUSE',         sub:'Give it up!',      em:'👏', burst:'CLAP CLAP!',    fx:['👏','🙌','🎉'], cr:{t:'Applause 3.aif',by:'lchapman1980',u:'https://freesound.org/people/lchapman1980/sounds/439894/'}},
  'bell-ding':     {name:'Bell ding',       label:'BELL DING',        sub:'Service bell',     em:'🔔', burst:'DING!',         fx:['🔔','✨','⭐'], cr:{t:'Service bell louder',by:'Squidems',u:'https://freesound.org/people/Squidems/sounds/709925/'}},
  'synth-airhorn': {name:'Synth airhorn',   label:'SYNTH AIRHORN',    sub:'Bwaaamp (synth)',  em:'🔊', burst:'BWAAAMP!',      fx:['🔊','📢','🎉']}
};
const DEFAULTS=['gunshots','airhorn','fanfare','vader-breath','rimshot','sad-trombone','crowd-ooh','record-scratch'];
const N=DEFAULTS.length;   // 8 buttons, keys 1-8
const COLORS=['#ff2d55','#7b4dff','#ff9f1c','#00b8d9','#14b86a','#ff4fd8','#e0a400','#4f6bff'];
const KEY='bp.soundboard.v1';
// Built-in sounds ship as base64 in sounds-data.js (text-only hosting); decode once to Blob URLs.
const _blobUrls={};
function src(id){if(_blobUrls[id])return _blobUrls[id];const d=(window.BP_SOUNDS||{})[id];if(!d)return '';
  const bin=atob(d),u8=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)u8[i]=bin.charCodeAt(i);
  return _blobUrls[id]=URL.createObjectURL(new Blob([u8],{type:'audio/mpeg'}))}

// ---------- storage ----------
let slots=load();
function load(){try{const s=JSON.parse(localStorage.getItem(KEY));if(Array.isArray(s)&&s.length>=1){const out=s.slice(0,N);for(let i=out.length;i<N;i++)out.push(defSlot(DEFAULTS[i]));return out}}catch(e){}return DEFAULTS.map(defSlot)}  // older saves had 4 buttons: keep them, add 5-8
function defSlot(id){return {sound:id,label:LIB[id].label,sub:LIB[id].sub}}
function persist(){try{localStorage.setItem(KEY,JSON.stringify(slots))}catch(e){console.warn('localStorage unavailable',e)}}
let dbP=null;
function db(){if(dbP)return dbP;dbP=new Promise((res,rej)=>{try{const r=indexedDB.open('bp-soundboard',1);r.onupgradeneeded=()=>r.result.createObjectStore('clips');r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)}catch(e){rej(e)}});return dbP}
async function putClip(k,blob){try{const d=await db();await new Promise((res,rej)=>{const tx=d.transaction('clips','readwrite');tx.objectStore('clips').put(blob,k);tx.oncomplete=res;tx.onerror=()=>rej(tx.error)});return 'idb'}
  catch(e){const url=await toDataURL(blob);try{localStorage.setItem(KEY+'.'+k,url);return 'ls'}catch(e2){return 'mem'}}}
async function getClip(k){try{const d=await db();const b=await new Promise((res,rej)=>{const r=d.transaction('clips').objectStore('clips').get(k);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)});if(b)return URL.createObjectURL(b)}catch(e){}
  return localStorage.getItem(KEY+'.'+k)}
async function delClip(k){try{const d=await db();d.transaction('clips','readwrite').objectStore('clips').delete(k)}catch(e){}try{localStorage.removeItem(KEY+'.'+k)}catch(e){}}
const toDataURL=b=>new Promise(r=>{const f=new FileReader();f.onload=()=>r(f.result);f.readAsDataURL(b)});

// ---------- playback ----------
const urls=new Array(N).fill(null);  // resolved src per slot
/* Volume: v2 key so an old muted/zero default does not stick. Explicit user choice on v2 is kept. */
const VOLKEY='bp.soundboard.v2.vol';
(function(){try{if(localStorage.getItem(VOLKEY)==null)localStorage.removeItem(KEY+'.vol')}catch(e){}})();
let vol=(()=>{try{const v=localStorage.getItem(VOLKEY);if(v!=null&&v!==''){const n=+v;if(isFinite(n))return Math.min(1,Math.max(0,n/100))}}catch(e){}return .8})();
async function resolve(i){const s=slots[i];urls[i]=s.sound==='upload'?(await getClip('slot'+i))||src(DEFAULTS[i]):src(s.sound);
  const pre=new Audio(urls[i]);pre.preload='auto'}
const live=new Set();
let audioUnlocked=false;
function unlockAudio(){if(audioUnlocked)return;audioUnlocked=true;
  try{const AC=window.AudioContext||window.webkitAudioContext;if(AC){const c=window.__bpAC||new AC();window.__bpAC=c;if(c.state==='suspended')c.resume()}}catch(e){}
  try{const a=new Audio();a.volume=0;const p=a.play();if(p&&p.catch)p.catch(()=>{})}catch(e){}}
function play(url,onEnd){unlockAudio();const a=new Audio(url);a.volume=vol;live.add(a);a.onended=()=>{live.delete(a);onEnd&&onEnd()};
  const p=a.play();if(p&&p.catch)p.catch(err=>{console.warn('play blocked',err);onEnd&&onEnd()});return a}

// ---------- render ----------
const sb=document.getElementById('sb');
function meta(i){const s=slots[i];const L=LIB[s.sound]||{em:'🎵',burst:'YEAH!',fx:['🎵','🎶','🔥']};return L}
function render(){sb.innerHTML=slots.map((s,i)=>{const L=meta(i);const long=s.label.length>11?' long':'';
  return `<div class="snd-wrap"><button class="snd${long}" style="--c:${COLORS[i]}" data-i="${i}" aria-label="Play ${esc(s.label)} (key ${i+1})">
  <span class="em">${L.em}</span><b>${esc(s.label)}</b><small>${esc(s.sub||'')}</small><span class="k">${i+1}</span><span class="eq"><i></i><i></i><i></i></span></button></div>`}).join('')}
const esc=t=>String(t).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

function trigger(i){unlockAudio();const b=sb.querySelector(`.snd[data-i="${i}"]`);if(!b)return;const L=meta(i);
  const r=b.getBoundingClientRect();window.burst&&burst(r.left+r.width/2,r.top+r.height/2,COLORS[i],L.fx,L.burst);
  b.classList.add('hit','playing');setTimeout(()=>b.classList.remove('hit'),120);
  play(urls[i]||src(DEFAULTS[i]),()=>{if(![...live].length)b.classList.remove('playing')});
  clearTimeout(b._t);b._t=setTimeout(()=>b.classList.remove('playing'),4000)}
sb.addEventListener('click',e=>{const b=e.target.closest('.snd');if(b)trigger(+b.dataset.i)});
let lastSlot=0;const setBtn=document.getElementById('sbSet');if(setBtn)setBtn.addEventListener('click',()=>openModal(lastSlot));
addEventListener('keydown',e=>{if(!modal.hidden){if(e.key==='Escape')closeModal();return}
  const t=document.activeElement.tagName;if(t==='INPUT'||t==='TEXTAREA'||e.metaKey||e.ctrlKey||e.altKey||e.repeat)return;
  const n=+e.key;if(n>=1&&n<=N){e.preventDefault();trigger(n-1)}});
const volEl=document.getElementById('vol');volEl.value=Math.round(vol*100);
document.getElementById('volIc').textContent=vol==0?'🔇':vol<.4?'🔈':'🔊';
volEl.addEventListener('input',()=>{vol=volEl.value/100;live.forEach(a=>a.volume=vol);document.getElementById('volIc').textContent=vol==0?'🔇':vol<.4?'🔈':'🔊';try{localStorage.setItem(VOLKEY,volEl.value)}catch(e){}});

// ---------- modal ----------
const modal=document.getElementById('modal');const $=id=>document.getElementById(id);
let cur=-1,draft=null,pendingFile=null,preview=null;
function stopPreview(){if(preview){preview.pause();preview=null}document.querySelectorAll('.lib .pv.on,.d-play.on').forEach(x=>x.classList.remove('on'))}
function renderSlots(){const el=$('mSlots');if(!el)return;el.innerHTML=slots.map((x,j)=>{const L=meta(j);return `<button type="button" class="ms${j===cur?' on':''}" data-i="${j}" style="--c:${COLORS[j]}" role="tab" aria-selected="${j===cur}" title="Button ${j+1}: ${esc(x.label)}"><span>${L.em}</span><b>${j+1}</b></button>`}).join('')}
function openModal(i){i=Math.max(0,Math.min(N-1,+i||0));cur=i;lastSlot=i;draft={...slots[i]};pendingFile=null;stopPreview();renderSlots();
  $('mSlot').textContent=`BUTTON ${i+1} · KEY ${i+1}`;$('mLabel').value=draft.label;$('mSub').value=draft.sub||'';
  $('mFile').value='';
  if(draft.sound==='upload'){$('mFileName').textContent=draft.fileName||'Your uploaded clip';$('mFileHint').textContent='Currently using your upload';$('mUpPlay').hidden=false;$('mDrop').classList.add('has')}
  else{$('mFileName').textContent='Drop an audio file or click to browse';$('mFileHint').textContent='Your clip stays on this device';$('mUpPlay').hidden=true;$('mDrop').classList.remove('has')}
  renderLib();renderPrev();if(modal.hidden){modal.hidden=false;requestAnimationFrame(()=>modal.classList.add('open'));setTimeout(()=>$('mLabel').focus({preventScroll:true}),50)}}
if($('mSlots'))$('mSlots').addEventListener('click',e=>{const b=e.target.closest('.ms');if(b&&+b.dataset.i!==cur)openModal(+b.dataset.i)});
function closeModal(){stopPreview();modal.classList.remove('open');setTimeout(()=>modal.hidden=true,180);cur=-1}
function renderPrev(){const L=draft.sound==='upload'?{em:'🎵'}:LIB[draft.sound];
  $('mPrev').style.setProperty('--c',COLORS[cur]);$('mPrev').innerHTML=`<span>${L.em}</span>`}
function renderLib(){$('mLib').innerHTML=Object.entries(LIB).map(([id,L])=>`<div class="li${draft.sound===id?' sel':''}${DEFAULTS.includes(id)?' def':''}" data-id="${id}" tabindex="0">
  <span class="li-em">${L.em}</span><span class="li-t"><b>${L.name}</b><small>${L.sub}</small>${L.cr?`<i class="li-by" title="“${L.cr.t}” by ${L.cr.by} · Freesound · CC0">Freesound · ${L.cr.by} · CC0</i>`:'<i class="li-by">Original synth</i>'}</span><button class="pv" data-id="${id}" aria-label="Preview ${L.name}">▶</button></div>`).join('')}
$('mLib').addEventListener('click',e=>{const pv=e.target.closest('.pv');if(pv){const on=pv.classList.contains('on');stopPreview();if(!on){pv.classList.add('on');preview=play(src(pv.dataset.id),()=>pv.classList.remove('on'))}return}
  const li=e.target.closest('.li');if(!li)return;const id=li.dataset.id;const wasDefaultLabel=!draft.label||Object.values(LIB).some(L=>L.label===draft.label)||draft.sound==='upload'&&draft.label===(draft.autoLabel||'');
  draft.sound=id;if(wasDefaultLabel){draft.label=LIB[id].label;$('mLabel').value=draft.label}if(!$('mSub').value||Object.values(LIB).some(L=>L.sub===$('mSub').value)){$('mSub').value=LIB[id].sub}
  pendingFile=null;$('mDrop').classList.remove('has');$('mUpPlay').hidden=true;$('mFileName').textContent='Drop an audio file or click to browse';$('mFileHint').textContent='Your clip stays on this device';
  renderLib();renderPrev()});
$('mLib').addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.classList.contains('li'))e.target.click()});
function takeFile(f){if(!f)return;const ok=/audio\//.test(f.type)||/\.(mp3|wav|m4a|aac)$/i.test(f.name);
  if(!ok){$('mFileHint').textContent='⚠ That doesn\u2019t look like an audio file';return}
  if(f.size>8*1024*1024){$('mFileHint').textContent='⚠ File is over 8 MB, try a shorter clip';return}
  pendingFile=f;draft.sound='upload';draft.fileName=f.name;$('mFileName').textContent=f.name;$('mFileHint').textContent=(f.size/1024).toFixed(0)+' KB · will be saved when you click Save';
  $('mDrop').classList.add('has');$('mUpPlay').hidden=false;
  const base=f.name.replace(/\.[^.]+$/,'').replace(/[_-]+/g,' ').toUpperCase().slice(0,18);draft.autoLabel=base;
  if(Object.values(LIB).some(L=>L.label===$('mLabel').value)||!$('mLabel').value){$('mLabel').value=base}
  if(Object.values(LIB).some(L=>L.sub===$('mSub').value)){$('mSub').value='Custom clip'}
  renderLib();renderPrev()}
$('mFile').addEventListener('change',e=>takeFile(e.target.files[0]));
const dz=$('mDrop');['dragenter','dragover'].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.add('drag')}));
['dragleave','drop'].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.remove('drag')}));
dz.addEventListener('drop',e=>takeFile(e.dataTransfer.files[0]));
$('mUpPlay').addEventListener('click',async e=>{e.preventDefault();e.stopPropagation();const on=e.currentTarget.classList.contains('on');stopPreview();if(on)return;
  const u=pendingFile?URL.createObjectURL(pendingFile):(await getClip('slot'+cur));if(!u)return;const el=e.currentTarget;el.classList.add('on');preview=play(u,()=>el.classList.remove('on'))});
$('mReset').addEventListener('click',()=>{draft=defSlot(DEFAULTS[cur]);pendingFile=null;$('mLabel').value=draft.label;$('mSub').value=draft.sub;$('mFile').value='';
  $('mDrop').classList.remove('has');$('mUpPlay').hidden=true;$('mFileName').textContent='Drop an audio file or click to browse';$('mFileHint').textContent='Reset. Click Save to apply';renderLib();renderPrev()});
$('mSave').addEventListener('click',async()=>{stopPreview();const i=cur;
  draft.label=($('mLabel').value.trim()||(draft.sound==='upload'?'MY SOUND':LIB[draft.sound].label)).toUpperCase();draft.sub=$('mSub').value.trim();
  if(draft.sound==='upload'&&pendingFile){const where=await putClip('slot'+i,pendingFile);if(where==='mem'){urls[i]=URL.createObjectURL(pendingFile)}}
  if(draft.sound!=='upload')delClip('slot'+i);
  const {autoLabel,...keep}=draft;slots[i]=keep;persist();render();
  if(!(draft.sound==='upload'&&pendingFile&&urls[i]&&urls[i].startsWith('blob:')&&!(await getClip('slot'+i))))await resolve(i);
  closeModal();setTimeout(()=>trigger(i),200)});
$('mCancel').addEventListener('click',closeModal);$('mClose').addEventListener('click',closeModal);
modal.addEventListener('mousedown',e=>{if(e.target===modal)closeModal()});
$('mLabel').addEventListener('input',e=>{e.target.value=e.target.value.toUpperCase()});

render();slots.forEach((_,i)=>resolve(i));
window.__openSwap=openModal;
// shared hook for other modules (golden ticket etc.)
window.bpSound={play:(id,opts={})=>{const a=play(src(id));if(opts.volume!=null)a.volume=Math.min(1,opts.volume);return a},url:src};
})();
