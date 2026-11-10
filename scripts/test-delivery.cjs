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
    evidence:[{id:'comparison',...x.expanded,bindings:{source:x.source.sha256,native:x.native.sha256}}],sourceReview:observed(),features:['marker','$whole'].map(id=>({id,clarity:observed(),fidelity:observed()})),views:{native:observed(),zoom:observed(),display:observed()},findings:[]};
  f.reviewPath=path.join(f.dir,'review.json');return f;
}
function finish(f){fs.writeFileSync(f.reviewPath,JSON.stringify(f.review));return workflow.finalize(f.run,f.reviewPath,PNG);}
function test(name,fn){fn();passed++;console.log('PASS '+name);}
test('prepare creates pending evidence, never a delivery',()=>{const f=prepared();assert(!fs.existsSync(path.join(f.run,'delivery')));const p=JSON.parse(fs.readFileSync(path.join(f.run,'review.pending.json')));assert.equal(p.views.native.status,'UNVERIFIED');assert.equal(workflow.finalize(f.run,path.join(f.run,'review.pending.json'),PNG).exported,false);});
test('seven-stage replay exports exact saved bytes and verifies receipt',()=>{const f=prepared();assert.equal(finish(f).exported,true);assert.equal(workflow.verify(f.run,PNG).receiptValid,true);assert.deepEqual(fs.readFileSync(path.join(f.run,'delivery/native.png')),fs.readFileSync(f.manifest.native.path));});
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
