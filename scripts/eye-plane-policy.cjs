'use strict';
// Shared production rule. Source annotations are observations, never output dots.
// Production uses observed source partitions before family/tone cell assignment.
// Legacy color canonicalization remains available for replay of older inputs.
const EYE_PROMPT='Visible eyes must retain the observed lid, iris, pupil and sclera spatial relationships. Separate source ownership before assigning colors: dark iris pigment is not automatically eyelid ink. One fixed color per observed role; distinct iris shading may have its own role in the same iris family. No gradients, dithering or blended edges. Preserve gaze, tilt and eye contour. Preserve source highlights only where they fit without erasing pupil/iris or breaking the lid; a source highlight connected to sclera may remain connected. Otherwise record the limitation. Do not invent human sclera for dot eyes or mechanical lenses.';
const hex=c=>'#'+c.toString(16).padStart(8,'0').slice(0,6).toUpperCase();
const rgba=c=>parseInt(c.slice(1)+'ff',16);
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
   if(!policy.geometryPolicy&&r.geometry!==undefined)throw Error('Eye geometry annotation cannot be silently ignored');
   if(r.shape!==undefined&&(r.shape!=='source-oval'||r.geometry!=='fill'||r.protect!==true||policy.geometryPolicy!=='source-stroke-fill'))throw Error('Observed oval shape requires a protected source fill');
   if(!r.name||!allowed.has(r.color)||!r.colors?.length||!r.colors.includes(r.color)||r.colors.some(c=>!allowed.has(c)||(policy.placement!=='source-partitions'&&seen.has(c))))throw Error('Eye role colors must be unambiguous fixed palette entries');
   r.colors.forEach(c=>seen.add(c));
   if(!r.samples?.length||r.samples.some(a=>!Array.isArray(a)||a.length!==3||a.some(v=>!Number.isFinite(v)||v<0||v>255)))throw Error('Observed source RGB samples required');
  }
  if(policy.placement==='source-partitions'){
   const names=new Set(e.roles.map(r=>r.name)),validPolygon=p=>Array.isArray(p)&&p.length>=3&&p.every(v=>Array.isArray(v)&&v.length===2&&v.every(Number.isFinite)&&v[0]>=e.rect[0]&&v[0]<=e.rect[0]+e.rect[2]&&v[1]>=e.rect[1]&&v[1]<=e.rect[1]+e.rect[3]);
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
 for(let r=0;r<roles.length;r++){
  if(roles[r].shape!=='source-oval')continue;
  const points=[...labels].filter(([,role])=>role===r).map(([q])=>q);
  if(!points.length)throw Error('Observed oval source fill absent');
  const xs=points.map(q=>q%source.width),ys=points.map(q=>Math.floor(q/source.width)),minX=Math.min(...xs),minY=Math.min(...ys),maxX=Math.max(...xs)+1,maxY=Math.max(...ys)+1;
  const stepX=grid.x[0][1]-grid.x[0][0],stepY=grid.y[0][1]-grid.y[0][0];
  if(grid.x.some(([a,b])=>Math.abs(b-a-stepX)>1e-6)||grid.y.some(([a,b])=>Math.abs(b-a-stepY)>1e-6))throw Error('Observed oval requires a uniform grid');
  const cx=xs.reduce((a,b)=>a+b+.5,0)/points.length,cy=ys.reduce((a,b)=>a+b+.5,0)/points.length,width=Math.max(1,Math.round((maxX-minX)/stepX)),height=Math.max(1,Math.round((maxY-minY)/stepY));
  const remaining=new Set(points),queue=[points[0]];remaining.delete(points[0]);
  for(let i=0;i<queue.length;i++){const q=queue[i],x=q%source.width,y=Math.floor(q/source.width);for(const[nx,ny]of [[x-1,y],[x+1,y],[x,y-1],[x,y+1]]){const n=ny*source.width+nx;if(nx>=0&&nx<source.width&&ny>=0&&ny<source.height&&remaining.delete(n))queue.push(n);}}
  if(remaining.size||points.length/((maxX-minX)*(maxY-minY))<.5)throw Error('Observed oval is fragmented or not a compact fill');
  const votes=new Map();for(const q of points)for(const[p,weight]of overlaps.get(q)??[])votes.set(p,(votes.get(p)||0)+weight);
  const gx=(cx-grid.x[0][0])/stepX,gy=(cy-grid.y[0][0])/stepY,candidates=[];
  for(let y=Math.floor(gy-height/2)-1;y<=Math.ceil(gy-height/2)+1;y++)for(let x=Math.floor(gx-width/2)-1;x<=Math.ceil(gx-width/2)+1;x++){
   if(x<0||y<0||x+width>image.width||y+height>image.height||Math.abs(x+width/2-gx)>.51||Math.abs(y+height/2-gy)>.51)continue;
   const cells=[];for(let yy=0;yy<height;yy++)for(let xx=0;xx<width;xx++)if(((xx+.5-width/2)/(width/2))**2+((yy+.5-height/2)/(height/2))**2<=1)cells.push((y+yy)*image.width+x+xx);
   if(cells.some(p=>!votes.has(p)||nativeFamilies.get(p)!==roles[r].family||strokeClaims.has(p)||(nativeRoles.get(p)!==r&&(roles[nativeRoles.get(p)]?.protect||roles[nativeRoles.get(p)]?.geometry==='feature'))))continue;
   const overlap=cells.reduce((sum,p)=>sum+votes.get(p),0),error=cells.length*stepX*stepY+points.length-2*overlap;
   candidates.push({cells,error,centerError:(x+width/2-gx)**2+(y+height/2-gy)**2});
  }
  candidates.sort((a,b)=>a.error-b.error||a.centerError-b.centerError||a.cells[0]-b.cells[0]);const best=candidates[0];
  if(!best)throw Error('Observed oval cannot fit without invading a feature or shifting its center');
  const selected=new Set(best.cells),cleared=[];
  for(const[p,old]of nativeRoles)if(old===r&&!selected.has(p)){
   const x=p%image.width,y=Math.floor(p/image.width),votes=new Map();for(let sy=Math.floor(grid.y[y][0]);sy<grid.y[y][1];sy++)for(let sx=Math.floor(grid.x[x][0]);sx<grid.x[x][1];sx++){const k=labels.get(sy*source.width+sx);if(k!==r&&roles[k]?.family===roles[r].family&&roles[k].geometry==='fill'&&!roles[k].protect)votes.set(k,(votes.get(k)||0)+1);}
   const replacement=[...votes].sort((a,b)=>b[1]-a[1])[0]?.[0];if(replacement===undefined)throw Error('Oval has no same-family adjacent fill');image.data.writeUInt32BE(rgba(roles[replacement].color),p*4);nativeRoles.set(p,replacement);cleared.push(p);
  }
  for(const p of best.cells){image.data.writeUInt32BE(rgba(roles[r].color),p*4);nativeRoles.set(p,r);}
  reports.push({role:roles[r].name,sourceBounds:[minX,minY,maxX-minX,maxY-minY],sourceCenter:[cx,cy],nativeExtent:[width,height],cells:best.cells,cleared,sourceSupported:true,centerDisplacementCells:Math.sqrt(best.centerError)});
 }
 return reports;
}
function placeSourceEyePartitions(PNG,source,baseline,palette,policy,grid,material=null){
 const image=new PNG({width:baseline.width,height:baseline.height});baseline.data.copy(image.data);
 const sourceRoleMap=new PNG({width:source.width,height:source.height});source.data.copy(sourceRoleMap.data);
 const {toLab}=require('./build-palette-native.cjs'),distance=(a,b)=>a.reduce((s,v,i)=>s+(v-b[i])**2,0),paletteLabs=palette.map(p=>toLab(p.rgb));
 const reports=[],claimed=new Set(),contextCache=new Map();
 const contextAt=(q,roles)=>{const owner=material&&!material.sourceExceptions[q]?material.owners[q]:-1;
  const key=material?.sourceLabels?q:owner+':'+source.data.readUInt32BE(q*4);if(contextCache.has(key))return contextCache.get(key);const lab=toLab([...source.data.subarray(q*4,q*4+3)]);
  // A broad material polygon is not permission to erase observed lash/white
  // samples outside the eye shape. Both source-role and material must agree.
  const closest=roles.reduce((a,b)=>Math.min(...a.labs.map(s=>distance(s,lab)))<=Math.min(...b.labs.map(s=>distance(s,lab)))?a:b);
  const region=owner>=0?material.plan.regions[owner]:null,allowed=region&&closest.family===region.material?new Set(region.colors):null;let k=-1;
  if(allowed&&material.sourceLabels){const assigned='#'+material.sourceLabels.data.subarray(q*4,q*4+3).toString('hex').toUpperCase();if(!allowed.has(assigned))throw Error('Eye context conflicts with assigned material');contextCache.set(key,assigned);return assigned;}
  for(let i=0;i<palette.length;i++)if((!allowed||allowed.has(palette[i].hex))&&(k<0||distance(lab,paletteLabs[i])<distance(lab,paletteLabs[k])))k=i;
  if(k<0)throw Error('Eye context has no assigned material color');contextCache.set(key,palette[k].hex);return palette[k].hex;};
 for(const eye of policy.eyes){
  contextCache.clear();
  const [rx,ry,rw,rh]=eye.rect;if(rx+rw>source.width||ry+rh>source.height)throw Error('Eye region outside source');
  const roles=eye.roles.map(r=>({...r,labs:r.samples.map(toLab)})),labels=new Map(),sourceCounts=roles.map(()=>0),cache=new Map();
  for(let y=Math.floor(ry);y<Math.ceil(ry+rh);y++)for(let x=Math.floor(rx);x<Math.ceil(rx+rw);x++){
   if(!eyeOwnsSource(eye,x+.5,y+.5))continue;
   const parts=eye.partitions.filter(p=>inSourcePolygon(x+.5,y+.5,p.sourcePolygon));if(parts.length>1)throw Error('Overlapping source eye partitions');
   const allowed=parts[0]?.roles??eye.baseRoles,q=y*source.width+x,key=allowed.join('/')+':'+source.data.readUInt32BE(q*4);let role=cache.get(key);
   if(role===undefined){const lab=toLab([...source.data.subarray(q*4,q*4+3)]);let best=Infinity;for(let r=0;r<roles.length;r++)if(allowed.includes(roles[r].name)){const d=Math.min(...roles[r].labs.map(s=>distance(s,lab)));if(d<best){best=d;role=r;}}cache.set(key,role);}
   labels.set(q,role);sourceCounts[role]++;sourceRoleMap.data.writeUInt32BE(rgba(roles[role].color),q*4);
  }
  const cells=[],nativeRoles=new Map(),nativeFamilies=new Map(),overlaps=new Map(),strokeClaims=new Map(),strokePlans=[];
  if(policy.geometryPolicy)for(let r=0;r<roles.length;r++)if(roles[r].geometry==='stroke'){
   const mask=new Set([...labels].filter(([,v])=>v===r).map(([p])=>p));
   if(!mask.size){if(roles[r].required!==false)throw Error('Required eye stroke absent: '+roles[r].name);continue;}
   let plan;try{plan=require('./raster-source-ink-paths.cjs').planSourceStroke(mask,source.width,source.height,grid,image.width,image.height,{closed:roles[r].closed===true});}catch(error){error.message=eye.name+'/'+roles[r].name+': '+error.message;throw error;}
   for(const p of plan.cells){if(strokeClaims.has(p))throw Error('Eye stroke roles compete for one cell');strokeClaims.set(p,r);}
   strokePlans.push({role:r,...plan});
  }
  for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++){
   const [a,b]=grid.x[x],[c,d]=grid.y[y];if(a>=rx+rw||b<=rx||c>=ry+rh||d<=ry)continue;
   const groups=new Map(),p=y*image.width+x;let owned=0;
   for(let sy=Math.max(0,Math.floor(c));sy<Math.min(source.height,Math.ceil(d));sy++)for(let sx=Math.max(0,Math.floor(a));sx<Math.min(source.width,Math.ceil(b));sx++){
    const q=sy*source.width+sx,role=labels.get(q),weight=(Math.min(b,sx+1)-Math.max(a,sx))*(Math.min(d,sy+1)-Math.max(c,sy));
    const family=role===undefined?'source-context':roles[role].family,color=role===undefined?contextAt(q,roles):roles[role].color;
    if(role!==undefined){owned+=weight;if(!overlaps.has(q))overlaps.set(q,[]);overlaps.get(q).push([p,weight]);}
    if(policy.geometryPolicy&&roles[role]?.geometry==='stroke')continue;
    if(!groups.has(family))groups.set(family,{family,weight:0,tones:new Map()});const group=groups.get(family),key=color;group.weight+=weight;
    if(!group.tones.has(key))group.tones.set(key,{role,color,weight:0,roleWeights:new Map()});
    const tone=group.tones.get(key);tone.weight+=weight;tone.roleWeights.set(role,(tone.roleWeights.get(role)||0)+weight);
    tone.role=[...tone.roleWeights].sort((a,b)=>b[1]-a[1]||(roles[b[0]]?.protect===true)-(roles[a[0]]?.protect===true))[0][0];
   }
   if(!owned)continue;if(claimed.has(p))throw Error('Overlapping eye cell ownership');claimed.add(p);cells.push(p);
   if(strokeClaims.has(p)){const r=strokeClaims.get(p);image.data.writeUInt32BE(rgba(roles[r].color),p*4);nativeRoles.set(p,r);nativeFamilies.set(p,roles[r].family);continue;}
   // A cell wholly covered by thick source ink can be vacated by its planned
   // one-dot path. Sample away from that path on the SAME source side. Never
   // borrow an iris color across a boundary or leave the old thick ink under it.
   if(!groups.size&&policy.geometryPolicy){
    const anchors=[...strokeClaims.keys()],anchor=anchors.reduce((a,b)=>Math.hypot(x-a%image.width,y-Math.floor(a/image.width))<=Math.hypot(x-b%image.width,y-Math.floor(b/image.width))?a:b);
    const dx=x-anchor%image.width,dy=y-Math.floor(anchor/image.width),length=Math.hypot(dx,dy);let found=false;
    for(let t=0;t<=Math.hypot(rw,rh);t+=.5){const sx=Math.floor((a+b)/2+dx/length*t),sy=Math.floor((c+d)/2+dy/length*t);if(sx<rx||sy<ry||sx>=rx+rw||sy>=ry+rh)break;
     const q=sy*source.width+sx,r=labels.get(q);if(roles[r]?.geometry==='stroke')continue;
     const family=r===undefined?'source-context':roles[r].family,color=r===undefined?contextAt(q,roles):roles[r].color;
     groups.set(family,{family,weight:1,tones:new Map([[r,{role:r,color,weight:1}]])});found=true;break;
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
   if(part.length<3)continue;const votes=new Map();for(const q of part)for(const [p,w] of overlaps.get(q)??[])votes.set(p,(votes.get(p)||0)+w);
   const candidates=[...votes].sort((a,b)=>b[1]-a[1]||a[0]-b[0]);
   // Sclera outside the iris is not proof that an iris highlight survived.
   if(candidates.some(([p])=>nativeFamilies.get(p)===roles[light].family&&nativeRoles.get(p)===light)){reflection.push({status:'represented',sourcePixels:part.length});continue;}
   const sourceJoined=part.some(q=>[q-1,q+1,q-source.width,q+source.width].some(n=>labels.has(n)&&labels.get(n)!==light&&roles[labels.get(n)].color===roles[light].color));
   let chosen=null;
   for(const [p] of candidates){
    if(nativeFamilies.get(p)!==roles[light].family)continue;const old=nativeRoles.get(p);
    if(roles[old]?.protect===true||roles[old]?.geometry==='stroke')continue;
    if([...nativeFamilies.values()].filter(v=>v===roles[light].family).length<3)continue;
    if(roles[old]?.required!==false&&![...nativeRoles].some(([q,r])=>q!==p&&r===old))continue;
    const x=p%image.width,y=Math.floor(p/image.width),adjacent=[[x-1,y],[x+1,y],[x,y-1],[x,y+1]].filter(([x,y])=>x>=0&&x<image.width&&y>=0&&y<image.height).map(([x,y])=>y*image.width+x);
    if(!sourceJoined&&adjacent.some(q=>image.data.readUInt32BE(q*4)===rgba(roles[light].color)&&nativeFamilies.get(q)!==roles[light].family))continue;
    image.data.writeUInt32BE(rgba(roles[light].color),p*4);nativeRoles.set(p,light);chosen=p;break;
   }
   reflection.push({status:chosen===null?'omitted-no-room':'source-highlight-preserved',sourcePixels:part.length,cell:chosen,sourceJoinedToWhite:sourceJoined});
  }
  const geometry=policy.geometryPolicy?{executed:true,strokes:strokePlans.map(p=>({role:roles[p.role].name,color:roles[p.role].color,cells:[...p.cells],footprint:[...p.footprint],sameColorFill:[...nativeRoles].filter(([q,r])=>r!==p.role&&image.data.readUInt32BE(q*4)===rgba(roles[p.role].color)).map(([q])=>q),sourceTopology:p.sourceTopology,nativeTopology:p.nativeTopology})),width:1}:null;
  if(policy.geometryPolicy)for(let r=0;r<roles.length;r++)if(roles[r].required!==false&&sourceCounts[r]&&![...nativeRoles.values()].includes(r))throw Error('Eye joint placement erased required role: '+roles[r].name);
  reports.push({name:eye.name,cells,roles:roles.map((r,i)=>({name:r.name,color:r.color,family:r.family,sourcePixels:sourceCounts[i],nativeCells:[...nativeRoles.values()].filter(v=>v===i).length})),reflection,geometry,fillShapes});
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
  const expected=new Set(s.cells),fills=new Set(s.sameColorFill),ink=rgba(s.color);
  return {eye:e.name,role:s.role,missingCells:s.cells.filter(p=>saved.data.readUInt32BE(p*4)!==ink),excessInk:s.footprint.filter(p=>!expected.has(p)&&!fills.has(p)&&saved.data.readUInt32BE(p*4)===ink)};
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
  return {...e,rect:[ix[0],iy[0],ix.at(-1)-ix[0]+1,iy.at(-1)-iy[0]+1],...(e.sourcePolygon?{sourcePolygon:remap(e.sourcePolygon)}:{}),...(e.partitions?{partitions:e.partitions.map(p=>({...p,sourcePolygon:remap(p.sourcePolygon)}))}:{})};
 })};
}
module.exports={EYE_PROMPT,assertEyePolicy,affineEyeGrid,applyEyePolicy,auditEyePolicy,remapEyePolicy,inSourcePolygon,eyeOwnsSource,eyeOwnership};
