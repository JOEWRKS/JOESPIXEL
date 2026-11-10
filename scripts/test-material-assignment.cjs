'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {PNG}=require(require.resolve('pngjs',{paths:[__dirname,process.cwd()]}));
const m=require('./material-assignment.cjs'),b=require('./build-palette-native.cjs'),g=require('./stage-gates.cjs');
const {fixtureSixLedger}=require('./test-pixel-capacity.cjs');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'material-assignment-test-')),hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const asset=(name,bytes)=>{const p=path.join(dir,name);fs.writeFileSync(p,bytes);return {path:p,sha256:hash(bytes)};};
const source=new PNG({width:24,height:24});for(let p=0;p<576;p++)source.data.set([240,195,155,255],p*4);
// Gray contaminant competes with skin colors; a protected feature is distinct.
for(let y=8;y<16;y++)for(let x=8;x<16;x++)source.data.set([120,110,105,255],(y*24+x)*4);
const palette=b.parsePalette({colors:['#FFF7E6','#24242D','#F4D3B7','#CC9787','#795B59']}),sourceAsset=asset('source.png',PNG.sync.write(source)),paletteAsset=asset('palette.json',JSON.stringify({colors:palette.map(p=>p.hex)}));
const policies={eyePolicy:null,formPolicy:null,outlinePolicy:null},observation='Synthetic ownership fixture, not visual approval.',pass=()=>({status:'PASS',observation});
const plan={version:1,sourcePixelsSha256:hash(source.data),paletteColors:palette.map(p=>p.hex),grid:{native:[6,6],cell:4,canvas:[24,24],origin:[0,0]},boundaryPolicySha256:m.policyHash(policies),observation,unassigned:'preserve-existing-source-regions',regions:[{id:'skin',material:'skin',polygon:[[4,4],[20,4],[20,20],[4,20]],colors:['#F4D3B7','#CC9787'],baseColor:'#F4D3B7',boundaryRoles:[],observation}],protectedFeatures:[{role:'feature',rect:[5,5,2,2],observation}],inventory:[{id:'skin',decision:'assigned',regionIds:['skin'],observation},{id:'outside',decision:'preserved',regionIds:[],observation}]};
const artifact=asset('plan.json',JSON.stringify(plan)),compiled=m.compile(PNG,source,palette,6,6,plan,policies),map=asset('map.png',PNG.sync.write(compiled.map));
let passed=0;function test(name,fn){fn();passed++;console.log('PASS '+name);}
test('gray source color cannot enter declared skin family',()=>{const r=b.buildNative(PNG,source,palette,6,6,'#FFF7E6','source-region-area',null,null,null,null,null,null,artifact);assert.equal(m.audit(r.image,compiled).violations,0);assert(compiled.interior.size>0);});
test('unassigned source and exact protected feature pixels remain byte-identical',()=>{const a=m.assignSource(PNG,source,source,palette,compiled).image;for(let p=0;p<576;p++)if(compiled.owners[p]<0||compiled.sourceExceptions[p])assert.equal(a.data.readUInt32BE(p*4),source.data.readUInt32BE(p*4));});
test('adjacent material in a feature-touched cell is still assigned',()=>{
 const contaminated=new PNG({width:24,height:24});source.data.copy(contaminated.data);
 const adjacent=4*24+4,feature=5*24+5;contaminated.data.set([255,247,230,255],adjacent*4);
 const result=m.assignSource(PNG,source,contaminated,palette,compiled).image;
 assert.equal(compiled.exceptions[adjacent],1);assert.equal(compiled.sourceExceptions[adjacent],0);
 assert.equal(result.data.readUInt32BE(adjacent*4),0xf4d3b7ff);
 assert.equal(result.data.readUInt32BE(feature*4),contaminated.data.readUInt32BE(feature*4));
 assert.equal(compiled.interior.has(7),false);
});
test('partial source feature protects its whole grid cell',()=>{for(let y=4;y<8;y++)for(let x=4;x<8;x++)assert.equal(compiled.exceptions[y*24+x],1);});
test('saved color contamination is detected',()=>{const im=b.buildNative(PNG,source,palette,6,6,'#FFF7E6','source-region-area',null,null,null,null,null,null,artifact).image;im.data.set([121,91,89,255],compiled.interior.keys().next().value*4);assert.equal(m.audit(im,compiled).violations,1);});
test('changed source cannot reuse ownership map',()=>{const p=structuredClone(plan);p.sourcePixelsSha256='0'.repeat(64);assert.throws(()=>m.compile(PNG,source,palette,6,6,p,policies),/source pixels changed/);});
test('skin cannot silently acquire four colors',()=>{const p=structuredClone(plan);p.regions[0].colors=palette.slice(0,4).map(p=>p.hex);assert.throws(()=>m.compile(PNG,source,palette,6,6,p,policies),/at most three/);});
test('overlapping material observations require resolution',()=>{const p=structuredClone(plan);p.regions.push({...p.regions[0],id:'hair',material:'hair'});p.inventory.push({id:'hair',decision:'assigned',regionIds:['hair'],observation});assert.throws(()=>m.compile(PNG,source,palette,6,6,p,policies),/overlapping/);});
test('boundary policy cannot change after assignment',()=>assert.throws(()=>m.compile(PNG,source,palette,6,6,plan,{...policies,outlinePolicy:{width:2}}),/boundary\/feature policies changed/));
test('unsupported sampler cannot ignore a plan',()=>assert.throws(()=>b.buildNative(PNG,source,palette,6,6,'#FFF7E6','nearest',null,null,null,null,null,null,artifact),/no ignored plan/));
test('material reservation cannot silently erase the required exterior rim',()=>{
 const im=new PNG({width:24,height:24});for(let y=0;y<24;y++)for(let x=0;x<24;x++)im.data.set(x>=4&&x<20&&y>=4&&y<20?[244,211,183,255]:[255,247,230,255],(y*24+x)*4);
 const base=b.buildNative(PNG,im,palette,6,6,'#FFF7E6','area-vote').image,grid={x:Array.from({length:6},(_,i)=>[i*4,i*4+4]),y:Array.from({length:6},(_,i)=>[i*4,i*4+4])};
 const policy={version:1,mode:'source-silhouette-width',scope:'exterior-connected',width:1,background:'#FFF7E6',backgroundTolerance:8,backgroundCoreTolerance:3,colors:['#24242D'],observation};
 assert.throws(()=>require('./raster-outline-contour.cjs').allocateOnePixelOutline(PNG,im,base,palette,grid,policy,new Map([[13,0]])),/Material\/contour ownership conflict/);
});
function ledger(){
 const l=fixtureSixLedger(sourceAsset,paletteAsset,sourceAsset,plan.grid);l.version=3;
 l.stages[0].execution={version:1,route:'fixed-asset-grid',sampling:'source-region-area',operations:['materialPlan'],fixedGridUserRequest:observation};
 delete l.stages[2].executionOptions;
 const options=g.executionOptions('fixed-asset-grid',{width:6,height:6,scale:4,background:'#FFF7E6',materialPlan:artifact});
 const s={...structuredClone(l.stages[2]),stage:4,name:'material-assignment',input:sourceAsset,output:sourceAsset,checks:Object.fromEntries(g.ASSIGNMENT_CHECKS.map(k=>[k,pass()])),executionOptions:options,assignment:{plan:artifact,map}};
 l.stages.splice(3,0,s);l.stages.forEach((s,i)=>{s.stage=i+1;s.name=g.SEVEN_NAMES[i];});return l;
}
test('seven-stage source map is bound to actual executable plan',()=>assert.equal(g.assertProductionStages(ledger(),5).through,7));
test('six-stage records cannot start new production',()=>assert.throws(()=>g.assertProductionStages(fixtureSixLedger(sourceAsset,paletteAsset,sourceAsset,plan.grid),2),/Seven-stage/));
test('missing material stage blocks conversion',()=>{const l=ledger();l.stages.splice(3,1);assert.throws(()=>g.assertProductionStages(l,2),/Stage 4/);});
test('failed material observation cannot hide under parent PASS',()=>{const l=ledger();l.stages[3].checks.ambiguity.status='FAIL';assert.throws(()=>g.assertProductionStages(l,2),/ambiguity/);});
test('forged source map is rejected',()=>{const l=ledger(),im=PNG.sync.read(fs.readFileSync(map.path));im.data.set([0,0,0,255],0);l.stages[3].assignment.map=asset('forged.png',PNG.sync.write(im));assert.throws(()=>g.assertProductionStages(l,2),/ownership map differs/);});
test('execution snapshot includes reviewed plan',()=>assert.equal(g.assertExecution(ledger(),'fixed-asset-grid',{width:6,height:6,scale:4,background:'#FFF7E6',materialPlan:artifact,sampling:'source-region-area'}).status,'MATCH'));
test('overlapping eye and line windows require actual eye shape',()=>{const l=ledger(),o=l.stages[3].executionOptions;l.stages[0].execution.operations.push('eyePolicy','outlinePolicy');o.eyePolicy={eyes:[{rect:[4,4,12,12]}]};o.outlinePolicy={observedStrokes:{roles:[{rect:[8,4,12,12]}]}};assert.throws(()=>g.assertProductionStages(l,2),/actual eye ownership polygon/);});
test('material protection cannot contradict the observed eye shape',()=>{const p=structuredClone(plan),o={...policies,eyePolicy:{eyes:[{rect:[4,4,8,8],sourcePolygon:[[4,4],[12,4],[12,12],[4,12]]}]}};p.boundaryPolicySha256=m.policyHash(o);assert.throws(()=>m.compile(PNG,source,palette,6,6,p,o),/eye and material ownership shapes differ/);});
console.log(JSON.stringify({passed,scope:'Ownership/stage-gate mechanics only, not artwork quality',directory:dir}));
