/* Bucket Pull LIVE: host controls, Golden Ticket takeover and the Golden Ticket bet.
   There is no realtime backend yet. A future realtime handler can call the same public API:
     window.triggerGoldenTicket(name)   full-screen takeover + resolves the bet to YES
     window.BPLive.closeBetting(reason) close the bet ('host' | 'timer' | 'remote')
     window.BPLive.resetEpisode()       clear this episode's bet state                   */
(function(){
'use strict';
let hostEl=null;
const LIVE=!!window.BP_LIVE;   // live mode: realtime.js feeds shared state in through BPLive.applyRemote()
const reduce=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
const $=id=>document.getElementById(id);
const LS={get(k,d){try{const v=localStorage.getItem(k);return v==null?d:JSON.parse(v)}catch(e){return d}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}},del(k){try{localStorage.removeItem(k)}catch(e){}}};

/* ---------- episode clock (Mondays 8:00 PM America/Chicago) ---------- */
const CLOSE_AFTER_MIN=15, EPISODE_WINDOW_H=6;
const chi=new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',hour12:false,weekday:'short',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
const parts=d=>Object.fromEntries(chi.formatToParts(d).map(x=>[x.type,x.value]));
/* The episode = the first Monday 8 PM CT premiere whose start + 6h is still in the future. */
function currentEpisode(now=new Date()){
  const from=new Date(now.getTime()-EPISODE_WINDOW_H*3.6e6);
  let t=Math.ceil(from.getTime()/6e4)*6e4;            // walk minutes forward (cheap: max ~7 days, step by hour then minute)
  t=Math.floor(t/3.6e6)*3.6e6;
  for(let h=0;h<24*8+2;h++){const c=new Date(t+h*3.6e6);const p=parts(c);
    if(p.weekday==='Mon'&&p.hour==='20'&&p.minute==='00'&&c.getTime()+EPISODE_WINDOW_H*3.6e6>now.getTime())
      return {start:c,id:`${p.year}-${p.month}-${p.day}`}}
  return {start:new Date(now.getTime()+864e5),id:'unknown'}}
let EP=currentEpisode();
const KEY=()=> 'bp.bet.'+EP.id;

/* ---------- bet state ---------- */
const BASE=LIVE?{yes:0,no:0}:{yes:3412,no:6634};
let R={yes:0,no:0};   // live mode: server totals (include this fan's own bet)
const fresh=()=>({pick:null,conf:null,closed:false,closedBy:null,closedAt:null,resolved:null,drift:{yes:0,no:0}});
let S=Object.assign(fresh(),LIVE?{}:LS.get(KEY(),{}));
const save=()=>{if(!LIVE)LS.set(KEY(),S)};
const fmt=n=>n.toLocaleString('en-US');
function american(p){p=Math.min(.99,Math.max(.01,p));return p<.5?'+'+Math.round(100*(1-p)/p):'-'+Math.round(100*p/(1-p))}
function tally(){if(LIVE){const y=R.yes,n=R.no;return {y,n,p:(y+n)?y/(y+n):.5}}const y=BASE.yes+S.drift.yes+(S.pick==='yes'?1:0),n=BASE.no+S.drift.no+(S.pick==='no'?1:0);return {y,n,p:y/(y+n)}}
const CONF={vibes:'🤷 Just vibes',sure:'😏 Pretty sure',lock:'🔒 Lock it in'};
const bet=$('bet');
function renderBet(){if(!bet)return;const t=tally();const py=Math.round(t.p*100);
  $('pYes').textContent=py+'%';$('pNo').textContent=(100-py)+'%';$('oYes').textContent=american(t.p);$('oNo').textContent=american(1-t.p);
  $('barYes').style.width=(t.p*100)+'%';$('barNo').style.width=((1-t.p)*100)+'%';$('cYes').textContent=fmt(t.y)+' fans';$('cNo').textContent=fmt(t.n)+' fans';
  bet.classList.toggle('closed',S.closed);bet.classList.toggle('resolved',!!S.resolved);
  bet.querySelectorAll('.opt').forEach(b=>{b.classList.toggle('mine',S.pick===b.dataset.pick);b.disabled=S.closed;b.setAttribute('aria-pressed',S.pick===b.dataset.pick)});
  bet.querySelectorAll('#conf button').forEach(b=>{b.classList.toggle('on',S.conf===b.dataset.c);b.disabled=S.closed||!S.pick});
  const st=$('betStatus'),tx=$('betStatusTxt');st.className='bet-status '+(S.resolved?'res':S.closed?'shut':'open');
  const pickTxt=S.pick?`<b class="${S.pick}">${S.pick.toUpperCase()}</b>${S.conf?' · '+CONF[S.conf]:''}`:'';
  let me;
  if(S.resolved==='yes'){tx.textContent='Settled: GOLDEN TICKET! 🎟️';
    me=S.pick==='yes'?`<div class="verdict win">🎉 You called it!</div><div>Your pick: ${pickTxt}. Bragging rights unlocked.</div>`
      :S.pick==='no'?`<div class="verdict bust">💀 Busted</div><div>Your pick: ${pickTxt}. The bucket had other plans.</div>`
      :`<div class="verdict">No bet placed</div><div>A golden ticket was handed out. Next week, get on the board!</div>`;
    $('betSub').textContent=S.gtName?`${S.final?'Final: ':''}${S.gtName} won the golden ticket, so the bet resolved YES.`:'The host announced a golden ticket winner, so the bet resolved YES.';}
  else if(S.resolved==='no'){tx.textContent='Final: no golden ticket 🪣';
    me=S.pick==='no'?`<div class="verdict win">🎉 You called it!</div><div>Your pick: ${pickTxt}. Nobody got the ticket this week.</div>`
      :S.pick==='yes'?`<div class="verdict bust">💀 Busted</div><div>Your pick: ${pickTxt}. No golden ticket this week.</div>`
      :`<div class="verdict">No bet placed</div><div>Betting reopens when the next episode goes live.</div>`;
    $('betSub').textContent='The episode ended without a golden ticket, so the bet resolved NO. Final.';}
  else if(S.closed){tx.textContent='Betting closed — locked in after the opener';
    me=S.pick?`<div class="verdict lock">🔒 Locked in</div><div>Your pick: ${pickTxt}</div>`:`<div class="verdict">You sat this one out</div><div>Betting reopens next episode.</div>`;
    $('betSub').textContent=S.closedBy==='timer'?'Closed automatically 15 min after showtime.':'Closed by the host after the opener. Waiting on a golden ticket…';}
  else{tx.textContent='Betting open — closes after the opener';
    me=S.pick?`<div>Your pick: ${pickTxt}</div><div class="hint">You can change it until betting closes.</div>`:'Pick YES or NO to get on the board.';
    const c=new Date(EP.start.getTime()+CLOSE_AFTER_MIN*6e4);
    $('betSub').textContent=`Auto-closes 15 min after showtime (${c.toLocaleString('en-US',{timeZone:'America/Chicago',weekday:'short',hour:'numeric',minute:'2-digit'})} CT) if the host hasn't closed it already.`;}
  $('betMe').innerHTML=me;
  renderHost();if(typeof renderTicker==='function')try{renderTicker()}catch(e){}}
if(bet){
  bet.querySelectorAll('.opt').forEach(b=>b.addEventListener('click',e=>{if(S.closed)return;const p=b.dataset.pick;S.pick=S.pick===p?null:p;if(!S.pick)S.conf=null;save();renderBet();if(LIVE&&BPL.onPick)BPL.onPick(S.pick,S.conf);
    if(S.pick&&window.burst){const r=b.getBoundingClientRect();burst(r.left+r.width/2,r.top+r.height/2,p==='yes'?'#ffc23d':'#8b9bb8',p==='yes'?['🎟️','✨','💰']:['🪣','🙅','💨'],p==='yes'?'YES!':'NO!')}}));
  bet.querySelectorAll('#conf button').forEach(b=>b.addEventListener('click',()=>{if(S.closed||!S.pick)return;S.conf=S.conf===b.dataset.c?null:b.dataset.c;save();renderBet();if(LIVE&&BPL.onPick)BPL.onPick(S.pick,S.conf)}));
}
function closeBetting(by='host'){if(S.closed)return false;S.closed=true;S.closedBy=by;S.closedAt=Date.now();save();renderBet();return true}
function resolveYes(name){S.closed=true;S.closedBy=S.closedBy||'golden';S.resolved='yes';if(name)S.gtName=name;save();renderBet()}
function resetEpisode(){EP=currentEpisode();LS.del(KEY());S=fresh();save();renderBet()}
// auto-close fallback + gentle live drift while open
function tick(){if(LIVE){if(!S.closed&&EP.start&&Date.now()>=EP.start.getTime()+CLOSE_AFTER_MIN*6e4)closeBetting('timer');else renderBet();return}
  const ep=currentEpisode();if(ep.id!==EP.id){EP=ep;S=Object.assign(fresh(),LS.get(KEY(),{}));}
  if(!S.closed&&Date.now()>=EP.start.getTime()+CLOSE_AFTER_MIN*6e4)closeBetting('timer');else renderBet()}
if(LIVE)setInterval(tick,4000);else if(!/static/.test(location.hash))setInterval(()=>{if(!S.closed){S.drift.yes+=Math.random()<.4?1+(Math.random()*3|0):0;S.drift.no+=Math.random()<.5?1+(Math.random()*4|0):0;save()}tick()},4000);


/* ---------- ticker: only facts the app itself knows (rebuilt from page state) ---------- */
const track=$('track');
const txt=sel=>{const e=document.querySelector(sel);return e?e.textContent.trim():''};
function since(ms){const m=Math.floor(ms/6e4);return m<60?m+' min':Math.floor(m/60)+'h '+String(m%60).padStart(2,'0')+'m'}
function until(ms){const s=Math.max(0,ms/1000|0);const d=s/86400|0,h=(s%86400)/3600|0,m=(s%3600)/60|0;return d?`${d}d ${h}h ${m}m`:h?`${h}h ${m}m`:`${m}m`}
function nextPremiereTxt(){const cd=txt('#cd');return `<i>NEXT PREMIERE</i>Mon 8:00 PM CT${cd?' · in '+esc(cd):''}`}
/* final results (episode ended): the week-long recap, built from the same page state */
function finalItems(RS){const items=[],ep=RS.episode||{},cs=(RS.comics||[]);const avg=x=>x.avg==null?null:+x.avg;
  items.push({k:'fin',hot:true,t:`<i>🏁 FINAL RESULTS</i>${esc(ep.title||'Last episode')}`});
  const bp=cs.filter(c=>c.kind!=='regular'&&avg(c)!=null).sort((a,b)=>avg(b)-avg(a)||b.votes-a.votes);
  if(bp[0])items.push({k:'top',t:`<i>🏆 TOP FAN-RATED</i>${esc(bp[0].name)} · ${avg(bp[0]).toFixed(1)}/10 · ${fmt(+bp[0].votes||0)} votes`});
  items.push(ep.golden_ticket_name?{k:'gt',hot:true,t:`<i>🎟️ GOLDEN TICKET</i>${esc(ep.golden_ticket_name)}`}:{k:'gt',t:`<i>🎟️ GOLDEN TICKET</i>none this episode`});
  const kb=cs.filter(c=>c.kind!=='regular'&&(+c.kills||0)+(+c.bombs||0)>0).map(c=>({c,p:c.kills/((+c.kills)+(+c.bombs))})).sort((a,b)=>b.p-a.p||b.c.kills-a.c.kills);
  if(kb[0])items.push({k:'kill',t:`<i>🔪 BIGGEST KILL</i>${esc(kb[0].c.name)} · ${Math.round(kb[0].p*100)}% kill`});
  const rg=cs.filter(c=>c.kind==='regular'&&avg(c)!=null).sort((a,b)=>avg(b)-avg(a));
  if(rg[0])items.push({k:'reg',t:`<i>⭐ TOP REGULAR</i>${esc(rg[0].name)} · ${avg(rg[0]).toFixed(1)}/10`});
  const pa=txt('.panelcard .pill');if(pa&&!/—/.test(pa))items.push({k:'panel',t:`<i>PANEL</i>fan ${esc(pa.toLowerCase())}`});
  const t=tally();items.push({k:'bet',t:`<i>GOLDEN TICKET BET</i>settled ${S.resolved==='yes'?'YES':'NO'} · ${fmt(t.y)} said yes · ${fmt(t.n)} said no`});
  items.push({k:'clock',t:nextPremiereTxt()});
  items.push({k:'cl',t:`<i>VOTING</i>closed · results stay up until the next episode goes live`});
  return items}
function tickerItems(){const now=Date.now(),st=EP.start.getTime();const items=[];
  const RS0=LIVE&&window.BPRealtime?window.BPRealtime.state:null;
  if(RS0&&RS0.episode&&RS0.episode.status==='ended')return finalItems(RS0);
  if(S.resolved==='yes')items.push({k:'gt',hot:true,t:`<i>🎟️ GOLDEN TICKET AWARDED</i>${esc(S.gtName||'Tonight\u2019s comic')}`});
  items.push(now<st?{k:'clock',t:`<i>NEXT PREMIERE</i>Mon 8:00 PM CT · starts in ${until(st-now)}`}:{k:'clock',t:`<i>ON AIR</i>${since(now-st)} since the premiere started`});
  const RS=LIVE&&window.BPRealtime?window.BPRealtime.state:null;
  if(LIVE&&!RS){items.push({k:'idle',t:`<i>FAN ROOM</i>Opens when the host starts the episode`});const vc0=txt('#vc');if(vc0)items.push({k:'viewers',t:`<i>WATCHING</i>${esc(vc0)} ${vc0==='1'?'fan':'fans'} in the room`});return items}
  const onStage=!LIVE||!!(RS&&RS.episode&&RS.episode.current_comic_id);
  const comic=onStage?txt('.comic .who b'):'',num=txt('.comic .who small').split('·')[0].trim(),avg=(document.getElementById('avg')||{}).firstChild;
  if(comic)items.push({k:'stage',t:`<i>RATING NOW</i>${esc(num)} ${esc(comic)} · fan avg ${avg?esc(avg.textContent.trim()):'—'}/10`});
  const top=document.querySelector('.lb li:not(.empty)');if(top&&top.querySelector('.nm')){const nm=top.querySelector('.nm').childNodes[0].textContent.trim(),sc=top.querySelector('.sc').textContent.trim();items.push({k:'top',t:`<i>TOP FAN-RATED SO FAR</i>${esc(nm)} · ${esc(sc)}`})}
  const k=txt('.quick .kill small'),bm=txt('.quick .bomb small');if(k&&onStage)items.push({k:'kb',t:`<i>KILL vs BOMB</i>${esc(k)} kill · ${esc(bm)} bomb (current set)`});
  const pa=txt('.panelcard .pill');if(pa)items.push({k:'panel',t:`<i>PANEL</i>fan ${esc(pa.toLowerCase())}`});
  const t=tally(),py=Math.round(t.p*100);
  items.push({k:'bet',t:`<i>GOLDEN TICKET BET</i>YES ${py}% (${american(t.p)}) · NO ${100-py}% (${american(1-t.p)}) · ${S.resolved?'settled YES':S.closed?'betting closed':'betting open'}`});
  const vc=txt('#vc');if(vc)items.push({k:'viewers',t:`<i>WATCHING</i>${esc(vc)} ${vc==='1'?'fan':'fans'} in the room`});
  return items}
let tkSig='';
function renderTicker(){if(!track)return;const items=tickerItems();const sig=items.map(x=>x.k).join(',');
  if(sig!==tkSig){tkSig=sig;const one=items.map(x=>`<span data-k="${x.k}"${x.hot?' class="hot"':''}></span><span class="sep">✦</span>`).join('');track.innerHTML=one+one}
  items.forEach(x=>track.querySelectorAll(`[data-k="${x.k}"]`).forEach(e=>{if(e.innerHTML!==x.t)e.innerHTML=x.t}))}
tick();renderTicker();

/* ---------- confetti (canvas) ---------- */
function confetti(canvas,{count,duration}){const ctx=canvas.getContext('2d');const dpr=Math.min(2,devicePixelRatio||1);
  const W=canvas.width=innerWidth*dpr,H=canvas.height=innerHeight*dpr;canvas.style.width=innerWidth+'px';canvas.style.height=innerHeight+'px';
  const pal=['#ffd700','#ffc23d','#fff1a8','#e8a317','#ffe680','#b8860b','#ffffff','#ffd700','#7b3fe4'];const P=[];
  const spawn=(x,y,vx,vy,d=0)=>P.push({x,y,vx,vy,d,w:(6+Math.random()*8)*dpr,h:(9+Math.random()*12)*dpr,r:Math.random()*6.28,vr:(Math.random()-.5)*.35,c:pal[Math.random()*pal.length|0],shape:Math.random()<.2?'c':Math.random()<.35?'s':'r',tilt:Math.random()*6.28,vt:.05+Math.random()*.12});
  const sp=1.0*dpr;
  const corner=(x,dir,n,delay)=>{for(let i=0;i<n;i++){const a=(dir>0?(-58-Math.random()*30):(-122+Math.random()*30))*Math.PI/180,v=(24+Math.random()*22)*sp;spawn(x,H*.95,Math.cos(a)*v,Math.sin(a)*v,delay+Math.random()*8)}};
  corner(0,1,count*.2,0);corner(W,-1,count*.2,0);corner(0,1,count*.12,34);corner(W,-1,count*.12,34);
  for(let i=0;i<count*.14;i++){const a=Math.random()*6.28,v=(8+Math.random()*18)*sp;spawn(W/2,H*.45,Math.cos(a)*v,Math.sin(a)*v-6*sp,2)}
  for(let i=0;i<count*.22;i++)spawn(Math.random()*W,-Math.random()*H*.5,(Math.random()-.5)*3*sp,(3+Math.random()*4)*sp,Math.random()*30);
  const t0=performance.now();let raf;
  (function frame(t){const el=t-t0;ctx.clearRect(0,0,W,H);const fade=Math.max(0,Math.min(1,(duration-el)/500));
    for(const p of P){if(p.d>0){p.d--;continue}p.vx*=.982;p.vy=p.vy*.982+.36*dpr;p.x+=p.vx;p.y+=p.vy;p.r+=p.vr;p.tilt+=p.vt;
      ctx.save();ctx.globalAlpha=fade;ctx.translate(p.x,p.y);ctx.rotate(p.r);ctx.fillStyle=p.c;const sx=Math.cos(p.tilt);
      if(p.shape==='c'){ctx.beginPath();ctx.arc(0,0,p.w*.45,0,6.28);ctx.fill()}
      else if(p.shape==='s'){ctx.beginPath();ctx.moveTo(-p.w,0);ctx.quadraticCurveTo(0,p.h*sx,p.w,0);ctx.lineWidth=2.4*dpr;ctx.strokeStyle=p.c;ctx.stroke()}
      else{ctx.fillRect(-p.w/2,-p.h/2*sx,p.w,p.h*sx)}
      ctx.restore()}
    if(el<duration)raf=requestAnimationFrame(frame)})(t0);
  return ()=>cancelAnimationFrame(raf)}

/* ---------- golden ticket takeover ---------- */
let gtBusy=false;
function currentComic(){const b=document.querySelector('.comic .who b');return b?b.textContent.trim():''}
function esc(s){return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
function triggerGoldenTicket(name,opts={}){
  if(gtBusy)return false;gtBusy=true;name=(name||'').trim()||currentComic()||'Tonight\u2019s comic';
  const rm=reduce();const TOTAL=opts.duration||(rm?1800:3200);
  const ov=document.createElement('div');ov.className='gt'+(rm?' rm':'');ov.setAttribute('role','alert');ov.setAttribute('aria-live','assertive');
  const serial='№ '+String(Math.floor(Math.random()*900000)+100000);
  ov.innerHTML=`<div class="gt-bg"></div><div class="gt-rays"></div><canvas class="gt-cv"></canvas>
   <div class="gt-stage"><div class="gt-ticket">
     <div class="gt-foil"></div><div class="gt-shine"></div>
     <div class="gt-inner">
       <div class="gt-top">★ ADMIT ONE ★ <span>BUCKET PULL LIVE</span></div>
       <div class="gt-title">GOLDEN<br>TICKET</div>
       <div class="gt-name">${esc(name)}</div>
       <div class="gt-bot"><span>${serial}</span><span>🎟️ WINNER</span></div>
     </div>
     <div class="gt-stub"><span>GOLDEN&nbsp;TICKET</span></div>
   </div></div>`;
  document.body.appendChild(ov);document.documentElement.classList.add('gt-on');
  const stop=confetti(ov.querySelector('.gt-cv'),{count:rm?60:340,duration:TOTAL});
  // airhorn x3, staggered and overlapping (host click = user gesture, so playback is allowed)
  const horns=rm?[0,420]:[0,330,720];const played=[];
  horns.forEach(ms=>setTimeout(()=>{try{played.push(window.bpSound.play('airhorn',{volume:1}))}catch(e){}},ms));
  requestAnimationFrame(()=>ov.classList.add('in'));
  setTimeout(()=>ov.classList.add('out'),TOTAL-500);
  setTimeout(()=>{stop();ov.remove();document.documentElement.classList.remove('gt-on');gtBusy=false},TOTAL+150);
  resolveYes(name);
  document.dispatchEvent(new CustomEvent('bp:golden-ticket',{detail:{name}}));
  return true}

/* ---------- host mode (?host=1 on, ?host=0 off; persisted) ---------- */
const qp=new URLSearchParams(location.search);
if(qp.has('host')){if(qp.get('host')==='1')LS.set('bp.host',true);else LS.del('bp.host');
  qp.delete('host');history.replaceState(null,'',location.pathname+(qp.toString()?'?'+qp:'')+location.hash)}
function renderHost(){if(!hostEl)return;const c=hostEl.querySelector('#hClose');c.disabled=S.closed;c.textContent=S.closed?(S.resolved?'✅ Bet settled (YES)':'🔒 Betting closed'):'🔒 Close betting (opener done)';
  hostEl.querySelector('#hState').textContent=`Episode ${EP.id} · bet ${S.resolved?'settled YES':S.closed?'closed':'open'}`}
function mountHost(){hostEl=document.createElement('aside');hostEl.className='host';hostEl.innerHTML=`
  <button class="h-head" id="hToggle" aria-expanded="true"><span class="h-dot"></span>Host controls<span class="h-car">▾</span></button>
  <div class="h-body">
    <label class="h-fld"><span>Comic name</span><input id="hName" maxlength="40" placeholder="${esc(currentComic())}"></label>
    <button class="h-gt" id="hGT">🎟️ GOLDEN TICKET!</button>
    <button class="h-btn" id="hClose">🔒 Close betting (opener done)</button>
    <button class="h-btn ghost" id="hReset">↺ Reset for next episode</button>
    <div class="h-foot"><span id="hState"></span><a href="?host=0">Exit host mode</a></div>
  </div>`;document.body.appendChild(hostEl);
  hostEl.querySelector('#hToggle').onclick=()=>{const c=hostEl.classList.toggle('min');hostEl.querySelector('#hToggle').setAttribute('aria-expanded',!c);LS.set('bp.host.min',c)};
  if(LS.get('bp.host.min',false))hostEl.classList.add('min');
  hostEl.querySelector('#hGT').onclick=()=>triggerGoldenTicket(hostEl.querySelector('#hName').value);
  hostEl.querySelector('#hClose').onclick=()=>closeBetting('host');
  hostEl.querySelector('#hReset').onclick=()=>{if(confirm('Reset the Golden Ticket bet for the next episode? This clears the bet on this device.'))resetEpisode()};
  renderHost()}
if(LS.get('bp.host',false)&&!LIVE)mountHost();   // live mode: realtime.js mounts the server-backed host panel

/* live mode: realtime.js pushes the shared bet state in; BPL.onPick is set by realtime.js to save this fan's pick */
function applyRemote(o){if(o.id&&o.id!==EP.id){EP={id:o.id,start:o.start||EP.start}}else if(o.start)EP.start=o.start;
  if(o.yes!=null){R={yes:o.yes,no:o.no}}
  if('pick' in o){S.pick=o.pick||null;S.conf=o.conf||null}
  S.final=!!o.final;S.resolved=o.resolved?'yes':S.final?'no':null;S.gtName=o.gtName||null;
  S.closed=!o.open||!!o.resolved;S.closedBy=S.closed?(o.resolved?'golden':(EP.start&&Date.now()>=EP.start.getTime()+CLOSE_AFTER_MIN*6e4?'timer':'host')):null;
  renderBet()}
window.triggerGoldenTicket=triggerGoldenTicket;
const BPL=window.BPLive={renderTicker:()=>renderTicker(),triggerGoldenTicket,closeBetting,resetEpisode,applyRemote,onPick:null,live:LIVE,get state(){return JSON.parse(JSON.stringify(S))},get episode(){return {...EP}}};
})();
