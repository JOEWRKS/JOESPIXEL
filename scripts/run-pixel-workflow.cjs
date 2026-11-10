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
const converters = () => [...fs.readdirSync(__dirname).filter(n => n.endsWith('.cjs') && !n.startsWith('test-')).sort(), '../references/workflow-rules.json', '../package.json', '../package-lock.json']
  .map(n => artifact(path.join(__dirname, n)));
function checkArtifact(a) {
  need(a && path.isAbsolute(a.path) && /^[a-f0-9]{64}$/.test(a.sha256), 'Absolute path and SHA256 required');
  need(hash(fs.readFileSync(a.path)) === a.sha256, 'Changed artifact: '+a.path);
}
function sourceGate(contract, PNG) {
  need(!contract.redesign && !contract.measuredConversion && !contract.mode, 'Retired conversion route; create a fresh seven-stage fixed-grid run');
  require('./stage-gates.cjs').assertProductionStages(contract.stageChecks,2,{pixelSourceSha256:contract.source?.sha256,paletteSha256:contract.palette?.sha256,grid:{canvas:[contract.width*contract.scale,contract.height*contract.scale],cell:contract.scale,native:[contract.width,contract.height],origin:[0,0]}});
  need(contract.stageChecks?.stages?.[0]?.execution?.sampling === 'source-region-area', 'Production requires source-region-area');
  require('./eye-plane-policy.cjs').assertEyePolicy(contract.eyePolicy,parsePalette(read(contract.palette.path)));
  need(contract.version===1 && ['character','other'].includes(contract.kind), 'Explicit contract version/kind required');
  checkArtifact(contract.source); checkArtifact(contract.palette);
  const planned=read(contract.palette.path).sourceRolePlanning;
  if(planned)need(planned.allRolesRepresented===true&&Array.isArray(planned.roleCoverage)&&planned.roleCoverage.length>0&&planned.roleCoverage.every(r=>r.represented===true),'Palette leaves required source colors unrepresented');
  const s=contract.sourceAssessment;
  need(s?.status==='READY_FOR_CONVERSION' && s.sourceSha256===contract.source.sha256 &&
    typeof s.observation==='string' && s.observation.trim(), 'Source assessment missing, stale or not ready');
  need(['illustration','pixel-designed','native-grid'].includes(s.representation),
    'Source representation required: illustration, pixel-designed, or native-grid');
  const fixed=require('./build-palette-native.cjs').assertFixedGridPlacement(contract,PNG.sync.read(fs.readFileSync(contract.source.path)));
  need(fixed, 'Production requires an explicit locked fixed-asset-grid mapping');
  if(contract.outlinePolicy)need(fixed&&contract.outlineDecision?.width===1&&contract.outlineDecision.mode==='continuous'&&contract.outlineDecision.colorPolicy==='darker-local-material',
    'Source ink width policy requires an explicit one-cell material-colored continuous outline decision');
  need(Array.isArray(contract.features) && contract.features.length, 'Source feature inventory required');
  if(contract.kind==='character') for(const role of ['eyes','nose','mouth','skin','outline'])
    need(contract.features.some(f=>f.id===role && f.sourceObservation && f.criterion), 'Missing character criterion: '+role);
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
  const built=buildNative(...args,job.sampling??'area-vote',null,null,job.structure??null,contract.eyePolicy,contract.formPolicy??null,contract.outlinePolicy??null,contract.materialPlan??null);
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
  const manifest={version:1,status:'AWAITING_REVIEW',contract:artifact(contractPath),conversion:artifact(input),
    source:contract.source,palette:contract.palette,baseline,native,expanded,converters:converters(),stats,fit,
    materialReport:built.materialReport??null,structureReport:built.structureReport??null,sourceRegionReport:built.sourceRegionReport??null,shapeRasterReport:built.shapeRasterReport??null,eyePolicyReport:built.eyePolicyReport,formReport:built.formReport??null,outlineReport:built.outlineReport??null,
    savedEyeAudit:require('./eye-plane-policy.cjs').auditEyePolicy(PNG,source,saved,palette,contract.eyePolicy,require('./eye-plane-policy.cjs').affineEyeGrid(source,saved,fit)),manualOutputEdits:0};
  write(path.join(outputDir,'run.json'),manifest);
  const pending=()=>({status:'UNVERIFIED',observation:'Direct comparison of saved PNG against source required.',evidence:[]});
  write(path.join(outputDir,'review.pending.json'),{version:1,reviewer:'',contractSha256:manifest.contract.sha256,
    native,expanded,evidence:[],sourceReview:pending(),eyeReview:{flatColors:pending(),shape:pending(),reflection:pending()},features:[...contract.features.map(f=>f.id),'$whole'].map(id=>({id,clarity:pending(),fidelity:pending()})),
    views:{native:pending(),zoom:pending(),display:pending()},findings:(contract.requiredFindings??[]).map(id=>({id,status:'UNVERIFIED',description:'Required finding needs verification.'}))});
  return manifest;
}
function finalize(runDir, reviewPath, PNG) {
  const manifest=read(path.join(runDir,'run.json'));
  const delivery=path.join(runDir,'delivery');
  need(!fs.existsSync(delivery), 'Delivery already exists; revalidate it with verify, never overwrite');
  for(const a of [manifest.contract,manifest.conversion,manifest.source,manifest.palette,manifest.baseline,manifest.native,manifest.expanded,...manifest.converters])checkArtifact(a);
  const contract=read(manifest.contract.path);sourceGate(contract, PNG);
  require('./stage-gates.cjs').assertExecution(contract.stageChecks,'fixed-asset-grid',{...contract,...read(manifest.conversion.path)});
  need(contract.source.sha256===manifest.source.sha256&&contract.palette.sha256===manifest.palette.sha256,'Manifest source/palette differs from locked contract');
  need(JSON.stringify(manifest.converters)===JSON.stringify(converters()),'Conversion or gate code changed; run conversion again');
  const review=read(reviewPath);
  need(review.native?.path===manifest.native.path&&review.native?.sha256===manifest.native.sha256&&
    review.expanded?.path===manifest.expanded.path&&review.expanded?.sha256===manifest.expanded.sha256,'Review must reference this exact generated candidate');
  const gate=checkDelivery(manifest.contract.path,reviewPath,PNG);
  const gatePath=path.join(runDir,'gate-'+hash(fs.readFileSync(reviewPath)).slice(0,16)+'.json');
  if(!fs.existsSync(gatePath))write(gatePath,gate);
  if(gate.status!=='READY_FOR_USER_REVIEW')return{status:gate.status,exported:false,gate:gatePath,issues:gate.issues};
  // Re-run the locked conversion before export. Hand-painted candidate bytes cannot pass.
  const job=read(manifest.conversion.path), source=PNG.sync.read(fs.readFileSync(contract.source.path)), palette=parsePalette(read(contract.palette.path));
  const replay=buildNative(PNG,source,palette,contract.width,contract.height,job.background,job.sampling??'area-vote',null,null,job.structure??null,contract.eyePolicy,contract.formPolicy??null,contract.outlinePolicy??null,contract.materialPlan??null);
  const saved=PNG.sync.read(fs.readFileSync(manifest.native.path));
  need(replay.image.data.equals(saved.data),'Candidate differs from deterministic conversion replay');
  fs.mkdirSync(delivery);
  const nativePath=path.join(delivery,'native.png'), expandedPath=path.join(delivery,'display.png');
  fs.copyFileSync(manifest.native.path,nativePath,fs.constants.COPYFILE_EXCL);
  fs.copyFileSync(manifest.expanded.path,expandedPath,fs.constants.COPYFILE_EXCL);
  const receipt={version:1,status:'READY_FOR_USER_REVIEW',userAcceptance:'NOT_ASSESSED',
    run:artifact(path.join(runDir,'run.json')),review:artifact(reviewPath),gate:artifact(gatePath),
    native:artifact(nativePath),expanded:artifact(expandedPath)};
  write(path.join(delivery,'receipt.json'),receipt);
  return{status:receipt.status,exported:true,receipt:path.join(delivery,'receipt.json'),native:nativePath,expanded:expandedPath};
}
function verify(runDir,PNG) {
  const receipt=read(path.join(runDir,'delivery','receipt.json'));
  for(const a of [receipt.run,receipt.review,receipt.gate,receipt.native,receipt.expanded])checkArtifact(a);
  const m=read(receipt.run.path);for(const a of [m.contract,m.conversion,m.source,m.palette,m.baseline,m.native,m.expanded,...m.converters])checkArtifact(a);
  need(JSON.stringify(m.converters)===JSON.stringify(converters()),'Code changed; delivery needs a fresh run');
  need(receipt.native.sha256===m.native.sha256&&receipt.expanded.sha256===m.expanded.sha256,'Delivery differs from reviewed candidate');
  sourceGate(read(m.contract.path), PNG);
  require('./stage-gates.cjs').assertExecution(read(m.contract.path).stageChecks,'fixed-asset-grid',{...read(m.contract.path),...read(m.conversion.path)});
  const result=checkDelivery(m.contract.path,receipt.review.path,PNG);
  need(result.status==='READY_FOR_USER_REVIEW','Delivery review no longer passes');
  return{status:result.status,receiptValid:true,userAcceptance:'NOT_ASSESSED',native:receipt.native.path,expanded:receipt.expanded.path};
}
module.exports={prepare,finalize,verify};
if(require.main===module){try{
  const {PNG}=require(require.resolve('pngjs',{paths:[__dirname,process.cwd()]}));
  const [mode,a,b]=process.argv.slice(2);let result;
  if(mode==='prepare'&&a&&b)result=prepare(path.resolve(a),path.resolve(b),PNG);
  else if(mode==='finalize'&&a&&b)result=finalize(path.resolve(a),path.resolve(b),PNG);
  else if(mode==='verify'&&a&&!b)result=verify(path.resolve(a),PNG);
  else throw new Error('Usage: run-pixel-workflow.cjs prepare job.json NEW_RUN_DIR | finalize RUN_DIR review.json | verify RUN_DIR');
  console.log(JSON.stringify(mode==='prepare'?{status:result.status,native:result.native.path,stats:result.stats}:result,null,2));
  if(mode==='finalize'&&!result.exported)process.exitCode=1;
}catch(error){console.log(JSON.stringify({status:'BLOCKED',exported:false,error:error.message}));process.exitCode=2;}}
