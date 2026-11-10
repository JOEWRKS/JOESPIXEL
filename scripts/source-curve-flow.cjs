'use strict';
// Geometry in native-grid units, before any color is written. Endpoints and
// persistent source corners are anchors; no destination coordinates are inputs.
const {rasterPath}=require('./raster-source-ink-paths.cjs');
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
function resample(path,spacing=.5){
 const out=[path[0]],arc=[0];let length=0,next=spacing;
 for(let i=1;i<path.length;i++){const a=path[i-1],b=path[i],span=distance(a,b);while(next<=length+span&&span){const t=(next-length)/span;out.push([a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])]);arc.push(next);next+=spacing;}length+=span;}
 if(distance(out.at(-1),path.at(-1))>1e-8){out.push(path.at(-1));arc.push(length);}return {points:out,arc,length};
}
function turn(points,i,r){
 const a=points[Math.max(0,i-r)],b=points[i],c=points[Math.min(points.length-1,i+r)],u=[b[0]-a[0],b[1]-a[1]],v=[c[0]-b[0],c[1]-b[1]];
 return Math.atan2(u[0]*v[1]-u[1]*v[0],u[0]*v[0]+u[1]*v[1]);
}
function fitSourceCurve(path,{radius=4,maxDeviation=.8}={}){
 const sampled=resample(path),{points,arc,length}=sampled,anchors=new Set([0,points.length-1]);
 if(length<radius*3)return {...sampled,fitted:path,anchors:[...anchors],maxMove:0};
 // A real corner persists at two arc scales. A small staircase elbow does
 // not: its direction change becomes small at the longer scale.
 for(let i=12;i<points.length-12;i++){
  const near=turn(points,i,6),far=turn(points,i,12);
  if(Math.abs(near)>.72&&Math.abs(far)>.72&&Math.sign(near)===Math.sign(far)&&Math.abs(far/near)<1.5)anchors.add(i);
 }
 const anchorList=[...anchors];let maxMove=0;
 const fitted=points.map((p,i)=>{
  const separation=Math.min(...anchorList.map(a=>Math.abs(arc[a]-arc[i])));if(separation<=1)return p;
  const span=Math.ceil(radius*4),sum=[0,0];let weights=0;
  for(let j=Math.max(0,i-span);j<=Math.min(points.length-1,i+span);j++){
   const delta=arc[j]-arc[i],weight=Math.exp(-.5*(delta/radius)**2);sum[0]+=points[j][0]*weight;sum[1]+=points[j][1]*weight;weights+=weight;
  }
  const blend=Math.min(1,(separation-1)/radius),dx=(sum[0]/weights-p[0])*blend,dy=(sum[1]/weights-p[1])*blend,move=Math.hypot(dx,dy),limit=Math.min(1,maxDeviation/(move||1));maxMove=Math.max(maxMove,move*limit);
  return [p[0]+dx*limit,p[1]+dy*limit];
 });return {...sampled,fitted,anchors:anchorList,maxMove};
}
function orderedCells(path){const out=[];for(let i=1;i<path.length;i++)for(const p of rasterPath(path[i-1],path[i],false))if(!out.length||p[0]!==out.at(-1)[0]||p[1]!==out.at(-1)[1])out.push(p);return out;}
// Sample the curve at dominant-axis cell centers. Flooring every short
// subsegment instead traces every grid crossing and adds horizontal spurs to
// an otherwise smooth steep curve. Return cell centers so downstream tracing
// consumes this single allocation rather than quantizing it a second time.
function digitizeCurve(points){
 const result=[],offer=(x,y)=>{const p=[Math.floor(x)+.5,Math.floor(y)+.5];if(!result.length||p[0]!==result.at(-1)[0]||p[1]!==result.at(-1)[1])result.push(p);};
 offer(...points[0]);
 for(let i=1;i<points.length;i++){
  const a=points[i-1],b=points[i],dx=b[0]-a[0],dy=b[1]-a[1],axis=Math.abs(dx)>=Math.abs(dy)?0:1,d=b[axis]-a[axis];if(!d)continue;
  const low=Math.min(a[axis],b[axis]),high=Math.max(a[axis],b[axis]),levels=[];
  for(let n=Math.ceil(low-.5);n+.5<=high;n++)if(n+.5>=low)levels.push(n+.5);
  if(d<0)levels.reverse();
  for(const level of levels){const t=(level-a[axis])/d;offer(a[0]+dx*t,a[1]+dy*t);}
 }
 offer(...points.at(-1));return result;
}
function elbowEnergy(path,anchors=[]){
 const cells=orderedCells(path),runs=[];for(let i=1;i<cells.length;i++){const a=cells[i-1],b=cells[i],dx=b[0]-a[0],dy=b[1]-a[1],last=runs.at(-1);if(last&&last.dx===dx&&last.dy===dy)last.length++;else runs.push({dx,dy,length:1,point:a});}
 let energy=0;for(let i=1;i<runs.length;i++){const a=runs[i-1],b=runs[i];if(anchors.some(p=>distance(p,b.point)<3))continue;if((!a.dx||!a.dy)&&(!b.dx||!b.dy)&&a.dx*b.dx+a.dy*b.dy===0)energy+=Math.min(a.length,b.length)**2;}return energy;
}
function rasterSet(path,width,height,locked){return new Set(orderedCells(path).filter(([x,y])=>x>=0&&y>=0&&x<width&&y<height&&!locked.has(y*width+x)).map(([x,y])=>y*width+x));}
function topologySignature(cells,width,height,box){
 const [l,t,r,b]=box,result=[];
 for(const foreground of [true,false]){const pending=new Set();for(let y=t;y<=b;y++)for(let x=l;x<=r;x++)if(cells.has(y*width+x)===foreground)pending.add(y*width+x);const components=[];
  while(pending.size){const q=[pending.values().next().value],boundary=[];pending.delete(q[0]);for(let i=0;i<q.length;i++){const p=q[i],x=p%width,y=Math.floor(p/width);if(x===l||x===r||y===t||y===b)boundary.push(p);for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if((dx||dy)&&(foreground||!dx||!dy)&&x+dx>=l&&x+dx<=r&&y+dy>=t&&y+dy<=b){const n=(y+dy)*width+x+dx;if(pending.delete(n))q.push(n);}}
   components.push(boundary.sort((a,b)=>a-b).join(','));}
  result.push(components.sort().join('|'));}
 return JSON.stringify(result);
}
function enclosedBackgroundGuards(image,background,radius=2){
 const width=image.width,height=image.height,backgroundCells=new Set(),exterior=new Set(),queue=[];
 for(let p=0;p<width*height;p++)if(image.data.readUInt32BE(p*4)===background)backgroundCells.add(p);
 const offer=p=>{if(backgroundCells.has(p)&&!exterior.has(p)){exterior.add(p);queue.push(p);}};
 for(let x=0;x<width;x++){offer(x);offer((height-1)*width+x);}for(let y=0;y<height;y++){offer(y*width);offer(y*width+width-1);}
 for(let i=0;i<queue.length;i++){const p=queue[i],x=p%width,y=Math.floor(p/width);if(x)offer(p-1);if(x+1<width)offer(p+1);if(y)offer(p-width);if(y+1<height)offer(p+width);}
 const guards=new Set();for(const p of backgroundCells)if(!exterior.has(p)){const x=p%width,y=Math.floor(p/width);for(let dy=-radius;dy<=radius;dy++)for(let dx=-radius;dx<=radius;dx++)if(x+dx>=0&&x+dx<width&&y+dy>=0&&y+dy<height)guards.add((y+dy)*width+x+dx);}return guards;
}
function layoutCurveFlow(paths,width,height,locked,config,protectedSpaces=new Set()){
 if(config?.version!==1||config.method!=='anchored-source-curve')throw Error('Explicit anchored source-curve policy required');
 const counts=new Map(),sets=paths.map(p=>rasterSet(p,width,height,locked));for(const set of sets)for(const p of set)counts.set(p,(counts.get(p)||0)+1);
 const current=new Set(counts.keys()),result=paths.slice(),records=[];
 for(let i=0;i<paths.length;i++){
  const fit=fitSourceCurve(paths[i]),anchors=fit.anchors.map(k=>fit.points[k]);if(!fit.maxMove)continue;
  const allocated=digitizeCurve(fit.fitted);
  const before=elbowEnergy(paths[i],anchors),after=elbowEnergy(allocated,anchors);if(after>=before)continue;
  const old=sets[i],next=rasterSet(allocated,width,height,locked),removed=[...old].filter(p=>!next.has(p)),added=[...next].filter(p=>!old.has(p));if(!removed.length&&!added.length)continue;
  if(anchors.some(([x,y])=>old.has(Math.floor(y)*width+Math.floor(x))&&!next.has(Math.floor(y)*width+Math.floor(x)))){records.push({path:i,before,after,accepted:false,reason:'source corner anchor'});continue;}
  if([...removed,...added].some(p=>protectedSpaces.has(p))){records.push({path:i,before,after,maxMove:fit.maxMove,anchors:anchors.length,accepted:false,reason:'source negative-space clearance'});continue;}
  const xs=[...old,...next].map(p=>p%width),ys=[...old,...next].map(p=>Math.floor(p/width)),box=[Math.max(0,Math.min(...xs)-2),Math.max(0,Math.min(...ys)-2),Math.min(width-1,Math.max(...xs)+2),Math.min(height-1,Math.max(...ys)+2)];
  const trial=new Set(current);for(const p of removed)if(counts.get(p)===1)trial.delete(p);for(const p of added)trial.add(p);
  const unchangedTopology=topologySignature(current,width,height,box)===topologySignature(trial,width,height,box);
  const other=p=>current.has(p)&&(!old.has(p)||counts.get(p)>1),clearance=p=>{let d=3;const x=p%width,y=Math.floor(p/width);for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++)if(x+dx>=0&&x+dx<width&&y+dy>=0&&y+dy<height&&other((y+dy)*width+x+dx))d=Math.min(d,Math.max(Math.abs(dx),Math.abs(dy)));return d;};
  const squeezed=added.some(p=>{const x=p%width,y=Math.floor(p/width),near=[...old].filter(q=>Math.max(Math.abs(q%width-x),Math.abs(Math.floor(q/width)-y))<=1);return near.length&&clearance(p)<Math.min(...near.map(clearance));});
  records.push({path:i,before,after,maxMove:fit.maxMove,anchors:anchors.length,accepted:unchangedTopology&&!squeezed,reason:!unchangedTopology?'topology':squeezed?'clearance':'improved curve flow'});
  if(!unchangedTopology||squeezed)continue;
  for(const p of old){const n=counts.get(p)-1;if(n)counts.set(p,n);else{counts.delete(p);current.delete(p);}}for(const p of next){counts.set(p,(counts.get(p)||0)+1);current.add(p);}result[i]=allocated;sets[i]=next;
 }
 return {paths:result,report:{version:1,executed:true,method:config.method,accepted:records.filter(r=>r.accepted).length,rejected:records.filter(r=>!r.accepted).length,maxDeviation:.8,records}};
}
function regionTopologyFingerprint(image,background){
 const value=typeof background==='string'?parseInt(background.slice(1)+'ff',16):background,foreground=new Set();for(let p=0;p<image.width*image.height;p++)if(image.data.readUInt32BE(p*4)!==value)foreground.add(p);
 const hash=text=>require('node:crypto').createHash('sha256').update(text).digest('hex');
 return {connectivity:hash(topologySignature(foreground,image.width,image.height,[0,0,image.width-1,image.height-1])),closedGaps:hash(JSON.stringify([...enclosedBackgroundGuards(image,value,0)].sort((a,b)=>a-b)))};
}
module.exports={fitSourceCurve,layoutCurveFlow,digitizeCurve,elbowEnergy,topologySignature,enclosedBackgroundGuards,regionTopologyFingerprint};
