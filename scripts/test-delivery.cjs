"use strict";
// Seven-stage synthetic export fixtures. PASS here is not artwork approval.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {PNG}=require(require.resolve('pngjs',{paths:[__dirname,process.cwd()]}));
const b=require('./build-palette-native.cjs'),g=require('./stage-gates.cjs'),m=require('./material-assignment.cjs');
const workflow=require('./run-pixel-workflow.cjs'),{checkDelivery}=require('./check-delivery.cjs');
const {fixtureSixLedger}=require('./test-pixel-capacity.cjs');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'pixel-delivery-v3-'));
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const observation='Synthetic geometry fixture; not visual approval.';
const pass=()=>({status:'PASS',observation});
let sequence=0,passed=0;
function fixture() {
  const dir=path.join(root,String(++sequence));fs.mkdirSync(dir);
  const save=(name,value)=>{const file=path.join(dir,name),bytes=Buffer.isBuffer(value)?value:Buffer.from(JSON.stringify(value));fs.writeFileSync(file,bytes);return{path:file,sha256:hash(bytes)};};
  const source=new PNG({width:24,height:24});source.data.fill(255);
  for(let y=8;y<16;y++)for(let x=8;x<16;x++)source.data.writeUInt32BE(0x222222ff,(y*24+x)*4);
  const sourceAsset=save('source.png',PNG.sync.write(source)),paletteAsset=save('palette.json',{colors:['#FFFFFF','#222222']});
  const palette=b.parsePalette({colors:['#FFFFFF','#222222']});
  const eyePolicy={version:1,visibility:'not-visible',observation};
  const policies={eyePolicy,formPolicy:null,outlinePolicy:null};
  const grid={native:[6,6],cell:4,canvas:[24,24],origin:[0,0]};
  const plan={version:1,sourcePixelsSha256:hash(source.data),paletteColors:palette.map(p=>p.hex),grid,boundaryPolicySha256:m.policyHash(policies),observation,unassigned:'preserve-existing-source-regions',regions:[],protectedFeatures:[],inventory:[{id:'marker',decision:'preserved',regionIds:[],observation}]};
  const materialPlan=save('material-plan.json',plan);
  const map=save('material-map.png',PNG.sync.write(m.compile(PNG,source,palette,6,6,plan,policies).map));
  const c={version:1,kind:'other',source:sourceAsset,palette:paletteAsset,width:6,height:6,scale:4,paletteCount:2,alpha:'opaque',background:'#FFFFFF',displayTarget:'Synthetic 24x24 preview',eyePolicy,materialPlan,
    sourceAssessment:{status:'READY_FOR_CONVERSION',representation:'pixel-designed',sourceSha256:sourceAsset.sha256,observation},
    gridPlacement:{mode:'fixed-asset-grid',canvas:[24,24],cell:4,origin:[0,0],sourceSha256:sourceAsset.sha256},
    sourceToNative:{scaleX:0.25,scaleY:0.25,offsetX:0,offsetY:0},features:[{id:'marker',sourceObservation:observation,criterion:'Preserve square shape.'}]};
  const ledger=fixtureSixLedger(sourceAsset,paletteAsset,sourceAsset,grid);ledger.version=3;
  ledger.stages[0].execution={version:1,route:'fixed-asset-grid',sampling:'source-region-area',operations:['eyePolicy','materialPlan'],fixedGridUserRequest:observation};
  delete ledger.stages[2].executionOptions;
  const assignment={...structuredClone(ledger.stages[2]),name:'material-assignment',input:sourceAsset,output:sourceAsset,checks:Object.fromEntries(g.ASSIGNMENT_CHECKS.map(k=>[k,pass()])),executionOptions:g.executionOptions('fixed-asset-grid',c),assignment:{plan:materialPlan,map}};
  ledger.stages.splice(3,0,assignment);ledger.stages.forEach((s,i)=>{s.stage=i+1;s.name=g.SEVEN_NAMES[i];});
  c.stageChecks={version:3,stages:structuredClone(ledger.stages.slice(0,4))};
  const contract=save('contract.json',c),job=save('job.json',{contract:contract.path,background:c.background,sampling:'source-region-area'});
  return{dir,save,c,ledger,contract,job,run:path.join(dir,'run')};
}
function prepared(f=fixture()) {
  f.manifest=workflow.prepare(f.job.path,f.run,PNG);const x=f.manifest;
  for(let i=4;i<7;i++){f.ledger.stages[i].input=i===4?x.source:x.native;f.ledger.stages[i].output=x.native;f.ledger.stages[i].evidence=[x.source,x.native];}
  const observed=()=>({...pass(),evidence:['comparison']});
  f.review={version:1,reviewer:observation,contractSha256:x.contract.sha256,native:x.native,expanded:x.expanded,stageChecks:f.ledger,
    gridDraft:{native:x.native,expanded:x.expanded,grid:{native:[f.c.width,f.c.height],cell:f.c.scale,canvas:[f.c.width*f.c.scale,f.c.height*f.c.scale],origin:[0,0]},sourceComparison:observed(),visual:observed()},
    evidence:[{id:'comparison',...x.expanded,bindings:{source:x.source.sha256,native:x.native.sha256}}],sourceReview:observed(),features:['marker','$whole'].map(id=>({id,clarity:observed(),fidelity:observed()})),views:{native:observed(),zoom:observed(),display:observed()},findings:[]};
  f.reviewPath=path.join(f.dir,'review.json');return f;
}
function lock(f){fs.writeFileSync(f.reviewPath,JSON.stringify(f.review));return workflow.lock(f.run,f.reviewPath,PNG);}
function finish(f){const result=lock(f);return result.locked?workflow.finalize(f.run,f.reviewPath,PNG):result;}
function test(name,fn){fn();passed++;console.log('PASS '+name);}
test('prepare creates unreviewed grid draft, never a lock or delivery',()=>{const f=prepared();assert(!fs.existsSync(path.join(f.run,'delivery')));const p=JSON.parse(fs.readFileSync(path.join(f.run,'review.pending.json')));assert.equal(p.gridDraft.visual.status,'UNVERIFIED');assert.equal(workflow.lock(f.run,path.join(f.run,'review.pending.json'),PNG).exported,false);assert(!fs.existsSync(path.join(f.run,'locked-draft')));assert.throws(()=>workflow.finalize(f.run,f.reviewPath,PNG),/must be locked/);});
test('reviewed grid lock exports exact bytes and verifies unchanged pixels',()=>{const f=prepared();assert.equal(finish(f).exported,true);const v=workflow.verify(f.run,PNG);assert.equal(v.receiptValid,true);assert.equal(v.draftPreservation.changedNativePixels,0);for(const file of ['native.png','display.png'])assert.deepEqual(fs.readFileSync(path.join(f.run,'delivery',file)),fs.readFileSync(path.join(f.run,'locked-draft',file)));});
test('missing grid-draft review cannot be replaced by generic PASS',()=>{const f=prepared();delete f.review.gridDraft;assert.throws(()=>finish(f),/Grid-draft review/);});
test('unreviewed raw-to-grid changes block locking',()=>{const f=prepared();f.review.gridDraft.sourceComparison.status='UNVERIFIED';assert.equal(finish(f).exported,false);});
test('different grid cannot be frozen under the same review',()=>{const f=prepared();f.review.gridDraft.grid.cell=2;assert.throws(()=>finish(f),/Grid-draft review/);});
test('lock cannot be overwritten and final review cannot change',()=>{const f=prepared();assert(lock(f).locked);assert.throws(()=>workflow.lock(f.run,f.reviewPath,PNG),/already locked/);fs.appendFileSync(f.reviewPath,' ');assert.throws(()=>workflow.finalize(f.run,f.reviewPath,PNG),/Changed artifact/);});
test('one changed locked pixel blocks export',()=>{const f=prepared();lock(f);const p=path.join(f.run,'locked-draft/native.png'),im=PNG.sync.read(fs.readFileSync(p));im.data.writeUInt32BE(0x222222ff,0);fs.writeFileSync(p,PNG.sync.write(im));assert.throws(()=>workflow.finalize(f.run,f.reviewPath,PNG),/Changed artifact/);assert(!fs.existsSync(path.join(f.run,'delivery')));});
test('rehashed manual change cannot become an approved grid draft',()=>{
 const f=prepared(),x=f.manifest,im=PNG.sync.read(fs.readFileSync(x.native.path));im.data.writeUInt32BE(0x222222ff,0);
 for(const [a,png]of [[x.native,im],[x.expanded,b.enlarge(PNG,im,f.c.scale)]]){const bytes=PNG.sync.write(png);fs.writeFileSync(a.path,bytes);a.sha256=hash(bytes);}
 fs.writeFileSync(path.join(f.run,'run.json'),JSON.stringify(x));f.review.evidence[0].sha256=x.expanded.sha256;f.review.evidence[0].bindings.native=x.native.sha256;
 assert.throws(()=>finish(f),/Candidate differs from deterministic conversion replay/);assert(!fs.existsSync(path.join(f.run,'locked-draft')));
});
test('finalize and verify never invoke conversion after lock',()=>{
 const f=prepared();lock(f);const original=b.buildNative,originalEnlarge=b.enlarge,gateModule=require('./check-delivery.cjs'),originalCheck=gateModule.checkDelivery,workflowPath=require.resolve('./run-pixel-workflow.cjs');
 b.buildNative=()=>{throw Error('Forbidden post-lock conversion');};b.enlarge=()=>{throw Error('Forbidden post-lock resize');};gateModule.checkDelivery=()=>{throw Error('Forbidden post-lock source replay');};delete require.cache[workflowPath];
 try{const copyOnly=require(workflowPath);assert(copyOnly.finalize(f.run,f.reviewPath,PNG).exported);assert(copyOnly.verify(f.run,PNG).receiptValid);}finally{b.buildNative=original;b.enlarge=originalEnlarge;gateModule.checkDelivery=originalCheck;delete require.cache[workflowPath];}
});
for(const status of ['FAIL','UNVERIFIED'])test(status+' feature cannot export',()=>{const f=prepared();f.review.features[0].fidelity.status=status;assert.equal(finish(f).exported,false);assert(!fs.existsSync(path.join(f.run,'delivery')));});
test('missing feature review cannot export',()=>{const f=prepared();f.review.features.pop();assert.equal(finish(f).exported,false);});
test('missing actual-size review cannot export',()=>{const f=prepared();delete f.review.views.display;assert.equal(finish(f).exported,false);});
test('open defect cannot be outvoted by passed checks',()=>{const f=prepared();f.review.findings=[{id:'gap',status:'OPEN',description:'Unresolved gap'}];assert.equal(finish(f).exported,false);});
test('stale evidence binding cannot export',()=>{const f=prepared();f.review.evidence[0].bindings.native='0'.repeat(64);assert.equal(finish(f).exported,false);});
test('missing stage record prevents creation',()=>{const f=fixture();delete f.c.stageChecks;f.save('contract.json',f.c);assert.throws(()=>workflow.prepare(f.job.path,f.run,PNG),/stage record required/);assert(!fs.existsSync(f.run));});
test('legacy routes fail explicitly before writing output',()=>{for(const patch of [{redesign:{}},{measuredConversion:{}},{mode:'scoped-repair'}]){const f=fixture();Object.assign(f.c,patch);f.save('contract.json',f.c);assert.throws(()=>workflow.prepare(f.job.path,f.run,PNG),/Retired/);assert(!fs.existsSync(f.run));}});
test('grid alteration cannot reuse the locked plan',()=>{const f=fixture();f.c.gridPlacement.cell=2;f.save('contract.json',f.c);assert.throws(()=>workflow.prepare(f.job.path,f.run,PNG),/Fixed asset grid/);});
test('sampler substitution cannot reuse the locked stages',()=>{const f=fixture();f.save('job.json',{contract:f.contract.path,background:f.c.background,sampling:'nearest'});assert.throws(()=>workflow.prepare(f.job.path,f.run,PNG),/Execution differs/);});
test('modified saved candidate fails artifact verification',()=>{const f=prepared();fs.appendFileSync(f.manifest.native.path,'changed');assert.throws(()=>finish(f),/Changed artifact/);});
test('stale review cannot point to another run',()=>{const f=prepared();f.review.native.sha256='0'.repeat(64);assert.throws(()=>finish(f),/exact generated candidate/);});
test('published output tampering fails verify',()=>{const f=prepared();finish(f);fs.appendFileSync(path.join(f.run,'delivery/native.png'),'changed');assert.throws(()=>workflow.verify(f.run,PNG),/Changed artifact/);});
test('missing runtime fingerprint cannot be treated as verified',()=>{const f=prepared();const mf=path.join(f.run,'run.json'),manifest=JSON.parse(fs.readFileSync(mf));manifest.converters.pop();fs.writeFileSync(mf,JSON.stringify(manifest));assert.throws(()=>finish(f),/code changed/);});
test('actual off-palette output fails independent saved-PNG check',()=>{const f=prepared(),im=PNG.sync.read(fs.readFileSync(f.manifest.native.path));im.data.writeUInt32BE(0xff0000ff,0);f.review.native=f.save('bad.png',PNG.sync.write(im));f.review.expanded=f.save('bad-big.png',PNG.sync.write(b.enlarge(PNG,im,4)));f.save('review.json',f.review);assert.equal(checkDelivery(f.manifest.contract.path,f.reviewPath,PNG).technical,'FAIL');});
console.log(JSON.stringify({passed,scope:'Synthetic seven-stage delivery gates and deterministic replay; no visual quality claim'}));
