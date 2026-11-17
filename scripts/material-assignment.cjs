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
 need(plan?.version===1&&Object.keys(plan).every(k=>['version','sourcePixelsSha256','paletteColors','grid','boundaryPolicySha256','observation','regions','protectedFeatures','inventory','unassigned','surfaces','preserveOutside'].includes(k)),'unsupported plan fields');
 need(text(plan.observation)&&plan.sourcePixelsSha256===hash(source.data),'source pixels changed');
 need(JSON.stringify(plan.paletteColors)===JSON.stringify(palette.map(p=>p.hex)),'palette changed');
 need(Number.isInteger(cell)&&cell>0&&sh/height===cell&&JSON.stringify(plan.grid)===JSON.stringify({native:[width,height],cell,canvas:[sw,sh],origin:[0,0]}),'fixed uniform grid changed');
 need(plan.boundaryPolicySha256===policyHash(policies),'boundary/feature policies changed after assignment');
 need(plan.unassigned==='preserve-existing-source-regions','unassigned pixels require explicit existing-route ownership');
 need(Array.isArray(plan.regions)&&Array.isArray(plan.protectedFeatures)&&Array.isArray(plan.inventory)&&plan.inventory.length,'regions, exceptions and whole-part inventory required');
 const validRect=r=>Array.isArray(r)&&r.length===4&&r.every(Number.isInteger)&&r[0]>=0&&r[1]>=0&&r[2]>0&&r[3]>0&&r[0]+r[2]<=sw&&r[1]+r[3]<=sh;
 const fixedCells=new Map();let preservedOutline=null;
 if(plan.preserveOutside){
  const keep=plan.preserveOutside;
  need(Object.keys(keep).every(k=>['baseline','baselineRun','sourcePixelsSha256','sourceRegions','observation','sourceEdit'].includes(k))&&text(keep.observation)&&keep.sourcePixelsSha256===hash(source.data),'preservation requires the same observed source');
  need(Array.isArray(keep.sourceRegions)&&keep.sourceRegions.length&&keep.sourceRegions.every(validRect),'preservation requires source-coordinate edit regions');
  need(keep.baseline&&text(keep.baseline.path)&&/^[a-f0-9]{64}$/.test(keep.baseline.sha256),'preserved baseline artifact required');
  const bytes=fs.readFileSync(keep.baseline.path);need(hash(bytes)===keep.baseline.sha256,'preserved baseline changed');
  const baseline=PNG.sync.read(bytes),allowed=new Set(palette.map(p=>parseInt(p.hex.slice(1)+'ff',16)));
  need(baseline.width===width&&baseline.height===height,'preserved baseline grid changed');
  need(keep.baselineRun&&text(keep.baselineRun.path),'preserved baseline requires its executed stroke evidence');
  const runBytes=fs.readFileSync(keep.baselineRun.path);need(hash(runBytes)===keep.baselineRun.sha256,'preserved baseline run changed');
  const run=JSON.parse(runBytes),sourceBytes=fs.readFileSync(run.source.path);
  need(hash(sourceBytes)===run.source.sha256&&run.native.sha256===keep.baseline.sha256,'preserved baseline has a different source or saved PNG');
  const previousSource=PNG.sync.read(sourceBytes);
  if(keep.sourceEdit){
   const edit=keep.sourceEdit;
   need(Object.keys(edit).every(k=>['baselineSourcePixelsSha256','observation'].includes(k))&&text(edit.observation)&&edit.baselineSourcePixelsSha256===hash(previousSource.data),'source edit requires the executed baseline source');
   need(previousSource.width===sw&&previousSource.height===sh&&keep.sourceRegions.every(r=>r.every(v=>v%cell===0)),'source edit must keep canvas and grid-aligned edit regions');
   const paletteBytes=fs.readFileSync(run.palette.path);
   need(hash(paletteBytes)===run.palette.sha256&&JSON.stringify(require('./build-palette-native.cjs').parsePalette(JSON.parse(paletteBytes)).map(p=>p.hex))===JSON.stringify(plan.paletteColors),'source edit must keep the baseline palette');
   for(let p=0;p<sw*sh;p++)if(source.data.readUInt32BE(p*4)!==previousSource.data.readUInt32BE(p*4)){
    const x=p%sw,y=Math.floor(p/sw);
    need(keep.sourceRegions.some(([a,b,w,h])=>x>=a&&x<a+w&&y>=b&&y<b+h),'source changed outside declared edit regions');
   }
  }else need(hash(previousSource.data)===hash(source.data),'preserved baseline has a different source or saved PNG');
  preservedOutline=run.outlineReport;
  need(require('./raster-owned-stroke-bands.cjs').auditRenderedStrokeBands(baseline,preservedOutline).status==='PASS','preserved baseline has no valid actual stroke audit');
  for(let p=0;p<width*height;p++){
   const c=baseline.data.readUInt32BE(p*4),x=p%width*cell,y=Math.floor(p/width)*cell;
   need(allowed.has(c),'preserved baseline is outside fixed opaque palette');
   if(!keep.sourceRegions.some(([a,b,w,h])=>x<a+w&&x+cell>a&&y<b+h&&y+cell>b))fixedCells.set(p,c);
  }
 }
 for(const f of plan.protectedFeatures){need(text(f.role)&&validRect(f.rect)&&text(f.observation),'invalid observed feature exception');if(f.sourcePolygon)need(Array.isArray(f.sourcePolygon)&&f.sourcePolygon.length>=3&&f.sourcePolygon.every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&p[0]>=f.rect[0]&&p[0]<=f.rect[0]+f.rect[2]&&p[1]>=f.rect[1]&&p[1]<=f.rect[1]+f.rect[3]),'invalid feature ownership polygon');}
 for(const eye of policies.eyePolicy?.eyes??[])if(eye.sourcePolygon)need(plan.protectedFeatures.some(f=>JSON.stringify(f.rect)===JSON.stringify(eye.rect)&&JSON.stringify(f.sourcePolygon)===JSON.stringify(eye.sourcePolygon)),'eye and material ownership shapes differ');
 const ids=new Set(),entries=new Map(palette.map(p=>[p.hex,p]));
 for(const r of plan.regions){
  need(Object.keys(r).every(k=>['id','material','polygon','colors','baseColor','observation','boundaryRoles','geometry'].includes(k)),'destination instructions or unknown region field');
  need(r.geometry===undefined||(r.geometry==='fill'&&r.material!=='background'&&r.boundaryRoles?.length===0),'explicit fill must be foreground material, without contradictory stroke roles');
  if(r.geometry==='fill')need(policies.outlinePolicy?.layout==='joint-source-band','explicit fill ownership requires joint-source-band');
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
 const surfaceIds=new Set(),surfaceRegions=new Set();
 for(const s of plan.surfaces??[]){
  need(Object.keys(s).every(k=>['id','regionIds','contourColor','observation'].includes(k))&&text(s.id)&&!surfaceIds.has(s.id)&&text(s.observation),'invalid or duplicate surface');surfaceIds.add(s.id);
  need(Array.isArray(s.regionIds)&&s.regionIds.length&&s.regionIds.every(id=>ids.has(id)&&!surfaceRegions.has(id)),'surface requires exclusive source regions');
  s.regionIds.forEach(id=>surfaceRegions.add(id));
  need((policies.outlinePolicy?.sourceStrokeColors??[]).includes(s.contourColor),'surface contour must use an observed stroke color');
  const members=plan.regions.filter(r=>s.regionIds.includes(r.id)),signature=r=>JSON.stringify([r.material,[...r.colors].sort(),r.baseColor]);
  need(members.every(r=>signature(r)===signature(members[0])),'one surface cannot merge different material contracts');
 }
 const owners=new Int16Array(sw*sh).fill(-1),exceptions=new Uint8Array(sw*sh),sourceExceptions=new Uint8Array(sw*sh),map=new PNG({width:sw,height:sh});
 // A feature owns every logical cell it touches. Protecting only part of a
 // source cell would still let area voting change the feature's boundary.
 const forms=(policies.formPolicy?.features??[]).filter(f=>f.kind==='stroke');
 for(const f of forms)need(validRect(f.sourceRegion),'invalid source stroke region');
 const features=[...plan.protectedFeatures,...forms.filter(f=>!plan.protectedFeatures.some(p=>JSON.stringify(p.rect)===JSON.stringify(f.sourceRegion))).map(f=>({rect:f.sourceRegion}))];
 for(const f of features){const [x,y,w,h]=f.rect,touched=new Set(),form=forms.find(p=>JSON.stringify(p.sourceRegion)===JSON.stringify(f.rect));
  const isStroke=form?require('./raster-observed-details.cjs').sourceStrokeClassifier(form):null;
  for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++)if((!f.sourcePolygon||inside(xx+.5,yy+.5,f.sourcePolygon))&&(!isStroke||isStroke([...source.data.subarray((yy*sw+xx)*4,(yy*sw+xx)*4+3)]))){sourceExceptions[yy*sw+xx]=1;touched.add(Math.floor(yy/cell)*width+Math.floor(xx/cell));}
  for(const p of touched)for(let yy=Math.floor(p/width)*cell;yy<(Math.floor(p/width)+1)*cell;yy++)for(let xx=p%width*cell;xx<(p%width+1)*cell;xx++)exceptions[yy*sw+xx]=1;
 }
 plan.regions.forEach((r,index)=>{
  const xs=r.polygon.map(p=>p[0]),ys=r.polygon.map(p=>p[1]);
  for(let y=Math.floor(Math.min(...ys));y<Math.ceil(Math.max(...ys));y++)for(let x=Math.floor(Math.min(...xs));x<Math.ceil(Math.max(...xs));x++)if(inside(x+.5,y+.5,r.polygon)){
   const p=y*sw+x;need(owners[p]<0,'overlapping material observations must be resolved before placement');owners[p]=index;
   for(const name of r.boundaryRoles){const role=(policies.outlinePolicy.boundaryObservations??policies.outlinePolicy.observedStrokes).roles.find(role=>role.name===name),[a,b,c,d]=role.rect;
    if(x>=a&&x<a+c&&y>=b&&y<b+d&&require('./raster-source-ink-paths.cjs').matchesObservedInk([...source.data.subarray(p*4,p*4+3)],role)){exceptions[p]=1;sourceExceptions[p]=1;}
   }
  }
 });
 // Only an observed connected surface joins its observation fragments.
 // Equal colors/material alone do not prove two objects share one surface.
 const groups=new Map(),regionGroups=plan.regions.map(r=>{
  const surface=plan.surfaces?.find(s=>s.regionIds.includes(r.id));
  const key=surface?'surface:'+surface.id:'region:'+r.id;
  if(!groups.has(key))groups.set(key,groups.size);return groups.get(key);
 });
 const interior=new Map();
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  let owner=owners[y*cell*sw+x*cell],complete=owner>=0;
  for(let yy=y*cell;yy<(y+1)*cell;yy++)for(let xx=x*cell;xx<(x+1)*cell;xx++)if(owners[yy*sw+xx]<0||regionGroups[owners[yy*sw+xx]]!==regionGroups[owner]||exceptions[yy*sw+xx])complete=false;
  if(complete){const p=y*width+x;interior.set(p,owner);}
 }
 for(let p=0;p<owners.length;p++)map.data.set(exceptions[p]?[255,255,255,255]:owners[p]>=0?[53+(regionGroups[owners[p]]*73)%170,137,190,255]:[65,65,65,255],p*4);
 const sourceFills=new Uint8Array(sw*sh);
 for(let p=0;p<owners.length;p++)if(owners[p]>=0&&plan.regions[owners[p]].geometry==='fill'&&!sourceExceptions[p])sourceFills[p]=1;
 // Source observation fragments are not separate colors competing for a cell.
 // A majority of one declared fill family creates a saved-material obligation;
 // this does not claim anatomical connectivity or invent an output outline.
 const fillVotes=new Map(),fillCells=new Map();
 for(let p=0;p<owners.length;p++)if(sourceFills[p]&&!exceptions[p]){
  const r=plan.regions[owners[p]],q=Math.floor(p/sw/cell)*width+Math.floor(p%sw/cell),key=JSON.stringify([r.material,[...r.colors].sort()]);
  if(!fillVotes.has(q))fillVotes.set(q,new Map());const votes=fillVotes.get(q);
  if(!votes.has(key))votes.set(key,{count:0,colors:r.colors});votes.get(key).count++;
 }
 for(const[p,votes]of fillVotes)for(const vote of votes.values())if(vote.count>cell*cell/2)fillCells.set(p,vote.colors);
 return {plan,owners,regionGroups,exceptions,sourceExceptions,sourceFills,fillCells,interior,map,fixedCells,preservedOutline};
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
 const lostFillCells=[];for(const[p,colors]of compiled.fillCells??[]){const color='#'+image.data.subarray(p*4,p*4+3).toString('hex').toUpperCase();if(!colors.includes(color))lostFillCells.push(p);}
 let changedPreservedPixels=0;for(const[p,c]of compiled.fixedCells??[])if(image.data.readUInt32BE(p*4)!==c)changedPreservedPixels++;
 return {violations:violations+changedPreservedPixels+lostFillCells.length,changedPreservedPixels,checkedPreservedCells:compiled.fixedCells?.size??0,checkedInteriorCells:compiled.interior.size,checkedFillCells:compiled.fillCells?.size??0,lostFillCells,counts,visualTruth:'NOT_AUTOMATICALLY_DETERMINED'};
}
module.exports={readPlan,compile,assignSource,audit,policyHash};
