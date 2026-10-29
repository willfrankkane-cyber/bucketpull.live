/* Bucket Pull Live: shared live room on Supabase (supabase-js v2, vendored in /vendor).
   Runs only when config.js has SUPABASE_URL + SUPABASE_ANON_KEY (window.BP_LIVE). Otherwise the demo stays as is.

   Data flow (v3, built for ~200 viewers on the Supabase free tier)
   - No Realtime for fans: every browser polls ONE cheap RPC, live_poll(), every ~5 s (jittered, 30 s when the tab
     is hidden, backs off on errors). The server caches the aggregate scores (recomputed at most every 2 s) and
     only re-sends the "meta" block (episode, comics, regulars, panel, timeline) when it changed (meta_rev).
   - The same call is the viewer heartbeat; the "watching" count is clients seen in the last 75 s.
   - Fans sign in anonymously only when they first vote or bet (lurkers never touch Auth). Votes go through
     vote() (debounced, one upsert per fan per target). The fan's own picks load once via my_state().
   - Auto events (comic/regular on stage, golden ticket) are shown when the fan's own YouTube player reaches
     their offset; with no player, 5 s after they were written (the autopilot writes them 5 s early). */
(function(){
'use strict';
if(!window.BP_LIVE)return;
const CFG=window.BP_CONFIG, $=id=>document.getElementById(id), qs=s=>document.querySelector(s);
const LS={get(k,d){try{const v=localStorage.getItem(k);return v==null?d:JSON.parse(v)}catch(e){return d}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}},del(k){try{localStorage.removeItem(k)}catch(e){}}};
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=n=>Number(n||0).toLocaleString('en-US');
const WORDS=['','yikes','rough','meh','eh','okay','decent','good','solid set','great','legendary'];
const GRAD=[['#ffc23d','#b8860b'],['#7b3fe4','#4a55e8'],['#c9ccd6','#3a3fd0'],['#f2c94c','#8a6516'],['#f0263b','#8e0b1a'],['#8f63e8','#3a3fd0']];
const initials=n=>(String(n).trim().split(/\s+/).map(w=>w[0]).join('').slice(0,2)||'?').toUpperCase();
/* comic photos: only regulars + the golden ticket winner (never bucket pulls); initials when there is no photo */
const nrm=n=>String(n||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/['’`]/g,'').replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
const lev=(a,b)=>{if(a===b)return 0;const m=a.length,n=b.length;let p=Array.from({length:n+1},(_,j)=>j);for(let i=1;i<=m;i++){const c=[i];for(let j=1;j<=n;j++)c[j]=Math.min(p[j]+1,c[j-1]+1,p[j-1]+(a[i-1]===b[j-1]?0:1));p=c}return p[n]};
const nameMatch=(a,b)=>{a=nrm(a);b=nrm(b);if(!a||!b)return false;if(a===b||a.replace(/ /g,'')===b.replace(/ /g,''))return true;
  if(Math.min(a.length,b.length)>=6&&lev(a,b)<=2)return true;const ta=a.split(' '),tb=b.split(' ');
  return ta.length>1&&tb.length>1&&ta[ta.length-1]===tb[tb.length-1]&&lev(ta[0],tb[0])<=1};
const NOPHOTO=new Set(['brent reed']);   // wrong-person photos removed on purpose: always initials
let PANEL_PHOTOS=null;fetch('img/panel/photos.json?v=club3').then(r=>r.ok?r.json():{}).then(j=>{PANEL_PHOTOS=j||{};try{renderPanel()}catch(e){}}).catch(()=>{PANEL_PHOTOS={}});
let PHOTOS=null;fetch('img/comics/photos.json?v=club3').then(r=>r.ok?r.json():{}).then(j=>{PHOTOS=j||{};try{renderRegs()}catch(e){};try{render()}catch(e){}}).catch(()=>{PHOTOS={}});
const lookup=(M,n)=>{if(!M)return null;const k=nrm(n);if(!k||NOPHOTO.has(k))return null;if(M[k])return M[k];let best=null,bd=9;
  for(const key in M){if(nameMatch(k,key)){const d=lev(k,key);if(d<bd){bd=d;best=M[key]}}}return best};
const photoFor=n=>lookup(PHOTOS,n);
const imgTag=(p,i)=>`<img src="${esc(p.src)}" alt="" loading="lazy" decoding="async"${p.credit?` title="Photo: ${esc(p.credit)}${p.license?' · '+esc(p.license):''}"`:''} onerror="this.parentNode.textContent='${i}'">`;
const avInner=n=>{const p=photoFor(n),i=esc(initials(n));return p?imgTag(p,i):i};
/* panel photos: curated map first; for an unknown guest, one cached English Wikipedia lookup whose lead image must live on Commons */
const WIKI=LS.get('bp.wikiav',{}),wikiBusy=new Set();
const WIKI_OK=/comedian|comic|podcast|radio|television|tv |presenter|actor|actress|musician|rapper|singer|writer|host|personality|youtuber|martial|wrestler|fighter/i;
function wikiAvatar(n){const k=nrm(n);if(!k||k.split(' ').length<2||wikiBusy.has(k)||(k in WIKI&&Date.now()-(WIKI[k]&&WIKI[k].t||0)<7*864e5))return;wikiBusy.add(k);
  fetch('https://en.wikipedia.org/api/rest_v1/page/summary/'+encodeURIComponent(String(n).trim().replace(/\s+/g,'_')),{headers:{accept:'application/json'}}).then(r=>r.ok?r.json():null).then(j=>{
    let v={t:Date.now(),src:null};const th=j&&j.thumbnail&&j.thumbnail.source;
    if(j&&j.type==='standard'&&th&&/^https:\/\/(upload|thumb)\.wikimedia\.org\/wikipedia\/commons\//.test(th)&&WIKI_OK.test((j.description||'')+' '+(j.extract||'').slice(0,240))){
      const f=decodeURIComponent((j.originalimage&&j.originalimage.source||th).split('?')[0].split('/').pop()).replace(/^\d+px-/,'');
      v={t:Date.now(),src:th,credit:'Wikipedia / Wikimedia Commons (File:'+f+')',license:'see file page',url:'https://commons.wikimedia.org/wiki/File:'+encodeURIComponent(f)}}
    WIKI[k]=v;LS.set('bp.wikiav',WIKI);if(v.src)try{renderPanel()}catch(e){}}).catch(()=>{WIKI[k]={t:Date.now(),src:null}}).finally(()=>wikiBusy.delete(k))}
const panelPhoto=p=>{const hit=lookup(PANEL_PHOTOS,p.name)||(/^tony$/i.test(String(p.name).trim())&&PANEL_PHOTOS&&PANEL_PHOTOS['tony hinchcliffe'])||null;if(hit)return hit;
  if(PANEL_PHOTOS&&/guest/i.test(p.role||'')){const w=WIKI[nrm(p.name)];if(w&&w.src)return w;wikiAvatar(p.name)}return null};
const panelInner=p=>{const ph=panelPhoto(p),i=esc(initials(p.name));return ph?imgTag(ph,i):i};
/* rating icons: Tony mic, Redban sandwich, Pat O'Neill shirt, Dedrick Flynn gold grills; others ★ */
const SANDWICH_ICON='img/sandwich-icon.webp?v=club17';
const MIC_ICON='img/mic-icon.webp?v=club17';
const SHIRT_ICON='img/shirt-icon.webp?v=club17';
const GRILL_ICON='img/grill-icon.webp?v=club17';
const iconFor=p=>{const n=nrm(p&&p.name),r=String(p&&p.role||'').toLowerCase();
  if(/redban/.test(n)||(r==='co-host'&&!/tony/.test(n)))return '🥪';
  if(/^tony( hinchcliffe)?$/.test(n)||r==='host')return '🎤';
  if(/^(pat|patrick) oneill?$/.test(n))return '👕';
  /* Dedrick Flynn (regular). Bare "Dedrick" only — not Deric/Derrick/Poston. */
  if(/^dedrick flynn$/.test(n)||n==='dedrick')return '🦷';
  return '★'};
const iconKind=ic=>ic==='🎤'?'mic':ic==='🥪'?'sandwich':ic==='👕'?'shirt':ic==='🦷'?'grill':'star';
const iconCls=ic=>ic==='🎤'?' mic':ic==='🥪'?' sw':ic==='👕'?' shirt':ic==='🦷'?' grill':'';
const iconMarkup=ic=>ic==='🥪'?`<img class="ico-sw" src="${SANDWICH_ICON}" alt="" width="32" height="32" draggable="false">`:ic==='🎤'?`<img class="ico-mic" src="${MIC_ICON}" alt="" width="32" height="32" draggable="false">`:ic==='👕'?`<img class="ico-shirt" src="${SHIRT_ICON}" alt="" width="32" height="32" draggable="false">`:ic==='🦷'?`<img class="ico-grill" src="${GRILL_ICON}" alt="" width="32" height="32" draggable="false">`:ic;
const HOLD=5000;          // ms an auto event waits (no player) before it shows; the autopilot writes events 5 s early

/* ---------- live-mode styling + copy (sample data goes away) ---------- */
const css=document.createElement('style');css.textContent=`
.quick button.picked{outline-offset:2px}
.rate button:disabled,.quick button:disabled{opacity:.45;cursor:not-allowed}
.lb .empty,.panel-list .empty{padding:14px 10px;color:var(--dim);font-size:12.5px;text-align:center}
.bp-toast{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:120;background:rgba(20,15,28,.95);border:1px solid rgba(255,255,255,.18);color:#fff;
  padding:9px 14px;border-radius:12px;font-size:13px;font-weight:600;box-shadow:0 10px 30px rgba(0,0,0,.5);transition:opacity .3s}
.player .yt-embed{position:absolute;inset:0;z-index:3;background:#000}
.player .yt-embed iframe{width:100%;height:100%;border:0;display:block}
.player.has-yt .play,.player.has-yt .mic,.player.has-yt .bar,.player.has-yt .yt-top{display:none}
.player.has-yt{aspect-ratio:auto;overflow:visible;display:flex;flex-direction:column;gap:0;background:transparent;border-color:transparent;box-shadow:none}
.player.has-yt .curtain,.player.has-yt .spot{display:none}
.player.has-yt .yt-stage{position:relative;width:100%;aspect-ratio:16/9;border-radius:var(--r);overflow:hidden;border:1px solid rgba(240,193,75,.28);
  box-shadow:0 0 0 1px #000,0 24px 50px -20px #000,0 -30px 80px -40px rgba(255,236,196,.35);background:#000}
.player.has-yt .yt-embed{position:absolute;inset:0;z-index:1;border-radius:inherit}
.player.has-yt .yt-unmute{z-index:5}
.player .yt-ctl{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:8px;padding:8px 10px;border-radius:12px;
  background:rgba(12,10,16,.92);border:1px solid rgba(240,193,75,.28);box-shadow:0 8px 24px rgba(0,0,0,.45)}
.player .yt-ctl button{height:32px;min-width:36px;padding:0 10px;border-radius:9px;border:1px solid rgba(255,255,255,.12);
  background:rgba(255,255,255,.06);color:#fff;font:800 13px var(--body);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:4px}
.player .yt-ctl button:hover{background:rgba(240,193,75,.14);border-color:rgba(240,193,75,.45)}
.player .yt-ctl button:focus-visible{outline:2px solid var(--gold);outline-offset:2px}
.player .yt-ctl .yt-vol{width:88px;accent-color:var(--gold);cursor:pointer}
.player .yt-ctl .yt-seek{flex:1;min-width:140px;display:flex;align-items:center;gap:6px}
.player .yt-ctl .yt-seek[hidden]{display:none!important}
.player .yt-ctl .yt-scrub{flex:1;min-width:80px;accent-color:var(--gold);cursor:pointer;touch-action:none;-webkit-user-select:auto;user-select:auto}
.player .yt-ctl .yt-time{font:700 11.5px/1 var(--body);color:var(--mute);font-variant-numeric:tabular-nums;white-space:nowrap}
.player .yt-ctl .yt-live{display:none;align-items:center;gap:6px;margin-left:4px;font:800 11px/1 var(--body);letter-spacing:.06em;color:#ff5a6a}
.player .yt-ctl .yt-live.on{display:inline-flex}
.player .yt-ctl .yt-live .dot{width:7px;height:7px;border-radius:50%;background:#ff3b4e;box-shadow:0 0 8px #ff3b4e;animation:pulse 1.2s ease-in-out infinite}
.player .yt-ctl .yt-fs{margin-left:auto}
.player .yt-ctl .yt-skip{min-width:40px;font-variant-numeric:tabular-nums;letter-spacing:-.02em}
@media (max-width:640px){.player .yt-ctl{gap:6px;padding:7px 8px}.player .yt-ctl .yt-vol{width:64px}.player .yt-ctl .yt-time{font-size:10.5px}.player .yt-ctl .yt-skip{min-width:36px;padding:0 6px}}
.host.live-host{width:300px;max-height:calc(100vh - 32px);overflow:auto}

.host .h-row{display:flex;gap:6px}.host .h-row>*{flex:1;min-width:0}
.host select,.host .h-fld input[type=datetime-local]{height:34px;border-radius:9px;background:rgba(255,255,255,.07);border:1px solid var(--line);color:var(--ink);padding:0 8px;font:600 12.5px var(--body)}
.host .h-sec{font-size:10.5px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--gold);margin-top:6px}
.host .h-btn.ok{background:rgba(242,201,76,.12);border-color:rgba(242,201,76,.35);color:#e6ffc4}
.host .h-list{display:flex;flex-direction:column;gap:3px;font-size:12px}
.host .h-list div{display:flex;justify-content:space-between;align-items:center;background:rgba(255,255,255,.04);border-radius:8px;padding:3px 8px}
.host .h-err{color:#ff9db0;font-size:11.5px;min-height:14px}
.lb li.empty{display:block;font-size:12.5px;color:var(--mute);text-align:center;padding:14px 10px;line-height:1.4}
.player .yt-embed>div{width:100%;height:100%}
.host .h-ap{background:rgba(255,255,255,.04);border:1px solid var(--line);border-radius:10px;padding:7px 9px;font-size:11.5px;line-height:1.45;color:var(--mute)}
.host .h-ap b{color:#fff}.host .h-ap .snip{display:block;margin-top:4px;color:var(--dim);font-style:italic;max-height:48px;overflow:hidden}
.host .ap-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:5px;background:#777;vertical-align:middle}
.host .ap-dot.ok{background:#5fe7a3;box-shadow:0 0 8px #5fe7a3}.host .ap-dot.warn{background:#ffc23d}.host .ap-dot.bad{background:#ff4f6d}
.host .h-sync span{align-self:center;font-size:12px;opacity:.7;padding:0 4px}.h-tg{display:flex;gap:4px}.host .h-tg button{flex:1;height:28px;border-radius:8px;font-size:11px;font-weight:800;background:rgba(255,255,255,.06);border:1px solid var(--line);color:var(--mute)}
.host .h-tg button.on{background:rgba(95,231,163,.16);border-color:rgba(95,231,163,.5);color:#d8ffe9}
.host .h-list .cm{gap:4px}.host .h-list .cm span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.host .h-list .cm button{background:none;border:0;color:#fff;font-size:12px;padding:0 3px;cursor:pointer}
.host .tag-auto{font-size:9.5px;font-weight:800;color:#c9ccd6;margin-left:4px}.host .tag-lock{font-size:9.5px;margin-left:3px}
.host .cm.now{outline:1px solid rgba(255,194,61,.5)}
.host .tag-reg{font-size:9.5px;font-weight:800;color:var(--gold);margin-left:4px}
.host .h-row select{flex:none;width:96px}
.chip.live.final{background:linear-gradient(180deg,#ffc23d,#e8a317);color:#1a1205}.chip.live.final .dot{background:#1a1205;box-shadow:none;animation:none}
.lb.final li{cursor:pointer}.lb.final li.sel{outline:1px solid rgba(255,194,61,.55);background:rgba(255,194,61,.08)}
.lb .kbs{display:inline-block;margin-left:6px;font-weight:700;color:var(--mute)}.lb .kbs b{color:#f2c94c;font-weight:800}.lb .kbs em{font-style:normal;color:#ff6d8a;font-weight:800}
.onstage .pill.final,.lbcard .pill.final,#regPill.final{background:rgba(255,194,61,.16);color:#ffd66e;border-color:rgba(255,194,61,.45)}
.lastwk{font:800 11px var(--body);letter-spacing:.02em;color:#ffd66e;background:rgba(255,194,61,.1);border:1px solid rgba(255,194,61,.4);border-radius:999px;padding:4px 9px;cursor:pointer;white-space:nowrap}
.lbcard .card-h{gap:6px}.lbcard .card-h .lastwk{margin-left:auto}
.bp-res{position:fixed;inset:0;z-index:130;background:rgba(4,4,6,.78);display:flex;align-items:flex-start;justify-content:center;padding:4vh 12px;overflow:auto}
.bp-res .box{width:min(560px,100%);background:#0f0f12;border:1px solid rgba(255,255,255,.14);border-radius:18px;padding:18px 18px 14px;box-shadow:0 20px 60px rgba(0,0,0,.6)}
.bp-res h2{margin:0 0 2px;font:400 24px var(--display);letter-spacing:.03em;color:#fff}.bp-res .sub{color:var(--mute);font-size:12.5px;margin-bottom:12px}
.bp-res h4{margin:14px 0 6px;font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--gold)}
.bp-res .row{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:9px;background:rgba(255,255,255,.04);margin-bottom:4px;font-size:13px}
.bp-res .row .n{flex:1;min-width:0}.bp-res .row .n small{display:block;color:var(--dim);font-size:11px}.bp-res .row .a{font-weight:800;font-size:15px}
.bp-res .gt{padding:8px 10px;border-radius:10px;background:rgba(255,194,61,.1);border:1px solid rgba(255,194,61,.35);font-size:13px}
.bp-res .x{float:right;background:none;border:0;color:#fff;font-size:22px;cursor:pointer;line-height:1}
.bp-res a{color:#ffd66e}
.chip.live.replay{background:linear-gradient(180deg,#4a55e8,#5b3cff);color:#fff}.chip.live.replay .dot{background:#fff;box-shadow:none;animation:none}
.bp-livebar{display:flex;align-items:center;justify-content:center;gap:10px;flex-wrap:wrap;margin:0 0 12px;padding:9px 14px;border-radius:14px;background:linear-gradient(90deg,rgba(224,24,45,.22),rgba(224,24,45,.08));border:1px solid rgba(224,24,45,.5);font-size:13.5px;font-weight:700}
.bp-livebar button,.bp-livebar a{background:#e0182d;color:#fff;border-radius:999px;padding:6px 13px;font-weight:800;font-size:12.5px;text-decoration:none}
.bp-livebar.back{background:linear-gradient(90deg,rgba(74,85,232,.2),rgba(74,85,232,.06));border-color:rgba(74,85,232,.45)}.bp-livebar.back button{background:#4a55e8}
.bp-res .paste{display:flex;gap:8px;margin:4px 0 6px}.bp-res .paste input{flex:1;min-width:0;height:42px;border-radius:11px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.18);color:#fff;padding:0 12px;font:600 14px var(--body);outline:0}
.bp-res .paste input:focus{border-color:#ffd66e}.bp-res .paste button{flex:none;height:42px;padding:0 16px;border-radius:11px;background:linear-gradient(180deg,#ffc23d,#e8a317);color:#1a1205;font-weight:800}
.bp-res .pmsg{min-height:18px;font-size:12.5px;color:var(--mute);line-height:1.45}.bp-res .pmsg.ok{color:#f2c94c}.bp-res .pmsg.warn{color:#ffd66e}.bp-res .pmsg.bad{color:#ff9db0}
.bp-res .pmsg .spin{display:inline-block;width:11px;height:11px;border:2px solid #ffd66e;border-right-color:transparent;border-radius:50%;animation:bpspin .8s linear infinite;vertical-align:-1px;margin-right:6px}
@keyframes bpspin{to{transform:rotate(360deg)}}
.bp-res .arow{display:grid;grid-template-columns:64px minmax(0,1fr) auto;gap:10px;align-items:center;padding:9px 10px;border-radius:12px;background:rgba(255,255,255,.04);margin-bottom:6px;cursor:pointer;border:1px solid transparent;text-align:left;width:100%;color:#fff}
.bp-res .arow:hover,.bp-res .arow.cur{border-color:rgba(255,194,61,.45);background:rgba(255,194,61,.07)}
.bp-res .arow .no{font:400 20px var(--display);color:#ffd66e;text-align:center}.bp-res .arow .t{font-size:13px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bp-res .arow .t small{display:block;font-weight:500;color:var(--dim);font-size:11px;white-space:normal}.bp-res .arow .rd{text-align:right;font-size:12px;font-weight:800;color:#ffd3da;white-space:nowrap}
.bp-res .arow .rd small{display:block;color:var(--dim);font-weight:600;font-size:10.5px}.bp-res .arow .lv{color:#e0182d;font-weight:800}
.lb.final li .seek{font-size:10.5px;color:#ffd66e;font-weight:700;margin-left:6px}
.pm.reg.seekable{cursor:pointer}`;
document.head.appendChild(css);

const epEl=qs('.ep');if(epEl)epEl.innerHTML='<strong>Connecting…</strong>Live fan room';
const foot=qs('.foot');if(foot&&foot.firstChild&&foot.firstChild.nodeType===3)foot.firstChild.textContent='Unofficial fan-made live room · not affiliated with or endorsed by the show · votes and counts are from real fans in the room';
const vc=$('vc');if(vc)vc.textContent='—';
const fl=$('floaters');if(fl)fl.innerHTML='';

let toastT;function toast(t){let e=qs('.bp-toast');if(!e){e=document.createElement('div');e.className='bp-toast';document.body.appendChild(e)}
  e.textContent=t;e.style.opacity=1;clearTimeout(toastT);toastT=setTimeout(()=>e.style.opacity=0,2800)}

/* ---------- load supabase-js only in live mode ---------- */
function loadLib(){return new Promise((ok,ko)=>{if(window.supabase&&window.supabase.createClient)return ok();
  const s=document.createElement('script');s.src='vendor/supabase-js-2.118.0.js';s.onload=ok;s.onerror=()=>ko(new Error('could not load supabase-js'));document.head.appendChild(s)})}

let finalSel=null,stageH=null;
const FINAL=()=>!!(ST&&ST.episode&&ST.episode.status==='ended');
let sb,me=null,ST=null,EPID=null,MV=-1,META=null,SCORES=null,MINE=null,BO=false,viewers=0,serverSkew=0,localGTUntil=0,lastFetch=0;
const DIST={};            // last distribution seen per comic (the poll only carries the 3 most recent)
/* ?ep=791 (or an episode id) opens that episode as a replay; null = whatever is live / latest */
let WANT=(()=>{const v=new URLSearchParams(location.search).get('ep');return v&&/^(\d{1,6}|[0-9a-f-]{36})$/i.test(v.trim())?v.trim():null})(),LIVEOTHER=null,finalAt=0;
const CID=(()=>{let c=LS.get('bp.cid',null);if(!c||c.length<8){c='c'+Math.random().toString(36).slice(2,12)+Date.now().toString(36);LS.set('bp.cid',c)}return c})();
const host={on:LS.get('bp.host',false),secret:LS.get('bp.host.secret',null),ok:false};
const pending={bet:0};
const hist=[];          // [{t,comic,avg}] for the "last 30s" delta
let ytPlayer=null,ytApiState='none',effCur=undefined,visSig='',apStatus=null;
const firedGT=new Set(LS.get('bp.gt.fired',[]));

async function boot(){
  try{await loadLib()}catch(e){epEl&&(epEl.innerHTML='<strong>Offline</strong>Could not load the live room');toast('Live room unavailable right now');return}
  sb=window.supabase.createClient(CFG.SUPABASE_URL,CFG.SUPABASE_ANON_KEY,{auth:{persistSession:true,autoRefreshToken:true,storageKey:'bp.auth'}});
  try{const {data:{session}}=await sb.auth.getSession();me=session&&session.user?session.user:null}catch(e){me=null}
  wireInputs();
  if(host.on)mountHost();
  await poll();
  setInterval(tickClock,1000);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&Date.now()-lastFetch>2500)schedule(0)});
}

/* ---------- sign in only when needed (first vote / bet) ---------- */
let signing=null;
async function ensureSession(){if(me)return true;
  if(!signing)signing=(async()=>{const r=await sb.auth.signInAnonymously();
    if(r.error){console.warn('anonymous sign-in failed',r.error);toast(/rate limit/i.test(r.error.message)?'Too many sign-ins from this network right now; try again in a bit':'Could not sign in: '+r.error.message);return false}
    me=r.data.session&&r.data.session.user;return !!me})().finally(()=>{signing=null});
  const ok=await signing;if(ok&&EPID&&!MINE)loadMine();return ok}

/* ---------- polling ---------- */
let pollT=null,pollAt=0,inflight=false,failN=0;
function schedule(ms){clearTimeout(pollT);pollAt=Date.now()+ms;pollT=setTimeout(poll,ms)}
function soon(ms){if(!pollT||pollAt-Date.now()>ms)schedule(ms)}
/* final results poll slowly (60 s), except around the Monday premiere (7 PM to 2 AM CT) so the switch to the new episode is quick */
const chiWH=new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',hour12:false,weekday:'short',hour:'2-digit'});
function premiereWindow(){const p=Object.fromEntries(chiWH.formatToParts(new Date()).map(x=>[x.type,x.value]));const h=+p.hour%24;
  return (p.weekday==='Mon'&&h>=19)||(p.weekday==='Tue'&&h<2)}
function nextDelay(){const vis=document.visibilityState!=='hidden';const live=ST&&ST.episode&&ST.episode.status==='live';
  const fin=FINAL();const base=!vis?(fin?120000:30000):live?5000:fin?(premiereWindow()?15000:60000):15000;return base*(0.75+Math.random()*0.5)*Math.pow(2,Math.min(failN,3))}
async function poll(){if(inflight){soon(1500);return}inflight=true;lastFetch=Date.now();clearTimeout(pollT);pollT=null;
  try{const {data,error}=await sb.rpc('live_poll',WANT?{p_known_ep:EPID,p_meta:MV,p_client:CID,p_want:WANT}:{p_known_ep:EPID,p_meta:MV,p_client:CID});if(error)throw error;failN=0;applyPoll(data)}
  catch(e){failN++;console.warn('live_poll',e&&e.message||e);if(!ST&&failN===1)toast('Could not reach the live room, retrying…')}
  finally{inflight=false;schedule(nextDelay())}}
async function loadMine(){const ep=EPID;if(!me||!ep)return;const {data,error}=await sb.rpc('my_state',{p_episode:ep});
  if(error||ep!==EPID)return;MINE=Object.assign({votes:{},kb:{},panel:{},bet:null},data||{});
  // keep picks made while my_state was in flight
  build();render()}

function applyPoll(d){
  if(d&&d.t)serverSkew=new Date(d.t).getTime()-Date.now();
  viewers=+d.v||0;paintViewers();
  if(d&&WANT&&d.want==='missing'){const w=WANT;WANT=null;setUrl(null);toast(/^\d+$/.test(w)?`Episode #${w} isn't in the room yet: paste its YouTube link in the archive`:'That episode link is not available');
    if(/^\d+$/.test(w)&&+w>=791)setTimeout(()=>openArchive(w),400)}
  LIVEOTHER=d&&d.live||null;paintLiveBar();
  if(!d||!d.ep){const was=EPID;EPID=null;MV=-1;META=null;SCORES=null;ST=null;if(was!==null||!renderNoEpisode.done){renderNoEpisode();renderNoEpisode.done=true}if(host.ok)renderHostState();return}
  renderNoEpisode.done=false;
  const changedEp=d.ep!==EPID;
  if(changedEp&&!d.meta){MV=-1;EPID=d.ep;soon(200);return}
  if(d.meta){META=d.meta;MV=d.mv}
  SCORES=d.s||SCORES;BO=!!d.bo;
  if(SCORES&&SCORES.d)for(const k in SCORES.d)DIST[k]=SCORES.d[k];
  if(changedEp){EPID=d.ep;MINE=me?null:{votes:{},kb:{},panel:{},bet:null};effCur=undefined;finalSel=null;hist.length=0;if(me)loadMine()}
  build();
  if(changedEp){// events already in the past when we join never replay the takeover
    for(const e of ST.events||[])if(e.kind==='golden_ticket'&&now()-new Date(e.at).getTime()>60000+HOLD)firedGT.add(e.id)}
  render();timelineTick();paintLiveBar();
  if(host.ok)renderHostState();
  if(window.BPLive&&BPLive.renderTicker)try{BPLive.renderTicker()}catch(e){}}

function build(){if(!META){ST=null;return}
  const s=SCORES||{c:{},d:{},p:{},b:[0,0]},c=s.c||{},p=s.p||{};
  ST={episode:Object.assign({},META.episode,{betting_is_open:BO}),events:META.events||[],
    comics:(META.comics||[]).map(x=>{const v=c[x.id]||[0,null,0,0];return Object.assign({},x,{votes:v[0],avg:v[1],kills:v[2],bombs:v[3],dist:DIST[x.id]||null})}),
    panel:(META.panel||[]).map(x=>{const v=p[x.id]||[0,null];return Object.assign({},x,{votes:v[0],avg:v[1]})}),
    bet:{yes:(s.b||[0,0])[0],no:(s.b||[0,0])[1]},red:s.r||[0,null],me:MINE}}

function now(){return Date.now()+serverSkew}
/* where is this fan's YouTube player? null = unknown (no player / not playing) */
function playerOffset(){try{if(!ytPlayer||typeof ytPlayer.getPlayerState!=='function')return null;const st=ytPlayer.getPlayerState();
  if(st!==1&&st!==2&&st!==3)return null;const t=ytPlayer.getCurrentTime();return t>0&&t<6*3600?t:null}catch(e){return null}}
function evVisible(e,po){if(e.source!=='auto'||FINAL())return true;   // final results: everything is public
  if(e.offset!=null&&po!==undefined&&po!==null)return e.offset<=po;return now()>=new Date(e.at).getTime()+HOLD}
function synced(){return playerOffset()!=null&&(ST&&ST.events||[]).some(e=>e.source==='auto'&&e.offset!=null)}
function comicEvents(){return (ST&&ST.events||[]).filter(e=>e.kind==='comic'&&!e.cancelled)}
function lastComicEvent(){const po=playerOffset();let best=null;for(const e of comicEvents()){if(!evVisible(e,po))continue;if(!best||e.id>best.id)best=e}return best}
function effectiveComicId(){if(!ST)return null;const ep=ST.episode,evs=comicEvents();if(!evs.length)return ep.current_comic_id;
  const e=lastComicEvent();if(!e)return null;const newest=evs[evs.length-1];
  // once this fan has caught up, the DB's current comic is the truth (host overrides without events, undo …)
  return e.id===newest.id?ep.current_comic_id:e.comic_id}
function visibleComicIds(){const po=playerOffset(),vis=new Set(),seen=new Set();
  for(const e of comicEvents()){if(!e.comic_id)continue;seen.add(e.comic_id);if(evVisible(e,po))vis.add(e.comic_id)}
  for(const c of ST.comics||[])if(c.source!=='auto'||!seen.has(c.id))vis.add(c.id);return vis}
function curComic(){if(!ST)return null;if(FINAL())return finalComic();const id=effectiveComicId();return (ST.comics||[]).find(c=>c.id===id)||null}
function timelineTick(){if(!ST)return;const id=FINAL()?(finalComic()||{}).id||null:effectiveComicId();const sig=[...visibleComicIds()].join(',')+'|gt'+(gtIsReached()?1:0);
  if(id!==effCur||sig!==visSig){const first=effCur===undefined;effCur=id;visSig=sig;if(!first)render()}
  const po=playerOffset();
  for(const e of ST.events||[]){if(e.kind!=='golden_ticket'||e.cancelled||firedGT.has(e.id))continue;
    if(!ST.episode.golden_ticket_at)continue;
    if(FINAL()){firedGT.add(e.id);continue}   // final results: no takeover replay, the bet card + ticker show the winner
    const at=new Date(e.at).getTime();let fire=false;
    if(e.source==='host'||e.offset==null){fire=now()-at<60000}
    else if(po!=null){if(po<e.offset)continue;fire=po-e.offset<90}
    else{if(now()<at+HOLD)continue;fire=now()-at<60000+HOLD}
    firedGT.add(e.id);LS.set('bp.gt.fired',[...firedGT].slice(-20));
    if(fire&&Date.now()>=localGTUntil)window.triggerGoldenTicket&&window.triggerGoldenTicket((e.data&&e.data.name)||ST.episode.golden_ticket_name||'');
    renderBetState()}}

function paintViewers(){if(vc)vc.textContent=fmt(viewers);const s=qs('.yt-top small');if(s)s.textContent=`Unofficial fan room · ${fmt(viewers)} watching`}

function renderNoEpisode(){renderChrome(false);epEl&&(epEl.innerHTML='<strong>No live episode yet</strong>The room opens when the host starts one');
  setComic(null);const lb=qs('.lb');if(lb)lb.innerHTML='<li class="empty">Scores show up here once the host puts comics on stage.</li>';
  const p=$('panel');if(p)p.innerHTML='<div class="empty">The panel appears when the episode starts.</div>';
  const r=$('regs');if(r)r.innerHTML='<div class="empty">Regulars and golden ticket winners appear here the moment they hit the stage and stay all night.</div>';
  const rp=$('regPill');if(rp)rp.textContent='0 up';
  window.BPLive&&BPLive.applyRemote({id:'none',yes:0,no:0,open:false,resolved:false,pick:null,conf:null});setPlayer(null);
  const pp=qs('.panelcard .pill');if(pp)pp.textContent='avg —';paintRed();
  const yt=qs('.yt-top>div:nth-child(2)');if(yt)yt.innerHTML=`Waiting for the premiere<small>Unofficial fan room · ${fmt(viewers)} watching</small>`;
  if(window.BPLive&&BPLive.renderTicker)try{BPLive.renderTicker()}catch(e){}}

function render(){if(!ST)return;const ep=ST.episode,fin=FINAL();try{syncYtCtl()}catch(e){}
  if(epEl)epEl.innerHTML=`<strong>${esc(ep.title)}</strong>${ep.status==='live'?(synced()?'Live · synced to your player':'Live · real fan votes'):fin?'Replay · voting stays open':'Starting soon'}`;
  const yt=qs('.yt-top>div:nth-child(2)');if(yt)yt.innerHTML=`${esc(ep.title)}<small>${fin?'Replay · tap a comic on the board to jump to their set':'Unofficial fan room · '+fmt(viewers)+' watching'}</small>`;
  renderChrome(fin);
  setComic(curComic());renderBoard();renderRegs();renderPanel();renderBetState();setPlayer(ep.youtube_url);paintRed()}
function epNum(){const n=ST&&ST.episode&&ST.episode.ep_num;return n?'#'+n:''}
/* "How red is Tony?": room average + this fan's own level, open whenever the episode is votable */
function paintRed(){if(!window.BPRed)return;if(!ST){BPRed.set({avg:null,n:0,mine:null,enabled:false,why:'Opens with the episode'});return}
  const r=ST.red||[0,null],st=ST.episode.status;
  BPRed.set({avg:r[1]==null?null:+r[1],n:+r[0]||0,mine:ST.me&&ST.me.red!=null?+ST.me.red:null,enabled:st==='live'||st==='ended',why:'Opens when the episode starts'})}
/* final-results mode: header chip, card titles, pills, the "Last week" link */
function renderChrome(fin){const chip=qs('header .chip.live');
  if(chip){chip.classList.toggle('final',fin);chip.classList.toggle('replay',fin);chip.innerHTML=fin?`<span class="dot"></span>REPLAY ${epNum()}`:'<span class="dot"></span>LIVE';chip.title=fin?'Replay: votes stay open, rate along with the video':''}
  const h=qs('.onstage .card-h h3');if(h){if(stageH==null)stageH=h.innerHTML;
    const want=fin?'<span class="ic" style="background:rgba(74,85,232,.22)">🎬</span>REPLAY · RATE ALONG':stageH;if(h.innerHTML!==want)h.innerHTML=want}
  const lp=qs('.lbcard .pill');if(lp){lp.textContent=fin?'Replay':'Live scores';lp.classList.toggle('final',fin)}
  const lh=qs('.lbcard .card-h h3');if(lh)lh.lastChild.textContent='BUCKET PULL BOARD';
  const pv=META&&META.prev,lh2=qs('.lbcard .card-h');let a=qs('.lbcard .lastwk');
  if(pv&&!fin&&!WANT&&lh2){if(!a){a=document.createElement('button');a.className='lastwk';a.type='button';a.textContent='↩ Last week';lh2.insertBefore(a,lp||null)}
    a.title='Final results: '+(pv.title||'previous episode');a.onclick=()=>openResults(pv.id)}else if(a)a.remove()}
function bucketPulls(){return (ST&&ST.comics||[]).filter(c=>c.kind!=='regular')}
function topComic(){const cs=bucketPulls().filter(c=>c.avg!=null);cs.sort((a,b)=>+b.avg-+a.avg||b.votes-a.votes||a.ord-b.ord);return cs[0]||null}
/* replay: the comic whose set the fan's video is in (a fresh click wins for a few seconds while the player seeks) */
function videoComic(){const po=playerOffset();if(po==null)return null;let best=null;
  for(const c of ST&&ST.comics||[])if(c.start_offset!=null&&+c.start_offset<=po+4&&(!best||+c.start_offset>+best.start_offset))best=c;return best}
function finalComic(){const all=ST&&ST.comics||[],sel=finalSel&&all.find(c=>c.id===finalSel);
  if(sel&&Date.now()-finalAt<5000)return sel;return videoComic()||sel||topComic()||bucketPulls()[0]||all[0]||null}
function seekTo(sec){if(sec==null||!isFinite(sec))return false;const t=Math.max(0,Math.floor(+sec-3));
  if(ytPlayer&&typeof ytPlayer.seekTo==='function'){try{ytPlayer.seekTo(t,true);ytPlayer.playVideo()}catch(e){return false}}
  else{const f=qs('.yt-embed iframe');if(!f)return false;f.src=f.src.replace(/&start=\d+/,'').replace('autoplay=0','autoplay=1')+'&start='+t}
  const pl=qs('.player');if(pl){const r=pl.getBoundingClientRect();if(r.bottom<60||r.top>innerHeight-80)pl.scrollIntoView({behavior:'smooth',block:'start'})}return true}
function pickReplay(id){if(!FINAL()||!ST)return;const c=(ST.comics||[]).find(x=>x.id===id);if(!c)return;finalSel=id;finalAt=Date.now();
  const ok=seekTo(c.start_offset);render();if(c.start_offset==null)toast(`${c.name}: no video timestamp for this set`);else if(!ok)toast('Video is still loading, try again in a second')}
const mmss=t=>{t=Math.max(0,t|0);const h=t/3600|0,m=(t%3600)/60|0,s2=t%60;return (h?h+':'+String(m).padStart(2,'0'):m)+':'+String(s2).padStart(2,'0')}

function setComic(c){
  const num=qs('.comic .num'),who=qs('.comic .who'),pill=qs('.onstage .pill');
  const live=ST&&ST.episode.status==='live',fin=FINAL();
  document.querySelectorAll('#rate button,.quick button').forEach(b=>b.disabled=!c||!(live||fin));
  const kw=$('kbWho');if(kw){kw.textContent=c?c.name:'Pick a side';kw.title=c?'Kill or bomb: '+c.name:''}
  if(pill)pill.classList.toggle('final',fin);
  if(!c){if(num){num.textContent='–';num.dataset.k='';num.classList.remove('photo')}if(who)who.innerHTML='<small>Waiting for the bucket</small><b>No comic on stage</b><span>Ratings open when the next comic is up</span>';
    if(pill){pill.textContent=fin?'Replay':'Waiting';pill.classList.remove('hot')}
    if(fin&&who)who.innerHTML='<small>Replay</small><b>No comics in this episode yet</b><span>The lineup appears here once it is processed</span>';
    $('avg').innerHTML='—<small>/10</small>';$('votes').textContent='0';setDist([0,0,0,0,0,0,0,0,0,0]);setKB(0,0);$('mine').textContent='—';
    document.querySelectorAll('#rate button').forEach(b=>b.classList.remove('on'));const m=qs('.avg-meta b');if(m)m.textContent='';return}
  const reg=c.kind==='regular';
  if(num){const ph=reg?photoFor(c.name):null,key=ph?'p:'+ph.src:reg?'★':String(c.ord);
    if(num.dataset.k!==key){num.dataset.k=key;if(ph)num.innerHTML=imgTag(ph,'★');else num.textContent=reg?'★':c.ord}
    num.classList.toggle('reg',reg);num.classList.toggle('photo',!!ph)}
  if(fin){const top=topComic(),isTop=top&&top.id===c.id,rk=isTop?1:null;
    if(who)who.innerHTML=`<small>${isTop?'🏆 Top fan-rated set · ':''}${reg?'Kill Tony regular':'Comic #'+c.ord+' · Bucket Pull'}</small><b>${esc(c.name)}</b><span>${videoComic()&&videoComic().id===c.id?'On stage in your video':'Replay'} · ${fmt(c.votes)} vote${c.votes==1?'':'s'} · rate along</span>`;
    if(pill){pill.textContent='● Replay voting';pill.title='Votes stay open on past episodes';pill.classList.add('hot')}}
  else{
  if(who)who.innerHTML=reg?`<small>Kill Tony regular</small><b>${esc(c.name)}</b><span>On stage now · rate the set</span>`:`<small>Comic #${c.ord} · Bucket Pull</small><b>${esc(c.name)}</b><span>On stage now</span>`;
  if(pill){pill.textContent=live?'● Rating open':'Rating closed';pill.classList.toggle('hot',live)}}
  const avg=c.avg==null?null:Number(c.avg);
  $('avg').innerHTML=`${avg==null?'—':avg.toFixed(1)}<small>/10</small>`;$('votes').textContent=fmt(c.votes);
  const t=Date.now();if(avg!=null)hist.push({t,comic:c.id,avg});while(hist.length&&t-hist[0].t>40000)hist.shift();
  const old=hist.find(h=>h.comic===c.id&&t-h.t>=25000);const m=qs('.avg-meta b');
  const ns=m&&m.nextSibling;if(ns&&ns.nodeType===3)ns.textContent=fin?' all-time':' last 30s';
  if(m&&fin)m.textContent='Replay';else if(m){if(old&&avg!=null){const dd=avg-old.avg;m.textContent=(dd>=0?'▲ ':'▼ ')+Math.abs(dd).toFixed(1)}else m.textContent='Live'}
  setDist(c.dist||[]);setKB(c.kills,c.bombs);
  const mine=ST.me&&ST.me.votes?ST.me.votes[c.id]:null;
  document.querySelectorAll('#rate button').forEach((b,i)=>b.classList.toggle('on',mine===i+1));
  $('mine').textContent=mine?mine+' · '+WORDS[mine]:'tap a number';
  const kb=ST.me&&ST.me.kb?ST.me.kb[c.id]:null;qs('.quick .kill').classList.toggle('picked',kb==='kill');qs('.quick .bomb').classList.toggle('picked',kb==='bomb')}

function setDist(d){const bars=[...document.querySelectorAll('#dist i')];const mx=Math.max(0,...d);bars.forEach((b,i)=>{b.style.height=(mx?(d[i]||0)/mx*100:0)+'%';b.title=`${fmt(d[i]||0)} × ${i+1}`})}
function setKB(k,b){k=+k||0;b=+b||0;const tot=k+b,pk=tot?Math.round(k/tot*100):50;
  qs('.quick .kill small').textContent=tot?pk+'%':'–';qs('.quick .bomb small').textContent=tot?(100-pk)+'%':'–';
  qs('.killmeter .k').style.width=pk+'%';qs('.killmeter .b').style.width=(100-pk)+'%';
  const kl=qs('.km-l .kl'),bl=qs('.km-l .bl');if(kl)kl.textContent=fmt(k)+' say kill';if(bl)bl.textContent=fmt(b)+' say bomb'}

function renderBoard(){const lb=qs('.lb');if(!lb)return;const fin=FINAL(),cur=fin?null:effectiveComicId(),vis=visibleComicIds(),sel=fin?(finalComic()||{}).id:null;
  lb.classList.toggle('final',fin);
  if(fin&&!lb.dataset.fw){lb.dataset.fw=1;lb.addEventListener('click',e=>{if(!FINAL())return;const li=e.target.closest('li[data-id]');if(!li)return;pickReplay(li.dataset.id)})}
  const cs=(ST.comics||[]).filter(c=>c.kind!=='regular'&&vis.has(c.id));   // no spoilers for fans behind live
  if(!cs.length){lb.innerHTML='<li class="empty">No bucket pulls yet. Scores show up here as the bucket gets pulled.</li>';return}
  cs.sort((a,b)=>(b.avg==null?-1:+b.avg)-(a.avg==null?-1:+a.avg)||a.ord-b.ord);
  const gtw=gtWinner(),GT=(window.GT_TIX?GT_TIX(20,'Golden ticket winner'):'');
  lb.innerHTML=cs.map((c,i)=>{const now=c.id===cur,a=c.avg==null?null:+c.avg,gt=gtw&&gtw.id===c.id?' '+GT:'';
    const kt=(+c.kills||0)+(+c.bombs||0),kp=kt?Math.round(c.kills/kt*100):null;
    const kbs=fin&&kp!=null?` <span class="kbs" title="${fmt(c.kills)} kill · ${fmt(c.bombs)} bomb"><b>🔪${kp}%</b> / <em>💣${100-kp}%</em></span>`:'';
    return `<li data-id="${c.id}"${fin?` title="${c.start_offset!=null?'Jump the video to '+esc(c.name)+'\'s set':esc(c.name)}"`:''} class="${now?'now':''}${c.id===sel?' sel':''}"><span class="rk">${i+1}</span><span class="nm">${esc(c.name)}${gt}${now?' <span class="tag live">LIVE</span>':''}<small>Comic #${c.ord} · ${fmt(c.votes)} vote${c.votes==1?'':'s'}${kbs}${fin&&c.start_offset!=null?`<span class="seek">▶ ${mmss(c.start_offset)}</span>`:''}</small></span><span class="sc"><span class="mini"><i style="width:${a==null?0:a*10}%"></i></span>${a==null?'—':a.toFixed(1)}</span></li>`}).join('')}

function starRow(id,name,score,icon){const my=score?Math.round(score/2):0,ic=icon||'★',emo=ic!=='★',w=iconKind(ic),kind=w;
  return `<div class="stars${emo?' emo':''}${iconCls(ic)}" data-id="${id}" data-kind="${kind}">${[1,2,3,4,5].map(j=>`<button class="${j<=my?'on':''}" data-v="${j}" aria-label="${j} ${w}${j>1?'s':''} for ${esc(name)}" aria-pressed="${j<=my}">${iconMarkup(ic)}</button>`).join('')}</div>`}
function renderRegs(){const el=$('regs');if(!el)return;const fin=FINAL(),cur=fin?(finalComic()||{}).id:effectiveComicId(),vis=visibleComicIds();
  const rs=(ST.comics||[]).filter(c=>c.kind==='regular'&&vis.has(c.id));
  const gtc=gtWinner();if(gtc&&vis.has(gtc.id)&&!rs.some(c=>c.id===gtc.id))rs.push(gtc);rs.sort((a,b)=>a.ord-b.ord);
  const pill=$('regPill');if(pill){pill.textContent=rs.length?(fin?`${rs.length} up · replay`:`${rs.length} up tonight`):(fin?'replay':'0 up');pill.classList.toggle('final',fin)}
  if(!rs.length&&fin){el.innerHTML='<div class="empty">No regulars in this episode\'s lineup.</div>';return}
  if(!rs.length){el.innerHTML='<div class="empty">Regulars and golden ticket winners appear here the moment they hit the stage and stay all night.</div>';return}
  const mine=ST.me&&ST.me.votes||{},live=ST.episode.status==='live';
  el.innerHTML=rs.map((r,k)=>{const g=GRAD[(k+2)%GRAD.length],a=r.avg==null?null:+r.avg,now=r.id===cur;
    return `<div class="pm reg${now?' now':''}${fin&&r.start_offset!=null?' seekable':''}" data-id="${r.id}"${fin&&r.start_offset!=null?` title="Jump the video to ${esc(r.name)}"`:''}><div class="av${gtc&&r.id===gtc.id?' av-gt':''}" style="--g:linear-gradient(135deg,${g[0]},${g[1]});--rc:${gtc&&r.id===gtc.id?'#ffc23d':g[0]}">${avInner(r.name)}</div>
<div class="info"><b>${esc(r.name)}${now&&!fin?' <span class="tag live">LIVE</span>':''}</b><small>${now?(fin?'On stage in your video':'On stage now'):(gtc&&r.id===gtc.id?(window.GT_TIX?GT_TIX(14):'')+' Golden ticket winner · set #':'Regular · set #')+r.ord}${fin&&r.start_offset!=null?' · ▶ '+mmss(r.start_offset):''}</small>${live||fin?starRow(r.id,r.name,mine[r.id],iconFor(r)):''}</div>
<div class="avg">${a==null?'—':a.toFixed(1)}<small>${fmt(r.votes)} vote${r.votes==1?'':'s'}</small></div></div>`}).join('')}

function renderPanel(){const el=$('panel');if(!el)return;const ps=ST.panel||[];
  if(!ps.length){el.innerHTML='<div class="empty">No panel yet.</div>';qs('.panelcard .pill').textContent='avg —';return}
  const mine=ST.me&&ST.me.panel||{};
  el.innerHTML=ps.map((p,k)=>{const g=GRAD[k%GRAD.length],a=p.avg==null?null:+p.avg;
    return `<div class="pm" data-id="${p.id}"><div class="av" style="--g:linear-gradient(135deg,${g[0]},${g[1]});--rc:${g[0]}">${panelInner(p)}</div>
<div class="info"><b>${esc(p.name)}</b><small>${esc(p.role)}</small>${starRow(p.id,p.name,mine[p.id],iconFor(p))}</div>
<div class="avg">${a==null?'—':a.toFixed(1)}<small>${fmt(p.votes)} vote${p.votes==1?'':'s'}</small></div></div>`}).join('');
  const rated=ps.filter(p=>p.avg!=null);qs('.panelcard .pill').textContent=(rated.length?'avg '+(rated.reduce((s,p)=>s+ +p.avg,0)/rated.length).toFixed(1):'avg —')+(FINAL()?' · replay':'')}

function gtIsReached(){const ep=ST&&ST.episode;if(!ep)return false;const gtEv=(ST.events||[]).filter(e=>e.kind==='golden_ticket'&&!e.cancelled).pop();
  return !!ep.golden_ticket_at&&(!gtEv||evVisible(gtEv,playerOffset()))}
function gtWinner(){const ep=ST&&ST.episode;if(!ep||!ep.golden_ticket_name||!gtIsReached())return null;const cs=ST.comics||[];
  return cs.find(c=>nrm(c.name)===nrm(ep.golden_ticket_name))||cs.find(c=>nameMatch(c.name,ep.golden_ticket_name))||null}
function renderBetState(){if(!window.BPLive||!BPLive.applyRemote||!ST)return;const ep=ST.episode,b=ST.bet||{yes:0,no:0};
  const gtEv=(ST.events||[]).filter(e=>e.kind==='golden_ticket'&&!e.cancelled).pop();
  const gtReached=!!ep.golden_ticket_at&&(!gtEv||evVisible(gtEv,playerOffset()));
  const o={id:ep.id,start:new Date(ep.starts_at),yes:+b.yes||0,no:+b.no||0,open:!!ep.betting_is_open,resolved:gtReached,gtName:ep.golden_ticket_name,final:FINAL()};
  if(!pending.bet){const mb=ST.me&&ST.me.bet;o.pick=mb?mb.pick:null;o.conf=mb?mb.confidence:null}
  BPLive.applyRemote(o)}

/* ---------- YouTube premiere ---------- */
let ytCur=null;
function ytId(u){if(!u)return null;try{const x=new URL(u.trim());const h=x.hostname.replace(/^www\.|^m\./,'');
  if(h==='youtu.be')return x.pathname.slice(1).split('/')[0]||null;
  if(/(^|\.)youtube(-nocookie)?\.com$/.test(h)){if(x.searchParams.get('v'))return x.searchParams.get('v');const m=x.pathname.match(/^\/(embed|live|shorts|v)\/([\w-]{6,})/);return m?m[2]:null}}catch(e){}
  return /^[\w-]{11}$/.test(u.trim())?u.trim():null}
function loadYTApi(){if(ytApiState!=='none')return;ytApiState='loading';
  const prev=window.onYouTubeIframeAPIReady;window.onYouTubeIframeAPIReady=()=>{ytApiState='ready';prev&&prev();if(ytCur){const c=ytCur;ytCur=null;setPlayer('https://youtu.be/'+c)}};
  const s=document.createElement('script');s.src='https://www.youtube.com/iframe_api';s.async=true;s.onerror=()=>{ytApiState='failed';if(ytCur){const c=ytCur;ytCur=null;setPlayer('https://youtu.be/'+c)}};document.head.appendChild(s);
  setTimeout(()=>{if(ytApiState==='loading'){ytApiState='failed';if(ytCur){const c=ytCur;ytCur=null;setPlayer('https://youtu.be/'+c)}}},8000)}
const YT_VARS={autoplay:1,mute:0,playsinline:1,rel:0,modestbranding:1,controls:0,iv_load_policy:3,disablekb:1};
const YT_QS=Object.entries(YT_VARS).map(([k,v])=>k+'='+v).join('&');
let ytCtlTimer=null,ytScrubbing=false,ytSeekable=true,ytPendingSeek=null,ytPendingUntil=0;
function stopYtCtlPoll(){if(ytCtlTimer){clearInterval(ytCtlTimer);ytCtlTimer=null}}
function ytRead(){const p=ytPlayer;let playing=false,muted=false,cur=0,dur=0,volN=100,st=-1;
  if(p&&typeof p.getPlayerState==='function'){
    try{st=p.getPlayerState();playing=(st===1||st===3);muted=!!p.isMuted();cur=+p.getCurrentTime()||0;dur=+p.getDuration()||0;volN=+p.getVolume()||0}catch(e){}}
  return {playing,muted,cur,dur,volN,st}}
/* DVR/VOD seekable when duration is known; pure non-DVR live → hide seek and show LIVE */
function ytCanSeek(dur,st){if(!(dur>0))return false;if(FINAL())return true;if(!ytSeekable)return false;return st===1||st===2||st===3||st===0}
function ctlSeekTo(sec,{play=true}={}){if(sec==null||!isFinite(sec))return false;const t=Math.max(0,+sec);
  const p=ytPlayer;if(p&&typeof p.seekTo==='function'){try{p.seekTo(t,true);if(play)p.playVideo();ytPendingSeek=t;ytPendingUntil=Date.now()+2500;return true}catch(e){return false}}
  const f=qs('.yt-embed iframe');if(!f)return false;const base=f.src.replace(/[?&]start=\d+/g,'').replace(/[?&]t=\d+s?/g,'');
  f.src=base+(base.includes('?')?'&':'?')+'start='+Math.floor(t);ytPendingSeek=t;ytPendingUntil=Date.now()+2500;return true}
function syncYtCtl(){
  const ctl=qs('.yt-ctl');if(!ctl)return;
  const pp=ctl.querySelector('.yt-pp'),mu=ctl.querySelector('.yt-mu'),vol=ctl.querySelector('.yt-vol');
  const seek=ctl.querySelector('.yt-seek'),scrub=ctl.querySelector('.yt-scrub'),tm=ctl.querySelector('.yt-time');
  const liveEl=ctl.querySelector('.yt-live'),skB=ctl.querySelector('.yt-back'),skF=ctl.querySelector('.yt-fwd');
  const {playing,muted,cur,dur,volN,st}=ytRead();
  if(pp){pp.textContent=playing?'❚❚':'▶';pp.setAttribute('aria-label',playing?'Pause':'Play')}
  if(mu){mu.textContent=muted||volN===0?'🔇':'🔊';mu.setAttribute('aria-label',muted?'Unmute':'Mute')}
  if(vol&&document.activeElement!==vol)vol.value=String(muted?0:volN);
  if(ytPendingSeek!=null&&(Math.abs(cur-ytPendingSeek)<2.5||Date.now()>ytPendingUntil))ytPendingSeek=null;
  const can=ytCanSeek(dur,st);
  if(seek){
    seek.hidden=!can;
    if(can&&scrub){
      const max=Math.max(1,Math.floor(dur));
      if(scrub.max!==String(max))scrub.max=String(max);
      if(ytScrubbing){if(tm)tm.textContent=mmss(+scrub.value||0)+' / '+mmss(dur)}
      else if(ytPendingSeek!=null){scrub.value=String(Math.min(Math.floor(ytPendingSeek),max));if(tm)tm.textContent=mmss(ytPendingSeek)+' / '+mmss(dur)}
      else{scrub.value=String(Math.min(Math.floor(cur),max));if(tm)tm.textContent=mmss(cur)+' / '+mmss(dur)}}
  }
  if(liveEl)liveEl.classList.toggle('on',!FINAL()&&!can&&!!ytCur);
  if(skB)skB.hidden=!can;if(skF)skF.hidden=!can;
}
function startYtCtlPoll(){stopYtCtlPoll();syncYtCtl();ytCtlTimer=setInterval(syncYtCtl,500)}
function buildYtCtl(pl,stage){
  pl.querySelectorAll('.yt-ctl').forEach(e=>e.remove());
  const ctl=document.createElement('div');ctl.className='yt-ctl';ctl.tabIndex=0;
  ctl.setAttribute('role','group');ctl.setAttribute('aria-label','Video controls');
  ctl.innerHTML=`<button type="button" class="yt-pp" aria-label="Play">▶</button>
<button type="button" class="yt-mu" aria-label="Mute">🔊</button>
<input class="yt-vol" type="range" min="0" max="100" value="100" aria-label="Volume">
<button type="button" class="yt-skip yt-back" aria-label="Back 10 seconds" hidden>−10</button>
<div class="yt-seek" hidden><input class="yt-scrub" type="range" min="0" max="0" value="0" step="1" aria-label="Seek"><span class="yt-time">0:00 / 0:00</span></div>
<button type="button" class="yt-skip yt-fwd" aria-label="Forward 10 seconds" hidden>+10</button>
<span class="yt-live" aria-live="polite"><span class="dot"></span>LIVE</span>
<button type="button" class="yt-fs" aria-label="Fullscreen">⛶</button>`;
  ctl.querySelector('.yt-pp').onclick=()=>{const p=ytPlayer;if(!p)return;try{const st=p.getPlayerState();if(st===1)p.pauseVideo();else p.playVideo()}catch(e){}syncYtCtl()};
  ctl.querySelector('.yt-mu').onclick=()=>{const p=ytPlayer;if(!p)return;try{if(p.isMuted()||p.getVolume()===0){p.unMute();if(p.getVolume()===0)p.setVolume(80);sound.on=true;const u=qs('.yt-unmute');if(u)u.remove()}else p.mute()}catch(e){}syncYtCtl()};
  ctl.querySelector('.yt-vol').addEventListener('input',e=>{const p=ytPlayer,v=+e.target.value;if(!p)return;try{p.setVolume(v);if(v>0){p.unMute();sound.on=true;const u=qs('.yt-unmute');if(u)u.remove()}else p.mute()}catch(x){}syncYtCtl()});
  const scrub=ctl.querySelector('.yt-scrub'),tm=ctl.querySelector('.yt-time');
  let scrubGesture=0,lastCommitted=-1;
  const commitScrub=()=>{if(!ytScrubbing&&lastCommitted===scrubGesture)return;
    const t=+scrub.value;ytScrubbing=false;lastCommitted=scrubGesture;
    if(!isFinite(t)){syncYtCtl();return}
    /* freeze UI on the chosen time so a late change/poll cannot snap back */
    scrub.value=String(Math.floor(t));
    const ok=ctlSeekTo(t,{play:true});if(!ok)ytSeekable=false;syncYtCtl()};
  const beginScrub=e=>{ytScrubbing=true;scrubGesture++;try{scrub.setPointerCapture&&e.pointerId!=null&&scrub.setPointerCapture(e.pointerId)}catch(x){}};
  scrub.addEventListener('pointerdown',beginScrub);
  scrub.addEventListener('touchstart',()=>{ytScrubbing=true;scrubGesture++},{passive:true});
  scrub.addEventListener('input',()=>{if(!ytScrubbing){ytScrubbing=true;scrubGesture++}
    const {dur}=ytRead();if(tm)tm.textContent=mmss(+scrub.value||0)+' / '+mmss(dur)});
  scrub.addEventListener('change',commitScrub);
  scrub.addEventListener('pointerup',commitScrub);
  scrub.addEventListener('pointercancel',commitScrub);
  scrub.addEventListener('touchend',commitScrub,{passive:true});
  const skipBy=d=>{const {cur,dur}=ytRead();if(!(dur>0))return;ctlSeekTo(Math.max(0,Math.min(dur,cur+d)),{play:true});syncYtCtl()};
  ctl.querySelector('.yt-back').onclick=()=>skipBy(-10);
  ctl.querySelector('.yt-fwd').onclick=()=>skipBy(10);
  ctl.addEventListener('keydown',e=>{
    if(e.target&&e.target.matches&&e.target.matches('input.yt-vol,input.yt-scrub'))return;
    const k=e.key;if(k==='ArrowLeft'){e.preventDefault();skipBy(e.shiftKey?-30:-10)}
    else if(k==='ArrowRight'){e.preventDefault();skipBy(e.shiftKey?30:10)}
    else if(k===' '||k==='k'||k==='K'){e.preventDefault();ctl.querySelector('.yt-pp').click()}
    else if(k==='m'||k==='M'){e.preventDefault();ctl.querySelector('.yt-mu').click()}
  });
  ctl.querySelector('.yt-fs').onclick=()=>{const el=stage||pl;if(!document.fullscreenElement){const req=el.requestFullscreen||el.webkitRequestFullscreen;req&&req.call(el)}else{const ex=document.exitFullscreen||document.webkitExitFullscreen;ex&&ex.call(document)}};
  pl.appendChild(ctl);startYtCtlPoll();return ctl;
}
function setPlayer(url){const pl=qs('.player');if(!pl)return;const id=ytId(url);if(id===ytCur)return;ytCur=id;
  stopYtCtlPoll();pl.querySelectorAll('.yt-embed,.yt-out,.yt-unmute,.yt-ctl,.yt-stage').forEach(e=>e.remove());pl.classList.toggle('has-yt',!!id);
  if(ytPlayer){try{ytPlayer.destroy()}catch(e){}ytPlayer=null}
  if(!id)return;
  const stage=document.createElement('div');stage.className='yt-stage';
  const w=document.createElement('div');w.className='yt-embed';
  if(ytApiState==='none')loadYTApi();
  if(ytApiState==='ready'&&window.YT&&YT.Player){
    const holder=document.createElement('div');w.appendChild(holder);
    ytPlayer=new YT.Player(holder,{host:'https://www.youtube-nocookie.com',videoId:id,
      playerVars:Object.assign({},YT_VARS),
      events:{onReady:ev=>{soundOn(ev.target);syncYtCtl()},onStateChange:()=>{timelineTick();syncYtCtl()},onError:e=>console.warn('youtube player error',e&&e.data)}});
  }else w.innerHTML=`<iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?${YT_QS}" title="Kill Tony premiere on YouTube" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
  const u=document.createElement('button');u.className='yt-unmute';u.type='button';u.textContent='🔊 Tap for sound';
  u.style.cssText='position:absolute;left:50%;top:12px;transform:translateX(-50%);z-index:5;padding:9px 16px;border-radius:999px;border:0;background:#ffd23f;color:#111;font-weight:800;font-size:14px;cursor:pointer;box-shadow:0 4px 18px rgba(0,0,0,.45)';
  u.onclick=e=>{e.stopPropagation();if(ytPlayer&&ytPlayer.unMute){try{ytPlayer.unMute();ytPlayer.setVolume(100);ytPlayer.playVideo()}catch(x){}}
    else{const f=w.querySelector('iframe');if(f&&/[&?]mute=1/.test(f.src))f.src=f.src.replace(/([&?])mute=1/,'$1mute=0')}u.remove();sound.on=true;syncYtCtl()};
  if(getComputedStyle(pl).position==='static')pl.style.position='relative';
  stage.append(w,u);pl.appendChild(stage);buildYtCtl(pl,stage)}


/* sound on by default: try unmuted autoplay; if the browser blocks it, play muted and unmute on the first tap/click/key anywhere */
const sound={on:false,armed:false};
function soundOn(p){if(p!==ytPlayer)return;try{p.unMute();p.setVolume(100);p.playVideo()}catch(e){}
  setTimeout(()=>{if(p!==ytPlayer)return;let st=-1,muted=true;try{st=p.getPlayerState();muted=p.isMuted()}catch(e){}
    if(st===1&&!muted){sound.on=true;qs('.yt-unmute')&&qs('.yt-unmute').remove();syncYtCtl();return}
    try{p.mute();p.playVideo()}catch(e){}armUnmute();syncYtCtl()},2500)}
function armUnmute(){if(sound.armed)return;sound.armed=true;
  const go=e=>{if(e.target&&e.target.closest&&e.target.closest('input,textarea,select,.bp-res'))return;
    document.removeEventListener('pointerdown',go,true);document.removeEventListener('keydown',go,true);sound.armed=false;
    const p=ytPlayer;if(!p||!p.unMute)return;try{p.unMute();p.setVolume(100);if(p.getPlayerState()!==1)p.playVideo()}catch(x){}
    sound.on=true;const u=qs('.yt-unmute');if(u)u.remove();syncYtCtl()};
  document.addEventListener('pointerdown',go,true);document.addEventListener('keydown',go,true)}

/* ---------- clock on the comic card ---------- */
function tickClock(){timelineTick();const tm=$('tm'),sm=qs('.comic .timer small');if(!tm)return;const ep=ST&&ST.episode;
  if(FINAL()){const c=curComic(),po=playerOffset();const t=c&&c.start_offset!=null&&po!=null&&po>=+c.start_offset?mmss(po-c.start_offset):'🎬';
    if(tm.textContent!==t)tm.textContent=t;if(sm)sm.textContent=t==='🎬'?'REPLAY':'INTO SET';return}
  if(!ep||!ep.current_comic_at||!curComic()){tm.textContent='–:––';if(sm)sm.textContent='ON STAGE';return}
  const po=playerOffset(),le=lastComicEvent();
  const s=le&&le.offset!=null&&le.source==='auto'&&po!=null?Math.max(0,(po-le.offset)|0):
          le&&le.source==='auto'&&le.offset!=null?Math.max(0,(now()-new Date(le.at).getTime()-HOLD)/1000|0):
          Math.max(0,(now()-new Date(ep.current_comic_at).getTime())/1000|0);
  tm.textContent=(s/60|0)+':'+String(s%60).padStart(2,'0');if(sm)sm.textContent='ON STAGE'}

/* ---------- fan inputs (debounced: one write per fan per target) ---------- */
const voteT={};
function sendVote(kind,target,score,verdict){const key=kind+':'+target;clearTimeout(voteT[key]);
  voteT[key]=setTimeout(async()=>{if(!(await ensureSession()))return;
    const {error}=await sb.rpc('vote',{p_kind:kind,p_target:target,p_score:score==null?null:score,p_verdict:verdict||null});
    if(error){toast(/closed/i.test(error.message)?'Voting is closed for this episode':'Vote not saved: '+error.message);return}soon(2500)},350)}
function mineObj(){if(!MINE)MINE={votes:{},kb:{},panel:{},bet:null};if(ST)ST.me=MINE;return MINE}
function wireInputs(){
  const meEl=qs('.me');if(meEl){meEl.querySelector('span')&&(meEl.querySelector('span').textContent='🙂');meEl.title='You (anonymous fan)'}
  // rating 1-10 (bucket pull or regular on stage)
  document.querySelectorAll('#rate button').forEach((b,i)=>b.addEventListener('click',()=>{const c=curComic();if(!c)return;const score=i+1;
    mineObj().votes[c.id]=score;setComic(c);renderRegs();sendVote('comic',c.id,score)}));
  // KILL / BOMB (the emoji fountain is local-only, see app.js)
  document.querySelectorAll('.quick button').forEach(b=>b.addEventListener('click',()=>{const c=curComic();if(!c)return;const verdict=b.classList.contains('kill')?'kill':'bomb';
    mineObj().kb[c.id]=verdict;setComic(c);sendVote('kb',c.id,null,verdict)}));
  // panel + regulars stars (1-5 stars stored as 2-10)
  const stars=(el,kind)=>el&&el.addEventListener('click',e=>{const b=e.target.closest('.stars button');if(!b||!ST)return;const id=b.parentElement.dataset.id,v=+b.dataset.v;
    b.parentElement.querySelectorAll('button').forEach((x,j)=>x.classList.toggle('on',j<v));if(window.burst){const k=b.parentElement.dataset.kind||'';const t=k==='sandwich'?'🥪':k==='mic'?'🎤':k==='shirt'?'👕':k==='grill'?'🦷':(b.textContent.trim()||'⭐');burst(e.clientX,e.clientY,'#ffc23d',t==='★'?'⭐':t,'')}
    const m=mineObj();if(kind==='panel')m.panel[id]=v*2;else m.votes[id]=v*2;
    if(kind!=='panel'){const c=curComic();if(c&&c.id===id)setComic(c)}
    sendVote(kind,id,v*2)});
  stars($('panel'),'panel');stars($('regs'),'comic');
  const rg=$('regs');if(rg)rg.addEventListener('click',e=>{if(!FINAL()||e.target.closest('.stars'))return;const r=e.target.closest('.pm.reg[data-id]');if(r)pickReplay(r.dataset.id)});
  // how red is Tony (0-100, one per fan per episode, change any time)
  if(window.BPRed)BPRed.onPick=v=>{if(!EPID||!ST)return;const st=ST.episode.status;if(st!=='live'&&st!=='ended'){toast('The thermometer opens when the episode starts');return}
    mineObj().red=v;sendVote('red',EPID,v)};
  const ab=$('archBtn');if(ab)ab.addEventListener('click',()=>openArchive());
  window.addEventListener('popstate',()=>{const v=new URLSearchParams(location.search).get('ep');goEp(v||null,true)});
  // golden ticket bet (live.js owns the UI and calls this)
  if(window.BPLive)BPLive.onPick=async(pick,conf)=>{if(!EPID)return;if(!(await ensureSession()))return;pending.bet++;
    try{const q=pick?sb.from('bets').upsert({episode_id:EPID,voter_id:me.id,pick,confidence:conf||null},{onConflict:'episode_id,voter_id'})
                    :sb.from('bets').delete().eq('episode_id',EPID).eq('voter_id',me.id);
      const {error}=await q;if(error)toast(/row-level security/i.test(error.message)?'Betting is closed':'Bet not saved: '+error.message);
      else{mineObj().bet=pick?{pick,confidence:conf||null}:null}}
    finally{pending.bet--;soon(2000)}};
}

/* ---------- host panel (?host=1) ---------- */
let hostEl=null;
async function hrpc(fn,args){const r=await sb.rpc(fn,Object.assign({p_secret:host.secret},args||{}));
  if(r.error){const e=hostEl&&hostEl.querySelector('.h-err');if(e)e.textContent=r.error.message;toast('Host action failed: '+r.error.message);if(/not authorized/.test(r.error.message)){host.ok=false;LS.del('bp.host.secret');mountHost()}}
  else{const e=hostEl&&hostEl.querySelector('.h-err');if(e)e.textContent='';soon(150)}return r}
function nextPremiereISO(){const chi=new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',hour12:false,weekday:'short',hour:'2-digit',minute:'2-digit'});
  const t0=Math.ceil(Date.now()/3.6e6)*3.6e6;for(let h=-6;h<24*8;h++){const c=new Date(t0+h*3.6e6);const p=Object.fromEntries(chi.formatToParts(c).map(x=>[x.type,x.value]));
    if(p.weekday==='Mon'&&p.hour==='20'&&c.getTime()+6*3.6e6>Date.now())return c}return new Date()}
function toLocalInput(d){const z=new Date(d.getTime()-d.getTimezoneOffset()*6e4);return z.toISOString().slice(0,16)}
async function mountHost(){if(hostEl)hostEl.remove();hostEl=document.createElement('aside');hostEl.className='host live-host';
  const head=`<button class="h-head" id="hToggle" aria-expanded="true"><span class="h-dot"></span>Host controls<span class="h-car">▾</span></button>`;
  if(!host.secret||!(await sb.rpc('host_check',{p_secret:host.secret})).data){host.ok=false;
    hostEl.innerHTML=head+`<div class="h-body"><label class="h-fld"><span>Host secret</span><input id="hSecret" type="password" autocomplete="off" placeholder="paste the host secret"></label>
      <button class="h-btn ok" id="hLogin">Unlock host controls</button><div class="h-err"></div><div class="h-foot"><span>Live room</span><a href="?host=0">Exit host mode</a></div></div>`;
    document.body.appendChild(hostEl);wireHead();
    hostEl.querySelector('#hLogin').onclick=async()=>{const s=hostEl.querySelector('#hSecret').value.trim();const r=await sb.rpc('host_check',{p_secret:s});
      if(r.data){host.secret=s;LS.set('bp.host.secret',s);mountHost()}else hostEl.querySelector('.h-err').textContent='That secret did not work.'};
    return}
  host.ok=true;
  hostEl.innerHTML=head+`<div class="h-body">
    <div class="h-state" id="hState" style="font-size:12px;color:var(--mute)"></div>
    <div class="h-sec">Autopilot</div>
    <div class="h-ap" id="hAP">Autopilot has not checked in yet.</div>
    <div class="h-tg"><button id="hAuto" title="Master switch: auto comics, golden ticket, betting">AUTO</button><button id="hAutoGT" title="Auto golden ticket">${window.GT_TIX?GT_TIX(14):''} AUTO</button><button id="hAutoBet" title="Auto close betting after the opener">AUTO BETS</button></div>
    <button class="h-btn" id="hUndo">↶ Undo last auto action</button>
    <div class="h-tg h-sync" title="Shift every automatic event (already shown or still queued). Use when comics/golden ticket appear too late or too early against the video."><span>Sync</span><button data-d="-5">−5s</button><button data-d="-1">−1s</button><button data-d="1">+1s</button><button data-d="5">+5s</button></div>
    <div class="h-sec">Performers <small style="color:var(--dim);text-transform:none;letter-spacing:0">▶ stage · ⇄ bucket/regular · ✎ · 🗑</small></div>
    <div class="h-list" id="hComics"></div>
    <div class="h-sec">On stage</div>
    <div class="h-row"><input id="hComic" maxlength="60" placeholder="Name" class="h-in"><select id="hKind" title="Bucket pull or Kill Tony regular"><option value="bucket">Bucket pull</option><option value="regular">Regular</option></select></div>
    <div class="h-row"><button class="h-btn ok" id="hAdd">Add + stage</button><button class="h-btn" id="hAddOnly" title="Add without putting them on stage">Add only</button></div>
    <div class="h-row"><select id="hPick"></select><button class="h-btn" id="hSetCur" style="flex:none;padding:0 10px">Stage</button></div>
    <div class="h-sec">Premiere</div>
    <div class="h-row"><input id="hYT" placeholder="YouTube link" class="h-in"><button class="h-btn ok" id="hYTSet" style="flex:none;padding:0 10px">Set</button></div>
    <div class="h-sec">Golden ticket</div>
    <label class="h-fld"><input id="hName" maxlength="60" placeholder="Winner name (default: comic on stage)"></label>
    <button class="h-gt" id="hGT">${window.GT_TIX?GT_TIX(18):''} GOLDEN TICKET!</button>
    <button class="h-btn ghost" id="hGTx">✕ Cancel golden ticket</button>
    <button class="h-btn" id="hClose">🔒 Close betting</button>
    <div class="h-sec">Panel</div>
    <div class="h-list" id="hPanel"></div>
    <div class="h-row"><input id="hPName" maxlength="40" placeholder="Guest name" class="h-in"><input id="hPRole" maxlength="40" placeholder="Role" class="h-in" style="max-width:80px"><button class="h-btn ok" id="hPAdd" style="flex:none;padding:0 8px">Add</button></div>
    <div class="h-sec">Episode</div>
    <label class="h-fld"><span>Title</span><input id="hTitle" maxlength="120" placeholder="Episode #…"></label>
    <label class="h-fld"><span>Starts (bets auto-close 15 min later)</span><input id="hStart" type="datetime-local"></label>
    <div class="h-row"><button class="h-btn ok" id="hSave">Save</button><button class="h-btn ok" id="hNew">＋ New episode</button></div>
    <button class="h-btn" id="hEnd">🏁 End episode · show final results</button>
    <button class="h-btn ghost" id="hReset">↺ Reset this episode's votes & bets</button>
    <div class="h-err"></div>
    <div class="h-foot"><span>Live room · polling</span><a href="#" id="hOut">Log out</a> <a href="?host=0">Exit</a></div></div>`;
  document.body.appendChild(hostEl);wireHead();
  hostEl.querySelectorAll('.h-in').forEach(i=>{i.style.cssText='height:34px;border-radius:9px;background:rgba(255,255,255,.07);border:1px solid var(--line);color:var(--ink);padding:0 10px;font:600 12.5px var(--body);outline:0'});
  const v=id=>hostEl.querySelector(id);
  v('#hStart').value=toLocalInput(nextPremiereISO());
  const add=async stage=>{const n=v('#hComic').value.trim();if(!n||!EPID)return;const r=await hrpc('host_add_comic',{p_episode:EPID,p_name:n,p_make_current:stage,p_kind:v('#hKind').value});if(!r.error)v('#hComic').value=''};
  v('#hAdd').onclick=()=>add(true);v('#hAddOnly').onclick=()=>add(false);
  v('#hSetCur').onclick=()=>EPID&&hrpc('host_set_current_comic',{p_episode:EPID,p_comic:v('#hPick').value||null});
  v('#hYTSet').onclick=()=>{const u=v('#hYT').value.trim();if(u&&!ytId(u)){v('.h-err').textContent='That does not look like a YouTube link.';return}EPID&&hrpc('host_update_episode',{p_episode:EPID,p_youtube_url:u})};
  v('#hGT').onclick=async()=>{if(!EPID)return;const name=v('#hName').value.trim()||((curComic()||{}).name)||'';
    localGTUntil=Date.now()+8000;window.triggerGoldenTicket&&window.triggerGoldenTicket(name);   // fire here now (click = audio allowed)
    await hrpc('host_golden_ticket',{p_episode:EPID,p_name:name||null})};
  v('#hClose').onclick=()=>{if(!EPID||!ST)return;const open=ST.episode.betting_open&&!ST.episode.golden_ticket_at;hrpc('host_set_betting',{p_episode:EPID,p_open:!open})};
  v('#hPAdd').onclick=async()=>{const n=v('#hPName').value.trim();if(!n||!EPID)return;const r=await hrpc('host_add_panelist',{p_episode:EPID,p_name:n,p_role:v('#hPRole').value.trim()||'Guest'});if(!r.error){v('#hPName').value='';v('#hPRole').value=''}};
  v('#hPanel').onclick=e=>{const b=e.target.closest('[data-rm]');if(b&&confirm('Remove this panelist (and their votes)?'))hrpc('host_remove_panelist',{p_panelist:b.dataset.rm})};
  v('#hSave').onclick=()=>EPID&&hrpc('host_update_episode',{p_episode:EPID,p_title:v('#hTitle').value.trim()||null,p_starts_at:v('#hStart').value?new Date(v('#hStart').value).toISOString():null});
  v('#hNew').onclick=async()=>{if(!confirm('Start a NEW episode? The current one is marked ended and everyone moves to the new room.'))return;
    await hrpc('host_new_episode',{p_title:v('#hTitle').value.trim()||'Premiere Night',p_starts_at:v('#hStart').value?new Date(v('#hStart').value).toISOString():null,p_youtube_url:v('#hYT').value.trim()||null,p_panel:null})};
  v('#hEnd').onclick=()=>{if(!EPID||!ST)return;const ended=ST.episode.status==='ended';
    if(!confirm(ended?'Reopen this episode for voting?':'End this episode? Voting and betting close and every visitor sees the final results until the next episode goes live.'))return;
    hrpc('host_update_episode',{p_episode:EPID,p_status:ended?'live':'ended'})};
  v('#hGTx').onclick=()=>{if(EPID&&confirm('Cancel the golden ticket? (Turns auto golden ticket off for this episode.)'))hrpc('host_cancel_golden_ticket',{p_episode:EPID})};
  const flip=k=>{if(!EPID||!ST)return;const ep=ST.episode;const a={p_episode:EPID,p_enabled:null,p_gt:null,p_betting:null};
    if(k==='all')a.p_enabled=!ep.auto_enabled;if(k==='gt')a.p_gt=!ep.auto_gt;if(k==='bet')a.p_betting=!ep.auto_betting;hrpc('host_set_auto',a)};
  v('#hAuto').onclick=()=>flip('all');v('#hAutoGT').onclick=()=>flip('gt');v('#hAutoBet').onclick=()=>flip('bet');
  hostEl.querySelectorAll('.h-sync button').forEach(b=>b.onclick=async()=>{if(!EPID)return;const d=+b.dataset.d;const r=await hrpc('host_sync_adjust',{p_episode:EPID,p_delta:d});if(!r.error&&r.data&&r.data.ok)toast(`Autopilot events ${d<0?'earlier':'later'} by ${Math.abs(d)}s (total ${r.data.sync_adjust>0?'+':''}${r.data.sync_adjust}s)`)});
  v('#hUndo').onclick=async()=>{if(!EPID)return;const r=await hrpc('host_undo_auto',{p_episode:EPID});if(!r.error)toast('Undo: '+r.data)};
  v('#hComics').onclick=e=>{const b=e.target.closest('button[data-act]');if(!b||!EPID)return;const id=b.closest('[data-cid]').dataset.cid,c=(ST.comics||[]).find(x=>x.id===id);if(!c)return;
    const what=c.kind==='regular'?'regular':'comic';
    if(b.dataset.act==='stage')hrpc('host_set_current_comic',{p_episode:EPID,p_comic:id});
    if(b.dataset.act==='kind'){const to=c.kind==='regular'?'bucket':'regular';hrpc('host_set_comic_kind',{p_comic:id,p_kind:to}).then(r=>{if(!r.error)toast(`${c.name} is now ${to==='regular'?'a Kill Tony regular':'a bucket pull'}`)})}
    if(b.dataset.act==='ren'){const n=prompt('Rename '+what,c.name);if(n&&n.trim())hrpc('host_rename_comic',{p_comic:id,p_name:n.trim()})}
    if(b.dataset.act==='del'&&confirm(`Delete "${c.name}"? Their votes go too, and autopilot won't add this name again tonight.`))hrpc('host_delete_comic',{p_comic:id})};
  loadAutopilot();
  v('#hReset').onclick=()=>{if(EPID&&confirm('Delete ALL votes and bets for this episode and reopen betting?'))hrpc('host_reset_episode',{p_episode:EPID})};
  v('#hOut').onclick=e=>{e.preventDefault();LS.del('bp.host.secret');host.secret=null;host.ok=false;mountHost()};
  renderHostState()}
function wireHead(){const t=hostEl.querySelector('#hToggle');t.onclick=()=>{const c=hostEl.classList.toggle('min');t.setAttribute('aria-expanded',!c);LS.set('bp.host.min',c)};if(LS.get('bp.host.min',false))hostEl.classList.add('min')}
function renderHostState(){if(!hostEl||!host.ok)return;const v=id=>hostEl.querySelector(id);const st=v('#hState');
  if(!ST){st.textContent='No episode yet: fill in a title and press “New episode”.';v('#hPick').innerHTML='';v('#hPanel').innerHTML='';v('#hComics').innerHTML='';return}
  const ep=ST.episode,c=curComic();
  st.innerHTML=`<b style="color:#fff">${esc(ep.title)}</b> · ${esc(ep.status)} · ${fmt(viewers)} watching<br>Betting ${ep.golden_ticket_at?'settled YES':ep.betting_is_open?'open':'closed'} · on stage: ${c?esc(c.name):'nobody'}`;
  const pick=v('#hPick'),sel=pick.value||ep.current_comic_id||'';
  pick.innerHTML='<option value="">— nobody on stage —</option>'+(ST.comics||[]).map(x=>`<option value="${x.id}"${x.id===sel?' selected':''}>${x.kind==='regular'?'★ ':'#'+x.ord+' '}${esc(x.name)}</option>`).join('');
  v('#hPanel').innerHTML=(ST.panel||[]).map(p=>`<div><span>${esc(p.name)} <small style="color:var(--dim)">${esc(p.role)}</small></span><button data-rm="${p.id}" title="Remove">✕</button></div>`).join('');
  if(document.activeElement!==v('#hYT'))v('#hYT').value=ep.youtube_url||'';
  if(document.activeElement!==v('#hTitle'))v('#hTitle').value=ep.title||'';
  if(document.activeElement!==v('#hStart')&&ep.starts_at)v('#hStart').value=toLocalInput(new Date(ep.starts_at));
  const tg=(id,on,txt,html)=>{const b=v(id);b.classList.toggle('on',!!on);const suf=on?' ON':' OFF';if(html!=null)b.innerHTML=html+suf;else b.textContent=txt+suf};
  tg('#hAuto',ep.auto_enabled,'AUTO');tg('#hAutoGT',ep.auto_gt,null,window.GT_TIX?GT_TIX(14):'');tg('#hAutoBet',ep.auto_betting,'BETS');
  const lastAuto=(ST.events||[]).filter(e=>e.source==='auto'&&!e.cancelled).pop();const ub=v('#hUndo');ub.disabled=!lastAuto;
  ub.textContent=lastAuto?`↶ Undo: ${lastAuto.kind==='comic'?'staged '+(((ST.comics||[]).find(c=>c.id===lastAuto.comic_id)||{}).name||'comic'):lastAuto.kind==='golden_ticket'?'golden ticket':lastAuto.kind==='betting'?'betting '+(lastAuto.data&&lastAuto.data.open?'opened':'closed'):lastAuto.kind}`:'↶ Undo last auto action';
  const order=[...(ST.comics||[])].sort((a,b)=>new Date(a.created_at||0)-new Date(b.created_at||0));
  v('#hComics').innerHTML=(ST.comics||[]).map(c=>`<div class="cm${c.id===ep.current_comic_id?' now':''}" data-cid="${c.id}"><span>${c.kind==='regular'?'<span class="tag-reg" title="Kill Tony regular">★REG</span> ':'#'+c.ord+' '}${esc(c.name)}${c.source==='auto'?`<span class="tag-auto" title="heard as: ${esc(c.heard_as||'')}">AUTO ${c.confidence!=null?Math.round(c.confidence*100)+'%':''}</span>`:''}${c.locked?'<span class="tag-lock" title="edited by host: autopilot will not change it">🔒</span>':''}</span><button data-act="stage" title="Put on stage">▶</button><button data-act="kind" title="${c.kind==='regular'?'Make bucket pull':'Make Kill Tony regular'}">⇄</button><button data-act="ren" title="Rename">✎</button><button data-act="del" title="Delete">🗑</button></div>`).join('')||'<div><span style="color:var(--dim)">No comics yet</span></div>';
  v('#hGTx').disabled=!ep.golden_ticket_at;renderAutopilot();
  v('#hEnd').textContent=ep.status==='ended'?'▶ Reopen episode (voting back on)':'🏁 End episode · show final results';
  const cl=v('#hClose');cl.disabled=!!ep.golden_ticket_at;cl.textContent=ep.golden_ticket_at?'✅ Bet settled (YES)':(ep.betting_open?'🔒 Close betting':'🔓 Reopen betting')}

/* host only: autopilot status by polling (no realtime connection anywhere) */
async function loadAutopilot(){const {data}=await sb.from('autopilot_status').select('*').eq('id',1).maybeSingle();apStatus=data;renderAutopilot();
  if(!window.__apT)window.__apT=setInterval(async()=>{if(document.visibilityState==='hidden')return;const r=await sb.from('autopilot_status').select('*').eq('id',1).maybeSingle();if(!r.error){apStatus=r.data;renderAutopilot()}},5000)}

function renderAutopilot(){if(!hostEl||!host.ok)return;const el=hostEl.querySelector('#hAP');if(!el)return;const a=apStatus;
  if(!a||!a.heartbeat_at){el.innerHTML='<span class="ap-dot bad"></span>Autopilot has not checked in yet (it starts Mondays 18:40 CST).';return}
  const age=(now()-new Date(a.heartbeat_at).getTime())/1000,cls=age<45?'ok':age<180?'warn':'bad';
  const ago=age<90?Math.round(age)+'s ago':age<5400?Math.round(age/60)+' min ago':new Date(a.heartbeat_at).toLocaleString();
  const off=a.stream_offset!=null?` · stream ${Math.floor(a.stream_offset/3600)}:${String(Math.floor(a.stream_offset%3600/60)).padStart(2,'0')}:${String(Math.floor(a.stream_offset%60)).padStart(2,'0')}`:'';
  const other=a.episode_id&&EPID&&a.episode_id!==EPID?' <i>(other episode)</i>':'';
  const inf=a.info||{},ep=ST&&ST.episode,hm=x=>x==null?'?':`${x<0?'-':''}${Math.floor(Math.abs(x)/3600)}:${String(Math.floor(Math.abs(x)%3600/60)).padStart(2,'0')}:${String(Math.floor(Math.abs(x)%60)).padStart(2,'0')}`;
  const manual=age>=180||(ep&&ep.auto_enabled===false)||inf.source==='manual'||inf.source==='searching';
  const src=manual?'Manual':inf.source==='podcast'?'Podcast':inf.source==='youtube'?'YouTube live':'?';
  let sync='';if(inf.source==='podcast'&&inf.sync){const sy=inf.sync,m={captions:'exact (YouTube captions)',anchor:'intro anchor (±1s)',default:'not synced yet'}[sy.method]||sy.method;
    sync=` · sync ${m}${sy.delta!=null?` ${sy.delta>=0?'+':''}${sy.delta}s`:''}${sy.adjust?`, host ${sy.adjust>0?'+':''}${sy.adjust}s`:''}`+
      (inf.transcribed_to!=null?`<br>Transcribed to ${hm(inf.transcribed_to)} · ${inf.queued||0} queued${inf.next_in!=null?` · next in ${hm(inf.next_in)}`:''}`:'')}
  el.innerHTML=`<span class="ap-dot ${cls}"></span>Source: <b>${src}</b>${sync}<br><b>${esc(a.state||'?')}</b>${other} · ${ago}${off.replace('stream','video')}${a.last_confidence!=null?` · conf ${Math.round(a.last_confidence*100)}%`:''}`+
    (a.last_event?`<br>Last: ${esc(a.last_event)}`:'')+(a.last_text?`<span class="snip">“…${esc(a.last_text.slice(-160))}”</span>`:'')}
/* ---------- "Last week": final results of the previous episode (one RPC, on demand) ---------- */
async function openResults(id){if(!id||!sb)return;let d;try{const r=await sb.rpc('episode_results',{p_episode:id});if(r.error)throw r.error;d=r.data}catch(e){toast('Could not load last week\u2019s results');return}
  if(!d||!d.meta){toast('Those results are not available');return}
  const m=d.meta,s=d.s||{},c=s.c||{},p=s.p||{},ep=m.episode||{},b=s.b||[0,0];
  const cm=(m.comics||[]).map(x=>{const v=c[x.id]||[0,null,0,0];return Object.assign({},x,{votes:v[0],avg:v[1],kills:v[2],bombs:v[3]})});
  const row=(x,extra)=>{const a=x.avg==null?'—':(+x.avg).toFixed(1);return `<div class="row"><span class="n">${esc(x.name)}<small>${extra}</small></span><span class="a">${a}</span></div>`};
  const kbt=x=>{const t=(+x.kills||0)+(+x.bombs||0);return t?` · 🔪${Math.round(x.kills/t*100)}% / 💣${100-Math.round(x.kills/t*100)}%`:''};
  const bp=cm.filter(x=>x.kind!=='regular').sort((a,b)=>(b.avg==null?-1:+b.avg)-(a.avg==null?-1:+a.avg)||a.ord-b.ord);
  const rg=cm.filter(x=>x.kind==='regular').sort((a,b)=>a.ord-b.ord);
  const pn=(m.panel||[]).map(x=>{const v=p[x.id]||[0,null];return Object.assign({},x,{votes:v[0],avg:v[1]})});
  const vs=n=>fmt(n)+' vote'+(n==1?'':'s');const yt=ytId(ep.youtube_url);
  const ended=ep.ended_at?new Date(ep.ended_at).toLocaleString('en-US',{timeZone:'America/Chicago',weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})+' CT':'';
  const gt=ep.golden_ticket_name?`${window.GT_TIX?GT_TIX():''} Golden ticket: <b>${esc(ep.golden_ticket_name)}</b> · the bet settled <b>YES</b>`:'No golden ticket · the bet settled <b>NO</b>';
  const el=document.createElement('div');el.className='bp-res';el.setAttribute('role','dialog');el.setAttribute('aria-label','Last week\u2019s final results');
  el.innerHTML=`<div class="box"><button class="x" aria-label="Close">×</button><h2>${esc(ep.title||'Previous episode')}</h2>
<div class="sub">Final fan results${ended?' · ended '+esc(ended):''}</div>
<div class="gt">${gt} (${fmt(b[0])} yes · ${fmt(b[1])} no)</div>
${(()=>{const r=s.r||[0,null];return r[1]==null?'':`<div class="gt">🌡️ How red was Tony? <b>${Math.round(+r[1])}°</b> ${window.BPRed?BPRed.word(Math.round(+r[1])).slice(1).reverse().join(' '):''} (${vs(+r[0]||0)})</div>`})()}
${ep.ep_num?`<div class="sub" style="margin-top:8px"><a href="?ep=${ep.ep_num}" data-go="${ep.ep_num}">🎬 Replay #${ep.ep_num} and keep voting →</a></div>`:''}
<h4>Bucket pulls</h4>${bp.length?bp.map((x,i)=>row(Object.assign({},x,{name:(i+1)+'. '+x.name}),'Comic #'+x.ord+' · '+vs(x.votes)+kbt(x))).join(''):'<div class="row">No bucket pulls</div>'}
${rg.length?'<h4>Regulars and Golden ticket winners</h4>'+rg.map(x=>row(x,vs(x.votes)+kbt(x))).join(''):''}
${pn.length?'<h4>Panel</h4>'+pn.map(x=>{const ic=iconFor(x),a=x.avg==null?null:+x.avg,k=a==null?0:Math.round(a/2);
  return `<div class="row pn"><span class="n">${esc(x.name)}<small>${esc(x.role||'')} · ${vs(x.votes)}</small></span><span class="ricons${ic!=='★'?' emo':''}${iconCls(ic)}" aria-label="${a==null?'no rating':(a/2).toFixed(1)+' of 5'}">${[1,2,3,4,5].map(j=>`<i class="${j<=k?'on':''}">${iconMarkup(ic)}</i>`).join('')}</span><span class="a">${a==null?'—':a.toFixed(1)}</span></div>`}).join(''):''}</div>`;
  const close=()=>{el.remove();document.removeEventListener('keydown',kd)},kd=e=>{if(e.key==='Escape')close()};
  el.addEventListener('click',e=>{const g=e.target.closest('[data-go]');if(g){e.preventDefault();close();goEp(g.dataset.go);return}if(e.target===el||e.target.closest('.x'))close()});document.addEventListener('keydown',kd);document.body.appendChild(el)}

/* ---------- episode switching (?ep=791) ---------- */
function setUrl(v){const u=new URL(location.href);if(v)u.searchParams.set('ep',v);else u.searchParams.delete('ep');
  if(u.href!==location.href)history.pushState(null,'',u.pathname+u.search+u.hash)}
function goEp(v,fromPop){v=v==null?null:String(v).replace(/^#/,'').trim()||null;WANT=v;if(!fromPop)setUrl(v);
  MV=-1;EPID=null;META=null;SCORES=null;ST=null;effCur=undefined;finalSel=null;
  const lb=qs('.lb');if(lb)delete lb.dataset.fw;schedule(0);window.scrollTo({top:0,behavior:'smooth'})}
function paintLiveBar(){let bar=$('bpLiveBar');const wantLive=LIVEOTHER&&LIVEOTHER.id!==EPID,back=!!WANT&&!wantLive&&!!ST&&ST.episode.status!=='live';
  if(!wantLive&&!back){if(bar)bar.remove();return}
  if(!bar){bar=document.createElement('div');bar.id='bpLiveBar';const m=qs('main');if(m)m.parentNode.insertBefore(bar,m);else document.body.prepend(bar)}
  const sig=wantLive?'L'+LIVEOTHER.id:'B';if(bar.dataset.sig===sig)return;bar.dataset.sig=sig;
  bar.className='bp-livebar'+(wantLive?'':' back');
  bar.innerHTML=wantLive?`<span>🔴 ${esc(LIVEOTHER.ep_num?'#'+LIVEOTHER.ep_num:LIVEOTHER.title||'A new episode')} is LIVE now</span><button type="button">Join the live room →</button>`
    :`<span>🎬 You're watching a replay. Votes still count.</span><button type="button">Back to the live room</button>`;
  bar.querySelector('button').onclick=()=>goEp(null)}

/* ---------- archive: every episode by show number + paste a YouTube link ---------- */
let archEl=null,reqT=null;
function parsePaste(t){t=(t||'').trim();if(!t)return null;const id=ytId(t);if(id&&/^[\w-]{11}$/.test(id)&&!/^\d+$/.test(t))return {video:id};
  const m=t.match(/^#?\s*(\d{1,5})$/)||t.match(/(?:episode|ep\.?|#)\s*(\d{1,5})\b/i);return m?{num:+m[1]}:id?{video:id}:{bad:true}}
async function openArchive(prefill){if(!sb)return;if(archEl)archEl.remove();clearTimeout(reqT);
  const el=archEl=document.createElement('div');el.className='bp-res';el.setAttribute('role','dialog');el.setAttribute('aria-label','Episode archive');
  el.innerHTML=`<div class="box"><button class="x" aria-label="Close">×</button><h2><img class="arch-ico" src="img/archive-icon.webp?v=club17" alt="" width="43" height="52" draggable="false"> Episode archive</h2>
<div class="sub">Every Kill Tony from #791 on. Votes never close: replay any episode, rate the sets, and the averages keep updating.</div>
<h4>Paste an episode</h4>
<form class="paste"><input type="text" inputmode="url" autocomplete="off" placeholder="Kill Tony YouTube link or #number" aria-label="Kill Tony YouTube link or episode number" value="${prefill?esc(String(prefill)):''}"><button type="submit">Open</button></form>
<div class="pmsg" aria-live="polite">Episodes after #791 that aren't here yet get processed automatically (about 30 to 45 min).</div>
<h4>Episodes</h4><div class="alist"><div class="row">Loading…</div></div></div>`;
  const close=()=>{clearTimeout(reqT);el.remove();if(archEl===el)archEl=null;document.removeEventListener('keydown',kd)},kd=e=>{if(e.key==='Escape')close()};
  el.addEventListener('click',e=>{const a=e.target.closest('.arow');if(a){close();goEp(a.dataset.go);return}const g=e.target.closest('[data-go]');if(g){e.preventDefault();close();goEp(g.dataset.go);return}
    if(e.target===el||e.target.closest('.x'))close()});
  document.addEventListener('keydown',kd);document.body.appendChild(el);
  const inp=el.querySelector('input'),msg=el.querySelector('.pmsg');
  const say=(h,cls)=>{msg.className='pmsg'+(cls?' '+cls:'');msg.innerHTML=h};
  el.querySelector('form').addEventListener('submit',async e=>{e.preventDefault();clearTimeout(reqT);const q=parsePaste(inp.value);
    if(!q){inp.focus();return}if(q.bad){say('That doesn\'t look like a YouTube link or an episode number.','bad');return}
    if(q.num!=null&&q.num<791){say(`Bucket Pull Live starts with <b>#791</b>, so #${q.num} isn't in the room.`,'warn');return}
    say('<span class="spin"></span>Checking…');
    const {data,error}=await sb.rpc('request_episode',{p_video:q.video||null,p_num:q.num!=null?q.num:null,p_client:CID});
    if(error){say('Could not reach the archive: '+esc(error.message),'bad');return}handleReq(data,q)});
  function handleReq(d,q){if(!el.isConnected)return;const st=d&&d.status,n=d&&d.ep_num?'#'+d.ep_num:q&&q.num?'#'+q.num:'that episode';
    if(st==='ready'||st==='done'){say(`✅ ${esc(n)} is ready. Opening…`,'ok');setTimeout(()=>{close();goEp(d.ep_num||d.episode_id)},500);return}
    if(st==='too_old'){say(`Bucket Pull Live starts with <b>#${d.min||791}</b>. Earlier episodes aren't in the room.`,'warn');return}
    if(st==='invalid'){say('That doesn\'t look like a Kill Tony YouTube link or episode number.','bad');return}
    if(st==='busy'){say('Lots of episodes are already being processed. Try again in a few minutes.','warn');return}
    if(st==='rejected'){const r=String(d.reason||'');
      say(/too_old/.test(r)?'Bucket Pull Live starts with <b>#791</b>. Earlier episodes aren\'t in the room.':/not.*kill tony|not_kill|not a kill/i.test(r)?'That link isn\'t a Kill Tony episode.':`Couldn't add ${esc(n)}: ${esc(r.replace(/^\w+:\s*/,'')||'unknown reason')}`,'bad');return}
    if(st==='pending'||st==='processing'){const w=String(d.reason||'');
      const why=/waiting/.test(w)?`${esc(n)} isn't out as a podcast yet, so we'll build it as soon as it is.`:/paused/.test(w)?'Paused while the live premiere runs; it resumes after the show.':st==='processing'?'Transcribing and lining up the comics now.':`In the queue${d.position>1?` (position ${d.position})`:''}.`;
      say(`<span class="spin"></span><b>Processing ${esc(n)}…</b> ${why} Usually 30 to 45 min. Leave this open or come back later; it'll be in the list below.`,'warn');
      reqT=setTimeout(async()=>{const r=await sb.rpc('request_status',{p_id:d.id});if(!r.error&&r.data)handleReq(r.data,q);else reqT=setTimeout(()=>handleReq(d,q),20000)},20000);return}
    say('Unexpected answer from the archive. Try again in a bit.','bad')}
  if(prefill)el.querySelector('form').requestSubmit();
  let rows=[];try{const r=await sb.rpc('episode_archive');if(r.error)throw r.error;rows=r.data||[]}catch(e){el.querySelector('.alist').innerHTML='<div class="row">Could not load the archive.</div>';return}
  const day=t=>t?new Date(t).toLocaleDateString('en-US',{timeZone:'America/Chicago',month:'short',day:'numeric',year:'numeric'}):'';
  el.querySelector('.alist').innerHTML=rows.length?rows.map(x=>{const red=x.red&&x.red[1]!=null?Math.round(+x.red[1]):null;
    return `<button type="button" class="arow${x.id===EPID?' cur':''}" data-go="${x.ep_num}"><span class="no">#${x.ep_num}</span>
<span class="t">${esc(x.title||'Episode #'+x.ep_num)}<small>${esc(day(x.starts_at))} · ${fmt(x.comics||0)} comics · ${fmt(x.votes||0)} votes${x.top&&x.top.name?` · 🏆 ${esc(x.top.name)} ${(+x.top.avg).toFixed(1)}`:''}</small></span>
<span class="rd">${x.status==='live'?'<span class="lv">● LIVE</span>':red!=null?'🌡️ '+red+'°':'🌡️ —'}<small>${x.status==='live'?'now':red!=null?window.BPRed?BPRed.word(red)[1]:'':'how red?'}</small></span></button>`}).join(''):'<div class="row">No episodes yet.</div>'}

window.BPRealtime={openArchive,goEp,get player(){return ytPlayer},get sound(){return sound.on},openResults,get final(){return FINAL()},__testPlayer(p){ytPlayer=p;timelineTick();if(ST)render()},get playerOffset(){return playerOffset()},get effectiveComicId(){return effectiveComicId()},get state(){return ST},get viewers(){return viewers},refresh:()=>poll(),get user(){return me},get polls(){return lastFetch},clientId:CID};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
