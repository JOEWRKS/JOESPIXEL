'use strict';
const fs=require('fs'),os=require('os'),path=require('path'),crypto=require('crypto'),assert=require('assert/strict');
const {assertStages,assertExecution,executionOptions,CHECKS,DETAIL_CHECKS,detailChecksForStage,names}=require('./stage-gates.cjs');
// Explicit synthetic fixture factory; never used to approve real artwork.
function fixtureLedger(source,palette,native,grid,through=5){
 const stages=[];
 for(let i=0;i<through;i++){
  const output=i<2?source:native,input=i===0?source:stages[i-1].output;
  stages.push({stage:i+1,name:names[i],status:'PASS',reviewer:'Synthetic fixture, not visual approval',reference:source,input,output,palette,grid,evidence:i<2?[source]:[source,native],
   checks:Object.fromEntries(CHECKS[i].map(k=>[k,{status:'PASS',observation:'Synthetic gate test only; not an artwork judgement.'}])),...(i===3?{action:'unchanged'}:{})});
 }
 for(const s of stages)for(const [part,checks] of Object.entries(detailChecksForStage(s.stage)))s.checks[part].details=Object.fromEntries(checks.map(k=>[k,{status:'PASS',observation:'Synthetic fixture only; not a visual verdict.'}]));
 if(stages.length)stages[0].execution={version:1,route:'measured',sampling:'measured-cell-centers',operations:[]};
 if(stages.length)stages[0].colorGroups=[{role:'synthetic fixture material only',colors:require('./build-palette-native.cjs').parsePalette(JSON.parse(fs.readFileSync(palette.path))).map(p=>p.hex)}];
 if(stages.length>1)stages[1].executionOptions=executionOptions('measured',{});
 return {version:1,stages};
}
module.exports={fixtureLedger};
if(require.main===module){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pixel-five-stage-'));
 const asset=(n,b)=>{const p=path.join(dir,n);fs.writeFileSync(p,b);return{path:p,sha256:crypto.createHash('sha256').update(b).digest('hex')};};
 const {PNG}=require(require.resolve('pngjs',{paths:[__dirname,process.cwd()]}));
 const im=new PNG({width:4,height:4});im.data.fill(255);
 const source=asset('source.png',PNG.sync.write(im)),native=asset('saved.png',PNG.sync.write(im)),palette=asset('palette.json',JSON.stringify({colors:['#FFFFFF']}));
 const make=()=>fixtureLedger(source,palette,native,{canvas:[8,8],cell:2});
 let passed=0;const test=(n,f)=>{f();passed++;console.log('PASS '+n);};
 test('complete ordered chain permits next stage without claiming visual truth',()=>assert.equal(assertStages(make(),5).visualTruth,'NOT_AUTOMATICALLY_DETERMINED'));
 test('design may proceed before exact raster outline width is assigned',()=>{const l=make();assert.equal(l.stages[1].checks.outline.details.width,undefined);assert.equal(assertStages(l,2).next,3);});
 for(const key of DETAIL_CHECKS.outline)test('saved grid must inspect outline '+key,()=>{const l=make();delete l.stages[2].checks.outline.details[key];assert.throws(()=>assertStages(l,3),new RegExp('outline\\.'+key));});
 test('missing saved contour blocks stage 3 despite sound draft',()=>{const l=make();l.stages[2].checks.outline.details.continuity={status:'FAIL',observation:'Source contour is missing from saved output'};assert.throws(()=>assertStages(l,3),e=>e.stage===3&&e.status==='FAIL');});
 test('missing execution plan blocks work',()=>{const l=make();delete l.stages[0].execution;assert.throws(()=>assertStages(l,1),/execution plan/);});
 test('stage 1 cannot omit color-group design',()=>{const l=make();delete l.stages[0].colorGroups;assert.throws(()=>assertStages(l,1),/colorGroups/);});
 test('color groups cannot invent an extra shade',()=>{const l=make();l.stages[0].colorGroups[0].colors.push('#123456');assert.throws(()=>assertStages(l,1),/fixed-palette/);});
 test('color-group labels cannot hide unused unplanned palette entries',()=>{const l=make();l.stages[0].palette=asset('two-colors.json',JSON.stringify({colors:['#FFFFFF','#000000']}));assert.throws(()=>assertStages(l,1),/every fixed-palette entry/);});
 for(const key of ['productionPremise','colorGroups','detailBudget'])test('stage 1 must inspect '+key,()=>{const l=make();delete l.stages[0].checks[key];assert.throws(()=>assertStages(l,1),new RegExp(key));});
 test('locked options permit exact execution',()=>assert.equal(assertExecution(make(),'measured',{sampling:'measured-cell-centers'}).status,'MATCH'));
 test('implicit sampler is forbidden',()=>assert.throws(()=>assertExecution(make(),'measured',{}),/differs/));
 test('sampler substitution is forbidden',()=>assert.throws(()=>assertExecution(make(),'measured',{sampling:'measured-nearest'}),/differs/));
 test('stacked correction is forbidden unless in original plan',()=>assert.throws(()=>assertExecution(make(),'measured',{sampling:'measured-cell-centers',exteriorOutline:{color:'#000000'}}),/differs/));
 test('fixed grid is not authorized by an agent-selected size',()=>{const l=make();l.stages[0].execution={version:1,route:'fixed-asset-grid',sampling:'area-vote',operations:[]};assert.throws(()=>assertStages(l,1),/explicit user/);});
 test('source annotations cannot activate an unplanned correction',()=>{const l=make();l.stages[1].executionOptions.boundaryCorrection={interfaces:[]};assert.throws(()=>assertStages(l,2),/unplanned operation/);});
 test('unknown execution override flag is rejected',()=>{const l=make();l.stages[0].execution.allowFallback=true;assert.throws(()=>assertStages(l,1),/Unknown execution-plan field/);});
 test('later stage cannot switch sampler using a shadow plan',()=>{const l=make();l.stages[2].execution={...l.stages[0].execution,sampling:'measured-nearest'};assert.throws(()=>assertStages(l,3),/override stage 1 execution/);});
 test('later stage cannot reassign color roles',()=>{const l=make();l.stages[3].colorGroups=[{role:'different material',colors:['#FFFFFF']}];assert.throws(()=>assertStages(l,4),/override stage 1 colorGroups/);});
 test('later stage cannot inject repair options',()=>{const l=make();l.stages[3].executionOptions={...l.stages[1].executionOptions,exteriorOutline:{color:'#FFFFFF'}};assert.throws(()=>assertStages(l,4),/override stage 2/);});
 test('grid metadata is locked, including origin',()=>{const l=make();l.stages[2].grid={...l.stages[2].grid,origin:[1,0]};assert.throws(()=>assertStages(l,3),/grid origin/);});
 for(const status of ['FAIL','UNVERIFIED','SKIPPED'])test('parent PASS cannot bury a nested '+status,()=>{const l=make();l.stages[4].checks.face.additionalObservation={status,observation:'Unresolved feature'};assert.throws(()=>assertStages(l,5),/unresolved check/);});
 for(const [part,keys] of Object.entries(DETAIL_CHECKS))for(const key of keys)test(part+'.'+key+' cannot hide behind generic PASS',()=>{const l=make();delete l.stages[4].checks[part].details[key];assert.throws(()=>assertStages(l,5),new RegExp(part+'\\.'+key));});
 for(let n=1;n<=5;n++)test('failed stage '+n+' blocks later work',()=>{const l=make();l.stages[n-1].status='FAIL';assert.throws(()=>assertStages(l,5),e=>e.stage===n&&e.status==='FAIL');});
 test('missing stage cannot be skipped',()=>{const l=make();l.stages.splice(1,1);assert.throws(()=>assertStages(l,5),/Stage 2/);});
 test('missing individual check blocks claimed PASS',()=>{const l=make();delete l.stages[1].checks.eyes;assert.throws(()=>assertStages(l,2),/eyes/);});
 test('unverified check blocks claimed PASS',()=>{const l=make();l.stages[0].checks.featureCapacity.status='UNVERIFIED';assert.throws(()=>assertStages(l,1),/featureCapacity/);});
 test('mouth cannot disappear behind a generic face or whole-image PASS',()=>{const l=make();delete l.stages[4].checks.mouth;assert.throws(()=>assertStages(l,5),/mouth/);});
 test('unchanged detail pass cannot omit required-form verification',()=>{const l=make();delete l.stages[3].checks.requiredForms;assert.throws(()=>assertStages(l,4),/requiredForms/);});
 test('different predecessor output blocks stage',()=>{const l=make();l.stages[2].input=asset('other.png',Buffer.from('different'));assert.throws(()=>assertStages(l,3),/predecessor/);});
 test('palette drift blocks stage',()=>{const l=make();l.stages[3].palette=asset('other-palette.json',Buffer.from('{}'));assert.throws(()=>assertStages(l,4),/predecessor/);});
 test('grid change blocks stage',()=>{const l=make();l.stages[2].grid={canvas:[16,16],cell:4};assert.throws(()=>assertStages(l,3),/predecessor/);});
 test('unchanged repair does not force a fake modification',()=>assert.equal(assertStages(make(),4).status,'PASS'));
 test('claimed modification with identical output is rejected',()=>{const l=make();l.stages[3].action='modified';assert.throws(()=>assertStages(l,4),/repair action/);});
 test('visual inspection cannot edit pixels',()=>{const l=make();l.stages[4].output=asset('edited.png',Buffer.from('edited'));assert.throws(()=>assertStages(l,5),/verification cannot/);});
 test('different current saved file cannot reuse PASS',()=>assert.throws(()=>assertStages(make(),5,{outputSha256:'0'.repeat(64)}),/current work/));
 test('earlier review cannot be rewritten after conversion',()=>{const l=make(),p=structuredClone(l);p.stages=p.stages.slice(0,2);l.stages[0].reviewer='changed';assert.throws(()=>assertStages(l,5,{prefix:p}),/review changed/);});
 test('changed comparison evidence invalidates PASS',()=>{const l=make(),proof=asset('proof.png',Buffer.from('before'));l.stages[0].evidence=[proof];fs.writeFileSync(proof.path,'after');assert.throws(()=>assertStages(l,1),/file changed/);});
 test('no ledger fails closed',()=>assert.throws(()=>assertStages(undefined,1),/record required/));
 test('conversion entry blocks missing earlier stages before output',()=>{
  const {prepare}=require('./run-pixel-workflow.cjs');const cp=path.join(dir,'contract.json'),jp=path.join(dir,'job.json'),out=path.join(dir,'blocked-run');
  fs.writeFileSync(cp,JSON.stringify({source,palette}));fs.writeFileSync(jp,JSON.stringify({contract:cp}));assert.throws(()=>prepare(jp,out,PNG),/stage record required/);assert(!fs.existsSync(out));
 });
 console.log(JSON.stringify({passed,scope:'Stage ordering, artifact integrity and entry blocking; no art quality claim',fixtureDirectory:dir}));
}
