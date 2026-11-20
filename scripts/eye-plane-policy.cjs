'use strict';
// Shared production rule. Source annotations are observations, never output dots.
// Production uses observed source partitions before family/tone cell assignment.
// Legacy color canonicalization remains available for replay of older inputs.
const EYE_PROMPT='Visible eyes must retain the observed lid, iris, pupil and sclera spatial relationships. Separate source ownership before assigning colors: dark iris pigment is not automatically eyelid ink. One fixed color per observed role; distinct iris shading may have its own role in the same iris family. No gradients, dithering or blended edges. Preserve gaze, tilt and eye contour. Preserve source highlights only where they fit without erasing pupil/iris or breaking the lid; a source highlight connected to sclera may remain connected. Otherwise record the limitation. Do not invent human sclera for dot eyes or mechanical lenses.';
const hex=c=>'#'+c.toString(16).padStart(8,'0').slice(0,6).toUpperCase();
const rgba=c=>parseInt(c.slice(1)+'ff',16);
// Source and native rings each own an interior. Ink removed by one-dot
// allocation must be filled from that side, not from exterior face samples
// that happen to share the same output cell.
function enclosedStrokeCells(mask,width){
 const points=[...mask],xs=points.map(p=>p%width),ys=points.map(p=>Math.floor(p/width));
 const x0=Math.min(...xs)-1,x1=Math.max(...xs)+1,y0=Math.min(...ys)-1,y1=Math.max(...ys)+1,outside=new Set(),queue=[];
 const offer=(x,y)=>{const p=y*width+x;if(x<x0||x>x1||y<y0||y>y1||mask.has(p)||outside.has(p))return;outside.add(p);queue.push(p);};
 for(let x=x0;x<=x1;x++){offer(x,y0);offer(x,y1);}for(let y=y0;y<=y1;y++){offer(x0,y);offer(x1,y);}
 for(let i=0;i<queue.length;i++){const x=queue[i]%width,y=Math.floor(queue[i]/width);offer(x-1,y);offer(x+1,y);offer(x,y-1);offer(x,y+1);}
 const inside=new Set();for(let y=y0+1;y<y1;y++)for(let x=x0+1;x<x1;x++){const p=y*width+x;if(!mask.has(p)&&!outside.has(p))inside.add(p);}return inside;
}
// The rectangle is a search window, not anatomical ownership. A reviewed
// source polygon excludes neighbouring hair/skin even inside that window.
function inSourcePolygon(x,y,polygon){
 let hit=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
  const [a,b]=polygon[i],[c,d]=polygon[j];if((b>y)!==(d>y)&&x<(c-a)*(y-b)/(d-b)+a)hit=!hit;
 }return hit;
}
function eyeOwnsSource(e,x,y){const[a,b,w,h]=e.rect;return x>=a&&x<a+w&&y>=b&&y<b+h&&(!e.sourcePolygon||inSourcePolygon(x,y,e.sourcePolygon));}
function eyeOwnership(source,policy,width,height){
 const mask=new Uint8Array(source.width*source.height),cells=new Set(),sx=source.width/width,sy=source.height/height;
 for(const e of policy?.eyes??[]){const[a,b,w,h]=e.rect;for(let y=Math.max(0,Math.floor(b));y<Math.min(source.height,b+h);y++)for(let x=Math.max(0,Math.floor(a));x<Math.min(source.width,a+w);x++)if(eyeOwnsSource(e,x+.5,y+.5)){mask[y*source.width+x]=1;cells.add(Math.floor(y/sy)*width+Math.floor(x/sx));}}
 return {mask,cells};
}
function assertEyePolicy(policy,palette){
 if(policy?.version!==1||!['visible','not-visible'].includes(policy.visibility)||typeof policy.observation!=='string'||!policy.observation.trim())throw Error('Explicit observed eyePolicy required');
 if(policy.placement!==undefined&&policy.placement!=='source-partitions')throw Error('Unsupported eye placement mode');
 if(policy.geometryPolicy!==undefined&&policy.geometryPolicy!=='source-stroke-fill')throw Error('Unsupported eye geometry policy');
 if(policy.geometryPolicy&&policy.placement!=='source-partitions')throw Error('Eye geometry requires source partitions');
 if(policy.visibility==='not-visible'){
  if(policy.eyes?.length)throw Error('Hidden eyes cannot have correction regions');return policy;
 }
 if(!Array.isArray(policy.eyes)||!policy.eyes.length)throw Error('Visible eyes require observed source regions and role colors');
 const allowed=new Set(palette.map(c=>c.hex));
 for(const e of policy.eyes){
  if(!e.name||!Array.isArray(e.rect)||e.rect.length!==4||!e.rect.every(Number.isFinite)||e.rect[0]<0||e.rect[1]<0||e.rect[2]<=0||e.rect[3]<=0)throw Error('Invalid eye source region');
  if(!['off','if-room'].includes(e.reflection))throw Error('Explicit reflection capacity policy required');
  if(e.sourcePolygon&&(!Array.isArray(e.sourcePolygon)||e.sourcePolygon.length<3||e.sourcePolygon.some(p=>!Array.isArray(p)||p.length!==2||!p.every(Number.isFinite)||p[0]<e.rect[0]||p[0]>e.rect[0]+e.rect[2]||p[1]<e.rect[1]||p[1]>e.rect[1]+e.rect[3])))throw Error('Eye ownership polygon must be observed inside its source window');
  const seen=new Set();
  if(!Array.isArray(e.roles)||!e.roles.length)throw Error('Observed eye roles required');
  for(const r of e.roles){
   if(policy.geometryPolicy&&(!['stroke','fill','feature'].includes(r.geometry)||(r.geometry==='stroke'&&r.width!==1)))throw Error('Explicit eye stroke/fill/feature geometry and one-dot stroke width required');
   if(r.closed!==undefined&&(r.geometry!=='stroke'||typeof r.closed!=='boolean'))throw Error('Only observed stroke geometry may declare a closed loop');
   if(r.thickness!==undefined&&(!['source','one-dot'].includes(r.thickness)||r.geometry!=='stroke'||r.closed===true))throw Error('Eye stroke thickness is "source" or "one-dot" on an open observed stroke');
   if(r.anchor!==undefined&&(r.anchor!=='interior'||r.closed!==true||!r.interiorRoles?.length))throw Error('Eye interior anchor requires a closed stroke with observed interior roles');
   if(!policy.geometryPolicy&&r.geometry!==undefined)throw Error('Eye geometry annotation cannot be silently ignored');
   if(r.shape!==undefined&&(!['source-oval','source-family-oval'].includes(r.shape)||r.geometry!=='fill'||r.protect!==true||policy.geometryPolicy!=='source-stroke-fill'))throw Error('Observed oval shape requires a protected source fill');
   if(!r.name||!allowed.has(r.color)||!r.colors?.length||!r.colors.includes(r.color)||r.colors.some(c=>!allowed.has(c)||(policy.placement!=='source-partitions'&&seen.has(c))))throw Error('Eye role colors must be unambiguous fixed palette entries');
   r.colors.forEach(c=>seen.add(c));
   if(!r.samples?.length||r.samples.some(a=>!Array.isArray(a)||a.length!==3||a.some(v=>!Number.isFinite(v)||v<0||v>255)))throw Error('Observed source RGB samples required');
   if(r.verifySampleOwnership!==undefined&&(typeof r.verifySampleOwnership!=='boolean'||policy.placement!=='source-partitions'||r.verifySampleOwnership&&(!r.samplePoints?.length||r.samplePoints.length!==r.samples.length)))throw Error('Semantic eye samples require source partitions and matching sample points');
  }
  if(policy.placement==='source-partitions'){
   const names=new Set(e.roles.map(r=>r.name)),validPolygon=p=>Array.isArray(p)&&p.length>=3&&p.every(v=>Array.isArray(v)&&v.length===2&&v.every(Number.isFinite)&&v[0]>=e.rect[0]&&v[0]<=e.rect[0]+e.rect[2]&&v[1]>=e.rect[1]&&v[1]<=e.rect[1]+e.rect[3]);
   for(const r of e.roles)if(r.attachedFill){const a=r.attachedFill,target=e.roles.find(v=>v.name===a.role);if(Object.keys(a).some(k=>!['role','sourcePolygon','observation'].includes(k))||r.anchor!=='interior'||!a.observation?.trim()||!validPolygon(a.sourcePolygon)||target?.geometry!=='fill'||target.color!==r.color||target.family===r.family)throw Error('Attached source mark requires an observed same-pigment fill and interior-anchored ring');}
   for(const r of e.roles)if(r.interiorRoles!==undefined&&(!r.closed||!Array.isArray(r.interiorRoles)||!r.interiorRoles.length||r.interiorRoles.some(name=>!e.roles.some(v=>v.name===name&&v.geometry!=='stroke'))))throw Error('Closed eye interior must name observed non-stroke roles');
   if(e.contextRoles!==undefined&&(!Array.isArray(e.contextRoles)||!e.contextRoles.length||e.contextRoles.some(name=>!e.baseRoles?.includes(name)||!e.roles.some(r=>r.name===name&&r.geometry==='fill'&&!r.protect))))throw Error('Eye context roles must be observed unprotected base fills');
   if(!e.sourcePolygon||names.size!==e.roles.length||e.roles.some(r=>!r.family||r.family==='source-context'))throw Error('Source eye placement requires ownership, unique roles and role families');
   if(!Array.isArray(e.baseRoles)||!e.baseRoles.length||e.baseRoles.some(r=>!names.has(r))||!e.partitions?.length)throw Error('Observed base roles and source partitions required');
   for(const p of e.partitions)if(!p.name||!p.observation?.trim()||!validPolygon(p.sourcePolygon)||!p.roles?.length||p.roles.some(r=>!names.has(r)))throw Error('Invalid observed eye partition');
   const used=new Set([...e.baseRoles,...e.partitions.flatMap(p=>p.roles)]);if(used.size!==names.size)throw Error('Unused eye role in source partition plan');
  }
 }
 return policy;
}
function affineEyeGrid(source,native,fit){
 return {x:Array.from({length:native.width},(_,x)=>[(x-fit.offsetX)*source.width/fit.fitWidth,(x+1-fit.offsetX)*source.width/fit.fitWidth]),
 y:Array.from({length:native.height},(_,y)=>[(y-fit.offsetY)*source.height/fit.fitHeight,(y+1-fit.offsetY)*source.height/fit.fitHeight])};
}
function applyEyePolicy(PNG,source,baseline,palette,policy,grid,material=null){
 assertEyePolicy(policy,palette);
 const image=new PNG({width:baseline.width,height:baseline.height});baseline.data.copy(image.data);
 if(policy.visibility==='not-visible')return {image,report:{status:'NOT_APPLICABLE',observation:policy.observation,changed:0,eyes:[]}};
 if(grid?.x?.length!==baseline.width||grid?.y?.length!==baseline.height)throw Error('Eye/source grid mismatch');
 for(const axis of ['x','y'])if(grid[axis].some(v=>v.length!==2||!v.every(Number.isFinite)||v[1]<=v[0]))throw Error('Invalid eye grid');
 if(policy.placement==='source-partitions')return placeSourceEyePartitions(PNG,source,baseline,palette,policy,grid,material);
 const dist=(a,b)=>a.reduce((s,v,i)=>s+(v-b[i])**2,0),reports=[],claimed=new Set();
 for(const e of policy.eyes){
  const [rx,ry,rw,rh]=e.rect;if(rx+rw>source.width||ry+rh>source.height)throw Error('Eye region outside source');
  const aliases=new Map();e.roles.forEach((r,i)=>r.colors.forEach(c=>aliases.set(c,i)));
  const cells=[],sourceLabels=new Map(),cellAt=new Map();
  for(let y=0;y<baseline.height;y++)for(let x=0;x<baseline.width;x++){
   const [a,b]=grid.x[x],[c,d]=grid.y[y];if(a>=rx+rw||b<=rx||c>=ry+rh||d<=ry)continue;
   const p=y*baseline.width+x,counts=e.roles.map(()=>0);let total=0;
   for(let sy=Math.max(0,Math.ceil(c),Math.ceil(ry));sy<Math.min(source.height,d,ry+rh);sy++)for(let sx=Math.max(0,Math.ceil(a),Math.ceil(rx));sx<Math.min(source.width,b,rx+rw);sx++){
    if(!eyeOwnsSource(e,sx+.5,sy+.5))continue;
    const q=sy*source.width+sx,rgb=[...source.data.subarray(q*4,q*4+3)];
    const scores=e.roles.map(r=>Math.min(...r.samples.map(s=>dist(s,rgb))));
    const role=scores.indexOf(Math.min(...scores));counts[role]++;total++;sourceLabels.set(q,role);cellAt.set(q,p);
   }
   if(!total)continue;
   const old=hex(baseline.data.readUInt32BE(p*4)),role=aliases.get(old);
   if(role===undefined||counts[role]/total<.1)continue;
   if(claimed.has(p))throw Error('Overlapping eye policies');claimed.add(p);
   image.data.writeUInt32BE(rgba(e.roles[role].color),p*4);
   cells.push({p,role,counts,total});
  }
  const domain=new Set(cells.map(c=>c.p)),around=p=>[p-1,p+1,p-baseline.width,p+baseline.width];
  const light=e.roles.findIndex(r=>r.name==='light'),decisions=[];
  if(light>=0&&e.reflection==='if-room'){
   const visited=new Set();
   for(const [p,r] of sourceLabels){
    if(r!==light||visited.has(p))continue;
    const part=[p];visited.add(p);
    for(let i=0;i<part.length;i++)for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
     const q=part[i]+dy*source.width+dx;if(sourceLabels.get(q)===light&&!visited.has(q)){visited.add(q);part.push(q);}
    }
    const overlaps=new Map();for(const q of part){const c=cellAt.get(q);overlaps.set(c,(overlaps.get(c)||0)+1);}
    const candidates=[...overlaps].sort((a,b)=>b[1]-a[1]||a[0]-b[0]);
    const best=candidates[0][0],area=(grid.x[best%baseline.width][1]-grid.x[best%baseline.width][0])*(grid.y[Math.floor(best/baseline.width)][1]-grid.y[Math.floor(best/baseline.width)][0]);
    // A reflection may span more than one cell in the source. The old subcell
    // filter silently discarded those after their pale color became lens color.
    // Still exclude sclera/background bands touching the observed window.
    const touchesEdge=part.some(q=>q%source.width<=rx||q%source.width>=rx+rw-1||Math.floor(q/source.width)<=ry||Math.floor(q/source.width)>=ry+rh-1);
    if(part.length>area*4||part.length<3||touchesEdge)continue;
    const set=new Set(part),ring=new Set();for(const q of part)for(const n of [q-1,q+1,q-source.width,q+source.width])if(sourceLabels.has(n)&&!set.has(n))ring.add(n);
    if(!ring.size||[...ring].filter(q=>sourceLabels.get(q)!==light).length/ring.size<.75)continue;
    const lc=rgba(e.roles[light].color);
    if(candidates.some(([c])=>image.data.readUInt32BE(c*4)===lc)){decisions.push({reason:'already-represented',sourceArea:part.length});continue;}
    let chosen=null;
    for(const [c] of candidates){
     if(!domain.has(c)||around(c).some(q=>!domain.has(q)||image.data.readUInt32BE(q*4)===lc))continue;
     const old=image.data.readUInt32BE(c*4),remaining=cells.filter(v=>v.p!==c&&image.data.readUInt32BE(v.p*4)===old).length;
     if(remaining<2)continue;
     image.data.writeUInt32BE(lc,c*4);chosen=c;break;
    }
    decisions.push({reason:chosen===null?'omitted-no-interior-room':'source-highlight-restored',sourceArea:part.length,cell:chosen===null?null:[chosen%baseline.width,Math.floor(chosen/baseline.width)]});
   }
  }
  reports.push({name:e.name,cells:cells.map(c=>c.p),roles:e.roles.map(r=>({name:r.name,color:r.color})),reflection:decisions});
 }
 let changed=0;for(let p=0;p<baseline.width*baseline.height;p++)if(image.data.readUInt32BE(p*4)!==baseline.data.readUInt32BE(p*4))changed++;
 return {image,report:{status:'AWAITING_SAVED_VISUAL_REVIEW',changed,eyes:reports,rule:'flat-eye-planes/no-gradients',limitation:'Source observations are required. Flat color roles and safe highlight capacity do not certify gaze or expression.'}};
}
// Partition ownership precedes color classification. A dark iris sample is
// not an eyelid merely because both quantize to the same dark output color.
// Families compete for a cell as shapes; their individual tones do not split
// that shape's vote. No global area quota moves a pupil to another location.
function placeObservedOvals(image,source,grid,roles,labels,overlaps,nativeRoles,nativeFamilies,strokeClaims){
 const reports=[];
 const ordered=roles.map((_,r)=>r).filter(r=>roles[r].shape).sort((a,b)=>Number(roles[b].shape==='source-family-oval')-Number(roles[a].shape==='source-family-oval'));
 for(const r of ordered){
  const familyShape=roles[r].shape==='source-family-oval',belongs=role=>familyShape?roles[role]?.family===roles[r].family:role===r;
  let points=[...labels].filter(([,role])=>belongs(role)).map(([q])=>q);
  if(!points.length)throw Error('Observed oval source fill absent');
  // An antialias speck of the same pigment elsewhere in the partition (one
  // dark pixel at the lid edge) is not part of the observed shape. As for
  // strokes, pieces under a quarter cell are set aside when a larger body
  // exists; a real second piece still blocks as fragmented.
  const quarter=(grid.x[0][1]-grid.x[0][0])*(grid.y[0][1]-grid.y[0][0])/4,pieces=[],left=new Set(points);
  for(const s of points){if(!left.has(s))continue;left.delete(s);const piece=[s];for(let i=0;i<piece.length;i++){const x=piece[i]%source.width,y=Math.floor(piece[i]/source.width);for(const[nx,ny]of [[x-1,y],[x+1,y],[x,y-1],[x,y+1]]){const n=ny*source.width+nx;if(nx>=0&&nx<source.width&&left.delete(n))piece.push(n);}}pieces.push(piece);}
  const ignoredSourceFragments=pieces.length>1&&pieces.some(p=>p.length>=quarter)?pieces.filter(p=>p.length<quarter).map(p=>({pixels:p.length,at:[p[0]%source.width,Math.floor(p[0]/source.width)]})):[];
  if(ignoredSourceFragments.length)points=pieces.filter(p=>p.length>=quarter).flat();
  const xs=points.map(q=>q%source.width),ys=points.map(q=>Math.floor(q/source.width)),minX=Math.min(...xs),minY=Math.min(...ys),maxX=Math.max(...xs)+1,maxY=Math.max(...ys)+1;
  const stepX=grid.x[0][1]-grid.x[0][0],stepY=grid.y[0][1]-grid.y[0][0];
  if(grid.x.some(([a,b])=>Math.abs(b-a-stepX)>1e-6)||grid.y.some(([a,b])=>Math.abs(b-a-stepY)>1e-6))throw Error('Observed oval requires a uniform grid');
  const cx=xs.reduce((a,b)=>a+b+.5,0)/points.length,cy=ys.reduce((a,b)=>a+b+.5,0)/points.length;
  let width=Math.max(1,Math.round((maxX-minX)/stepX)),height=Math.max(1,Math.round((maxY-minY)/stepY));
  if(familyShape){
   // A bounding box overstates a rounded iris. Select the small integer
   // footprint using its actual pigment area as well as its two extents.
   const ex=(maxX-minX)/stepX,ey=(maxY-minY)/stepY,area=points.length/(stepX*stepY),sizes=[];
   for(const w of new Set([Math.max(1,Math.floor(ex)),Math.max(1,Math.ceil(ex))]))for(const h of new Set([Math.max(1,Math.floor(ey)),Math.max(1,Math.ceil(ey))])){
    let n=0;for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(((x+.5-w/2)/(w/2))**2+((y+.5-h/2)/(h/2))**2<=1)n++;
    sizes.push({w,h,cost:Math.abs(n-area)+Math.abs(w-ex)+Math.abs(h-ey)+area*Math.abs(Math.log((w/h)/(ex/ey)))});
   }
   sizes.sort((a,b)=>a.cost-b.cost||a.w*a.h-b.w*b.h);width=sizes[0].w;height=sizes[0].h;
  }
  const remaining=new Set(points),queue=[points[0]];remaining.delete(points[0]);
  for(let i=0;i<queue.length;i++){const q=queue[i],x=q%source.width,y=Math.floor(q/source.width);for(const[nx,ny]of [[x-1,y],[x+1,y],[x,y-1],[x,y+1]]){const n=ny*source.width+nx;if(nx>=0&&nx<source.width&&ny>=0&&ny<source.height&&remaining.delete(n))queue.push(n);}}
  if(remaining.size||points.length/((maxX-minX)*(maxY-minY))<.5)throw Error('Observed oval is fragmented or not a compact fill: '+roles[r].name+' bounds '+[minX,minY,maxX,maxY]+' disconnected '+remaining.size+' source pixels '+points.length);
  const votes=new Map();for(const q of points)for(const[p,weight]of overlaps.get(q)??[])votes.set(p,(votes.get(p)||0)+weight);
  const gx=(cx-grid.x[0][0])/stepX,gy=(cy-grid.y[0][0])/stepY,candidates=[];let nearestBlockedByStroke=false;
  for(let y=Math.floor(gy-height/2)-1;y<=Math.ceil(gy-height/2)+1;y++)for(let x=Math.floor(gx-width/2)-1;x<=Math.ceil(gx-width/2)+1;x++){
   if(x<0||y<0||x+width>image.width||y+height>image.height)continue;
   const dx=Math.abs(x+width/2-gx),dy=Math.abs(y+height/2-gy),nearest=dx<=.51&&dy<=.51;
   if(!nearest&&(!strokeClaims.size||dx>1||dy>1))continue;
   const cells=[];for(let yy=0;yy<height;yy++)for(let xx=0;xx<width;xx++)if(((xx+.5-width/2)/(width/2))**2+((yy+.5-height/2)/(height/2))**2<=1)cells.push((y+yy)*image.width+x+xx);
   if(nearest&&cells.every(p=>votes.has(p))&&cells.some(p=>strokeClaims.has(p)))nearestBlockedByStroke=true;
   if(cells.some(p=>!votes.has(p)||(!familyShape&&nativeFamilies.get(p)!==roles[r].family)||strokeClaims.has(p)||(nativeRoles.get(p)!==r&&(roles[nativeRoles.get(p)]?.protect||roles[nativeRoles.get(p)]?.geometry==='feature')&&!(roles[nativeRoles.get(p)]?.family===roles[r].family&&(familyShape||roles[nativeRoles.get(p)]?.shape==='source-family-oval')))))continue;
   if(familyShape&&roles.some((role,k)=>role.family!==roles[r].family&&role.required!==false&&[...nativeRoles].some(([,v])=>v===k)&&![...nativeRoles].some(([p,v])=>v===k&&!cells.includes(p))))continue;
   const overlap=cells.reduce((sum,p)=>sum+votes.get(p),0),error=cells.length*stepX*stepY+points.length-2*overlap;
   candidates.push({cells,error,centerError:(x+width/2-gx)**2+(y+height/2-gy)**2,nearest});
  }
  // Keep the ordinary nearest-centroid result whenever it fits. If an actual
  // planned eyelid occupies that cell, consider the other source-supported
  // side of the quantization boundary, without enlarging the pupil or moving
  // it outside its own pigment/family. This is not a general translation.
  const feasible=candidates.filter(c=>c.nearest||nearestBlockedByStroke);
  feasible.sort((a,b)=>Number(b.nearest)-Number(a.nearest)||a.error-b.error||a.centerError-b.centerError||a.cells[0]-b.cells[0]);const best=feasible[0];
  if(!best)throw Error('Observed oval cannot fit without invading a feature or shifting its center');
  const selected=new Set(best.cells),cleared=[];
  for(const[p,old]of nativeRoles)if(belongs(old)&&!selected.has(p)){
   const x=p%image.width,y=Math.floor(p/image.width),votes=new Map();for(let sy=Math.floor(grid.y[y][0]);sy<grid.y[y][1];sy++)for(let sx=Math.floor(grid.x[x][0]);sx<grid.x[x][1];sx++){const k=labels.get(sy*source.width+sx);if(roles[k]&&!belongs(k)&&(familyShape?roles[k].family!==roles[r].family:roles[k].family===roles[r].family)&&roles[k].geometry==='fill'&&!roles[k].protect)votes.set(k,(votes.get(k)||0)+1);}
   const replacement=[...votes].sort((a,b)=>b[1]-a[1])[0]?.[0];if(replacement===undefined)throw Error('Oval has no source-supported adjacent fill');image.data.writeUInt32BE(rgba(roles[replacement].color),p*4);nativeRoles.set(p,replacement);nativeFamilies.set(p,roles[replacement].family);cleared.push(p);
  }
  for(const p of best.cells){image.data.writeUInt32BE(rgba(roles[r].color),p*4);nativeRoles.set(p,r);nativeFamilies.set(p,roles[r].family);}
  reports.push({role:roles[r].name,shape:roles[r].shape,sourceBounds:[minX,minY,maxX-minX,maxY-minY],sourceCenter:[cx,cy],nativeExtent:[width,height],cells:best.cells,cleared,sourceSupported:true,centerDisplacementCells:Math.sqrt(best.centerError),placement:best.nearest?'nearest-source-center':'source-supported-beside-stroke',...(ignoredSourceFragments.length?{ignoredSourceFragments}:{})});
 }
 return reports;
}
function placeSourceEyePartitions(PNG,source,baseline,palette,policy,grid,material=null){
 const image=new PNG({width:baseline.width,height:baseline.height});baseline.data.copy(image.data);
 const sourceRoleMap=new PNG({width:source.width,height:source.height});source.data.copy(sourceRoleMap.data);
 const {toLab}=require('./build-palette-native.cjs'),distance=(a,b)=>a.reduce((s,v,i)=>s+(v-b[i])**2,0),paletteLabs=palette.map(p=>toLab(p.rgb));
 const reports=[],claimed=new Set(),contextCache=new Map();
 const observedAttachment=(value,q,roles)=>{
  // A native edge cell can straddle the primary eye polygon and an observed
  // attached mark. Attribute only matching, already assigned source pigment
  // inside its explicit source window; unknown context keeps no exemption.
  const attachment=roles.find(r=>r.attachedFill&&r.color===value.color&&inSourcePolygon(q%source.width+.5,Math.floor(q/source.width)+.5,r.attachedFill.sourcePolygon));
  if(!attachment)return value;const role=roles.findIndex(r=>r.name===attachment.attachedFill.role);
  return {...value,role,family:roles[role].family};
 };
 const contextAt=(q,roles)=>{const owner=material&&!material.sourceExceptions[q]?material.owners[q]:-1;
  const key=material?.sourceLabels||roles.some(r=>r.attachedFill)?q:owner+':'+source.data.readUInt32BE(q*4);if(contextCache.has(key))return contextCache.get(key);const lab=toLab([...source.data.subarray(q*4,q*4+3)]);
  // Outside actual feature ownership, consume the already reviewed material.
  // Reclassifying its raw antialias RGB against eye samples used to turn skin
  // into a hair highlight. An incomplete eye polygon must be corrected at
  // observation time, not silently override a different material here.
  let region=owner>=0?material.plan.regions[owner]:null;
  // Legacy callers may supply broad observation envelopes without compiled
  // source labels. Such an envelope is not a resolved material assignment:
  // retain the observed eye pigment if its sample belongs to another role.
  if(region&&!material.sourceLabels){const observed=roles.reduce((a,b)=>Math.min(...a.labs.map(v=>distance(lab,v)))<=Math.min(...b.labs.map(v=>distance(lab,v)))?a:b);if(observed.family!==region.material)region=null;}
  const allowed=region?new Set(region.colors):null;let k=-1;
  if(allowed&&material.sourceLabels){const assigned='#'+material.sourceLabels.data.subarray(q*4,q*4+3).toString('hex').toUpperCase();if(!allowed.has(assigned))throw Error('Eye context conflicts with assigned material');const result=observedAttachment({color:assigned,family:region.material},q,roles);contextCache.set(key,result);return result;}
  for(let i=0;i<palette.length;i++)if((!allowed||allowed.has(palette[i].hex))&&(k<0||distance(lab,paletteLabs[i])<distance(lab,paletteLabs[k])))k=i;
  if(k<0)throw Error('Eye context has no assigned material color');const result=observedAttachment({color:palette[k].hex,family:region?.material??'source-context'},q,roles);contextCache.set(key,result);return result;};
 for(const eye of policy.eyes){
  contextCache.clear();
  const [rx,ry,rw,rh]=eye.rect;if(rx+rw>source.width||ry+rh>source.height)throw Error('Eye region outside source');
  const roles=eye.roles.map(r=>({...r,labs:r.samples.map(toLab)})),labels=new Map(),sourceCounts=roles.map(()=>0),cache=new Map();let leftToSurround=0;
  // Optional coordinates bind observed context samples to this source and
  // its reviewed material. Stale hair/edge RGB cannot impersonate skin.
  for(const role of roles)if(role.samplePoints){
   if(role.samplePoints.length!==role.samples.length)throw Error('Eye source sample coordinates/count mismatch');
   for(let i=0;i<role.samplePoints.length;i++){
    const pt=role.samplePoints[i];if(!Array.isArray(pt)||pt.length!==2||!pt.every(Number.isInteger)||pt[0]<0||pt[1]<0||pt[0]>=source.width||pt[1]>=source.height)throw Error('Invalid eye sample coordinate');
    const q=pt[1]*source.width+pt[0];if(role.samples[i].some((v,k)=>v!==source.data[q*4+k]))throw Error('Eye source sample changed');
    if(eye.contextRoles?.includes(role.name)&&material?.plan.regions.some(r=>r.material===role.family)){const owner=material.owners[q];if(owner<0||material.plan.regions[owner].material!==role.family)throw Error('Eye context sample has a different material owner');}
   }
  }
  // Colours of the material outside the eye polygon inside its window, kept
  // when they cover at least one cell: the planes a partition may yield to.
  const surround=new Set();if(eye.partitions?.length){const counts=new Map(),cellArea=(grid.x[0][1]-grid.x[0][0])*(grid.y[0][1]-grid.y[0][0]);
   for(let y=Math.floor(ry);y<Math.ceil(ry+rh);y++)for(let x=Math.floor(rx);x<Math.ceil(rx+rw);x++)if(!eyeOwnsSource(eye,x+.5,y+.5)){let c;try{c=contextAt(y*source.width+x,roles).color;}catch{continue;}counts.set(c,(counts.get(c)||0)+1);}
   for(const [c,n] of counts)if(n>=cellArea)surround.add(c);}
  for(let y=Math.floor(ry);y<Math.ceil(ry+rh);y++)for(let x=Math.floor(rx);x<Math.ceil(rx+rw);x++){
   if(!eyeOwnsSource(eye,x+.5,y+.5))continue;
   const parts=eye.partitions.filter(p=>inSourcePolygon(x+.5,y+.5,p.sourcePolygon));if(parts.length>1)throw Error('Overlapping source eye partitions');
   // A source partition distinguishes coincident pigments (pupil/lash), but
   // is not evidence that every antialiased edge sample belongs to its fill.
   // Observed surrounding fills may compete; equal RGB stays with the
   // partition, so white glints and dark pupils keep their intended role.
   const primary=parts[0]?.roles??eye.baseRoles,allowed=[...new Set([...primary,...(eye.contextRoles??[])])],q=y*source.width+x;
   // A partition decides between coincident pigments (pupil vs lid ink); it
   // does not recolour pigment it does not list. The large eye's black outer
   // contour inside an iris partition used to become dark iris (a dark block
   // in the eye corner), and skin inside a generous polygon became sclera.
   // A pixel nearer the colour of the material that surrounds the eye (skin,
   // outline ink: at least one cell of it outside the polygon in the window)
   // than to every partition role keeps that material, unless a partition
   // role paints the same palette colour. An antialias grey between sclera
   // and ink is not surrounding material and stays with the partition.
   let context=null;if(parts.length)try{context=contextAt(q,roles);}catch{context=null;}
   const key=allowed.join('/')+':'+(context?.color??'')+':'+source.data.readUInt32BE(q*4);let role=cache.get(key);
   if(role===undefined){const lab=toLab([...source.data.subarray(q*4,q*4+3)]);let best=Infinity;for(const name of allowed){const r=roles.findIndex(v=>v.name===name),d=Math.min(...roles[r].labs.map(s=>distance(s,lab)));if(d<best){best=d;role=r;}}
    if(context&&surround.has(context.color)&&!allowed.some(name=>roles.find(v=>v.name===name).color===context.color)){const k=palette.findIndex(p=>p.hex===context.color);if(distance(lab,paletteLabs[k])<best)role=null;}
    cache.set(key,role);}
   if(role===null){leftToSurround++;continue;}
   labels.set(q,role);sourceCounts[role]++;sourceRoleMap.data.writeUInt32BE(rgba(roles[role].color),q*4);
  }
  // Explicit semantic witnesses are stronger than ordinary RGB samples.
  // A partition can otherwise exclude its own lid/rim sample and silently
  // recolor that pigment as iris. Outside context samples remain permitted.
  for(let r=0;r<roles.length;r++)if(roles[r].verifySampleOwnership===true)for(const [x,y]of roles[r].samplePoints??[]){
   const actual=labels.get(y*source.width+x);
   if(actual!==r)throw Error('Eye source sample assigned to another role: '+eye.name+'/'+roles[r].name+' at '+x+','+y+' -> '+(roles[actual]?.name??'outside ownership'));
  }
  // A partition that allows a glint but not the sclera turns every pale pixel
  // into a glint, so sclera slivers inside the iris outline became extra
  // highlights. A light-role pixel whose source RGB is closer to the observed
  // white samples than to the light samples is sclera and takes the white role.
  const lightIndex=roles.findIndex(r=>r.name==='light'),whiteIndex=roles.findIndex(r=>r.family==='white'&&r.geometry!=='stroke');let scleraJoined=0;
  if(lightIndex>=0&&whiteIndex>=0)for(const [q,r] of labels){if(r!==lightIndex)continue;const lab=toLab([...source.data.subarray(q*4,q*4+3)]);
   if(Math.min(...roles[whiteIndex].labs.map(v=>distance(v,lab)))<Math.min(...roles[lightIndex].labs.map(v=>distance(v,lab)))){labels.set(q,whiteIndex);sourceCounts[lightIndex]--;sourceCounts[whiteIndex]++;sourceRoleMap.data.writeUInt32BE(rgba(roles[whiteIndex].color),q*4);scleraJoined++;}}
  const attachmentReports=[];
  for(let r=0;r<roles.length;r++)if(roles[r].attachedFill){
   const mask=new Set([...labels].filter(([,v])=>v===r).map(([q])=>q));
   const split=require('./raster-source-ink-paths.cjs').interiorAnchoredBand(mask,source.width,source.height),a=roles[r].attachedFill,target=roles.findIndex(v=>v.name===a.role),moved=[];
   for(const q of mask)if(!split.band.has(q)&&inSourcePolygon(q%source.width+.5,Math.floor(q/source.width)+.5,a.sourcePolygon)){labels.set(q,target);sourceCounts[r]--;sourceCounts[target]++;moved.push(q);}
   attachmentReports.push({stroke:roles[r].name,fill:a.role,...split.report,assignedFillSourcePixels:moved.length});
  }
  const cells=[],nativeRoles=new Map(),nativeFamilies=new Map(),overlaps=new Map(),strokeClaims=new Map(),strokePlans=[];
  if(policy.geometryPolicy)for(let r=0;r<roles.length;r++)if(roles[r].geometry==='stroke'){
   const mask=new Set([...labels].filter(([,v])=>v===r).map(([p])=>p));
   if(!mask.size){if(roles[r].required!==false)throw Error('Required eye stroke absent: '+roles[r].name);continue;}
   let plan;try{plan=require('./raster-source-ink-paths.cjs').planSourceStroke(mask,source.width,source.height,grid,image.width,image.height,{closed:roles[r].closed===true,anchor:roles[r].anchor});}catch(error){error.message=eye.name+'/'+roles[r].name+': '+error.message;throw error;}
   for(const p of plan.cells){if(strokeClaims.has(p))throw Error('Eye stroke roles compete for one cell');strokeClaims.set(p,r);}
   strokePlans.push({role:r,...plan,...(roles[r].closed?{sourceInterior:enclosedStrokeCells(mask,source.width),nativeInterior:enclosedStrokeCells(plan.cells,image.width),interiorRoles:roles[r].interiorRoles?new Set(roles[r].interiorRoles.map(name=>roles.findIndex(v=>v.name===name))):null}:{})});
  }
  // The observed closed face also bounds semantic interior roles. A nearby
  // pale hair tone must not become iris pigment merely because its RGB is
  // closer. Resolve it against declared exterior context before area voting.
  for(const plan of strokePlans)if(plan.anchorReport&&plan.interiorRoles){
   const exterior=roles.map((r,i)=>eye.contextRoles?.includes(r.name)&&!plan.interiorRoles.has(i)&&r.geometry==='fill'?i:-1).filter(i=>i>=0);
   for(const [q,r]of labels)if(plan.interiorRoles.has(r)&&!plan.sourceInterior.has(q)){
    if(!exterior.length)throw Error('Closed source face needs observed exterior context roles');
    const lab=toLab([...source.data.subarray(q*4,q*4+3)]),best=exterior.reduce((a,b)=>Math.min(...roles[a].labs.map(v=>distance(v,lab)))<=Math.min(...roles[b].labs.map(v=>distance(v,lab)))?a:b);
    labels.set(q,best);sourceCounts[r]--;sourceCounts[best]++;sourceRoleMap.data.writeUInt32BE(rgba(roles[best].color),q*4);
   }
  }
  // A one-dot stroke paints a whole cell even where the source line is a
  // 1-3 px tail or nub (an inner lid corner, an iris rim sliver). In a small
  // eye such a cell takes the only white, iris or glint cell. An open-stroke
  // cell yields to the eye fill when its own pigment covers under half of the
  // cell and under half of the stroke's median cell coverage, eye fill/glint
  // pigment covers more and at least a quarter of the cell, and the stroke
  // stays one connected piece.
  // Closed rims and the last cell never yield.
  const prunedStrokeCells=[];
  if(policy.geometryPolicy){const cellArea=(grid.x[0][1]-grid.x[0][0])*(grid.y[0][1]-grid.y[0][0]),W=image.width;
   const coverage=p=>{const [a,b]=grid.x[p%W],[c,d]=grid.y[Math.floor(p/W)],m=new Map();for(let sy=Math.floor(c);sy<Math.ceil(d);sy++)for(let sx=Math.floor(a);sx<Math.ceil(b);sx++){const r=labels.get(sy*source.width+sx);if(r!==undefined)m.set(r,(m.get(r)||0)+1);}return m;};
   for(const plan of strokePlans){if(roles[plan.role].closed)continue;let again=true;
    // A tail is thin relative to its own stroke: a uniformly thin lid is still a lid.
    const owns=[...plan.cells].map(p=>coverage(p).get(plan.role)||0).sort((u,v)=>u-v),median=owns[Math.floor(owns.length/2)];
    while(again&&plan.cells.size>1){again=false;
     for(const p of [...plan.cells]){if(plan.cells.size<=1)break;
      // Any cell may yield, end or side nub, if the stroke stays one connected piece.
      const rest=new Set(plan.cells);rest.delete(p);if(require('./raster-source-ink-paths.cjs').strokeTopology(rest,W,image.height).components!==require('./raster-source-ink-paths.cjs').strokeTopology(plan.cells,W,image.height).components)continue;
      const m=coverage(p),own=m.get(plan.role)||0;let fill=0;for(const [r,n] of m)if((roles[r].geometry==='fill'||roles[r].geometry==='feature')&&roles[r].family!==roles[plan.role].family)fill+=n;
      if(own<cellArea/2&&own<median/2&&fill>own&&fill>=cellArea/4){plan.cells.delete(p);strokeClaims.delete(p);prunedStrokeCells.push({role:roles[plan.role].name,cell:[p%W,Math.floor(p/W)],strokePixels:own,fillPixels:fill});again=true;}
     }}
   }}
  // A thick anime lid is a pigment mass, not a line drawn thick: the one-dot
  // path keeps one row and the vote below skips stroke pixels, so the second
  // source row was handed to the neighbouring fill (a 2-row lid became a dark
  // iris band). A vacated cell beside the path whose own stroke pigment covers
  // at least half of it, and with that path cell carries at least 1.5 cells
  // of pigment (the source band rounds to two rows), is a measured mass cell.
  // `thickness: "source"` keeps it as same-pigment plane (SKILL: outline-colour
  // planes are fills); otherwise it is only reported as `thickStrokeCells`.
  const massClaims=new Map(),thickStrokeCells=[];
  if(policy.geometryPolicy){const cellArea=(grid.x[0][1]-grid.x[0][0])*(grid.y[0][1]-grid.y[0][0]),W=image.width,H=image.height;
   const coverage=(p,r)=>{const [a,b]=grid.x[p%W],[c,d]=grid.y[Math.floor(p/W)];let n=0;for(let sy=Math.floor(c);sy<Math.ceil(d);sy++)for(let sx=Math.floor(a);sx<Math.ceil(b);sx++)if(labels.get(sy*source.width+sx)===r)n++;return n;};
   for(const plan of strokePlans){if(roles[plan.role].closed)continue;
    for(const v of plan.footprint){if(plan.cells.has(v)||strokeClaims.has(v)||massClaims.has(v))continue;const own=coverage(v,plan.role);if(own<cellArea/2)continue;
     const x=v%W,y=Math.floor(v/W),beside=[[x-1,y],[x+1,y],[x,y-1],[x,y+1]].filter(([u,w])=>u>=0&&u<W&&w>=0&&w<H).map(([u,w])=>w*W+u).filter(p=>plan.cells.has(p));
     if(!beside.some(p=>coverage(p,plan.role)+own>=1.5*cellArea))continue;
     thickStrokeCells.push({role:roles[plan.role].name,cell:[x,y],strokePixels:own,kept:roles[plan.role].thickness==='source'});
     if(roles[plan.role].thickness==='source'){massClaims.set(v,plan.role);plan.massCells=(plan.massCells??[]).concat(v);}
    }}
   const undecided=thickStrokeCells.filter(c=>roles.find(r=>r.name===c.role).thickness===undefined);
   if(undecided.length)throw Error('Eye stroke is a source mass of two rows at '+JSON.stringify(undecided.map(c=>c.cell))+': '+eye.name+'/'+undecided[0].role+'. Declare thickness "source" to keep the observed thick lid as same-pigment plane, or "one-dot" to thin it after reviewing the source.');
  }
  for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++){
   const [a,b]=grid.x[x],[c,d]=grid.y[y];if(a>=rx+rw||b<=rx||c>=ry+rh||d<=ry)continue;
   const groups=new Map(),p=y*image.width+x,interiorPlan=strokePlans.find(plan=>plan.nativeInterior?.has(p));let owned=0;
   // Closed boundaries constrain both sides. Previously only the inner side
   // was filtered, so vacated outer ink cells could vote an iris back outside
   // its newly placed rim. Follow observed source-side ownership, not RGB:
   // the same white may be an inner glint and exterior skin/sclera.
   const wrongSide=q=>strokePlans.some(plan=>plan.sourceInterior&&
    plan.nativeInterior.has(p)!==plan.sourceInterior.has(q));
   for(let sy=Math.max(0,Math.floor(c));sy<Math.min(source.height,Math.ceil(d));sy++)for(let sx=Math.max(0,Math.floor(a));sx<Math.min(source.width,Math.ceil(b));sx++){
    const q=sy*source.width+sx,role=labels.get(q),weight=(Math.min(b,sx+1)-Math.max(a,sx))*(Math.min(d,sy+1)-Math.max(c,sy));
    const context=role===undefined?contextAt(q,roles):null,family=context?.family??roles[role].family,color=context?.color??roles[role].color;
    if(role!==undefined){owned+=weight;if(!overlaps.has(q))overlaps.set(q,[]);overlaps.get(q).push([p,weight]);}
    if(policy.geometryPolicy&&roles[role]?.geometry==='stroke')continue;
    if(wrongSide(q)||interiorPlan&&interiorPlan.interiorRoles&&!interiorPlan.interiorRoles.has(role))continue;
    if(!groups.has(family))groups.set(family,{family,weight:0,tones:new Map()});const group=groups.get(family),key=color;group.weight+=weight;
    if(!group.tones.has(key))group.tones.set(key,{role,color,weight:0,roleWeights:new Map()});
    const tone=group.tones.get(key),resolvedRole=context?.role??role;tone.weight+=weight;tone.roleWeights.set(resolvedRole,(tone.roleWeights.get(resolvedRole)||0)+weight);
    tone.role=[...tone.roleWeights].sort((a,b)=>b[1]-a[1]||(roles[b[0]]?.protect===true)-(roles[a[0]]?.protect===true))[0][0];
   }
   if(!owned)continue;if(claimed.has(p))throw Error('Overlapping eye cell ownership');claimed.add(p);cells.push(p);
   if(strokeClaims.has(p)||massClaims.has(p)){const r=strokeClaims.get(p)??massClaims.get(p);image.data.writeUInt32BE(rgba(roles[r].color),p*4);nativeRoles.set(p,r);nativeFamilies.set(p,roles[r].family);continue;}
   if(!groups.size&&interiorPlan){
    const cx=(a+b)/2,cy=(c+d)/2,candidates=[...interiorPlan.sourceInterior].filter(q=>!wrongSide(q)&&labels.has(q)&&roles[labels.get(q)].geometry!=='stroke'&&(!interiorPlan.interiorRoles||interiorPlan.interiorRoles.has(labels.get(q))));
    candidates.sort((u,v)=>(u%source.width+.5-cx)**2+(Math.floor(u/source.width)+.5-cy)**2-((v%source.width+.5-cx)**2+(Math.floor(v/source.width)+.5-cy)**2));
    if(!candidates.length)throw Error('Closed eye stroke has no observed interior fill');
    const r=labels.get(candidates[0]),{family,color}=roles[r];groups.set(family,{family,weight:1,tones:new Map([[r,{role:r,color,weight:1}]])});
   }
   // A cell wholly covered by thick source ink can be vacated by its planned
   // one-dot path. Sample away from that path on the SAME source side. Never
   // borrow an iris color across a boundary or leave the old thick ink under it.
   if(!groups.size&&policy.geometryPolicy){
    const anchors=[...strokeClaims.keys()],anchor=anchors.reduce((a,b)=>Math.hypot(x-a%image.width,y-Math.floor(a/image.width))<=Math.hypot(x-b%image.width,y-Math.floor(b/image.width))?a:b);
    const dx=x-anchor%image.width,dy=y-Math.floor(anchor/image.width),length=Math.hypot(dx,dy);let found=false;
    for(let t=0;t<=Math.hypot(rw,rh);t+=.5){const sx=Math.floor((a+b)/2+dx/length*t),sy=Math.floor((c+d)/2+dy/length*t);if(sx<rx||sy<ry||sx>=rx+rw||sy>=ry+rh)break;
     const q=sy*source.width+sx,r=labels.get(q);if(roles[r]?.geometry==='stroke'||wrongSide(q))continue;
     const context=r===undefined?contextAt(q,roles):null,family=context?.family??roles[r].family,color=context?.color??roles[r].color;
     const resolvedRole=context?.role??r;groups.set(family,{family,weight:1,tones:new Map([[resolvedRole,{role:resolvedRole,color,weight:1}]])});found=true;break;
    }
    if(!found)throw Error('Eye stroke has no source-supported adjacent fill');
   }
   const chosen=[...groups.values()].sort((a,b)=>b.weight-a.weight)[0],tone=[...chosen.tones.values()].sort((a,b)=>b.weight-a.weight)[0];
   image.data.writeUInt32BE(rgba(tone.color),p*4);nativeRoles.set(p,tone.role);nativeFamilies.set(p,chosen.family);
  }
  const fillShapes=placeObservedOvals(image,source,grid,roles,labels,overlaps,nativeRoles,nativeFamilies,strokeClaims);
  const reflection=[],light=roles.findIndex(r=>r.name==='light'),visited=new Set();
  if(light>=0&&eye.reflection==='if-room')for(const [q,r] of labels){
   if(r!==light||visited.has(q))continue;const part=[q];visited.add(q);
   for(let i=0;i<part.length;i++){const x=part[i]%source.width,y=Math.floor(part[i]/source.width);for(const [nx,ny]of[[x-1,y],[x+1,y],[x,y-1],[x,y+1]]){if(nx<0||nx>=source.width||ny<0||ny>=source.height)continue;const n=ny*source.width+nx;if(labels.get(n)===light&&!visited.has(n)){visited.add(n);part.push(n);}}}
   if(part.length<3){reflection.push({status:'omitted-subpixel-source-mark',sourcePixels:part.length});continue;}const votes=new Map();for(const q of part)for(const [p,w] of overlaps.get(q)??[])votes.set(p,(votes.get(p)||0)+w);
   const candidates=[...votes].sort((a,b)=>b[1]-a[1]||a[0]-b[0]);
   // Sclera outside the iris is not proof that an iris highlight survived.
   if(candidates.some(([p])=>nativeFamilies.get(p)===roles[light].family&&nativeRoles.get(p)===light)){reflection.push({status:'represented',sourcePixels:part.length});continue;}
   const sourceJoined=part.some(q=>[q-1,q+1,q-source.width,q+source.width].some(n=>labels.has(n)&&labels.get(n)!==light&&roles[labels.get(n)].color===roles[light].color));
   let chosen=null;
   for(const [p] of candidates){
    if(nativeFamilies.get(p)!==roles[light].family)continue;const old=nativeRoles.get(p);
    if(roles[old]?.protect===true&&roles[old]?.shape!=='source-family-oval'||roles[old]?.geometry==='stroke')continue;
    if([...nativeFamilies.values()].filter(v=>v===roles[light].family).length<3)continue;
    if(roles[old]?.required!==false&&![...nativeRoles].some(([q,r])=>q!==p&&r===old))continue;
    const x=p%image.width,y=Math.floor(p/image.width),adjacent=[[x-1,y],[x+1,y],[x,y-1],[x,y+1]].filter(([x,y])=>x>=0&&x<image.width&&y>=0&&y<image.height).map(([x,y])=>y*image.width+x);
    if(!sourceJoined&&adjacent.some(q=>image.data.readUInt32BE(q*4)===rgba(roles[light].color)&&nativeFamilies.get(q)!==roles[light].family))continue;
    image.data.writeUInt32BE(rgba(roles[light].color),p*4);nativeRoles.set(p,light);chosen=p;break;
   }
   reflection.push({status:chosen===null?'omitted-no-room':'source-highlight-preserved',sourcePixels:part.length,cell:chosen,sourceJoinedToWhite:sourceJoined});
  }
  // Unknown context is not proof of a filled shape. Previously every dark
  // sample outside a clipped eye polygon silently exempted a duplicate rim.
  const explicitContextFills=new Set((material?.plan.regions??[]).filter(r=>r.geometry==='fill').map(r=>r.material));
  const geometry=policy.geometryPolicy?{executed:true,strokes:strokePlans.map(p=>({role:roles[p.role].name,color:roles[p.role].color,cells:[...p.cells],...(p.massCells?{massCells:p.massCells}:{}),footprint:[...p.footprint],sameColorFill:[...nativeRoles].filter(([q,r])=>r!==p.role&&(roles[r]?.geometry==='fill'||roles[r]?.geometry==='feature'||explicitContextFills.has(nativeFamilies.get(q)))&&image.data.readUInt32BE(q*4)===rgba(roles[p.role].color)).map(([q])=>q),sourceTopology:p.sourceTopology,nativeTopology:p.nativeTopology})),width:1}:null;
  if(geometry)for(let i=0;i<strokePlans.length;i++){
   const plan=strokePlans[i];if(plan.anchorReport)geometry.strokes[i].anchor=plan.anchorReport;
   if(plan.interiorRoles)for(const[p,r]of nativeRoles)if(plan.interiorRoles.has(r)&&!plan.nativeInterior.has(p))throw Error('Closed eye interior role escaped its allocated rim: '+eye.name+'/'+roles[r].name+' at '+p);
  }
  if(policy.geometryPolicy)for(let r=0;r<roles.length;r++)if(roles[r].required!==false&&sourceCounts[r]&&![...nativeRoles.values()].includes(r)){const error=new Error('Eye joint placement erased required role: '+eye.name+'/'+roles[r].name);error.fillShapes=fillShapes;throw error;}
  // An optional role is optional when it is small, not when the placement
  // consumes a large observed plane (e.g. a dark iris band eaten by a lid
  // stroke). Two full cells of source pigment is a visible shape at this grid.
  if(policy.geometryPolicy){const cellArea=(grid.x[0][1]-grid.x[0][0])*(grid.y[0][1]-grid.y[0][0]);
   for(let r=0;r<roles.length;r++)if(roles[r].required===false&&roles[r].geometry!=='feature'&&sourceCounts[r]>=2*cellArea&&![...nativeRoles.values()].includes(r)){
    const error=new Error('Eye joint placement erased an observed plane of '+(sourceCounts[r]/cellArea).toFixed(1)+' cells: '+eye.name+'/'+roles[r].name+'. Check whether a stroke role (lid) owns an ink rim inside this plane; give the rim to the plane partition.');error.fillShapes=fillShapes;throw error;}}
  reports.push({name:eye.name,cells,roles:roles.map((r,i)=>({name:r.name,color:r.color,family:r.family,sourcePixels:sourceCounts[i],nativeCells:[...nativeRoles.values()].filter(v=>v===i).length})),reflection,geometry,fillShapes,...(attachmentReports.length?{attachments:attachmentReports}:{}),...(prunedStrokeCells.length?{prunedStrokeCells}:{}),...(scleraJoined?{lightPixelsMovedToWhite:scleraJoined}:{}),...(leftToSurround?{partitionPixelsLeftToSurroundingMaterial:leftToSurround}:{}),...(thickStrokeCells.length?{thickStrokeCells}:{})});
 }
 let changed=0;for(let p=0;p<baseline.width*baseline.height;p++)if(image.data.readUInt32BE(p*4)!==baseline.data.readUInt32BE(p*4))changed++;
 return {image,sourceRoleMap,report:{status:'AWAITING_SAVED_VISUAL_REVIEW',rule:'source-partitions/family-before-tone',changed,eyes:reports,limitation:'Observed source partitions and samples require visual review. Reproduction is not shape approval.'}};
}
function auditEyePolicy(PNG,source,saved,palette,policy,grid,material=null){
 const replay=applyEyePolicy(PNG,source,saved,palette,policy,grid,material);
 const missingRoles=[];
 if(policy.visibility==='visible')for(let i=0;i<policy.eyes.length;i++)for(const r of policy.eyes[i].roles){
  const present=policy.placement==='source-partitions'?replay.report.eyes[i].roles.find(v=>v.name===r.name).nativeCells>0:replay.report.eyes[i].cells.some(p=>saved.data.readUInt32BE(p*4)===rgba(r.color));
  if((r.required??r.name!=='light')&&!present)missingRoles.push(policy.eyes[i].name+'/'+r.name);
 }
 const geometryExecuted=!policy.geometryPolicy||policy.visibility==='not-visible'||replay.report.eyes.every(e=>e.geometry?.executed===true);
 const strokes=replay.report.eyes.flatMap(e=>(e.geometry?.strokes??[]).map(s=>{
  const expected=new Set([...s.cells,...(s.massCells??[])]),fills=new Set(s.sameColorFill),ink=rgba(s.color);
  return {eye:e.name,role:s.role,missingCells:[...expected].filter(p=>saved.data.readUInt32BE(p*4)!==ink),excessInk:s.footprint.filter(p=>!expected.has(p)&&!fills.has(p)&&saved.data.readUInt32BE(p*4)===ink)};
 }));
 const strokeFailures=strokes.some(s=>s.missingCells.length||s.excessInk.length);
 return {status:replay.report.changed||missingRoles.length||!geometryExecuted||strokeFailures?'FAIL':policy.visibility==='not-visible'?'NOT_APPLICABLE':'PASS',geometryExecuted:policy.geometryPolicy?geometryExecuted:null,strokes,nonconformingCells:replay.report.changed,missingRoles,visual:'UNVERIFIED',report:replay.report};
}
function remapEyePolicy(policy,grid){
 if(policy.visibility==='not-visible')return policy;
 return {...policy,eyes:policy.eyes.map(e=>{
  const [x,y,w,h]=e.rect,ix=grid.x.map((v,i)=>v[0]<x+w&&v[1]>x?i:-1).filter(i=>i>=0),iy=grid.y.map((v,i)=>v[0]<y+h&&v[1]>y?i:-1).filter(i=>i>=0);
  if(!ix.length||!iy.length)throw Error('Eye lost during coordinate remapping');
  const position=(axis,v)=>{let i=grid[axis].findIndex(([a,b])=>v>=a&&v<b);if(i<0)i=v<grid[axis][0][0]?0:grid[axis].length-1;const[a,b]=grid[axis][i];return i+(v-a)/(b-a);};
  const remap=polygon=>polygon.map(([a,b])=>[position('x',a),position('y',b)]);
  return {...e,rect:[ix[0],iy[0],ix.at(-1)-ix[0]+1,iy.at(-1)-iy[0]+1],roles:e.roles.map(r=>r.attachedFill?{...r,attachedFill:{...r.attachedFill,sourcePolygon:remap(r.attachedFill.sourcePolygon)}}:r),...(e.sourcePolygon?{sourcePolygon:remap(e.sourcePolygon)}:{}),...(e.partitions?{partitions:e.partitions.map(p=>({...p,sourcePolygon:remap(p.sourcePolygon)}))}:{})};
 })};
}
module.exports={EYE_PROMPT,assertEyePolicy,affineEyeGrid,applyEyePolicy,auditEyePolicy,remapEyePolicy,inSourcePolygon,eyeOwnsSource,eyeOwnership};
