/* Bucket Pull LIVE: the ornate theatre marquee across the top of the page.
   Pure SVG drawn to the sign's real pixel size (ResizeObserver), so strokes and bulbs stay crisp at any width:
   arched art-deco crest with a sunburst finial, gold rims, a DOUBLE ring of chasing bulbs, deco sunburst face,
   scroll filigree beside the letters. The letters are real HTML text on top. */
(function(){
'use strict';
const sign=document.getElementById('mq');if(!sign)return;
const svg=sign.querySelector('.mq-svg'),txt=sign.querySelector('.mq-w'),NS='http://www.w3.org/2000/svg';
const f=n=>Math.round(n*100)/100;
let key='';
function geom(W,H){
  const mob=W<560,s=Math.max(.62,Math.min(1.15,H/150));
  const F=f((mob?19:27)*s);                         // finial height above the dome
  const rise=f(H*(mob?.17:.22));                     // dome rise above the shoulders
  const A=F+rise;                                   // shoulder line
  const halfDome=W*(mob?.40:W<1000?.39:.34);        // half-width of the dome at the shoulder line
  const C=H*1.05;                                   // dome ellipse centre (below the sign) -> gentle arch
  const RY=C-F, k=(C-A)/RY, RX=halfDome/Math.sqrt(1-k*k);
  const ro=Math.max(2.5,3.6*s), L=Math.max(9.5,Math.min(13.5,12.5*s));
  return {W,H,s,mob,F,A,C,RX,RY,ro,L,cx:W/2};
}
// outline of the sign inset by d: rounded box, flat shoulders, elliptical dome; scalloped notches where dome meets shoulders
function outline(g,d){const {W,H,A,C,RX,RY,cx}=g;const rx=RX-d,ry=RY-d,ys=A+d,r=Math.max(2,g.s*12-d*.6),r2=Math.max(1.5,g.s*7-d*.4);
  const dx=rx*Math.sqrt(Math.max(0,1-((C-ys)/ry)**2));
  return `M${f(d+r)},${f(H-d)}H${f(W-d-r)}Q${f(W-d)},${f(H-d)} ${f(W-d)},${f(H-d-r)}V${f(ys+r2)}Q${f(W-d)},${f(ys)} ${f(W-d-r2)},${f(ys)}`+
    `H${f(cx+dx)}A${f(rx)},${f(ry)} 0 0 0 ${f(cx-dx)},${f(ys)}H${f(d+r2)}Q${f(d)},${f(ys)} ${f(d)},${f(ys+r2)}V${f(H-d-r)}Q${f(d)},${f(H-d)} ${f(d+r)},${f(H-d)}Z`}
function el(n,a,p){const e=document.createElementNS(NS,n);for(const k in a)e.setAttribute(k,a[k]);if(p)p.appendChild(e);return e}
function spiral(x,y,r0,turns,dir,rot){const pts=[];const n=48*turns;for(let i=0;i<=n;i++){const t=i/n*turns*2*Math.PI,r=r0*Math.exp(-t*.23);
  pts.push([x+dir*r*Math.cos(t*dir+rot),y+r*Math.sin(t*dir+rot)])}return 'M'+pts.map(p=>f(p[0])+','+f(p[1])).join('L')}
function bulbs(path,step,cls,parent,phase){const len=path.getTotalLength();const n=Math.max(8,Math.round(len/step));const g=el('g',{class:cls},parent);
  for(let i=0;i<n;i++){const p=path.getPointAtLength((i+(phase||0))/n*len);el('use',{href:'#mqB',x:f(p.x),y:f(p.y)},g)}return n}
function draw(){
  const W=sign.clientWidth,H=sign.clientHeight;if(!W||!H)return;const k2=W+'x'+H;if(k2===key)return;key=k2;
  const g=geom(W,H),{s,ro,L,cx,F,A}=g;svg.setAttribute('viewBox',`0 0 ${W} ${H}`);svg.setAttribute('width',W);svg.setAttribute('height',H);svg.textContent='';
  const br=Math.max(2.1,L*.25);
  const defs=el('defs',{},svg);
  defs.innerHTML=`<linearGradient id="mqGold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff1b8"/><stop offset=".28" stop-color="#f0c14b"/><stop offset=".55" stop-color="#a87512"/><stop offset=".78" stop-color="#f6d47a"/><stop offset="1" stop-color="#7a5208"/></linearGradient>
  <linearGradient id="mqGoldH" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#8a5f10"/><stop offset=".5" stop-color="#ffe9a3"/><stop offset="1" stop-color="#8a5f10"/></linearGradient>
  <radialGradient id="mqFace" cx=".5" cy="1" r="1"><stop offset="0" stop-color="#2a1205"/><stop offset=".55" stop-color="#0d0805"/><stop offset="1" stop-color="#050404"/></radialGradient>
  <radialGradient id="mqBulb" cx=".4" cy=".35" r=".65"><stop offset="0" stop-color="#fff"/><stop offset=".35" stop-color="#fff3c9"/><stop offset=".75" stop-color="#f0c14b"/><stop offset="1" stop-color="#a06d0c"/></radialGradient>
  <radialGradient id="mqHalo"><stop offset="0" stop-color="#ffe6a0" stop-opacity=".75"/><stop offset=".45" stop-color="#f0c14b" stop-opacity=".25"/><stop offset="1" stop-color="#f0c14b" stop-opacity="0"/></radialGradient>
  <g id="mqB"><circle r="${f(br*2.6)}" fill="url(#mqHalo)"/><circle r="${f(br)}" fill="url(#mqBulb)" stroke="#5a3d06" stroke-width=".6"/></g>
  <pattern id="mqClown" patternUnits="userSpaceOnUse" x="${f(cx-75*Math.max(.7,s))}" y="0" width="${f(150*Math.max(.7,s))}" height="${f(225*Math.max(.7,s))}"><image href="img/marquee-clowns.webp?v=club38" width="${f(150*Math.max(.7,s))}" height="${f(225*Math.max(.7,s))}" preserveAspectRatio="none"/></pattern>
  <clipPath id="mqClip"><path d="${outline(g,ro+2*L+5)}"/></clipPath>`;
  // finial: a deco fan on top of the dome
  const fr=F-1.5,fy=F+ro*.6;const fin=el('g',{class:'mq-fin'},svg);
  el('path',{d:`M${f(cx-fr)},${f(fy)}A${f(fr)},${f(fr)} 0 0 1 ${f(cx+fr)},${f(fy)}Z`,fill:'url(#mqGold)',stroke:'#3a2604','stroke-width':1},fin);
  for(let i=1;i<8;i++){const a=Math.PI*i/8;el('line',{x1:f(cx),y1:f(fy),x2:f(cx-Math.cos(a)*fr*.92),y2:f(fy-Math.sin(a)*fr*.92),stroke:'#5a3d06','stroke-width':f(Math.max(.8,s))},fin)}
  el('path',{d:`M${f(cx-fr*.42)},${f(fy)}A${f(fr*.42)},${f(fr*.42)} 0 0 1 ${f(cx+fr*.42)},${f(fy)}Z`,fill:'#1a1006',stroke:'#f6d47a','stroke-width':1},fin);
  el('circle',{cx:f(cx),cy:f(fy-fr*.15),r:f(Math.max(2,fr*.16)),fill:'#ff2a3f',stroke:'#ffd3da','stroke-width':.8},fin);
  // frame layers
  el('path',{d:outline(g,0),fill:'url(#mqGold)',stroke:'#2a1a03','stroke-width':1.2},svg);
  el('path',{d:outline(g,ro),fill:'#120c06',stroke:'#3a2604','stroke-width':1},svg);
  el('path',{d:outline(g,ro+L),fill:'none',stroke:'url(#mqGold)','stroke-width':f(Math.max(1.4,2*s))},svg);
  el('path',{d:outline(g,ro+2*L+1.5),fill:'none',stroke:'url(#mqGold)','stroke-width':f(Math.max(1.4,2.2*s))},svg);
  el('path',{d:outline(g,ro+2*L+5),fill:'url(#mqFace)',stroke:'#f0c14b','stroke-opacity':.55,'stroke-width':.8},svg);
  el('path',{d:outline(g,ro+2*L+5),fill:'url(#mqClown)'},svg);
  el('path',{d:outline(g,ro+2*L+5),fill:'#050612','fill-opacity':.5,stroke:'#f0c14b','stroke-opacity':.55,'stroke-width':.8},svg);
  // deco sunburst inside the face
  const sun=el('g',{'clip-path':'url(#mqClip)',class:'mq-sun'},svg);const sy=g.H*1.15,R=Math.hypot(g.W,g.H)*1.1,N=g.mob?26:46;
  for(let i=0;i<N;i++){const a0=Math.PI*(i/N),a1=Math.PI*((i+.5)/N);
    el('path',{d:`M${f(cx)},${f(sy)}L${f(cx-Math.cos(a0)*R)},${f(sy-Math.sin(a0)*R)}L${f(cx-Math.cos(a1)*R)},${f(sy-Math.sin(a1)*R)}Z`,fill:'#f0c14b','fill-opacity':.055},sun)}
  for(const rr of [.55,.72,.9])el('ellipse',{cx:f(cx),cy:f(sy),rx:f(g.W*rr*.62),ry:f(g.H*rr*1.25),fill:'none',stroke:'#f0c14b','stroke-opacity':.10,'stroke-width':1},sun);
  // bulbs: two concentric rings, chasing in opposite directions
  const p1=el('path',{d:outline(g,ro+L/2),fill:'none'},svg),p2=el('path',{d:outline(g,ro+1.5*L),fill:'none'},svg);
  const step=Math.max(11,L*1.25);
  const n1=bulbs(p1,step,'mq-r1',svg,0),n2=bulbs(p2,step,'mq-r2',svg,.5);p1.remove();p2.remove();
  // fit the letters inside the face: largest size whose top still clears the inner dome
  {const inner=ro+2*L+9,tag=sign.querySelector('.mq-tag'),box=sign.querySelector('.mq-in');
   const fs0=parseFloat(getComputedStyle(txt).fontSize)||40,w0=txt.offsetWidth/fs0,tw0=tag.offsetWidth,th=tag.offsetHeight+3;
   const rxi=g.RX-inner,ryi=g.RY-inner,Ai=A+inner;
   const half=y=>y>=Ai?W/2-inner:(y<=g.C-ryi?0:rxi*Math.sqrt(Math.max(0,1-((g.C-y)/ryi)**2)));
   const maxFs=Math.min(g.mob?44:72,W*(g.mob?.085:.05));let fs=maxFs;const bot=inner+(g.mob?2:4)*s;
   for(;fs>16;fs-=.5){const top=H-bot-fs*1.02,ttop=top-th;if(top>=F+inner-2&&half(top+fs*.12)>=w0*fs/2+6&&half(ttop-(g.mob?2:8)*s)>=tw0/2+(g.mob?4:14)*s&&ttop>=F+inner+(g.mob?0:6)*s)break}
   txt.style.fontSize=f(fs)+'px';box.style.bottom=f(bot)+'px'}
  // filigree: scrolls + speed lines beside the letters
  const fil=el('g',{class:'mq-fil',fill:'none',stroke:'url(#mqGoldH)','stroke-linecap':'round'},svg);
  const sr=sign.getBoundingClientRect(),tr=txt.getBoundingClientRect();
  const ty=tr.top-sr.top+tr.height*.52,inner=ro+2*L+5,gap=Math.max(8,14*s);
  for(const dir of [-1,1]){const x0=dir<0?tr.left-sr.left-gap:tr.right-sr.left+gap,x1=dir<0?inner+gap*.8:W-inner-gap*.8;const span=Math.abs(x1-x0);if(span<30)continue;
    const sw=f(Math.max(1.1,1.6*s));
    // three tapering deco lines
    [[-.18,1],[0,.78],[.18,.56]].forEach(([dy,len],j)=>{const y=ty+dy*tr.height,xe=x0+dir*span*len*(g.mob?.9:.62);el('path',{d:`M${f(x0)},${f(y)}L${f(xe)},${f(y)}`,'stroke-width':j==1?sw*1.4:sw},fil);
      el('path',{d:`M${f(xe)},${f(y-3*s)}L${f(xe+dir*4*s)},${f(y)}L${f(xe)},${f(y+3*s)}L${f(xe-dir*4*s)},${f(y)}Z`,fill:'#f0c14b',stroke:'none'},fil)});
    if(!g.mob&&span>120){const r0=Math.min(tr.height*.42,22*s),sx=x0+dir*span*.80;
      el('path',{d:spiral(sx,ty-r0*.15,r0,2.2,dir,Math.PI),'stroke-width':sw},fil);
      el('path',{d:spiral(sx+dir*r0*1.9,ty+r0*.15,r0*.8,2.2,-dir,0),'stroke-width':sw},fil);
      el('path',{d:`M${f(sx+dir*r0*3.2)},${f(ty)}L${f(x1)},${f(ty)}`,'stroke-width':sw},fil)}}
  // shoulder ornaments: concentric deco fans in the corners above the shoulders
  if(W>700){for(const dir of [-1,1]){const x=dir<0?inner+L*1.2:W-inner-L*1.2,y=g.H-inner-2,r=Math.min(g.H-A-2*inner,40*s);if(r<10)continue;
    for(const q of [1,.7,.4])el('path',{d:`M${f(x)},${f(y-r*q)}A${f(r*q)},${f(r*q)} 0 0 ${dir<0?1:0} ${f(x-dir*r*q)},${f(y)}`,stroke:'#f0c14b','stroke-opacity':.5,'stroke-width':1.2,fill:'none'},fil)}}
  sign.dataset.bulbs=`${n1+n2} bulbs · rings ${n1}/${n2} · ${W}×${H}`;
}
draw();if(document.fonts&&document.fonts.ready)document.fonts.ready.then(()=>{key='';draw()});
if('ResizeObserver' in window)new ResizeObserver(()=>draw()).observe(sign);else addEventListener('resize',draw);
})();
