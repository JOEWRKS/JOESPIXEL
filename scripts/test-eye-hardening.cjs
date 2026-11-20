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
test('lid tails and rim nubs on an eye fill yield to the fill',()=>{
 // Whole-iris partitions leave the ink rim in the lid role; thin rim cells must not take the iris.
 const r=build(c.rimInBase).eyePolicyReport,left=r.eyes.find(e=>e.name==='left-eye');
 assert(left.prunedStrokeCells.length>0);
 for(const name of ['white','iris','iris-dark','pupil'])assert(left.roles.find(x=>x.name===name).nativeCells>0,name);
});
test('sclera inside an iris partition is not counted as extra glints',()=>{
 const r=build(c.rimInRing).eyePolicyReport;
 for(const e of r.eyes){assert(e.lightPixelsMovedToWhite>0,e.name);assert(e.roles.find(x=>x.name==='light').nativeCells<=1,e.name);}
});
test('the small eye keeps the source order white | glint over pupil | iris below',()=>{
 // Source observation of the left eye at 8px cells (crop coordinates): white x4-5, glint (6,7),
 // pupil column 7 rows 7-8, green row 9. Checked on the saved roles, not painted.
 const r=build(c.rimInRing),left=r.eyePolicyReport.eyes.find(e=>e.name==='left-eye'),role=new Map();
 const at=(x,y)=>{const i=(y*24+x)*4;return '#'+[0,1,2].map(k=>r.image.data[i+k].toString(16).padStart(2,'0')).join('').toUpperCase();};
 assert.equal(at(6,7),'#F3F5F4');assert.equal(at(7,7),'#150D0A');assert.equal(at(7,8),'#150D0A');assert.equal(at(5,7),'#FAEDE6');assert.equal(at(7,9),'#499246');
});
test('ring partitions give the rim to the iris and keep every observed eye plane',()=>{
 const r=build(c.rimInRing).eyePolicyReport;
 for(const e of r.eyes)for(const role of e.roles)if(role.sourcePixels>=128&&role.name!=='light')assert(role.nativeCells>0,e.name+'/'+role.name+' lost');
 // The rim must not inflate the lid: the lid gets no more cells than its own source pigment (+1 for rounding).
 for(const e of r.eyes){const lid=e.roles.find(x=>x.name==='lid');assert(lid.nativeCells<=Math.ceil(lid.sourcePixels/64)+1,e.name+' lid '+lid.nativeCells+' cells from '+lid.sourcePixels+' px');}
});
// Thick lids. A synthetic lid band on a 6x4 grid of 8px cells: ink rows y0..y1 over a pale sclera.
const lidEye=(y0,y1,thickness)=>{
 const s=new PNG({width:48,height:32});for(let y=0;y<32;y++)for(let x=0;x<48;x++)s.data.set([...(x>=6&&x<42&&y>=y0&&y<y1?[16,16,16]:x>=6&&x<42&&y>=y1&&y<30?[240,208,192]:[255,255,255]),255],(y*48+x)*4);
 const policy={version:1,visibility:'visible',placement:'source-partitions',geometryPolicy:'source-stroke-fill',observation:'Synthetic lid band over sclera.',eyes:[{name:'eye',rect:[0,0,48,32],sourcePolygon:[[0,0],[48,0],[48,32],[0,32]],reflection:'off',baseRoles:['lid','skin'],
  partitions:[{name:'sclera',observation:'Pale area under the lid.',sourcePolygon:[[6,y1],[42,y1],[42,30],[6,30]],roles:['white']}],roles:[
  {name:'lid',family:'lid',geometry:'stroke',width:1,closed:false,...(thickness?{thickness}:{}),color:'#101010',colors:['#101010'],samples:[[16,16,16]]},
  {name:'skin',family:'skin',geometry:'fill',color:'#FFFFFF',colors:['#FFFFFF'],samples:[[255,255,255]]},
  {name:'white',family:'white',geometry:'fill',color:'#F0D0C0',colors:['#F0D0C0'],samples:[[240,208,192]]}]}]};
 return buildNative(PNG,s,parsePalette({colors:['#FFFFFF','#101010','#F0D0C0']}),6,4,'#FFFFFF','source-region-area',null,null,null,policy);
};
const inkRows=r=>[0,1,2,3].filter(y=>[1,2,3,4].some(x=>r.image.data.readUInt32BE((y*6+x)*4)===0x101010ff));
test('a lid band that rounds to one row needs no thickness decision',()=>{
 // 10px band split 5/5 across a row boundary: each row is over half covered, together 1.25 cells.
 const r=lidEye(11,21);assert.deepEqual(inkRows(r),[1]);assert.equal(r.eyePolicyReport.eyes[0].thickStrokeCells,undefined);
});
test('an undeclared two-row source lid stops instead of giving its second row to the fill',()=>{
 assert.throws(()=>lidEye(8,21),/source mass of two rows.*thickness/);
});
test('thickness "source" keeps the observed second lid row; "one-dot" thins it and reports it',()=>{
 const kept=lidEye(8,21,'source'),thin=lidEye(8,21,'one-dot');
 assert.deepEqual(inkRows(kept),[1,2]);assert.deepEqual(inkRows(thin).length,1);
 assert(thin.eyePolicyReport.eyes[0].thickStrokeCells.every(c=>c.kept===false));
 assert(kept.eyePolicyReport.eyes[0].geometry.strokes[0].massCells.length>0);
});
test('the mechanic thick lids stay two rows and the dark iris keeps its source share',()=>{
 const r=build(c.rimInRing).eyePolicyReport,right=r.eyes.find(e=>e.name==='right-eye'),cells=n=>right.roles.find(x=>x.name===n).nativeCells;
 // Source: lid 740 px (11.6 cells), dark iris 584 px (9.1 cells). Before: 6 and 15 cells.
 assert(cells('lid')>=10,'lid '+cells('lid'));assert(cells('iris-dark')<=12,'iris-dark '+cells('iris-dark'));
});
test('one antialias pixel of pupil pigment does not block an observed pupil oval',()=>{
 const right=build(c.rimInRing).eyePolicyReport.eyes.find(e=>e.name==='right-eye'),pupil=right.fillShapes.find(s=>s.role==='pupil');
 assert.equal(pupil.ignoredSourceFragments[0].pixels,1);assert.equal(pupil.cells.length,2);
});
test('an iris partition leaves the eye outer contour and skin to the surrounding material',()=>{
 // Source (crop x151-155, y27-52): iris | rim | sclera strip | black eye contour | skin. The
 // iris-right partition lists iris, dark iris and white only; it used to paint the contour dark
 // iris (a 2x3 dark block in the eye corner) and the skin inside the polygon as sclera.
 const r=build(c.rimInRing),right=r.eyePolicyReport.eyes.find(e=>e.name==='right-eye');
 const at=(x,y)=>'#'+[0,1,2].map(k=>r.image.data[(y*24+x)*4+k].toString(16).padStart(2,'0')).join('').toUpperCase();
 assert.equal(at(19,4),'#150D0A');for(const y of [3,4,5])assert(!['#224D29','#499246','#FAEDE6'].includes(at(19,y)),'contour column '+y+' '+at(19,y));
 assert(right.partitionPixelsLeftToSurroundingMaterial>0);
});
console.log(JSON.stringify({passed,scope:'Stroke topology and eye-plane guards on synthetic masks and one real face crop; visual review still required.'}));
