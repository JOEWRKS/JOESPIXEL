'use strict';
const assert=require('node:assert/strict');
const PNG=require(require.resolve('pngjs',{paths:[__dirname,process.cwd()]})).PNG;
const {parsePalette,inspect}=require('./build-palette-native.cjs');
const {rasterObservedDetails}=require('./raster-observed-details.cjs');
const palette=parsePalette({colors:['#222244','#FFFFFF','#AA6677','#DD99AA','#FFEEDD']});
const dark=0x222244ff,white=0xffffffff,lip=0xaa6677ff,pale=0xdd99aaff,skin=0xffeeddff;
const grid={x:Array.from({length:8},(_,i)=>[i*8,(i+1)*8]),y:Array.from({length:8},(_,i)=>[i*8,(i+1)*8])};
function fill(w,h,color){const p=new PNG({width:w,height:h});for(let i=0;i<w*h;i++)p.data.writeUInt32BE(color,i*4);return p;}
function rect(im,x,y,w,h,c){for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++)im.data.writeUInt32BE(c,(yy*im.width+xx)*4);}
const feature={name:'observed region',mode:'compact-islands',sourceRegion:[8,8,40,40],colors:['#FFFFFF']};
function fixture(){const source=fill(64,64,dark),base=fill(8,8,dark);rect(source,26,26,3,3,white);return {source,base};}
let count=0;function test(name,fn){fn();console.log('PASS '+name);count++;}
const run=(s,b,f=[feature],g=grid)=>rasterObservedDetails(PNG,s,b,g,f,palette);
test('a missed off-center enclosed source island survives saving, without changing its surroundings',()=>{
 const {source,base}=fixture(),before=Buffer.from(base.data),raw=Buffer.from(source.data),r=run(source,base),saved=PNG.sync.read(PNG.sync.write(r.image));
 assert.equal(saved.data.readUInt32BE((3*8+3)*4),white);assert.equal(r.report.changedCells,1);assert.equal(r.report.outsideChangedCells,0);
 assert.equal(inspect(saved,palette).offPalettePixels,0);assert(base.data.equals(before));assert(source.data.equals(raw));
 assert(saved.data.equals(run(source,base).image.data));assert(saved.data.equals(run(source,saved).image.data));
});
test('a retained island does not grow',()=>{const {source,base}=fixture();base.data.writeUInt32BE(white,(3*8+3)*4);assert.equal(run(source,base).report.changedCells,0);});
test('single source specks and long bright boundary fragments are not reflections',()=>{
 const {source,base}=fixture();rect(source,26,26,3,3,dark);rect(source,26,26,1,1,white);assert.equal(run(source,base).report.changedCells,0);
 rect(source,24,26,11,1,white);assert.equal(run(source,base).report.changedCells,0);
});
test('light fragments on light material are not dark-enclosed highlights',()=>{
 const source=fill(64,64,skin),base=fill(8,8,skin);rect(source,26,26,3,3,white);assert.equal(run(source,base).report.changedCells,0);
});
test('source-boundary clipping does not fabricate a missing region',()=>{const {source,base}=fixture();assert.equal(run(source,base,[{...feature,sourceRegion:[26,26,3,3]}]).report.changedCells,0);});
test('source phase offsets are retained',()=>{
 const {source,base}=fixture(),g={x:grid.x.map(c=>c.map(v=>v+2)),y:grid.y.map(c=>c.map(v=>v+2))};
 assert.equal(run(source,base,[feature],g).image.data.readUInt32BE((3*8+3)*4),white);
});
test('a thin source profile replaces weak center-sampled color without forcing a smile',()=>{
 const source=fill(64,64,skin),base=fill(8,8,skin);rect(source,16,25,24,3,lip);rect(base,2,3,3,1,pale);
 const f={name:'any stroke',mode:'thin-profile',sourceRegion:[12,20,32,15],colors:['#AA6677','#DD99AA']};
 const r=run(source,base,[f]);assert.equal(r.report.changedCells,3);for(let x=2;x<5;x++)assert.equal(r.image.data.readUInt32BE((3*8+x)*4),lip);
 assert.equal(r.report.outsideChangedCells,0);assert(r.image.data.equals(run(source,r.image,[f]).image.data));
});
test('thick ends are preserved even if most of a profile is thin',()=>{
 const source=fill(64,64,skin),base=fill(8,8,skin);rect(source,16,32,25,3,lip);rect(source,16,20,3,15,lip);
 const f={name:'bent endpoint',mode:'thin-profile',sourceRegion:[12,16,34,24],colors:['#AA6677']};
 const r=run(source,base,[f]);assert.equal(r.report.changedCells,0);assert(r.report.features[0].decisions.some(d=>d.reason==='not-a-thin-profile'));
});
test('names have no behavior and output-coordinate annotations are refused',()=>{
 const {source,base}=fixture();assert(run(source,base).image.data.equals(run(source,base,[{...feature,name:'unrelated subject'}]).image.data));
 assert.throws(()=>run(source,base,[{...feature,target:[3,3]}]),/Source-only/);
});
test('invalid coordinates, palette entries and grids fail explicitly',()=>{
 const {source,base}=fixture();assert.throws(()=>run(source,base,[{...feature,sourceRegion:[-1,0,20,20]}]),/region/);
 assert.throws(()=>run(source,base,[{...feature,colors:['#FF0000']}]),/palette/);
 assert.throws(()=>run(source,base,[feature],{x:[[0,0]],y:grid.y}),/grid/);
 assert.throws(()=>run(source,base,[{...feature,mode:'unknown'}]),/mode/);
 source.data.writeUInt32BE(0xff0000ff,(26*64+26)*4);assert.throws(()=>run(source,base),/checkpoint/);
});
test('optional cheek pigment cannot overwrite other material roles',()=>{
 const {rasterFlatColorRegions}=require('./raster-observed-details.cjs');
 const source=fill(16,16,pale),base=fill(2,2,lip);base.data.writeUInt32BE(dark,4);base.data.writeUInt32BE(white,8);
 const features=[{name:'observed optional pigment',rect:[0,0,16,16],editableColors:['#AA6677','#FFEEDD']}];
 const roles=[{name:'pigment',samples:[[221,153,170]],color:'#FFEEDD'}];
 const omit=rasterFlatColorRegions(PNG,source,base,features,roles,8,palette);
 assert.equal(omit.image.data.readUInt32BE(0),skin);assert.equal(omit.image.data.readUInt32BE(12),skin);
 assert.equal(omit.image.data.readUInt32BE(4),dark);assert.equal(omit.image.data.readUInt32BE(8),white);
 const keep=rasterFlatColorRegions(PNG,source,base,features,[{...roles[0],color:'#DD99AA'}],8,palette);
 assert.equal(keep.image.data.readUInt32BE(0),pale);assert.equal(keep.image.data.readUInt32BE(4),dark);
 assert.throws(()=>rasterFlatColorRegions(PNG,source,base,[{...features[0],editableColors:['#123456']}],roles,8,palette),/fixed palette/);
 assert(omit.image.data.equals(rasterFlatColorRegions(PNG,source,omit.image,features,roles,8,palette).image.data));
});
console.log(count+' tests passed.');
