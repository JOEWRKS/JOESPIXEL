'use strict';
const assert = require('node:assert/strict');
const { PNG } = require(require.resolve('pngjs', { paths: [__dirname, process.cwd()] }));
const { parsePalette, inspect, buildNative, refineRegions, enlarge, exactBlocks } = require('./build-palette-native.cjs');
let passed = 0;
function test(name, check) { check(); passed++; console.log('PASS ' + name); }
const palette = parsePalette({ colorCount: 2, colors: ['#000000', '#FFFFFF'] });
function image(width, height, rgba) {
  const png = new PNG({ width, height });
  for (let i = 0; i < png.data.length; i += 4) png.data.set(rgba, i);
  return png;
}
test('reject duplicate colors even when hex case differs', () => {
  assert.throws(() => parsePalette({ colors: ['#aabbcc', '#AABBCC'] }), /Duplicate/);
});
test('reject declared count mismatch and invalid HEX', () => {
  assert.throws(() => parsePalette({ colorCount: 3, colors: ['#000000'] }), /colorCount/);
  assert.throws(() => parsePalette({ colors: ['#GG0000'] }), /explicit/);
});
test('near colors map to exact entries without intermediate RGB', () => {
  const src = image(2, 1, [1, 2, 3, 255]);
  src.data.set([253, 254, 252, 255], 4);
  const native = buildNative(PNG, src, palette, 2, 1, '#FFFFFF').image;
  assert.deepEqual([...native.data], [0, 0, 0, 255, 255, 255, 255, 255]);
  assert.equal(inspect(native, palette).offPalettePixels, 0);
});
test('pixel-center sampling does not average neighboring cells', () => {
  const src = image(4, 1, [0, 0, 0, 255]);
  src.data.set([255, 255, 255, 255], 4);
  src.data.set([255, 255, 255, 255], 8);
  const native = buildNative(PNG, src, palette, 2, 1, '#FFFFFF').image;
  assert.deepEqual([...native.data], [255, 255, 255, 255, 0, 0, 0, 255]);
});
test('already compliant source stays pixel-identical at same size', () => {
  const src = image(2, 2, [0, 0, 0, 255]);
  src.data.set([255, 255, 255, 255], 8);
  assert.deepEqual(buildNative(PNG, src, palette, 2, 2, '#FFFFFF').image.data, src.data);
});
test('partial alpha 253 is counted and rejected, not ignored', () => {
  const src = image(1, 1, [77, 77, 77, 253]);
  const stats = inspect(src, palette);
  assert.equal(stats.colorsUsed, 1);
  assert.equal(stats.offPalettePixels, 1);
  assert.equal(stats.partialAlphaPixels, 1);
  assert.throws(() => buildNative(PNG, src, palette, 1, 1, '#FFFFFF'), /opaque/);
});
test('transparent input is rejected instead of silently flattened', () => {
  assert.throws(() => buildNative(PNG, image(1, 1, [0, 0, 0, 0]), palette, 1, 1, '#FFFFFF'), /opaque/);
});
test('letterbox uses only explicit palette background', () => {
  const src = image(2, 1, [0, 0, 0, 255]);
  const { image: native, fit } = buildNative(PNG, src, palette, 2, 3, '#FFFFFF');
  assert.deepEqual(fit, { fitWidth: 2, fitHeight: 1, offsetX: 0, offsetY: 1 });
  assert.deepEqual([...native.data.subarray(0, 4)], [255, 255, 255, 255]);
  assert.throws(() => buildNative(PNG, src, palette, 2, 3, '#FEFEFE'), /Background/);
});
test('invalid grid or fractional export scale is rejected', () => {
  const src = image(1, 1, [0, 0, 0, 255]);
  assert.throws(() => buildNative(PNG, src, palette, 1.5, 1, '#FFFFFF'), /dimensions/);
  assert.throws(() => enlarge(PNG, src, 1.5), /Scale/);
});
test('PNG readback preserves grid and detects a single corrupted subpixel', () => {
  const src = image(2, 2, [0, 0, 0, 255]);
  src.data.set([255, 255, 255, 255], 4);
  const saved = PNG.sync.read(PNG.sync.write(enlarge(PNG, src, 4)));
  assert.equal(exactBlocks(src, saved, 4), true);
  saved.data[0] = 1;
  assert.equal(exactBlocks(src, saved, 4), false);
  assert.equal(inspect(saved, palette).offPalettePixels, 1);
});
test('area vote ignores a tiny center speck, with documented thin-feature loss', () => {
  const src = image(9, 1, [255, 255, 255, 255]);
  src.data.set([0, 0, 0, 255], 4*4);
  const nearest = buildNative(PNG, src, palette, 1, 1, '#FFFFFF');
  const vote = buildNative(PNG, src, palette, 1, 1, '#FFFFFF', 'area-vote');
  assert.equal(nearest.image.data[0], 0);
  assert.equal(vote.image.data[0], 255);
  assert.equal(vote.diagnostics.centerChangedCells, 1);
});

test('fractional source coverage uses area weights, not rounded box counts', () => {
  const src = image(3, 1, [255, 255, 255, 255]);
  src.data.set([0, 0, 0, 255], 0);
  const vote = buildNative(PNG, src, palette, 2, 1, '#FFFFFF', 'area-vote');
  assert.deepEqual([...vote.image.data], [0, 0, 0, 255, 255, 255, 255, 255]);
});

test('equal area chooses center deterministically and reports ambiguity', () => {
  const src = image(2, 1, [0, 0, 0, 255]);
  src.data.set([255, 255, 255, 255], 4);
  const vote = buildNative(PNG, src, palette, 1, 1, '#FFFFFF', 'area-vote');
  assert.equal(vote.image.data[0], 255);
  assert.equal(vote.diagnostics.ambiguousCells, 1);
  assert.equal(vote.diagnostics.ambiguityExamples[0].dominance, 0.5);
});

test('area vote reconstructs an exact integer-enlarged native source', () => {
  const native = image(3, 2, [0, 0, 0, 255]);
  native.data.set([255, 255, 255, 255], 4);
  native.data.set([255, 255, 255, 255], 20);
  const enlarged = enlarge(PNG, native, 4);
  const vote = buildNative(PNG, enlarged, palette, 3, 2, '#FFFFFF', 'area-vote');
  assert(vote.image.data.equals(native.data));
  assert.equal(vote.diagnostics.ambiguousCells, 0);
});

test('area vote uses palette entries only and rejects unknown sampling', () => {
  const src = image(4, 4, [244, 247, 249, 255]);
  src.data.set([6, 3, 2, 255], 0);
  const vote = buildNative(PNG, src, palette, 2, 2, '#FFFFFF', 'area-vote');
  assert.equal(inspect(vote.image, palette).offPalettePixels, 0);
  assert.throws(() => buildNative(PNG, src, palette, 2, 2, '#FFFFFF', 'blur'), /Sampling/);
});
test('source-supported outline bridge joins two surviving segments', () => {
  const src=image(9,9,[255,255,255,255]);
  for(let y=0;y<9;y++)for(let x=3;x<6;x++)if(y<3||y>=6||x===4)src.data.set([0,0,0,255],(y*9+x)*4);
  const plain=buildNative(PNG,src,palette,3,3,'#FFFFFF','area-vote');
  const safe=buildNative(PNG,src,palette,3,3,'#FFFFFF','area-vote',{
    externalOutline:{color:'#000000',minCoverage:0.28,backgroundMinCoverage:0.08}});
  assert.equal(plain.image.data[16],255);
  assert.equal(safe.image.data[16],0);
  assert.equal(safe.protectionReport.changes.length,1);
  assert.equal(safe.image.data[12],255); // No unsupported sideways dilation.
});

test('bridge restriction rejects a parallel extra outline row', () => {
  const src=image(9,9,[255,255,255,255]);
  for(let y=3;y<=6;y++)for(let x=0;x<9;x++)src.data.set([0,0,0,255],(y*9+x)*4);
  const config={externalOutline:{color:'#000000',minCoverage:0.28,backgroundMinCoverage:0.08}};
  const guarded=buildNative(PNG,src,palette,3,3,'#FFFFFF','area-vote',config);
  const broad=buildNative(PNG,src,palette,3,3,'#FFFFFF','area-vote',{
    externalOutline:{...config.externalOutline,bridgeOnly:false}});
  assert.equal(guarded.image.data[28],255);
  assert.equal(broad.image.data[28],0);
  assert.equal(guarded.protectionReport.outlineReviewOnly.length,3);
});

test('declared feature preserves minority color only inside its native rectangle', () => {
  const src=image(6,1,[255,255,255,255]);
  src.data.set([0,0,0,255],4);src.data.set([0,0,0,255],16);
  const result=buildNative(PNG,src,palette,2,1,'#FFFFFF','area-vote',{
    features:[{name:'thin-feature',rect:[0,0,1,1],colors:['#000000'],minCoverage:0.3}]});
  assert.deepEqual([...result.image.data],[0,0,0,255,255,255,255,255]);
  assert.equal(result.protectionReport.changes.length,1);
});

test('feature diagnostics are candidates and preserve low-coverage unresolved cases', () => {
  const src=image(9,1,[255,255,255,255]);src.data.set([0,0,0,255],16);
  const result=buildNative(PNG,src,palette,1,1,'#FFFFFF','area-vote',{
    features:[{name:'tiny-feature',rect:[0,0,1,1],colors:['#000000'],minCoverage:0.2}]});
  assert.equal(result.image.data[0],255);
  assert.equal(result.protectionReport.suspectsAfter.length,1);
  assert.equal(result.protectionReport.changes.length,0);
});

test('protection rejects out-of-bounds regions, unknown colors and wrong mode', () => {
  const src=image(2,2,[255,255,255,255]);
  assert.throws(()=>buildNative(PNG,src,palette,2,2,'#FFFFFF','nearest',{}),/requires/);
  assert.throws(()=>buildNative(PNG,src,palette,2,2,'#FFFFFF','area-vote',{
    features:[{name:'bad',rect:[1,1,2,2],colors:['#000000'],minCoverage:0.2}]}),/Invalid feature/);
  assert.throws(()=>buildNative(PNG,src,palette,2,2,'#FFFFFF','area-vote',{
    externalOutline:{color:'#777777',minCoverage:0.2,backgroundMinCoverage:0.1}}),/Invalid outline/);
  assert.throws(()=>buildNative(PNG,src,palette,2,2,'#FFFFFF','area-vote',{
    features:[{name:'duplicate',rect:[0,0,2,2],colors:['#FFFFFF','#ffffff'],minCoverage:0.2}]}),/Invalid feature/);
});
test('enclosed white highlights are not exterior background for outline promotion', () => {
  const src=image(9,9,[255,255,255,255]);
  for(let y=2;y<=6;y++)for(let x=2;x<=6;x++)if(x===2||x===6||y===2||y===6||y===4)
    src.data.set([0,0,0,255],(y*9+x)*4);
  const result=buildNative(PNG,src,palette,3,3,'#FFFFFF','area-vote',{
    externalOutline:{color:'#000000',minCoverage:0.28,backgroundMinCoverage:0.08,bridgeOnly:false}});
  assert.equal(result.image.data[16],255);
  assert(!result.protectionReport.changes.some(p=>p.x===1&&p.y===1));
});
test('opposing but already-connected outline neighbors must not create a spur', () => {
  const src=image(9,9,[255,255,255,255]);
  for(const [cx,cy]of[[2,0],[2,1],[1,2]])for(let y=cy*3;y<cy*3+3;y++)for(let x=cx*3;x<cx*3+3;x++)
    src.data.set([0,0,0,255],(y*9+x)*4);
  for(let x=3;x<6;x++)src.data.set([0,0,0,255],(4*9+x)*4);
  const result=buildNative(PNG,src,palette,3,3,'#FFFFFF','area-vote',{
    externalOutline:{color:'#000000',minCoverage:0.28,backgroundMinCoverage:0.08}});
  assert.equal(result.image.data[16],255);
  assert(result.protectionReport.outlineReviewOnly.some(p=>p.x===1&&p.y===1&&p.reason.includes('already connect')));
});
test('regional coherence suppresses near-identical skin checkerboard without adding colors',()=>{
  const skin=parsePalette({colors:['#F5BF91','#FFDBAC']}),src=image(4,4,[253,204,157,255]);
  const pixels=[];for(let y=0;y<4;y++)for(let x=0;x<4;x++){pixels.push([x,y]);if((x+y)%2)src.data.set([254,205,158,255],(y*4+x)*4);}
  const plain=buildNative(PNG,src,skin,4,4,'#F5BF91','area-vote');
  assert.equal(inspect(plain.image,skin).colorsUsed,2);
  const stable=buildNative(PNG,src,skin,4,4,'#F5BF91','area-vote',null,
    [{name:'skin',pixels,colors:skin.map(p=>p.hex),coherence:0.0008}]);
  assert.equal(inspect(stable.image,skin).colorsUsed,1);
  assert.equal(inspect(stable.image,skin).offPalettePixels,0);
  assert(stable.regionReport.regions[0].converged);
});
test('regional consistency preserves a real strong source boundary',()=>{
  const src=image(4,2,[0,0,0,255]),pixels=[];
  for(let y=0;y<2;y++)for(let x=0;x<4;x++){pixels.push([x,y]);if(x>=2)src.data.set([255,255,255,255],(y*4+x)*4);}
  const out=buildNative(PNG,src,palette,4,2,'#FFFFFF','area-vote',null,
    [{name:'edge',pixels,colors:['#000000','#FFFFFF'],coherence:0.01}]);
  assert(out.image.data.equals(src.data));
});
test('partial bright feature is not promoted to a fully bright cell',()=>{
  const p=parsePalette({colors:['#30252D','#234835','#417859','#9BC59A','#FFF7E6']});
  const src=image(7,1,[48,37,45,255]);src.data.set([255,247,230,255],12);
  const out=buildNative(PNG,src,p,1,1,'#FFF7E6','area-vote',null,
    [{name:'reflection',pixels:[[0,0]],colors:p.map(c=>c.hex)}]);
  assert.notEqual(out.image.data[0],255);assert.equal(inspect(out.image,p).offPalettePixels,0);
});
test('region changes stay inside the explicit mask and leave inputs intact',()=>{
  const src=image(2,1,[80,80,80,255]),plain=buildNative(PNG,src,palette,2,1,'#FFFFFF');
  const original=Buffer.from(plain.image.data),sourceCopy=Buffer.from(src.data);
  const out=refineRegions(PNG,src,plain.image,palette,plain.fit,
    [{name:'one',pixels:[[0,0]],colors:['#FFFFFF']}]);
  assert.deepEqual([...out.image.data.subarray(0,4)],[255,255,255,255]);
  assert(out.image.data.subarray(4).equals(original.subarray(4)));
  assert(plain.image.data.equals(original));assert(src.data.equals(sourceCopy));
});
test('region validation rejects wrong colors, overlaps, fractional and padding coordinates',()=>{
  const src=image(2,1,[0,0,0,255]),base=buildNative(PNG,src,palette,2,3,'#FFFFFF');
  const run=regions=>refineRegions(PNG,src,base.image,palette,base.fit,regions);
  const good={name:'one',pixels:[[0,1]],colors:['#000000']};
  assert.throws(()=>run([{...good,colors:['#123456']}]),/palette/);
  assert.throws(()=>run([{...good,colors:['#000000','#000000']}]),/unique/);
  assert.throws(()=>run([good,good]),/overlapping/);
  assert.throws(()=>run([{...good,pixels:[[0.5,1]]}]),/integer/);
  assert.throws(()=>run([{...good,pixels:[[0,0]]}]),/outside fitted/);
  assert.throws(()=>run([{...good,coherence:NaN}]),/coherence/);
  assert.throws(()=>run([{...good,edgeThreshold:0}]),/edgeThreshold/);
});
test('empty regions preserve legacy output and pixel order is deterministic',()=>{
  const src=image(2,2,[70,70,70,255]),plain=buildNative(PNG,src,palette,2,2,'#FFFFFF','area-vote');
  const empty=buildNative(PNG,src,palette,2,2,'#FFFFFF','area-vote',null,[]);
  assert(empty.image.data.equals(plain.image.data));
  const pixels=[[0,0],[1,0],[0,1],[1,1]],region={name:'order',pixels,colors:['#000000','#FFFFFF'],coherence:0.001};
  const a=refineRegions(PNG,src,plain.image,palette,plain.fit,[region]);
  const b=refineRegions(PNG,src,plain.image,palette,plain.fit,[{...region,pixels:[...pixels].reverse()}]);
  assert(a.image.data.equals(b.image.data));
});
test('regional mode rejects partial alpha and conflicting legacy protection',()=>{
  const src=image(1,1,[0,0,0,255]),base=buildNative(PNG,src,palette,1,1,'#FFFFFF');
  const regions=[{name:'one',pixels:[[0,0]],colors:['#000000']}];
  assert.throws(()=>buildNative(PNG,src,palette,1,1,'#FFFFFF','area-vote',{},regions),/separate candidates/);
  src.data[3]=254;
  assert.throws(()=>refineRegions(PNG,src,base.image,palette,base.fit,regions),/opaque/);
});
const characterPalette=parsePalette({colors:['#30252D','#F5BF91','#FFDBAC','#BE805F','#85573F','#234835','#417859','#9BC59A','#FFF7E6','#FFE8C4','#EADFC5','#3C7899']});
const curveFeature={name:'mouth',kind:'curve',rect:[1,1,7,4],skin:['#F5BF91','#FFDBAC'],ink:['#BE805F','#85573F']};
const eyeFeature={name:'eye',kind:'eye',rect:[0,0,1,1],skin:['#F5BF91','#FFDBAC'],ink:['#30252D'],iris:['#234835','#417859','#9BC59A'],white:['#FFF7E6','#FFE8C4','#EADFC5'],glint:'#9BC59A'};
const structured=(src,w,h,structure)=>buildNative(PNG,src,characterPalette,w,h,'#FFF7E6','area-vote',null,null,structure);
function lineFixture(){const s=image(36,24,[245,191,145,255]);for(let x=8;x<28;x++)s.data.set([190,128,95,255],(14*36+x)*4);return s;}
test('source curve keeps minority pigment color and finds its row without output path coordinates',()=>{
 const s=lineFixture(),r=structured(s,9,6,{features:[curveFeature]}),stage=r.structureReport.stages[0];
 assert.equal(stage.path.length,5);assert(stage.path.every(p=>p.y===3));
 for(const p of stage.path)assert.deepEqual([...r.image.data.subarray((p.y*9+p.x)*4,(p.y*9+p.x)*4+3)],[190,128,95]);
 assert.equal(r.structureReport.manualOutputEdits,0);assert.equal(inspect(r.image,characterPalette).offPalettePixels,0);
});
test('source curve excludes an unrelated border component instead of joining nose to smile',()=>{
 const s=lineFixture();for(let y=4;y<8;y++)s.data.set([133,87,63,255],(y*36+4)*4);
 const r=structured(s,9,6,{features:[curveFeature]}),stage=r.structureReport.stages[0];
 assert.equal(stage.excludedSourceComponents,1);assert.equal(stage.path.length,5);assert(stage.path.every(p=>p.x>=2&&p.y===3));
});
test('missing source curve is reported and never invented',()=>{
 const s=image(36,24,[245,191,145,255]),plain=buildNative(PNG,s,characterPalette,9,6,'#FFF7E6','area-vote');
 const r=structured(s,9,6,{features:[curveFeature]});assert(r.image.data.equals(plain.image.data));assert(r.structureReport.suspects.length>0);
});
test('semantic white voting prevents several white shades losing to one black shade',()=>{
 const s=image(10,10,[48,37,45,255]),whites=[[255,247,230],[255,232,196],[234,223,197]];
 for(let k=0;k<55;k++)s.data.set([...whites[k%3],255],k*4);
 const plain=buildNative(PNG,s,characterPalette,1,1,'#FFF7E6','area-vote'),r=structured(s,1,1,{features:[eyeFeature]});
 assert.equal(plain.image.data[0],48);assert(r.image.data[0]>=234);assert.equal(r.structureReport.stages[0].glints.length,0);
});
test('eye roles preserve a dark pupil and compact source glint without white promotion',()=>{
 const s=image(20,20,[65,120,89,255]);
 for(let y=8;y<12;y++)for(let x=12;x<16;x++)s.data.set([48,37,45,255],(y*20+x)*4);
 s.data.set([255,247,230,255],(9*20+9)*4);s.data.set([255,247,230,255],(9*20+10)*4);
 const r=structured(s,5,5,{features:[{...eyeFeature,rect:[0,0,5,5]}]});
 assert.deepEqual([...r.image.data.subarray((2*5+3)*4,(2*5+3)*4+3)],[48,37,45]);
 assert.deepEqual([...r.image.data.subarray((2*5+2)*4,(2*5+2)*4+3)],[155,197,154]);
 assert.equal(r.structureReport.stages[0].glints.length,1);
});
test('eye role hue follows blue palette and rejects unsupported red-dominant segmentation',()=>{
 const s=image(4,4,[60,120,153,255]);
 const r=structured(s,1,1,{features:[{...eyeFeature,iris:['#3C7899']} ]});assert.equal(r.image.data[2],153);
 assert.throws(()=>structured(s,1,1,{features:[{...eyeFeature,iris:['#85573F']}]}),/supports green/);
});
test('a bright fragment touching the eye rectangle border cannot be promoted into a green glint',()=>{
 const s=image(20,20,[48,37,45,255]);s.data.set([255,247,230,255],(9*20)*4);
 const r=structured(s,5,5,{features:[{...eyeFeature,rect:[0,0,5,5]}]});
 assert.equal(r.image.data[(2*5)*4],48);assert.equal(r.structureReport.stages[0].glints.length,0);
 assert(r.structureReport.stages[0].highlightCandidates.some(c=>c.touchesBorder&&!c.accepted));
});
const contourConfig={color:'#30252D',background:'#FFF7E6',width:1,bandDepth:3};
function contourFixture(){const s=image(12,12,[255,247,230,255]);for(let y=2;y<10;y++)for(let x=2;x<10;x++)s.data.set([...(x<4||x>=8||y<4||y>=8?[48,37,45]:[65,120,89]),255],(y*12+x)*4);return s;}
test('contour pass removes duplicate inner layers without changing silhouette',()=>{
 const s=contourFixture(),r=structured(s,12,12,{contour:contourConfig});
 for(let k=0;k<144;k++)assert.equal(s.data[k*4]===255,r.image.data[k*4]===255);
 assert.equal(r.image.data[(3*12+5)*4],65);assert.equal(r.image.data[(2*12+5)*4],48);
 const stage=r.structureReport.stages[0];assert.equal(stage.wideSamples.length,0);assert.equal(stage.solid2x2Blocks.length,0);
});
test('unresolvable solid tip is retained and reported rather than silently shrinking silhouette',()=>{
 const s=image(6,6,[255,247,230,255]);for(let y=2;y<4;y++)for(let x=2;x<4;x++)s.data.set([48,37,45,255],(y*6+x)*4);
 const r=structured(s,6,6,{contour:contourConfig});assert(r.image.data.equals(s.data));assert(r.structureReport.suspects.some(p=>p.reason.includes('2x2')));
});
test('contour completion cannot thicken an existing one-cell run on a narrow colored tip',()=>{
 const s=image(8,8,[255,247,230,255]);for(let y=2;y<7;y++){s.data.set([48,37,45,255],(y*8+2)*4);s.data.set([133,87,63,255],(y*8+3)*4);}
 const r=structured(s,8,8,{contour:contourConfig});assert.equal(r.image.data[(3*8+3)*4],133);
 assert(r.structureReport.stages[0].preventedThickening.length>0);assert(r.structureReport.suspects.some(s=>s.reason.includes('prior one-cell')));
});
test('enclosed highlight is not treated as background without a declared seed',()=>{
 const s=contourFixture();s.data.set([255,247,230,255],(5*12+5)*4);
 const a=structured(s,12,12,{contour:contourConfig}),b=structured(s,12,12,{contour:{...contourConfig,seeds:[[5,5]]}});
 assert.equal(a.image.data[(5*12+6)*4],65);assert.equal(b.image.data[(5*12+6)*4],48);
});
test('structure inputs reject overlapping features, bad colors, seeds and bounds',()=>{
 const s=lineFixture();assert.throws(()=>structured(s,9,6,{features:[curveFeature,curveFeature]}),/Overlapping/);
 assert.throws(()=>structured(s,9,6,{features:[{...curveFeature,ink:['#123456']}]}),/palette/);
 assert.throws(()=>structured(s,9,6,{features:[{...curveFeature,rect:[0,0,10,3]}]}),/outside fitted/);
 assert.throws(()=>structured(s,9,6,{contour:{...contourConfig,seeds:[[2,2]]}}),/not background/);
 assert.throws(()=>structured(s,9,6,{contour:{...contourConfig,width:2}}),/one-cell/);
 assert.throws(()=>structured(s,9,6,{features:[{...curveFeature,contrast:NaN}]}),/contrast/);
});
test('structure conversion is deterministic, keeps source/config intact and logs all stage writes',()=>{
 const s=lineFixture(),bytes=Buffer.from(s.data),config={features:[curveFeature]},saved=JSON.stringify(config);
 const a=structured(s,9,6,config),b=structured(s,9,6,config);assert(a.image.data.equals(b.image.data));assert(s.data.equals(bytes));assert.equal(JSON.stringify(config),saved);
 const plain=buildNative(PNG,s,characterPalette,9,6,'#FFF7E6','area-vote').image;
 for(const stage of a.structureReport.stages)for(const p of stage.changes){const rgb=[1,3,5].map(i=>parseInt(p.to.slice(i,i+2),16));plain.data.set([...rgb,255],(p.y*9+p.x)*4);}assert(plain.data.equals(a.image.data));
});
test('empty structure preserves default output and conflicting legacy protection is rejected',()=>{
 const s=contourFixture(),a=buildNative(PNG,s,characterPalette,12,12,'#FFF7E6','area-vote'),b=structured(s,12,12,{});
 assert(a.image.data.equals(b.image.data));
 assert.throws(()=>buildNative(PNG,s,characterPalette,12,12,'#FFF7E6','area-vote',{},null,{}),/separate candidates/);
});
test('source-shape eye retains olive iris that strict green dominance mislabeled as skin',()=>{
 const s=image(4,4,[110,100,70,255]);
 const old=structured(s,1,1,{features:[eyeFeature]}),r=structured(s,1,1,{features:[{...eyeFeature,rasterization:'source-shape'}]});
 assert.equal(old.image.data[0],245);
 assert.deepEqual([...r.image.data.subarray(0,3)],[65,120,89]);
});

test('source-shape preserves the area of a thin sclera split across adjacent cells',()=>{
 const s=image(8,4,[48,37,45,255]);
 for(let y=0;y<3;y++)for(const x of [2,3,4,5])s.data.set([255,247,230,255],(y*8+x)*4);
 const f={...eyeFeature,rect:[0,0,2,1]},old=structured(s,2,1,{features:[f]}),r=structured(s,2,1,{features:[{...f,rasterization:'source-shape'}]});
 assert.equal(old.image.data[0],48);assert.equal(old.image.data[4],48);
 const stage=r.structureReport.stages[0];assert.equal(stage.sourceRoleArea.white,.75);assert.equal(stage.roleCountsBeforeGlints.white,1);
 assert.equal([r.image.data[0],r.image.data[4]].filter(r=>r===255).length,1);
});

test('source-shape does not magnify a tiny glint into a full bright green cell',()=>{
 const s=image(20,20,[48,37,45,255]);s.data.set([255,247,230,255],(9*20+9)*4);
 const f={...eyeFeature,rect:[0,0,5,5]},old=structured(s,5,5,{features:[f]}),r=structured(s,5,5,{features:[{...f,rasterization:'source-shape'}]});
 assert.equal(old.image.data[(2*5+2)*4],155);assert.notEqual(r.image.data[(2*5+2)*4],155);
 assert.equal(inspect(r.image,characterPalette).offPalettePixels,0);
});

test('source-shape mouth keeps a flat source stroke flat and does not fit a new smile',()=>{
 const s=lineFixture(),r=structured(s,9,6,{features:[{...curveFeature,rasterization:'source-shape'}]});
 const stage=r.structureReport.stages[0];assert.equal(stage.path.length,5);assert(stage.path.every(p=>p.y===3));
 assert(stage.path.every(p=>Number.isFinite(p.sourceCenterY)));assert.equal(inspect(r.image,characterPalette).offPalettePixels,0);
});

test('source-shape mouth trims a faint tail without erasing a strong endpoint',()=>{
 const s=lineFixture();for(let x=28;x<29;x++)s.data.set([190,128,95,255],(14*36+x)*4);
 const f={...curveFeature,rasterization:'source-shape'},a=structured(s,9,6,{features:[f]});
 assert.equal(a.structureReport.stages[0].path.at(-1).x,6);
 for(let x=29;x<31;x++)s.data.set([190,128,95,255],(14*36+x)*4);
 const b=structured(s,9,6,{features:[f]});assert.equal(b.structureReport.stages[0].path.at(-1).x,7);
});

test('source-shape stage changes stay in annotated features and are reproducible',()=>{
 const s=lineFixture(),config={features:[{...curveFeature,rasterization:'source-shape'}]},before=buildNative(PNG,s,characterPalette,9,6,'#FFF7E6','area-vote').image;
 const saved=Buffer.from(s.data),a=structured(s,9,6,config),b=structured(s,9,6,config);assert(a.image.data.equals(b.image.data));assert(s.data.equals(saved));
 for(let y=0;y<6;y++)for(let x=0;x<9;x++)if(x<1||x>=8||y<1||y>=5)assert(a.image.data.subarray((y*9+x)*4,(y*9+x+1)*4).equals(before.data.subarray((y*9+x)*4,(y*9+x+1)*4)));
 assert.throws(()=>structured(s,9,6,{features:[{...curveFeature,rasterization:'typo'}]}),/rasterization/);
});
test('compact sub-cell glint does not remain full white after winning the white vote',()=>{
 const s=image(20,20,[48,37,45,255]);for(let y=8;y<11;y++)for(let x=8;x<11;x++)s.data.set([255,247,230,255],(y*20+x)*4);
 const f={...eyeFeature,rect:[0,0,5,5]},old=structured(s,5,5,{features:[f]}),r=structured(s,5,5,{features:[{...f,rasterization:'source-shape'}]});
 assert.equal(old.image.data[(2*5+2)*4],255);assert.equal(r.image.data[(2*5+2)*4],155);
});

test('source-shape suppresses a sub-cell kink but never flattens a disconnected strong bend into a line',()=>{
 const fixture=bend=>{const s=image(36,32,[245,191,145,255]);for(let x=8;x<28;x++)for(let y=14;y<17;y++){const yy=y+(x>=16&&x<20?bend:0);s.data.set([190,128,95,255],(yy*36+x)*4);}return s;};
 const f={...curveFeature,rect:[1,1,7,6],rasterization:'source-shape'};
 const a=structured(fixture(1),9,8,{features:[f]}),b=structured(fixture(4),9,8,{features:[f]});
 assert.equal(a.structureReport.stages[0].suppressedQuantizationKinks.length,1);assert(a.structureReport.stages[0].path.every(p=>p.y===3));
 assert.equal(b.structureReport.stages[0].suppressedQuantizationKinks.length,0);
 // The strong disconnected bend must be reported or preserved, never flattened into a fabricated line.
 assert(b.structureReport.stages[0].path.length<5||b.structureReport.stages[0].path.some(p=>p.y!==3));
});
test('source-detail keeps a center pupil that independent area voting erases',()=>{
 const s=image(4,4,[245,191,145,255]);s.data.set([48,37,45,255],(2*4+2)*4);
 const old=structured(s,1,1,{features:[{...eyeFeature,rasterization:'source-shape'}]}),r=structured(s,1,1,{features:[{...eyeFeature,rasterization:'source-detail'}]});
 assert.notEqual(old.image.data[0],48);assert.equal(r.image.data[0],48);assert.equal(r.structureReport.stages[0].targetRoleCounts,null);
});

test('source-detail separates a dark pupil from a dark green iris',()=>{
 const s=image(8,4,[35,72,53,255]);for(let y=0;y<4;y++)for(let x=0;x<4;x++)s.data.set([36,54,40,255],(y*8+x)*4);
 const r=structured(s,2,1,{features:[{...eyeFeature,rect:[0,0,2,1],rasterization:'source-detail'}]});
 assert.deepEqual([...r.image.data.subarray(0,3)],[48,37,45]);assert.deepEqual([...r.image.data.subarray(4,7)],[35,72,53]);
});

test('source-detail promotes only the largest supported compact glint',()=>{
 const s=image(24,24,[48,37,45,255]);for(let y=8;y<10;y++)for(let x=8;x<12;x++)s.data.set([255,247,230,255],(y*24+x)*4);
 for(let y=16;y<18;y++)for(let x=16;x<19;x++)s.data.set([255,247,230,255],(y*24+x)*4);
 const r=structured(s,6,6,{features:[{...eyeFeature,rect:[0,0,6,6],rasterization:'source-detail'}]}),g=r.structureReport.stages[0].glints;
 assert.equal(g.length,1);assert.equal(g[0].sourceAreaInNativeCells,.5);assert.equal(g[0].color,'#FFF7E6');
});

const skinTonePlane={name:'skin',mode:'source-tones',rect:[0,0,9,6],eligible:['#BE805F','#F5BF91','#FFDBAC'],colors:['#BE805F','#F5BF91','#FFDBAC']};
test('source skin tones retain a clear light plane and base while leaving dark eye intact',()=>{
 const s=image(36,24,[249,185,140,255]);for(let y=0;y<24;y++)for(let x=0;x<18;x++)s.data.set([255,219,172,255],(y*36+x)*4);
 for(let y=8;y<12;y++)for(let x=8;x<12;x++)s.data.set([48,37,45,255],(y*36+x)*4);
 const r=structured(s,9,6,{planes:[skinTonePlane]});
 assert.deepEqual([...r.image.data.subarray(0,3)],[255,219,172]);assert.deepEqual([...r.image.data.subarray(8*4,8*4+3)],[245,191,145]);
 assert.deepEqual([...r.image.data.subarray((2*9+2)*4,(2*9+2)*4+3)],[48,37,45]);assert.equal(inspect(r.image,characterPalette).offPalettePixels,0);
});

test('skin does not stretch subtle source variation into light and base patches',()=>{
 const s=image(36,24,[249,192,145,255]);for(let y=0;y<24;y++)for(let x=0;x<18;x++)s.data.set([252,207,158,255],(y*36+x)*4);
 const r=structured(s,9,6,{planes:[skinTonePlane]});
 for(let k=0;k<54;k++)assert.deepEqual([...r.image.data.subarray(k*4,k*4+3)],[245,191,145]);
});

test('dark eye pigment mixed into a skin cell cannot create a skin shadow block',()=>{
 const s=image(36,24,[245,191,145,255]);
 for(let y=8;y<12;y++)s.data.set([48,37,45,255],(y*36+8)*4);
 const r=structured(s,9,6,{planes:[skinTonePlane]});
 assert.deepEqual([...r.image.data.subarray((2*9+2)*4,(2*9+2)*4+3)],[245,191,145]);
});

test('source-detail mouth retains two skin tones instead of painting a flat rectangle',()=>{
 const s=lineFixture();for(let y=0;y<24;y++)for(let x=18;x<36;x++)if(y!==14||x>=28)s.data.set([255,219,172,255],(y*36+x)*4);
 const config={planes:[skinTonePlane],features:[{...curveFeature,rasterization:'source-detail'}]},r=structured(s,9,6,config),other=structured(s,9,6,config);
 assert.deepEqual([...r.image.data.subarray((1*9+2)*4,(1*9+2)*4+3)],[245,191,145]);
 assert.deepEqual([...r.image.data.subarray((1*9+6)*4,(1*9+6)*4+3)],[255,219,172]);assert(r.image.data.equals(other.image.data));
});

test('skin tone mode rejects unordered palette roles and unknown mode',()=>{
 const s=lineFixture();assert.throws(()=>structured(s,9,6,{planes:[{...skinTonePlane,colors:[...skinTonePlane.colors].reverse()}]}),/ordered/);
 assert.throws(()=>structured(s,9,6,{planes:[{...skinTonePlane,colors:skinTonePlane.colors.slice(1)}]}),/ordered/);
 assert.throws(()=>structured(s,9,6,{planes:[{...skinTonePlane,mode:'guess'}]}),/plane mode/);
});
test('weak isolated skin highlights are removed but strong source highlights survive',()=>{
 const s=image(36,24,[245,191,145,255]);for(let y=0;y<24;y++)for(let x=0;x<18;x++)s.data.set([255,215,164,255],(y*36+x)*4);
 for(const [ny,rgb]of [[1,[253,209,160]],[4,[255,225,180]]])for(let y=ny*4;y<(ny+1)*4;y++)for(let x=28;x<32;x++)s.data.set([...rgb,255],(y*36+x)*4);
 const r=structured(s,9,6,{planes:[skinTonePlane]});assert.equal(r.image.data[(1*9+7)*4],245);assert.equal(r.image.data[(4*9+7)*4],255);
});

test('source tone masks cannot silently overlap another tone or regional plane',()=>{
 const s=lineFixture();assert.throws(()=>structured(s,9,6,{planes:[skinTonePlane,skinTonePlane]}),/Overlapping/);
 const {mode,...regional}=skinTonePlane;assert.throws(()=>structured(s,9,6,{planes:[skinTonePlane,regional]}),/Overlapping/);
});
test('sub-cell glint snaps inside the iris to avoid merging with a vertical sclera',()=>{
 const s=image(24,24,[48,37,45,255]);for(let y=4;y<16;y++)for(let x=8;x<12;x++)s.data.set([255,247,230,255],(y*24+x)*4);
 for(let y=8;y<10;y++)for(let x=13;x<16;x++)s.data.set([255,247,230,255],(y*24+x)*4);
 const r=structured(s,6,6,{features:[{...eyeFeature,rect:[0,0,6,6],rasterization:'source-detail'}]}),g=r.structureReport.stages[0].glints[0];
 assert.deepEqual(g.sourceCell,[3,2]);assert.equal(g.x,4);assert.equal(g.horizontalSnap,1);assert.equal(r.image.data[(2*6+3)*4],48);assert.equal(r.image.data[(2*6+4)*4],255);
});
test('separate shadow layer leaves an unshaded skin base pixel-identical',()=>{
 const s=image(36,24,[245,191,145,255]);
 const a=structured(s,9,6,{planes:[skinTonePlane]}),b=structured(s,9,6,{planes:[{...skinTonePlane,shadowLayer:true}]});
 assert(a.image.data.equals(b.image.data));assert.equal(b.structureReport.stages.at(-1).changes.length,0);
});

test('separate shadow layer restores source pigment without repartitioning the skin base',()=>{
 const s=image(36,24,[245,191,145,255]);for(let y=8;y<12;y++)s.data.set([190,128,95,255],(y*36+14)*4);
 const a=structured(s,9,6,{planes:[skinTonePlane]}),b=structured(s,9,6,{planes:[{...skinTonePlane,shadowLayer:true}]});
 const k=2*9+3;assert.equal(a.image.data[k*4],245);assert.equal(b.image.data[k*4],190);
 for(let p=0;p<54;p++)if(p!==k)assert(a.image.data.subarray(p*4,p*4+4).equals(b.image.data.subarray(p*4,p*4+4)));
 assert.equal(b.structureReport.stages.at(-1).changes.length,1);assert.equal(inspect(b.image,characterPalette).offPalettePixels,0);
});

test('shadow layer rejects an ambiguous nonboolean enable flag',()=>{
 assert.throws(()=>structured(lineFixture(),9,6,{planes:[{...skinTonePlane,shadowLayer:'yes'}]}),/shadowLayer/);
});
test('cell-mean shadows do not promote a quarter-cell dark stroke to a solid dark cell',()=>{
 const s=image(36,24,[245,191,145,255]);for(let y=8;y<12;y++)s.data.set([190,128,95,255],(y*36+14)*4);
 const base=structured(s,9,6,{planes:[skinTonePlane]}),out=structured(s,9,6,{planes:[{...skinTonePlane,shadowLayer:true,shadowSampling:'cell-mean'}]});
 assert(base.image.data.equals(out.image.data));assert(out.structureReport.stages.at(-1).evidence.length>0);
});
test('cell-mean shadow mode retains a fully supported dark skin area',()=>{
 const s=image(36,24,[245,191,145,255]);for(let y=8;y<12;y++)for(let x=12;x<16;x++)s.data.set([190,128,95,255],(y*36+x)*4);
 const out=structured(s,9,6,{planes:[{...skinTonePlane,shadowLayer:true,shadowSampling:'cell-mean'}]});
 assert.deepEqual([...out.image.data.subarray((2*9+3)*4,(2*9+3)*4+3)],[190,128,95]);
});
test('eye rectangle preserves non-eye pigment while still rasterizing iris',()=>{
 const s=image(8,4,[133,87,63,255]);for(let y=0;y<4;y++)for(let x=0;x<4;x++)s.data.set([65,120,89,255],(y*8+x)*4);
 const out=structured(s,2,1,{features:[{...eyeFeature,rect:[0,0,2,1],rasterization:'source-detail',preserveSkinOutsideEye:true}]});
 assert.deepEqual([...out.image.data.subarray(0,3)],[65,120,89]);assert.deepEqual([...out.image.data.subarray(4,7)],[133,87,63]);
});
test('new source-preservation options reject invalid configuration',()=>{
 assert.throws(()=>structured(lineFixture(),9,6,{planes:[{...skinTonePlane,shadowSampling:'blur'}]}),/shadowSampling/);
 assert.throws(()=>structured(image(4,4,[245,191,145,255]),1,1,{features:[{...eyeFeature,preserveSkinOutsideEye:true}]}),/preserveSkinOutsideEye/);
});
test('source-area never relocates a small highlight into another cell',()=>{
 const s=image(24,24,[48,37,45,255]);for(let y=4;y<16;y++)for(let x=8;x<12;x++)s.data.set([255,247,230,255],(y*24+x)*4);
 for(let y=8;y<10;y++)for(let x=13;x<16;x++)s.data.set([255,247,230,255],(y*24+x)*4);
 const r=structured(s,6,6,{features:[{...eyeFeature,rect:[0,0,6,6],rasterization:'source-area'}]});
 assert.equal(r.image.data[(2*6+4)*4],48);assert.equal(r.image.data[(2*6+2)*4],255);
 assert.equal(inspect(r.image,characterPalette).offPalettePixels,0);
});
test('source-area keeps a supported green iris and non-eye skin pigment',()=>{
 const s=image(8,4,[133,87,63,255]);for(let y=0;y<4;y++)for(let x=0;x<4;x++)s.data.set([65,120,89,255],(y*8+x)*4);
 const r=structured(s,2,1,{features:[{...eyeFeature,rect:[0,0,2,1],rasterization:'source-area',preserveSkinOutsideEye:true}]});
 assert.deepEqual([...r.image.data.subarray(0,3)],[65,120,89]);assert.deepEqual([...r.image.data.subarray(4,7)],[133,87,63]);
});
test('source role labels preserve iris contrast that nearest RGB would merge',()=>{
 const s=image(8,4,[63,79,61,255]);for(let y=0;y<4;y++)for(let x=4;x<8;x++)s.data.set([52,49,38,255],(y*8+x)*4);
 const r=structured(s,2,1,{features:[{...eyeFeature,rect:[0,0,2,1],rasterization:'source-components',sourceRoles:[
  {name:'iris',rgb:[63,79,61],colors:['#417859']},{name:'pupil',rgb:[52,49,38],colors:['#234835']}
 ]}]});
 assert.deepEqual([...r.image.data.subarray(0,3)],[65,120,89]);assert.deepEqual([...r.image.data.subarray(4,7)],[35,72,53]);
});
test('compact source mark is not widened to one output pixel for every source column',()=>{
 const s=image(24,24,[245,191,145,255]);for(let y=9;y<11;y++)for(let x=10;x<14;x++)s.data.set([190,128,95,255],(y*24+x)*4);
 const r=structured(s,6,6,{features:[{...curveFeature,rect:[0,0,6,6],rasterization:'source-mark'}]});
 assert.equal(r.structureReport.stages[0].path.length,1);assert.equal(inspect(r.image,characterPalette).offPalettePixels,0);
});
test('material role quantization is explicit and does not recolor an adjacent field',()=>{
 const s=image(8,4,[118,66,46,255]);for(let y=0;y<4;y++)for(let x=4;x<8;x++)s.data.set([65,120,89,255],(y*8+x)*4);
 const r=structured(s,2,1,{planes:[{name:'warm material',rect:[0,0,2,1],eligible:['#85573F'],colors:['#BE805F'],sourceRoles:[{rgb:[118,66,46],color:'#BE805F'}]}]});
 assert.deepEqual([...r.image.data.subarray(0,3)],[190,128,95]);assert.deepEqual([...r.image.data.subarray(4,7)],[65,120,89]);
});
test('invalid role mappings and wrong feature modes cannot run silently',()=>{
 const s=image(4,4,[245,191,145,255]);
 assert.throws(()=>structured(s,1,1,{features:[{...eyeFeature,rasterization:'whole-curve'}]}),/requires a curve/);
 assert.throws(()=>structured(s,1,1,{features:[{...eyeFeature,rasterization:'source-components',sourceRoles:[{name:'same',rgb:[0,0,0],colors:['#30252D']},{name:'same',rgb:[255,255,255],colors:['#FFF7E6']}]}]}),/Duplicate/);
 assert.throws(()=>structured(s,1,1,{planes:[{rect:[0,0,1,1],eligible:['#F5BF91'],colors:['#F5BF91'],sourceRoles:[{rgb:[NaN,0,0],color:'#F5BF91'}]}]}),/Invalid source material/);
});
test('source palette planner reserves a rare role without deleting the only contrasting material',()=>{
 const {preserveSourceColors}=require('./build-palette-native.cjs');const s=image(40,20,[180,80,70,255]);
 s.data.set([250,220,30,255],0);
 for(let y=9;y<11;y++)for(let x=18;x<20;x++)s.data.set([20,110,210,255],(y*40+x)*4);
 const p=parsePalette({colors:['#FFFFFF','#B45046','#B55147','#FADC1E','#000000']});
 const r=preserveSourceColors(s,p,[{name:'small-feature',rect:[17,8,4,4],roles:[{name:'iris',rgb:[20,110,210]}]}],'#FFFFFF');
 assert.equal(r.palette.length,5);assert(r.palette.some(c=>c.hex==='#146ED2'));assert(r.palette.some(c=>c.hex==='#FADC1E'));assert(r.report.allRolesRepresented);
 assert.throws(()=>preserveSourceColors(s,p,[{name:'unsupported',rect:[0,0,2,2],roles:[{name:'blue',rgb:[20,110,210]}]}],'#FFFFFF'),/not supported/);
});

test('source contour retains different original stroke widths instead of one-cell normalization',()=>{
 const s=image(48,24,[255,255,255,255]);for(let y=4;y<20;y++)for(let x=4;x<12;x++)s.data.set([0,0,0,255],(y*48+x)*4);
 for(let y=4;y<20;y++)for(let x=28;x<32;x++)s.data.set([0,0,0,255],(y*48+x)*4);
 const r=buildNative(PNG,s,palette,12,6,'#FFFFFF','area-vote',null,null,{contour:{mode:'source-coverage',color:'#000000',background:'#FFFFFF'}});
 for(const x of [1,2,7])assert.equal(r.image.data[(2*12+x)*4],0);for(const x of [0,3,6,8])assert.equal(r.image.data[(2*12+x)*4],255);
 assert.equal(r.structureReport.stages[0].fixedWidth,false);
 assert.throws(()=>buildNative(PNG,s,palette,12,6,'#FFFFFF','area-vote',null,null,{contour:{mode:'source-coverage',width:1,color:'#000000',background:'#FFFFFF'}}),/do not specify width/);
});

test('minority contour pigment cannot win because the light samples split across several palette entries',()=>{
 const p=parsePalette({colors:['#000000','#FFFFFF','#CCCCCC','#EEEEEE']});const s=image(30,30,[255,255,255,255]);
 for(let y=10;y<14;y++)for(let x=10;x<20;x++)s.data.set([0,0,0,255],(y*30+x)*4);
 for(let y=14;y<17;y++)for(let x=10;x<20;x++)s.data.set([204,204,204,255],(y*30+x)*4);
 for(let y=17;y<20;y++)for(let x=10;x<20;x++)s.data.set([238,238,238,255],(y*30+x)*4);
 const a=buildNative(PNG,s,p,3,3,'#FFFFFF','area-vote'),b=buildNative(PNG,s,p,3,3,'#FFFFFF','area-vote',null,null,{contour:{mode:'source-coverage',color:'#000000',background:'#FFFFFF'}});
 assert.equal(a.image.data[(1*3+1)*4],0);assert.equal(b.image.data[(1*3+1)*4],255);
});

test('source-enclosed glints larger than five cells retain measured area without repainting the eye base',()=>{
 const s=image(48,48,[65,120,89,255]);for(let y=12;y<24;y++)for(let x=12;x<24;x++)s.data.set([255,247,230,255],(y*48+x)*4);
 const f={...eyeFeature,rect:[0,0,12,12],rasterization:'source-components',preserveBaseRoles:true,sourceRoles:[{name:'iris',rgb:[65,120,89],colors:['#417859']},{name:'white',rgb:[255,247,230],colors:['#FFF7E6']}]};
 const r=structured(s,12,12,{features:[f]}),g=r.structureReport.stages[0].glints;
 assert.equal(g.length,1);assert.equal(g[0].sourceArea,9);assert.equal(g[0].cells.length,9);assert.equal(g[0].irisBoundaryFraction,1);
 assert.equal(inspect(r.image,characterPalette).offPalettePixels,0);
});

test('white outside an iris is not accepted merely because the size limit was removed',()=>{
 const s=image(48,48,[245,191,145,255]);for(let y=12;y<24;y++)for(let x=12;x<24;x++)s.data.set([255,247,230,255],(y*48+x)*4);
 const r=structured(s,12,12,{features:[{...eyeFeature,rect:[0,0,12,12],rasterization:'source-components',preserveBaseRoles:true,sourceRoles:[{name:'skin',rgb:[245,191,145],colors:['#F5BF91']},{name:'white',rgb:[255,247,230],colors:['#FFF7E6']}]}]});
 assert.equal(r.structureReport.stages[0].glints.length,0);assert.equal(r.structureReport.stages[0].rejectedGlints[0].sourceArea,9);
});

test('glint-only mode never repaints unselected source-supported boundary cells',()=>{
 const s=image(48,48,[65,120,89,255]);for(let y=13;y<25;y++)for(let x=13;x<25;x++)s.data.set([255,247,230,255],(y*48+x)*4);
 const base=structured(s,12,12,{}),out=structured(s,12,12,{features:[{...eyeFeature,rect:[0,0,12,12],rasterization:'source-components',preserveBaseRoles:true,sourceRoles:[{name:'iris',rgb:[65,120,89],colors:['#417859']},{name:'white',rgb:[255,247,230],colors:['#FFF7E6']}]}]});
 const selected=new Set(out.structureReport.stages[0].glints.flatMap(g=>g.cells.map(([x,y])=>y*12+x)));
 for(let k=0;k<144;k++)if(!selected.has(k))assert(base.image.data.subarray(k*4,k*4+4).equals(out.image.data.subarray(k*4,k*4+4)));
});

const topologyFeature={...eyeFeature,rect:[0,0,12,12],glint:'#FFF7E6',rasterization:'source-components',preserveBaseRoles:true,preserveSourceEyeTopology:true,restoreThinEyeLines:true,sourceRoles:[
 {name:'pupil',rgb:[48,37,45],colors:['#30252D']},
 {name:'iris',rgb:[65,120,89],colors:['#417859']},
 {name:'white',rgb:[255,247,230],colors:['#FFF7E6']},
 {name:'skin',rgb:[245,191,145],colors:['#F5BF91']}
]};
test('subcell internal pupil line survives area sampling without repainting its surrounding iris',()=>{
 const s=image(48,48,[65,120,89,255]);for(let y=12;y<36;y++)s.data.set([48,37,45,255],(y*48+22)*4);
 const base=structured(s,12,12,{}),out=structured(s,12,12,{features:[topologyFeature]});
 assert(!base.image.data.equals(out.image.data));
 for(let y=3;y<9;y++)assert.deepEqual([...out.image.data.subarray((y*12+5)*4,(y*12+5)*4+3)],[48,37,45]);
 const changes=out.structureReport.stages[0].changes;
 assert.equal(changes.length,6);assert(changes.every(c=>c.x===5&&c.y>=3&&c.y<9));
 assert.equal(inspect(out.image,characterPalette).offPalettePixels,0);
});
test('internal-line recovery leaves skin lines and wide pupil shapes untouched',()=>{
 for(const rgb of [[245,191,145],[65,120,89]]){
  const s=image(48,48,[...rgb,255]);for(let y=12;y<36;y++)for(let x=20;x<(rgb[0]===65?28:21);x++)s.data.set([48,37,45,255],(y*48+x)*4);
  const base=structured(s,12,12,{}),out=structured(s,12,12,{features:[topologyFeature]});assert(base.image.data.equals(out.image.data));
 }
});
test('disconnected glint and sclera remain separate in stored palette pixels',()=>{
 const s=image(48,48,[65,120,89,255]);
 for(let y=8;y<40;y++)for(let x=0;x<19;x++)s.data.set([255,247,230,255],(y*48+x)*4);
 for(let y=16;y<24;y++)for(let x=20;x<27;x++)s.data.set([255,247,230,255],(y*48+x)*4);
 const out=structured(s,12,12,{features:[topologyFeature]}),t=out.structureReport.stages[0].sourceTopology;
 assert(t.separators.length>0);assert.equal(t.unresolvedWhiteMerges,0);assert(t.storedWhiteComponents.length>=2);
 const saved=PNG.sync.read(PNG.sync.write(out.image));
 for(const c of t.storedWhiteComponents)for(const [x,y]of c.cells)assert.deepEqual([...saved.data.subarray((y*12+x)*4,(y*12+x)*4+3)],[255,247,230]);
});
test('already-separated glint and source white areas stay unchanged with topology enabled',()=>{
 const s=image(48,48,[65,120,89,255]);for(let y=12;y<24;y++)for(let x=24;x<32;x++)s.data.set([255,247,230,255],(y*48+x)*4);
 const base=structured(s,12,12,{features:[{...topologyFeature,preserveSourceEyeTopology:false}]}),out=structured(s,12,12,{features:[topologyFeature]});assert(base.image.data.equals(out.image.data));
});
test('topology is opt-in with strict mode and boolean validation',()=>{
 const s=image(48,48,[65,120,89,255]);
 assert.throws(()=>structured(s,12,12,{features:[{...topologyFeature,preserveSourceEyeTopology:'true'}]}),/preserveSourceEyeTopology/);
 assert.throws(()=>structured(s,12,12,{features:[{...topologyFeature,rasterization:'source-area',preserveBaseRoles:undefined}]}),/preserveSourceEyeTopology/);
 assert.throws(()=>structured(s,12,12,{features:[{...topologyFeature,glint:'#417859'}]}),/distinct white/);
 assert.throws(()=>structured(s,12,12,{features:[{...topologyFeature,iris:['#FFF7E6']}]}),/distinct white/);
});

function curvedEyeFixture(){
 const s=image(96,96,[65,120,89,255]);
 for(let y=0;y<96;y++)for(let x=0;x<96;x++){
  const radius=((x-48)/9)**2+((y-43)/24)**2;
  if(radius<1)s.data.set([155,197,154,255],(y*96+x)*4);
  if(y>=34&&Math.abs(radius-1)<.18)s.data.set([48,37,45,255],(y*96+x)*4);
  if((x-42)**2+(y-29)**2<16)s.data.set([255,247,230,255],(y*96+x)*4);
 }
 return s;
}
const jointFeature={...topologyFeature,rect:[0,0,24,24],jointEyeRegions:true,sourceRoles:[...topologyFeature.sourceRoles,{name:'iris-light',rgb:[155,197,154],colors:['#9BC59A']}]};
test('joint curved eye allocation restores iris cells instead of only adding dark pigment',()=>{
 const s=curvedEyeFixture(),base=structured(s,24,24,{features:[{...jointFeature,jointEyeRegions:false}]}),out=structured(s,24,24,{features:[jointFeature]});
 const regions=out.structureReport.stages[0].sourceTopology.jointRegions;assert(regions.length>0);
 const saved=PNG.sync.read(PNG.sync.write(out.image));let restored=0;
 for(const r of regions){
  assert(r.budgets.every(b=>b.count===b.budget));
  const dark=r.applied.filter(c=>saved.data.subarray((c.y*24+c.x)*4,(c.y*24+c.x)*4+3).equals(Buffer.from([48,37,45]))).length;
  assert.equal(dark,r.budgets.find(b=>b.name==='pupil').budget);
  for(const c of r.applied){const k=(c.y*24+c.x)*4;if(base.image.data.subarray(k,k+3).equals(Buffer.from([48,37,45]))&&!saved.data.subarray(k,k+3).equals(Buffer.from([48,37,45])))restored++;}
 }
 assert(restored>0);assert.equal(inspect(saved,characterPalette).offPalettePixels,0);
});
test('joint curve conversion protects stored white glints and reproduces saved bytes',()=>{
 const s=curvedEyeFixture(),copy=Buffer.from(s.data),config={features:[jointFeature]},json=JSON.stringify(config);
 const base=structured(s,24,24,{features:[{...jointFeature,jointEyeRegions:false}]}),a=structured(s,24,24,config),b=structured(s,24,24,config);
 for(let k=0;k<24*24;k++)if(base.image.data.subarray(k*4,k*4+3).equals(Buffer.from([255,247,230])))assert(a.image.data.subarray(k*4,k*4+4).equals(base.image.data.subarray(k*4,k*4+4)));
 assert(a.image.data.equals(b.image.data));assert(s.data.equals(copy));assert.equal(JSON.stringify(config),json);
});
test('joint allocation leaves a solid pupil unchanged and rejects ambiguous opt-in flags',()=>{
 const s=image(96,96,[65,120,89,255]);for(let y=32;y<64;y++)for(let x=40;x<56;x++)s.data.set([48,37,45,255],(y*96+x)*4);
 const a=structured(s,24,24,{features:[{...jointFeature,jointEyeRegions:false}]}),b=structured(s,24,24,{features:[jointFeature]});
 assert(a.image.data.equals(b.image.data));assert.equal(b.structureReport.stages[0].sourceTopology.jointRegions.length,0);
 assert.throws(()=>structured(s,24,24,{features:[{...jointFeature,jointEyeRegions:'yes'}]}),/jointEyeRegions/);
 assert.throws(()=>structured(s,24,24,{features:[{...jointFeature,preserveSourceEyeTopology:false}]}),/jointEyeRegions/);
});

test('thin-line restoration is off by default and explicit false prevents add-only ink',()=>{
 const s=image(48,48,[65,120,89,255]);for(let y=12;y<36;y++)s.data.set([48,37,45,255],(y*48+22)*4);
 const base=structured(s,12,12,{});
 for(const restoreThinEyeLines of [undefined,false]){
  const out=structured(s,12,12,{features:[{...topologyFeature,restoreThinEyeLines}]});
  const saved=PNG.sync.read(PNG.sync.write(out.image));
  assert(saved.data.equals(base.image.data));
  assert.equal(out.structureReport.stages[0].sourceTopology.thinLines.length,0);
  assert.equal(out.structureReport.stages[0].sourceTopology.restoreThinEyeLines,false);
 }
 assert.throws(()=>structured(s,12,12,{features:[{...topologyFeature,restoreThinEyeLines:'false'}]}),/restoreThinEyeLines/);
});
test('disabling added thin ink keeps joint region allocation and stored white masks',()=>{
 const s=curvedEyeFixture(),on=structured(s,24,24,{features:[jointFeature]}),off=structured(s,24,24,{features:[{...jointFeature,restoreThinEyeLines:false}]});
 const a=on.structureReport.stages[0].sourceTopology,b=off.structureReport.stages[0].sourceTopology;
 assert.deepEqual(a.jointRegions,b.jointRegions);assert.equal(b.thinLines.length,0);
 const saved=PNG.sync.read(PNG.sync.write(off.image));
 for(let k=0;k<24*24;k++)assert.equal(on.image.data.subarray(k*4,k*4+3).equals(Buffer.from([255,247,230])),saved.data.subarray(k*4,k*4+3).equals(Buffer.from([255,247,230])));
});
test('white component separation still works with forced thin-line restoration disabled',()=>{
 const s=image(48,48,[65,120,89,255]);
 for(let y=8;y<40;y++)for(let x=0;x<19;x++)s.data.set([255,247,230,255],(y*48+x)*4);
 for(let y=16;y<24;y++)for(let x=20;x<27;x++)s.data.set([255,247,230,255],(y*48+x)*4);
 const out=structured(s,12,12,{features:[{...topologyFeature,restoreThinEyeLines:false}]}),t=out.structureReport.stages[0].sourceTopology;
 assert.equal(t.thinLines.length,0);assert(t.separators.length>0);assert.equal(t.unresolvedWhiteMerges,0);assert(t.storedWhiteComponents.length>=2);
});

function splitBoundaryFixture(insideColumns=3){
 const s=image(60,60,[245,191,145,255]);
 for(let y=5;y<55;y++)for(let x=5;x<55;x++)s.data.set([255,247,230,255],(y*60+x)*4);
 for(let y=20;y<40;y++)for(let x=15;x<30;x++){
  let rgb=[65,120,89];
  if(x>=25){const n=x-25;rgb=insideColumns===3?[[48,37,45],[65,120,89],[155,197,154],[255,247,230],[255,247,230]][n]:[[48,37,45],[48,37,45],[255,247,230],[255,232,196],[234,223,197]][n];}
  s.data.set([...rgb,255],(y*60+x)*4);
 }
 return s;
}
const boundaryFeature={...jointFeature,rect:[0,0,12,12],jointEyeRegions:false,restoreThinEyeLines:false,eyeBoundaryCoverage:true};
test('region occupancy beats fragmented palette votes at a source-supported sclera boundary',()=>{
 const s=splitBoundaryFixture(),base=structured(s,12,12,{features:[{...boundaryFeature,eyeBoundaryCoverage:false}]}),out=structured(s,12,12,{features:[boundaryFeature]});
 const saved=PNG.sync.read(PNG.sync.write(out.image));
 for(let y=4;y<8;y++){
  assert.deepEqual([...base.image.data.subarray((y*12+5)*4,(y*12+5)*4+3)],[255,247,230]);
  assert(!saved.data.subarray((y*12+5)*4,(y*12+5)*4+3).equals(Buffer.from([255,247,230])));
 }
 const changes=out.structureReport.stages[0].boundarySampling;
 assert.equal(changes.length,4);assert(changes.every(c=>Math.abs(c.sourceEyeCoverage-.6)<1e-9&&c.inside));
 assert.equal(out.structureReport.stages[0].sourceTopology.thinLines.length,0);
});
test('minority dark pigment cannot protrude when the source sclera wins collectively',()=>{
 const s=splitBoundaryFixture(2),base=structured(s,12,12,{features:[{...boundaryFeature,eyeBoundaryCoverage:false}]}),out=structured(s,12,12,{features:[boundaryFeature]});
 for(let y=4;y<8;y++){
  assert.deepEqual([...base.image.data.subarray((y*12+5)*4,(y*12+5)*4+3)],[48,37,45]);
  assert.deepEqual([...out.image.data.subarray((y*12+5)*4,(y*12+5)*4+3)],[255,247,230]);
 }
 assert(out.structureReport.stages[0].boundarySampling.every(c=>!c.inside&&Math.abs(c.sourceEyeCoverage-.4)<1e-9));
});
test('coverage boundary sampling preserves mirrored geometry without coordinate templates',()=>{
 const s=splitBoundaryFixture(),mirror=image(60,60,[0,0,0,255]);
 for(let y=0;y<60;y++)for(let x=0;x<60;x++)s.data.copy(mirror.data,(y*60+59-x)*4,(y*60+x)*4,(y*60+x)*4+4);
 const a=structured(s,12,12,{features:[boundaryFeature]}).image,b=structured(mirror,12,12,{features:[boundaryFeature]}).image;
 for(let y=0;y<12;y++)for(let x=0;x<12;x++)assert(a.data.subarray((y*12+x)*4,(y*12+x)*4+4).equals(b.data.subarray((y*12+11-x)*4,(y*12+11-x)*4+4)));
});
test('coverage sampling protects the complete catchlight footprint and joint pupil region',()=>{
 const s=curvedEyeFixture(),f={...jointFeature,restoreThinEyeLines:false};
 const a=structured(s,24,24,{features:[f]}),b=structured(s,24,24,{features:[{...f,eyeBoundaryCoverage:true}]});
 assert(a.image.data.equals(b.image.data));assert.equal(b.structureReport.stages[0].boundarySampling.length,0);
 assert.throws(()=>structured(s,24,24,{features:[{...f,eyeBoundaryCoverage:'true'}]}),/eyeBoundaryCoverage/);
});

test('source-region mode separates shaded navy from neutral ink before grid voting', () => {
  const p = parsePalette({colors:['#FFF7E6','#17151C','#071E42','#FFFFFF']});
  const src = image(48, 32, [255,247,230,255]);
  for(let y=8;y<24;y++)for(let x=8;x<40;x++)
    src.data.set(x<24?[15,11,19,255]:[6,19,44,255],(y*48+x)*4);
  const before=Buffer.from(src.data);
  const old=buildNative(PNG,src,p,12,8,'#FFF7E6','area-vote');
  const out=buildNative(PNG,src,p,12,8,'#FFF7E6','source-region-area');
  assert.deepEqual([...old.image.data.subarray((4*12+8)*4,(4*12+8)*4+3)],[23,21,28]);
  assert.deepEqual([...out.image.data.subarray((4*12+8)*4,(4*12+8)*4+3)],[7,30,66]);
  assert.deepEqual([...out.image.data.subarray((4*12+4)*4,(4*12+4)*4+3)],[23,21,28]);
  assert(src.data.equals(before));
  assert.equal(out.sampling,'source-region-area');
  assert.equal(inspect(out.image,p).offPalettePixels,0);
  assert(out.image.data.equals(buildNative(PNG,src,p,12,8,'#FFF7E6','source-region-area').image.data));
  assert.equal(out.sourceRegionReport.status,'EXPERIMENTAL_NOT_A_FIDELITY_PASS');
});
test('source-region mode cannot silently stack corrections or run without seeds', () => {
  const src=image(12,12,[255,255,255,255]);
  assert.throws(()=>buildNative(PNG,src,palette,4,4,'#FFFFFF','source-region-area',null,null,{}),/without stacked/);
  assert.throws(()=>buildNative(PNG,image(1,1,[255,255,255,255]),palette,1,1,'#FFFFFF','source-region-area'),/source-region seeds/);
});

const { rasterSourceShapes } = require('./raster-source-shapes.cjs');
const shapePalette = parsePalette({colors:['#FFF7E6','#17151C','#071E42','#FFFFFF','#308CC0','#F497B0']});
test('shape rasterizer separates foreground occupancy from competing color votes', () => {
  const src = image(10,10,[255,247,230,255]);
  for(let p=45;p<100;p++)src.data.set(p<80?[23,21,28,255]:[244,151,176,255],p*4);
  const out=rasterSourceShapes(PNG,src,shapePalette,1,1,'#FFF7E6');
  assert.deepEqual([...out.image.data],[23,21,28,255]);
  assert.equal(out.report.silhouetteChanges.length,1);
  for(let p=0;p<60;p++)src.data.set([255,247,230,255],p*4);
  assert.deepEqual([...rasterSourceShapes(PNG,src,shapePalette,1,1,'#FFF7E6').image.data],[255,247,230,255]);
});
function smallShapeFixture(asymmetric=false) {
  const src=image(100,100,[255,247,230,255]);
  for(let y=8;y<92;y++)for(let x=8;x<92;x++)src.data.set([244,151,176,255],(y*100+x)*4);
  for(let y=20;y<44;y++)for(let x=25;x<37;x++)src.data.set([7,30,66,255],(y*100+x)*4);
  for(let y=23;y<31;y++)for(let x=29;x<33;x++)src.data.set([255,255,255,255],(y*100+x)*4);
  for(let y=37;y<42;y++)for(let x=27;x<35;x++)src.data.set([48,140,192,255],(y*100+x)*4);
  if(asymmetric)for(let y=23;y<37;y++)for(let x=25;x<30;x++)src.data.set([255,255,255,255],(y*100+x)*4);
  return src;
}
test('source-family sampling retains nested colors through saved PNG round trip', () => {
  const src=smallShapeFixture(),before=Buffer.from(src.data);
  const out=rasterSourceShapes(PNG,src,shapePalette,25,25,'#FFF7E6');
  const saved=PNG.sync.read(PNG.sync.write(out.image));
  assert(inspect(saved,shapePalette).usedHex.includes('#FFFFFF'));
  assert(inspect(saved,shapePalette).usedHex.includes('#308CC0'));
  assert.equal(inspect(saved,shapePalette).offPalettePixels,0);
  assert(src.data.equals(before));
  assert(saved.data.equals(rasterSourceShapes(PNG,src,shapePalette,25,25,'#FFF7E6').image.data));
});
test('already indexed asymmetric source is pixel-identical at its native grid', () => {
  const src=smallShapeFixture(true);
  const out=rasterSourceShapes(PNG,src,shapePalette,100,100,'#FFF7E6');
  assert(src.data.equals(out.image.data));
});
test('shape-grid integration refuses stacked restoration and keeps source-to-native fit', () => {
  const src=smallShapeFixture();
  assert.throws(()=>buildNative(PNG,src,shapePalette,25,25,'#FFF7E6','source-shape-grid',{},null,null),/without stacked/);
  const out=buildNative(PNG,src,shapePalette,25,25,'#FFF7E6','source-shape-grid');
  assert.deepEqual(out.fit,{fitWidth:25,fitHeight:25,offsetX:0,offsetY:0});
  assert.equal(out.shapeRasterReport.status,'REQUIRES_SAVED_IMAGE_REVIEW');
});
test('fragmented dark votes cannot create a minority white protrusion', () => {
  const src=image(10,10,[255,255,255,255]);
  for(let p=45;p<100;p++)src.data.set(p<80?[7,30,66,255]:[23,21,28,255],p*4);
  const old=buildNative(PNG,src,shapePalette,1,1,'#FFF7E6','area-vote').image;
  assert.deepEqual([...old.data],[255,255,255,255]);
  const out=rasterSourceShapes(PNG,src,shapePalette,1,1,'#FFF7E6');
  assert.deepEqual([...out.image.data],[7,30,66,255]);
  assert.equal(out.report.familyChanges.length,1);
  assert(Math.abs(out.report.familyChanges[0].selectedRegionCoverage-.55)<1e-9);
});
test('a supported white majority survives the same family classification', () => {
  const src=image(10,10,[255,255,255,255]);
  for(let p=55;p<100;p++)src.data.set(p<80?[7,30,66,255]:[23,21,28,255],p*4);
  assert.deepEqual([...rasterSourceShapes(PNG,src,shapePalette,1,1,'#FFF7E6').image.data],[255,255,255,255]);
});
test('disconnected light regions do not jointly erase the dark region between them', () => {
  const src=image(10,10,[255,255,255,255]);
  for(let y=0;y<10;y++)for(let x=4;x<9;x++)src.data.set([23,21,28,255],(y*10+x)*4);
  for(let y=0;y<10;y++)src.data.set([244,151,176,255],(y*10+9)*4);
  const out=rasterSourceShapes(PNG,src,shapePalette,1,1,'#FFF7E6');
  assert.deepEqual([...out.image.data],[23,21,28,255]);
});
const { rasterSharedBoundaries } = require('./raster-shared-boundaries.cjs');
test('shared boundary raster preserves native asymmetric geometry and all colors', () => {
  const src=smallShapeFixture(true), original=Buffer.from(src.data);
  const result=rasterSharedBoundaries(PNG,src,100,100,'#FFF7E6');
  assert(result.image.data.equals(original));
  assert(src.data.equals(original));
  assert.equal(result.report.gaps,0);assert.equal(result.report.conflicts,0);
});
test('shared edge raster keeps multi-region junctions closed without vote fallbacks', () => {
  const src=image(48,48,[255,247,230,255]);
  for(let y=4;y<44;y++)for(let x=4;x<44;x++){
    const rgb=x<24?(y<24?[23,21,28]:[48,140,192]):(y<24?[244,151,176]:[255,255,255]);
    src.data.set([...rgb,255],(y*48+x)*4);
  }
  const result=rasterSharedBoundaries(PNG,src,12,12,'#FFF7E6');
  const stored=PNG.sync.read(PNG.sync.write(result.image));
  assert.equal(inspect(stored,shapePalette).offPalettePixels,0);
  assert.equal(inspect(stored,shapePalette).colorsUsed,5);
  assert.equal(result.report.gaps,0);assert.equal(result.report.conflicts,0);
  assert(stored.data.equals(rasterSharedBoundaries(PNG,src,12,12,'#FFF7E6').image.data));
});
test('shared boundary CLI path uses the original source and rejects stacked corrections', () => {
  const src=smallShapeFixture(),copy=Buffer.from(src.data);
  assert.throws(()=>buildNative(PNG,src,shapePalette,25,25,'#FFF7E6','source-shared-boundaries',{}),/without stacked/);
  const result=buildNative(PNG,src,shapePalette,25,25,'#FFF7E6','source-shared-boundaries');
  assert(src.data.equals(copy));
  assert.deepEqual(result.fit,{fitWidth:25,fitHeight:25,offsetX:0,offsetY:0});
  assert.equal(result.shapeRasterReport.status,'EXPERIMENTAL_REQUIRES_FULL_IMAGE_REVIEW');
});
test('small coherent colors and a thin lip survive source segmentation without full-cell area seeds',()=>{
  const {segmentSourceRegions}=require('./source-region-palette.cjs');
  const p=parsePalette({colors:['#F7DFC1','#89B957','#B78372']});
  const src=image(100,100,[247,223,193,255]);
  for(let y=20;y<27;y++)for(let x=20;x<27;x++)src.data.set([137,185,87,255],(y*100+x)*4);
  for(let y=60;y<63;y++)for(let x=35;x<55;x++)src.data.set([183,131,114,255],(y*100+x)*4);
  const before=Buffer.from(src.data),out=segmentSourceRegions(PNG,src,p,10,10,{preserveSmallRegions:true});
  assert.equal(out.image.data.readUInt32BE((23*100+23)*4),0x89b957ff);
  assert.equal(out.image.data.readUInt32BE((61*100+45)*4),0xb78372ff);
  assert(src.data.equals(before));assert.equal(inspect(out.image,p).offPalettePixels,0);
  assert(out.report.smallComponents>0);
});
test('small-region preservation does not promote an isolated source speck into a new color seed',()=>{
  const {segmentSourceRegions}=require('./source-region-palette.cjs');
  const p=parsePalette({colors:['#F7DFC1','#89B957']});
  const src=image(40,40,[247,223,193,255]);
  src.data.set([137,185,87,255],(20*40+20)*4);
  const out=segmentSourceRegions(PNG,src,p,4,4,{preserveSmallRegions:true});
  assert.equal(out.image.data.readUInt32BE((20*40+20)*4),0xf7dfc1ff);
  assert.equal(out.report.smallComponents,0);
  assert.throws(()=>segmentSourceRegions(PNG,src,p,4,4,{preserveSmallRegions:'yes'}),/Invalid/);
});
test('source-region area retains observed small eye roles without restoring unrelated specks',()=>{
  const p=parsePalette({colors:['#F7DFC1','#112B42','#1976AB','#FFFFFF']});
  const src=image(64,64,[247,223,193,255]);
  for(const [left,rgb] of [[16,[17,43,66]],[24,[25,118,171]],[32,[255,255,255]]])
    for(let y=16;y<24;y++)for(let x=left;x<left+8;x++)src.data.set([...rgb,255],(y*64+x)*4);
  src.data.set([25,118,171,255],(50*64+50)*4);
  const policy={version:1,visibility:'visible',observation:'Three observed compact eye roles',eyes:[{
    name:'observed eye',rect:[12,12,32,16],reflection:'off',roles:[
      {name:'pupil',color:'#112B42',colors:['#112B42'],samples:[[17,43,66]]},
      {name:'iris',color:'#1976AB',colors:['#1976AB'],samples:[[25,118,171]]},
      {name:'light',color:'#FFFFFF',colors:['#FFFFFF'],samples:[[255,255,255]]}]}]};
  const original=Buffer.from(src.data),plain=buildNative(PNG,src,p,8,8,'#F7DFC1','source-region-area');
  const out=buildNative(PNG,src,p,8,8,'#F7DFC1','source-region-area',null,null,null,policy);
  assert.notEqual(plain.image.data.readUInt32BE((2*8+3)*4),0x1976abff);
  assert.equal(out.image.data.readUInt32BE((2*8+2)*4),0x112b42ff);
  assert.equal(out.image.data.readUInt32BE((2*8+3)*4),0x1976abff);
  assert.equal(out.image.data.readUInt32BE((2*8+4)*4),0xffffffff);
  for(let y=0;y<8;y++)for(let x=0;x<8;x++)if(x*8>=44||(x+1)*8<=12||y*8>=28||(y+1)*8<=12)
    assert.equal(out.image.data.readUInt32BE((y*8+x)*4),plain.image.data.readUInt32BE((y*8+x)*4));
  assert(src.data.equals(original));assert.equal(inspect(out.image,p).offPalettePixels,0);
  assert.deepEqual(out.fit,plain.fit);
  const saved=PNG.sync.read(PNG.sync.write(out.image));
  assert(saved.data.equals(buildNative(PNG,src,p,8,8,'#F7DFC1','source-region-area',null,null,null,policy).image.data));
  const bad=JSON.parse(JSON.stringify(policy));bad.eyes[0].rect=[60,12,32,16];
  assert.throws(()=>buildNative(PNG,src,p,8,8,'#F7DFC1','source-region-area',null,null,null,bad),/outside source/);
});
test('source-plane consolidation removes amplified jitter but preserves real shade and disconnected color', () => {
  const {consolidateSourcePlanes}=require('./source-region-palette.cjs');
  const p=parsePalette({colors:['#F182A0','#F26A83','#F59BB8']});
  const raw=image(10,4,[247,118,148,255]),seg=image(10,4,[241,130,160,255]);
  for(let y=0;y<4;y++)for(let x=0;x<10;x++){
    if(x===3){raw.data.set([246,115,146,255],(y*10+x)*4);seg.data.set([242,106,131,255],(y*10+x)*4);}
    if(x>=6){raw.data.set([245,155,184,255],(y*10+x)*4);seg.data.set([245,155,184,255],(y*10+x)*4);}
    if(x===9){raw.data.set([242,106,131,255],(y*10+x)*4);seg.data.set([242,106,131,255],(y*10+x)*4);}
  }
  const before=Buffer.from(raw.data),report=consolidateSourcePlanes(raw,seg,p);
  assert.equal(report.changedSourcePixels,4);
  assert.equal(seg.data.readUInt32BE(3*4),0xf182a0ff);
  assert.equal(seg.data.readUInt32BE(6*4),0xf59bb8ff);
  assert.equal(seg.data.readUInt32BE(9*4),0xf26a83ff);
  assert(raw.data.equals(before));assert.equal(inspect(seg,p).offPalettePixels,0);
  assert.equal(consolidateSourcePlanes(raw,seg,p).changedSourcePixels,0);
});
test('source-plane consolidation does not collapse accurately represented nearby shades', () => {
  const {consolidateSourcePlanes}=require('./source-region-palette.cjs');
  const p=parsePalette({colors:['#888888','#8A8A8A']});
  const raw=image(8,4,[136,136,136,255]);
  for(let y=0;y<4;y++)for(let x=4;x<8;x++)raw.data.set([138,138,138,255],(y*8+x)*4);
  const seg=PNG.sync.read(PNG.sync.write(raw)),before=Buffer.from(seg.data);
  assert.equal(consolidateSourcePlanes(raw,seg,p).mergedRegions,0);
  assert(seg.data.equals(before));
});
test('source-plane consolidation cannot chain a weak ramp into one broad color', () => {
  const {consolidateSourcePlanes}=require('./source-region-palette.cjs');
  const p=parsePalette({colors:['#555555','#777777','#999999','#BBBBBB']});
  const raw=image(16,4,[120,120,120,255]),seg=image(16,4,[85,85,85,255]);
  for(let y=0;y<4;y++)for(let x=0;x<16;x++){
    const band=Math.floor(x/4),v=120+band*4;
    raw.data.set([v,v,v,255],(y*16+x)*4);seg.data.set([...p[band].rgb,255],(y*16+x)*4);
  }
  consolidateSourcePlanes(raw,seg,p);
  assert(new Set(Array.from({length:16},(_,x)=>seg.data.readUInt32BE(x*4))).size>1);
});
test('observed required stroke survives source-region assignment without changing outside cells', () => {
  const p=parsePalette({colors:['#FFF7E6','#F4D3B7','#913E3C']});
  const raw=image(64,64,[244,211,183,255]);
  for(let y=0;y<8;y++)for(let x=0;x<64;x++)raw.data.set([255,247,230,255],(y*64+x)*4);
  for(let x=20;x<43;x++)for(let y=30;y<32;y++)raw.data.set([145,62,60,255],(y*64+x)*4);
  const form={version:1,features:[{name:'source short mark',kind:'stroke',priority:'required',sourceRegion:[16,24,32,16],color:'#913E3C',samples:[[145,62,60]],contextSamples:[[244,211,183]],observation:'Synthetic thin required mark within a broad skin plane'}]};
  const plain=buildNative(PNG,raw,p,8,8,'#FFF7E6','source-region-area');
  const fixed=buildNative(PNG,raw,p,8,8,'#FFF7E6','source-region-area',null,null,null,null,form);
  assert.deepEqual(fixed.formReport.unresolved,[]);
  assert(fixed.formReport.reservedCells>=2);
  for(let y=0;y<8;y++)for(let x=0;x<8;x++)if(x<2||x>=6||y<3||y>=5)
    assert.equal(fixed.image.data.readUInt32BE((y*8+x)*4),plain.image.data.readUInt32BE((y*8+x)*4));
  assert.equal(inspect(fixed.image,p).offPalettePixels,0);
  const exterior={version:1,features:[{name:'boundary',kind:'exterior',priority:'required',color:'#913E3C',background:'#FFF7E6',observation:'Do not stack global contour recoloring on segmentation'}]};
  assert.throws(()=>buildNative(PNG,raw,p,8,8,'#FFF7E6','source-region-area',null,null,null,null,exterior),/Form allocation/);
});
console.log(passed + ' tests passed.');
