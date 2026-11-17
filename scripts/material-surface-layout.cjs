'use strict';
// Source-observed surfaces submit their fill and rim together. No destination
// coordinates, character names or post-render painting are accepted here.
function planMaterialSurfaces(source,base,labels,material,features,inkRoles){
 const fills=new Map(),lines=new Map(),domain=new Set(),reservedFill=new Set(),sourceStrokeBand=new Set(),sourceDomain=new Set(),replaceCells=new Set(),reports=[];
 if(!material?.plan.surfaces?.length)return {fills,lines,domain,reservedFill,sourceStrokeBand,sourceDomain,replaceCells,reports};
 const sw=source.width,sh=source.height,w=base.width,h=base.height,step=sw/w;
 const neighbors=(p,W,H)=>{const x=p%W,y=Math.floor(p/W),a=[];if(x)a.push(p-1);if(x+1<W)a.push(p+1);if(y)a.push(p-W);if(y+1<H)a.push(p+W);return a;};
 const protectedCells=new Set(features.cells);
 for(let p=0;p<material.exceptions.length;p++)if(material.exceptions[p])protectedCells.add(Math.floor(p/sw/step)*w+Math.floor(p%sw/step));
 for(const surface of material.plan.surfaces){
  const ink=new Set((inkRoles.find(r=>r.color===surface.contourColor)?.paletteColors??[surface.contourColor]).map(c=>parseInt(c.slice(1)+'ff',16)));
  const members=new Set(material.plan.regions.flatMap((r,i)=>surface.regionIds.includes(r.id)?[i]:[]));
  const mask=new Uint8Array(sw*sh),weights=new Map(),tones=new Map();
  for(let p=0;p<mask.length;p++)if(members.has(material.owners[p])){
   mask[p]=1;const q=Math.floor(p/sw/step)*w+Math.floor(p%sw/step),c=labels.data.readUInt32BE(p*4);
   weights.set(q,(weights.get(q)||0)+1);if(!tones.has(q))tones.set(q,new Map());tones.get(q).set(c,(tones.get(q).get(c)||0)+1);
  }
  // Observation samples may stop at an antialiased edge. Continue only through
  // adjacent source labels in the same material contract; another declared
  // material and protected features are barriers, not convenient fill seeds.
  const region=material.plan.regions[[...members][0]],allowed=new Set(region.colors.map(c=>parseInt(c.slice(1)+'ff',16))),connected=[];
  for(let p=0;p<mask.length;p++)if(mask[p])connected.push(p);
  for(let i=0;i<connected.length;i++)for(const q of neighbors(connected[i],sw,sh))if(!mask[q]&&!features.mask[q]&&!material.sourceExceptions[q]&&material.owners[q]<0&&allowed.has(labels.data.readUInt32BE(q*4))){mask[q]=1;connected.push(q);}
  weights.clear();tones.clear();for(const p of connected){const q=Math.floor(p/sw/step)*w+Math.floor(p%sw/step),c=labels.data.readUInt32BE(p*4);weights.set(q,(weights.get(q)||0)+1);if(!tones.has(q))tones.set(q,new Map());tones.get(q).set(c,(tones.get(q).get(c)||0)+1);}
  const inside=new Set();
  for(const[p,area]of weights){const x=p%w,y=Math.floor(p/w),center=(y*step+Math.floor(step/2))*sw+x*step+Math.floor(step/2);if(area>step*step/2||area===step*step/2&&mask[center])inside.add(p);}
  if(!inside.size)throw Error('Observed surface has no grid capacity: '+surface.id);
  // A broad dark region can contain a required material contact. Its local
  // surface-facing strip is line evidence even when the connected dark branch
  // also contains a wide fill. Do not classify that entire branch as one role.
  const distance=new Int16Array(sw*sh),contactQueue=[];
  const isSourceInk=p=>!material.sourceFills?.[p]&&ink.has(labels.data.readUInt32BE(p*4));
  const offerContact=(p,d)=>{if(distance[p]||features.mask[p]||material.sourceExceptions[p]||!isSourceInk(p))return;distance[p]=d;contactQueue.push(p);};
  for(let p=0;p<mask.length;p++)if(mask[p])for(const q of neighbors(p,sw,sh))if(!mask[q])offerContact(q,1);
  for(let i=0;i<contactQueue.length;i++){const p=contactQueue[i];sourceDomain.add(p);if(distance[p]<=step)sourceStrokeBand.add(p);if(distance[p]<step*2)for(const q of neighbors(p,sw,sh))offerContact(q,distance[p]+1);}
  const rim=new Set();
  for(const p of inside)for(const q of neighbors(p,w,h))if(!inside.has(q)&&!protectedCells.has(q)){
   const x=q%w,y=Math.floor(q/w);let count=0;
   for(let yy=y*step;yy<(y+1)*step;yy++)for(let xx=x*step;xx<(x+1)*step;xx++)if(isSourceInk(yy*sw+xx))count++;
   if(count)rim.add(q);
  }
  // The surface owns a single native contact perimeter. Replace, rather than
  // overlay, the old medial ink path in the same observed contact domain.
  for(const p of contactQueue)replaceCells.add(Math.floor(p/sw/step)*w+Math.floor(p%sw/step));
  for(const p of inside)replaceCells.add(p);
  const contour=require('./refine-structure.cjs').thinMask(rim,w);
  for(const p of contour){lines.set(p,surface.contourColor);replaceCells.add(p);domain.add(p);}
  // Thinning a concave corner transfers its vacated cell to the connected
  // surface side. It must not become an unrelated material-colored pinhole.
  const surfaceQueue=[...inside];
  for(let i=0;i<surfaceQueue.length;i++)for(const q of neighbors(surfaceQueue[i],w,h))if(rim.has(q)&&!contour.has(q)&&!inside.has(q)){
   inside.add(q);surfaceQueue.push(q);tones.set(q,tones.get(surfaceQueue[i]));replaceCells.add(q);
  }
  for(const p of inside){if(protectedCells.has(p))continue;const counts=tones.get(p),chosen=[...counts].sort((a,b)=>b[1]-a[1]||a[0]-b[0])[0][0];fills.set(p,chosen);domain.add(p);if(weights.get(p)===step*step)reservedFill.add(p);}
  // Nearby source ink stays in the coupled layout domain. Its opposite side
  // is assigned by the shared region planner, never a separate color flood.
  const vicinity=new Set([...inside,...rim]);for(const p of rim)for(const q of neighbors(p,w,h))vicinity.add(q);
  let vacated=0;
  for(const p of vicinity){if(inside.has(p)||protectedCells.has(p))continue;const x=p%w,y=Math.floor(p/w);let oldInk=0;
   for(let yy=y*step;yy<(y+1)*step;yy++)for(let xx=x*step;xx<(x+1)*step;xx++)if(isSourceInk(yy*sw+xx))oldInk++;
   if(!oldInk)continue;domain.add(p);vacated++;
  }
  reports.push({id:surface.id,colors:region.colors,contourColor:surface.contourColor,sourcePixels:mask.reduce((a,b)=>a+b,0),fillCells:[...inside].filter(p=>!protectedCells.has(p)),boundaryCandidates:[...rim],pathCells:[...contour],vacatedCells:vacated,contour:'joint-surface-perimeter'});
 }
 for(const p of lines.keys())if(fills.has(p))throw Error('Observed surfaces compete for the same line/fill cell');
 return {fills,lines,domain,reservedFill,sourceStrokeBand,sourceDomain,replaceCells,reports};
}
function auditMaterialSurfaces(image,reports){
 const surfaces=reports.map(s=>{
  const colors=new Set(s.colors.map(c=>parseInt(c.slice(1)+'ff',16))),ink=parseInt(s.contourColor.slice(1)+'ff',16);
  return {id:s.id,missingBoundary:s.pathCells.filter(p=>image.data.readUInt32BE(p*4)!==ink),lostSurface:s.fillCells.filter(p=>!colors.has(image.data.readUInt32BE(p*4)))};
 });
 return {status:surfaces.some(s=>s.missingBoundary.length||s.lostSurface.length)?'FAIL':surfaces.length?'PASS':'NOT_APPLICABLE',surfaces,scope:'Source-observed surface/perimeter obligations; not automatic visual or anatomical approval.'};
}
module.exports={planMaterialSurfaces,auditMaterialSurfaces};
