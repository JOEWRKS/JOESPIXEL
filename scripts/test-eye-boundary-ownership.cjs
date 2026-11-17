'use strict';
const assert=require('node:assert/strict'),{PNG}=require(require.resolve('pngjs',{paths:[__dirname,process.cwd()]}));
const eye=require('./eye-plane-policy.cjs'),b=require('./build-palette-native.cjs'),ink=require('./raster-source-ink-paths.cjs');
const source=new PNG({width:48,height:32});for(let p=0;p<48*32;p++)source.data.set([244,211,183,255],p*4);
for(let y=8;y<20;y++)for(let x=8;x<20;x++)source.data.set([36,36,45,255],(y*48+x)*4);
for(let y=2;y<30;y++)source.data.set([80,62,67,255],(y*48+28)*4);
const palette=b.parsePalette({colors:['#F4D3B7','#24242D','#503E43']}),policy={version:1,visibility:'visible',observation:'Synthetic eye beside separate hair line inside same observation window.',eyes:[{name:'eye',rect:[8,4,28,24],sourcePolygon:[[8,8],[20,8],[20,20],[8,20]],reflection:'off',roles:[{name:'lid-pupil',color:'#24242D',colors:['#24242D'],samples:[[36,36,45]]}]}]};
const base=b.buildNative(PNG,source,palette,12,8,'#F4D3B7','area-vote').image,grid=eye.affineEyeGrid(source,base,{offsetX:0,offsetY:0,fitWidth:12,fitHeight:8}),observed={version:1,excluded:[],roles:[{name:'hair',rect:[24,0,12,32],color:'#503E43',replaceColors:['#503E43'],samples:[[80,62,67]],context:[[244,211,183]],tolerance:5,observation:'Straight separate source hair boundary.'}]};
let count=0;function test(n,f){f();console.log('PASS '+n);count++;}
test('source window is not the owned eye',()=>{assert(eye.eyeOwnsSource(policy.eyes[0],12,12));assert(!eye.eyeOwnsSource(policy.eyes[0],28,12));});
test('polygon outside window rejected',()=>{const p=structuredClone(policy);p.eyes[0].sourcePolygon[0]=[0,0];assert.throws(()=>eye.assertEyePolicy(p,palette),/polygon/);});
const ownership=eye.eyeOwnership(source,policy,12,8);
test('actual eye cells protected, neighbouring line cells available',()=>{assert(ownership.cells.has(2*12+2));for(let y=1;y<7;y++)assert(!ownership.cells.has(y*12+7));});
const result=ink.allocateObservedStrokeLayout(PNG,source,base,palette,observed,[],null,ownership);
test('line is continuous through old rectangular exclusion',()=>{for(let y=1;y<7;y++)assert.equal(result.image.data.readUInt32BE((y*12+7)*4),0x503e43ff);});
test('eye remains exact while adjacent line is reconstructed',()=>{for(const p of ownership.cells)assert.equal(result.image.data.readUInt32BE(p*4),base.data.readUInt32BE(p*4));});
test('old rectangle reproduces missing middle section',()=>{const old=ink.allocateObservedStrokeLayout(PNG,source,base,palette,{...observed,excluded:[policy.eyes[0].rect]});assert.notEqual(old.image.data.readUInt32BE((3*12+7)*4),0x503e43ff);});
test('eye color policy cannot recolor hair outside polygon',()=>{const r=eye.applyEyePolicy(PNG,source,result.image,palette,policy,grid);for(let y=1;y<7;y++)assert.equal(r.image.data.readUInt32BE((y*12+7)*4),0x503e43ff);});
test('remapping retains eye shape in the new coordinate system',()=>{const p=eye.remapEyePolicy(policy,grid);assert.deepEqual(p.eyes[0].sourcePolygon,[[2,2],[5,2],[5,5],[2,5]]);eye.assertEyePolicy(p,palette);});
test('eye placement cannot reintroduce a foreign color into assigned surrounding skin',()=>{
 const s=new PNG({width:12,height:12});for(let p=0;p<144;p++)s.data.writeUInt32BE(0xf9e6bfff,p*4);for(let y=4;y<8;y++)for(let x=7;x<12;x++)s.data.writeUInt32BE(0x24242dff,(y*12+x)*4);
 const pal=b.parsePalette({colors:['#F4D3B7','#F9E6BF','#24242D']}),base=new PNG({width:3,height:3});for(let p=0;p<9;p++)base.data.writeUInt32BE(0xf4d3b7ff,p*4);
 const polygon=[[7,4],[12,4],[12,8],[7,8]],p={version:1,visibility:'visible',placement:'source-partitions',observation:'Synthetic partial eye cell on assigned skin.',eyes:[{name:'eye',rect:[4,4,8,4],sourcePolygon:polygon,reflection:'off',roles:[{name:'iris',family:'iris',color:'#24242D',colors:['#24242D'],samples:[[36,36,45]],required:true},{name:'skin',family:'skin',color:'#F4D3B7',colors:['#F4D3B7'],samples:[[249,230,191]],required:false}],baseRoles:['iris','skin'],partitions:[{name:'iris',sourcePolygon:polygon,roles:['iris'],observation:'Observed dark fill.'}]}]},g=eye.affineEyeGrid(s,base,{offsetX:0,offsetY:0,fitWidth:3,fitHeight:3}),material={owners:new Int16Array(144),sourceExceptions:new Uint8Array(144),plan:{regions:[{material:'skin',colors:['#F4D3B7']}]}};
 const old=eye.applyEyePolicy(PNG,s,base,pal,p,g),fixed=eye.applyEyePolicy(PNG,s,base,pal,p,g,material);assert.equal(old.image.data.readUInt32BE(4*4),0xf9e6bfff);assert.equal(fixed.image.data.readUInt32BE(4*4),0xf4d3b7ff);assert.equal(fixed.image.data.readUInt32BE(5*4),0x24242dff);assert.equal(eye.auditEyePolicy(PNG,s,fixed.image,pal,p,g,material).status,'PASS');
 for(let y=4;y<8;y++)for(let x=4;x<7;x++)s.data.writeUInt32BE(0x24242dff,(y*12+x)*4);
 const observedDark=eye.applyEyePolicy(PNG,s,base,pal,p,g,material);assert.equal(observedDark.image.data.readUInt32BE(4*4),0x24242dff,'broad skin ownership must not recolor observed dark eye context');
});
console.log(JSON.stringify({passed:count,scope:'Mechanical source-ownership regression; not visual approval'}));
