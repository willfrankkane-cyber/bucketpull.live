/* Bucket Pull Live: shared live room on Supabase (supabase-js v2, vendored in /vendor).
   Runs only when config.js has SUPABASE_URL + SUPABASE_ANON_KEY (window.BP_LIVE). Otherwise the demo stays as is.

   Data flow
   - Fans sign in anonymously; every write is their own row (RLS in supabase/schema.sql).
   - Shared numbers come from one RPC, live_state(episode). Clients re-fetch it when the tiny
     live_ticks row for the episode changes (vote triggers bump it, throttled server-side), coalesced
     client-side (~300 ms debounce + jitter that grows with the audience), plus a slow safety poll.
   - Chat rows, host episode changes (current comic, YouTube link, golden ticket, betting) arrive by
     postgres_changes; viewer count comes from Realtime presence. */
(function(){
'use strict';
if(!window.BP_LIVE)return;
const CFG=window.BP_CONFIG, $=id=>document.getElementById(id), qs=s=>document.querySelector(s);
const LS={get(k,d){try{const v=localStorage.getItem(k);return v==null?d:JSON.parse(v)}catch(e){return d}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}},del(k){try{localStorage.removeItem(k)}catch(e){}}};
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=n=>Number(n||0).toLocaleString('en-US');
const WORDS=['','yikes','rough','meh','eh','okay','decent','good','solid set','great','legendary'];
const PAL=['#ffc23d','#22e4ff','#ff4fd8','#b6ff3b','#ff7a33','#a78bff','#5fe7a3','#ff6b88','#ffd76a','#7cc4ff'];
const GRAD=[['#ffc23d','#ff6a00'],['#ff4fd8','#8b5cff'],['#22e4ff','#2b6bff'],['#b6ff3b','#14b86a'],['#ff7a33','#ff2d55'],['#a78bff','#5b3cff']];
const colorFor=id=>{let h=0;for(const c of String(id))h=(h*31+c.charCodeAt(0))|0;return PAL[Math.abs(h)%PAL.length]};
const initials=n=>(String(n).trim().split(/\s+/).map(w=>w[0]).join('').slice(0,2)||'?').toUpperCase();

/* ---------- live-mode styling + copy (sample data goes away) ---------- */
const css=document.createElement('style');css.textContent=`
.quick button.picked{outline:2px solid #fff;outline-offset:2px}
.rate button:disabled,.quick button:disabled{opacity:.45;cursor:not-allowed}
.lb .empty,.panel-list .empty{padding:14px 10px;color:var(--dim);font-size:12.5px;text-align:center}
.bp-toast{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:120;background:rgba(20,15,28,.95);border:1px solid rgba(255,255,255,.18);color:#fff;
  padding:9px 14px;border-radius:12px;font-size:13px;font-weight:600;box-shadow:0 10px 30px rgba(0,0,0,.5);transition:opacity .3s}
.player .yt-embed{position:absolute;inset:0;z-index:3;background:#000}
.player .yt-embed iframe{width:100%;height:100%;border:0;display:block}
.player .yt-out{position:absolute;right:10px;top:10px;z-index:4;font-size:11.5px;font-weight:700;color:#fff;background:rgba(0,0,0,.6);padding:5px 9px;border-radius:8px;text-decoration:none}
.player.has-yt .play,.player.has-yt .mic,.player.has-yt .bar,.player.has-yt .yt-top{display:none}
.m .mod-x{margin-left:6px;opacity:0;font-size:11px;background:rgba(255,255,255,.08);border-radius:6px;padding:1px 5px;color:#fff}
.m:hover .mod-x{opacity:1}
.bp-nick{position:fixed;inset:0;z-index:130;display:grid;place-items:center;background:rgba(5,3,10,.7);backdrop-filter:blur(6px)}
.bp-nick form{width:min(340px,92vw);background:#16111f;border:1px solid rgba(255,255,255,.14);border-radius:18px;padding:18px;display:flex;flex-direction:column;gap:10px}
.bp-nick h4{margin:0;font-family:var(--display);font-size:20px;letter-spacing:.03em}
.bp-nick p{margin:0;font-size:12.5px;color:var(--mute)}
.bp-nick input{height:40px;border-radius:10px;background:rgba(255,255,255,.07);border:1px solid var(--line);color:var(--ink);padding:0 12px;font:600 14px var(--body)}
.bp-nick .row{display:flex;gap:8px;justify-content:flex-end}
.bp-nick button{height:36px;padding:0 14px;border-radius:10px;font-weight:700}
.bp-nick button[type=submit]{background:linear-gradient(90deg,#ff4fd8,#8b5cff);color:#fff}
.host.live-host{width:300px;max-height:calc(100vh - 32px);overflow:auto}
@media (min-width:1100px){.host.live-host{right:auto;left:16px}} /* keep the chat column (and its 🗑/🔇 moderation buttons) clear */
.host .h-row{display:flex;gap:6px}.host .h-row>*{flex:1;min-width:0}
.host select,.host .h-fld input[type=datetime-local]{height:34px;border-radius:9px;background:rgba(255,255,255,.07);border:1px solid var(--line);color:var(--ink);padding:0 8px;font:600 12.5px var(--body)}
.host .h-sec{font-size:10.5px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--gold);margin-top:6px}
.host .h-btn.ok{background:rgba(182,255,59,.12);border-color:rgba(182,255,59,.35);color:#e6ffc4}
.host .h-list{display:flex;flex-direction:column;gap:3px;font-size:12px}
.host .h-list div{display:flex;justify-content:space-between;align-items:center;background:rgba(255,255,255,.04);border-radius:8px;padding:3px 8px}
.host .h-err{color:#ff9db0;font-size:11.5px;min-height:14px}
.lb li.empty{display:block;font-size:12.5px;color:var(--mute);text-align:center;padding:14px 10px;line-height:1.4}`;
document.head.appendChild(css);
const epEl=qs('.ep');if(epEl)epEl.innerHTML='<strong>Connecting…</strong>Live fan room';
const foot=qs('.foot');if(foot&&foot.firstChild&&foot.firstChild.nodeType===3)foot.firstChild.textContent='Unofficial fan-made live room · not affiliated with or endorsed by the show · votes, chat and counts are from real fans in the room';
const ms=$('msgs');if(ms)ms.innerHTML='';
const vc=$('vc');if(vc)vc.textContent='—';
const chatPill=qs('.chat .pill');if(chatPill)chatPill.textContent='live';
const pinned=qs('.pinned');if(pinned)pinned.innerHTML='📌 <b>Mod:</b> Be cool. Rate the set, not the person. Slow mode is on (1 message / 3 s).';
const slow=qs('.emoji-row .slow');if(slow)slow.textContent='Slow mode · 3s';
const fl=$('floaters');if(fl)fl.innerHTML='';

let toastT;function toast(t){let e=qs('.bp-toast');if(!e){e=document.createElement('div');e.className='bp-toast';document.body.appendChild(e)}
  e.textContent=t;e.style.opacity=1;clearTimeout(toastT);toastT=setTimeout(()=>e.style.opacity=0,2800)}
function sysMsg(html,empty){if(!ms)return;const d=document.createElement('div');d.className='m sys'+(empty?' empty':'');d.innerHTML=`<span>${html}</span>`;ms.appendChild(d);trimChat()}
function trimChat(){while(ms&&ms.children.length>60)ms.removeChild(ms.firstChild)}

/* ---------- load supabase-js only in live mode ---------- */
function loadLib(){return new Promise((ok,ko)=>{if(window.supabase&&window.supabase.createClient)return ok();
  const s=document.createElement('script');s.src='vendor/supabase-js-2.118.0.js';s.onload=ok;s.onerror=()=>ko(new Error('could not load supabase-js'));document.head.appendChild(s)})}

let sb,me=null,ST=null,EPID=null,chan=null,room=null,viewers=0,serverSkew=0,lastGT=null,localGTUntil=0,lastFetch=0;
const host={on:LS.get('bp.host',false),secret:LS.get('bp.host.secret',null),ok:false};
const pending={bet:0};
const hist=[];          // [{t,comic,avg}] for the "last 30s" delta

async function boot(){
  try{await loadLib()}catch(e){epEl&&(epEl.innerHTML='<strong>Offline</strong>Could not load the live room');toast('Live room unavailable right now');return}
  sb=window.supabase.createClient(CFG.SUPABASE_URL,CFG.SUPABASE_ANON_KEY,{auth:{persistSession:true,autoRefreshToken:true,storageKey:'bp.auth'},realtime:{params:{eventsPerSecond:10}}});
  let {data:{session}}=await sb.auth.getSession();
  if(!session){const r=await sb.auth.signInAnonymously();if(r.error){console.warn('anonymous sign-in failed',r.error);toast('Read-only: sign-in failed ('+r.error.message+')')}else session=r.data.session}
  me=session&&session.user?session.user:null;
  if(me&&!LS.get('bp.nick',null)){const n=me.user_metadata&&me.user_metadata.nick;if(n)LS.set('bp.nick',n)}
  paintMe();wireInputs();joinPresence();
  if(host.on)mountHost();
  await fetchState(true);
  setInterval(()=>{if(document.visibilityState==='visible'&&Date.now()-lastFetch>15000)fetchState()},5000);
  setInterval(tickClock,1000);
}

/* ---------- shared state ---------- */
let refreshT=null,inflight=false,again=false;
function scheduleRefresh(fast){if(refreshT)return;const jitter=fast?0:Math.random()*Math.min(2500,viewers*0.6);
  refreshT=setTimeout(()=>{refreshT=null;fetchState()},(fast?120:300)+jitter)}
async function fetchState(first){
  if(inflight){again=true;return}inflight=true;lastFetch=Date.now();
  try{const {data,error}=await sb.rpc('live_state',{p_episode:null});if(error)throw error;apply(data,first)}
  catch(e){console.warn('live_state',e);if(first)toast('Could not reach the live room')}
  finally{inflight=false;if(again){again=false;scheduleRefresh(true)}}}

function apply(d,first){
  if(d&&d.server_time)serverSkew=new Date(d.server_time).getTime()-Date.now();
  const ep=d&&d.episode;
  if(!ep){ST=null;renderNoEpisode();if(EPID!==null||first){EPID=null;subscribe(null)}return}
  const changedEp=ep.id!==EPID;ST=d;
  if(changedEp){EPID=ep.id;subscribe(ep.id);loadChat();lastGT=ep.golden_ticket_at;hist.length=0}
  render();
  if(ep.golden_ticket_at&&ep.golden_ticket_at!==lastGT){lastGT=ep.golden_ticket_at;maybeGolden(ep)}
  else lastGT=ep.golden_ticket_at;
  if(host.ok)renderHostState();
  if(window.BPLive&&BPLive.renderTicker)try{BPLive.renderTicker()}catch(e){}}

function now(){return Date.now()+serverSkew}
function curComic(){if(!ST)return null;const id=ST.episode.current_comic_id;return (ST.comics||[]).find(c=>c.id===id)||null}

function renderNoEpisode(){epEl&&(epEl.innerHTML='<strong>No live episode yet</strong>The room opens when the host starts one');
  setComic(null);const lb=qs('.lb');if(lb)lb.innerHTML='<li class="empty">Scores show up here once the host puts comics on stage.</li>';
  const p=$('panel');if(p)p.innerHTML='<div class="empty">The panel appears when the episode starts.</div>';
  window.BPLive&&BPLive.applyRemote({id:'none',yes:0,no:0,open:false,resolved:false,pick:null,conf:null});setPlayer(null);
  const pp=qs('.panelcard .pill');if(pp)pp.textContent='avg —';
  const yt=qs('.yt-top>div:nth-child(2)');if(yt)yt.innerHTML=`Waiting for the premiere<small>Unofficial fan room · ${fmt(viewers)} watching</small>`;
  if(window.BPLive&&BPLive.renderTicker)try{BPLive.renderTicker()}catch(e){}}

function render(){const ep=ST.episode;
  if(epEl)epEl.innerHTML=`<strong>${esc(ep.title)}</strong>${ep.status==='live'?'Live · real fan votes':'Episode ended'}`;
  const yt=qs('.yt-top>div:nth-child(2)');if(yt)yt.innerHTML=`${esc(ep.title)}<small>Unofficial fan room · ${fmt(viewers)} watching</small>`;
  setComic(curComic());renderBoard();renderPanel();renderBetState();setPlayer(ep.youtube_url)}

function setComic(c){
  const num=qs('.comic .num'),who=qs('.comic .who'),pill=qs('.onstage .pill');
  const live=ST&&ST.episode.status==='live';
  document.querySelectorAll('#rate button,.quick button').forEach(b=>b.disabled=!c||!live);
  if(!c){if(num)num.textContent='–';if(who)who.innerHTML='<small>Waiting for the bucket</small><b>No comic on stage</b><span>Ratings open when the host puts a comic up</span>';
    if(pill){pill.textContent='Waiting';pill.classList.remove('hot')}
    $('avg').innerHTML='—<small>/10</small>';$('votes').textContent='0';setDist([0,0,0,0,0,0,0,0,0,0]);setKB(0,0);$('mine').textContent='—';
    document.querySelectorAll('#rate button').forEach(b=>b.classList.remove('on'));const m=qs('.avg-meta b');if(m)m.textContent='';return}
  if(num)num.textContent=c.ord;if(who)who.innerHTML=`<small>Comic #${c.ord} · Bucket Pull</small><b>${esc(c.name)}</b><span>On stage now</span>`;
  if(pill){pill.textContent=live?'● Rating open':'Rating closed';pill.classList.toggle('hot',live)}
  const avg=c.avg==null?null:Number(c.avg);
  $('avg').innerHTML=`${avg==null?'—':avg.toFixed(1)}<small>/10</small>`;$('votes').textContent=fmt(c.votes);
  // delta vs ~30 s ago
  const t=Date.now();if(avg!=null)hist.push({t,comic:c.id,avg});while(hist.length&&t-hist[0].t>40000)hist.shift();
  const old=hist.find(h=>h.comic===c.id&&t-h.t>=25000);const m=qs('.avg-meta b');
  if(m){if(old&&avg!=null){const dd=avg-old.avg;m.textContent=(dd>=0?'▲ ':'▼ ')+Math.abs(dd).toFixed(1)}else m.textContent='Live'}
  setDist(c.dist||[]);setKB(c.kills,c.bombs);
  const mine=ST.me&&ST.me.votes?ST.me.votes[c.id]:null;
  document.querySelectorAll('#rate button').forEach((b,i)=>b.classList.toggle('on',mine===i+1));
  $('mine').textContent=mine?mine+' · '+WORDS[mine]:'tap a number';
  const kb=ST.me&&ST.me.kb?ST.me.kb[c.id]:null;qs('.quick .kill').classList.toggle('picked',kb==='kill');qs('.quick .bomb').classList.toggle('picked',kb==='bomb')}

function setDist(d){const bars=[...document.querySelectorAll('#dist i')];const mx=Math.max(0,...d);bars.forEach((b,i)=>{b.style.height=(mx?(d[i]||0)/mx*100:0)+'%';b.title=`${fmt(d[i]||0)} × ${i+1}`})}
function setKB(k,b){k=+k||0;b=+b||0;const tot=k+b,pk=tot?Math.round(k/tot*100):50;
  qs('.quick .kill small').textContent=tot?pk+'%':'–';qs('.quick .bomb small').textContent=tot?(100-pk)+'%':'–';
  qs('.killmeter .k').style.width=pk+'%';qs('.killmeter .b').style.width=(100-pk)+'%';
  const l=document.querySelectorAll('.km-l span');if(l[0]){l[0].textContent=fmt(k)+' say kill';l[1].textContent=fmt(b)+' say bomb'}}

function renderBoard(){const lb=qs('.lb');if(!lb)return;const cs=(ST.comics||[]).slice();
  if(!cs.length){lb.innerHTML='<li class="empty">No comics yet. Scores show up here as the bucket gets pulled.</li>';return}
  cs.sort((a,b)=>(b.avg==null?-1:+b.avg)-(a.avg==null?-1:+a.avg)||a.ord-b.ord);
  lb.innerHTML=cs.map((c,i)=>{const now=c.id===ST.episode.current_comic_id,a=c.avg==null?null:+c.avg;
    return `<li${now?' class="now"':''}><span class="rk">${i+1}</span><span class="nm">${esc(c.name)}${now?' <span class="tag live">LIVE</span>':''}<small>Comic #${c.ord} · ${fmt(c.votes)} vote${c.votes==1?'':'s'}</small></span><span class="sc"><span class="mini"><i style="width:${a==null?0:a*10}%"></i></span>${a==null?'—':a.toFixed(1)}</span></li>`}).join('')}

function renderPanel(){const el=$('panel');if(!el)return;const ps=ST.panel||[];
  if(!ps.length){el.innerHTML='<div class="empty">No panel yet.</div>';qs('.panelcard .pill').textContent='avg —';return}
  const mine=ST.me&&ST.me.panel||{};
  el.innerHTML=ps.map((p,k)=>{const g=GRAD[k%GRAD.length],a=p.avg==null?null:+p.avg,my=mine[p.id]?Math.round(mine[p.id]/2):0;
    return `<div class="pm" data-id="${p.id}"><div class="av" style="--g:linear-gradient(135deg,${g[0]},${g[1]});--rc:${g[0]}">${esc(initials(p.name))}</div>
<div class="info"><b>${esc(p.name)}</b><small>${esc(p.role)}</small><div class="stars" data-id="${p.id}">${[1,2,3,4,5].map(j=>`<button class="${j<=my?'on':''}" data-v="${j}" aria-label="${j} star${j>1?'s':''} for ${esc(p.name)}">★</button>`).join('')}</div></div>
<div class="avg">${a==null?'—':a.toFixed(1)}<small>${fmt(p.votes)} vote${p.votes==1?'':'s'}</small></div></div>`}).join('');
  const rated=ps.filter(p=>p.avg!=null);qs('.panelcard .pill').textContent=rated.length?'avg '+(rated.reduce((s,p)=>s+ +p.avg,0)/rated.length).toFixed(1):'avg —'}

function renderBetState(){if(!window.BPLive||!BPLive.applyRemote)return;const ep=ST.episode,b=ST.bet||{yes:0,no:0};
  const o={id:ep.id,start:new Date(ep.starts_at),yes:+b.yes||0,no:+b.no||0,open:!!ep.betting_is_open,resolved:!!ep.golden_ticket_at,gtName:ep.golden_ticket_name};
  if(!pending.bet){const mb=ST.me&&ST.me.bet;o.pick=mb?mb.pick:null;o.conf=mb?mb.confidence:null}
  BPLive.applyRemote(o)}

/* ---------- YouTube premiere ---------- */
let ytCur=null;
function ytId(u){if(!u)return null;try{const x=new URL(u.trim());const h=x.hostname.replace(/^www\.|^m\./,'');
  if(h==='youtu.be')return x.pathname.slice(1).split('/')[0]||null;
  if(/(^|\.)youtube(-nocookie)?\.com$/.test(h)){if(x.searchParams.get('v'))return x.searchParams.get('v');const m=x.pathname.match(/^\/(embed|live|shorts|v)\/([\w-]{6,})/);return m?m[2]:null}}catch(e){}
  return /^[\w-]{11}$/.test(u.trim())?u.trim():null}
function setPlayer(url){const pl=qs('.player');if(!pl)return;const id=ytId(url);if(id===ytCur)return;ytCur=id;
  pl.querySelectorAll('.yt-embed,.yt-out').forEach(e=>e.remove());pl.classList.toggle('has-yt',!!id);if(!id)return;
  const w=document.createElement('div');w.className='yt-embed';
  w.innerHTML=`<iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1&mute=1&playsinline=1&rel=0&modestbranding=1" title="Kill Tony premiere on YouTube" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
  const a=document.createElement('a');a.className='yt-out';a.href='https://www.youtube.com/watch?v='+encodeURIComponent(id);a.target='_blank';a.rel='noopener';
  a.textContent='Watch on YouTube ↗';a.title='If the video says embedding is disabled, open it on YouTube';pl.append(w,a)}

/* ---------- golden ticket on every screen ---------- */
function maybeGolden(ep){const age=now()-new Date(ep.golden_ticket_at).getTime();
  if(age>60000)return;                        // late joiners don't get an old takeover
  if(Date.now()<localGTUntil)return;          // the host's own screen already fired it
  window.triggerGoldenTicket&&window.triggerGoldenTicket(ep.golden_ticket_name||'')}

/* ---------- clock on the comic card ---------- */
function tickClock(){const tm=$('tm'),sm=qs('.comic .timer small');if(!tm)return;const ep=ST&&ST.episode;
  if(!ep||!ep.current_comic_at||!curComic()){tm.textContent='–:––';if(sm)sm.textContent='ON STAGE';return}
  const s=Math.max(0,(now()-new Date(ep.current_comic_at).getTime())/1000|0);tm.textContent=(s/60|0)+':'+String(s%60).padStart(2,'0');if(sm)sm.textContent='ON STAGE'}

/* ---------- realtime subscriptions ---------- */
function subscribe(epId){if(chan){sb.removeChannel(chan);chan=null}
  chan=sb.channel('bp-db-'+(epId||'none'))
    .on('postgres_changes',{event:'*',schema:'public',table:'episodes'},p=>{const n=p.new||{};
      if(p.eventType==='INSERT'||!EPID||n.id!==EPID){scheduleRefresh(true);return}
      // fast path for host actions on the current episode
      if(ST){Object.assign(ST.episode,n);if(n.golden_ticket_at&&n.golden_ticket_at!==lastGT){lastGT=n.golden_ticket_at;ST.episode.betting_is_open=false;maybeGolden(n)}render()}
      scheduleRefresh(true)});
  if(epId){const f='episode_id=eq.'+epId;
    chan.on('postgres_changes',{event:'*',schema:'public',table:'live_ticks',filter:f},()=>scheduleRefresh())
      .on('postgres_changes',{event:'*',schema:'public',table:'comics',filter:f},()=>scheduleRefresh(true))
      .on('postgres_changes',{event:'*',schema:'public',table:'panelists',filter:f},()=>scheduleRefresh(true))
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'chat_messages',filter:f},p=>addChat(p.new))
      .on('postgres_changes',{event:'UPDATE',schema:'public',table:'chat_messages',filter:f},p=>{if(p.new&&p.new.deleted)dropChat(p.new.id)})}
  chan.subscribe(s=>{if(s==='SUBSCRIBED')scheduleRefresh(true);if(s==='CHANNEL_ERROR'||s==='TIMED_OUT')console.warn('realtime',s)})}

function joinPresence(){room=sb.channel('bp-room',{config:{presence:{key:me?me.id:'anon-'+Math.random().toString(36).slice(2)}}});
  const upd=()=>{viewers=Object.keys(room.presenceState()).length;if(vc)vc.textContent=fmt(viewers);const s=qs('.yt-top small');if(s)s.textContent=`Unofficial fan room · ${fmt(viewers)} watching`;
    if(window.BPLive&&BPLive.renderTicker)try{BPLive.renderTicker()}catch(e){}};
  room.on('presence',{event:'sync'},upd).subscribe(async s=>{if(s==='SUBSCRIBED')await room.track({at:new Date().toISOString()})})}

/* ---------- chat ---------- */
const seen=new Set();let rate=[];
async function loadChat(){if(!ms)return;ms.innerHTML='';seen.clear();if(!EPID)return;
  const {data,error}=await sb.from('chat_messages').select('id,voter_id,nickname,body,deleted,created_at').eq('episode_id',EPID).eq('deleted',false).order('id',{ascending:false}).limit(40);
  if(error){console.warn(error);return}
  data.reverse().forEach(addChat);if(!data.length)sysMsg('🪣 <b>Chat is live.</b> Be the first to say something.',true)}
function addChat(m){if(!ms||!m||m.deleted||seen.has(m.id))return;seen.add(m.id);rate.push(Date.now());
  const c=colorFor(m.voter_id),mine=me&&m.voter_id===me.id;const d=document.createElement('div');d.className='m';d.dataset.id=m.id;d.style.setProperty('--hc',c);
  d.innerHTML=`<div class="a">${esc(initials(m.nickname))}</div><div>${mine?'<span class="badge sub">YOU</span>':''}<span class="u">${esc(m.nickname)}</span><span class="t">${esc(m.body)}</span>${host.ok?`<button class="mod-x" data-del="${m.id}" title="Delete message">🗑</button><button class="mod-x" data-mute="${esc(m.voter_id)}" data-nick="${esc(m.nickname)}" title="Mute this fan">🔇</button>`:''}</div>`;
  ms.querySelectorAll('.m.sys.empty').forEach(e=>e.remove());
  // keep id order even when realtime events arrive out of order
  let nx=null;for(const e of ms.querySelectorAll('.m[data-id]')){if(+e.dataset.id>m.id){nx=e;break}}
  if(nx)ms.insertBefore(d,nx);else ms.appendChild(d);trimChat()}
function dropChat(id){const e=ms&&ms.querySelector(`.m[data-id="${id}"]`);if(e)e.remove()}
setInterval(()=>{const t=Date.now();rate=rate.filter(x=>t-x<60000);if(chatPill)chatPill.textContent=rate.length+'/min'},5000);

function nick(){return LS.get('bp.nick',null)}
function askNick(then){if(qs('.bp-nick'))return;const o=document.createElement('div');o.className='bp-nick';
  o.innerHTML=`<form><h4>PICK A NICKNAME</h4><p>Shown next to your chat messages. Saved on this device.</p><input maxlength="24" required placeholder="e.g. bucketboi_99" value="${esc(nick()||'')}"><div class="row"><button type="button" class="cx">Cancel</button><button type="submit">Save</button></div></form>`;
  document.body.appendChild(o);const i=o.querySelector('input');setTimeout(()=>i.focus(),30);
  o.querySelector('.cx').onclick=()=>o.remove();
  o.querySelector('form').onsubmit=e=>{e.preventDefault();const v=i.value.replace(/\s+/g,' ').trim().slice(0,24);if(!v)return;LS.set('bp.nick',v);paintMe();o.remove();
    if(me)sb.auth.updateUser({data:{nick:v}}).catch(()=>{});then&&then()}}
function paintMe(){const s=qs('.me span');if(s)s.textContent=nick()?initials(nick()):'🙂';const m=qs('.me');if(m){m.title='Change nickname';m.style.cursor='pointer'}}

let lastSend=0;
async function send(){const i=$('ci');const body=i.value.trim();if(!body)return;
  if(!me){toast('Chat needs sign-in; refresh to try again');return}
  if(!nick()){askNick(send);return}
  if(ST&&ST.me&&ST.me.muted){toast('You are muted in this room');return}
  if(Date.now()-lastSend<3000){toast('Slow mode: 1 message every 3 seconds');return}
  if(!EPID){toast('Chat opens when the episode starts');return}
  lastSend=Date.now();i.value='';
  const {data,error}=await sb.from('chat_messages').insert({episode_id:EPID,nickname:nick(),body:body.slice(0,200)}).select('id,voter_id,nickname,body,deleted,created_at').single();
  if(error){i.value=body;toast(/slow mode/i.test(error.message)?'Slow mode: 1 message every 3 seconds':/muted/i.test(error.message)?'You are muted in this room':'Message not sent: '+error.message);return}
  addChat(data)}

/* ---------- fan inputs ---------- */
function needSession(){if(!me){toast('Votes need sign-in; refresh to try again');return false}return true}
function wireInputs(){
  $('send').onclick=send;$('ci').addEventListener('keydown',e=>{if(e.key==='Enter')send()});$('ci').maxLength=200;
  $('ci').addEventListener('focus',()=>{if(!nick())askNick()},{once:true});
  document.querySelectorAll('.emoji-row button').forEach(b=>b.addEventListener('click',()=>{const i=$('ci');i.value=(i.value+' '+b.textContent).trim();i.focus()}));
  const meEl=qs('.me');if(meEl)meEl.addEventListener('click',()=>askNick());
  // rating 1-10
  document.querySelectorAll('#rate button').forEach((b,i)=>b.addEventListener('click',async()=>{const c=curComic();if(!c||!needSession())return;const score=i+1;
    if(ST.me){ST.me.votes=ST.me.votes||{};ST.me.votes[c.id]=score}
    const {error}=await sb.from('comic_votes').upsert({episode_id:EPID,comic_id:c.id,voter_id:me.id,score},{onConflict:'comic_id,voter_id'});
    if(error){toast('Vote not saved: '+error.message);return}scheduleRefresh(true)}));
  // KILL / BOMB
  document.querySelectorAll('.quick button').forEach(b=>b.addEventListener('click',async()=>{const c=curComic();if(!c||!needSession())return;const verdict=b.classList.contains('kill')?'kill':'bomb';
    if(ST.me){ST.me.kb=ST.me.kb||{};ST.me.kb[c.id]=verdict}setComic(c);
    const {error}=await sb.from('kill_bomb').upsert({episode_id:EPID,comic_id:c.id,voter_id:me.id,verdict},{onConflict:'comic_id,voter_id'});
    if(error){toast('Vote not saved: '+error.message);return}scheduleRefresh(true)}));
  // panel stars (1-5 stars stored as 2-10)
  $('panel').addEventListener('click',async e=>{const b=e.target.closest('.stars button');if(!b||!needSession()||!ST)return;const id=b.parentElement.dataset.id,v=+b.dataset.v;
    b.parentElement.querySelectorAll('button').forEach((x,j)=>x.classList.toggle('on',j<v));if(window.burst)burst(e.clientX,e.clientY,'#ffc23d','⭐','');
    if(ST.me){ST.me.panel=ST.me.panel||{};ST.me.panel[id]=v*2}
    const {error}=await sb.from('panel_votes').upsert({episode_id:EPID,panelist_id:id,voter_id:me.id,score:v*2},{onConflict:'panelist_id,voter_id'});
    if(error){toast('Vote not saved: '+error.message);return}scheduleRefresh(true)});
  // golden ticket bet (live.js owns the UI and calls this)
  if(window.BPLive)BPLive.onPick=async(pick,conf)=>{if(!needSession()||!EPID)return;pending.bet++;
    try{const q=pick?sb.from('bets').upsert({episode_id:EPID,voter_id:me.id,pick,confidence:conf||null},{onConflict:'episode_id,voter_id'})
                    :sb.from('bets').delete().eq('episode_id',EPID).eq('voter_id',me.id);
      const {error}=await q;if(error)toast(/row-level security/i.test(error.message)?'Betting is closed':'Bet not saved: '+error.message)}
    finally{pending.bet--;scheduleRefresh(true)}};
  // host moderation buttons in chat
  ms&&ms.addEventListener('click',async e=>{const d=e.target.closest('[data-del]'),m=e.target.closest('[data-mute]');if(!host.ok||(!d&&!m))return;
    if(d){const {error}=await hrpc('host_delete_message',{p_id:+d.dataset.del});if(!error)dropChat(+d.dataset.del)}
    if(m&&confirm(`Mute ${m.dataset.nick}? Their recent messages are removed too.`)){const {error}=await hrpc('host_mute',{p_voter:m.dataset.mute,p_muted:true,p_purge:true});if(!error)toast(m.dataset.nick+' muted')}});
}

/* ---------- host panel (?host=1) ---------- */
let hostEl=null;
async function hrpc(fn,args){const r=await sb.rpc(fn,Object.assign({p_secret:host.secret},args||{}));
  if(r.error){const e=hostEl&&hostEl.querySelector('.h-err');if(e)e.textContent=r.error.message;toast('Host action failed: '+r.error.message);if(/not authorized/.test(r.error.message)){host.ok=false;LS.del('bp.host.secret');mountHost()}}
  else{const e=hostEl&&hostEl.querySelector('.h-err');if(e)e.textContent='';scheduleRefresh(true)}return r}
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
    <div class="h-sec">On stage</div>
    <div class="h-row"><input id="hComic" maxlength="60" placeholder="Comic name" class="h-in"><button class="h-btn ok" id="hAdd" style="flex:none;padding:0 10px">Add + stage</button></div>
    <div class="h-row"><select id="hPick"></select><button class="h-btn" id="hSetCur" style="flex:none;padding:0 10px">Stage</button></div>
    <div class="h-sec">Premiere</div>
    <div class="h-row"><input id="hYT" placeholder="YouTube link" class="h-in"><button class="h-btn ok" id="hYTSet" style="flex:none;padding:0 10px">Set</button></div>
    <div class="h-sec">Golden ticket</div>
    <label class="h-fld"><input id="hName" maxlength="60" placeholder="Winner name (default: comic on stage)"></label>
    <button class="h-gt" id="hGT">🎟️ GOLDEN TICKET!</button>
    <button class="h-btn" id="hClose">🔒 Close betting</button>
    <div class="h-sec">Panel</div>
    <div class="h-list" id="hPanel"></div>
    <div class="h-row"><input id="hPName" maxlength="40" placeholder="Guest name" class="h-in"><input id="hPRole" maxlength="40" placeholder="Role" class="h-in" style="max-width:80px"><button class="h-btn ok" id="hPAdd" style="flex:none;padding:0 8px">Add</button></div>
    <div class="h-sec">Episode</div>
    <label class="h-fld"><span>Title</span><input id="hTitle" maxlength="120" placeholder="Episode #…"></label>
    <label class="h-fld"><span>Starts (bets auto-close 15 min later)</span><input id="hStart" type="datetime-local"></label>
    <div class="h-row"><button class="h-btn ok" id="hSave">Save</button><button class="h-btn ok" id="hNew">＋ New episode</button></div>
    <button class="h-btn ghost" id="hReset">↺ Reset this episode's votes, bets & chat</button>
    <div class="h-err"></div>
    <div class="h-foot"><span>Mods: 🗑 / 🔇 on chat</span><a href="#" id="hOut">Log out</a> <a href="?host=0">Exit</a></div></div>`;
  document.body.appendChild(hostEl);wireHead();
  hostEl.querySelectorAll('.h-in').forEach(i=>{i.style.cssText='height:34px;border-radius:9px;background:rgba(255,255,255,.07);border:1px solid var(--line);color:var(--ink);padding:0 10px;font:600 12.5px var(--body);outline:0'});
  const v=id=>hostEl.querySelector(id);
  v('#hStart').value=toLocalInput(nextPremiereISO());
  v('#hAdd').onclick=async()=>{const n=v('#hComic').value.trim();if(!n||!EPID)return;const r=await hrpc('host_add_comic',{p_episode:EPID,p_name:n,p_make_current:true});if(!r.error)v('#hComic').value=''};
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
  v('#hReset').onclick=()=>{if(EPID&&confirm('Delete ALL votes, bets and chat for this episode and reopen betting?'))hrpc('host_reset_episode',{p_episode:EPID})};
  v('#hOut').onclick=e=>{e.preventDefault();LS.del('bp.host.secret');host.secret=null;host.ok=false;mountHost()};
  if(ms)[...ms.children].forEach(()=>{});loadChat();renderHostState()}
function wireHead(){const t=hostEl.querySelector('#hToggle');t.onclick=()=>{const c=hostEl.classList.toggle('min');t.setAttribute('aria-expanded',!c);LS.set('bp.host.min',c)};if(LS.get('bp.host.min',false))hostEl.classList.add('min')}
function renderHostState(){if(!hostEl||!host.ok)return;const v=id=>hostEl.querySelector(id);const st=v('#hState');
  if(!ST){st.textContent='No episode yet: fill in a title and press “New episode”.';v('#hPick').innerHTML='';v('#hPanel').innerHTML='';return}
  const ep=ST.episode,c=curComic();
  st.innerHTML=`<b style="color:#fff">${esc(ep.title)}</b> · ${esc(ep.status)} · ${fmt(viewers)} watching<br>Betting ${ep.golden_ticket_at?'settled YES':ep.betting_is_open?'open':'closed'} · on stage: ${c?esc(c.name):'nobody'}`;
  const pick=v('#hPick'),sel=pick.value||ep.current_comic_id||'';
  pick.innerHTML='<option value="">— nobody on stage —</option>'+(ST.comics||[]).map(x=>`<option value="${x.id}"${x.id===sel?' selected':''}>#${x.ord} ${esc(x.name)}</option>`).join('');
  v('#hPanel').innerHTML=(ST.panel||[]).map(p=>`<div><span>${esc(p.name)} <small style="color:var(--dim)">${esc(p.role)}</small></span><button data-rm="${p.id}" title="Remove">✕</button></div>`).join('');
  if(document.activeElement!==v('#hYT'))v('#hYT').value=ep.youtube_url||'';
  if(document.activeElement!==v('#hTitle'))v('#hTitle').value=ep.title||'';
  if(document.activeElement!==v('#hStart')&&ep.starts_at)v('#hStart').value=toLocalInput(new Date(ep.starts_at));
  const cl=v('#hClose');cl.disabled=!!ep.golden_ticket_at;cl.textContent=ep.golden_ticket_at?'✅ Bet settled (YES)':(ep.betting_open?'🔒 Close betting':'🔓 Reopen betting')}

window.BPRealtime={get state(){return ST},get viewers(){return viewers},refresh:()=>fetchState(),get user(){return me}};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
