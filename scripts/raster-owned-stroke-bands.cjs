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
function joint(PNG,source,base,palette,policy,material,features,sharedLabels){
 assertOwnedStrokePolicy(policy,palette);
 const sw=source.width,sh=source.height,w=base.width,h=base.height,step=sw/w,N=sw*sh,n=w*h;
 if(!Array.isArray(policy.sourceStrokeColors)||!policy.sourceStrokeColors.length)throw Error('Required rendered stroke audit needs explicit source ink colors');
 const entries=palette.map(p=>({...p,v:parseInt(p.hex.slice(1)+'ff',16)})),ink=new Set(policy.sourceStrokeColors.map(c=>parseInt(c.slice(1)+'ff',16))),bg=parseInt(policy.background.slice(1)+'ff',16),bgRGB=entries.find(p=>p.v===bg).rgb;
 const cache=new Map(),nearest=(r,g,b)=>{const key=(r<<16)|(g<<8)|b;if(cache.has(key))return cache.get(key);let best=Infinity,v;for(const p of entries){let d=(r-p.rgb[0])**2+(g-p.rgb[1])**2+(b-p.rgb[2])**2;if(d<best){best=d;v=p.v;}}cache.set(key,v);return v;};
 const adj=(p,W,H,diag=false)=>{const x=p%W,y=Math.floor(p/W),a=[];for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if((dx||dy)&&(diag||!dx||!dy)&&x+dx>=0&&x+dx<W&&y+dy>=0&&y+dy<H)a.push((y+dy)*W+x+dx);return a;};
 const protectedSource=p=>features.mask[p]||(policy.protectedSourceRegions??[]).some(([x,y,a,b])=>p%sw>=x&&p%sw<x+a&&Math.floor(p/sw)>=y&&Math.floor(p/sw)<y+b);
 const locked=new Set([...features.cells,...(material?.interior.keys()??[])]);for(let p=0;p<n;p++){const x=p%w,y=Math.floor(p/w);if((policy.protectedSourceRegions??[]).some(([a,b,c,d])=>x*step<a+c&&(x+1)*step>a&&y*step<b+d&&(y+1)*step>b))locked.add(p);}
 const segmented=sharedLabels;if(!segmented||segmented.width!==sw||segmented.height!==sh)throw Error('Color planes and strokes must share the same source labels');
 const colors=new Uint32Array(N),strokePigment=new Uint32Array(N),fg=new Uint8Array(N),mask=new Set(),dist=(a,b)=>a.reduce((s,v,i)=>s+(v-b[i])**2,0);
 for(let p=0;p<N;p++){const k=p*4,rgb=[source.data[k],source.data[k+1],source.data[k+2]];colors[p]=segmented.data.readUInt32BE(k);const owner=material?.owners[p]??-1;fg[p]=Number(source.data[k+3]>=128&&(bgRGB.some((c,i)=>Math.abs(source.data[k+i]-c)>policy.backgroundTolerance)||(owner>=0&&material.plan.regions[owner].material!=='background')));if(protectedSource(p))continue;for(const role of policy.sourceInkRoles??[])if((!role.sourceRect||(p%sw>=role.sourceRect[0]&&p%sw<role.sourceRect[0]+role.sourceRect[2]&&Math.floor(p/sw)>=role.sourceRect[1]&&Math.floor(p/sw)<role.sourceRect[1]+role.sourceRect[3]))&&(role.paletteColors??[role.color]).some(c=>parseInt(c.slice(1)+'ff',16)===colors[p]))strokePigment[p]=parseInt(role.color.slice(1)+'ff',16);if(strokePigment[p])mask.add(p);}
 const sourceInkEvidence=require('./source-ink-evidence.cjs').reconcileSourceInk(source,mask,strokePigment,step,protectedSource);
 // Recover source-label connectivity before medial tracing. Only a short
 // subcell interval with observed raw ink/antialias support may join two
 // distinct same-pigment components; no background or flat material bridge.
 const component=new Int32Array(N).fill(-1);let componentId=0;
 for(const start of mask)if(component[start]<0){const q=[start];component[start]=componentId;for(let i=0;i<q.length;i++)for(const p of adj(q[i],sw,sh,true))if(mask.has(p)&&component[p]<0&&strokePigment[p]===strokePigment[start]){component[p]=componentId;q.push(p);}componentId++;}
 const roleEntries=new Map(policy.sourceInkRoles.map(r=>[parseInt(r.color.slice(1)+'ff',16),entries.filter(e=>(r.paletteColors??[r.color]).includes(e.hex))])),allInk=new Set([...roleEntries.values()].flat().map(e=>e.v)),fills=entries.filter(e=>!allInk.has(e.v));
 const supportCache=new Map();const supported=(p,pigment)=>{if(protectedSource(p))return false;const k=p*4,rgb=[source.data[k],source.data[k+1],source.data[k+2]],key=rgb.join(',')+':'+pigment;if(supportCache.has(key))return supportCache.get(key);const localInk=roleEntries.get(pigment),v=nearest(...rgb);let ok=localInk.some(e=>e.v===v);
   if(!ok&&Math.min(...fills.map(e=>Math.sqrt(dist(rgb,e.rgb))))>12)for(const a of localInk)for(const b of fills){const dv=a.rgb.map((c,i)=>c-b.rgb[i]),den=dv.reduce((s,c)=>s+c*c,0),t=rgb.reduce((s,c,i)=>s+(c-b.rgb[i])*dv[i],0)/(den||1);if(t>=.2&&t<=.85&&Math.sqrt(rgb.reduce((s,c,i)=>s+(c-b.rgb[i]-t*dv[i])**2,0))<=14)ok=true;}
   supportCache.set(key,ok);return ok;};
 const candidates=new Map(),radius=Math.max(2,Math.floor(step));
 for(const p of mask){if(adj(p,sw,sh,true).every(q=>mask.has(q)))continue;const x=p%sw,y=Math.floor(p/sw);for(let dy=-radius;dy<=radius;dy++)for(let dx=-radius;dx<=radius;dx++){
   const xx=x+dx,yy=y+dy,q=yy*sw+xx;if(xx<0||yy<0||xx>=sw||yy>=sh||q<=p||!mask.has(q)||component[p]===component[q]||strokePigment[p]!==strokePigment[q]||dx*dx+dy*dy>radius*radius)continue;
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
 const explicitStroke=new Set((policy.sourceInkRoles??[]).filter(r=>r.kind==='stroke').map(r=>parseInt(r.color.slice(1)+'ff',16)));
 const narrow=new Set(),filledBranches=[];for(const branch of traceStrokePaths(skeleton,sw,sh,p=>[p%sw+.5,Math.floor(p/sw)+.5],1,0)){const points=new Set();for(let i=1;i<branch.length;i++)for(const[x,y]of rasterPath(branch[i-1],branch[i],false))points.add(y*sw+x);const radius=Math.max(...[...points].map(p=>depth[p]));if([...points].some(p=>!explicitStroke.has(strokePigment[p])&&depth[p]>step*2)){filledBranches.push({radius,sourcePoints:[...points]});continue;}for(const p of points)narrow.add(p);}const sourceBand=new Set([...mask].filter(p=>narrow.has(owner[p])));
 const rawPaths=traceStrokePaths(narrow,sw,sh,p=>[(p%sw+.5)/step,(Math.floor(p/sw)+.5)/step],1/step,.35);
 const flowTools=policy.curveFlow?require('./source-curve-flow.cjs'):null;
 // Protect gaps in the actual jointly assigned baseline, not only in the
 // pre-line area sampler. The final comparison below uses this same baseline.
 const curveReference=flowTools?joint(PNG,source,base,palette,{...policy,curveFlow:null},material,features,sharedLabels).image:null;
 const curveGuards=flowTools?new Set([...flowTools.enclosedBackgroundGuards(base,bg),...flowTools.enclosedBackgroundGuards(curveReference,bg)]):null;
 const curveFlow=flowTools?flowTools.layoutCurveFlow(rawPaths,w,h,locked,policy.curveFlow,curveGuards):null;
 const paths=curveFlow?.paths??rawPaths;let cells=new Set();for(const line of paths)for(let i=1;i<line.length;i++)for(const[x,y]of rasterPath(line[i-1],line[i],false))if(x>=0&&y>=0&&x<w&&y<h&&!locked.has(y*w+x))cells.add(y*w+x);
 cells=new Set(thinMask(cells,w));cells=coalesceStrokeJunctions(cells,paths,w,h,new Set()).cells;
 const componentCount=(set,foreground)=>{const pending=new Set();for(let p=0;p<n;p++)if(set.has(p)===foreground)pending.add(p);let count=0;while(pending.size){count++;const queue=[pending.values().next().value];pending.delete(queue[0]);for(let i=0;i<queue.length;i++)for(const r of adj(queue[i],w,h,foreground))if(pending.delete(r))queue.push(r);}return count;};
 const topology=[componentCount(cells,true),componentCount(cells,false)],junctionContractions=[];
 let originalCurveCells=null;
 if(curveFlow){
  let baseline=new Set();for(const line of rawPaths)for(let i=1;i<line.length;i++)for(const[x,y]of rasterPath(line[i-1],line[i],false))if(x>=0&&y>=0&&x<w&&y<h&&!locked.has(y*w+x))baseline.add(y*w+x);
  baseline=coalesceStrokeJunctions(new Set(thinMask(baseline,w)),rawPaths,w,h,new Set()).cells;
  originalCurveCells=baseline;
  const originalTopology=[componentCount(baseline,true),componentCount(baseline,false)];
  if(JSON.stringify(originalTopology)!==JSON.stringify(topology))throw Error('Curve layout changed final stroke connectivity or gaps');
  curveFlow.report.finalTopology={before:originalTopology,after:topology,unchanged:true};
 }
 for(const p of [...cells]){if(p%w+1>=w||p+w+1>=n)continue;const block=[p,p+1,p+w,p+w+1];if(!block.every(q=>cells.has(q)))continue;const candidates=block.map(q=>{const x=(q%w+.5)*step,y=(Math.floor(q/w)+.5)*step;let distance=Infinity;for(let yy=Math.max(0,Math.floor(y-step));yy<Math.min(sh,y+step);yy++)for(let xx=Math.max(0,Math.floor(x-step));xx<Math.min(sw,x+step);xx++)if(narrow.has(yy*sw+xx))distance=Math.min(distance,(xx-x)**2+(yy-y)**2);return{q,distance};}).sort((a,b)=>b.distance-a.distance||a.q-b.q);for(const{q}of candidates){const trial=new Set(cells);trial.delete(q);if(componentCount(trial,true)===topology[0]&&componentCount(trial,false)===topology[1]){cells=trial;junctionContractions.push(q);break;}}}
 // Native scope is the complete projected source band, not a partial
 // neighbourhood of newly allocated dots. This includes old residual ink.
 const band=new Set();for(const p of sourceBand)band.add(Math.floor(Math.floor(p/sw)/step)*w+Math.floor(p%sw/step));for(const p of cells)band.add(p);
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
 const fillOwner=new Int32Array(N).fill(-1),fillQ=[];for(let p=0;p<N;p++)if(fg[p]&&!sourceBand.has(p)){fillOwner[p]=p;fillQ.push(p);}for(let i=0;i<fillQ.length;i++)for(const r of adj(fillQ[i],sw,sh))if(fg[r]&&fillOwner[r]<0){fillOwner[r]=fillOwner[fillQ[i]];fillQ.push(r);}
 const plainOwner=new Int32Array(N).fill(-1),plainQ=[];for(let p=0;p<N;p++)if(fg[p]&&!mask.has(p)&&!ink.has(colors[p])){plainOwner[p]=p;plainQ.push(p);}for(let i=0;i<plainQ.length;i++)for(const r of adj(plainQ[i],sw,sh))if(fg[r]&&plainOwner[r]<0){plainOwner[r]=plainOwner[plainQ[i]];plainQ.push(r);}
 const occupied=new Uint8Array(n),outside=new Uint8Array(n),oq=[],filledMaterialCells=[];
 for(let p=0;p<n;p++){const x=p%w,y=Math.floor(p/w);let solid=0,bgs=0,broad=0,narrowArea=0,sourceClosedBackground=0;for(let yy=y*step;yy<(y+1)*step;yy++)for(let xx=x*step;xx<(x+1)*step;xx++){const r=yy*sw+xx;if(fg[r]&&!sourceBand.has(r))solid++;if(mask.has(r)&&!sourceBand.has(r))broad++;if(sourceBand.has(r))narrowArea++;if(!fg[r]){bgs++;if(!sourceExterior[r])sourceClosedBackground++;}}if(broad>step*step*.5||(broad>0&&narrowArea===0))filledMaterialCells.push(p);occupied[p]=Number((solid>=step*step*.5&&!curveSweep.has(p))||locked.has(p));if(!cells.has(p)&&!occupied[p]&&bgs>=step*step*.75&&(!curveSweep.has(p)||sourceClosedBackground>=step*step*.75)){outside[p]=1;oq.push(p);}}
 for(let i=0;i<oq.length;i++)for(const r of adj(oq[i],w,h))if(!outside[r]&&!cells.has(r)&&!occupied[r]){outside[r]=1;oq.push(r);}
 // A closed outer stroke owns its exterior too. Antialias colors that had
 // been classified as material cannot leave specks outside the rebuilt rim.
 // Declared silhouette colors without a narrow-stroke role are solid
 // material boundaries (e.g. dark hair), not absent line ownership.
 const rolePalette=new Set(policy.sourceInkRoles.flatMap(r=>r.paletteColors??[r.color]));
 const solidExteriorColors=(policy.colors??[]).filter(c=>!rolePalette.has(c));
 const solidExteriorValues=new Set(solidExteriorColors.map(c=>parseInt(c.slice(1)+'ff',16)));
 const solidExteriorCells=[];for(let p=0;p<n;p++)if(solidExteriorValues.has(base.data.readUInt32BE(p*4)))solidExteriorCells.push(p);
 const lineExterior=exteriorOfStroke(w,h,new Set([...cells,...locked,...filledMaterialCells,...solidExteriorCells]),p=>base.data.readUInt32BE(p*4)===bg),bandHalo=new Set(band);
 for(const p of band)for(const q of adj(p,w,h,true))bandHalo.add(q);
 const exteriorFringe=[];for(const p of lineExterior)if(bandHalo.has(p)&&!locked.has(p)){outside[p]=1;if(base.data.readUInt32BE(p*4)!==bg){band.add(p);exteriorFringe.push(p);}}
 // A displaced curve's interior can only receive foreground material from
 // that same reconstructed region. Raw fringe pixels quantized to background
 // must not win the interior fill vote and make a new pinhole.
 let curveInteriorOwner=null;
 if(curveSweep.size){
  curveInteriorOwner=new Int32Array(N).fill(-1);const q=[];
  const inside=p=>{const cell=Math.floor(Math.floor(p/sw)/step)*w+Math.floor(p%sw/step);return !outside[cell]&&!cells.has(cell);};
  for(let p=0;p<N;p++)if(inside(p)&&fg[p]&&!mask.has(p)&&!ink.has(colors[p])&&colors[p]!==bg){curveInteriorOwner[p]=p;q.push(p);}
  for(let i=0;i<q.length;i++)for(const p of adj(q[i],sw,sh))if(inside(p)&&curveInteriorOwner[p]<0){curveInteriorOwner[p]=curveInteriorOwner[q[i]];q.push(p);}
 }
 const out=new PNG({width:w,height:h});base.data.copy(out.data);const restored=[],unresolved=[];
 const broadFillCells=[];for(const p of band){if(locked.has(p)||cells.has(p))continue;const x=p%w,y=Math.floor(p/w);if(outside[p]){out.data.writeUInt32BE(bg,p*4);continue;}let broadArea=0;for(let yy=y*step;yy<(y+1)*step;yy++)for(let xx=x*step;xx<(x+1)*step;xx++){const r=yy*sw+xx;if(mask.has(r)&&!sourceBand.has(r))broadArea++;}const useBroad=broadArea>step*step*.5;if(useBroad)broadFillCells.push(p);const votes=new Map();for(let yy=y*step;yy<(y+1)*step;yy++)for(let xx=x*step;xx<(x+1)*step;xx++){const r=yy*sw+xx,f=(useBroad?fillOwner:curveSweep.has(p)?curveInteriorOwner:plainOwner)[r];if(f>=0){const c=colors[f];votes.set(c,(votes.get(c)||0)+1);}}const winner=[...votes].sort((a,b)=>b[1]-a[1]||a[0]-b[0])[0]?.[0];if(winner===undefined){unresolved.push(p);continue;}out.data.writeUInt32BE(winner,p*4);restored.push(p);}
 const expected=[];for(const p of cells){const x=p%w,y=Math.floor(p/w),cx=(x+.5)*step,cy=(y+.5)*step;let best=Infinity,color;for(let yy=Math.max(0,Math.floor(cy-step*2));yy<Math.min(sh,cy+step*2);yy++)for(let xx=Math.max(0,Math.floor(cx-step*2));xx<Math.min(sw,cx+step*2);xx++){const r=yy*sw+xx;if(!sourceBand.has(r))continue;const dist=(xx-cx)**2+(yy-cy)**2;if(dist<best){best=dist;color=strokePigment[r];}}if(color===undefined){unresolved.push(p);continue;}out.data.writeUInt32BE(color,p*4);expected.push([p,color]);}
 if(curveFlow){
  const baseline=curveFlow.report.accepted?curveReference:out;
  curveFlow.report.background=policy.background;
  curveFlow.report.referenceRegionTopology=flowTools.regionTopologyFingerprint(baseline,bg);
  curveFlow.report.regionTopologyChecked=true;
  if(JSON.stringify(curveFlow.report.referenceRegionTopology)!==JSON.stringify(flowTools.regionTopologyFingerprint(out,bg)))throw Error('Curve layout changed filled-region connectivity or an existing closed gap');
 }
 let residual=0,blocks=0;for(const p of band)if(!locked.has(p)&&!cells.has(p)&&ink.has(out.data.readUInt32BE(p*4)))residual++;for(let y=0;y<h-1;y++)for(let x=0;x<w-1;x++){const p=y*w+x,a=[p,p+1,p+w,p+w+1];if(a.every(v=>cells.has(v)))blocks++;}
 return{image:out,report:{version:1,method:'joint-source-band',sourceInkEvidence,solidExteriorColors,exteriorClosureRequired:true,background:policy.background,exteriorFringe,curveFlowRequired:Boolean(policy.curveFlow),curveFlow:curveFlow?.report??null,colors:policy.sourceStrokeColors,sourceBridges,sourceBandPixels:sourceBand.size,sourceBand:[...band],pathCells:[...cells],expectedColors:expected,expectedFillColors:[...band].filter(p=>!cells.has(p)&&!locked.has(p)).map(p=>[p,out.data.readUInt32BE(p*4)]),protectedColors:[...locked].map(p=>[p,base.data.readUInt32BE(p*4)]),filledMaterialCells,sourcePathCount:paths.length,restored:restored.length,unresolved,residual,blocks,filledBranches,broadFillCells,junctionContractions,topology,sourceWidthLimit:step*2,scope:'Declared whole source stroke bands; broad source fill and locked features retain distinct ownership. Visual source completeness remains a separate review.'}};
}
function assertOwnedStrokePolicy(policy,palette){
 const colors=new Set(palette.map(p=>p.hex)),roles=policy?.sourceInkRoles;
 if(policy?.layout!=='joint-source-band'||policy.width!==1||!Array.isArray(roles)||!roles.length)throw Error('Joint source-band ownership and one-dot width must be declared');
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
 const failures=missing.length+changedFills.length+changedProtected.length+residual.length+blocks.length+exposedMaterial.length+(report.unresolved?.length??1);
 return{status:failures?'FAIL':'PASS',renderedStrokeChecked:true,exteriorClosureChecked:report.exteriorClosureRequired===true,exposedMaterialPixels:exposedMaterial.length,outsideDeclaredBandPixels:outsideDeclaredBand,missingPathPixels:missing.length,residualBandInk:residual.length,solidRenderedStrokeBlocks:blocks.length,changedFillPixels:changedFills.length,changedProtectedPixels:changedProtected.length,checkedSourcePaths:report.sourcePathCount,checkedBandCells:scope.size,sourceSupportedFillCells:fill.size,locations:{missing:missing.map(([p])=>[p%w,Math.floor(p/w)]),residual:residual.map(p=>[p%w,Math.floor(p/w)]),exposedMaterial:exposedMaterial.map(p=>[p%w,Math.floor(p/w)]),blocks},scope:report.scope};
}
function requireRenderedStrokeAudit(audit){if(audit?.renderedStrokeChecked!==true||audit.status!=='PASS')throw Error('Required actual saved-stroke audit did not pass: '+JSON.stringify(audit));}
module.exports={joint,assertOwnedStrokePolicy,auditRenderedStrokeBands,requireRenderedStrokeAudit};
