'use strict';
// Feature inventory routes: declared, then measured on the built native image. Not artwork approval.
const assert=require('node:assert/strict');
const {PNG}=require(require.resolve('pngjs',{paths:[__dirname,process.cwd()]}));
const {parsePalette}=require('./build-palette-native.cjs');
const {assertFeaturePlacement,measureFeaturePlacement}=require('./feature-placement.cjs');
let passed=0;const test=(name,fn)=>{fn();passed++;console.log('PASS '+name);};
const palette=parsePalette({colors:['#FECAA5','#150D0A']}),size=[64,32];
const feature=(id,placement)=>({id,sourceObservation:'Observed '+id+'.',criterion:'Stays.',...(placement?{placement}:{})});
const contract=(features,extra={})=>({kind:'character',features,formPolicy:{version:1,placement:'source-path',features:[{name:'smile'}]},sourceToNative:{scaleX:.125,scaleY:.125,offsetX:0,offsetY:0},...extra});
const native=ink=>{const n=new PNG({width:8,height:4});for(let p=0;p<32;p++)n.data.writeUInt32BE(0xFECAA5ff,p*4);for(const [x,y] of ink)n.data.writeUInt32BE(0x150D0Aff,(y*8+x)*4);return n;};
const nose={route:'measured',sourceRegion:[24,8,10,12],color:'#150D0A'};

test('a character nose or mouth without a placement route stops before conversion',()=>{
 assert.throws(()=>assertFeaturePlacement(contract([feature('nose'),feature('mouth',{route:'formPolicy',feature:'smile'})]),palette,size),/nose needs a placement route/);
 assert.doesNotThrow(()=>assertFeaturePlacement(contract([feature('nose'),feature('mouth')],{kind:'other'}),palette,size));
});
test('routes are checked against the declared policies, palette and source',()=>{
 assert.throws(()=>assertFeaturePlacement(contract([feature('mouth',{route:'formPolicy',feature:'grin'})]),palette,size),/does not declare/);
 assert.throws(()=>assertFeaturePlacement(contract([feature('nose',{...nose,color:'#000000'})]),palette,size),/not in the palette/);
 assert.throws(()=>assertFeaturePlacement(contract([feature('nose',{...nose,sourceRegion:[60,8,10,12]})]),palette,size),/inside the source/);
 assert.throws(()=>assertFeaturePlacement(contract([feature('nose',{route:'omitted',reason:' '})]),palette,size),/needs a reason/);
 assert.throws(()=>assertFeaturePlacement(contract([feature('nose',{...nose,target:[3,1]})]),palette,size),/source region/);
});
test('a measured mark that area voting erased stops the run',()=>{
 const c=contract([feature('nose',nose)]);
 assert.throws(()=>measureFeaturePlacement(c,native([[0,0]]),null),/nose kept no #150D0A cell in native cells x3-4 y1-2/);
 assert.deepEqual(measureFeaturePlacement(c,native([[3,2]]),null)[0].cells,1);
});
test('a formPolicy route must have placed cells; an omission is carried into the report',()=>{
 const c=contract([feature('mouth',{route:'formPolicy',feature:'smile'}),feature('nose',{route:'omitted',reason:'Grid too small.'})]);
 assert.throws(()=>measureFeaturePlacement(c,native([]),{features:[{name:'smile',action:'joint-geometry-unresolved',reason:'no path'}]}),/smile placed no cells \(joint-geometry-unresolved: no path\)/);
 const r=measureFeaturePlacement(c,native([]),{features:[{name:'smile',cells:3}]});
 assert.deepEqual(r,[{id:'mouth',route:'formPolicy',feature:'smile',cells:3},{id:'nose',route:'omitted',reason:'Grid too small.'}]);
});
console.log(JSON.stringify({passed,scope:'Route declaration and survival measurement only; whether the kept mark reads right is a visual review.'}));
