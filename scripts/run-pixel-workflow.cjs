#!/usr/bin/env node
'use strict';

// The only delivery-export path. Candidate generation never creates a delivery.
// Human/model visual observations remain necessary; this is not aesthetic recognition.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { buildNative, parsePalette, inspect, enlarge, exactBlocks } = require('./build-palette-native.cjs');
const { checkDelivery } = require('./check-delivery.cjs');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const read = p => JSON.parse(fs.readFileSync(p));
const write = (p, value) => fs.writeFileSync(p, JSON.stringify(value, null, 2)+'\n', {flag:'wx'});
const need = (ok, message) => { if (!ok) throw new Error(message); };
const artifact = p => ({path:path.resolve(p), sha256:hash(fs.readFileSync(p))});
// Fingerprint every shipped runtime module; tests never participate in rendering.
const converters = () => [...fs.readdirSync(__dirname).filter(n => n.endsWith('.cjs') && !n.startsWith('test-')).sort(), '../SKILL.md', '../references/workflow.md', '../references/input-contract.md', '../package.json', '../package-lock.json']
  .map(n => artifact(path.join(__dirname, n)));
function checkArtifact(a) {
  need(a && path.isAbsolute(a.path) && /^[a-f0-9]{64}$/.test(a.sha256), 'Absolute path and SHA256 required');
  need(hash(fs.readFileSync(a.path)) === a.sha256, 'Changed artifact: '+a.path);
}
function sourceGate(contract, PNG) {
  need(!contract.redesign && !contract.measuredConversion && !contract.mode, 'Retired conversion route; create a fresh eight-stage fixed-grid run');
  require('./stage-gates.cjs').assertProductionStages(contract.stageChecks,2,{pixelSourceSha256:contract.source?.sha256,paletteSha256:contract.palette?.sha256,grid:{canvas:[contract.width*contract.scale,contract.height*contract.scale],cell:contract.scale,native:[contract.width,contract.height],origin:[0,0]}});
  need(contract.stageChecks?.stages?.[0]?.execution?.sampling === 'source-region-area', 'Production requires source-region-area');
  require('./eye-plane-policy.cjs').assertEyePolicy(contract.eyePolicy,parsePalette(read(contract.palette.path)));
  need(contract.eyePolicy.visibility!=='visible'||contract.eyePolicy.placement==='source-partitions','New visible-eye production requires observed source-partitions; color cleanup alone cannot approve eye shape');
    need(contract.eyePolicy.visibility!=='visible'||contract.eyePolicy.geometryPolicy==='source-stroke-fill','New visible-eye production requires explicit source-stroke-fill geometry; protected eyes are not exempt from stroke checks');
    need(!contract.formPolicy?.features?.some(f=>f.kind==='stroke')||contract.formPolicy.placement==='source-path','New internal stroke production requires source-path placement');
    need(!contract.formPolicy?.features?.some(f=>f.kind==='stroke'&&f.priority==='required'&&!f.curve),'Required internal strokes need observed curve landmarks before production');
  need(contract.version===1 && ['character','other'].includes(contract.kind), 'Explicit contract version/kind required');
  checkArtifact(contract.source); checkArtifact(contract.palette);
  const planned=read(contract.palette.path).sourceRolePlanning;
  if(planned)need(planned.allRolesRepresented===true&&Array.isArray(planned.roleCoverage)&&planned.roleCoverage.length>0&&planned.roleCoverage.every(r=>r.represented===true),'Palette leaves required source colors unrepresented');
  const s=contract.sourceAssessment;
  need(s?.status==='READY_FOR_CONVERSION' && s.sourceSha256===contract.source.sha256 &&
    typeof s.observation==='string' && s.observation.trim(), 'Source assessment missing, stale or not ready');
  need(s.representation==='illustration',
    'Single-grid production requires a non-pixel illustration; approximate pixel art must not be rasterized again. Preserve native-grid assets through their original export path.');
  need(contract.stageChecks.stages[1].output.sha256===contract.source.sha256,
    'Single-grid capacity and assignment must observe the same illustration; a regenerated source requires fresh capacity evidence');
  const fixed=require('./build-palette-native.cjs').assertFixedGridPlacement(contract,PNG.sync.read(fs.readFileSync(contract.source.path)));
  need(fixed, 'Production requires an explicit locked fixed-asset-grid mapping');
  if(contract.outlinePolicy)need(fixed&&contract.outlineDecision?.width===1&&contract.outlineDecision.mode==='continuous'&&contract.outlineDecision.colorPolicy==='darker-local-material',
    'Source ink width policy requires an explicit one-cell material-colored continuous outline decision');
  need(Array.isArray(contract.features) && contract.features.length, 'Source feature inventory required');
  if(contract.kind==='character') for(const role of ['eyes','nose','mouth','skin','outline'])
    need(contract.features.some(f=>f.id===role && f.sourceObservation && f.criterion), 'Missing character criterion: '+role);
  const size=PNG.sync.read(fs.readFileSync(contract.source.path));
  require('./feature-placement.cjs').assertFeaturePlacement(contract,parsePalette(read(contract.palette.path)),[size.width,size.height]);
}
function prepare(jobPath, outputDir, PNG) {
  const job=read(jobPath), contract=read(job.contract);
  sourceGate(contract, PNG);
  require('./stage-gates.cjs').assertExecution(contract.stageChecks,'fixed-asset-grid',{...contract,...job});
  // Source-region-area stabilizes source colors, then uses the same area cells
  // and source-to-native mapping. It is explicit, never an automatic fallback.
  if(contract.gridPlacement)need(['area-vote','source-region-area'].includes(job.sampling)&&!job.structure,'Fixed grid placement uses categorical area assignment without stacked repair; review details separately');
  need(!fs.existsSync(outputDir), 'Run directory must be new; preserve previous runs');
  need(!job.protection && !job.regions, 'Use reviewed source structure; unsupported pass cannot be silently ignored');
  const palette=parsePalette(read(contract.palette.path)), source=PNG.sync.read(fs.readFileSync(contract.source.path));
  const planned=read(contract.palette.path).sourceRolePlanning;
  if(planned)need(planned.sourcePixelsSha256===hash(source.data)&&JSON.stringify(planned.sourceSize)===JSON.stringify([source.width,source.height]),'Palette source-role plan belongs to different source pixels');
  need(palette.length===contract.paletteCount, 'Palette entry count mismatch');
  const args=[PNG,source,palette,contract.width,contract.height,job.background];
  const trace=require('./conversion-trace.cjs').createTrace(path.join(outputDir,'diagnostics'),{contract:artifact(job.contract),job:artifact(jobPath),source:contract.source,palette:contract.palette,materialPlan:contract.materialPlan??null,grid:contract.gridPlacement,converters:converters()});
  let built;try{
    built=buildNative(...args,job.sampling??'area-vote',null,null,job.structure??null,contract.eyePolicy,contract.formPolicy??null,contract.outlinePolicy??null,contract.materialPlan??null,trace.record);
    const planned=read(contract.stageChecks.stages[4].layout.path).layouts;
    const executed=(built.outlineReport?.surfaceLayout??[]).filter(s=>s.jointLayout).map(s=>s.jointLayout);
    need(JSON.stringify(executed)===JSON.stringify(planned),'Rendered line-plane allocation differs from the reviewed stage 5 plan');
    built.featurePlacement=require('./feature-placement.cjs').measureFeaturePlacement(contract,built.image,built.formReport);
    trace.finish('CONVERSION_COMPLETED_REQUIRES_VISUAL_REVIEW');
  }catch(error){trace.finish('CONVERSION_FAILED',error.message);throw error;}
  const {fit}=built, map=contract.sourceToNative;
  need(map && Math.abs(map.scaleX-fit.fitWidth/source.width)<1e-12 && Math.abs(map.scaleY-fit.fitHeight/source.height)<1e-12 &&
    map.offsetX===fit.offsetX && map.offsetY===fit.offsetY, 'Contract and conversion coordinates differ');
  fs.mkdirSync(outputDir,{recursive:true});
  const put=(name,im)=>{const p=path.join(outputDir,name);fs.writeFileSync(p,PNG.sync.write(im),{flag:'wx'});return artifact(p);};
  const baseline=put('control.native.png',buildNative(...args,'nearest').image);
  const native=put('candidate.native.png',built.image), expanded=put('candidate@'+contract.scale+'x.png',enlarge(PNG,built.image,contract.scale));
  const saved=PNG.sync.read(fs.readFileSync(native.path)), big=PNG.sync.read(fs.readFileSync(expanded.path)), stats=inspect(saved,palette);
  need(!stats.offPalettePixels&&!stats.partialAlphaPixels&&!stats.transparentPixels&&exactBlocks(saved,big,contract.scale),'Saved candidate failed technical check');
  const contractPath=path.join(outputDir,'contract.json');write(contractPath,contract);
  const input=path.join(outputDir,'conversion.json');write(input,job);
  const manifest={version:2,status:'GRID_DRAFT_AWAITING_REVIEW',contract:artifact(contractPath),conversion:artifact(input),
    source:contract.source,palette:contract.palette,baseline,native,expanded,converters:converters(),stats,fit,
    materialReport:built.materialReport??null,structureReport:built.structureReport??null,sourceRegionReport:built.sourceRegionReport??null,shapeRasterReport:built.shapeRasterReport??null,eyePolicyReport:built.eyePolicyReport,formReport:built.formReport??null,featurePlacement:built.featurePlacement,outlineReport:built.outlineReport??null,
    savedEyeAudit:require('./eye-plane-policy.cjs').auditEyePolicy(PNG,source,saved,palette,contract.eyePolicy,require('./eye-plane-policy.cjs').affineEyeGrid(source,saved,fit),built.materialContext),manualOutputEdits:0};
  write(path.join(outputDir,'run.json'),manifest);
  const pending=()=>({status:'UNVERIFIED',observation:'Direct comparison of saved PNG against source required.',evidence:[],comparison:{sourceRegion:null,difference:'',criterion:'',reason:''}});
  write(path.join(outputDir,'review.pending.json'),{version:1,reviewer:'',contractSha256:manifest.contract.sha256,
    native,expanded,evidence:[],sourceReview:pending(),eyeReview:{flatColors:pending(),shape:pending(),reflection:pending()},features:[...contract.features.map(f=>f.id),'$whole'].map(id=>({id,clarity:pending(),fidelity:pending()})),
    views:{native:pending(),zoom:pending(),display:pending()},
    gridDraft:{native,expanded,grid:{native:[contract.width,contract.height],cell:contract.scale,canvas:[contract.width*contract.scale,contract.height*contract.scale],origin:[0,0]},sourceComparison:pending(),visual:pending()},
    findings:(contract.requiredFindings??[]).map(id=>({id,status:'UNVERIFIED',description:'Required finding needs verification.'}))});
  return manifest;
}
function lock(runDir, reviewPath, PNG) {
  const manifest=read(path.join(runDir,'run.json'));
  need(manifest.version===2 && manifest.status==='GRID_DRAFT_AWAITING_REVIEW', 'Fresh grid-draft run required; legacy runs are audit-only');
  const locked=path.join(runDir,'locked-draft');
  need(!fs.existsSync(locked), 'Grid draft already locked; changed design requires a new run');
  for(const a of [manifest.contract,manifest.conversion,manifest.source,manifest.palette,manifest.baseline,manifest.native,manifest.expanded,...manifest.converters])checkArtifact(a);
  const contract=read(manifest.contract.path);sourceGate(contract, PNG);
  require('./stage-gates.cjs').assertExecution(contract.stageChecks,'fixed-asset-grid',{...contract,...read(manifest.conversion.path)});
  need(contract.source.sha256===manifest.source.sha256&&contract.palette.sha256===manifest.palette.sha256,'Manifest source/palette differs from locked contract');
  need(JSON.stringify(manifest.converters)===JSON.stringify(converters()),'Conversion or gate code changed; run conversion again');
  const review=read(reviewPath);
  need(review.native?.path===manifest.native.path&&review.native?.sha256===manifest.native.sha256&&
    review.expanded?.path===manifest.expanded.path&&review.expanded?.sha256===manifest.expanded.sha256,'Review must reference this exact generated candidate');
  const draft=review.gridDraft, grid={native:[contract.width,contract.height],cell:contract.scale,canvas:[contract.width*contract.scale,contract.height*contract.scale],origin:[0,0]};
  need(draft && JSON.stringify(draft.native)===JSON.stringify(manifest.native) && JSON.stringify(draft.expanded)===JSON.stringify(manifest.expanded) &&
    JSON.stringify(draft.grid)===JSON.stringify(grid), 'Grid-draft review must bind the actual native PNG, integer display and locked grid');
  const gate=checkDelivery(manifest.contract.path,reviewPath,PNG);
  const gatePath=path.join(runDir,'gate-'+hash(fs.readFileSync(reviewPath)).slice(0,16)+'.json');
  if(!fs.existsSync(gatePath))write(gatePath,gate);
  if(gate.status!=='READY_FOR_USER_REVIEW')return{status:gate.status,exported:false,gate:gatePath,issues:gate.issues};
  // Provenance replay happens BEFORE locking. After this boundary no renderer
  // or source contour extraction is allowed in finalize/verify.
  const job=read(manifest.conversion.path), source=PNG.sync.read(fs.readFileSync(contract.source.path)), palette=parsePalette(read(contract.palette.path));
  const replay=buildNative(PNG,source,palette,contract.width,contract.height,job.background,job.sampling??'area-vote',null,null,job.structure??null,contract.eyePolicy,contract.formPolicy??null,contract.outlinePolicy??null,contract.materialPlan??null);
  const saved=PNG.sync.read(fs.readFileSync(manifest.native.path));
  need(replay.image.data.equals(saved.data),'Candidate differs from deterministic conversion replay');
  need(JSON.stringify(replay.outlineReport??null)===JSON.stringify(manifest.outlineReport),'Stored stroke provenance differs from the executed conversion');
  fs.mkdirSync(locked);
  const nativePath=path.join(locked,'native.png'), expandedPath=path.join(locked,'display.png');
  fs.copyFileSync(manifest.native.path,nativePath,fs.constants.COPYFILE_EXCL);
  fs.copyFileSync(manifest.expanded.path,expandedPath,fs.constants.COPYFILE_EXCL);
  const lockPath=path.join(locked,'lock.json');
  write(lockPath,{version:1,status:'LOCKED_GRID_DRAFT',run:artifact(path.join(runDir,'run.json')),review:artifact(reviewPath),gate:artifact(gatePath),
    native:artifact(nativePath),expanded:artifact(expandedPath),grid,pixelSha256:hash(saved.data)});
  readLockedDraft(runDir,PNG);
  return{status:'LOCKED_GRID_DRAFT',locked:true,lock:lockPath,native:nativePath,expanded:expandedPath};
}
// Validate immutable provenance and the ACTUAL locked raster. This path must
// remain free of buildNative/checkDelivery/outline allocation calls.
function readLockedDraft(runDir,PNG) {
  const lockPath=path.join(runDir,'locked-draft','lock.json');
  need(fs.existsSync(lockPath),'Reviewed grid draft must be locked before export');
  const locked=read(lockPath);
  need(locked.version===1 && locked.status==='LOCKED_GRID_DRAFT','Invalid grid-draft lock');
  for(const a of [locked.run,locked.review,locked.gate,locked.native,locked.expanded])checkArtifact(a);
  need(path.resolve(locked.run.path)===path.resolve(runDir,'run.json'),'Grid lock belongs to another run');
  const m=read(locked.run.path);
  need(m.version===2 && m.status==='GRID_DRAFT_AWAITING_REVIEW','Fresh grid-draft run required');
  for(const a of [m.contract,m.conversion,m.source,m.palette,m.baseline,m.native,m.expanded,...m.converters])checkArtifact(a);
  need(JSON.stringify(m.converters)===JSON.stringify(converters()),'Conversion or gate code changed; create a new grid draft');
  need(locked.native.sha256===m.native.sha256 && locked.expanded.sha256===m.expanded.sha256,'Locked draft differs from reviewed grid pixels');
  const c=read(m.contract.path),review=read(locked.review.path),gate=read(locked.gate.path);
  need(gate.status==='READY_FOR_USER_REVIEW' && gate.reviewSha256===locked.review.sha256 && gate.contractSha256===m.contract.sha256,'Grid lock has no matching passed review');
  const grid={native:[c.width,c.height],cell:c.scale,canvas:[c.width*c.scale,c.height*c.scale],origin:[0,0]};
  need(JSON.stringify(locked.grid)===JSON.stringify(grid) && JSON.stringify(review.gridDraft?.grid)===JSON.stringify(grid),'Locked grid changed');
  need(review.native.sha256===m.native.sha256 && review.expanded.sha256===m.expanded.sha256,'Locked review belongs to other pixels');
  const native=PNG.sync.read(fs.readFileSync(locked.native.path)),expanded=PNG.sync.read(fs.readFileSync(locked.expanded.path)),palette=parsePalette(read(m.palette.path)),stats=inspect(native,palette);
  need(native.width===c.width && native.height===c.height && palette.length===c.paletteCount && !stats.offPalettePixels && !stats.partialAlphaPixels && !stats.transparentPixels && exactBlocks(native,expanded,c.scale),'Locked draft violates fixed grid or palette');
  need(hash(native.data)===locked.pixelSha256,'Locked pixel array changed');
  let strokeAudit=null;
  if(c.outlinePolicy){
    strokeAudit=require('./raster-owned-stroke-bands.cjs').auditRenderedStrokeBands(native,m.outlineReport);
    require('./raster-owned-stroke-bands.cjs').requireRenderedStrokeAudit(strokeAudit);
  }
  return{locked,lockPath,manifest:m,contract:c,native,expanded,strokeAudit};
}
function finalize(runDir,reviewPath,PNG) {
  const {locked,lockPath,native,expanded,strokeAudit}=readLockedDraft(runDir,PNG);
  need(path.resolve(reviewPath)===path.resolve(locked.review.path) && artifact(reviewPath).sha256===locked.review.sha256,'Final export requires the locked grid review; changed review requires a new run');
  const delivery=path.join(runDir,'delivery');
  need(!fs.existsSync(delivery),'Delivery already exists; revalidate it with verify, never overwrite');
  fs.mkdirSync(delivery);
  const nativePath=path.join(delivery,'native.png'),expandedPath=path.join(delivery,'display.png');
  fs.copyFileSync(locked.native.path,nativePath,fs.constants.COPYFILE_EXCL);
  fs.copyFileSync(locked.expanded.path,expandedPath,fs.constants.COPYFILE_EXCL);
  need(PNG.sync.read(fs.readFileSync(nativePath)).data.equals(native.data) && PNG.sync.read(fs.readFileSync(expandedPath)).data.equals(expanded.data),'Saved output differs from locked grid draft');
  const receipt={version:1,status:'READY_FOR_USER_REVIEW',userAcceptance:'NOT_ASSESSED',
    run:locked.run,review:locked.review,gate:locked.gate,gridLock:artifact(lockPath),
    draftPreservation:{status:'PASS',changedNativePixels:0,changedDisplayPixels:0,mode:'byte-copy-only',strokeAudit},
    native:artifact(nativePath),expanded:artifact(expandedPath)};
  const reviewed=read(locked.review.path).stageChecks,previous=reviewed.stages[6];
  receipt.stageChecks={version:4,stages:[...reviewed.stages.slice(0,7),{...previous,stage:8,name:'saved-verification',input:locked.native,output:receipt.native,evidence:[receipt.native,receipt.expanded],reviewer:'immutable saved-raster verifier',checks:{savedReadback:{status:'PASS',observation:'Read saved PNGs and compared all native and expanded pixel bytes.'},immutableCopy:{status:'PASS',observation:'Export copied the locked files without invoking conversion.'}}}]};
  require('./stage-gates.cjs').assertSavedStage(receipt.stageChecks,reviewed);
  write(path.join(delivery,'receipt.json'),receipt);
  return{status:receipt.status,exported:true,receipt:path.join(delivery,'receipt.json'),native:nativePath,expanded:expandedPath};
}
function verify(runDir,PNG) {
  const receipt=read(path.join(runDir,'delivery','receipt.json'));
  for(const a of [receipt.run,receipt.review,receipt.gate,receipt.gridLock,receipt.native,receipt.expanded])checkArtifact(a);
  const {locked,lockPath,native,expanded,strokeAudit}=readLockedDraft(runDir,PNG);
  require('./stage-gates.cjs').assertSavedStage(receipt.stageChecks,read(locked.review.path).stageChecks);
  need(path.resolve(receipt.gridLock.path)===path.resolve(lockPath),'Receipt references a different grid lock');
  for(const k of ['run','review','gate','native','expanded'])need(receipt[k].sha256===locked[k].sha256,'Delivery differs from locked '+k);
  need(PNG.sync.read(fs.readFileSync(receipt.native.path)).data.equals(native.data) && PNG.sync.read(fs.readFileSync(receipt.expanded.path)).data.equals(expanded.data),'Delivery raster differs from locked draft');
  return{status:'READY_FOR_USER_REVIEW',receiptValid:true,userAcceptance:'NOT_ASSESSED',draftPreservation:{status:'PASS',changedNativePixels:0,changedDisplayPixels:0},strokeAudit,native:receipt.native.path,expanded:receipt.expanded.path};
}
module.exports={prepare,lock,finalize,verify};
if(require.main===module){try{
  const {PNG}=require(require.resolve('pngjs',{paths:[__dirname,process.cwd()]}));
  const [mode,a,b]=process.argv.slice(2);let result;
  if(mode==='prepare'&&a&&b)result=prepare(path.resolve(a),path.resolve(b),PNG);
  else if(mode==='lock'&&a&&b)result=lock(path.resolve(a),path.resolve(b),PNG);
  else if(mode==='finalize'&&a&&b)result=finalize(path.resolve(a),path.resolve(b),PNG);
  else if(mode==='verify'&&a&&!b)result=verify(path.resolve(a),PNG);
  else throw new Error('Usage: run-pixel-workflow.cjs prepare job.json NEW_RUN_DIR | lock RUN_DIR review.json | finalize RUN_DIR review.json | verify RUN_DIR');
  console.log(JSON.stringify(mode==='prepare'?{status:result.status,native:result.native.path,stats:result.stats}:result,null,2));
  if((mode==='finalize'&&!result.exported)||(mode==='lock'&&!result.locked))process.exitCode=1;
}catch(error){console.log(JSON.stringify({status:'BLOCKED',exported:false,error:error.message}));process.exitCode=2;}}
