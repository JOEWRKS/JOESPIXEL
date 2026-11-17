'use strict';
const {thinMask}=require('./refine-structure.cjs');
const {segmentSourceRegions}=require('./source-region-palette.cjs');
const {rasterSharedBoundaries}=require('./raster-shared-boundaries.cjs');

// Opt-in for transparent artwork with explicit dark exterior ink. Trace that
// ink BEFORE reduction. Filled dark features are sampled as regions, not thinned.
// fit is one uniform source-to-native transform shared by geometry and color.
function rasterSourceInkPaths(PNG,source,palette,{width,height,fit,background,inkColor,
  inkThreshold=80,tolerance=.25,connected=false}){
 if(![width,height].every(v=>Number.isSafeInteger(v)&&v>0)||!fit||
    ![fit.scale,fit.x,fit.y].every(Number.isFinite)||fit.scale<=0)throw Error('Invalid locked grid/registration');
 const bg=parseInt(background.slice(1)+'ff',16),ink=parseInt(inkColor.slice(1)+'ff',16);
 const entries=palette.map(c=>({value:parseInt(c.hex.slice(1)+'ff',16)}));
 if(!entries.some(c=>c.value===bg)||!entries.some(c=>c.value===ink))throw Error('Colors must belong to fixed palette');
 const sw=source.width,sh=source.height,n=sw*sh,opaque=new Uint8Array(n),dark=new Uint8Array(n);
 const composited=new PNG({width:sw,height:sh});source.data.copy(composited.data);
 for(let p=0;p<n;p++){opaque[p]=source.data[p*4+3]>=128;if(!opaque[p])composited.data.writeUInt32BE(bg,p*4);else composited.data[p*4+3]=255;}
 const segmented=segmentSourceRegions(PNG,composited,palette,width,height,{preserveSmallRegions:true}).image;
 for(let p=0;p<n;p++)dark[p]=opaque[p]&&Math.max(...segmented.data.subarray(p*4,p*4+3))<inkThreshold;
 if(!opaque.includes(0))throw Error('Transparent exterior required; no guessed background mask');
 const adjacent=p=>{const x=p%sw,y=Math.floor(p/sw),a=[];for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
  const xx=x+dx,yy=y+dy;if((dx||dy)&&xx>=0&&yy>=0&&xx<sw&&yy<sh)a.push(yy*sw+xx);
 }return a;};
 const visited=new Set(),stroke=new Set(),components=[],bounded=[];
 for(let p=0;p<n;p++)if(dark[p]&&!visited.has(p)){
  const part=[p];visited.add(p);let exterior=false;
  for(let i=0;i<part.length;i++)for(const q of adjacent(part[i])){
   if(!opaque[q])exterior=true;
   if(dark[q]&&!visited.has(q)){visited.add(q);part.push(q);}
  }
  // An antialiased alpha fringe can separate the ink from transparency.
  if(!exterior){const radius=Math.max(1,Math.ceil(.5/fit.scale));
   exterior=part.some(p=>{const x=p%sw,y=Math.floor(p/sw);for(const [dx,dy]of [[radius,0],[-radius,0],[0,radius],[0,-radius]]){
    const xx=x+dx,yy=y+dy;if(xx<0||yy<0||xx>=sw||yy>=sh||!opaque[yy*sw+xx])return true;
   }return false;});
  }
  components.push({pixels:part.length,exterior});if(exterior)for(const q of part)stroke.add(q);else bounded.push(part);
 }
 if(!stroke.size)throw Error('No source-supported exterior ink component');
 function pathsOf(mask,map,scale){
 return traceStrokePaths(mask,sw,sh,map,scale,tolerance);
 }
 const paths=pathsOf(stroke,p=>[(p%sw+.5)*fit.scale+fit.x,(Math.floor(p/sw)+.5)*fit.scale+fit.y],fit.scale);

 // Remove the SOURCE ink band only in the color sampling buffer. Propagate
 // nearest observed material/background through it; never invent a fill RGB.
 const labels=new Uint32Array(n),nearest=new Int32Array(n);nearest.fill(-1);
 const queue=new Int32Array(n);let head=0,tail=0;
 for(let p=0;p<n;p++){
  if(!opaque[p])labels[p]=bg;
  else labels[p]=segmented.data.readUInt32BE(p*4);
  if(!stroke.has(p)){nearest[p]=p;queue[tail++]=p;}
 }
 while(head<tail){const p=queue[head++],x=p%sw,y=Math.floor(p/sw);
  for(const q of [x?p-1:-1,x+1<sw?p+1:-1,y?p-sw:-1,y+1<sh?p+sw:-1])if(q>=0&&nearest[q]<0){nearest[q]=nearest[p];queue[tail++]=q;}
 }
 let image=new PNG({width,height});const base=new PNG({width,height});
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const votes=new Map(),rawVotes=new Map();
  const l=(x-fit.x)/fit.scale,r=(x+1-fit.x)/fit.scale,t=(y-fit.y)/fit.scale,b=(y+1-fit.y)/fit.scale;
  let total=0;
  for(let sy=Math.floor(t);sy<Math.ceil(b);sy++)for(let sx=Math.floor(l);sx<Math.ceil(r);sx++){
   const area=(Math.min(r,sx+1)-Math.max(l,sx))*(Math.min(b,sy+1)-Math.max(t,sy));if(area<=0)continue;
   const p=sy*sw+sx,valid=sx>=0&&sy>=0&&sx<sw&&sy<sh;
   const value=valid?labels[nearest[p]]:bg,raw=valid?labels[p]:bg;
   votes.set(value,(votes.get(value)||0)+area);rawVotes.set(raw,(rawVotes.get(raw)||0)+area);total+=area;
  }
  const best=m=>[...m].sort((a,b)=>b[1]-a[1]||a[0]-b[0])[0][0];
  image.data.writeUInt32BE(best(votes),(y*width+x)*4);base.data.writeUInt32BE(best(rawVotes),(y*width+x)*4);
 }
 const material=new PNG({width:sw,height:sh});
 for(let p=0;p<n;p++)material.data.writeUInt32BE(labels[nearest[p]],p*4);
 const grid={x:Array.from({length:width},(_,i)=>[(i-fit.x)/fit.scale,(i+1-fit.x)/fit.scale]),y:Array.from({length:height},(_,i)=>[(i-fit.y)/fit.scale,(i+1-fit.y)/fit.scale])};
 image=rasterSharedBoundaries(PNG,material,width,height,background,tolerance,false,grid,null,false).image;
 const cells=new Set();
 for(const path of paths)for(let i=1;i<path.length;i++)for(const [x,y]of rasterPath(path[i-1],path[i],connected))
  if(x>=0&&y>=0&&x<width&&y<height)cells.add(y*width+x);
 for(const p of cells)image.data.writeUInt32BE(ink,p*4);
 // The same closed path network owns the background/material division.
 // Independently sampled material must not leak beyond its reconstructed ink.
 const outside=new Set(),flood=[];
 function offer(p){if(!outside.has(p)&&!cells.has(p)){outside.add(p);flood.push(p);}}
 for(let x=0;x<width;x++){offer(x);offer((height-1)*width+x);}
 for(let y=0;y<height;y++){offer(y*width);offer(y*width+width-1);}
 for(let i=0;i<flood.length;i++){const p=flood[i],x=p%width,y=Math.floor(p/width);
  for(const q of [x?p-1:-1,x+1<width?p+1:-1,y?p-width:-1,y+1<height?p+width:-1])if(q>=0)offer(q);
 }
 if(outside.size+cells.size===width*height)throw Error('Reconstructed ink does not enclose a material region');
 for(const p of outside)image.data.writeUInt32BE(bg,p*4);
 // Register a bounded dark feature and ALL its interior colors together.
 // Rounding its outer extent once avoids independent left/right color phases.
 // This is source-space inverse sampling, not a list of output-dot repairs.
 const registeredFeatures=[];
 for(const part of bounded){
  if(part.length*fit.scale*fit.scale<1)continue;
  const xs=part.map(p=>p%sw),ys=part.map(p=>Math.floor(p/sw));
  const l=Math.min(...xs),r=Math.max(...xs)+1,t=Math.min(...ys),b=Math.max(...ys)+1;
  const tw=Math.max(1,Math.round((r-l)*fit.scale)),th=Math.max(1,Math.round((b-t)*fit.scale));
  const tx=Math.round((l+r)*.5*fit.scale+fit.x-tw*.5),ty=Math.round((t+b)*.5*fit.scale+fit.y-th*.5);
  const sample=(x,y)=>segmented.data.readUInt32BE((Math.max(0,Math.min(sh-1,y))*sw+Math.max(0,Math.min(sw-1,x)))*4);
  const ax=Math.max(0,Math.min(tx,Math.floor(l*fit.scale+fit.x))),ay=Math.max(0,Math.min(ty,Math.floor(t*fit.scale+fit.y)));
  const bx=Math.min(width,Math.max(tx+tw,Math.ceil(r*fit.scale+fit.x))),by=Math.min(height,Math.max(ty+th,Math.ceil(b*fit.scale+fit.y)));
  for(let y=ay;y<by;y++)for(let x=ax;x<bx;x++){
   const sx=Math.floor(l+(x+.5-tx)*(r-l)/tw),sy=Math.floor(t+(y+.5-ty)*(b-t)/th);
   image.data.writeUInt32BE(sample(sx,sy),(y*width+x)*4);
  }
  const set=new Set(part),distance=new Map(),pending=[];
  for(const p of part)if(adjacent(p).some(q=>!set.has(q))){distance.set(p,1);pending.push(p);}
  for(let i=0;i<pending.length;i++){const p=pending[i];for(const q of adjacent(p))if(set.has(q)&&!distance.has(q)){distance.set(q,distance.get(p)+1);pending.push(q);}}
  const projectedMaxWidth=2*Math.max(...distance.values())*fit.scale;
  let strokePaths=0;
  if(projectedMaxWidth<=1){
   const localPaths=pathsOf(set,p=>[tx+(p%sw+.5-l)*tw/(r-l),ty+(Math.floor(p/sw)+.5-t)*th/(b-t)],fit.scale);
   const inkVotes=new Map();for(const p of part){const c=segmented.data.readUInt32BE(p*4);inkVotes.set(c,(inkVotes.get(c)||0)+1);}
   const color=[...inkVotes].sort((a,b)=>b[1]-a[1])[0][0];
   for(const path of localPaths)for(let i=1;i<path.length;i++)for(const [x,y]of rasterPath(path[i-1],path[i],false))
    if(x>=ax&&y>=ay&&x<bx&&y<by)image.data.writeUInt32BE(color,(y*width+x)*4);
   strokePaths=localPaths.length;
  }
  registeredFeatures.push({sourceBounds:[l,t,r-l,b-t],targetBounds:[tx,ty,tw,th],projectedMaxWidth,strokePaths});
 }
 return {image,base,paths,report:{method:'source-ink-paths-before-reduction',fit,components,
  pathCount:paths.length,strokeCells:cells.size,connected,tolerance,registeredFeatures,
  limitation:'Explicit dark ink on transparent source only. Source-filled features are area-sampled; no automatic semantic quality verdict.'}};
}
function simplify(points,tolerance){
 if(points.length<=2)return points;
 const a=points[0],b=points.at(-1),vx=b[0]-a[0],vy=b[1]-a[1];let cut=0,best=0;
 for(let i=1;i<points.length-1;i++){const p=points[i],t=Math.max(0,Math.min(1,((p[0]-a[0])*vx+(p[1]-a[1])*vy)/(vx*vx+vy*vy||1)));
  const d=Math.hypot(p[0]-a[0]-t*vx,p[1]-a[1]-t*vy);if(d>best){best=d;cut=i;}}
 return best>tolerance?[...simplify(points.slice(0,cut+1),tolerance).slice(0,-1),...simplify(points.slice(cut),tolerance)]:[a,b];
}
function rasterPath(a,b,connected=true){
 let x=Math.floor(a[0]),y=Math.floor(a[1]);const endX=Math.floor(b[0]),endY=Math.floor(b[1]),out=[[x,y]];
 const dx=Math.sign(endX-x),dy=Math.sign(endY-y),vx=b[0]-a[0],vy=b[1]-a[1];
 const error=(xx,yy)=>Math.abs((xx+.5-a[0])*vy-(yy+.5-a[1])*vx);
 while(x!==endX||y!==endY){
  if(!connected&&x!==endX&&y!==endY&&error(x+dx,y+dy)<Math.min(error(x+dx,y),error(x,y+dy))){x+=dx;y+=dy;}
  else if(x===endX)y+=dy;
  else if(y===endY)x+=dx;
  else if(error(x+dx,y)<=error(x,y+dy))x+=dx;else y+=dy;
  out.push([x,y]);
 }
 return out;
}
// Geometry-only helper. It never runs the deprecated whole-image recoloring
// or bounded-feature registration above. Callers retain their own region ownership.
function traceStrokePaths(mask,width,height,map,scale,tolerance=.35,minimumTerminalLength=.65){
 const skeleton=thinMask([...mask],width),graph=new Map();
 for(const p of skeleton){const x=p%width,y=Math.floor(p/width),a=[];
  for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
   const q=(y+dy)*width+x+dx;
   if((dx||dy)&&x+dx>=0&&x+dx<width&&y+dy>=0&&y+dy<height&&skeleton.has(q)&&
     (!dx||!dy||(!skeleton.has(p+dx)&&!skeleton.has(p+dy*width))))a.push(q);
  }graph.set(p,a);
 }
 const used=new Set(),paths=[],key=(a,b)=>a<b?a+':'+b:b+':'+a;
 function trace(start,next){const ids=[start];let prev=start,p=next;used.add(key(prev,p));
  while(true){ids.push(p);const a=graph.get(p);if(p===start||a.length!==2)break;
   const q=a.find(v=>v!==prev);if(used.has(key(p,q)))break;used.add(key(p,q));prev=p;p=q;
  }
  const length=ids.slice(1).reduce((sum,q,i)=>sum+Math.hypot(q%width-ids[i]%width,Math.floor(q/width)-Math.floor(ids[i]/width))*scale,0);
  // Unrepresentable terminal burrs are discarded in source geometry, not
  // by shaving saved pixels. Full loops and internal junction links remain.
  if(length<minimumTerminalLength&&(graph.get(ids[0]).length===1||graph.get(ids.at(-1)).length===1))return;
  paths.push(simplify(ids.map(map),tolerance));
 }
 for(const[p,a]of graph)if(a.length!==2)for(const q of a)if(!used.has(key(p,q)))trace(p,q);
 for(const[p,a]of graph)for(const q of a)if(!used.has(key(p,q)))trace(p,q);
 return paths;
}


// Opt-in source observation -> shared line layout -> material assignment.

function assertObservedStrokePolicy(policy,palette,w,h){
 const fail=m=>{throw Error('Observed stroke layout: '+m);};
 const rect=r=>Array.isArray(r)&&r.length===4&&r.every(Number.isSafeInteger)&&r[0]>=0&&r[1]>=0&&r[2]>0&&r[3]>0&&r[0]+r[2]<=w&&r[1]+r[3]<=h;
 const rgb=c=>Array.isArray(c)&&c.length===3&&c.every(v=>Number.isFinite(v)&&v>=0&&v<=255);
 const colors=new Set(palette.map(p=>p.hex));
 if(policy?.version!==1||!Array.isArray(policy.roles)||!policy.roles.length||!Array.isArray(policy.excluded)||!policy.excluded.every(rect))fail('explicit roles and source exclusions required');
 if(Object.keys(policy).some(k=>!['version','roles','excluded'].includes(k)))fail('unknown policy field');
 const claimed=[];
 for(const r of policy.roles){
  if(!r.name||!r.observation||!rect(r.rect)||!colors.has(r.color)||!Array.isArray(r.replaceColors)||!r.replaceColors.length||!r.replaceColors.every(c=>colors.has(c))||!Array.isArray(r.samples)||!r.samples.length||!r.samples.every(rgb)||!Array.isArray(r.context)||!r.context.length||!r.context.every(rgb)||!Number.isFinite(r.tolerance)||r.tolerance<1||r.tolerance>100)fail('invalid source role');
  if(Object.keys(r).some(k=>!['name','observation','rect','color','replaceColors','samples','context','tolerance'].includes(k)))fail('unknown role field; destination-dot instructions are prohibited');
  const [x,y,w,h]=r.rect;
  if(claimed.some(([a,b,c,d])=>x<a+c&&x+w>a&&y<b+d&&y+h>b))fail('overlapping roles need one jointly observed pigment inventory');claimed.push(r.rect);
 }
}
function auditObservedStrokeLayout(image,plan){
 let missingPathPixels=0;
 for(const [p,c] of plan.expectedColors??[])if(p<0||p>=image.width*image.height||image.data.readUInt32BE(p*4)!==c)missingPathPixels++;
 return {missingPathPixels,checkedPathPixels:plan.expectedColors?.length??0,visualFidelity:'NOT_AUTOMATICALLY_DETERMINED'};
}
// Quantization can place several source junction nodes into a solid 2x2.
// Contract the SOURCE-supported junction to one native anchor and reconnect
// its incident branches before assigning any RGB. Closed small loops without
// a source branch junction are not eligible for this operation.
function coalesceStrokeJunctions(cells,paths,width,height,locked){
 const out=new Set(cells),changes=[];
 const adjacent=p=>{const x=p%width,y=Math.floor(p/width),a=[];for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if((dx||dy)&&x+dx>=0&&x+dx<width&&y+dy>=0&&y+dy<height)a.push((y+dy)*width+x+dx);return a;};
 const blocks=mask=>{const result=[];for(const p of mask)if(p%width+1<width&&Math.floor(p/width)+1<height&&[p+1,p+width,p+width+1].every(q=>mask.has(q)))result.push(p);return result;};
 for(const p of blocks(out)){
  const block=new Set([p,p+1,p+width,p+width+1]);if([...block].some(q=>locked.has(q)||!out.has(q)))continue;
  const endpoints=paths.flatMap(line=>[line[0],line.at(-1)]).filter(([x,y])=>block.has(Math.floor(y)*width+Math.floor(x)));
  if(endpoints.length<3)continue;
  const contacts=new Set([...block].flatMap(adjacent).filter(q=>out.has(q)&&!block.has(q))),arms=[];
  while(contacts.size){const arm=[contacts.values().next().value];contacts.delete(arm[0]);for(let i=0;i<arm.length;i++)for(const q of adjacent(arm[i]))if(contacts.delete(q))arm.push(q);arms.push(arm);}
  if(arms.length<3)continue;
  const center=endpoints.reduce((a,b)=>[a[0]+b[0]/endpoints.length,a[1]+b[1]/endpoints.length],[0,0]);
  const candidates=[];
  for(const anchor of block){
   const target=[anchor%width+.5,Math.floor(anchor/width)+.5],candidate=new Set([...out].filter(q=>!block.has(q)));
   let legal=true;
   for(const arm of arms){const contact=arm.reduce((a,b)=>Math.hypot(a%width-target[0],Math.floor(a/width)-target[1])<=Math.hypot(b%width-target[0],Math.floor(b/width)-target[1])?a:b);
    for(const[x,y]of rasterPath([contact%width+.5,Math.floor(contact/width)+.5],target,false)){const q=y*width+x;if(!block.has(q)&&!out.has(q)){legal=false;break;}candidate.add(q);}
   }
   if(!legal||blocks(candidate).length>=blocks(out).length)continue;
   const score=(target[0]-center[0])**2+(target[1]-center[1])**2;
   candidates.push({anchor,candidate,score});
  }
  candidates.sort((a,b)=>a.score-b.score||a.anchor-b.anchor);
  if(candidates.length){out.clear();for(const q of candidates[0].candidate)out.add(q);changes.push({sourceJunctionCenter:center,anchor:candidates[0].anchor,incidentArms:arms.length});}
 }
 return {cells:out,changes};
}
function matchesObservedInk(c,role){
 const distance=(a,b)=>a.reduce((s,v,i)=>s+(v-b[i])**2,0);
 const ink=Math.min(...role.samples.map(s=>distance(c,s))),fill=Math.min(...role.context.map(s=>distance(c,s)));
 return ink<=role.tolerance**2&&ink<fill;
}
function allocateObservedStrokeLayout(PNG,source,base,palette,policy,locked=[],material=null,features=null){
 const {thinMask}=require('./refine-structure.cjs');
 const w=base.width,h=base.height,sw=source.width,sh=source.height,step=sw/w;
 assertObservedStrokePolicy(policy,palette,sw,sh);
 if(Math.abs(sh/h-step)>1e-9)throw Error('Uniform fixed grid required');
 const out=new PNG({width:w,height:h});base.data.copy(out.data);
 const values=palette.map(p=>({...p,value:parseInt(p.hex.slice(1)+'ff',16)}));
 const dist=(a,b)=>a.reduce((s,v,i)=>s+(v-b[i])**2,0),rgb=p=>[...source.data.subarray(p*4,p*4+3)];
 const nearest=c=>values.reduce((a,b)=>dist(c,a.rgb)<=dist(c,b.rgb)?a:b).value;
 const inRect=(x,y,[a,b,c,d])=>x>=a&&x<a+c&&y>=b&&y<b+d;
 // Trace the original whole path first. Cutting its source mask at a reserved
 // material cell changes remote branch endpoints and protected features.
 const excluded=(x,y)=>features?.mask[y*sw+x]||policy.excluded.some(r=>inRect(x,y,r));
 const protectedCell=p=>{if(features?.cells.has(p)||material?.interior.has(p))return true;let x=p%w,y=Math.floor(p/w);return policy.excluded.some(([a,b,c,d])=>x*step<a+c&&(x+1)*step>a&&y*step<b+d&&(y+1)*step>b);};
 const adj=(p,W,H,diagonal=false)=>{let x=p%W,y=Math.floor(p/W),a=[];for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if((dx||dy)&&(diagonal||!dx||!dy)&&x+dx>=0&&x+dx<W&&y+dy>=0&&y+dy<H)a.push((y+dy)*W+x+dx);return a;};
 const lock=new Set(locked),nearLock=p=>lock.has(p)||adj(p,w,h,true).some(q=>lock.has(q));
 const report=[];
 for(const role of policy.roles){
  if(!role.observation||!values.some(c=>c.hex===role.color)||!role.samples.length||!role.context.length)throw Error('Observed source line role required');
  const [rx,ry,rw,rh]=role.rect,mask=new Set();
  for(let y=ry;y<ry+rh;y++)for(let x=rx;x<rx+rw;x++)if(!excluded(x,y)){
   const p=y*sw+x;if(matchesObservedInk(rgb(p),role))mask.add(p);
  }
  // Use a bounded one-source-pixel neighborhood for source antialias seams.
  // This is not a missing-native-line repair or a dilation of the final image.
  const dilated=new Set();for(const p of mask){dilated.add(p);for(const q of adj(p,sw,sh,true))dilated.add(q);}
  const closed=new Set(mask);for(const p of dilated)if(inRect(p%sw,Math.floor(p/sw),role.rect)&&!excluded(p%sw,Math.floor(p/sw))&&adj(p,sw,sh,true).every(q=>dilated.has(q)))closed.add(p);
  const depth=new Map(),queue=[];for(const p of closed)if(adj(p,sw,sh,true).some(q=>!closed.has(q))){depth.set(p,1);queue.push(p);}
  for(let i=0;i<queue.length;i++)for(const q of adj(queue[i],sw,sh,true))if(closed.has(q)&&!depth.has(q)){depth.set(q,depth.get(queue[i])+1);queue.push(q);}
  const skeleton=thinMask(closed,sw),narrow=new Set();
  const sourceBranches=traceStrokePaths(skeleton,sw,sh,p=>[p%sw+.5,Math.floor(p/sw)+.5],1,0);
  let filledBranches=0;
  for(const branch of sourceBranches){const points=new Set();for(let i=1;i<branch.length;i++)for(const[x,y]of rasterPath(branch[i-1],branch[i],false))points.add(y*sw+x);
   if([...points].some(p=>(depth.get(p)||0)>step)){filledBranches++;continue;}for(const p of points)narrow.add(p);
  }
  // Source filled pigment keeps its ownership; it must not become a thin line.
  const owner=new Map(),pending=[];for(const p of skeleton){owner.set(p,p);pending.push(p);}
  for(let i=0;i<pending.length;i++)for(const q of adj(pending[i],sw,sh,true))if(closed.has(q)&&!owner.has(q)){owner.set(q,owner.get(pending[i]));pending.push(q);}
  const narrowBand=new Set([...closed].filter(p=>narrow.has(owner.get(p))));
  const paths=traceStrokePaths(narrow,sw,sh,p=>[(p%sw+.5)/step,(Math.floor(p/sw)+.5)/step],1/step,.3);
  let cells=new Set();for(const line of paths){const pathCells=new Set();for(let i=1;i<line.length;i++)for(const[x,y]of rasterPath(line[i-1],line[i],false)){
   const p=y*w+x;if(x>=0&&x<w&&y>=0&&y<h&&!protectedCell(p))pathCells.add(p);
  }
   // Discard duplicate EXTERIOR paths as paths, not individual contact dots.
   // An internal branch must still reach the shared junction at its endpoint.
   if([...pathCells].filter(p=>nearLock(p)).length<pathCells.size*.5)for(const p of pathCells)if(!lock.has(p))cells.add(p);
  }
  cells=new Set([...thinMask(new Set([...cells,...lock]),w)].filter(p=>!lock.has(p)));
  const junctions=coalesceStrokeJunctions(cells,paths,w,h,lock);cells=junctions.cells;
  const band=new Map();for(const p of narrowBand){const q=Math.floor(Math.floor(p/sw)/step)*w+Math.floor(p%sw/step);band.set(q,(band.get(q)||0)+1);}
  const strokeValues=new Set(role.replaceColors.map(c=>parseInt(c.slice(1)+'ff',16)));
  const changed=[],cleared=[],unresolved=[];
  const joint=new Set([...lock,...cells]),materialOwner=new Int32Array(w*h).fill(-1),materialDistance=new Int16Array(w*h).fill(-1),materialQueue=[];
  for(let p=0;p<w*h;p++)if(!joint.has(p)&&!strokeValues.has(base.data.readUInt32BE(p*4))){materialOwner[p]=p;materialDistance[p]=0;materialQueue.push(p);}
  for(let i=0;i<materialQueue.length;i++)for(const q of adj(materialQueue[i],w,h))if(!joint.has(q)&&materialDistance[q]<0){materialOwner[q]=materialOwner[materialQueue[i]];materialDistance[q]=materialDistance[materialQueue[i]]+1;materialQueue.push(q);}
  for(const[p,count]of band){
   if(joint.has(p)||protectedCell(p)||count<step*step*.25||!strokeValues.has(base.data.readUInt32BE(p*4)))continue;
   const x=p%w,y=Math.floor(p/w),near=[...adj(p,w,h,true)].filter(q=>joint.has(q));if(!near.length)continue;
   // Move away from the planned centerline to its own material side. Do not
   // borrow a global nearest color across skin/armor/background boundaries.
   const anchor=near.reduce((a,b)=>dist([x,y],[a%w,Math.floor(a/w)])<=dist([x,y],[b%w,Math.floor(b/w)])?a:b);
   const dx=x-anchor%w,dy=y-Math.floor(anchor/w),length=Math.hypot(dx,dy);let fill=null;
   for(let t=0;t<=step*2;t+=.5){const sx=Math.floor((x+.5)*step+dx/length*t),sy=Math.floor((y+.5)*step+dy/length*t);
    if(sx<rx||sx>=rx+rw||sy<ry||sy>=ry+rh)break;const q=sy*sw+sx;
    if(!closed.has(q)){const c=nearest(rgb(q));if(!strokeValues.has(c)){fill=c;break;}}
   }
   if(fill===null&&materialOwner[p]>=0&&materialDistance[p]<=2)fill=base.data.readUInt32BE(materialOwner[p]*4);
   if(fill===null){unresolved.push(p);continue;}out.data.writeUInt32BE(fill,p*4);cleared.push(p);
  }
  const ink=parseInt(role.color.slice(1)+'ff',16);for(const p of cells)out.data.writeUInt32BE(ink,p*4);
  for(let p=0;p<w*h;p++)if(out.data.readUInt32BE(p*4)!==base.data.readUInt32BE(p*4))changed.push(p);
  if(unresolved.length){const error=Error('Source line/material ownership unresolved: '+role.name+' ('+unresolved.length+' cells); preserve the baseline and review the source roles');error.sourceLocations=unresolved.map(p=>[p%w*step,Math.floor(p/w)*step]);throw error;}
  report.push({name:role.name,color:role.color,sourceMask:mask.size,sourceNarrowPixels:narrowBand.size,filledBranches,paths:paths.length,junctions:junctions.changes,cells:[...cells],cleared,unresolved,changed:changed.length});

 }
 const expectedColors=report.flatMap(r=>r.cells.map(p=>[p,parseInt(r.color.slice(1)+'ff',16)]));
 const audit=auditObservedStrokeLayout(out,{expectedColors});
 if(audit.missingPathPixels)throw Error('Observed stroke layout was overwritten');
 return {image:out,report:{method:'observed-source-stroke-layout',roles:report,expectedColors,audit,limitation:'Source-observed narrow strokes only. Filled dark regions and visual fidelity are not certified by pixel counts.'}};
}

// A source-observed stroke is geometry, not another area-vote color. Plan it
// before fills are assigned; consumers decide which side owns vacated ink.
function planSourceStroke(mask,sw,sh,grid,w,h,{closed=false}={}){
 if(!mask.size)throw Error('Source stroke has no observed pigment');
 const locate=(axis,v)=>{const a=grid[axis];let i=a.findIndex(([lo,hi])=>v>=lo&&v<hi);if(i<0)throw Error('Source stroke outside grid');return i+(v-a[i][0])/(a[i][1]-a[i][0]);};
 const step=grid.x[0][1]-grid.x[0][0];
 if(grid.x.length!==w||grid.y.length!==h||['x','y'].some(a=>grid[a].some(([lo,hi])=>Math.abs(hi-lo-step)>1e-8)))throw Error('Stroke geometry requires a uniform fixed grid');
 let pathMask=mask;
 if(closed){
  // A declared closed boundary owns its cycle, not terminal medial-axis spurs
  // created by a thick raster corner. Open strokes retain their real endpoints.
  if(strokeTopology(mask,sw,sh).holes!==1)throw Error('Declared closed stroke must enclose exactly one source interior');
  const core=new Set(thinMask(mask,sw)),graph=new Map();
  for(const p of core){const x=p%sw,y=Math.floor(p/sw),neighbors=new Set();for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const q=(y+dy)*sw+x+dx;if((dx||dy)&&x+dx>=0&&x+dx<sw&&y+dy>=0&&y+dy<sh&&core.has(q)&&(!dx||!dy||(!core.has(p+dx)&&!core.has(p+dy*sw))))neighbors.add(q);}graph.set(p,neighbors);}
  const queue=[...core].filter(p=>graph.get(p).size<2);for(let i=0;i<queue.length;i++){const p=queue[i];if(!core.delete(p))continue;for(const q of graph.get(p)){graph.get(q).delete(p);if(core.has(q)&&graph.get(q).size<2)queue.push(q);}}
  if(!core.size)throw Error('Closed stroke source cycle is missing');pathMask=core;
 }
 const paths=traceStrokePaths(pathMask,sw,sh,p=>[locate('x',p%sw+.5),locate('y',Math.floor(p/sw)+.5)],1/step,.15,1);
 let cells=new Set();for(const path of paths)for(let i=1;i<path.length;i++)for(const[x,y]of rasterPath(path[i-1],path[i],false)){
  if(x<0||x>=w||y<0||y>=h)throw Error('Stroke path exceeds canvas');cells.add(y*w+x);
 }
 cells=new Set(thinMask(cells,w));cells=coalesceStrokeJunctions(cells,paths,w,h,new Set()).cells;
 const footprint=new Set();for(const p of mask)footprint.add(Math.floor(locate('y',Math.floor(p/sw)+.5))*w+Math.floor(locate('x',p%sw+.5)));
 if(!cells.size||[...cells].some(p=>!footprint.has(p)))throw Error('Stroke cannot fit inside observed source coverage');
 const sourceTopology=strokeTopology(mask,sw,sh),nativeTopology=strokeTopology(cells,w,h);
 if(sourceTopology.components!==nativeTopology.components||sourceTopology.holes!==nativeTopology.holes){const error=Error('Stroke grid capacity changes source connections or gaps: '+JSON.stringify({sourceTopology,nativeTopology}));error.strokePlan={mask:[...mask],cells:[...cells],paths};throw error;}
 const blocks=[...cells].filter(p=>p%w+1<w&&p+w+1<w*h&&[p+1,p+w,p+w+1].every(q=>cells.has(q)));
 if(blocks.length)throw Error('Stroke path contains solid two-cell thickness');
 return {cells,footprint,paths,sourceTopology,nativeTopology};
}
// Joint allocation of an observed OPEN curve. Source windows identify the
// meaningful ends/turns; skeleton burrs never become protected output dots.
// Between consecutive extrema the declared axis is monotone. An induced
// eight-connected path cannot contain a branch, a solid 2x2 or a self-contact.
function planObservedCurve(mask,sw,sh,grid,w,h,curve){
 if(!curve||Object.keys(curve).some(k=>!['version','axis','observation','landmarks','flow'].includes(k))||curve.version!==1||!['x','y'].includes(curve.axis)||(curve.flow!==undefined&&curve.flow!=='smooth')||!curve.observation?.trim()||!Array.isArray(curve.landmarks)||curve.landmarks.length<2)throw Error('Observed curve axis, ordered source landmarks and observation required');
 const step=grid.x[0][1]-grid.x[0][0];if(grid.x.length!==w||grid.y.length!==h||['x','y'].some(a=>grid[a].some(([lo,hi])=>Math.abs(hi-lo-step)>1e-8)))throw Error('Observed curve requires uniform fixed grid');
 const map=p=>{const x=p%sw+.5,y=Math.floor(p/sw)+.5,gx=grid.x.findIndex(([a,b])=>x>=a&&x<b),gy=grid.y.findIndex(([a,b])=>y>=a&&y<b);if(gx<0||gy<0)throw Error('Observed curve outside grid');return gy*w+gx;};
 const axis=curve.axis==='x'?0:1,coord=p=>axis?p/ w|0:p%w,sourceCoord=p=>axis?Math.floor(p/sw):p%sw;
 const skeleton=thinMask(mask,sw),neighbors=p=>{const x=p%sw,y=Math.floor(p/sw),a=[];for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const q=(y+dy)*sw+x+dx;if((dx||dy)&&x+dx>=0&&x+dx<sw&&y+dy>=0&&y+dy<sh&&skeleton.has(q)&&(!dx||!dy||(!skeleton.has(p+dx)&&!skeleton.has(p+dy*sw))))a.push(q);}return a;};
 const endpoints=new Set([...skeleton].filter(p=>neighbors(p).length===1));
 const landmarks=curve.landmarks.map((mark,i)=>{
  const[r,s,a,b]=mark.sourceRegion??[];if(Object.keys(mark).some(k=>!['name','kind','sourceRegion'].includes(k))||!mark.name||!['endpoint','min','max'].includes(mark.kind)||![r,s,a,b].every(Number.isSafeInteger)||r<0||s<0||a<1||b<1||r+a>sw||s+b>sh)throw Error('Curve landmarks require valid source-only windows');
  if((i===0||i===curve.landmarks.length-1)!==(mark.kind==='endpoint'))throw Error('Curve must start/end at observed endpoints with only extrema between');
  const samples=[...skeleton].filter(p=>p%sw>=r&&p%sw<r+a&&Math.floor(p/sw)>=s&&Math.floor(p/sw)<s+b&&(mark.kind!=='endpoint'||endpoints.has(p)));
  if(!samples.length||mark.kind==='endpoint'&&samples.length!==1)throw Error('Curve landmark missing or ambiguous: '+mark.name);
  const extreme=mark.kind==='min'?Math.min(...samples.map(sourceCoord)):Math.max(...samples.map(sourceCoord));let selected=mark.kind==='endpoint'?samples:samples.filter(p=>sourceCoord(p)===extreme);
  if(mark.kind==='endpoint'){
   const tip=samples[0];let at=tip,previous=-1,length=0;
   while(length<step){const next=neighbors(at).filter(p=>p!==previous);if(next.length!==1)break;const q=next[0];length+=Math.hypot(q%sw-at%sw,Math.floor(q/sw)-Math.floor(at/sw));previous=at;at=q;}
   const dx=tip%sw-at%sw,dy=Math.floor(tip/sw)-Math.floor(at/sw);if(!dx&&!dy)throw Error('Observed curve endpoint direction is ambiguous');
   const cap=[...mask].filter(p=>p%sw>=r&&p%sw<r+a&&Math.floor(p/sw)>=s&&Math.floor(p/sw)<s+b),projection=p=>(p%sw-tip%sw)*dx+(Math.floor(p/sw)-Math.floor(tip/sw))*dy,limit=Math.max(...cap.map(projection)),edge=cap.filter(p=>projection(p)===limit),distance=p=>Math.hypot(p%sw-tip%sw,Math.floor(p/sw)-Math.floor(tip/sw)),closest=Math.min(...edge.map(distance));selected=edge.filter(p=>distance(p)===closest);
  }
  const ordinate=coord(map(selected[0]));
  // Smooth caps are located by the source centerline, just like their middle.
  // A single outer antialias pixel must not pull an entire native endpoint.
  // Explicit corner/extremum observations retain the existing extent rules.
  const anchors=mark.kind==='endpoint'&&curve.flow==='smooth'?samples:selected;
  const distanceFrom=(p,points)=>{const[l,r]=grid.x[p%w],[t,b]=grid.y[Math.floor(p/w)];return Math.min(...points.map(q=>Math.hypot((l+r)/2-(q%sw+.5),(t+b)/2-(Math.floor(q/sw)+.5))))/step;};
  const displacement=p=>distanceFrom(p,anchors);
  // Joint placement may choose an adjacent supported cell along the turn,
  // within one source-cell distance; its extremum row/column cannot move.
  // A cap may straddle a grid row. Keep its longitudinal extent, but choose
  // its transverse row jointly with the curve instead of forcing the single
  // outermost antialiased cap pixel into an extra step.
  const capAcross=new Set(selected.map(map).map(p=>axis?p%w:Math.floor(p/w)));
  const supported=[...new Set([...mask].filter(p=>p%sw>=r&&p%sw<r+a&&Math.floor(p/sw)>=s&&Math.floor(p/sw)<s+b).map(map))];
  const cells=mark.kind==='endpoint'&&curve.flow!=='smooth'?[...new Set(selected.map(map))]:supported.filter(p=>distanceFrom(p,selected)<=1&&(mark.kind==='endpoint'?capAcross.has(axis?p%w:Math.floor(p/w)):coord(p)===ordinate));
  const across=selected.map(p=>axis?p%sw:Math.floor(p/sw)),minimumRun=mark.kind==='endpoint'?1:Math.ceil((Math.max(...across)-Math.min(...across)+1)/step);
  if(cells.length<minimumRun)throw Error('Curve turn width exceeds supported grid capacity');return {name:mark.name,kind:mark.kind,cells,sourceSamples:selected,skeletonEndpoint:mark.kind==='endpoint'?samples[0]:null,ordinate,minimumRun,displacements:Object.fromEntries(cells.map(p=>[p,displacement(p)]))};
 });
 for(let i=1;i<landmarks.length-1;i++){const a=landmarks[i-1].ordinate,b=landmarks[i].ordinate,c=landmarks[i+1].ordinate;if(landmarks[i].kind==='min'?!(b<a&&b<c):!(b>a&&b>c))throw Error('Grid cannot retain ordered curve extrema: '+landmarks[i].name);}
 const owner=new Map();for(let i=0;i<landmarks.length;i++)for(const p of landmarks[i].cells){if(owner.has(p))throw Error('Curve landmarks collapse into one grid cell');owner.set(p,i);}
 const coverage=new Map();for(const p of mask){const q=map(p);coverage.set(q,(coverage.get(q)||0)+1);}const nodes=[...coverage.keys()],index=new Map(nodes.map((p,i)=>[p,i])),bits=nodes.map((_,i)=>1n<<BigInt(i)),adj=nodes.map(p=>{const x=p%w,y=Math.floor(p/w),list=[];for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){if(!(dx||dy)||x+dx<0||x+dx>=w||y+dy<0||y+dy>=h)continue;const j=index.get((y+dy)*w+x+dx);if(j!==undefined)list.push(j);}return list;}),neighborBits=adj.map(a=>a.reduce((m,i)=>m|bits[i],0n));
 const targets=landmarks.map(m=>new Set(m.cells.map(p=>index.get(p))));if(targets.some(s=>!s.size||s.has(undefined)))throw Error('Curve landmark has no observed pigment coverage');
 // Compare cell centers to the observed skeleton, not just total dark area.
 // A wider/antialiased edge must not outweigh the actual line trajectory.
 const sourceDistance=(x,y)=>Math.min(...[...skeleton].map(q=>((x-q%sw-.5)**2+(y-Math.floor(q/sw)-.5)**2)/(step*step)));
 const center=p=>{const[l,r]=grid.x[p%w],[t,b]=grid.y[Math.floor(p/w)];return [(l+r)/2,(t+b)/2];};
 const centerError=new Map(nodes.map(p=>[p,sourceDistance(...center(p))]));
 // Evaluate the intervening segment against the same source geometry as its
 // ends. Penalizing direction changes alone favors a straight staircase over
 // a genuine gentle bend. This term does not reward thick/dark pigment area.
 const segmentErrors=new Map(),segmentError=(a,b)=>{const key=Math.min(a,b)+':'+Math.max(a,b);if(!segmentErrors.has(key)){const[x,y]=center(a),[u,v]=center(b);segmentErrors.set(key,[.25,.5,.75].reduce((sum,t)=>sum+sourceDistance(x+(u-x)*t,y+(v-y)*t),0)/3);}return segmentErrors.get(key);};
 const distance=(p,q)=>Math.max(Math.abs(p%w-q%w),Math.abs(Math.floor(p/w)-Math.floor(q/w))),remaining=landmarks.map(()=>0);
 for(let i=landmarks.length-2;i>=0;i--)remaining[i]=remaining[i+1]+Math.min(...landmarks[i].cells.flatMap(p=>landmarks[i+1].cells.map(q=>distance(p,q))));
 const heap=[],push=s=>{heap.push(s);let i=heap.length-1;while(i){const p=(i-1)>>1;if(heap[p].score<=s.score)break;heap[i]=heap[p];i=p;}heap[i]=s;},pop=()=>{const a=heap[0],last=heap.pop();if(heap.length){let i=0;while(i*2+1<heap.length){let j=i*2+1;if(j+1<heap.length&&heap[j+1].score<heap[j].score)j++;if(heap[j].score>=last.score)break;heap[i]=heap[j];i=j;}heap[i]=last;}return a;};
 // Different selected anchors can have different valid terminal bends even
 // when they reach the same frontier. Keep that choice in the search state.
 const offer=(path,stage,blocked,cost,run=0,anchor=path[0])=>{const last=path.at(-1),heuristic=stage===landmarks.length?0:Math.min(...landmarks[stage].cells.map(p=>distance(nodes[last],p)))+remaining[stage];push({path,stage,blocked,cost,run,anchor,score:cost+heuristic});};
 for(const i of targets[0])offer([i],1,0n,landmarks[0].displacements[nodes[i]]**2+(curve.flow==='smooth'?centerError.get(nodes[i]):0));let result=null,expanded=0;const best=new Map();
 while(heap.length){if(++expanded>250000)throw Error('Curve search limit reached; capacity is unverified, not proven impossible');const s=pop(),last=s.path.at(-1),key=s.stage+':'+s.run+':'+last+':'+s.path.at(-2)+':'+s.anchor+':'+s.blocked;if((best.get(key)??Infinity)<=s.cost)continue;best.set(key,s.cost);if(s.stage===landmarks.length){result=s;break;}
  const from=landmarks[s.stage-1].ordinate,to=landmarks[s.stage].ordinate,direction=Math.sign(to-from),targetOrd=landmarks[s.stage].cells.map(coord),bound=direction>0?Math.max(...targetOrd):Math.min(...targetOrd);
  for(const next of adj[last]){if((s.blocked&bits[next])||s.path.includes(next))continue;const p=nodes[next],ord=coord(p),old=coord(nodes[last]),which=owner.get(p);if(which!==undefined&&which!==s.stage&&which!==s.stage-1)continue;
   if(direction===0?ord<Math.min(...targetOrd,from)||ord>Math.max(...targetOrd,from):direction*(ord-old)<0||direction*(bound-ord)<0)continue;
   const placementCost=curve.flow==='smooth'?1+segmentError(nodes[last],p):2-Math.min(1,coverage.get(p)/(step*step));
   const atTurn=targets[s.stage].has(next);if(s.run&&!atTurn)continue;
   // Moving caps transversely must not erase or invert the source-observed
   // rise/fall between landmarks (e.g. flattening a bent nose into a stem).
   if(curve.flow==='smooth'&&atTurn&&direction&&Math.sign(ord-coord(nodes[s.anchor]))!==direction)continue;
   const run=atTurn?s.run+1:0,reached=run>=landmarks[s.stage].minimumRun,stage=s.stage+(reached?1:0),cost=s.cost+placementCost+centerError.get(p)+(atTurn&&!s.run?landmarks[s.stage].displacements[p]**2:0);offer([...s.path,next],stage,s.blocked|neighborBits[last]|bits[last],cost,reached?0:run,reached?next:s.anchor);
  }
 }
 if(!result){const error=Error('Observed curve cannot fit its turns and one-dot separation in this grid');error.curvePlan={landmarks,nodes,expanded};throw error;}
 const ordered=result.path.map(i=>nodes[i]),cells=new Set(ordered),sourceTopology=strokeTopology(mask,sw,sh),nativeTopology=strokeTopology(cells,w,h);if(sourceTopology.components!==1||sourceTopology.holes!==0||nativeTopology.components!==1||nativeTopology.holes!==0)throw Error('Observed open curve topology conflicts with source');
 return {cells,footprint:new Set(nodes),paths:[ordered.map(p=>[p%w+.5,Math.floor(p/w)+.5])],sourceTopology,nativeTopology,curve:{method:'joint-ordered-source-extrema',landmarks:landmarks.map(m=>({...m,chosen:ordered.find(p=>m.cells.includes(p))})),orderedCells:ordered,expanded,ignoredSkeletonEndpoints:[...endpoints].filter(p=>!landmarks.some(m=>m.skeletonEndpoint===p||m.sourceSamples.includes(p))).length}};
}
function strokeTopology(mask,w,h){
 if(!mask.size)return {components:0,holes:0};
 let minX=w,minY=h,maxX=0,maxY=0;for(const p of mask){const x=p%w,y=Math.floor(p/w);minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}
 const x0=Math.max(0,minX-1),x1=Math.min(w-1,maxX+1),y0=Math.max(0,minY-1),y1=Math.min(h-1,maxY+1);
 const visit=(foreground)=>{const seen=new Set();let count=0,holes=0;for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){const p=y*w+x;if(mask.has(p)!==foreground||seen.has(p))continue;count++;const q=[p];seen.add(p);let edge=false;for(let i=0;i<q.length;i++){const a=q[i]%w,b=Math.floor(q[i]/w);edge ||= a===x0||a===x1||b===y0||b===y1;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const u=a+dx,v=b+dy,n=v*w+u;if(!(dx||dy)||(!foreground&&dx&&dy)||u<x0||u>x1||v<y0||v>y1||seen.has(n)||mask.has(n)!==foreground)continue;seen.add(n);q.push(n);}}if(!edge)holes++;}return {count,holes};};
 return {components:visit(true).count,holes:visit(false).holes};
}
module.exports={rasterSourceInkPaths,rasterPath,traceStrokePaths,allocateObservedStrokeLayout,auditObservedStrokeLayout,coalesceStrokeJunctions,matchesObservedInk,planSourceStroke,planObservedCurve,strokeTopology};
