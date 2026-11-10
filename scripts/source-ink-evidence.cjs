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
 const seedComponents=new Int32Array(N).fill(-1);let componentId=0;for(const start of mask)if(seedComponents[start]<0){const q=[start];seedComponents[start]=componentId;for(let i=0;i<q.length;i++)for(const p of near(q[i]))if(mask.has(p)&&pigment[p]===pigment[start]&&seedComponents[p]<0){seedComponents[p]=componentId;q.push(p);}componentId++;}
 const visited=new Set(),intervals=[],ambiguous=[];
 for(const start of evidence)if(!visited.has(start)){const part=[start],contacts=new Map();visited.add(start);for(let i=0;i<part.length;i++)for(const q of near(part[i])){if(mask.has(q)){const color=pigment[q];if(!contacts.has(color))contacts.set(color,new Set());contacts.get(color).add(q);}else if(evidence.has(q)&&!visited.has(q)){visited.add(q);part.push(q);}}
  const ranked=[...contacts].map(([color,set])=>({color,set,count:set.size})).sort((a,b)=>b.count-a.count),best=ranked[0];if(!best||best.count<2||new Set([...best.set].map(p=>seedComponents[p]).filter(v=>v>=0)).size<2)continue;
  // Keep endpoints/branches of different materials separate. A tiny fringe
  // contact does not override two-sided support from the dominant source line.
  if(ranked[1]&&ranked[1].count>best.count*.25){ambiguous.push({pixels:part.length,colors:ranked.map(x=>x.color)});continue;}
  const pts=[...best.set],xs=pts.map(p=>p%w),ys=pts.map(p=>Math.floor(p/w));if(Math.max(Math.max(...xs)-Math.min(...xs),Math.max(...ys)-Math.min(...ys))<2)continue;
  const groups=new Map();for(const p of pts){const id=seedComponents[p];if(id<0)continue;if(!groups.has(id))groups.set(id,[]);groups.get(id).push(p);}
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
 return {version:1,executed:true,method:'source-ridge-role-continuity',intervals,ambiguous,addedSourcePixels:intervals.reduce((n,r)=>n+r.sourcePixels.length,0)};
}
module.exports={reconcileSourceInk};
