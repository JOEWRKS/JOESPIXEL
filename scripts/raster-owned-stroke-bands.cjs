'use strict';
const S=__dirname;
const {thinMask}=require(S+'/refine-structure.cjs'),{traceStrokePaths,rasterPath,coalesceStrokeJunctions}=require(S+'/raster-source-ink-paths.cjs');
function exteriorOfStroke(width,height,barrier,isBackground){
 const outside=new Set(),q=[];const offer=p=>{if(!barrier.has(p)&&!outside.has(p)){outside.add(p);q.push(p);}};
 // A cropped portrait may meet the canvas edge. Only visible background is
 // an exterior seed; canvas-edge material is not a missing contour.
 const seed=p=>{if(isBackground(p))offer(p);};
 for(let x=0;x<width;x++){seed(x);seed((height-1)*width+x);}for(let y=0;y<height;y++){seed(y*width);seed(y*width+width-1);}
 for(let i=0;i<q.length;i++){const p=q[i],x=p%width,y=Math.floor(p/width);if(x)offer(p-1);if(x+1<width)offer(p+1);if(y)offer(p-width);if(y+1<height)offer(p+width);}return outside;
}
// A mixed pigment can be both a filled object and its rim. Its medial axis
// does not describe the object's exterior (in particular at filled tips).
// Plan that exterior from source coverage before routing interior strokes.
function sourceExteriorPlan(foreground,pigments,depth,sw,sh,w,h,roles){
 const step=sw/w,n=w*h,mixed=new Set(roles.filter(r=>r.kind==='mixed').map(r=>parseInt(r.color.slice(1)+'ff',16)));
 const assigned=new Uint8Array(sw*sh),objects=new Uint8Array(sw*sh);
 for(let start=0;start<assigned.length;start++)if(foreground[start]&&!assigned[start]){
  const part=[start];assigned[start]=1;let materialPixels=0;
  for(let i=0;i<part.length;i++){
   const p=part[i],x=p%sw,y=Math.floor(p/sw);materialPixels+=Number(!pigments[p]);
   for(const q of [x?p-1:-1,x+1<sw?p+1:-1,y?p-sw:-1,y+1<sh?p+sw:-1])if(q>=0&&foreground[q]&&!assigned[q]){assigned[q]=1;part.push(q);}
  }
  // An isolated ink seam/cross is a stroke, not a filled object's rim.
  if(materialPixels>=step*step)for(const p of part)objects[p]=1;
 }
 const fromFill=new Int16Array(sw*sh).fill(-1),queue=[];
 for(let p=0;p<fromFill.length;p++)if(objects[p]&&mixed.has(pigments[p])&&depth[p]>step){fromFill[p]=0;queue.push(p);}
 for(let i=0;i<queue.length;i++){
  const p=queue[i],x=p%sw,y=Math.floor(p/sw);if(fromFill[p]>=step*2)continue;
  for(const q of [x?p-1:-1,x+1<sw?p+1:-1,y?p-sw:-1,y+1<sh?p+sw:-1])if(q>=0&&fromFill[q]<0&&mixed.has(pigments[q])){fromFill[q]=fromFill[p]+1;queue.push(q);}
 }
 const occupied=new Uint8Array(n),votes=Array.from({length:n},()=>new Map()),fill=new Set();
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const p=y*w+x;let count=0,filled=0;
  for(let yy=y*step;yy<(y+1)*step;yy++)for(let xx=x*step;xx<(x+1)*step;xx++){
   const q=yy*sw+xx;count+=foreground[q];filled+=Number(fromFill[q]>=0);if(objects[q]&&mixed.has(pigments[q]))votes[p].set(pigments[q],(votes[p].get(pigments[q])??0)+1);
  }
  occupied[p]=Number(count>step*step/2||count===step*step/2&&foreground[(y*step+Math.floor(step/2))*sw+x*step+Math.floor(step/2)]);
  if(filled>step*step/2)fill.add(p);
 }
 const neighbors=p=>{const x=p%w,y=Math.floor(p/w);return[x?p-1:-1,x+1<w?p+1:-1,y?p-w:-1,y+1<h?p+w:-1].filter(q=>q>=0);};
 const exterior=exteriorOfStroke(w,h,new Set([...occupied.keys()].filter(p=>occupied[p])),p=>!occupied[p]);
 const boundary=new Set();for(let p=0;p<n;p++)if(occupied[p]&&neighbors(p).some(q=>exterior.has(q))&&votes[p].size)boundary.add(p);
 const rim=new Map();for(const p of thinMask(boundary,w))rim.set(p,[...votes[p]].sort((a,b)=>b[1]-a[1]||a[0]-b[0])[0][0]);
 const domain=new Set(boundary);for(const p of boundary)for(const q of neighbors(p))domain.add(q);
 // Filled caps influence the exterior's two-cell neighbourhood only. An
 // object's deep interior seams are not reclassified by this boundary plan.
 const fillDomain=new Set(domain);for(const p of domain)for(const q of neighbors(p))fillDomain.add(q);
 for(let p=0;p<fromFill.length;p++)if(!fillDomain.has(Math.floor(p/sw/step)*w+Math.floor(p%sw/step)))fromFill[p]=-1;
 const occupancy=[...domain].filter(p=>!boundary.has(p)||rim.has(p)).map(p=>[p,occupied[p]]);
 return {occupied,rim,domain,boundary,fill,sourceFill:fromFill,occupancy,objects};
}
function joint(PNG,source,base,palette,policy,material,features,sharedLabels,trace=null,completeExterior=true){
 assertOwnedStrokePolicy(policy,palette);
 const phase=policy.curveFlow?'outline-curve':'outline-reference';
 const emit=(stage,image,details)=>require('./conversion-trace.cjs').snapshot(PNG,trace,phase+'-'+stage,image,details);
 const sw=source.width,sh=source.height,w=base.width,h=base.height,step=sw/w,N=sw*sh,n=w*h;
 if(!Array.isArray(policy.sourceStrokeColors)||!policy.sourceStrokeColors.length)throw Error('Required rendered stroke audit needs explicit source ink colors');
 const entries=palette.map(p=>({...p,v:parseInt(p.hex.slice(1)+'ff',16)})),ink=new Set(policy.sourceStrokeColors.map(c=>parseInt(c.slice(1)+'ff',16))),bg=parseInt(policy.background.slice(1)+'ff',16),bgRGB=entries.find(p=>p.v===bg).rgb;
 const cache=new Map(),nearest=(r,g,b)=>{const key=(r<<16)|(g<<8)|b;if(cache.has(key))return cache.get(key);let best=Infinity,v;for(const p of entries){let d=(r-p.rgb[0])**2+(g-p.rgb[1])**2+(b-p.rgb[2])**2;if(d<best){best=d;v=p.v;}}cache.set(key,v);return v;};
 const adj=(p,W,H,diag=false)=>{const x=p%W,y=Math.floor(p/W),a=[];for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if((dx||dy)&&(diag||!dx||!dy)&&x+dx>=0&&x+dx<W&&y+dy>=0&&y+dy<H)a.push((y+dy)*W+x+dx);return a;};
 const protectedSource=p=>features.mask[p]||(policy.protectedSourceRegions??[]).some(([x,y,a,b])=>p%sw>=x&&p%sw<x+a&&Math.floor(p/sw)>=y&&Math.floor(p/sw)<y+b);
 // A dark material and a contour may share an RGB. Reviewed source fill
 // ownership outranks the width heuristic, without hiding its boundary audit.
 const sourceFill=p=>Boolean(material?.sourceFills?.[p]);
 const surfaceLayout=require('./material-surface-layout.cjs').planMaterialSurfaces(source,base,sharedLabels,material,features,policy.sourceInkRoles);
 if(surfaceLayout.fills.size){const planned=new PNG({width:w,height:h});base.data.copy(planned.data);for(const[p,color]of surfaceLayout.fills)planned.data.writeUInt32BE(color,p*4);base=planned;}
 for(const[p,allowed]of material?.fillCells??[])if(!allowed.some(c=>parseInt(c.slice(1)+'ff',16)===base.data.readUInt32BE(p*4)))throw Error('Declared fill majority lost before stroke placement');
 const locked=new Set([...features.cells,...(material?.interior.keys()??[]),...(material?.fillCells?.keys()??[]),...surfaceLayout.reservedFill]);for(let p=0;p<n;p++){const x=p%w,y=Math.floor(p/w);if((policy.protectedSourceRegions??[]).some(([a,b,c,d])=>x*step<a+c&&(x+1)*step>a&&y*step<b+d&&(y+1)*step>b))locked.add(p);}
 const writeLocked=new Set([...locked,...(material?.fixedCells?.keys()??[])]);
 const shareSurfaceBoundary=set=>{
  if(!surfaceLayout.lines.size)return set;
  const removed=new Set([...set].filter(p=>surfaceLayout.replaceCells.has(p))),contacts=new Set([...set].filter(p=>!removed.has(p)&&adj(p,w,h,true).some(q=>removed.has(q)&&!surfaceLayout.layoutDomain?.has(q))));
  for(const p of removed)set.delete(p);for(const p of surfaceLayout.lines.keys())if(!locked.has(p))set.add(p);
  // Retained branches must reach the relocated shared boundary at a source-
  // supported junction. Leaving their old ends dangling opens false exterior.
  for(const start of contacts){
   if(adj(start,w,h,true).some(p=>surfaceLayout.lines.has(p)))continue;
   const queue=[start],parent=new Map([[start,null]]);let target=null;
   for(let i=0;i<queue.length&&target===null;i++)for(const q of adj(queue[i],w,h,true)){
    if(parent.has(q)||locked.has(q)||surfaceLayout.fills.has(q)||!surfaceLayout.replaceCells.has(q))continue;
    parent.set(q,queue[i]);if(surfaceLayout.lines.has(q)){target=q;break;}queue.push(q);
   }
   if(target===null)throw Error('Observed contact junction cannot reach its shared boundary');
   const pigment=surfaceLayout.lines.get(target);for(let p=target;p!==start;p=parent.get(p)){set.add(p);surfaceLayout.lines.set(p,pigment);}
  }
  return set;
 };
 const segmented=sharedLabels;if(!segmented||segmented.width!==sw||segmented.height!==sh)throw Error('Color planes and strokes must share the same source labels');
 const colors=new Uint32Array(N),strokePigment=new Uint32Array(N),fg=new Uint8Array(N),mask=new Set(),dist=(a,b)=>a.reduce((s,v,i)=>s+(v-b[i])**2,0);
 for(let p=0;p<N;p++){const k=p*4,rgb=[source.data[k],source.data[k+1],source.data[k+2]];colors[p]=segmented.data.readUInt32BE(k);const owner=material?.owners[p]??-1;
  // Reviewed ownership is categorical. Raw background texture must not turn
  // an explicitly assigned background sample back into foreground material.
  const foreground=owner>=0?material.plan.regions[owner].material!=='background':bgRGB.some((c,i)=>Math.abs(source.data[k+i]-c)>policy.backgroundTolerance);
  fg[p]=Number(source.data[k+3]>=128&&foreground);if(protectedSource(p)||sourceFill(p))continue;for(const role of policy.sourceInkRoles??[])if((!role.sourceRect||(p%sw>=role.sourceRect[0]&&p%sw<role.sourceRect[0]+role.sourceRect[2]&&Math.floor(p/sw)>=role.sourceRect[1]&&Math.floor(p/sw)<role.sourceRect[1]+role.sourceRect[3]))&&(role.paletteColors??[role.color]).some(c=>parseInt(c.slice(1)+'ff',16)===colors[p]))strokePigment[p]=parseInt(role.color.slice(1)+'ff',16);if(strokePigment[p])mask.add(p);}
 if(trace){const im=new PNG({width:sw,height:sh});for(let p=0;p<N;p++)im.data.writeUInt32BE(mask.has(p)?0x00ff00ff:fg[p]?0x4466aaff:0xffffffff,p*4);emit('source-ownership',im,{legend:'green=ink blue=foreground white=background'});}
 const sourceInkEvidence=require('./source-ink-evidence.cjs').reconcileSourceInk(source,mask,strokePigment,step,p=>protectedSource(p)||sourceFill(p));
 // Recover source-label connectivity before medial tracing. Only a short
 // subcell interval with observed raw ink/antialias support may join two
 // distinct same-pigment components; no background or flat material bridge.
 // A connected source line may change pigment without changing geometry.
 // Keep its local colors; do not turn pigment transitions into false ends.
 const families=new Map(policy.sourceInkRoles.map(r=>[parseInt(r.color.slice(1)+'ff',16),r.family??r.color]));
 const sameFamily=(a,b)=>families.get(a)===families.get(b);
 const component=new Int32Array(N).fill(-1);let componentId=0;
 for(const start of mask)if(component[start]<0){const q=[start];component[start]=componentId;for(let i=0;i<q.length;i++)for(const p of adj(q[i],sw,sh,true))if(mask.has(p)&&component[p]<0&&sameFamily(strokePigment[p],strokePigment[start])){component[p]=componentId;q.push(p);}componentId++;}
 const roleEntries=new Map(policy.sourceInkRoles.map(r=>[parseInt(r.color.slice(1)+'ff',16),entries.filter(e=>(r.paletteColors??[r.color]).includes(e.hex))])),allInk=new Set([...roleEntries.values()].flat().map(e=>e.v)),fills=entries.filter(e=>!allInk.has(e.v));
 const familyEntries=new Map([...roleEntries].map(([pigment])=>[pigment,[...roleEntries].filter(([other])=>sameFamily(other,pigment)).flatMap(([,colors])=>colors)]));
 const supportCache=new Map();const supported=(p,pigment)=>{if(protectedSource(p)||sourceFill(p))return false;const k=p*4,rgb=[source.data[k],source.data[k+1],source.data[k+2]],key=rgb.join(',')+':'+pigment;if(supportCache.has(key))return supportCache.get(key);const localInk=familyEntries.get(pigment),v=nearest(...rgb);let ok=localInk.some(e=>e.v===v);
   if(!ok&&Math.min(...fills.map(e=>Math.sqrt(dist(rgb,e.rgb))))>12)for(const a of localInk)for(const b of fills){const dv=a.rgb.map((c,i)=>c-b.rgb[i]),den=dv.reduce((s,c)=>s+c*c,0),t=rgb.reduce((s,c,i)=>s+(c-b.rgb[i])*dv[i],0)/(den||1);if(t>=.2&&t<=.85&&Math.sqrt(rgb.reduce((s,c,i)=>s+(c-b.rgb[i]-t*dv[i])**2,0))<=14)ok=true;}
   supportCache.set(key,ok);return ok;};
 const candidates=new Map(),radius=Math.max(2,Math.floor(step));
 for(const p of mask){if(adj(p,sw,sh,true).every(q=>mask.has(q)))continue;const x=p%sw,y=Math.floor(p/sw);for(let dy=-radius;dy<=radius;dy++)for(let dx=-radius;dx<=radius;dx++){
   const xx=x+dx,yy=y+dy,q=yy*sw+xx;if(xx<0||yy<0||xx>=sw||yy>=sh||q<=p||!mask.has(q)||component[p]===component[q]||!sameFamily(strokePigment[p],strokePigment[q])||dx*dx+dy*dy>radius*radius)continue;
   const line=rasterPath([x+.5,y+.5],[xx+.5,yy+.5],false).map(([a,b])=>b*sw+a),missing=line.filter(r=>!mask.has(r));
   if(!missing.length||missing.length>Math.max(1,Math.floor(step/2))||!missing.every(r=>supported(r,strokePigment[p])))continue;
   const key=[component[p],component[q]].sort((a,b)=>a-b).join(':'),cost=dx*dx+dy*dy;
   if(!candidates.has(key)||cost<candidates.get(key).cost)candidates.set(key,{sourcePixels:missing,endpoints:[p,q],joinedComponents:[component[p],component[q]],color:strokePigment[p],cost});
 }}
 const sourceBridges=[...candidates.values()];for(const bridge of sourceBridges)for(const p of bridge.sourcePixels){mask.add(p);strokePigment[p]=bridge.color;}
 // Distance and medial ownership distinguish narrow source ink from a filled
 // dark material. A single palette RGB is not a declaration that all of it is line.
 const depth=new Int16Array(N),q=[];for(const p of mask)if(adj(p,sw,sh,true).some(r=>!mask.has(r))){depth[p]=1;q.push(p);}for(let i=0;i<q.length;i++)for(const r of adj(q[i],sw,sh,true))if(mask.has(r)&&!depth[r]){depth[r]=depth[q[i]]+1;q.push(r);}
 const skeleton=thinMask(mask,sw),owner=new Int32Array(N).fill(-1),queue=[];for(const p of skeleton){owner[p]=p;queue.push(p);}for(let i=0;i<queue.length;i++)for(const r of adj(queue[i],sw,sh,true))if(mask.has(r)&&owner[r]<0){owner[r]=owner[queue[i]];queue.push(r);}
 // A shared contact owns the original stroke's complete cross-section, not
 // an arbitrary-radius subset that leaves a parallel old medial path behind.
 const surfaceMedial=new Set([...surfaceLayout.sourceDomain].map(p=>owner[p]).filter(p=>p>=0));
 for(const p of mask)if(surfaceMedial.has(owner[p])){surfaceLayout.sourceDomain.add(p);surfaceLayout.replaceCells.add(Math.floor(p/sw/step)*w+Math.floor(p%sw/step));}
 const explicitStroke=new Set((policy.sourceInkRoles??[]).filter(r=>r.kind==='stroke').map(r=>parseInt(r.color.slice(1)+'ff',16)));
 const narrow=new Set(),filledBranches=[];
 for(const branch of traceStrokePaths(skeleton,sw,sh,p=>[p%sw+.5,Math.floor(p/sw)+.5],1,0)){
  const points=new Set();for(let i=1;i<branch.length;i++)for(const[x,y]of rasterPath(branch[i-1],branch[i],false))points.add(y*sw+x);
  const ends=[branch[0],branch.at(-1)].map(([x,y])=>Math.floor(y)*sw+Math.floor(x));
  const junctions=ends.filter(p=>adj(p,sw,sh,true).filter(q=>skeleton.has(q)).length>2);
  // A junction widens the source cross-section locally. It cannot turn
  // an entire long contour into fill and thereby exempt it from width QA.
  // Measure the branch away from junction influence; a compact filled
  // region without a junction still retains its actual measured radius.
  const measured=[...points].filter(p=>!junctions.some(q=>(p%sw-q%sw)**2+(Math.floor(p/sw)-Math.floor(q/sw))**2<=(step*2)**2));
  const radius=Math.max(0,...measured.map(p=>depth[p]));
  if(![...points].some(p=>surfaceMedial.has(p))&&measured.some(p=>!explicitStroke.has(strokePigment[p])&&depth[p]>step*2)){filledBranches.push({radius,sourcePoints:[...points]});continue;}
  for(const p of points)narrow.add(p);
 }
 const exteriorPlan=sourceExteriorPlan(fg,strokePigment,depth,sw,sh,w,h,policy.sourceInkRoles);
 const sourceBand=new Set([...mask].filter(p=>narrow.has(owner[p])&&exteriorPlan.sourceFill[p]<0));
 // Replace the whole source-owned cross-section of an exterior stroke, not
 // only a one-cell halo of the new rim. A halo leaves the old medial line's
 // inner half behind as detached dots and T-shaped branches.
 const nativeCell=p=>Math.floor(p/sw/step)*w+Math.floor(p%sw/step);
 const exteriorMedial=new Set([...sourceBand].filter(p=>exteriorPlan.boundary.has(nativeCell(p))).map(p=>owner[p]));
 const exteriorDistance=new Int32Array(N).fill(-1),exteriorQueue=[];
 const seedExterior=p=>{if(!fg[p]&&exteriorDistance[p]<0){exteriorDistance[p]=0;exteriorQueue.push(p);}};
 for(let x=0;x<sw;x++){seedExterior(x);seedExterior((sh-1)*sw+x);}for(let y=0;y<sh;y++){seedExterior(y*sw);seedExterior(y*sw+sw-1);}
 for(let i=0;i<exteriorQueue.length;i++)for(const p of adj(exteriorQueue[i],sw,sh))if(!fg[p]&&exteriorDistance[p]<0){exteriorDistance[p]=0;exteriorQueue.push(p);}
 for(let i=0;i<exteriorQueue.length;i++)for(const p of adj(exteriorQueue[i],sw,sh))if(exteriorDistance[p]<0){exteriorDistance[p]=exteriorDistance[exteriorQueue[i]]+1;exteriorQueue.push(p);}
 // Medial end branches at concave source corners can lie wholly inside a
 // native cell. Recognize their exterior-facing cross-section in SOURCE
 // space; native boundary-cell overlap alone misses those ends.
 const exteriorPigments=new Set(exteriorPlan.rim.values());
 for(const p of narrow)if(exteriorPlan.objects[p]&&exteriorPigments.has(strokePigment[p])&&depth[p]>0&&exteriorDistance[p]<=depth[p]*2)exteriorMedial.add(p);
 // Ink replacement and silhouette occupancy have different ownership.
 // Extending the former must not reclassify an internal gap as foreground.
 const replacementDomain=new Set(exteriorPlan.domain);
 if(completeExterior)for(const p of sourceBand)if(exteriorMedial.has(owner[p]))replacementDomain.add(nativeCell(p));
 // Resolve the source's region sides before transferring the complete ink
 // cross-section. Width allocation may replace ink with its adjacent fill,
 // but cannot use the moved line as evidence to re-flood a hair gap.
 const regionReference=completeExterior?joint(PNG,source,base,palette,policy,material,features,sharedLabels,null,false):null;
 const narrowStrokes=new Set([...narrow].filter(p=>exteriorPlan.sourceFill[p]<0));
 const rawPaths=traceStrokePaths(narrowStrokes,sw,sh,p=>[(p%sw+.5)/step,(Math.floor(p/sw)+.5)/step],1/step,.35);
 const flowTools=policy.curveFlow?require('./source-curve-flow.cjs'):null;
 // Protect gaps in the actual jointly assigned baseline, not only in the
 // pre-line area sampler. The final comparison below uses this same baseline.
 const curveReferenceResult=flowTools?joint(PNG,source,base,palette,{...policy,curveFlow:null},material,features,sharedLabels,trace,completeExterior):null;
 const curveReference=curveReferenceResult?.image??null;
 const curveGuards=flowTools?new Set([...flowTools.enclosedBackgroundGuards(base,bg),...flowTools.enclosedBackgroundGuards(curveReference,bg),...surfaceLayout.domain]):null;
 const curveFlow=flowTools?flowTools.layoutCurveFlow(rawPaths,w,h,locked,policy.curveFlow,curveGuards):null;
 // Smoothing is a candidate, not permission to change the source layout's
 // topology. Reject the whole proposed displacement if its composed render
 // fails, retaining the independently rendered source layout only when all
 // of its ordinary saved-stroke checks also pass. The attempt remains recorded.
 const retainSourceLayout=(reason,rejectedTopology)=>{
  const result=curveReferenceResult,referenceTopology=result.report.topology;
  result.report.curveFlowRequired=true;
  result.report.curveFlow={...curveFlow.report,attemptedAccepted:curveFlow.report.accepted,accepted:0,
   records:curveFlow.report.records.map(r=>r.accepted?{...r,accepted:false,reason:'composed render rejected: '+reason}:r),
   selection:'source-layout-after-rejected-curve',rejection:{reason,topology:rejectedTopology},
   finalTopology:{before:referenceTopology,after:referenceTopology,unchanged:true},
   background:policy.background,referenceRegionTopology:flowTools.regionTopologyFingerprint(result.image,bg),regionTopologyChecked:true};
  const audit=auditRenderedStrokeBands(result.image,result.report);
  if(audit.status!=='PASS')throw Error('Rejected curve has no valid source-layout alternative: '+JSON.stringify(audit));
  emit('selected-source-layout',result.image,{curveFlow:result.report.curveFlow});return result;
 };
 const paths=curveFlow?.paths??rawPaths;let cells=new Set();for(const line of paths)for(let i=1;i<line.length;i++)for(const[x,y]of rasterPath(line[i-1],line[i],false))if(x>=0&&y>=0&&x<w&&y<h&&!locked.has(y*w+x))cells.add(y*w+x);
 cells=new Set(thinMask(cells,w));cells=shareSurfaceBoundary(coalesceStrokeJunctions(cells,paths,w,h,new Set()).cells);
 const componentCount=(set,foreground)=>{const pending=new Set();for(let p=0;p<n;p++)if(set.has(p)===foreground)pending.add(p);let count=0;while(pending.size){count++;const queue=[pending.values().next().value];pending.delete(queue[0]);for(let i=0;i<queue.length;i++)for(const r of adj(queue[i],w,h,foreground))if(pending.delete(r))queue.push(r);}return count;};
 const requiredSurfaceCells=new Set(surfaceLayout.reports.flatMap(r=>r.pathCells));
 const sharedJunctionSupport=new Set([...sourceBand].map(p=>Math.floor(p/sw/step)*w+Math.floor(p%sw/step)));
 const sharedJunctionChanges=[];
 const resolveSharedJunctions=(input,record=true)=>{
  const set=new Set(input),signature=require('./source-curve-flow.cjs').topologySignature;
  const solidBlock=(mask,p)=>p%w+1<w&&p+w+1<n&&[p,p+1,p+w,p+w+1].every(q=>mask.has(q));
  for(const p of [...set]){
   if(!solidBlock(set,p))continue;
   const block=[p,p+1,p+w,p+w+1],movable=block.filter(q=>!requiredSurfaceCells.has(q)&&!locked.has(q));
   if(!movable.length)continue;
   const topology=[componentCount(set,true),componentCount(set,false)];
   // Keep the existing single-cell contraction when it can satisfy both
   // topology and any required surface. Ordinary stroke junctions need the
   // same source-supported joint routing when single-cell removal fails.
   if(movable.some(q=>{const trial=new Set(set);trial.delete(q);return componentCount(trial,true)===topology[0]&&componentCount(trial,false)===topology[1];}))continue;
   const x=p%w,y=Math.floor(p/w),box=[Math.max(0,x-2),Math.max(0,y-2),Math.min(w-1,x+3),Math.min(h-1,y+3)],before=signature(set,w,h,box);
   const additions=[...new Set(block.flatMap(q=>adj(q,w,h,true)))].filter(q=>!set.has(q)&&sharedJunctionSupport.has(q)&&!locked.has(q)&&!surfaceLayout.fills.has(q));
   const options=[[]];for(let a=0;a<additions.length;a++){options.push([additions[a]]);for(let b=a+1;b<additions.length;b++)options.push([additions[a],additions[b]]);}
   let best=null;
   for(let bits=1;bits<(1<<movable.length);bits++){
    const removed=movable.filter((_,i)=>bits&(1<<i));
    for(const added of options){
     const cost=removed.length+added.length;if(best&&cost>=best.cost)continue;
     const trial=new Set(set);for(const q of removed)trial.delete(q);for(const q of added)trial.add(q);
     if(block.flatMap(q=>[q,q-1,q-w,q-w-1]).some(q=>q>=0&&solidBlock(trial,q)))continue;
     if(signature(trial,w,h,box)!==before)continue;
     best={trial,cost,removed,added};
    }
   }
   if(best){set.clear();for(const q of best.trial)set.add(q);if(record)sharedJunctionChanges.push({block,removed:best.removed,added:best.added,sourceSupported:true,requiredSurfacePreserved:true,localTopologyPreserved:true});}
  }
  return set;
 };
 cells=resolveSharedJunctions(cells);
 const topology=[componentCount(cells,true),componentCount(cells,false)],junctionContractions=[];
 let originalCurveCells=null;
 if(curveFlow){
  let baseline=new Set();for(const line of rawPaths)for(let i=1;i<line.length;i++)for(const[x,y]of rasterPath(line[i-1],line[i],false))if(x>=0&&y>=0&&x<w&&y<h&&!locked.has(y*w+x))baseline.add(y*w+x);
  baseline=shareSurfaceBoundary(coalesceStrokeJunctions(new Set(thinMask(baseline,w)),rawPaths,w,h,new Set()).cells);
  baseline=resolveSharedJunctions(baseline,false);
  originalCurveCells=baseline;
  const originalTopology=[componentCount(baseline,true),componentCount(baseline,false)];
  if(JSON.stringify(originalTopology)!==JSON.stringify(topology))return retainSourceLayout('Curve layout changed final stroke connectivity or gaps',{before:originalTopology,after:topology});
  curveFlow.report.finalTopology={before:originalTopology,after:topology,unchanged:true};
 }
 for(const p of [...cells]){if(p%w+1>=w||p+w+1>=n)continue;const block=[p,p+1,p+w,p+w+1];if(!block.every(q=>cells.has(q)))continue;const candidates=block.filter(q=>!requiredSurfaceCells.has(q)).map(q=>{const x=(q%w+.5)*step,y=(Math.floor(q/w)+.5)*step;let distance=Infinity;for(let yy=Math.max(0,Math.floor(y-step));yy<Math.min(sh,y+step);yy++)for(let xx=Math.max(0,Math.floor(x-step));xx<Math.min(sw,x+step);xx++)if(narrow.has(yy*sw+xx))distance=Math.min(distance,(xx-x)**2+(yy-y)**2);return{q,distance};}).sort((a,b)=>b.distance-a.distance||a.q-b.q);for(const{q}of candidates){const trial=new Set(cells);trial.delete(q);if(componentCount(trial,true)===topology[0]&&componentCount(trial,false)===topology[1]){cells=trial;surfaceLayout.lines.delete(q);junctionContractions.push(q);break;}}}
 // Native scope is the complete projected source band, not a partial
 // neighbourhood of newly allocated dots. This includes old residual ink.
 const exteriorContacts=new Set([...cells].filter(p=>!replacementDomain.has(p)&&adj(p,w,h,true).some(q=>cells.has(q)&&replacementDomain.has(q))));
 const oldMedialCells=new Set(cells),exteriorJoins=[];
 for(const p of replacementDomain)if(!writeLocked.has(p)){
  cells.delete(p);
  if(exteriorPlan.rim.has(p))cells.add(p);
 }
 // A real internal crease terminates at the rim. Replacing the rim must
 // transfer that contact, not cut the crease into a detached dot. Route only
 // through its observed source band and existing foreground, never a gap.
 const projectedBand=new Set([...sourceBand].map(nativeCell));
 for(const start of completeExterior?exteriorContacts:[]){
  if(adj(start,w,h,true).some(p=>exteriorPlan.rim.has(p)))continue;
  const queue=[start],parent=new Map([[start,null]]);let target=null;
  for(let i=0;i<queue.length&&target===null;i++){
   const next=adj(queue[i],w,h,true).sort((a,b)=>Number(oldMedialCells.has(b))-Number(oldMedialCells.has(a)));
   for(const p of next){
    if(parent.has(p)||writeLocked.has(p)||!replacementDomain.has(p)||!(regionReference?regionReference.image.data.readUInt32BE(p*4)!==bg:exteriorPlan.occupied[p])||!projectedBand.has(p)&&!exteriorPlan.rim.has(p))continue;
    const route=new Set([p]);for(let q=queue[i];q!==null;q=parent.get(q))route.add(q);
    const doubled=[p,p-1,p-w,p-w-1].some(q=>q>=0&&q%w+1<w&&q+w+1<n&&[q,q+1,q+w,q+w+1].every(v=>cells.has(v)||route.has(v)));
    if(doubled)continue;
    parent.set(p,queue[i]);if(exteriorPlan.rim.has(p)){target=p;break;}queue.push(p);
   }
  }
  // Proximity to the replacement domain alone is not an exterior contact:
  // nearby material seams and feature-locked ends must not be forced to it.
  if(target===null)continue;
  const joined=[];for(let p=target;p!==start;p=parent.get(p)){cells.add(p);joined.push(p);}exteriorJoins.push({start,target,cells:joined});
 }
 const finalStrokeTopology=[componentCount(cells,true),componentCount(cells,false)];
 if(curveFlow){
  const before=curveReferenceResult.report.topology;
  if(JSON.stringify(before)!==JSON.stringify(finalStrokeTopology))return retainSourceLayout('Exterior and interior paths changed joint connectivity',{before,after:finalStrokeTopology});
  curveFlow.report.finalTopology={before,after:finalStrokeTopology,unchanged:true};
 }
 const band=new Set();for(const p of sourceBand)band.add(Math.floor(Math.floor(p/sw)/step)*w+Math.floor(p%sw/step));for(const p of cells)band.add(p);for(const p of replacementDomain)band.add(p);
 if(trace){const im=new PNG({width:w,height:h});base.data.copy(im.data);for(const p of cells)im.data.writeUInt32BE(0x00ff00ff,p*4);emit('planned-paths',im,{pathCells:[...cells],sourceBand:[...band],locked:[...locked],sourceBridges,filledBranchCount:filledBranches.length,surfaces:surfaceLayout.reports});}
 // Moving a curve also moves its two region sides. Original exterior samples
 // swept inside the new contour must not seed new enclosed background holes.
 // Genuine source-enclosed negative space retains its own background seeds.
 const curveSweep=new Set(),sourceExterior=new Uint8Array(N);
 if(curveFlow?.report.accepted){
  for(const p of new Set([...originalCurveCells,...cells]))if(originalCurveCells.has(p)!==cells.has(p)){curveSweep.add(p);for(const q of adj(p,w,h,true))curveSweep.add(q);}
  const q=[];const offer=p=>{if(!fg[p]&&!sourceExterior[p]){sourceExterior[p]=1;q.push(p);}};
  for(let x=0;x<sw;x++){offer(x);offer((sh-1)*sw+x);}for(let y=0;y<sh;y++){offer(y*sw);offer(y*sw+sw-1);}
  for(let i=0;i<q.length;i++)for(const p of adj(q[i],sw,sh))offer(p);
  curveFlow.report.sweptRegionCells=curveSweep.size;
 }
 // Protected features keep their own source RGB/role processing. They are
 // neither fill seeds nor transit regions for a neighbouring contour owner.
 // The color decision is already made. A vacated stroke cell may receive a
 // source-side fill, but that fill cannot cross a declared material contract.
 const mayFill=(seed,target)=>{
  if(!material)return true;
  // Once a source sample belongs to the narrow stroke's complete section,
  // its earlier palette/material guess cannot wall off the vacated band.
  // Actual observed fills are excluded from sourceBand above and remain
  // subject to their material family and native fill obligations.
  if(sourceBand.has(target))return true;
  const a=material.owners[seed],b=material.owners[target];
  return b<0 || a>=0&&material.materialGroups[a]===material.materialGroups[b];
 };
 const fillOwner=new Int32Array(N).fill(-1),fillQ=[];for(let p=0;p<N;p++)if(fg[p]&&!sourceBand.has(p)&&!protectedSource(p)){fillOwner[p]=p;fillQ.push(p);}for(let i=0;i<fillQ.length;i++)for(const r of adj(fillQ[i],sw,sh))if(fg[r]&&!protectedSource(r)&&fillOwner[r]<0&&mayFill(fillOwner[fillQ[i]],r)){fillOwner[r]=fillOwner[fillQ[i]];fillQ.push(r);}
 // Background-colored fringe is not an interior fill seed. The reference
 // and moved-curve allocators must agree here; otherwise the reference can
 // invent a cream pinhole that the curve allocator correctly refuses.
 const plainOwner=new Int32Array(N).fill(-1),plainQ=[];for(let p=0;p<N;p++)if(fg[p]&&!protectedSource(p)&&(!mask.has(p)&&!ink.has(colors[p])||sourceFill(p))&&colors[p]!==bg){plainOwner[p]=p;plainQ.push(p);}for(let i=0;i<plainQ.length;i++)for(const r of adj(plainQ[i],sw,sh))if(fg[r]&&!protectedSource(r)&&plainOwner[r]<0&&mayFill(plainOwner[plainQ[i]],r)){plainOwner[r]=plainOwner[plainQ[i]];plainQ.push(r);}
 // Write protection is not solid occupancy: a locked background cell remains
 // exterior space. It must not become a wall in foreground topology.
 // The jointly planned surface is foreground occupancy too. Partial edge
 // cells need not be write-locked, but exterior flood/fringe classification
 // must not erase their already allocated material side.
 const solidLocked=new Set([...locked,...surfaceLayout.fills.keys()].filter(p=>base.data.readUInt32BE(p*4)!==bg));
 const occupied=new Uint8Array(n),outside=new Uint8Array(n),oq=[],filledMaterialCells=[...(material?.fillCells?.keys()??[]),...surfaceLayout.fills.keys()];
 for(let p=0;p<n;p++){const x=p%w,y=Math.floor(p/w);let solid=0,bgs=0,broad=0,narrowArea=0,sourceClosedBackground=0;for(let yy=y*step;yy<(y+1)*step;yy++)for(let xx=x*step;xx<(x+1)*step;xx++){const r=yy*sw+xx;if(fg[r]&&!sourceBand.has(r))solid++;if(mask.has(r)&&!sourceBand.has(r))broad++;if(sourceBand.has(r))narrowArea++;if(!fg[r]){bgs++;if(!sourceExterior[r])sourceClosedBackground++;}}if(broad>step*step*.5||(broad>0&&narrowArea===0))filledMaterialCells.push(p);occupied[p]=Number((solid>=step*step*.5&&!curveSweep.has(p))||solidLocked.has(p));if(!cells.has(p)&&!occupied[p]&&bgs>=step*step*.75&&(!curveSweep.has(p)||sourceClosedBackground>=step*step*.75)){outside[p]=1;oq.push(p);}}
 for(let i=0;i<oq.length;i++)for(const r of adj(oq[i],w,h))if(!outside[r]&&!cells.has(r)&&!occupied[r]){outside[r]=1;oq.push(r);}
 if(trace){const im=new PNG({width:w,height:h});for(let p=0;p<n;p++)im.data.writeUInt32BE(cells.has(p)?0x00ff00ff:outside[p]?0xffffffff:occupied[p]?0x4466aaff:0x222222ff,p*4);emit('region-sides',im,{legend:'green=path white=outside blue=material dark=unfilled band'});}
 // A closed outer stroke owns its exterior too. Antialias colors that had
 // been classified as material cannot leave specks outside the rebuilt rim.
 // Declared silhouette colors without a narrow-stroke role are solid
 // material boundaries (e.g. dark hair), not absent line ownership.
 const rolePalette=new Set(policy.sourceInkRoles.flatMap(r=>r.paletteColors??[r.color]));
 const solidExteriorColors=(policy.colors??[]).filter(c=>!rolePalette.has(c));
 const solidExteriorValues=new Set(solidExteriorColors.map(c=>parseInt(c.slice(1)+'ff',16)));
 const solidExteriorCells=[];for(let p=0;p<n;p++)if(solidExteriorValues.has(base.data.readUInt32BE(p*4)))solidExteriorCells.push(p);
 const lineExterior=exteriorOfStroke(w,h,new Set([...cells,...solidLocked,...filledMaterialCells,...solidExteriorCells]),p=>base.data.readUInt32BE(p*4)===bg),bandHalo=new Set(band);
 for(const p of band)for(const q of adj(p,w,h,true))bandHalo.add(q);
 const exteriorFringe=[];for(const p of lineExterior)if(bandHalo.has(p)&&!locked.has(p)){outside[p]=1;if(base.data.readUInt32BE(p*4)!==bg){band.add(p);exteriorFringe.push(p);}}
 for(const p of exteriorPlan.domain)outside[p]=Number(!exteriorPlan.occupied[p]);
 for(const p of exteriorPlan.boundary)if(!exteriorPlan.rim.has(p)&&lineExterior.has(p))outside[p]=1;
 if(regionReference)for(const p of band)outside[p]=Number(regionReference.image.data.readUInt32BE(p*4)===bg);
 if(trace){const im=new PNG({width:w,height:h});for(let p=0;p<n;p++)im.data.writeUInt32BE(cells.has(p)?0x00ff00ff:outside[p]?0xffffffff:occupied[p]?0x4466aaff:0x222222ff,p*4);emit('exterior-ownership',im,{exteriorFringe,filledMaterialCells,solidExteriorColors});}
 // A displaced curve's interior can only receive foreground material from
 // that same reconstructed region. Raw fringe pixels quantized to background
 // must not win the interior fill vote and make a new pinhole.
 let curveInteriorOwner=null;
 if(curveSweep.size){
  curveInteriorOwner=new Int32Array(N).fill(-1);const q=[];
  const inside=p=>{const cell=Math.floor(Math.floor(p/sw)/step)*w+Math.floor(p%sw/step);return !outside[cell]&&!cells.has(cell);};
  for(let p=0;p<N;p++)if(inside(p)&&fg[p]&&!protectedSource(p)&&(!mask.has(p)&&!ink.has(colors[p])||sourceFill(p))&&colors[p]!==bg){curveInteriorOwner[p]=p;q.push(p);}
  for(let i=0;i<q.length;i++)for(const p of adj(q[i],sw,sh))if(inside(p)&&!protectedSource(p)&&curveInteriorOwner[p]<0&&mayFill(curveInteriorOwner[q[i]],p)){curveInteriorOwner[p]=curveInteriorOwner[q[i]];q.push(p);}
 }
 const out=new PNG({width:w,height:h});base.data.copy(out.data);for(const[p,c]of material?.fixedCells??[])out.data.writeUInt32BE(c,p*4);const restored=[],unresolved=[];
 const broadFillCells=[];
 for(const p of band){
  if(writeLocked.has(p)||cells.has(p))continue;
  const x=p%w,y=Math.floor(p/w);
  if(outside[p]){out.data.writeUInt32BE(bg,p*4);continue;}
  if(surfaceLayout.fills.has(p)){out.data.writeUInt32BE(surfaceLayout.fills.get(p),p*4);restored.push(p);continue;}
  // Reuse the independently resolved region side when it is already fill.
  // Only a vacated ink cell needs a new source-side color allocation.
  const assignedFill=regionReference?.image.data.readUInt32BE(p*4);
  if(assignedFill!==undefined&&assignedFill!==bg&&!ink.has(assignedFill)){out.data.writeUInt32BE(assignedFill,p*4);restored.push(p);continue;}
  let broadArea=0;
  for(let yy=y*step;yy<(y+1)*step;yy++)for(let xx=x*step;xx<(x+1)*step;xx++){
   const r=yy*sw+xx;if(mask.has(r)&&!sourceBand.has(r))broadArea++;
  }
  if(exteriorPlan.domain.has(p)&&exteriorPlan.occupied[p]&&exteriorPlan.fill.has(p)){
   out.data.writeUInt32BE(base.data.readUInt32BE(p*4),p*4);filledMaterialCells.push(p);restored.push(p);continue;
  }
  const useBroad=broadArea>step*step*.5;if(useBroad)broadFillCells.push(p);
  const votes=new Map(),sourceOwners=useBroad?fillOwner:curveSweep.has(p)?curveInteriorOwner:plainOwner;
  for(let yy=y*step;yy<(y+1)*step;yy++)for(let xx=x*step;xx<(x+1)*step;xx++){
   const f=sourceOwners[yy*sw+xx];if(f>=0){const c=colors[f];votes.set(c,(votes.get(c)||0)+1);}
  }
  const winner=[...votes].sort((a,b)=>b[1]-a[1]||a[0]-b[0])[0]?.[0];
  if(winner===undefined){unresolved.push(p);continue;}
  out.data.writeUInt32BE(winner,p*4);restored.push(p);
 }
 emit('fill-placement',out,{restored,unresolved});
 const expected=[];for(const p of cells){if(material?.fixedCells?.has(p))continue;const x=p%w,y=Math.floor(p/w),cx=(x+.5)*step,cy=(y+.5)*step;let best=Infinity,color;for(let yy=Math.max(0,Math.floor(cy-step*2));yy<Math.min(sh,cy+step*2);yy++)for(let xx=Math.max(0,Math.floor(cx-step*2));xx<Math.min(sw,cx+step*2);xx++){const r=yy*sw+xx;if(!sourceBand.has(r))continue;const dist=(xx-cx)**2+(yy-cy)**2;if(dist<best){best=dist;color=strokePigment[r];}}if(surfaceLayout.lines.has(p))color=parseInt(surfaceLayout.lines.get(p).slice(1)+'ff',16);if(exteriorPlan.rim.has(p))color=exteriorPlan.rim.get(p);if(color===undefined){unresolved.push(p);continue;}out.data.writeUInt32BE(color,p*4);expected.push([p,color]);}
 emit('rendered',out,{curveFlow:curveFlow?.report??null});
 if(curveFlow){
  const baseline=curveFlow.report.accepted?curveReference:out;
  curveFlow.report.background=policy.background;
  curveFlow.report.referenceRegionTopology=flowTools.regionTopologyFingerprint(baseline,bg);
  curveFlow.report.regionTopologyChecked=true;
  if(JSON.stringify(curveFlow.report.referenceRegionTopology)!==JSON.stringify(flowTools.regionTopologyFingerprint(out,bg)))return retainSourceLayout('Curve layout changed filled-region connectivity or an existing closed gap',{before:curveFlow.report.referenceRegionTopology,after:flowTools.regionTopologyFingerprint(out,bg)});
 }
 let residual=0,blocks=0;for(const p of band)if(!locked.has(p)&&!cells.has(p)&&ink.has(out.data.readUInt32BE(p*4)))residual++;for(let y=0;y<h-1;y++)for(let x=0;x<w-1;x++){const p=y*w+x,a=[p,p+1,p+w,p+w+1];if(a.every(v=>cells.has(v)))blocks++;}
 const sourceExteriorEvidence={version:1,method:'source-coverage-mixed-material',occupancy:exteriorPlan.occupancy.filter(([p])=>!material?.fixedCells?.has(p)),rimColors:[...exteriorPlan.rim].filter(([p])=>!writeLocked.has(p)),scope:'Source-derived mixed-material exterior, independent of the rendered path and fill claims; thinned corner cells excluded from occupancy, not width/closure checks.'};
 const report={version:1,method:'joint-source-band',sourceExteriorRequired:true,sourceExterior:sourceExteriorEvidence,surfaceLayout:surfaceLayout.reports,sourceInkEvidence,solidExteriorColors,exteriorClosureRequired:true,background:policy.background,exteriorFringe,curveFlowRequired:Boolean(policy.curveFlow),curveFlow:curveFlow?.report??null,colors:policy.sourceStrokeColors,sourceBridges,sourceBandPixels:sourceBand.size,sourceBand:[...band],pathCells:[...cells],expectedColors:expected,expectedFillColors:[...band].filter(p=>!cells.has(p)&&!writeLocked.has(p)).map(p=>[p,out.data.readUInt32BE(p*4)]),protectedColors:[...writeLocked].map(p=>[p,material?.fixedCells?.get(p)??base.data.readUInt32BE(p*4)]),filledMaterialCells,sharedJunctionChanges,sourcePathCount:paths.length,restored:restored.length,unresolved,residual,blocks,filledBranches,broadFillCells,junctionContractions,topology:finalStrokeTopology,sourceWidthLimit:step*2,scope:'Declared whole source stroke bands; broad source fill and locked features retain distinct ownership. Visual source completeness remains a separate review.'};
 report.exteriorReplacement={selection:completeExterior?'complete-source-ownership':'reference-source-layout',sourceMedialSamples:exteriorMedial.size,ownedCells:replacementDomain.size,regionSidesResolvedBeforeInk:Boolean(regionReference),contactJoins:exteriorJoins};
 if(material?.preservedOutline){
  const previous=material.preservedOutline,fixed=material.fixedCells;
  for(const key of ['expectedColors','expectedFillColors','protectedColors'])report[key]=[...report[key].filter(([p])=>!fixed.has(p)),...previous[key].filter(([p])=>fixed.has(p))];
  for(const key of ['pathCells','sourceBand','filledMaterialCells'])report[key]=[...report[key].filter(p=>!fixed.has(p)),...previous[key].filter(p=>fixed.has(p))];
  report.immutableColors=[...fixed];
  report.preservation={baseline:material.plan.preserveOutside.baseline,baselineRun:material.plan.preserveOutside.baselineRun,sourceRegions:material.plan.preserveOutside.sourceRegions,scope:'Write invariants only. Preserved stroke claims retain their original whole-PNG width checks.'};
 }
 // Ownership transfer is an atomic proposal. A width/material regression
 // must never be exported merely because its geometric plan is consistent.
 // Keep the rejection visible and retain a separately audited reference;
 // visual acceptance is still required for either selected image.
 if(completeExterior){
  const proposed=auditRenderedStrokeBands(out,report);
  const reference=regionReference;
  const fingerprint=require('./source-curve-flow.cjs').regionTopologyFingerprint;
  const referenceRegions=fingerprint(reference.image,bg),proposedRegions=fingerprint(out,bg);
  const regionsPreserved=JSON.stringify(referenceRegions)===JSON.stringify(proposedRegions);
  report.exteriorReplacement.regionTopology={reference:referenceRegions,proposed:proposedRegions,unchanged:regionsPreserved};
  if(proposed.status!=='PASS'||!regionsPreserved){
   emit('rejected-exterior-proposal',out,{audit:proposed,regionsPreserved});
   requireRenderedStrokeAudit(auditRenderedStrokeBands(reference.image,reference.report));
   reference.report.exteriorReplacement={...reference.report.exteriorReplacement,selection:'retained-audited-reference',rejectedProposal:proposed,regionTopology:report.exteriorReplacement.regionTopology};
   return reference;
  }
 }
 return {image:out,report};
}
function assertOwnedStrokePolicy(policy,palette){
 const colors=new Set(palette.map(p=>p.hex)),roles=policy?.sourceInkRoles;
 if(policy?.layout!=='joint-source-band'||policy.width!==1||!Array.isArray(roles)||!roles.length)throw Error('Joint source-band ownership and one-dot width must be declared');
 for(const role of roles)if(role.family!==undefined&&(typeof role.family!=='string'||!role.family.trim()))throw Error('Source ink family must be a nonempty observed name');
 const claimed=new Set();for(const r of roles){if(r.sourceRect&&(!Array.isArray(r.sourceRect)||r.sourceRect.length!==4||!r.sourceRect.every(Number.isInteger)||r.sourceRect[0]<0||r.sourceRect[1]<0||r.sourceRect[2]<=0||r.sourceRect[3]<=0))throw Error('Invalid source role observation rectangle');if(!r.name||!r.observation||!['stroke','mixed'].includes(r.kind)||!colors.has(r.color))throw Error('Source ink role needs name, observation, kind and palette color');for(const c of r.paletteColors??[r.color]){if(!colors.has(c)||claimed.has(c))throw Error('Source pigment must have one explicit owner');claimed.add(c);}}
 if(!Array.isArray(policy.sourceStrokeColors)||JSON.stringify([...new Set(roles.map(r=>r.color))].sort())!==JSON.stringify([...policy.sourceStrokeColors].sort()))throw Error('Required saved-stroke audit colors must match declared source roles');
}
function auditRenderedStrokeBands(image,report){
 if(report?.method!=='joint-source-band'||report.version!==1||!Array.isArray(report.expectedColors)||!report.expectedColors.length||!Array.isArray(report.expectedFillColors)||!Array.isArray(report.protectedColors)||!Array.isArray(report.filledMaterialCells))return{status:'UNVERIFIED',renderedStrokeChecked:false,missingPathPixels:null,residualBandInk:null,solidRenderedStrokeBlocks:null};
 if(report.curveFlowRequired&&(!report.curveFlow?.executed||report.curveFlow?.finalTopology?.unchanged!==true))return {status:'UNVERIFIED',renderedStrokeChecked:false,reason:'Required curve layout/topology audit did not run',missingPathPixels:null,residualBandInk:null,solidRenderedStrokeBlocks:null};
 if(report.curveFlowRequired){
  const flow=report.curveFlow;
  if(!flow.regionTopologyChecked||!flow.referenceRegionTopology)return {status:'UNVERIFIED',renderedStrokeChecked:false,reason:'Filled-region topology audit missing'};
  if(JSON.stringify(require('./source-curve-flow.cjs').regionTopologyFingerprint(image,flow.background))!==JSON.stringify(flow.referenceRegionTopology))return {status:'FAIL',renderedStrokeChecked:true,reason:'Saved filled-region connectivity or closed negative space changed'};
 }
 const w=image.width,h=image.height,paths=new Set(report.pathCells),protectedCells=new Set(report.protectedColors.map(([p])=>p)),fill=new Set(report.filledMaterialCells),ink=new Set(report.colors.map(c=>parseInt(c.slice(1)+'ff',16))),scope=new Set(report.sourceBand),value=p=>image.data.readUInt32BE(p*4);
 for(const p of [...scope])for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const x=p%w+dx,y=Math.floor(p/w)+dy;if(x>=0&&x<w&&y>=0&&y<h)scope.add(y*w+x);}
 const changedImmutable=(report.immutableColors??[]).filter(([p,c])=>value(p)!==c);
 const exterior=report.sourceExterior;
 if(report.sourceExteriorRequired&&(exterior?.version!==1||exterior.method!=='source-coverage-mixed-material'||!Array.isArray(exterior.occupancy)||!Array.isArray(exterior.rimColors)))return {status:'UNVERIFIED',renderedStrokeChecked:false,reason:'Independent source exterior obligations did not run'};
 const background=report.background?parseInt(report.background.slice(1)+'ff',16):null;
 const changedSourceExterior=exterior?[...exterior.occupancy.filter(([p,filled])=>Number(value(p)!==background)!==filled).map(([p])=>p),...exterior.rimColors.filter(([p,c])=>value(p)!==c).map(([p])=>p)]:[];
 const missing=report.expectedColors.filter(([p,c])=>value(p)!==c),changedFills=report.expectedFillColors.filter(([p,c])=>value(p)!==c),changedProtected=report.protectedColors.filter(([p,c])=>value(p)!==c);
 let exposedMaterial=[],outsideDeclaredBand=0;if(report.exteriorClosureRequired){
  if(!report.sourceInkEvidence?.executed||!report.background)return {status:'UNVERIFIED',renderedStrokeChecked:false,reason:'Source continuity/exterior assignment did not execute'};
  const actualStroke=new Set([...paths].filter(p=>ink.has(value(p))));for(const p of [...protectedCells,...fill])actualStroke.add(p);
  const solidColors=new Set((report.solidExteriorColors??[]).map(c=>parseInt(c.slice(1)+'ff',16)));for(let p=0;p<w*h;p++)if(solidColors.has(value(p)))actualStroke.add(p);
  const background=parseInt(report.background.slice(1)+'ff',16),declaredBand=new Set(report.sourceBand);
  const reached=[...exteriorOfStroke(w,h,actualStroke,p=>value(p)===background)].filter(p=>value(p)!==background);
  // Closure is mandatory for the source stroke bands, not for unrelated
  // unoutlined material. Keep that unassessed extent visible in the report.
  exposedMaterial=reached.filter(p=>declaredBand.has(p));outsideDeclaredBand=reached.length-exposedMaterial.length;
 }
 const residual=[...scope].filter(p=>!paths.has(p)&&!fill.has(p)&&!protectedCells.has(p)&&ink.has(value(p))),stroke=p=>!fill.has(p)&&!protectedCells.has(p)&&ink.has(value(p));
 const blocks=[];for(let y=0;y<h-1;y++)for(let x=0;x<w-1;x++){const p=y*w+x,a=[p,p+1,p+w,p+w+1];if(a.some(q=>paths.has(q))&&a.every(stroke))blocks.push([x,y]);}
 const failures=changedSourceExterior.length+changedImmutable.length+missing.length+changedFills.length+changedProtected.length+residual.length+blocks.length+exposedMaterial.length+(report.unresolved?.length??1);
 return{status:failures?'FAIL':'PASS',sourceExteriorChecked:Boolean(exterior),changedSourceExteriorPixels:new Set(changedSourceExterior).size,changedImmutablePixels:changedImmutable.length,renderedStrokeChecked:true,exteriorClosureChecked:report.exteriorClosureRequired===true,exposedMaterialPixels:exposedMaterial.length,outsideDeclaredBandPixels:outsideDeclaredBand,missingPathPixels:missing.length,residualBandInk:residual.length,solidRenderedStrokeBlocks:blocks.length,changedFillPixels:changedFills.length,changedProtectedPixels:changedProtected.length,checkedSourcePaths:report.sourcePathCount,checkedBandCells:scope.size,sourceSupportedFillCells:fill.size,locations:{sourceExterior:[...new Set(changedSourceExterior)].map(p=>[p%w,Math.floor(p/w)]),missing:missing.map(([p])=>[p%w,Math.floor(p/w)]),residual:residual.map(p=>[p%w,Math.floor(p/w)]),exposedMaterial:exposedMaterial.map(p=>[p%w,Math.floor(p/w)]),blocks},scope:report.scope};
}
function requireRenderedStrokeAudit(audit){if(audit?.renderedStrokeChecked!==true||audit.status!=='PASS')throw Error('Required actual saved-stroke audit did not pass: '+JSON.stringify(audit));}
module.exports={joint,assertOwnedStrokePolicy,auditRenderedStrokeBands,requireRenderedStrokeAudit};
