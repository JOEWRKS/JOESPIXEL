'use strict';
// Source-space observations, compiled before grid placement. This module does
// not infer anatomy and does not accept native-pixel paint instructions.
const fs=require('node:fs'),crypto=require('node:crypto');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
const policyHash=policies=>hash(JSON.stringify(stable(policies)));
const need=(ok,message)=>{if(!ok)throw Error('Material assignment: '+message);};
const text=v=>typeof v==='string'&&v.trim().length>0;
function readPlan(artifact){
 need(artifact&&text(artifact.path)&&/^[a-f0-9]{64}$/.test(artifact.sha256),'plan artifact required');
 const bytes=fs.readFileSync(artifact.path);need(hash(bytes)===artifact.sha256,'plan changed; repeat assignment and placement');return JSON.parse(bytes);
}
function inside(x,y,polygon){let result=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
 const [a,b]=polygon[i],[c,d]=polygon[j];if((b>y)!==(d>y)&&x<(c-a)*(y-b)/(d-b)+a)result=!result;
}return result;}
function compile(PNG,source,palette,width,height,plan,policies){
 const sw=source.width,sh=source.height,cell=sw/width;
 need(plan?.version===1&&Object.keys(plan).every(k=>['version','sourcePixelsSha256','paletteColors','grid','boundaryPolicySha256','observation','regions','protectedFeatures','inventory','unassigned'].includes(k)),'unsupported plan fields');
 need(text(plan.observation)&&plan.sourcePixelsSha256===hash(source.data),'source pixels changed');
 need(JSON.stringify(plan.paletteColors)===JSON.stringify(palette.map(p=>p.hex)),'palette changed');
 need(Number.isInteger(cell)&&cell>0&&sh/height===cell&&JSON.stringify(plan.grid)===JSON.stringify({native:[width,height],cell,canvas:[sw,sh],origin:[0,0]}),'fixed uniform grid changed');
 need(plan.boundaryPolicySha256===policyHash(policies),'boundary/feature policies changed after assignment');
 need(plan.unassigned==='preserve-existing-source-regions','unassigned pixels require explicit existing-route ownership');
 need(Array.isArray(plan.regions)&&Array.isArray(plan.protectedFeatures)&&Array.isArray(plan.inventory)&&plan.inventory.length,'regions, exceptions and whole-part inventory required');
 const validRect=r=>Array.isArray(r)&&r.length===4&&r.every(Number.isInteger)&&r[0]>=0&&r[1]>=0&&r[2]>0&&r[3]>0&&r[0]+r[2]<=sw&&r[1]+r[3]<=sh;
 for(const f of plan.protectedFeatures){need(text(f.role)&&validRect(f.rect)&&text(f.observation),'invalid observed feature exception');if(f.sourcePolygon)need(Array.isArray(f.sourcePolygon)&&f.sourcePolygon.length>=3&&f.sourcePolygon.every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&p[0]>=f.rect[0]&&p[0]<=f.rect[0]+f.rect[2]&&p[1]>=f.rect[1]&&p[1]<=f.rect[1]+f.rect[3]),'invalid feature ownership polygon');}
 for(const eye of policies.eyePolicy?.eyes??[])if(eye.sourcePolygon)need(plan.protectedFeatures.some(f=>JSON.stringify(f.rect)===JSON.stringify(eye.rect)&&JSON.stringify(f.sourcePolygon)===JSON.stringify(eye.sourcePolygon)),'eye and material ownership shapes differ');
 const ids=new Set(),entries=new Map(palette.map(p=>[p.hex,p]));
 for(const r of plan.regions){
  need(Object.keys(r).every(k=>['id','material','polygon','colors','baseColor','observation','boundaryRoles'].includes(k)),'destination instructions or unknown region field');
  need(text(r.id)&&!ids.has(r.id)&&text(r.material)&&text(r.observation),'region identity/observation required');ids.add(r.id);
  need(Array.isArray(r.polygon)&&r.polygon.length>=3&&r.polygon.every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&p[0]>=0&&p[0]<=sw&&p[1]>=0&&p[1]<=sh),'invalid source polygon');
  need(Array.isArray(r.colors)&&r.colors.length&&new Set(r.colors).size===r.colors.length&&r.colors.every(c=>entries.has(c))&&r.colors.includes(r.baseColor),'explicit fixed-palette material colors required');
  if(r.material==='skin')need(r.colors.length<=3,'skin permits at most three observed shades');
  need(Array.isArray(r.boundaryRoles)&&r.boundaryRoles.every(name=>(policies.outlinePolicy?.boundaryObservations??policies.outlinePolicy?.observedStrokes)?.roles.some(role=>role.name===name)),'unresolved boundary role');
 }
 const inventoryIds=new Set();for(const i of plan.inventory){
  need(text(i.id)&&!inventoryIds.has(i.id)&&text(i.observation)&&['assigned','preserved','absent'].includes(i.decision),'unresolved/duplicate inventory item');inventoryIds.add(i.id);
  need(Array.isArray(i.regionIds)&&i.regionIds.every(id=>ids.has(id))&&(i.decision!=='assigned'||i.regionIds.length),'inventory has no executable assignment');
 }
 for(const id of ids)need(plan.inventory.some(i=>i.regionIds.includes(id)),'region missing from reviewed inventory');
 const owners=new Int16Array(sw*sh).fill(-1),exceptions=new Uint8Array(sw*sh),sourceExceptions=new Uint8Array(sw*sh),map=new PNG({width:sw,height:sh});
 // A feature owns every logical cell it touches. Protecting only part of a
 // source cell would still let area voting change the feature's boundary.
 for(const f of plan.protectedFeatures){const [x,y,w,h]=f.rect,touched=new Set();for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++)if(!f.sourcePolygon||inside(xx+.5,yy+.5,f.sourcePolygon)){sourceExceptions[yy*sw+xx]=1;touched.add(Math.floor(yy/cell)*width+Math.floor(xx/cell));}for(const p of touched)for(let yy=Math.floor(p/width)*cell;yy<(Math.floor(p/width)+1)*cell;yy++)for(let xx=p%width*cell;xx<(p%width+1)*cell;xx++)exceptions[yy*sw+xx]=1;}
 plan.regions.forEach((r,index)=>{
  const xs=r.polygon.map(p=>p[0]),ys=r.polygon.map(p=>p[1]);
  for(let y=Math.floor(Math.min(...ys));y<Math.ceil(Math.max(...ys));y++)for(let x=Math.floor(Math.min(...xs));x<Math.ceil(Math.max(...xs));x++)if(inside(x+.5,y+.5,r.polygon)){
   const p=y*sw+x;need(owners[p]<0,'overlapping material observations must be resolved before placement');owners[p]=index;
   for(const name of r.boundaryRoles){const role=(policies.outlinePolicy.boundaryObservations??policies.outlinePolicy.observedStrokes).roles.find(role=>role.name===name),[a,b,c,d]=role.rect;
    if(x>=a&&x<a+c&&y>=b&&y<b+d&&require('./raster-source-ink-paths.cjs').matchesObservedInk([...source.data.subarray(p*4,p*4+3)],role)){exceptions[p]=1;sourceExceptions[p]=1;}
   }
  }
 });
 const interior=new Map();
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  let owner=owners[y*cell*sw+x*cell],complete=owner>=0;
  for(let yy=y*cell;yy<(y+1)*cell;yy++)for(let xx=x*cell;xx<(x+1)*cell;xx++)if(owners[yy*sw+xx]!==owner||exceptions[yy*sw+xx])complete=false;
  if(complete){const p=y*width+x;interior.set(p,owner);}
 }
 for(let p=0;p<owners.length;p++)map.data.set(exceptions[p]?[255,255,255,255]:owners[p]>=0?[53+(owners[p]*73)%170,137,190,255]:[65,65,65,255],p*4);
 return {plan,owners,exceptions,sourceExceptions,interior,map};
}
function assignSource(PNG,source,segmented,palette,compiled){
 const {toLab}=require('./build-palette-native.cjs'),out=new PNG({width:source.width,height:source.height});segmented.data.copy(out.data);
 const choices=compiled.plan.regions.map(r=>r.colors.map(hex=>{const p=palette.find(p=>p.hex===hex);return {rgb:p.rgb,lab:toLab(p.rgb)};}));
 const cache=new Map();let assignedPixels=0;
 for(let p=0;p<compiled.owners.length;p++){
  // Protect the feature's exact source samples during color assignment. Its
  // whole touched grid cell stays protected later through exceptions/interior.
  // Expanding this source exclusion to a grid cell leaves adjacent face color
  // unassigned and can turn a white clearance into background in the area vote.
  const role=compiled.owners[p];if(role<0||compiled.sourceExceptions[p])continue;
  const raw=source.data.readUInt32BE(p*4),key=role+':'+raw;let rgb=cache.get(key);
  if(!rgb){const lab=toLab([...source.data.subarray(p*4,p*4+3)]);let best=Infinity;for(const c of choices[role]){const d=c.lab.reduce((s,v,i)=>s+(v-lab[i])**2,0);if(d<best){best=d;rgb=c.rgb;}}cache.set(key,rgb);}
  out.data.set([...rgb,255],p*4);assignedPixels++;
 }
 return {image:out,report:{assignedPixels,interiorCells:compiled.interior.size,regions:compiled.plan.regions.map(r=>({id:r.id,material:r.material,colors:r.colors})),method:'source-material-ownership-before-area-assignment'}};
}
function audit(image,compiled){
 let violations=0;const counts={};for(const [p,id]of compiled.interior){const r=compiled.plan.regions[id],color='#'+image.data.subarray(p*4,p*4+3).toString('hex').toUpperCase();if(!r.colors.includes(color))violations++;counts[r.id]=(counts[r.id]||0)+1;}
 return {violations,checkedInteriorCells:compiled.interior.size,counts,visualTruth:'NOT_AUTOMATICALLY_DETERMINED'};
}
module.exports={readPlan,compile,assignSource,audit,policyHash};
