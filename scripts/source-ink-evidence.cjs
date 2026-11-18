'use strict';
// Source-space evidence, before medial tracing. Narrow dark ridges can change
// palette label along one continuous stroke. Neighboring material is not ink.
function reconcileSourceInk(source,mask,pigment,step,protectedSource){
 const w=source.width,h=source.height,N=w*h,lum=new Float32Array(N);for(let p=0;p<N;p++){const k=p*4;lum[p]=.2126*source.data[k]+.7152*source.data[k+1]+.0722*source.data[k+2];}
 const near=(p,diag=true)=>{const x=p%w,y=Math.floor(p/w),out=[];for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if((dx||dy)&&(diag||!dx||!dy)&&x+dx>=0&&x+dx<w&&y+dy>=0&&y+dy<h)out.push((y+dy)*w+x+dx);return out;};
 const distance=new Int16Array(N).fill(-1),queue=[];for(const p of mask){distance[p]=0;queue.push(p);}const radius=Math.max(2,Math.ceil(step*3));for(let i=0;i<queue.length;i++)if(distance[queue[i]]<radius)for(const q of near(queue[i]))if(distance[q]<0&&!protectedSource(q)){distance[q]=distance[queue[i]]+1;queue.push(q);}
 const evidence=new Set(),directions=[[1,0],[0,1],[1,1],[1,-1]];
 for(const p of queue){if(mask.has(p)||protectedSource(p))continue;const x=p%w,y=Math.floor(p/w);let ridge=false;
  for(const[dx,dy]of directions){for(let r=2;r<=Math.ceil(step*2);r++){const ax=x+dx*r,ay=y+dy*r,bx=x-dx*r,by=y-dy*r;if(Math.min(ax,bx)<0||Math.max(ax,bx)>=w||Math.min(ay,by)<0||Math.max(ay,by)>=h)continue;const a=ay*w+ax,b=by*w+bx;if(Math.min(lum[a],lum[b])-lum[p]>=24&&Math.abs(lum[a]-lum[b])<95){ridge=true;break;}}if(ridge)break;}
  if(ridge)evidence.add(p);
 }
 const visited=new Set(),intervals=[],ambiguous=[];
 for(const start of evidence)if(!visited.has(start)){const part=[start],contacts=new Map();visited.add(start);for(let i=0;i<part.length;i++)for(const q of near(part[i])){if(mask.has(q)){const color=pigment[q];if(!contacts.has(color))contacts.set(color,new Set());contacts.get(color).add(q);}else if(evidence.has(q)&&!visited.has(q)){visited.add(q);part.push(q);}}
  const ranked=[...contacts].map(([color,set])=>({color,set,count:set.size})).sort((a,b)=>b.count-a.count),best=ranked[0];if(!best||best.count<2)continue;
  // Keep endpoints/branches of different materials separate. A tiny fringe
  // contact does not override two-sided support from the dominant source line.
  if(ranked[1]&&ranked[1].count>best.count*.25){ambiguous.push({pixels:part.length,colors:ranked.map(x=>x.color)});continue;}
  const pts=[...best.set],xs=pts.map(p=>p%w),ys=pts.map(p=>Math.floor(p/w));if(Math.max(Math.max(...xs)-Math.min(...xs),Math.max(...ys)-Math.min(...ys))<2)continue;
  // Count separate contacts at this uncertainty interval, not global line
  // components. Both ends of a gap in a closed contour already belong to
  // one component via the opposite side; that is not one-sided evidence.
  const groups=new Map(),pending=new Set(pts);while(pending.size){const q=[pending.values().next().value];pending.delete(q[0]);for(let i=0;i<q.length;i++)for(const p of near(q[i]))if(pending.delete(p))q.push(p);groups.set(groups.size,q);}
  if(groups.size<2)continue;
  const allowed=new Set(part),bridges=new Set(),anchors=[];const entries=[...groups];
  for(let a=0;a<entries.length;a++)for(let b=a+1;b<entries.length;b++){
   const ends=new Set(entries[b][1]),parents=new Map(),q=[];for(const p of entries[a][1])for(const n of near(p))if(allowed.has(n)&&!parents.has(n)){parents.set(n,{previous:p,length:1});q.push(n);}let finish=null;
   for(let i=0;i<q.length&&finish===null;i++){const p=q[i],state=parents.get(p);if(state.length>Math.ceil(step*3))continue;for(const n of near(p)){if(ends.has(n)){finish=p;anchors.push(n);break;}if(allowed.has(n)&&!parents.has(n)){parents.set(n,{previous:p,length:state.length+1});q.push(n);}}}
   if(finish===null)continue;const center=[];let p=finish;while(parents.has(p)){center.push(p);p=parents.get(p).previous;}anchors.push(p);
   // Own only the observed narrow interval around this route, not every
   // connected dark/shadow pixel in the uncertainty component.
   const grow=center.map(p=>[p,0]),seen=new Set(center);for(let i=0;i<grow.length;i++){const[p,r]=grow[i];bridges.add(p);if(r>=Math.max(1,Math.floor(step/2)))continue;for(const n of near(p))if(allowed.has(n)&&!seen.has(n)){seen.add(n);grow.push([n,r+1]);}}
  }
  if(!bridges.size)continue;for(const p of bridges){mask.add(p);pigment[p]=best.color;}intervals.push({color:best.color,sourcePixels:[...bridges],anchors});
 }
 // Own a one-source-pixel antialias fringe with the stroke before palette
 // assignment turns that mixed sample into a second grey/material line.
 // This is not dilation: require an actual collinear ink -> mixture -> fill
 // ramp, keep explicit fills/features protected, and never grow iteratively.
 const fringe=new Map(),original=new Set(mask),axes=[[1,0],[-1,0],[0,1],[0,-1]];
 for(const a of original){const ax=a%w,ay=Math.floor(a/w);for(const[dx,dy]of axes){
  const x=ax+dx,y=ay+dy,p=y*w+x,bx=x+dx,by=y+dy;
  if(x<0||x>=w||y<0||y>=h||bx<0||bx>=w||by<0||by>=h||original.has(p)||protectedSource(p))continue;
  const b=by*w+bx;if(original.has(b)||lum[b]-lum[a]<60||lum[p]<=lum[a]+8||lum[p]>=lum[b]-8)continue;
  const av=[...source.data.subarray(a*4,a*4+3)],pv=[...source.data.subarray(p*4,p*4+3)],bv=[...source.data.subarray(b*4,b*4+3)];
  const v=av.map((c,i)=>c-bv[i]),den=v.reduce((s,c)=>s+c*c,0),t=pv.reduce((s,c,i)=>s+(c-bv[i])*v[i],0)/den;
  if(t<.25||t>.9||Math.sqrt(pv.reduce((s,c,i)=>s+(c-bv[i]-t*v[i])**2,0))>8)continue;
  const old=fringe.get(p),color=pigment[a];fringe.set(p,old!==undefined&&old!==color?0:color);
 }}
 const fringeSourcePixels=[];for(const[p,color]of fringe)if(color){mask.add(p);pigment[p]=color;fringeSourcePixels.push(p);}
 return {version:1,executed:true,method:'source-ridge-role-continuity',intervals,ambiguous,fringeSourcePixels,addedSourcePixels:intervals.reduce((n,r)=>n+r.sourcePixels.length,0)+fringeSourcePixels.length};
}
module.exports={reconcileSourceInk};
