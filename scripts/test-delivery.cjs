"use strict";
// Eight-stage synthetic export fixtures. PASS here is not artwork approval.
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
function fixture({sourceImage=null,paletteColors=['#FFFFFF','#222222'],formPolicy=null,materialRegions=[],outlinePolicy=null,outlineDecision=null}={}) {
  const dir=path.join(root,String(++sequence));fs.mkdirSync(dir);
  const save=(name,value)=>{const file=path.join(dir,name),bytes=Buffer.isBuffer(value)?value:Buffer.from(JSON.stringify(value));fs.writeFileSync(file,bytes);return{path:file,sha256:hash(bytes)};};
  const source=sourceImage??new PNG({width:24,height:24});
  if(!sourceImage){source.data.fill(255);for(let y=8;y<16;y++)for(let x=8;x<16;x++)source.data.writeUInt32BE(0x222222ff,(y*24+x)*4);}
  const sourceAsset=save('source.png',PNG.sync.write(source)),paletteAsset=save('palette.json',{colors:paletteColors});
  const palette=b.parsePalette({colors:paletteColors});
  const eyePolicy={version:1,visibility:'not-visible',observation};
  const policies={eyePolicy,formPolicy,outlinePolicy};
  const grid={native:[source.width/4,source.height/4],cell:4,canvas:[source.width,source.height],origin:[0,0]};
  const plan={version:1,sourcePixelsSha256:hash(source.data),paletteColors:palette.map(p=>p.hex),grid,boundaryPolicySha256:m.policyHash(policies),observation,unassigned:'preserve-existing-source-regions',regions:materialRegions,protectedFeatures:[],inventory:[{id:'marker',decision:materialRegions.length?'assigned':'preserved',regionIds:materialRegions.map(r=>r.id),observation}]};
  const materialPlan=save('material-plan.json',plan);
  const map=save('material-map.png',PNG.sync.write(m.compile(PNG,source,palette,...grid.native,plan,policies).map));
  const c={version:1,kind:'other',source:sourceAsset,palette:paletteAsset,width:grid.native[0],height:grid.native[1],scale:4,paletteCount:palette.length,alpha:'opaque',background:paletteColors[0],displayTarget:'Synthetic fixed-grid preview',eyePolicy,formPolicy,materialPlan,
    sourceAssessment:{status:'READY_FOR_CONVERSION',representation:'illustration',sourceSha256:sourceAsset.sha256,observation},
    gridPlacement:{mode:'fixed-asset-grid',canvas:grid.canvas,cell:4,origin:[0,0],sourceSha256:sourceAsset.sha256},
    sourceToNative:{scaleX:0.25,scaleY:0.25,offsetX:0,offsetY:0},features:[{id:'marker',sourceObservation:observation,criterion:'Preserve square shape.'}],...(outlinePolicy?{outlinePolicy,outlineDecision}:{})};
  const ledger=fixtureSixLedger(sourceAsset,paletteAsset,sourceAsset,grid);ledger.version=3;
  ledger.stages[0].execution={version:1,route:'fixed-asset-grid',sampling:'source-region-area',operations:['eyePolicy',...(formPolicy?['formPolicy']:[]),...(outlinePolicy?['outlinePolicy']:[]),'materialPlan'],fixedGridUserRequest:observation};
  delete ledger.stages[2].executionOptions;
  const assignment={...structuredClone(ledger.stages[2]),name:'material-assignment',input:sourceAsset,output:sourceAsset,checks:Object.fromEntries(g.ASSIGNMENT_CHECKS.map(k=>[k,pass()])),executionOptions:g.executionOptions('fixed-asset-grid',c),assignment:{plan:materialPlan,map}};
  ledger.stages.splice(3,0,assignment);ledger.stages.forEach((s,i)=>{s.stage=i+1;s.name=g.SEVEN_NAMES[i];});
  const old=structuredClone(ledger.stages),options=assignment.executionOptions;
  const layout=save('line-layout.json',require('./source-line-layout.cjs').evidence(PNG,source,palette,options));
  ledger.version=4;
  ledger.stages=[{...old[0],output:sourceAsset},old[2],old[3],old[1],{...old[3],layout,executionOptions:options,checks:Object.fromEntries(g.LAYOUT_CHECKS.map(k=>[k,pass()]))},old[4],{...old[6],checks:{...old[5].checks,...old[6].checks}}];
  ledger.stages.forEach((s,i)=>{s.stage=i+1;s.name=g.EIGHT_NAMES[i];});
  c.stageChecks={version:4,stages:structuredClone(ledger.stages.slice(0,5))};
  const contract=save('contract.json',c),job=save('job.json',{contract:contract.path,background:c.background,sampling:'source-region-area'});
  return{dir,save,c,ledger,contract,job,run:path.join(dir,'run')};
}
function prepared(f=fixture()) {
  f.manifest=workflow.prepare(f.job.path,f.run,PNG);const x=f.manifest;
  for(let i=5;i<7;i++){f.ledger.stages[i].input=i===5?x.source:x.native;f.ledger.stages[i].output=x.native;f.ledger.stages[i].evidence=[x.source,x.native];}
  let check=0;
  const observed=()=>({...pass(),evidence:['comparison'],comparison:{sourceRegion:[0,0,f.c.width*4,f.c.height*4],difference:'Synthetic comparison '+(++check),criterion:'Fixture shape remains square.',reason:'Recorded fixture evidence only; not actual art approval.'}});
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

test('generic PASS without a source comparison cannot lock',()=>{const f=prepared();delete f.review.features[0].fidelity.comparison;const result=lock(f);assert.equal(result.exported,false);assert(result.issues.some(i=>i.detail.includes('separate source region')));});
test('copied comparison cannot masquerade as independent visual review',()=>{const f=prepared();f.review.features[1].fidelity=structuredClone(f.review.features[0].fidelity);const result=lock(f);assert.equal(result.exported,false);assert(result.issues.some(i=>i.detail.includes('duplicated comparison')));});

test('saved form verification retains the same source material context as conversion',()=>{
 const source=new PNG({width:48,height:48});for(let q=0;q<48*48;q++)source.data.writeUInt32BE(0xf9e6bfff,q*4);
 for(let y=20;y<25;y++)for(let x=12;x<34;x++)source.data.writeUInt32BE(0x774c41ff,(y*48+x)*4);
 const formPolicy={version:1,placement:'source-path',features:[{name:'observed seam',kind:'stroke',priority:'required',sourceRegion:[8,16,30,14],color:'#795B59',samples:[[119,76,65]],contextSamples:[[249,230,191]],observation,curve:{version:1,axis:'y',observation,landmarks:[{name:'start',kind:'endpoint',sourceRegion:[11,19,5,7]},{name:'end',kind:'endpoint',sourceRegion:[30,19,5,7]}]}}]};
 const f=prepared(fixture({sourceImage:source,paletteColors:['#FFF7E6','#F9E6BF','#F4D3B7','#CC9787','#795B59'],formPolicy,materialRegions:[{id:'skin',material:'skin',polygon:[[0,0],[48,0],[48,48],[0,48]],colors:['#F4D3B7','#CC9787'],baseColor:'#F4D3B7',boundaryRoles:[],observation}]}));
 const native=PNG.sync.read(fs.readFileSync(f.manifest.native.path)),palette=b.parsePalette(JSON.parse(fs.readFileSync(f.c.palette.path))),grid=require('./eye-plane-policy.cjs').affineEyeGrid(source,native,{fitWidth:12,fitHeight:12,offsetX:0,offsetY:0});
 const unbound=require('./raster-observed-details.cjs').allocateRequiredForms(PNG,source,native,grid,palette,formPolicy);
 assert(!unbound.image.data.equals(native.data),'fixture must reproduce foreign hair color entering vacated seam context when the material is omitted');
 assert.equal(finish(f).exported,true);assert.equal(workflow.verify(f.run,PNG).draftPreservation.changedNativePixels,0);
});
test('prepare accepts required forms on joint-source-band without the legacy outline mode',()=>{
 // joint-source-band takes formPolicy features as ownership and never reads
 // outlinePolicy.mode; a contract must not need an unused mode to pass.
 const source=new PNG({width:48,height:48});for(let q=0;q<48*48;q++)source.data.writeUInt32BE(0xffffffff,q*4);
 for(let y=8;y<40;y++)for(let x=8;x<40;x++)source.data.writeUInt32BE(x<12||x>=36||y<12||y>=36?0x432443ff:0xf4d3b7ff,(y*48+x)*4);
 for(let y=20;y<24;y++)for(let x=16;x<32;x++)source.data.writeUInt32BE(0x795b59ff,(y*48+x)*4);
 const formPolicy={version:1,placement:'source-path',features:[{name:'observed seam',kind:'stroke',priority:'required',sourceRegion:[13,17,22,10],color:'#795B59',samples:[[121,91,89]],contextSamples:[[244,211,183]],observation,curve:{version:1,axis:'y',observation,landmarks:[{name:'start',kind:'endpoint',sourceRegion:[15,19,5,6]},{name:'end',kind:'endpoint',sourceRegion:[28,19,5,6]}]}}]};
 const outlinePolicy={version:1,layout:'joint-source-band',width:1,background:'#FFFFFF',backgroundTolerance:10,colors:['#432443'],sourceStrokeColors:['#432443'],sourceInkRoles:[{name:'fixture contour',kind:'stroke',color:'#432443',paletteColors:['#432443'],observation}],curveFlow:{version:1,method:'anchored-source-curve'}};
 assert.equal(outlinePolicy.mode,undefined);
 const f=prepared(fixture({sourceImage:source,paletteColors:['#FFFFFF','#432443','#F4D3B7','#795B59'],formPolicy,outlinePolicy,outlineDecision:{mode:'continuous',width:1,colorPolicy:'darker-local-material'}}));
 const run=JSON.parse(fs.readFileSync(path.join(f.run,'run.json')));
 assert.deepEqual(run.formReport.unresolved,[]);assert.equal(run.outlineReport.method,'joint-source-band');
 const pal=b.parsePalette({colors:['#FFFFFF','#432443','#F4D3B7','#795B59']}),eye={version:1,visibility:'not-visible',observation};
 // The legacy contour route still needs its reviewed mode before taking forms.
 const {layout,curveFlow,...legacy}=outlinePolicy;
 assert.throws(()=>b.buildNative(PNG,source,pal,12,12,'#FFFFFF','source-region-area',null,null,null,eye,formPolicy,legacy),/legacy mode "source-silhouette-width"/);
});
test('production prepare saves actual source and placement diagnostics automatically',()=>{
 const f=prepared(),d=path.join(f.run,'diagnostics'),t=JSON.parse(fs.readFileSync(path.join(d,'trace.json')));
 assert.equal(t.status,'CONVERSION_COMPLETED_REQUIRES_VISUAL_REVIEW');assert.equal(t.bindings.source.sha256,f.c.source.sha256);
 for(const name of ['source','area-placement']){const s=t.stages.find(s=>s.stage===name);assert(s);const bytes=fs.readFileSync(path.join(d,s.file));assert.equal(hash(bytes),s.pngSha256);assert.equal(hash(PNG.sync.read(bytes).data),s.pixelsSha256);}
});
test('conversion failure preserves earlier images and cannot create a delivery',()=>{
 const f=fixture(),original=b.buildNative,key=require.resolve('./run-pixel-workflow.cjs');
 b.buildNative=(...args)=>{original(...args);throw Error('deliberate post-render failure');};delete require.cache[key];
 try{assert.throws(()=>require(key).prepare(f.job.path,f.run,PNG),/deliberate post-render/);const t=JSON.parse(fs.readFileSync(path.join(f.run,'diagnostics/trace.json')));assert.equal(t.status,'CONVERSION_FAILED');assert(t.stages.some(s=>s.stage==='area-placement'));assert(!fs.existsSync(path.join(f.run,'delivery')));}finally{b.buildNative=original;delete require.cache[key];}
});
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
 const f=prepared();lock(f);const original=b.buildNative,originalEnlarge=b.enlarge,gateModule=require('./check-delivery.cjs'),originalCheck=gateModule.checkDelivery,layoutModule=require('./source-line-layout.cjs'),originalLayout=layoutModule.evidence,workflowPath=require.resolve('./run-pixel-workflow.cjs');
 b.buildNative=()=>{throw Error('Forbidden post-lock conversion');};b.enlarge=()=>{throw Error('Forbidden post-lock resize');};gateModule.checkDelivery=()=>{throw Error('Forbidden post-lock source replay');};delete require.cache[workflowPath];
 layoutModule.evidence=()=>{throw Error('Forbidden post-lock layout planning');};
 try{const copyOnly=require(workflowPath);assert(copyOnly.finalize(f.run,f.reviewPath,PNG).exported);assert(copyOnly.verify(f.run,PNG).receiptValid);}finally{b.buildNative=original;b.enlarge=originalEnlarge;gateModule.checkDelivery=originalCheck;layoutModule.evidence=originalLayout;delete require.cache[workflowPath];}
});
for(const status of ['FAIL','UNVERIFIED'])test(status+' feature cannot export',()=>{const f=prepared();f.review.features[0].fidelity.status=status;assert.equal(finish(f).exported,false);assert(!fs.existsSync(path.join(f.run,'delivery')));});
test('missing feature review cannot export',()=>{const f=prepared();f.review.features.pop();assert.equal(finish(f).exported,false);});
test('missing actual-size review cannot export',()=>{const f=prepared();delete f.review.views.display;assert.equal(finish(f).exported,false);});
test('open defect cannot be outvoted by passed checks',()=>{const f=prepared();f.review.findings=[{id:'gap',status:'OPEN',description:'Unresolved gap'}];assert.equal(finish(f).exported,false);});
test('stale evidence binding cannot export',()=>{const f=prepared();f.review.evidence[0].bindings.native='0'.repeat(64);assert.equal(finish(f).exported,false);});
test('missing stage record prevents creation',()=>{const f=fixture();delete f.c.stageChecks;f.save('contract.json',f.c);assert.throws(()=>workflow.prepare(f.job.path,f.run,PNG),/stage record required/);assert(!fs.existsSync(f.run));});
test('missing line-plane execution proof cannot pass as an optional check',()=>{const f=fixture();delete f.c.stageChecks.stages[4].layout;f.save('contract.json',f.c);assert.throws(()=>workflow.prepare(f.job.path,f.run,PNG),/artifact/);assert(!fs.existsSync(f.run));});
test('changed layout cannot be approved by rehashing its evidence',()=>{const f=fixture(),s=f.c.stageChecks.stages[4];s.layout=f.save('false-layout.json',{version:1,executed:true,method:'source-line-plane-layout',layouts:[]});f.save('contract.json',f.c);assert.throws(()=>workflow.prepare(f.job.path,f.run,PNG),/layout evidence differs/);assert(!fs.existsSync(f.run));});
test('previous seven-stage records are historical evidence only',()=>{const f=fixture();f.c.stageChecks.version=3;f.save('contract.json',f.c);assert.throws(()=>workflow.prepare(f.job.path,f.run,PNG),/Eight-stage record required/);assert(!fs.existsSync(f.run));});
test('visible eyes cannot enter production with color cleanup only',()=>{
 const f=fixture();f.c.eyePolicy={version:1,visibility:'visible',observation:'Observed dark dot.',eyes:[{name:'dot',rect:[8,8,8,8],sourcePolygon:[[8,8],[16,8],[16,16],[8,16]],reflection:'off',roles:[{name:'dot',color:'#222222',colors:['#222222'],samples:[[34,34,34]]}]}]};
 f.save('contract.json',f.c);assert.throws(()=>workflow.prepare(f.job.path,f.run,PNG),/source-partitions/);assert(!fs.existsSync(f.run));
});
test('source partitions without explicit geometry cannot enter new production',()=>{
 const f=fixture();f.c.eyePolicy={version:1,visibility:'visible',placement:'source-partitions',observation:'Observed filled dot.',eyes:[{name:'dot',rect:[8,8,8,8],sourcePolygon:[[8,8],[16,8],[16,16],[8,16]],reflection:'off',baseRoles:['dot'],partitions:[{name:'interior',observation:'Filled interior.',sourcePolygon:[[9,9],[15,9],[15,15],[9,15]],roles:['dot']}],roles:[{name:'dot',family:'dot',color:'#222222',colors:['#222222'],samples:[[34,34,34]]}]}]};
 f.save('contract.json',f.c);assert.throws(()=>workflow.prepare(f.job.path,f.run,PNG),/source-stroke-fill/);assert(!fs.existsSync(f.run));
});
test('internal stroke without explicit source path cannot enter new production',()=>{
 const f=fixture();f.c.formPolicy={version:1,features:[{kind:'stroke'}]};f.save('contract.json',f.c);assert.throws(()=>workflow.prepare(f.job.path,f.run,PNG),/source-path/);assert(!fs.existsSync(f.run));
});
test('required stroke cannot start production with blanket endpoint protection',()=>{
 const f=fixture();f.c.formPolicy={version:1,placement:'source-path',features:[{kind:'stroke',priority:'required'}]};f.save('contract.json',f.c);assert.throws(()=>workflow.prepare(f.job.path,f.run,PNG),/observed curve landmarks/);assert(!fs.existsSync(f.run));
});
test('approximate pixels and native grids cannot be resampled by new production',()=>{for(const representation of ['pixel-designed','native-grid']){const f=fixture();f.c.sourceAssessment.representation=representation;f.save('contract.json',f.c);assert.throws(()=>workflow.prepare(f.job.path,f.run,PNG),/non-pixel illustration/);assert(!fs.existsSync(f.run));}});
test('legacy routes fail explicitly before writing output',()=>{for(const patch of [{redesign:{}},{measuredConversion:{}},{mode:'scoped-repair'}]){const f=fixture();Object.assign(f.c,patch);f.save('contract.json',f.c);assert.throws(()=>workflow.prepare(f.job.path,f.run,PNG),/Retired/);assert(!fs.existsSync(f.run));}});
test('grid alteration cannot reuse the locked plan',()=>{const f=fixture();f.c.gridPlacement.cell=2;f.save('contract.json',f.c);assert.throws(()=>workflow.prepare(f.job.path,f.run,PNG),/Fixed asset grid/);});
test('sampler substitution cannot reuse the locked stages',()=>{const f=fixture();f.save('job.json',{contract:f.contract.path,background:f.c.background,sampling:'nearest'});assert.throws(()=>workflow.prepare(f.job.path,f.run,PNG),/Execution differs/);});
test('modified saved candidate fails artifact verification',()=>{const f=prepared();fs.appendFileSync(f.manifest.native.path,'changed');assert.throws(()=>finish(f),/Changed artifact/);});
test('stale review cannot point to another run',()=>{const f=prepared();f.review.native.sha256='0'.repeat(64);assert.throws(()=>finish(f),/exact generated candidate/);});
test('published output tampering fails verify',()=>{const f=prepared();finish(f);fs.appendFileSync(path.join(f.run,'delivery/native.png'),'changed');assert.throws(()=>workflow.verify(f.run,PNG),/Changed artifact/);});
test('missing runtime fingerprint cannot be treated as verified',()=>{const f=prepared();const mf=path.join(f.run,'run.json'),manifest=JSON.parse(fs.readFileSync(mf));manifest.converters.pop();fs.writeFileSync(mf,JSON.stringify(manifest));assert.throws(()=>finish(f),/code changed/);});
test('actual off-palette output fails independent saved-PNG check',()=>{const f=prepared(),im=PNG.sync.read(fs.readFileSync(f.manifest.native.path));im.data.writeUInt32BE(0xff0000ff,0);f.review.native=f.save('bad.png',PNG.sync.write(im));f.review.expanded=f.save('bad-big.png',PNG.sync.write(b.enlarge(PNG,im,4)));f.save('review.json',f.review);assert.equal(checkDelivery(f.manifest.contract.path,f.reviewPath,PNG).technical,'FAIL');});
console.log(JSON.stringify({passed,scope:'Synthetic eight-stage delivery gates and deterministic replay; no visual quality claim'}));
