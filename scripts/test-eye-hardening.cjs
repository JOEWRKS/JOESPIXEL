'use strict';
// Stroke-topology noise, open-ring and erased-plane guards. Mechanics only; not artwork approval.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PNG}=require(require.resolve('pngjs',{paths:[__dirname,process.cwd()]}));
const {planSourceStroke}=require('./raster-source-ink-paths.cjs');
const {buildNative,parsePalette}=require('./build-palette-native.cjs');
let passed=0;const test=(name,fn)=>{fn();passed++;console.log('PASS '+name);};
const step=8,w=6,h=4,sw=w*step,sh=h*step;
const grid={x:Array.from({length:w},(_,i)=>[i*step,(i+1)*step]),y:Array.from({length:h},(_,i)=>[i*step,(i+1)*step])};
const band=(x0,x1,y0,y1,mask=new Set())=>{for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++)mask.add(y*sw+x);return mask;};

test('an antialias speck below a quarter cell cannot split a fitting stroke',()=>{
 const mask=band(4,44,10,14);mask.add(18*sw+20);mask.add(18*sw+21);
 const plan=planSourceStroke(mask,sw,sh,grid,w,h);
 assert.equal(plan.sourceTopology.components,1);assert.equal(plan.ignoredSourceFragments.length,1);assert.equal(plan.ignoredSourceFragments[0].pixels,2);
});
test('a separate stroke of real size still has to stay separate',()=>{
 const mask=band(4,44,4,7);band(4,44,22,26,mask);
 const plan=planSourceStroke(mask,sw,sh,grid,w,h);assert.equal(plan.sourceTopology.components,2);assert.equal(plan.nativeTopology.components,2);
});
test('a compact mark made only of small pieces is not discarded',()=>{
 const mask=band(20,23,12,15);const plan=planSourceStroke(mask,sw,sh,grid,w,h,{allowCompactMark:true});assert.equal(plan.ignoredSourceFragments,undefined);assert(plan.cells.size>=1);
});
test('an open stroke whose source pixels enclose an interior is blocked with locations',()=>{
 const mask=band(4,44,4,7);band(4,44,24,27,mask);band(4,7,4,27,mask);band(41,44,4,27,mask);
 assert.throws(()=>planSourceStroke(mask,sw,sh,grid,w,h),e=>/Open stroke encloses a source interior/.test(e.message)&&/sourceComponents/.test(e.message));
});

// Real face crop: the iris ink rim left in the lid base role used to turn the small eye into a dark block.
const dir=path.join(__dirname,'..','handoff','mechanic-eyes'),c=JSON.parse(fs.readFileSync(path.join(dir,'case.json')));
const face=PNG.sync.read(fs.readFileSync(path.join(dir,'face.png'))),pal=parsePalette(c.palette);
const build=eyes=>buildNative(PNG,face,pal,c.native[0],c.native[1],c.background,'source-region-area',null,null,null,eyes);
test('a lid stroke that eats an observed iris plane is blocked, not delivered',()=>{
 assert.throws(()=>build(c.rimInBase),/erased an observed plane of [0-9.]+ cells: left-eye\/iris-dark/);
});
test('ring partitions give the rim to the iris and keep every observed eye plane',()=>{
 const r=build(c.rimInRing).eyePolicyReport;
 for(const e of r.eyes)for(const role of e.roles)if(role.sourcePixels>=128&&role.name!=='light')assert(role.nativeCells>0,e.name+'/'+role.name+' lost');
 const left=r.eyes.find(e=>e.name==='left-eye'),lid=left.roles.find(x=>x.name==='lid').nativeCells,owned=left.cells.length;
 assert(lid<=owned/4,'lid owns '+lid+' of '+owned+' cells');
});
console.log(JSON.stringify({passed,scope:'Stroke topology and eye-plane guards on synthetic masks and one real face crop; visual review still required.'}));
