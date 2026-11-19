'use strict';
// Records and file lineage are checked here. Visual truth still needs inspection.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const CHECKS=[
 ['productionPremise','colorGroups','detailBudget','identity','pose','proportions','featureCapacity','simplification'],
 ['colorPlanes','skin','eyes','nose','mouth','hands','costume','outline','dotDesign'],
 ['grid','palette','mapping','savedReadback','lossInventory','outline'],
 ['scope','sourceSupport','preservation','requiredForms','result'],
 ['whole','face','skin','eyes','nose','mouth','hands','costume','outline','referenceFidelity']
];
const names=['characterization','pixel-design','grid-placement','detail-repair','visual-verification'];
const CAPACITY_CHECKS=['wholeContour','oneDotWidth','negativeSpace','requiredForms','sourceFidelity','comparison'];
const SIX_NAMES=[names[0],'pixel-capacity',...names.slice(1)];
const SIX_CHECKS=[CHECKS[0],CAPACITY_CHECKS,...CHECKS.slice(1)];
const ASSIGNMENT_CHECKS=['regionSeparation','boundaryConflicts','materialOwnership','allowedColors','featureExceptions','boundaryOwnership','ambiguity','comparison'];
const SEVEN_NAMES=[...SIX_NAMES.slice(0,3),'material-assignment',...SIX_NAMES.slice(3)];
const SEVEN_CHECKS=[...SIX_CHECKS.slice(0,3),ASSIGNMENT_CHECKS,...SIX_CHECKS.slice(3)];
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const DETAIL_CHECKS={
 skin:['basePlane','shading','featureSeparation','blushDecision'],
 eyes:['shape','gaze','flatRoles','reflectionCapacity'],
 nose:['position','tipVersusShadow','separation'],
 mouth:['position','expression','wholeCurve','interior'],
 hands:['pixelCapacity','contactBoundary','foldsAndGaps','skinPlanes'],
 outline:['sourceScope','localColor','width','continuity','curveFlow','junctions']
};
// Stage 3 is generated design intent, not a verified pixel grid. Stage 5 is the
// actual grid draft; its raster is reviewed before the mandatory export lock.
function detailChecksForStage(stage){
 if(stage===2)return {...DETAIL_CHECKS,outline:['sourceScope','localColor','continuity']};
 if(stage===3)return {outline:DETAIL_CHECKS.outline};
 if(stage===5)return DETAIL_CHECKS;
 return {};
}
const SAMPLERS={measured:['source-shared-boundaries','source-region-centers','measured-nearest','measured-cell-centers','measured-supported-ridges','measured-registered-cells'],
 'fixed-asset-grid':['area-vote','source-region-area']};
const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
// Lock the method at stage 1; bind observed source parameters at stage 2.
function executionOptions(route,config){
 const keys=route==='measured'
  ?['background','features','colorAssignment','observedDetails','referenceCorrection','boundaryCorrection','exteriorOutline','eyePolicy','pixelDecision','outlineDecision',...(config.sourceColorPolicy?['sourceColorPolicy']:[])]
  :['width','height','scale','background','protection','regions','structure','eyePolicy','formPolicy','outlinePolicy','gridPlacement','pixelDecision','outlineDecision','sourceToNative',...(config.materialPlan?['materialPlan']:[])];
 return Object.fromEntries(keys.map(k=>[k,config[k]??null]));
}
function validateExecution(plan){
 if(plan?.version!==1||!SAMPLERS[plan.route]?.includes(plan.sampling)||!Array.isArray(plan.operations)||new Set(plan.operations).size!==plan.operations.length)throw Error('Explicit execution plan with route, sampling and operation list required');
 if(Object.keys(plan).some(k=>!['version','route','sampling','operations','fixedGridUserRequest'].includes(k)))throw Error('Unknown execution-plan field; no implicit override or fallback switches');
 if(plan.route==='fixed-asset-grid'&&(typeof plan.fixedGridUserRequest!=='string'||!plan.fixedGridUserRequest.trim()))throw Error('Fixed asset grid requires the explicit user asset-size request; a guessed native size is not authorization');
 const allowed=['features','observedDetails','referenceCorrection','boundaryCorrection','exteriorOutline','protection','regions','structure','eyePolicy','formPolicy','outlinePolicy','sourceColorPolicy','materialPlan'];
 if(plan.operations.some(k=>!allowed.includes(k)))throw Error('Unknown planned operation');
}
function assertExecution(ledger,route,config){
 const plan=ledger?.stages?.[0]?.execution;
 validateExecution(plan);
 const options=ledger?.stages?.[ledger?.version===3?3:ledger?.version===2?2:1]?.executionOptions;
 if(plan.route!==route||plan.sampling!==config.sampling||JSON.stringify(stable(options))!==JSON.stringify(stable(executionOptions(route,config))))throw Error('Execution differs from locked stages: no implicit sampler, resize route or repair substitution; revise the plan and rerun affected stages');
 return {status:'MATCH',route,sampling:plan.sampling};
}
function assertStages(ledger,through,expected={}){
 const fail=(stage,message,status='UNVERIFIED')=>{const e=new Error(`Stage ${stage}: ${message}`);e.stage=stage;e.status=status;throw e;};
 const seven=ledger?.version===3,six=seven||ledger?.version===2,total=seven?7:six?6:5,designStage=six?3:2,optionsStage=seven?4:designStage;
 if(!Number.isInteger(through)||through<1||through>total)throw Error('Stage gate requires a stage from 1 to '+total);
 if(![1,2,3].includes(ledger?.version)||!Array.isArray(ledger.stages))fail(1,'stage record required');
 try{validateExecution(ledger.stages[0]?.execution);}catch(e){fail(1,e.message);}
 const asset=(a,n,label)=>{
  if(!a||!path.isAbsolute(a.path??'')||!/^[a-f0-9]{64}$/.test(a.sha256??''))fail(n,`${label}: absolute path and SHA256 required`);
  let b;try{b=fs.readFileSync(a.path);}catch{fail(n,`${label}: file unavailable`);}
  if(hash(b)!==a.sha256)fail(n,`${label}: file changed; repeat this stage and its successors`);
  return a.sha256;
 };
 let previous=null,reference=null,palette=null,grid=null,fullGrid=null;
 for(let i=0;i<through;i++){
  const n=i+1,s=ledger.stages[i],capacity=six&&n===2,assignment=seven&&n===4,semantic=seven&&n>4?n-2:six&&n>2?n-1:n;
  if(s?.stage!==n||s.name!==(seven?SEVEN_NAMES:six?SIX_NAMES:names)[i])fail(n,'missing, reordered or duplicate stage');
  if(s.status!=='PASS')fail(n,'stage has not passed',s.status==='FAIL'?'FAIL':'UNVERIFIED');
  if(typeof s.reviewer!=='string'||!s.reviewer.trim())fail(n,'reviewer required');
  const input=asset(s.input,n,'input'),output=asset(s.output,n,'output'),ref=asset(s.reference,n,'original reference');
  const pal=asset(s.palette,n,'fixed palette');
  if(!Array.isArray(s.grid?.canvas)||s.grid.canvas.length!==2||!s.grid.canvas.every(v=>Number.isInteger(v)&&v>0)||(!(six&&n===1)&&(!Number.isInteger(s.grid.cell)||s.grid.cell<1)))fail(n,'locked canvas and square cell size required');
  const g=JSON.stringify([s.grid.canvas,s.grid.cell]);
  if(i===0){
   if(input!==ref)fail(n,'characterization must start from the original');reference=ref;palette=pal;grid=g;fullGrid=JSON.stringify(stable(s.grid));
   const entries=require('./build-palette-native.cjs').parsePalette(JSON.parse(fs.readFileSync(s.palette.path))),allowed=new Set(entries.map(p=>p.hex.toUpperCase()));
   const groups=s.colorGroups;
   if(!Array.isArray(groups)||!groups.length||groups.some(group=>typeof group.role!=='string'||!group.role.trim()||!Array.isArray(group.colors)||!group.colors.length||group.colors.some(c=>typeof c!=='string'||!allowed.has(c.toUpperCase()))))fail(n,'colorGroups must assign named material/feature roles to existing fixed-palette colors');
   if(new Set(groups.map(group=>group.role)).size!==groups.length)fail(n,'duplicate color group role');
   if(new Set(groups.flatMap(group=>group.colors.map(c=>c.toUpperCase()))).size!==allowed.size)fail(n,'colorGroups must account for every fixed-palette entry');
  }
  else if(capacity){
   if(input!==previous||output!==input||ref!==reference||pal!==palette||JSON.stringify(s.grid.canvas)!==JSON.stringify(ledger.stages[0].grid.canvas))fail(n,'capacity selection must preserve characterization/reference/palette/canvas');
   assertCapacitySelection(s,ledger.stages[0],asset,fail);
   grid=g;fullGrid=JSON.stringify(stable(s.grid));
  }
  else if(input!==previous||ref!==reference||pal!==palette||g!==grid)fail(n,'input/reference/palette/grid differs from passed predecessor');
  if(i>0){
   if(JSON.stringify(stable(s.grid))!==fullGrid)fail(n,'grid origin, native count or other locked grid metadata changed');
   for(const key of ['execution','colorGroups'])if(s[key]!==undefined&&JSON.stringify(stable(s[key]))!==JSON.stringify(stable(ledger.stages[0][key])))fail(n,'later stage cannot override stage 1 '+key);
   if(n>optionsStage&&s.executionOptions!==undefined&&JSON.stringify(stable(s.executionOptions))!==JSON.stringify(stable(ledger.stages[optionsStage-1].executionOptions)))fail(n,'later stage cannot override stage '+optionsStage+' executionOptions');
  }
  if(!Array.isArray(s.evidence)||!s.evidence.length)fail(n,'saved comparison evidence required');
  s.evidence.forEach((a,j)=>asset(a,n,'evidence '+j));
  for(const key of (seven?SEVEN_CHECKS:six?SIX_CHECKS:CHECKS)[i]){
   const c=s.checks?.[key];
   if(c?.status!=='PASS'||typeof c.observation!=='string'||!c.observation.trim())fail(n,`${key}: inspected PASS and observation required`,c?.status==='FAIL'?'FAIL':'UNVERIFIED');
  }
  // An overall PASS cannot conceal an explicitly failed nested observation.
  const inspectStatuses=(value,location)=>{
   if(!value||typeof value!=='object')return;
   if(Object.hasOwn(value,'status')&&value.status!=='PASS')fail(n,`${location}: unresolved check cannot be overridden by a parent PASS`,value.status==='FAIL'?'FAIL':'UNVERIFIED');
   for(const [key,child] of Object.entries(value))if(child&&typeof child==='object')inspectStatuses(child,location+'.'+key);
  };
  inspectStatuses(s.checks,'checks');
  for(const [part,checks] of Object.entries((capacity||assignment)?{}:detailChecksForStage(semantic)))for(const key of checks){
   const c=s.checks?.[part]?.details?.[key];
   if(c?.status!=='PASS'||typeof c.observation!=='string'||!c.observation.trim())fail(n,`${part}.${key}: separate saved-image observation required`,c?.status==='FAIL'?'FAIL':'UNVERIFIED');
  }
  if(n===optionsStage){
   const plan=ledger.stages[0].execution,options=s.executionOptions;
   if(!options||JSON.stringify(stable(options))!==JSON.stringify(stable(executionOptions(plan.route,options))))fail(n,'complete executionOptions snapshot required');
   const operators=['features','observedDetails','referenceCorrection','boundaryCorrection','exteriorOutline','protection','regions','structure','eyePolicy','formPolicy','outlinePolicy','sourceColorPolicy','materialPlan'];
   for(const key of operators)if(options[key]!==null&&options[key]!==undefined&&(!Array.isArray(options[key])||options[key].length)&&!plan.operations.includes(key))fail(n,'unplanned operation: '+key);
  }
  if(assignment){
   if(input!==output)fail(n,'assignment observes the source; it cannot edit artwork');
   const a=s.assignment;if(!a||!a.plan||!a.map)fail(n,'compiled material plan/map required');
   asset(a.plan,n,'material plan');asset(a.map,n,'material ownership map');
   if(JSON.stringify(a.plan)!==JSON.stringify(s.executionOptions.materialPlan))fail(n,'executed plan differs from reviewed assignment');
   if(ledger.stages[0].execution.route!=='fixed-asset-grid'||ledger.stages[0].execution.sampling!=='source-region-area')fail(n,'material assignment currently requires the fixed source-region-area route; no silent bypass');
   try{const {PNG}=require(require.resolve('pngjs',{paths:[__dirname,process.cwd()]})),m=require('./material-assignment.cjs'),source=PNG.sync.read(fs.readFileSync(s.input.path)),pal=require('./build-palette-native.cjs').parsePalette(JSON.parse(fs.readFileSync(s.palette.path))),o=s.executionOptions;
    for(const eye of o.eyePolicy?.eyes??[]){const [x,y,w,h]=eye.rect;if(o.outlinePolicy?.observedStrokes?.roles.some(r=>{const[a,b,c,d]=r.rect;return x<a+c&&x+w>a&&y<b+d&&y+h>b;})&&!eye.sourcePolygon)fail(n,'eye/line search windows overlap: actual eye ownership polygon required before placement');}
    const compiled=m.compile(PNG,source,pal,s.grid.native[0],s.grid.native[1],m.readPlan(a.plan),{eyePolicy:o.eyePolicy,formPolicy:o.formPolicy,outlinePolicy:o.outlinePolicy});
    const map=PNG.sync.read(fs.readFileSync(a.map.path));if(map.width!==compiled.map.width||map.height!==compiled.map.height||!map.data.equals(compiled.map.data))fail(n,'ownership map differs from executable source plan');
   }catch(e){fail(n,e.message);}
  }
  if(!capacity&&!assignment&&semantic===4){
   if(!['modified','unchanged'].includes(s.action))fail(n,'explicit modified/unchanged decision required');
   if((s.action==='unchanged')!==(input===output))fail(n,'repair action does not match file changes');
  }
  if(!capacity&&!assignment&&semantic===5&&input!==output)fail(n,'verification cannot modify artwork; return to the responsible stage');
  previous=output;
 }
 if(expected.outputSha256&&previous!==expected.outputSha256)fail(through,'record output differs from current work');
 if(expected.pixelSourceSha256&&ledger.stages[designStage-1]?.output.sha256!==expected.pixelSourceSha256)fail(designStage,'pixel draft differs from conversion source');
 if(expected.paletteSha256&&palette!==expected.paletteSha256)fail(through,'palette differs from current conversion');
 if(expected.grid&&grid!==JSON.stringify([expected.grid.canvas,expected.grid.cell]))fail(through,'grid differs from current conversion');
 if(six&&through>=2&&expected.grid)for(const k of ['native','origin'])if(expected.grid[k]!==undefined&&JSON.stringify(expected.grid[k])!==JSON.stringify(ledger.stages[1].grid[k]))fail(through,'selected grid '+k+' differs from current conversion');
 if(expected.prefix){
  const p=expected.prefix;
  if(p.version!==ledger.version||!Array.isArray(p.stages)||p.stages.length>through)fail(through,'invalid earlier-stage snapshot');
  for(let i=0;i<p.stages.length;i++)if(JSON.stringify(p.stages[i])!==JSON.stringify(ledger.stages[i]))fail(i+1,'earlier-stage review changed after conversion');
 }
 return {status:'PASS',through,next:through===total?null:through+1,visualTruth:'NOT_AUTOMATICALLY_DETERMINED'};
}
// Existing entrypoints address semantic milestones (design=2, saved=3,
// repair=4, review=5). New production must include the separate capacity stage.
// Legacy assertStages remains available for read-only historical inspection.
function assertProductionStages(ledger,milestone,expected={}){
 if(ledger?.version!==3)throw Error('Seven-stage record required: material-assignment is mandatory; earlier records are audit-only');
 if(milestone!=='capacity'&&(!Number.isInteger(milestone)||milestone<1||milestone>5))throw Error('Invalid production milestone');
 const through=milestone==='capacity'?2:milestone===1?1:milestone+2;
 return assertStages(ledger,through,expected);
}
function assertCapacitySelection(stage,first,asset,fail){
 const s=stage.selection,n=2,text=v=>typeof v==='string'&&v.trim().length>0;
 const need=(ok,message)=>{if(!ok)fail(n,message);};
 need(s?.version===1&&text(s.reason),'explicit capacity selection and reason required');
 need(asset(s.source,n,'capacity source')===first.output.sha256&&asset(s.reference,n,'capacity reference')===first.reference.sha256,'capacity probes must use this characterization and original');
 need(Array.isArray(s.requiredBoundaries)&&s.requiredBoundaries.length&&s.requiredBoundaries.every(b=>text(b.id)&&text(b.observation)&&['exterior','contact'].includes(b.kind)),'required boundary inventory missing');
 const ids=s.requiredBoundaries.map(b=>b.id);need(new Set(ids).size===ids.length&&s.requiredBoundaries.some(b=>b.kind==='exterior'),'complete exterior boundary inventory required');
 const fixed=s.mode==='user-fixed';
 need(s.mode===undefined||s.mode==='compare'||fixed,'unknown capacity selection mode');
 if(fixed)need(text(first.execution?.fixedGridUserRequest),'fixed capacity needs explicit user grid request');
 need(Array.isArray(s.candidates)&&(fixed?s.candidates.length===1:s.candidates.length>=2),fixed?'user-fixed capacity must test exactly the requested grid':'compare at least two actual candidate grids');
 need(new Set(s.candidates.map(c=>c.id)).size===s.candidates.length&&s.candidates.every(c=>text(c.id)),'unique candidate ids required');
 const {PNG}=require(require.resolve('pngjs',{paths:[__dirname,process.cwd()]}));
 const {parsePalette,inspect}=require('./build-palette-native.cjs');
 const palette=parsePalette(JSON.parse(fs.readFileSync(stage.palette.path)));
 const bg=s.background;need(palette.some(p=>p.hex===bg),'capacity background must belong to fixed palette');
 for(const c of s.candidates){
  const g=c.grid;need(g&&JSON.stringify(g.canvas)===JSON.stringify(stage.grid.canvas)&&Number.isSafeInteger(g.cell)&&g.cell>0&&Array.isArray(g.native)&&g.native.length===2&&g.native.every(v=>Number.isSafeInteger(v)&&v>0)&&Array.isArray(g.origin)&&g.origin.length===2&&g.origin.every(v=>Number.isSafeInteger(v)),'candidate grid needs canvas/native/cell/origin');
  for(const key of ['native','expanded','outlineMask'])asset(c[key],n,'capacity '+c.id+' '+key);
  const native=PNG.sync.read(fs.readFileSync(c.native.path)),expanded=PNG.sync.read(fs.readFileSync(c.expanded.path)),mask=PNG.sync.read(fs.readFileSync(c.outlineMask.path));
  need(native.width===g.native[0]&&native.height===g.native[1]&&expanded.width===g.canvas[0]&&expanded.height===g.canvas[1]&&mask.width===native.width&&mask.height===native.height,'capacity PNG dimensions differ from declared grid');
  const bgRgba=parseInt(bg.slice(1)+'ff',16);
  for(let y=0;y<native.height;y++)for(let x=0;x<native.width;x++)if(native.data.readUInt32BE((y*native.width+x)*4)!==bgRgba)need(g.origin[0]+x*g.cell>=0&&g.origin[1]+y*g.cell>=0&&g.origin[0]+(x+1)*g.cell<=g.canvas[0]&&g.origin[1]+(y+1)*g.cell<=g.canvas[1],'candidate crops foreground capacity');
  const stats=inspect(native,palette);need(!stats.offPalettePixels&&!stats.partialAlphaPixels&&!stats.transparentPixels,'capacity native must use opaque fixed palette');
  need(require('./build-palette-native.cjs').verifyDisplay(native,expanded,{cell:g.cell,origin:g.origin},bg),'capacity preview is not the same exact square grid');
  need(Array.isArray(c.outlineColors)&&c.outlineColors.length&&c.outlineColors.every(color=>color!==bg&&palette.some(p=>p.hex===color)),'outline allocation needs fixed-palette ink colors distinct from background');
  const inkColors=new Set(c.outlineColors.map(color=>parseInt(color.slice(1)+'ff',16)));
  let ink=0;for(let p=0;p<mask.width*mask.height;p++){const rgba=mask.data.readUInt32BE(p*4);need(rgba===0x000000ff||rgba===0xffffffff,'outline mask must be opaque black/white');if(rgba===0xffffffff){ink++;need(inkColors.has(native.data.readUInt32BE(p*4)),'outline allocation mask does not match saved ink');}}
  need(ink>0&&c.outlineWidth===1,'capacity requires a visible one-dot outline allocation');
  need(['PASS','FAIL','UNVERIFIED'].includes(c.status)&&text(c.observation),'candidate verdict and actual observation required');
  need(Array.isArray(c.boundaries)&&c.boundaries.length===ids.length&&new Set(c.boundaries.map(b=>b.id)).size===ids.length&&c.boundaries.every(b=>ids.includes(b.id)),'candidate omitted a required boundary');
  for(const b of c.boundaries)for(const k of ['coverage','width','continuity','flow','clearance']){
   const v=b[k];need(['PASS','FAIL','UNVERIFIED'].includes(v?.status)&&text(v.observation),'separate boundary observation required: '+k);
   if(c.status==='PASS')need(v.status==='PASS','candidate PASS hides unresolved boundary '+b.id+'/'+k);
  }
  for(const k of CAPACITY_CHECKS){const v=c.checks?.[k];need(['PASS','FAIL','UNVERIFIED'].includes(v?.status)&&text(v.observation),'capacity candidate check required: '+k);if(c.status==='PASS')need(v.status==='PASS','candidate PASS hides unresolved capacity '+k);}
 }
 if(!fixed)need(new Set(s.candidates.map(c=>c.grid.cell)).size>=2,'same grid at different zoom is not a capacity comparison');
 const chosen=s.candidates.find(c=>c.id===s.selectedId);
 need(chosen?.status==='PASS'&&JSON.stringify(stable(chosen.grid))===JSON.stringify(stable(stage.grid)),'selected grid must pass and match the locked grid');
}
module.exports={assertStages,assertProductionStages,assertExecution,executionOptions,CHECKS,SIX_CHECKS,SIX_NAMES,CAPACITY_CHECKS,DETAIL_CHECKS,detailChecksForStage,names,SEVEN_NAMES,SEVEN_CHECKS,ASSIGNMENT_CHECKS};
if(require.main===module){try{
 const result=assertStages(JSON.parse(fs.readFileSync(process.argv[2])),Number(process.argv[3]));console.log(JSON.stringify(result));
}catch(e){console.log(JSON.stringify({status:e.status??'UNVERIFIED',stage:e.stage??null,error:e.message}));process.exitCode=1;}}
