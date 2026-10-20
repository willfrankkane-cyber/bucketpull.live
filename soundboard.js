/* Bucket Pull LIVE: soundboard with swappable sounds.
   Playback uses HTMLAudioElement so it works from file:// (no fetch/XHR needed).
   Choices persist in localStorage; uploaded clips are stored in IndexedDB (fallback: localStorage data URL). */
(function(){
const LIB={
  'gunshots':      {name:'Gunshots',        label:'GUNSHOTS',         sub:'Pew pew pew',      em:'🔫', burst:'BANG BANG!',    fx:['💥','🔫','💨','😱']},
  'airhorn':       {name:'Airhorn',         label:'AIRHORN',          sub:'Stadium blast',    em:'📢', burst:'BWAAAMP!',      fx:['📢','🔊','🎉','🤯'], tag:'CC0 sample'},
  'fanfare':       {name:'Triumphant horns',label:'TRIUMPHANT HORNS', sub:'Ta-ta-ta-TAAA',    em:'🎺', burst:'TA-DAAA!',      fx:['🎺','👑','🏆','✨']},
  'vader-breath':  {name:'Vader breath',    label:'VADER BREATH',     sub:'Heavy breathing',  em:'🫁', burst:'*kshhh-pahhh*', fx:['🖤','🌑','💨','⚫']},
  'rimshot':       {name:'Rimshot',         label:'RIMSHOT',          sub:'Ba-dum-tss',       em:'🥁', burst:'BA-DUM-TSS!',   fx:['🥁','😂','👏']},
  'crowd-ooh':     {name:'Crowd "ooooh"',   label:'CROWD OOOH',       sub:'Collective gasp',  em:'😮', burst:'OOOOOH!',       fx:['😮','😲','🙊']},
  'sad-trombone':  {name:'Sad trombone',    label:'SAD TROMBONE',     sub:'Wah wah waaah',    em:'📯', burst:'WAH WAAAH…',    fx:['😢','💔','📉']},
  'record-scratch':{name:'Record scratch',  label:'RECORD SCRATCH',   sub:'Wait, what?',      em:'💿', burst:'SKRRRT!',       fx:['💿','⏪','🤨']},
  'applause':      {name:'Applause',        label:'APPLAUSE',         sub:'Give it up!',      em:'👏', burst:'CLAP CLAP!',    fx:['👏','🙌','🎉']},
  'bell-ding':     {name:'Bell ding',       label:'BELL DING',        sub:'Ding ding ding',   em:'🔔', burst:'DING!',         fx:['🔔','✨','⭐']},
  'synth-airhorn': {name:'Synth airhorn',   label:'SYNTH AIRHORN',    sub:'Bwaaamp (synth)',  em:'🔊', burst:'BWAAAMP!',      fx:['🔊','📢','🎉']}
};
const DEFAULTS=['gunshots','airhorn','fanfare','vader-breath'];
const COLORS=['#ff2d55','#7b4dff','#ff9f1c','#00b8d9'];
const KEY='bp.soundboard.v1';
// Built-in sounds ship as base64 in sounds-data.js (text-only hosting); decode once to Blob URLs.
const _blobUrls={};
function src(id){if(_blobUrls[id])return _blobUrls[id];const d=(window.BP_SOUNDS||{})[id];if(!d)return '';
  const bin=atob(d),u8=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)u8[i]=bin.charCodeAt(i);
  return _blobUrls[id]=URL.createObjectURL(new Blob([u8],{type:'audio/mpeg'}))}

// ---------- storage ----------
let slots=load();
function load(){try{const s=JSON.parse(localStorage.getItem(KEY));if(Array.isArray(s)&&s.length===4)return s}catch(e){}return DEFAULTS.map(defSlot)}
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
const urls=[null,null,null,null];  // resolved src per slot
let vol=+(localStorage.getItem(KEY+'.vol')||80)/100;
async function resolve(i){const s=slots[i];urls[i]=s.sound==='upload'?(await getClip('slot'+i))||src(DEFAULTS[i]):src(s.sound);
  const pre=new Audio(urls[i]);pre.preload='auto'}
const live=new Set();
function play(url,onEnd){const a=new Audio(url);a.volume=vol;live.add(a);a.onended=()=>{live.delete(a);onEnd&&onEnd()};a.play().catch(err=>{console.warn('play blocked',err);onEnd&&onEnd()});return a}

// ---------- render ----------
const sb=document.getElementById('sb');
function meta(i){const s=slots[i];const L=LIB[s.sound]||{em:'🎵',burst:'YEAH!',fx:['🎵','🎶','🔥']};return L}
function render(){sb.innerHTML=slots.map((s,i)=>{const L=meta(i);const long=s.label.length>11?' long':'';
  return `<div class="snd-wrap"><button class="snd${long}" style="--c:${COLORS[i]}" data-i="${i}" aria-label="Play ${esc(s.label)} (key ${i+1})">
  <span class="em">${L.em}</span><b>${esc(s.label)}</b><small>${esc(s.sub||'')}</small><span class="k">${i+1}</span><span class="eq"><i></i><i></i><i></i></span></button>
  <button class="swap" data-i="${i}" title="Swap sound" aria-label="Swap sound for button ${i+1}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg></button></div>`}).join('')}
const esc=t=>String(t).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

function trigger(i){const b=sb.querySelector(`.snd[data-i="${i}"]`);if(!b)return;const L=meta(i);
  const r=b.getBoundingClientRect();window.burst&&burst(r.left+r.width/2,r.top+r.height/2,COLORS[i],L.fx,L.burst);
  b.classList.add('hit','playing');setTimeout(()=>b.classList.remove('hit'),120);
  play(urls[i]||src(DEFAULTS[i]),()=>{if(![...live].length)b.classList.remove('playing')});
  clearTimeout(b._t);b._t=setTimeout(()=>b.classList.remove('playing'),4000)}
sb.addEventListener('click',e=>{const sw=e.target.closest('.swap');if(sw){openModal(+sw.dataset.i);return}const b=e.target.closest('.snd');if(b)trigger(+b.dataset.i)});
addEventListener('keydown',e=>{if(!modal.hidden){if(e.key==='Escape')closeModal();return}
  const t=document.activeElement.tagName;if(t==='INPUT'||t==='TEXTAREA'||e.metaKey||e.ctrlKey||e.altKey||e.repeat)return;
  const n=+e.key;if(n>=1&&n<=4){e.preventDefault();trigger(n-1)}});
const volEl=document.getElementById('vol');volEl.value=vol*100;
volEl.addEventListener('input',()=>{vol=volEl.value/100;live.forEach(a=>a.volume=vol);document.getElementById('volIc').textContent=vol==0?'🔇':vol<.4?'🔈':'🔊';localStorage.setItem(KEY+'.vol',volEl.value)});

// ---------- modal ----------
const modal=document.getElementById('modal');const $=id=>document.getElementById(id);
let cur=-1,draft=null,pendingFile=null,preview=null;
function stopPreview(){if(preview){preview.pause();preview=null}document.querySelectorAll('.lib .pv.on,.d-play.on').forEach(x=>x.classList.remove('on'))}
function openModal(i){cur=i;draft={...slots[i]};pendingFile=null;
  $('mSlot').textContent=`BUTTON ${i+1} · KEY ${i+1}`;$('mLabel').value=draft.label;$('mSub').value=draft.sub||'';
  $('mFile').value='';
  if(draft.sound==='upload'){$('mFileName').textContent=draft.fileName||'Your uploaded clip';$('mFileHint').textContent='Currently using your upload';$('mUpPlay').hidden=false;$('mDrop').classList.add('has')}
  else{$('mFileName').textContent='Drop an audio file or click to browse';$('mFileHint').textContent='Your clip stays on this device';$('mUpPlay').hidden=true;$('mDrop').classList.remove('has')}
  renderLib();renderPrev();modal.hidden=false;requestAnimationFrame(()=>modal.classList.add('open'));setTimeout(()=>$('mLabel').focus({preventScroll:true}),50)}
function closeModal(){stopPreview();modal.classList.remove('open');setTimeout(()=>modal.hidden=true,180);cur=-1}
function renderPrev(){const L=draft.sound==='upload'?{em:'🎵'}:LIB[draft.sound];
  $('mPrev').style.setProperty('--c',COLORS[cur]);$('mPrev').innerHTML=`<span>${L.em}</span>`}
function renderLib(){$('mLib').innerHTML=Object.entries(LIB).map(([id,L])=>`<div class="li${draft.sound===id?' sel':''}${DEFAULTS.includes(id)?' def':''}" data-id="${id}" tabindex="0">
  <span class="li-em">${L.em}</span><span class="li-t"><b>${L.name}</b><small>${L.sub}</small></span><button class="pv" data-id="${id}" aria-label="Preview ${L.name}">▶</button></div>`).join('')}
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
