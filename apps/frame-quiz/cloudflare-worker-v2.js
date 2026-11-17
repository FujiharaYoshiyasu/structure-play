/**
 * FRAME QUIZ — Cloudflare Workers + D1 v1.0
 * Binding: env.DB -> frame-quiz-rankings
 * Existing D1 tables: leaderboard_scores, quiz_sessions, quiz_rounds
 * Routes: GET /health, GET /rankings, POST /sessions, POST /rounds, POST /answers
 * This Worker decides and stores correct answers. Never trust scores from the browser.
 */
const PortalEngine = (() => {
'use strict';
const EPS=1e-8;
const pick=a=>a[Math.floor(Math.random()*a.length)];
const shuffle=a=>{a=[...a];for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a};
const add=(a,b)=>[a[0]+b[0],a[1]+b[1]],sub=(a,b)=>[a[0]-b[0],a[1]-b[1]];
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1],cross=(a,b)=>a[0]*b[1]-a[1]*b[0];
const pairs=a=>a.slice(1).map((v,i)=>[a[i],v]);
const unique=a=>[...new Set(a)].sort((a,b)=>a-b);
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=v=>Math.abs(v-Math.round(v))<1e-7?String(Math.round(Math.abs(v))):String(Number(Math.abs(v).toFixed(2)));
const signed=v=>Math.abs(v)<EPS?'0':(v<0?'⊖ ':'⊕ ')+fmt(v);
const CAT={simple:'単純ラーメン',threepin:'3ピンラーメン'};
function geometry(cfg){
 const L=cfg.L,h=cfg.h;
 const A=[0,0],B=[0,h],C=[L,h],D=[L,0],E=[L/2,h];
 const nodes=cfg.structure==='threepin'?[A,B,E,C,D]:[A,B,C,D];
 const names=cfg.structure==='threepin'?['A','B','E','C','D']:['A','B','C','D'];
 const members=pairs(nodes).map(([a,b],i)=>{
  const v=sub(b,a),len=Math.hypot(...v);
  return {a,b,L:len,u:v.map(z=>z/len),horizontal:Math.abs(v[1])<EPS,name:names[i]+names[i+1]};
 });
 return {nodes,names,members,A,B,C,D,E};
}
function generateConfig(raw){
 const structure=raw.structure==='threepin'?'threepin':'simple';
 const L=structure==='threepin'?4:pick([3,4,5]);
 const h=pick([2,3,4,5]);
 const pin=structure==='threepin'?'both':(raw.support==='random'?pick(['left','right']):raw.support==='right'?'right':'left');
 const cfg={structure,L,h,pin,loads:[]};
 const g=geometry(cfg), count=raw.count==='random'?pick([1,2,3]):Number(raw.count)||1;
 const kinds=Array.from({length:Math.min(3,Math.max(1,count))},()=>raw.loadType==='random'?pick(['point','udl','moment']):['point','udl','moment'].includes(raw.loadType)?raw.loadType:'point');
 const used=new Set(),occupied=g.members.map(()=>new Set());
 for(let i=0;i<kinds.length;i++){
  const type=kinds[i];
  if(type==='udl'){
   const available=[];
   g.members.forEach((m,j)=>{
    for(let start=0;start<m.L;start++)for(let end=start+1;end<=m.L;end++){
     if(Array.from({length:end-start},(_,k)=>start+k).every(x=>!occupied[j].has(x)))available.push({j,start,end});
    }
   });
   if(!available.length)throw new Error('No free UDL interval');
   const whole=available.filter(c=>c.start===0&&c.end===g.members[c.j].L);
   const pos=whole.length&&Math.random()<.32?pick(whole):pick(available),m=g.members[pos.j];
   for(let z=pos.start;z<pos.end;z++)occupied[pos.j].add(z);
   const intensity=pick([2,4,6]);
   const sign=m.horizontal?-1:pick([-1,1]);
   cfg.loads.push({type,member:pos.j,start:pos.start,end:pos.end,value:intensity,Fx:m.horizontal?0:sign*intensity,Fy:m.horizontal?-intensity:0});
  }else{
   const available=[];
   g.members.forEach((m,j)=>{for(let x=1;x<m.L;x++)if(!used.has(`${j}/${x}`))available.push({j,x})});
   if(!available.length)throw new Error('No available integer point location');
   const p=pick(available),m=g.members[p.j];used.add(`${p.j}/${p.x}`);
   if(type==='moment'){
    const value=pick([-1,1])*pick([2,4,6,8,10]);
    cfg.loads.push({type,member:p.j,x:p.x,value});
   }else{
    const value=pick([2,4,6,8,10]);
    const sign=m.horizontal?-1:pick([-1,1]);
    cfg.loads.push({type,member:p.j,x:p.x,value,Fx:m.horizontal?0:sign*value,Fy:m.horizontal?-value:0});
   }
  }
 }
 return cfg;
}
function analyze(cfg){
 const g=geometry(cfg),ms=g.members;
 const point=(m,s)=>add(ms[m].a,ms[m].u.map(z=>z*s));
 const terms=[];
 for(const ld of cfg.loads){
  if(ld.type==='udl'){
   const dist=ld.end-ld.start;
   terms.push({member:ld.member,type:'udl',start:ld.start,end:ld.end,p:point(ld.member,(ld.start+ld.end)/2),F:[ld.Fx*dist,ld.Fy*dist],couple:0});
  }else terms.push({member:ld.member,type:ld.type,x:ld.x,p:point(ld.member,ld.x),F:ld.type==='moment'?[0,0]:[ld.Fx,ld.Fy],couple:ld.type==='moment'?ld.value:0});
 }
 let Fx=0,Fy=0,M_A=0,ML_E=0;
 for(const t of terms){Fx+=t.F[0];Fy+=t.F[1];M_A+=cross(sub(t.p,g.A),t.F)+t.couple;
  if(cfg.structure==='threepin'&&t.member<=1)ML_E+=cross(sub(t.p,g.E),t.F)+t.couple;
 }
 const Dy=-M_A/cfg.L,Ay=-Fy-Dy;
 let Ax=0,Dx=0;
 if(cfg.structure==='threepin'){
  Ax=((cfg.L/2)*Ay-ML_E)/cfg.h;
  Dx=-Fx-Ax;
 }else if(cfg.pin==='left')Ax=-Fx;
 else Dx=-Fx;
 const reactions={Ax,Ay,Dx,Dy},reactionsRight=[Dx,Dy];
 function tail(m,s,side='left'){
  const origin=point(m,s);
  let F=[...reactionsRight],M=cross(sub(g.D,origin),reactionsRight);
  for(const t of terms){
   if(t.member<m)continue;
   if(t.type==='udl'){
    const start=t.member===m?Math.max(s,t.start):t.start,end=t.end;
    if(end<=start+EPS)continue;
    const dist=end-start,p=point(t.member,(start+end)/2);
    const f=[cfg.loads.find(ld=>ld.member===t.member&&ld.type==='udl'&&ld.start===t.start&&ld.end===t.end)?.Fx??t.F[0]/(t.end-t.start),cfg.loads.find(ld=>ld.member===t.member&&ld.type==='udl'&&ld.start===t.start&&ld.end===t.end)?.Fy??t.F[1]/(t.end-t.start)];
    const ff=[f[0]*dist,f[1]*dist];
    F=add(F,ff);M+=cross(sub(p,origin),ff);
   }else{
    if(t.member===m&&(t.x<s-EPS||(Math.abs(t.x-s)<EPS&&side==='right')))continue;
    F=add(F,t.F);M+=cross(sub(t.p,origin),t.F)+t.couple;
   }
  }
  return {F,M};
 }
 function force(type,m,s,side='left'){
  const t=tail(m,s,side),u=ms[m].u;
  return type==='N'?dot(t.F,u):type==='Q'?-cross(u,t.F):t.M;
 }
 return {cfg,geometry:g,elements:ms,reactions,force,external:{Fx,Fy,M_A,ML_E},tail};
}
function breaks(cfg,m){const g=geometry(cfg);return unique([0,g.members[m].L,...cfg.loads.filter(ld=>ld.member===m).flatMap(ld=>ld.type==='udl'?[ld.start,ld.end]:[ld.x])]);}
function isUseful(r){return r.elements.every((_,m)=>pairs(breaks(r.cfg,m)).some(([a,b])=>b-a>EPS&&[.19,.5,.81].some(t=>['N','Q','M'].some(kind=>Math.abs(r.force(kind,m,a+(b-a)*t))>1e-7))));}
function checkpoints(type,r){
 const arr=[];
 r.elements.forEach((_,m)=>{
  const xs=breaks(r.cfg,m);
  for(const x of xs)arr.push({m,x,side:'left'},{m,x,side:'right'});
  if(type==='M')for(const [a,b] of pairs(xs)){
   const q0=r.force('Q',m,a,'right'),q1=r.force('Q',m,b,'left');
   if(q0*q1<0)arr.push({m,x:a+(b-a)*q0/(q0-q1),side:'right'});
  }
 });
 return arr;
}
function value(opt,type,r,m,x,side='left'){return opt.f[m]*r.force(type,m,x,side)+opt.bias[m];}
function alternatives(type,r){
 const n=r.elements.length,unit=Array(n).fill(1),zero=Array(n).fill(0);
 const base={f:unit,bias:zero};
 const list=[base],points=checkpoints(type,r),valueArray=o=>points.map(p=>value(o,type,r,p.m,p.x,p.side));
 const sig=o=>valueArray(o).map(v=>v.toFixed(6)).join('/');
 const seen=new Set([sig(base)]);
 const amp=Math.max(2,...r.cfg.loads.map(x=>Math.abs(x.value)));
 const transforms=[];
 for(const scale of [-1,0,2])transforms.push({f:Array(n).fill(scale),bias:zero});
 for(let m=0;m<n;m++)for(const scale of [-1,0,2]){
  const f=[...unit];f[m]=scale;transforms.push({f,bias:zero});
 }
 for(let m=0;m<n;m++)for(const shift of [amp,-amp,amp/2,-amp/2]){
  const bias=[...zero];bias[m]=shift;transforms.push({f:unit,bias});
 }
 const correct=valueArray(base);
 for(const opt of shuffle(transforms)){
  const key=sig(opt);if(seen.has(key))continue;
  const arr=valueArray(opt),s=Math.max(1,...arr.map(Math.abs),...correct.map(Math.abs));
  const gap=Math.sqrt(arr.reduce((t,v,i)=>t+((v-correct[i])/s)**2,0)/arr.length);
  if(gap<.09)continue;
  seen.add(key);list.push(opt);if(list.length===4)break;
 }
 if(list.length!==4)throw Error('Could not find distinct options');
 return shuffle(list);
}
function extremaM(opt,r){
 const list=checkpoints('M',r).map(p=>({...p,val:value(opt,'M',r,p.m,p.x,p.side)}));
 const x=list.reduce((a,b)=>Math.abs(a.val)>=Math.abs(b.val)?a:b);
 const el=r.elements[x.m],where=Math.abs(x.x)<EPS?el.name[0]:Math.abs(x.x-el.L)<EPS?el.name[1]:el.name+' '+fmt(x.x)+'m';
 return {val:x.val,label:where};
}
function curvesM(opt,r){
 const out=[];
 r.elements.forEach((el,m)=>{
  if(Math.abs(opt.f[m])<EPS)return;
  const xs=unique([0,el.L,...r.cfg.loads.filter(ld=>ld.member===m&&ld.type==='udl').flatMap(ld=>[ld.start,ld.end])]);
  for(const [a,b] of pairs(xs)){
   const mid=(a+b)/2;
   const force=r.cfg.loads.filter(ld=>ld.type==='udl'&&ld.member===m&&ld.start<mid&&ld.end>mid).reduce((z,ld)=>add(z,[ld.Fx,ld.Fy]),[0,0]);
   if(Math.abs(cross(el.u,force))>EPS)out.push({m,start:a,end:b});
  }
 });return out;
}
function graph(cfg,scale,ox,oy){
 const g=geometry(cfg),nodes=g.nodes.map(([x,y])=>[ox+x*scale,oy-y*scale]);
 const segments=pairs(nodes);
 const pos=(m,s)=>{const a=nodes[m],b=nodes[m+1],L=g.members[m].L;return [a[0]+(b[0]-a[0])*s/L,a[1]+(b[1]-a[1])*s/L]};
 return {nodes,segments,pos};
}
function optionsSVG(r,opts){
 const result={};
 for(const t of ['N','Q','M']){
  const pts=checkpoints(t,r),maximum=Math.max(1,...opts[t].flatMap(o=>pts.map(p=>Math.abs(value(o,t,r,p.m,p.x,p.side)))));
  result[t]=opts[t].map((o,i)=>({svg:diagramSVG(o,t,maximum,r,`${t}-${i}-${Math.random().toString(36).slice(2)}`)}));
 }return result;
}
function diagramSVG(opt,type,max,r,uid='preview'){
 const cfg=r.cfg,g=graph(cfg,46,190,323),col={N:'#0b8f87',Q:'#3978b6',M:'#cf6348'}[type];
 const px=Math.min(19,55/Math.max(1,max));
 const ntype=type==='M'?-1:1;
 const vals=(m,s,side='left')=>value(opt,type,r,m,s,side);
 const path=points=>points.map(([x,y],i)=>`${i?'L':'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
 const text=(x,y,msg,size=14)=>`<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-size="${size}" font-weight="800" text-anchor="middle" fill="#26435c" stroke="#fff" stroke-width="2.5" paint-order="stroke">${escape(msg)}</text>`;
 function locate(m,s,v){const p=g.pos(m,s),el=r.elements[m];return [p[0]+el.u[1]*ntype*v*px,p[1]-el.u[0]*ntype*v*px];}
 const defs=r.elements.map((el,m)=>`<pattern id="h-${uid}-${m}" patternUnits="userSpaceOnUse" width="9" height="9"><path d="${el.horizontal?'M4 0V9':'M0 4H9'}" fill="none" stroke="${col}" stroke-width="1.05" opacity=".7"/></pattern>`).join('');
 const body=[];
 for(let m=0;m<r.elements.length;m++)for(const [a,b]of pairs(breaks(cfg,m))){
  const frame=[],deflected=[];
  for(let j=0;j<=32;j++){
   const s=a+(b-a)*j/32,side=j===0?'right':j===32?'left':'right';
   frame.push(locate(m,s,0));deflected.push(locate(m,s,vals(m,s,side)));
  }
  const outline=path([...frame,...deflected.slice().reverse()]);
  body.push(`<path d="${outline}Z" fill="${col}" fill-opacity=".07"/><path d="${outline}Z" fill="url(#h-${uid}-${m})"/><path d="${path(deflected)}" fill="none" stroke="${col}" stroke-width="2.7"/>`);
 }
 for(const ld of cfg.loads){
  if((type==='M'&&ld.type==='moment')||(['N','Q'].includes(type)&&ld.type==='point')){
   const a=locate(ld.member,ld.x,vals(ld.member,ld.x,'left'));
   const b=locate(ld.member,ld.x,vals(ld.member,ld.x,'right'));
   if(Math.hypot(a[0]-b[0],a[1]-b[1])>1)body.push(`<path d="${path([a,b])}" stroke="${col}" stroke-width="2" stroke-dasharray="4 3"/>`);
  }
 }
 const tags=[];
 const placed=[];
 function chip(anchor,caption,prefer){
  const width=Math.min(112,Math.max(58,caption.length*7.2+12)),H=19;
  const offsets=prefer===true?[[0,-23],[0,24],[-48,-24],[48,24],[0,-42],[0,43],[70,0],[-70,0]]:[[32,-13],[-32,13],[52,14],[-52,-14],[75,0],[-75,0],[0,27],[0,-27]];
  let best=null;
  for(const [dx,dy]of offsets){
   const x=Math.min(705-width/2,Math.max(15+width/2,anchor[0]+dx));
   const y=Math.min(392-H/2,Math.max(23+H/2,anchor[1]+dy));
   const box={left:x-width/2-3,right:x+width/2+3,top:y-H/2-3,bottom:y+H/2+3};
   let overlap=0;for(const r of placed)overlap+=Math.max(0,Math.min(r.right,box.right)-Math.max(r.left,box.left))*Math.max(0,Math.min(r.bottom,box.bottom)-Math.max(r.top,box.top));
   const score=overlap*100+Math.hypot(dx,dy);
   if(!best||score<best.score)best={score,x,y,box};
  }
  placed.push(best.box);
  tags.push(`<path d="M${anchor[0].toFixed(1)} ${anchor[1].toFixed(1)}L${best.x.toFixed(1)} ${best.y.toFixed(1)}" stroke="${col}" stroke-opacity=".35" stroke-width=".85"/><rect x="${(best.x-width/2).toFixed(1)}" y="${(best.y-H/2).toFixed(1)}" width="${width}" height="${H}" rx="4" fill="#fff" fill-opacity=".94" stroke="${col}" stroke-opacity=".4"/><text x="${best.x.toFixed(1)}" y="${(best.y+4).toFixed(1)}" font-size="12" font-weight="800" text-anchor="middle" fill="#26435c">${escape(caption)}</text>`);
 }
 r.elements.forEach((el,m)=>{
  const mid=g.pos(m,el.L/2);tags.push(text(mid[0]+(el.horizontal?0:22),mid[1]+(el.horizontal?21:0),el.name,13));
  for(const [i,s]of [[0,0],[1,el.L]]){
   const v=vals(m,s,i?'left':'right');
   const caption=(type==='M'?fmt(v):signed(v))+' '+(type==='M'?'kNm':'kN');
   chip(g.pos(m,s),caption,el.horizontal);
  }
 });
 const pointLabels=g.nodes.map((p,i)=>text(p[0]-11,p[1]+(i===0||i===g.nodes.length-1?22:-15),r.geometry.names[i],15)).join('');
 if(cfg.structure==='threepin'){const p=g.nodes[2];body.push(`<circle cx="${p[0]}" cy="${p[1]}" r="5.5" fill="white" stroke="#334b65" stroke-width="2"/>`)}
 const note=[];
 if(type==='M'){
  const peak=extremaM(opt,r),curves=curvesM(opt,r);
  note.push(text(355,429,`最大 |M| ${fmt(peak.val)} kNm（${peak.label}）`,15));
  note.push(text(355,453,curves.length?'2次曲線：'+curves.map(z=>`${r.elements[z.m].name} ${fmt(z.end-z.start)}m`).join('、'):'2次曲線：なし',14));
 }
 return `<svg class="numeric-diagram" viewBox="0 0 720 480" role="img" aria-label="${CAT[cfg.structure]}・${type}図"><defs>${defs}</defs><path d="${path(g.nodes)}" fill="none" stroke="#9cb0c1" stroke-width="3" stroke-dasharray="5 5"/>${body.join('')}${pointLabels}${tags.join('')}${note.join('')}</svg>`;
}
function problemSVG(cfg){
 const g=graph(cfg,65,260,540),gg=geometry(cfg);const chunks=[];
 const p=(m,x)=>g.pos(m,x),node=tag=>g.nodes[gg.names.indexOf(tag)];
 const path=arr=>arr.map((z,i)=>`${i?'L':'M'}${z[0].toFixed(1)} ${z[1].toFixed(1)}`).join(' ');
 const lab=(x,y,msg,size=17,col='#365771')=>`<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-family="sans-serif" font-size="${size}" font-weight="750" text-anchor="middle" fill="${col}" stroke="white" stroke-width="4" paint-order="stroke">${escape(msg)}</text>`;
 const stroke='#497e9f';
 const dim=(member,start,end,index,axis,caption)=>{
  const u=gg.members[member].u,aa=p(member,start),bb=p(member,end);
  const horizontal=axis==='horizontal';
  const off=horizontal?[0,65+index*28]:(gg.members[member].a[0]<cfg.L/2?[-82-index*28,0]:[82+index*28,0]);
  const a=add(aa,off),b=add(bb,off),ticks=horizontal?`M${a[0]} ${a[1]-7}v14M${b[0]} ${b[1]-7}v14`:`M${a[0]-7} ${a[1]}h14M${b[0]-7} ${b[1]}h14`;
  chunks.push(`<path d="M${a[0]} ${a[1]}L${b[0]} ${b[1]}${ticks}" fill="none" stroke="${stroke}" stroke-width="1.5"/>`);
  if(horizontal)chunks.push(lab((a[0]+b[0])/2,a[1]-9,caption,15));
  else chunks.push(lab(a[0]+(off[0]<0?-28:28),(a[1]+b[1])/2,caption,15));
 };
 function segmentsFor(ld){
  const el=gg.members[ld.member],breaks=ld.type==='udl'?[0,ld.start,ld.end,el.L]:[0,ld.x,el.L];
  const nonzero=[];for(const [a,b]of pairs(unique(breaks)))if(b-a>EPS)nonzero.push([a,b]);
  return nonzero;
 }
 function arrow(from,to,col='#d45e40'){
  const dx=to[0]-from[0],dy=to[1]-from[1],n=Math.hypot(dx,dy),u=[dx/n,dy/n],norm=[-u[1],u[0]],base=sub(to,[u[0]*12,u[1]*12]);
  const left=add(base,[norm[0]*6,norm[1]*6]),right=sub(base,[norm[0]*6,norm[1]*6]);
  chunks.push(`<path d="M${from[0]} ${from[1]}L${to[0]} ${to[1]}M${left[0]} ${left[1]}L${to[0]} ${to[1]}L${right[0]} ${right[1]}" fill="none" stroke="${col}" stroke-width="2.4" stroke-linejoin="round"/>`);
 }
 function circleArrow(center,magnitude,ccw){
  const r=4*Math.abs(magnitude),a=155*Math.PI/180,b=385*Math.PI/180;
  const start=ccw?b:a,end=ccw?a:b,sweep=ccw?0:1;
  const aa=[center[0]+r*Math.cos(start),center[1]+r*Math.sin(start)],bb=[center[0]+r*Math.cos(end),center[1]+r*Math.sin(end)];
  const ux=-(bb[1]-center[1])/r*(ccw?-1:1),uy=(bb[0]-center[0])/r*(ccw?-1:1);
  const base=[bb[0]-ux*10,bb[1]-uy*10];
  chunks.push(`<path d="M${aa[0]} ${aa[1]}A${r} ${r} 0 1 ${sweep} ${bb[0]} ${bb[1]}" fill="none" stroke="#d45e40" stroke-width="2.8"/><path d="M${bb[0]} ${bb[1]}L${base[0]+uy*5} ${base[1]-ux*5}L${base[0]-uy*5} ${base[1]+ux*5}Z" fill="#d45e40"/>`);
 }
 // Support and frame outline.
 chunks.push(`<path d="${path(g.nodes)}" stroke="#29425b" stroke-width="5.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`);
 function pin(pt,roller=false){
  const [x,y]=pt;chunks.push(`<path d="M${x} ${y}l-16 20h32Z" fill="#eef5fc" stroke="#4d6f86" stroke-width="2.2"/>`);
  if(roller)chunks.push(`<circle cx="${x-9}" cy="${y+26}" r="4" fill="white" stroke="#4d6f86" stroke-width="1.7"/><circle cx="${x+9}" cy="${y+26}" r="4" fill="white" stroke="#4d6f86" stroke-width="1.7"/>`);
  const yground=y+(roller?33:22);chunks.push(`<path d="M${x-25} ${yground}h50" stroke="#4d6f86" stroke-width="2.5"/>`);
 }
 pin(node('A'),cfg.structure==='simple'&&cfg.pin==='right');
 pin(node('D'),cfg.structure==='simple'&&cfg.pin==='left');
 if(cfg.structure==='threepin'){const e=node('E');chunks.push(`<circle cx="${e[0]}" cy="${e[1]}" r="8" fill="white" stroke="#29425b" stroke-width="2.5"/>`)}
 // load geometry. Cross-sectional length is proportional to force intensity.
 cfg.loads.forEach((ld,i)=>{
  const el=gg.members[ld.member],horizontal=el.horizontal;
  if(ld.type==='moment'){
   const at=p(ld.member,ld.x);circleArrow(at,ld.value,ld.value>0);
   chunks.push(lab(at[0]+(horizontal?0:(el.a[0]<cfg.L/2?-62:62)),at[1]-4*Math.abs(ld.value)-12,`${fmt(ld.value)} kNm`,16,'#b64f37'));
  }else if(ld.type==='point'){
   const at=p(ld.member,ld.x),length=ld.value*8;
   const dir=[Math.sign(ld.Fx),-Math.sign(ld.Fy)];
   const from=[at[0]-dir[0]*(length+6),at[1]-dir[1]*(length+6)];
   arrow(from,[at[0]-dir[0]*6,at[1]-dir[1]*6]);
   chunks.push(lab(from[0]+(horizontal?0:-Math.sign(ld.Fx)*10),from[1]-12,`${fmt(ld.value)} kN`,16,'#b64f37'));
  }else{
   const n=Math.max(2,2*(ld.end-ld.start)),length=ld.value*7;
   const dir=[Math.sign(ld.Fx),-Math.sign(ld.Fy)];
   for(let j=0;j<=n;j++){
    const at=p(ld.member,ld.start+(ld.end-ld.start)*j/n);
    arrow([at[0]-dir[0]*(length+5),at[1]-dir[1]*(length+5)],[at[0]-dir[0]*5,at[1]-dir[1]*5]);
   }
   const mid=p(ld.member,(ld.start+ld.end)/2);
   const l=[mid[0]-dir[0]*(length+5),mid[1]-dir[1]*(length+5)];
   chunks.push(lab(l[0]+(horizontal?0:-Math.sign(ld.Fx)*22),l[1]-12,`${fmt(ld.value)} kN/m`,16,'#b64f37'));
  }
  const axis=horizontal?'horizontal':'vertical';
  const cutpoints=segmentsFor(ld);
  // One line divided at all relevant positions (left / loaded / right sections).
  cutpoints.forEach(([a,b])=>dim(ld.member,a,b,i,axis,`${fmt(b-a)} m`));
 });
 // Overall member lengths, separated from load-position lines.
 for(let m=0;m<gg.members.length;m++){
  const el=gg.members[m];
  if(el.horizontal)dim(m,0,el.L,4,'horizontal',`${fmt(el.L)} m`);
  else dim(m,0,el.L,4,'vertical',`${fmt(el.L)} m`);
 }
 g.nodes.forEach((z,i)=>chunks.push(lab(z[0]+(i===0||i===g.nodes.length-1?-18:0),z[1]+(i===0||i===g.nodes.length-1?-16:-16),gg.names[i],18,'#284359')));
 return `<svg viewBox="0 0 890 760" role="img" aria-label="${CAT[cfg.structure]}の支持条件・荷重図" style="width:100%;height:auto"><rect x="0" y="0" width="890" height="760" fill="#fbfdff" rx="12"/>${chunks.join('')}</svg>`;
}
function makeQuestion(settings){
 for(let n=0;n<260;n++)try{
  const cfg=generateConfig(settings),r=analyze(cfg);
  if(!isUseful(r))continue;
  // statical exactness: end-pin and hinge moments must vanish.
  if(Math.abs(r.force('M',0,0))>1e-6||Math.abs(r.force('M',r.elements.length-1,r.elements.at(-1).L))>1e-6)continue;
  if(cfg.structure==='threepin'&&Math.abs(r.force('M',1,r.elements[1].L))>1e-6)continue;
  const options={N:alternatives('N',r),Q:alternatives('Q',r),M:alternatives('M',r)};
  const correct=Object.fromEntries(['N','Q','M'].map(t=>[t,options[t].findIndex(o=>o.f.every(z=>z===1)&&o.bias.every(z=>z===0))]));
  return {cfg,options,correct,choices:optionsSVG(r,options)};
 }catch(_){/* retry */}
 throw Error('この荷重条件では出題できませんでした。条件を変更してください。');
}
return {CAT,geometry,generateConfig,analyze,breaks,isUseful,checkpoints,alternatives,value,diagramSVG,problemSVG,optionsSVG,makeQuestion,extremaM,curvesM};
})();
const ORIGIN = 'https://fujiharayoshiyasu.github.io';
const CATEGORIES = ['cantilever', 'simple', 'threepin'];
const EPS = 1e-8;
const random = a => a[Math.floor(Math.random() * a.length)];
const shuffle = a => {
  a = [...a];
  for (let i = a.length-1; i>0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const subtract = (a,b) => [a[0]-b[0], a[1]-b[1]];
const dot = (a,b) => a[0]*b[0]+a[1]*b[1];
const cross = (a,b) => a[0]*b[1]-a[1]*b[0];
const unique = a => [...new Set(a.map(Number))].sort((a,b)=>a-b);
const pairs = a => a.slice(1).map((v,i)=>[a[i],v]);

function geometry(cfg) {
  const d = cfg.orientation === 'left' ? 1 : -1;
  const A=[0,0], B=cfg.pattern==='A' ? [0,cfg.h] : [d*cfg.L,0];
  const C=[d*cfg.L,cfg.h];
  const nodes=[A,B,C];
  const members=[0,1].map(m => {
    const a=nodes[m], b=nodes[m+1], v=subtract(b,a), L=Math.hypot(...v);
    return {a,b,L,u:[v[0]/L,v[1]/L],horizontal:Math.abs(v[1])<EPS};
  });
  return {A,B,C,d,members};
}
function generateConfig(settings) {
  const count = settings.count === 'random' ? random([1,2,3]) : Number(settings.count);
  const pattern = settings.pattern === 'random' ? random(['A','B']) : settings.pattern;
  const orientation = settings.support === 'random' ? random(['left','right']) : settings.support;
  const L=random([2,3,4,5]), h=random([2,3,4,5]);
  const cfg={structure:'cantilever',pattern,orientation,L,h,loads:[]};
  const g=geometry(cfg);
  const kinds=Array.from({length:count},()=>settings.loadType === 'random'?random(['point','udl','moment']):settings.loadType);
  const occupied=[new Set(),new Set()], used=new Set();
  for (let i=0; i<count; i++) {
    const type=kinds[i]; let m=random([0,1]), x=0;
    if(type!=='udl') {
      const positions=[];
      for(let k=0;k<2;k++)for(let s=1;s<=g.members[k].L;s++) {
        if(!used.has(`${k}/${s}`))positions.push({m:k,s});
      }
      if(!positions.length)throw new Error('No free point-load positions');
      const p=random(positions);m=p.m;x=p.s;used.add(`${m}/${x}`);
    }
    const e=g.members[m];
    if(type==='point') {
      const value=random([2,4,6,8,10]);
      const [Fx,Fy]=e.horizontal?[0,-value]:[g.d*value,0];
      cfg.loads.push({id:i+1,type,member:m,x,value,Fx,Fy});
    } else if(type==='moment') {
      const value=random([-1,1])*random([2,4,6,8,10,12]);
      cfg.loads.push({id:i+1,type,member:m,x,value});
    } else {
      const future=kinds.slice(i+1).filter(t=>t==='udl').length;
      const candidates=[];
      for(let k=0;k<2;k++) {
        const len=g.members[k].L;
        for(let st=0;st<len;st++)for(let end=st+1;end<=len;end++) {
          const free=[...Array(end-st)].every((_,j)=>!occupied[k].has(st+j));
          const remaining=g.members[0].L+g.members[1].L-occupied[0].size-occupied[1].size-(end-st);
          if(free&&remaining>=future)candidates.push({m:k,start:st,end});
        }
      }
      if(!candidates.length)throw new Error('No suitable distributed-load interval');
      const full=candidates.filter(c=>c.start===0&&c.end===g.members[c.m].L);
      const p=full.length&&Math.random()<.38?random(full):random(candidates);
      m=p.m;
      for(let cell=p.start;cell<p.end;cell++)occupied[m].add(cell);
      const value=random([2,4,6]);
      const em=g.members[m]; const [Fx,Fy]=em.horizontal?[0,-value]:[g.d*value,0];
      cfg.loads.push({id:i+1,type,member:m,start:p.start,end:p.end,value,Fx,Fy});
    }
  }
  return cfg;
}
function analyze(cfg) {
  const g=geometry(cfg),members=g.members;
  const place=(m,s)=>members[m].a.map((v,i)=>v+members[m].u[i]*s);
  function loadTerms(ld,sectionMember,sectionS,side='left') {
    if(ld.member<sectionMember)return [];
    if(ld.type==='udl') {
      const start=ld.member===sectionMember?Math.max(sectionS,ld.start):ld.start;
      const end=ld.end;
      if(end<=start+EPS)return [];
      const dist=end-start;
      return [{r:place(ld.member,(start+end)/2),F:[ld.Fx*dist,ld.Fy*dist],couple:0}];
    }
    if(ld.member===sectionMember&&(ld.x<sectionS-EPS||(Math.abs(ld.x-sectionS)<EPS&&side==='right')))return [];
    return [{r:place(ld.member,ld.x),F:ld.type==='point'?[ld.Fx,ld.Fy]:[0,0],couple:ld.type==='moment'?ld.value:0}];
  }
  function totals(m,s,side='left') {
    const p=place(m,s);let F=[0,0],M=0;
    for(const ld of cfg.loads)for(const t of loadTerms(ld,m,s,side)) {
      F=[F[0]+t.F[0],F[1]+t.F[1]];
      M+=cross(subtract(t.r,p),t.F)+t.couple;
    }
    return {F,M};
  }
  function force(type,m,s,side='left') {
    const t=totals(m,s,side),u=members[m].u;
    return type==='N'?dot(t.F,u):type==='Q'?-cross(u,t.F):t.M;
  }
  return {cfg,geometry:g,elements:members,force};
}
function breaks(cfg,m) {
  const len=geometry(cfg).members[m].L;
  return unique([0,len,...cfg.loads.filter(ld=>ld.member===m).flatMap(ld=>ld.type==='udl'?[ld.start,ld.end]:[ld.x])]);
}
function useful(r) {
  return r.elements.every((_,m)=>pairs(breaks(r.cfg,m)).some(([a,b]) =>
    b-a>EPS&&[.18,.5,.82].some(t=>{
      const s=a+(b-a)*t;
      return ['N','Q','M'].some(type=>Math.abs(r.force(type,m,s))>1e-7);
    })
  ));
}
function checkpoints(type,r) {
  const out=[];
  for(let m=0;m<2;m++) {
    const xs=breaks(r.cfg,m);
    for(const x of xs)out.push({m,x,side:'left'},{m,x,side:'right'});
    if(type==='M')for(const [a,b] of pairs(xs)) {
      const q0=r.force('Q',m,a,'right'),q1=r.force('Q',m,b,'left');
      if(q0*q1<0)out.push({m,x:a+(b-a)*q0/(q0-q1),side:'right'});
    }
  }
  return out;
}
const VALID={f:[1,1],bias:[0,0]};
const TRANSFORMS=[
 {f:[-1,-1],bias:[0,0]},{f:[-1,1],bias:[0,0]},
 {f:[1,-1],bias:[0,0]},{f:[0,1],bias:[0,0]},
 {f:[1,0],bias:[0,0]},{f:[2,2],bias:[0,0]},
 {f:[2,1],bias:[0,0]},{f:[1,2],bias:[0,0]},
 {f:[0,0],bias:[0,0]}
];
function values(opt,type,r,points) {
  return points.map(({m,x,side})=>opt.f[m]*r.force(type,m,x,side)+opt.bias[m]);
}
function optionsFor(type,r) {
  const amp=Math.max(2,...r.cfg.loads.map(l=>Math.abs(l.value)));
  const extra=[
    {f:[1,1],bias:[amp,0]},{f:[1,1],bias:[-amp,0]},
    {f:[1,1],bias:[0,amp]},{f:[1,1],bias:[0,-amp]},
    {f:[0,1],bias:[amp,0]},{f:[1,0],bias:[0,amp]},
    {f:[0,1],bias:[-amp,0]},{f:[0,1],bias:[0,-amp]}
  ];
  const points=checkpoints(type,r), sig=o=>values(o,type,r,points).map(x=>x.toFixed(5)).join('/');
  const list=[VALID],seen=new Set([sig(VALID)]),correct=values(VALID,type,r,points);
  for(const opt of shuffle([...TRANSFORMS,...extra])) {
    const key=sig(opt);if(seen.has(key))continue;
    const v=values(opt,type,r,points);
    const scale=Math.max(1,...v.map(Math.abs),...correct.map(Math.abs));
    const delta=Math.sqrt(v.reduce((sum,z,i)=>sum+((z-correct[i])/scale)**2,0)/v.length);
    if(delta<.12)continue;
    list.push(opt);seen.add(key);if(list.length===4)break;
  }
  if(list.length!==4)throw new Error('Unable to generate four distinct choices');
  return shuffle(list).map((o,i)=>({...o,id:`choice-${i}`}));
}
// Render each answer as SVG server-side. Do NOT transmit option transforms or answer IDs.
const escapeText=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=v=>Math.abs(v-Math.round(v))<1e-8?String(Math.round(Math.abs(v))):String(Number(Math.abs(v).toFixed(2)));
const signed=v=>Math.abs(v)<1e-8?'0':(v<0?'−':'+')+fmt(v);
function diagramGeometry(cfg) {
  const d=cfg.orientation==='left'?1:-1;
  const origin=d===1?160:400,baseY=253,scale=36;
  const A=[origin,baseY], B=cfg.pattern==='A'?[origin,baseY-cfg.h*scale]:[origin+d*cfg.L*scale,baseY];
  const C=[origin+d*cfg.L*scale,baseY-cfg.h*scale];
  const nodes=[A,B,C],segments=[[A,B],[B,C]];
  const pos=(m,s)=>{
    const a=segments[m][0],b=segments[m][1],len=m===0?(cfg.pattern==='A'?cfg.h:cfg.L):(cfg.pattern==='A'?cfg.L:cfg.h);
    return [a[0]+(b[0]-a[0])*s/len,a[1]+(b[1]-a[1])*s/len];
  };
  return {nodes,segments,pos};
}
function extremeM(opt,r){
  const points=checkpoints('M',r);
  const items=points.map(p=>({...p,value:opt.f[p.m]*r.force('M',p.m,p.x,p.side)+opt.bias[p.m]}));
  const max=items.reduce((a,b)=>Math.abs(a.value)>=Math.abs(b.value)?a:b);
  const label=max.m===0?(max.x<EPS?'A':Math.abs(max.x-r.elements[0].L)<EPS?'B':`AB x=${fmt(max.x)}m`)
    :(max.x<EPS?'B':Math.abs(max.x-r.elements[1].L)<EPS?'C':`BC x=${fmt(max.x)}m`);
  return {value:max.value,label};
}
function curvesM(opt,r) {
  const out=[];
  for(let m=0;m<2;m++) {
    if(Math.abs(opt.f[m])<EPS)continue;
    const cuts=unique([0,r.elements[m].L,...r.cfg.loads.filter(l=>l.type==='udl'&&l.member===m).flatMap(l=>[l.start,l.end])]);
    for(const [s,e] of pairs(cuts)) {
      const mid=(s+e)/2,u=r.elements[m].u;
      const w=r.cfg.loads.filter(l=>l.member===m&&l.type==='udl'&&l.start<mid&&l.end>mid)
        .reduce((a,l)=>[a[0]+l.Fx,a[1]+l.Fy],[0,0]);
      if(Math.abs(cross(u,w))>EPS)out.push({m,start:s,end:e});
    }
  }
  return out;
}
function renderOptionSvg(opt,type,shared,r,key) {
  const cfg=r.cfg,g=diagramGeometry(cfg),col={N:'#118f88',Q:'#3679ba',M:'#cf6445'}[type];
  const scale=Math.min(25,52/Math.max(shared,1)),normal=type==='M'?-1:1;
  const path=pp=>pp.map((p,i)=>`${i?'L':'M'}${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(' ');
  const val=(m,s,side='left')=>opt.f[m]*r.force(type,m,s,side)+opt.bias[m];
  function locate(m,s,v) {
    const p=g.pos(m,s),z=g.segments[m],dx=z[1][0]-z[0][0],dy=z[1][1]-z[0][1],le=Math.hypot(dx,dy);
    return [p[0]+normal*dy/le*v*scale,p[1]-normal*dx/le*v*scale];
  }
  const shapes=[];
  const hatchDefs=`<defs>${r.elements.map((el,m)=>`<pattern id="h-${key}-${m}" width="10" height="10" patternUnits="userSpaceOnUse"><path d="${el.horizontal?'M5 0V10':'M0 5H10'}" stroke="${col}" stroke-width="1.15" opacity=".72"/></pattern>`).join('')}</defs>`;
  for(let m=0;m<2;m++)for(const [start,end] of pairs(breaks(cfg,m))){
    const baseline=[],curve=[];
    for(let j=0;j<=36;j++) {
      const s=start+(end-start)*j/36,side=j===0?'right':j===36?'left':'right';
      baseline.push(locate(m,s,0));curve.push(locate(m,s,val(m,s,side)));
    }
    const outline=path([...baseline,...curve.slice().reverse()]);
    shapes.push(`<path d="${outline}Z" fill="${col}" fill-opacity=".08"/><path d="${outline}Z" fill="url(#h-${key}-${m})"/><path d="${path(curve)}" fill="none" stroke="${col}" stroke-width="3"/>`);
  }
  for(const ld of cfg.loads) {
    if((type==='M'&&ld.type==='moment')||(['N','Q'].includes(type)&&ld.type==='point')) {
      const a=locate(ld.member,ld.x,val(ld.member,ld.x,'left'));
      const b=locate(ld.member,ld.x,val(ld.member,ld.x,'right'));
      if(Math.hypot(a[0]-b[0],a[1]-b[1])>1)shapes.push(`<path d="${path([a,b])}" stroke="${col}" stroke-width="2" stroke-dasharray="4 3"/>`);
    }
  }
  const text=(x,y,s,sz=15,anchor='start',color='#294b60')=>`<text x="${x}" y="${y}" font-size="${sz}" font-weight="750" text-anchor="${anchor}" fill="${color}" paint-order="stroke" stroke="#fff" stroke-width="3">${escapeText(s)}</text>`;
  const unit=type==='M'?'kNm':'kN',rows=['節点位置の断面力（AB：A/B、BC：B/C）'];
  const measure=v=>`${type==='M'?fmt(v):signed(v)} ${unit}`;
  for(let m=0;m<2;m++) {
    const len=r.elements[m].L;
    rows.push(`${m===0?'AB':'BC'}：${'ABC'[m]} ${measure(val(m,0,'right'))} → ${'ABC'[m+1]} ${measure(val(m,len,'left'))}`);
  }
  if(type==='N')rows.push('引張（＋） ／ 圧縮（−）');
  if(type==='M') {
    const extreme=extremeM(opt,r);
    rows.push(`最大 |M| = ${fmt(extreme.value)} kNm（${extreme.label}）`);
    const curves=curvesM(opt,r);
    rows.push(curves.length?'2次曲線：'+curves.map(z=>`${z.m===0?'AB':'BC'} ${z.start}〜${z.end}m`).join('、'):'2次曲線：なし');
    for(const z of curves){
      const a=g.pos(z.m,z.start),b=g.pos(z.m,z.end),d=cfg.orientation==='left'?1:-1;
      if(r.elements[z.m].horizontal)shapes.push(`<path d="M${a[0]} ${a[1]-9}v-8H${b[0]}v8" fill="none" stroke="#a76f40" stroke-width="1.8"/>`);
      else shapes.push(`<path d="M${a[0]+d*9} ${a[1]}h${d*8}V${b[1]}h${-d*8}" fill="none" stroke="#a76f40" stroke-width="1.8"/>`);
    }
  }
  const base=289,height=base+rows.length*25+17;
  const nodeLabels=g.nodes.map((p,i)=>text(p[0]+(i===2?10:-14),p[1]+(i===0?19:-12),'ABC'[i],15));
  const memberLabels=g.segments.map((seg,m)=>{
    const a=seg[0],b=seg[1],mid=[(a[0]+b[0])/2,(a[1]+b[1])/2];
    const horizontal=Math.abs(b[0]-a[0])>Math.abs(b[1]-a[1]);
    const x=mid[0]+(horizontal?0:(cfg.orientation==='left'?-28:26)),y=mid[1]+(horizontal?23:-5);
    return `<rect x="${x-17}" y="${y-14}" width="34" height="19" rx="5" fill="white" fill-opacity=".92" stroke="${col}" stroke-width=".8"/>${text(x,y,m===0?'AB':'BC',13,'middle','#23435b')}`;
  });
  const info=rows.map((line,i)=>text(16,base+22+i*25,line,i>4?14:15));
  return `<svg class="numeric-diagram" viewBox="0 0 560 ${height}" role="img" aria-label="${type}図">${hatchDefs}<path d="${path(g.nodes)}" fill="none" stroke="#9fb3c2" stroke-dasharray="4 4" stroke-width="3"/>${shapes.join('')}${nodeLabels.join('')}${memberLabels.join('')}<rect x="9" y="${base}" width="542" height="${rows.length*25+8}" rx="8" fill="#eff4f8"/>${info.join('')}</svg>`;
}
function renderChoices(r,opts) {
  const result={};
  for(const type of ['N','Q','M']) {
    const pts=checkpoints(type,r);
    const max=Math.max(1,...opts[type].flatMap(o=>pts.map(({m,x,side})=>Math.abs(o.f[m]*r.force(type,m,x,side)+o.bias[m]))));
    result[type]=opts[type].map((o,i)=>({svg:renderOptionSvg(o,type,max,r,`${type.toLowerCase()}-${crypto.randomUUID().replaceAll('-','')}-${i}`)}));
  }
  return result;
}

function getSettings(raw) {
  const s=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{};
  const take=(key,allowed,fallback)=>allowed.includes(s[key])?s[key]:fallback;
  return {
    pattern:take('pattern',['A','B','random'],'random'),
    loadType:take('loadType',['point','udl','moment','random'],'random'),
    count:take('count',['1','2','3','random'],'1'),
    support:take('support',['left','right','random'],'random')
  };
}
function makeQuestion(settings) {
  for(let attempt=0;attempt<150;attempt++) {
    try {
      const cfg=generateConfig(settings),r=analyze(cfg);
      if(!useful(r))continue;
      const opts={N:optionsFor('N',r),Q:optionsFor('Q',r),M:optionsFor('M',r)};
      return {cfg,opts,correct:Object.fromEntries(['N','Q','M'].map(type=>[type,opts[type].findIndex(o=>o.f[0]===1&&o.f[1]===1&&o.bias.every(v=>v===0))]))};
    } catch (_) { /* Retry a new geometry and load combination */ }
  }
  throw new Error('Cannot produce a valid question for the selected conditions');
}
const GUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const validId=v=>typeof v==='string'&&GUID.test(v);
function response(obj,status=200,method='GET') {
  const headers={
    'Content-Type':'application/json; charset=utf-8',
    'Access-Control-Allow-Origin':ORIGIN,
    'Access-Control-Allow-Methods':'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers':'Content-Type',
    'Vary':'Origin',
    'Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff'
  };
  return new Response(method==='HEAD'?null:JSON.stringify(obj),{status,headers});
}
async function readBody(request) {
  const contentLength=Number(request.headers.get('content-length')||0);
  if(contentLength>4096)throw new Error('Too much data');
  const body=await request.text();
  if(body.length>4096)throw new Error('Too much data');
  const value=JSON.parse(body);
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid JSON object');
  return value;
}
async function saveLeaderboard(env,session,streak) {
  await env.DB.prepare(`INSERT INTO leaderboard_scores (player_id,nickname,category,best_streak)
    VALUES(?,?,?,?)
    ON CONFLICT(player_id,category) DO UPDATE SET
       best_streak=MAX(best_streak,excluded.best_streak),
       nickname=excluded.nickname,
       updated_at=CASE WHEN excluded.best_streak>best_streak
         THEN CURRENT_TIMESTAMP ELSE updated_at END`)
    .bind(session.player_id,session.nickname,session.category,streak).run();
}
const fail=(error,status=400)=>response({error},status);
export default {
  async fetch(request,env) {
    const url=new URL(request.url),path=url.pathname;
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{
      'Access-Control-Allow-Origin':ORIGIN,
      'Access-Control-Allow-Methods':'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers':'Content-Type',
      'Access-Control-Max-Age':'86400',
      'Vary':'Origin'
    }});
    if(!env.DB)return fail('D1 binding DB is missing',503);
    try {
      if(request.method==='GET' && path==='/health') {
        const check=await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('leaderboard_scores','quiz_sessions','quiz_rounds')").all();
        const names=new Set((check.results||[]).map(x=>x.name));
        const ok=['leaderboard_scores','quiz_sessions','quiz_rounds'].every(x=>names.has(x));
        return response({ok,database:'connected',table:ok?'ready':'not found',tables:[...names],version:2,categories:['cantilever','simple','threepin']},ok?200:503);
      }
      if(request.method==='GET' && path==='/rankings') {
        const category=url.searchParams.get('category')||'cantilever';
        if(!CATEGORIES.includes(category))return fail('Invalid category');
        const rows=await env.DB.prepare(`SELECT nickname, MAX(best_streak) AS best_streak
          FROM leaderboard_scores WHERE category=? GROUP BY nickname
          ORDER BY best_streak DESC, nickname COLLATE NOCASE ASC LIMIT 10`).bind(category).all();
        return response({category,rankings:rows.results||[]});
      }
      if(request.method==='POST' && path==='/sessions') {
        const body=await readBody(request);
        const nickname=typeof body.nickname==='string'?body.nickname.trim().replace(/\s+/g,' '):'';
        if(!nickname||[...nickname].length>16||/[<>\u0000-\u001f\u007f]/.test(nickname))return fail('Nickname must be 1–16 characters');
        const category=body.category||'cantilever';
        if(!CATEGORIES.includes(category))return fail('This quiz category is not available');
        const sessionId=crypto.randomUUID(),playerId=crypto.randomUUID();
        await env.DB.prepare(`INSERT INTO quiz_sessions(session_id,player_id,nickname,category)
           VALUES (?,?,?,?)`).bind(sessionId,playerId,nickname,category).run();
        return response({session_id:sessionId,player_id:playerId,nickname,category,current_streak:0},201);
      }
      if(request.method==='POST' && path==='/rounds') {
        const body=await readBody(request);
        if(!validId(body.session_id))return fail('Invalid session_id');
        const session=await env.DB.prepare('SELECT * FROM quiz_sessions WHERE session_id=?').bind(body.session_id).first();
        if(!session)return fail('Session not found',404);
        if(!CATEGORIES.includes(session.category))return fail('Unsupported category');
        const pending=await env.DB.prepare(`SELECT round_id, question_json FROM quiz_rounds
             WHERE session_id=? AND answered_at IS NULL ORDER BY created_at DESC LIMIT 1`).bind(session.session_id).first();
        if(pending && body.skip!==true) {
          return response({round_id:pending.round_id,...JSON.parse(pending.question_json),current_streak:session.current_streak});
        }
        if(pending) {
          await env.DB.batch([
            env.DB.prepare(`UPDATE quiz_rounds SET answered_at=CURRENT_TIMESTAMP WHERE session_id=? AND answered_at IS NULL`).bind(session.session_id),
            env.DB.prepare(`UPDATE quiz_sessions SET current_streak=0,updated_at=CURRENT_TIMESTAMP WHERE session_id=?`).bind(session.session_id)
          ]);
        }
        const isPortal=session.category!=='cantilever';
        const q=isPortal?
          PortalEngine.makeQuestion({...getSettings(body.settings),structure:session.category}):
          makeQuestion(getSettings(body.settings));
        const roundId=crypto.randomUUID();
        const questionJson=JSON.stringify({cfg:q.cfg,choices:isPortal?q.choices:renderChoices(analyze(q.cfg),q.opts)});
        await env.DB.prepare(`INSERT INTO quiz_rounds
           (round_id,session_id,question_json,correct_n,correct_q,correct_m)
           VALUES(?,?,?,?,?,?)`)
          .bind(roundId,session.session_id,questionJson,q.correct.N,q.correct.Q,q.correct.M).run();
        return response({round_id:roundId,...JSON.parse(questionJson),current_streak:pending?0:session.current_streak},201);
      }
      if(request.method==='POST' && path==='/answers') {
        const body=await readBody(request);
        if(!validId(body.session_id)||!validId(body.round_id))return fail('Invalid session or round ID');
        const answers=body.answers;
        if(!answers||!['N','Q','M'].every(t=>Number.isInteger(answers[t])&&answers[t]>=0&&answers[t]<=3))return fail('Answers N/Q/M must be numbers 0–3');
        const round=await env.DB.prepare(`SELECT * FROM quiz_rounds WHERE round_id=? AND session_id=?`)
          .bind(body.round_id,body.session_id).first();
        if(!round)return fail('Round not found',404);
        if(round.answered_at)return fail('Round already answered',409);
        const session=await env.DB.prepare('SELECT * FROM quiz_sessions WHERE session_id=?').bind(body.session_id).first();
        if(!session)return fail('Session not found',404);
        const seconds=Date.now()-Date.parse(round.created_at.replace(' ','T')+'Z');
        if(!Number.isFinite(seconds)||seconds>60*60*1000)return fail('Round has expired (60 min)',409);
        const correct={N:round.correct_n,Q:round.correct_q,M:round.correct_m};
        const score=['N','Q','M'].filter(t=>answers[t]===correct[t]).length;
        // This atomic claim allows the round to affect the streak only once.
        const claim=await env.DB.prepare(`UPDATE quiz_rounds SET answered_at=CURRENT_TIMESTAMP
          WHERE round_id=? AND session_id=? AND answered_at IS NULL RETURNING round_id`)
          .bind(body.round_id,body.session_id).first();
        if(!claim)return fail('Round already answered',409);
        const changed=await env.DB.prepare(`UPDATE quiz_sessions
          SET current_streak=CASE WHEN ?=1 THEN current_streak+1 ELSE 0 END,
          updated_at=CURRENT_TIMESTAMP WHERE session_id=? RETURNING current_streak`)
          .bind(score===3?1:0,session.session_id).first();
        const current_streak=Number(changed?.current_streak||0);
        if(score===3)await saveLeaderboard(env,session,current_streak);
        return response({round_id:round.round_id,score,correct,current_streak,perfect:score===3});
      }
      return request.method==='GET'
        ?response({service:'FRAME QUIZ API',endpoints:['/health','/rankings','POST /sessions','POST /rounds','POST /answers']})
        :fail('Method not allowed or endpoint not found',405);
    } catch(err) {
      if(err instanceof SyntaxError)return fail('Invalid JSON');
      if(err.message==='Too much data'||err.message==='Invalid JSON object')return fail(err.message);
      console.error('FRAME QUIZ API error',err);
      return fail('Server error',500);
    }
  }
};
// For deterministic tests only; not exported by the deployed Worker.