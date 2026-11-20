'use strict';
// Region derivation and capacity probe mechanics. Not artwork approval.
const assert=require('node:assert/strict');
const {PNG}=require(require.resolve('pngjs',{paths:[__dirname,process.cwd()]}));
const {parsePalette}=require('./build-palette-native.cjs');
const {derive}=require('./derive-material-regions.cjs');
const {probe}=require('./capacity-probe.cjs');
let passed=0;const test=(name,fn)=>{fn();passed++;console.log('PASS '+name);};
const W=24,H=12;
const image=paint=>{const s=new PNG({width:W,height:H});for(let y=0;y<H;y++)for(let x=0;x<W;x++)s.data.set([...paint(x,y),255],(y*W+x)*4);return s;};
const palette=parsePalette({colors:['#FFFFFF','#202020','#A05A36','#9E4A28','#F0F0F0']});
const materials=[
 {material:'background',colors:['#FFFFFF'],baseColor:'#FFFFFF'},
 {material:'ink',colors:['#202020'],baseColor:'#202020'},
 {material:'leather',colors:['#A05A36','#F0F0F0'],baseColor:'#A05A36'},
 {material:'hair',colors:['#9E4A28','#F0F0F0'],baseColor:'#9E4A28'}];
const nearestIsHair=(s,x,y)=>{const i=(y*W+x)*4,d=c=>(s.data[i]-c[0])**2+(s.data[i+1]-c[1])**2+(s.data[i+2]-c[2])**2;return d([158,74,40])<d([160,90,54]);};
const label=(r,x,y)=>r.regions.find(g=>{const[[x0,yy],[x1]]=g.polygon;return yy===y&&x>=x0&&x<x1;}).material;

test('a flat area is assigned as a whole, not pixel by nearest colour',()=>{
 // Leather pouch whose flat body drifts smoothly toward the hair tone on its right third; the
 // drifted pixels are nearer the hair colour but belong to the same connected flat area.
 const s=image((x,y)=>x<2||x>21||y<2||y>9?[255,255,255]:x===2||x===21||y===2||y===9?[32,32,32]:x<12?[160,90,54]:[160-Math.round((x-11)/9),90-Math.round((x-11)*10/9),54-Math.round((x-11)*8/9)]);
 const r=derive(s,palette,materials,{flat:12});
 assert(nearestIsHair(s,20,5),'fixture must contain hair-nearest pixels');
 for(let x=3;x<21;x++)assert.equal(label(r,x,5),'leather','cell '+x);
});
test('a colour shared by two materials follows its surroundings',()=>{
 const s=image((x,y)=>x<12?(x>4&&x<7&&y>4&&y<7?[240,240,240]:[160,90,54]):(x>16&&x<19&&y>4&&y<7?[240,240,240]:[158,74,40]));
 const r=derive(s,palette,materials,{flat:6});
 assert.equal(label(r,5,5),'leather');assert.equal(label(r,17,5),'hair');
});
test('every region is listed in the generated inventory',()=>{
 const s=image(x=>x<12?[160,90,54]:[158,74,40]),r=derive(s,palette,materials);
 const listed=new Set(r.inventory.flatMap(i=>i.regionIds));assert.equal(listed.size,r.regions.length);
});
test('a colour without a material is rejected',()=>{
 assert.throws(()=>derive(image(()=>[255,255,255]),palette,materials.slice(0,3)),/without a material/);
});
test('capacity probe keeps the same canvas and writes one-dot ink on the exterior',()=>{
 const s=image((x,y)=>x>=6&&x<18&&y>=3&&y<9?[160,90,54]:[255,255,255]);
 const [a,b]=probe(s,palette,{background:'#FFFFFF',ink:['#202020'],candidates:[[12,6],[6,3]]});
 assert.deepEqual(a.grid,{canvas:[24,12],native:[12,6],cell:2,origin:[0,0]});assert.equal(b.grid.cell,4);
 assert.equal(a.images.expanded.width,24);assert(a.inkCells>0);
 assert.throws(()=>probe(s,palette,{background:'#FFFFFF',ink:['#202020'],candidates:[[7,3]]}),/not divisible/);
});
console.log(JSON.stringify({passed,scope:'Spatial helper and probe mechanics only; the material table and the probe verdicts remain observations.'}));
