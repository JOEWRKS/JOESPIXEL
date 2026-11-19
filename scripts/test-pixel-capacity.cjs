'use strict';
// Synthetic control-flow/evidence fixtures only. Never artwork approval.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {PNG}=require(require.resolve('pngjs',{paths:[__dirname,process.cwd()]}));
const gate=require('./stage-gates.cjs');
const historical=(ledger,milestone,expected={})=>gate.assertStages(ledger,milestone==='capacity'?2:milestone===1?1:milestone+1,expected);
const {fixtureLedger}=require('./test-stage-gates.cjs');
const observation='Synthetic fixture only; no character or visual-quality approval.';
const pass=()=>({status:'PASS',observation});
function fixtureSixLedger(source,palette,native,grid,through=6){
 const dir=path.dirname(source.path),stem='capacity-fixture-'+grid.cell;
 const asset=(name,b)=>{const p=path.join(dir,stem+'-'+name);fs.writeFileSync(p,b);return {path:p,sha256:crypto.createHash('sha256').update(b).digest('hex')};};
 const colors=require('./build-palette-native.cjs').parsePalette(JSON.parse(fs.readFileSync(palette.path)));
 if(colors.length<2)throw Error('Capacity fixture needs background and ink');
 const bg=colors[0],ink=colors[1];
 const makeCandidate=cell=>{
  const g={canvas:grid.canvas,native:grid.native&&cell===grid.cell?grid.native:grid.canvas.map(v=>Math.floor(v/cell)),cell,origin:cell===grid.cell?(grid.origin??[0,0]):[0,0]};
  const im=new PNG({width:g.native[0],height:g.native[1]}),mask=new PNG({width:im.width,height:im.height}),expanded=new PNG({width:g.canvas[0],height:g.canvas[1]});
  const left=Math.max(0,Math.ceil(-g.origin[0]/cell)),top=Math.max(0,Math.ceil(-g.origin[1]/cell)),right=Math.min(im.width-1,Math.floor((g.canvas[0]-g.origin[0])/cell)-1),bottom=Math.min(im.height-1,Math.floor((g.canvas[1]-g.origin[1])/cell)-1);
  for(let y=0;y<im.height;y++)for(let x=0;x<im.width;x++){
   const border=x>=left&&x<=right&&y>=top&&y<=bottom&&(x===left||y===top||x===right||y===bottom),p=(y*im.width+x)*4;
   im.data.set([...(border?ink:bg).rgb,255],p);mask.data.set(border?[255,255,255,255]:[0,0,0,255],p);
  }
  for(let y=0;y<expanded.height;y++)for(let x=0;x<expanded.width;x++){
   const nx=Math.floor((x-g.origin[0])/cell),ny=Math.floor((y-g.origin[1])/cell),p=(y*expanded.width+x)*4;
   expanded.data.set(nx>=0&&ny>=0&&nx<im.width&&ny<im.height?im.data.subarray((ny*im.width+nx)*4,(ny*im.width+nx)*4+4):[...bg.rgb,255],p);
  }
  return {id:'cell-'+cell,grid:g,native:asset(cell+'-native.png',PNG.sync.write(im)),expanded:asset(cell+'-expanded.png',PNG.sync.write(expanded)),outlineMask:asset(cell+'-mask.png',PNG.sync.write(mask)),outlineWidth:1,outlineColors:[ink.hex],status:'PASS',observation,
   checks:Object.fromEntries(gate.CAPACITY_CHECKS.map(k=>[k,pass()])),boundaries:[{id:'synthetic-contour',...Object.fromEntries(['coverage','width','continuity','flow','clearance'].map(k=>[k,pass()]))}]};
 };
 const candidates=[makeCandidate(grid.cell),makeCandidate(grid.cell===1?2:grid.cell-1)];
 const locked=candidates[0].grid;
 const legacy=fixtureLedger(source,palette,native,locked,5);
 const capacity={stage:2,name:'pixel-capacity',status:'PASS',reviewer:observation,input:source,output:source,reference:source,palette,grid:locked,evidence:candidates.flatMap(c=>[c.native,c.expanded,c.outlineMask]),checks:Object.fromEntries(gate.CAPACITY_CHECKS.map(k=>[k,pass()])),
  selection:{version:1,source,reference:source,background:bg.hex,reason:observation,selectedId:candidates[0].id,requiredBoundaries:[{id:'synthetic-contour',kind:'exterior',observation}],candidates}};
 legacy.stages[0].grid={canvas:grid.canvas};legacy.stages.splice(1,0,capacity);
 legacy.stages.forEach((s,i)=>{s.stage=i+1;s.name=gate.SIX_NAMES[i];});
 return {version:2,stages:legacy.stages.slice(0,through)};
}
module.exports={fixtureSixLedger};
if(require.main===module){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pixel-capacity-test-'));
 const asset=(name,b)=>{const p=path.join(dir,name);fs.writeFileSync(p,b);return {path:p,sha256:crypto.createHash('sha256').update(b).digest('hex')};};
 const im=new PNG({width:12,height:12});im.data.fill(255);
 const source=asset('source.png',PNG.sync.write(im)),palette=asset('palette.json',JSON.stringify({colors:['#FFFFFF','#222222']}));
 const make=()=>fixtureSixLedger(source,palette,source,{canvas:[12,12],cell:3});
 let passed=0;const test=(name,fn)=>{fn();passed++;console.log('PASS '+name);};
 test('six stages permit records without automatic visual truth',()=>assert.equal(historical(make(),5).visualTruth,'NOT_AUTOMATICALLY_DETERMINED'));
 test('stage one can leave pixel size undecided',()=>assert.equal(historical(make(),1).next,2));
 test('capacity can finish before design',()=>assert.equal(historical(make(), 'capacity').next,3));
 test('legacy production is blocked',()=>assert.throws(()=>gate.assertProductionStages({version:1},2),/Seven-stage/));
 test('missing capacity cannot be skipped',()=>{const l=make();l.stages.splice(1,1);assert.throws(()=>historical(l,2),/Stage 2/);});
 const reject=(name,mutate,pattern)=>test(name,()=>{const l=make();mutate(l);assert.throws(()=>historical(l,5),pattern);});
 reject('one grid is not a comparison',l=>l.stages[1].selection.candidates.pop(),/at least two/);
 test('explicit fixed size tests capacity without manufacturing an alternative',()=>{const l=make();l.stages[0].execution.fixedGridUserRequest='User explicitly requires 3px';l.stages[1].selection.mode='user-fixed';l.stages[1].selection.candidates.pop();assert.equal(historical(l,2).status,'PASS');});
 reject('fixed size without user evidence is blocked',l=>{l.stages[1].selection.mode='user-fixed';l.stages[1].selection.candidates.pop();},/explicit user grid/);
 reject('fixed size cannot hide failed boundary capacity',l=>{l.stages[0].execution.fixedGridUserRequest='User requires 3px';l.stages[1].selection.mode='user-fixed';l.stages[1].selection.candidates.pop();l.stages[1].selection.candidates[0].boundaries[0].continuity.status='FAIL';},/unresolved boundary/);
 reject('a failed selected candidate blocks work',l=>l.stages[1].selection.candidates[0].status='FAIL',/selected grid/);
 reject('coverage failure cannot hide in PASS',l=>l.stages[1].selection.candidates[0].boundaries[0].coverage.status='FAIL',/unresolved boundary/);
 reject('lost feature capacity cannot hide in PASS',l=>l.stages[1].selection.candidates[0].checks.requiredForms.status='FAIL',/unresolved capacity/);
 reject('missing boundary scope is blocked',l=>l.stages[1].selection.requiredBoundaries.push({id:'other',kind:'contact',observation}),/omitted/);
 reject('mask must identify saved ink',l=>l.stages[1].selection.candidates[0].outlineColors=['#FFFFFF'],/ink colors/);
 reject('stale probe PNG blocks work',l=>l.stages[1].selection.candidates[0].native.sha256='0'.repeat(64),/file changed/);
 const replacePng=(l,key,mutate)=>{const c=l.stages[1].selection.candidates[0],im=PNG.sync.read(fs.readFileSync(c[key].path));mutate(im);c[key]=asset('mutated-'+key+'.png',PNG.sync.write(im));};
 reject('preview subpixels cannot impersonate the selected grid',l=>replacePng(l,'expanded',im=>im.data.set([255,255,255,255],0)),/exact square grid/);
 reject('extra colors cannot enter a candidate',l=>replacePng(l,'native',im=>im.data.set([1,2,3,255],(im.width+1)*4)),/fixed palette/);
 reject('a forged mask cannot label a fill pixel as ink',l=>replacePng(l,'outlineMask',im=>im.data.set([255,255,255,255],(im.width+1)*4)),/does not match saved ink/);
 reject('clipped ink is not acceptable spare canvas',l=>{l.stages[1].selection.candidates[0].grid.origin=[-1,0];},/crops foreground/);
 test('a rejected alternative does not invalidate a fully reviewed selected candidate',()=>{const l=make(),c=l.stages[1].selection.candidates[1];c.status='FAIL';c.checks.requiredForms.status='FAIL';assert.equal(historical(l,2).status,'PASS');});
 reject('post-selection origin change is forbidden',l=>l.stages[3].grid={...l.stages[3].grid,origin:[1,0]},/grid origin/);
 reject('post-selection size change is forbidden',l=>l.stages[3].grid={...l.stages[3].grid,cell:2},/predecessor/);
 reject('same dot count at another zoom is not another candidate',l=>{const s=l.stages[1].selection;s.candidates[1]={...structuredClone(s.candidates[0]),id:'duplicate-grid'};},/same grid/);
 reject('characterization cannot change during selection',l=>l.stages[1].output=l.stages[1].selection.candidates[0].native,/preserve characterization/);
 test('actual conversion native and origin must match selection',()=>{
  const l=make();assert.throws(()=>historical(l,2,{grid:{canvas:[12,12],cell:3,native:[3,4],origin:[0,0]}}),/selected grid native/);
  assert.throws(()=>historical(l,2,{grid:{canvas:[12,12],cell:3,native:[4,4],origin:[1,0]}}),/selected grid origin/);
 });
 test('design execution reads stage three snapshot',()=>assert.equal(gate.assertExecution(make(),'measured',{sampling:'measured-cell-centers'}).status,'MATCH'));
 test('failed capacity blocks production before artifact creation',()=>{
  const l=make();l.stages=l.stages.slice(0,3);l.stages[1].status='FAIL';
  const cp=path.join(dir,'contract.json'),jp=path.join(dir,'job.json'),out=path.join(dir,'forbidden-output');
  fs.writeFileSync(cp,JSON.stringify({source,palette,width:4,height:4,scale:3,stageChecks:l}));fs.writeFileSync(jp,JSON.stringify({contract:cp}));
  assert.throws(()=>require('./run-pixel-workflow.cjs').prepare(jp,out,PNG),/Seven-stage/);assert(!fs.existsSync(out));
 });
 console.log(JSON.stringify({passed,scope:'Synthetic records, actual PNG consistency and entry blocking only; no artwork visual approval',directory:dir}));
}
