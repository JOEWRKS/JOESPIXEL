'use strict';
// Shared production rule. Source annotations are observations, never output dots.
// Color canonicalization preserves the existing eye partition. Reflection recovery
// is optional and cannot relocate a lid, remove sclera, or create an eye boundary.
const EYE_PROMPT='Visible eyes must read as separate flat lid/pupil, iris and sclera planes only where present in the reference. One fixed color per observed role; no gradients, near-color ramps, dithering or blended edges. Preserve gaze, tilt and eye contour. Preserve an observed highlight only if a distinct interior cell fits without erasing the pupil/iris, merging with sclera or breaking the lid. Otherwise omit the highlight and record the limitation. Do not invent human sclera for dot eyes or mechanical lenses.';
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
   if(!r.name||!allowed.has(r.color)||!r.colors?.length||!r.colors.includes(r.color)||r.colors.some(c=>!allowed.has(c)||seen.has(c)))throw Error('Eye role colors must be unambiguous fixed palette entries');
   r.colors.forEach(c=>seen.add(c));
   if(!r.samples?.length||r.samples.some(a=>!Array.isArray(a)||a.length!==3||a.some(v=>!Number.isFinite(v)||v<0||v>255)))throw Error('Observed source RGB samples required');
  }
 }
 return policy;
}
function affineEyeGrid(source,native,fit){
 return {x:Array.from({length:native.width},(_,x)=>[(x-fit.offsetX)*source.width/fit.fitWidth,(x+1-fit.offsetX)*source.width/fit.fitWidth]),
 y:Array.from({length:native.height},(_,y)=>[(y-fit.offsetY)*source.height/fit.fitHeight,(y+1-fit.offsetY)*source.height/fit.fitHeight])};
}
function applyEyePolicy(PNG,source,baseline,palette,policy,grid){
 assertEyePolicy(policy,palette);
 const image=new PNG({width:baseline.width,height:baseline.height});baseline.data.copy(image.data);
 if(policy.visibility==='not-visible')return {image,report:{status:'NOT_APPLICABLE',observation:policy.observation,changed:0,eyes:[]}};
 if(grid?.x?.length!==baseline.width||grid?.y?.length!==baseline.height)throw Error('Eye/source grid mismatch');
 for(const axis of ['x','y'])if(grid[axis].some(v=>v.length!==2||!v.every(Number.isFinite)||v[1]<=v[0]))throw Error('Invalid eye grid');
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
function auditEyePolicy(PNG,source,saved,palette,policy,grid){
 const replay=applyEyePolicy(PNG,source,saved,palette,policy,grid);
 const missingRoles=[];
 if(policy.visibility==='visible')for(let i=0;i<policy.eyes.length;i++)for(const r of policy.eyes[i].roles){
  if((r.required??r.name!=='light')&&!replay.report.eyes[i].cells.some(p=>saved.data.readUInt32BE(p*4)===rgba(r.color)))missingRoles.push(policy.eyes[i].name+'/'+r.name);
 }
 return {status:replay.report.changed||missingRoles.length?'FAIL':policy.visibility==='not-visible'?'NOT_APPLICABLE':'PASS',nonconformingCells:replay.report.changed,missingRoles,visual:'UNVERIFIED',report:replay.report};
}
function remapEyePolicy(policy,grid){
 if(policy.visibility==='not-visible')return policy;
 return {...policy,eyes:policy.eyes.map(e=>{
  const [x,y,w,h]=e.rect,ix=grid.x.map((v,i)=>v[0]<x+w&&v[1]>x?i:-1).filter(i=>i>=0),iy=grid.y.map((v,i)=>v[0]<y+h&&v[1]>y?i:-1).filter(i=>i>=0);
  if(!ix.length||!iy.length)throw Error('Eye lost during coordinate remapping');
  const position=(axis,v)=>{let i=grid[axis].findIndex(([a,b])=>v>=a&&v<b);if(i<0)i=v<grid[axis][0][0]?0:grid[axis].length-1;const[a,b]=grid[axis][i];return i+(v-a)/(b-a);};
  return {...e,rect:[ix[0],iy[0],ix.at(-1)-ix[0]+1,iy.at(-1)-iy[0]+1],...(e.sourcePolygon?{sourcePolygon:e.sourcePolygon.map(([a,b])=>[position('x',a),position('y',b)])}:{})};
 })};
}
module.exports={EYE_PROMPT,assertEyePolicy,affineEyeGrid,applyEyePolicy,auditEyePolicy,remapEyePolicy,inSourcePolygon,eyeOwnsSource,eyeOwnership};
