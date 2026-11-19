'use strict';
const assert=require('node:assert/strict');
const {PNG}=require(require.resolve('pngjs',{paths:[__dirname,process.cwd()]}));
const {auditRenderedStrokeBands:audit,requireRenderedStrokeAudit:requireAudit,assertOwnedStrokePolicy}=require('./raster-owned-stroke-bands.cjs');
const {assertFixedGridPlacement,parsePalette}=require('./build-palette-native.cjs');
const white=0xffffffff,ink=0x432443ff,skin=0xffcc99ff;
const fresh=()=>{const im=new PNG({width:8,height:8});for(let p=0;p<64;p++)im.data.writeUInt32BE(white,p*4);return im;};
const clone=im=>PNG.sync.read(PNG.sync.write(im));
const line=[18,26,34,42],fill=[19,27,35,43],protectedCell=54;
const im=fresh();for(const p of line)im.data.writeUInt32BE(ink,p*4);for(const p of fill)im.data.writeUInt32BE(skin,p*4);im.data.writeUInt32BE(ink,protectedCell*4);
const report={version:1,method:'joint-source-band',colors:['#432443'],sourceBand:[...line,...fill],pathCells:line,expectedColors:line.map(p=>[p,ink]),expectedFillColors:fill.map(p=>[p,skin]),protectedColors:[[protectedCell,ink]],filledMaterialCells:[],sourcePathCount:1,unresolved:[]};
let checks=0;function test(name,fn){fn();checks++;console.log('PASS '+name);}
test('saved RGB one-dot line passes',()=>requireAudit(audit(clone(im),report)));
test('missing/unrun report never means zero defects',()=>{for(const r of [undefined,{}, {method:'legacy'}]){const a=audit(im,r);assert.equal(a.renderedStrokeChecked,false);assert.equal(a.solidRenderedStrokeBlocks,null);assert.throws(()=>requireAudit(a));}assert.throws(()=>requireAudit({status:'PASS',renderedStrokeChecked:false}));});
test('removed saved line cell fails',()=>{const x=clone(im);x.data.writeUInt32BE(skin,26*4);assert.equal(audit(x,report).missingPathPixels,1);assert.throws(()=>requireAudit(audit(x,report)));});
test('old adjacent ink is detected even without solid 2x2',()=>{const x=clone(im);x.data.writeUInt32BE(ink,19*4);const a=audit(x,report);assert.equal(a.residualBandInk,1);assert.equal(a.solidRenderedStrokeBlocks,0);assert.equal(a.status,'FAIL');});
test('two-dot doubled line fails actual PNG check',()=>{const x=clone(im);for(const p of [19,27])x.data.writeUInt32BE(ink,p*4);const a=audit(x,report);assert(a.solidRenderedStrokeBlocks>0);assert.equal(a.status,'FAIL');});
test('changed protected feature is not ignored',()=>{const x=clone(im);x.data.writeUInt32BE(skin,protectedCell*4);assert.equal(audit(x,report).changedProtectedPixels,1);});
test('source-supported broad fill is distinct from duplicate line',()=>{const x=clone(im);for(const p of [19,27])x.data.writeUInt32BE(ink,p*4);const r={...report,filledMaterialCells:[19,27],expectedFillColors:fill.map(p=>[p,p===19||p===27?ink:skin])};requireAudit(audit(x,r));x.data.writeUInt32BE(ink,35*4);assert.equal(audit(x,r).status,'FAIL');});
test('missing audit configuration cannot bypass on a nonfixed route',()=>assert.throws(()=>assertFixedGridPlacement({outlineDecision:{mode:'continuous'}},im),/audit/));
test('legacy intermediate-only audit cannot deliver',()=>assert.throws(()=>assertFixedGridPlacement({outlineDecision:{mode:'continuous'},outlinePolicy:{sourceStrokeColors:['#432443']}},im),/final saved-PNG/));
test('rectangle-only eye protection cannot hide adjacent contour',()=>assert.throws(()=>assertFixedGridPlacement({outlinePolicy:{layout:'joint-source-band',sourceStrokeColors:['#432443']},eyePolicy:{eyes:[{rect:[0,0,4,4]}]}},im),/actual source eye polygons/));
test('missing curve-flow execution cannot deliver',()=>assert.throws(()=>assertFixedGridPlacement({outlinePolicy:{layout:'joint-source-band',sourceStrokeColors:['#432443']}},im),/curve-flow/));
test('unrun required curve topology audit blocks saved verification',()=>{const a=audit(im,{...report,curveFlowRequired:true});assert.equal(a.status,'UNVERIFIED');assert.throws(()=>requireAudit(a));});
test('unrun filled-region audit cannot pass on line topology alone',()=>{const a=audit(im,{...report,curveFlowRequired:true,curveFlow:{executed:true,finalTopology:{unchanged:true}}});assert.equal(a.status,'UNVERIFIED');assert.throws(()=>requireAudit(a));});
test('saved-region topology is recomputed rather than trusting its report',()=>{const r={...report,curveFlowRequired:true,curveFlow:{executed:true,finalTopology:{unchanged:true},regionTopologyChecked:true,background:'#FFFFFF',referenceRegionTopology:require('./source-curve-flow.cjs').regionTopologyFingerprint(im,'#FFFFFF')}};requireAudit(audit(im,r));const changed=clone(im);changed.data.writeUInt32BE(skin,0);assert.equal(audit(changed,r).status,'FAIL');});
test('source pigment ownership must be explicit and unique',()=>{const p=parsePalette({colors:['#FFFFFF','#432443']});const r={layout:'joint-source-band',width:1,sourceStrokeColors:['#432443'],sourceInkRoles:[{name:'ink',kind:'stroke',color:'#432443',observation:'Observed narrow contour'}]};assertOwnedStrokePolicy(r,p);assert.throws(()=>assertOwnedStrokePolicy({...r,sourceInkRoles:[...r.sourceInkRoles,...r.sourceInkRoles]},p));assert.throws(()=>assertOwnedStrokePolicy({...r,sourceStrokeColors:[]},p));});
test('source-supported label gap joins, real background does not',()=>{
 const palette=parsePalette({colors:['#FFFFFF','#432443','#FFCC99']});
 const policy={layout:'joint-source-band',width:1,background:'#FFFFFF',backgroundTolerance:10,sourceStrokeColors:['#432443'],sourceInkRoles:[{name:'source ink',color:'#432443',kind:'stroke',observation:'Narrow source contour'}]};
 const make=rawInk=>{const source=new PNG({width:64,height:64}),labels=new PNG({width:64,height:64}),base=new PNG({width:16,height:16});for(let p=0;p<4096;p++){source.data.writeUInt32BE(white,p*4);labels.data.writeUInt32BE(white,p*4);}for(let p=0;p<256;p++)base.data.writeUInt32BE(white,p*4);for(let y=24;y<28;y++)for(let x=8;x<56;x++){source.data.writeUInt32BE(x===31?(rawInk?0x8f728fff:white):ink,(y*64+x)*4);labels.data.writeUInt32BE(x===31?white:ink,(y*64+x)*4);}return require('./raster-owned-stroke-bands.cjs').joint(PNG,source,base,palette,policy,null,{mask:new Uint8Array(4096),cells:new Set()},labels);};
 const supported=make(true),gap=make(false);assert(supported.report.sourceBridges.length+supported.report.sourceInkEvidence.addedSourcePixels>0);assert.equal(gap.report.sourceBridges.length+gap.report.sourceInkEvidence.addedSourcePixels,0);requireAudit(audit(clone(supported.image),supported.report));
});

test('shared contour family preserves local pigments and bridges only source-supported pigment transitions',()=>{
 const brown=0x795044ff,palette=parsePalette({colors:['#FFFFFF','#432443','#795044','#FFCC99']}),joint=require('./raster-owned-stroke-bands.cjs').joint;
 const make=(supported,family)=>{
  const source=new PNG({width:64,height:64}),labels=new PNG({width:64,height:64}),base=new PNG({width:16,height:16});source.data.fill(255);labels.data.fill(255);base.data.fill(255);
  for(let y=24;y<28;y++)for(let x=8;x<56;x++){const c=x<31?ink:brown,q=(y*64+x)*4;source.data.writeUInt32BE(x===31?(supported?brown:white):c,q);labels.data.writeUInt32BE(x===31?white:c,q);}
  const policy={layout:'joint-source-band',width:1,background:'#FFFFFF',backgroundTolerance:10,sourceStrokeColors:['#432443','#795044'],sourceInkRoles:[{name:'cool',color:'#432443',kind:'stroke',observation:'Cool left source pigment'},{name:'warm',color:'#795044',kind:'stroke',observation:'Warm right source pigment'}]};
  if(family)policy.sourceInkRoles.forEach(r=>r.family='observed continuous rim');
  return joint(PNG,source,base,palette,policy,null,{mask:new Uint8Array(4096),cells:new Set()},labels);
 };
 const connected=make(true,true),separate=make(true,false),gap=make(false,true);
 assert(connected.report.sourceBridges.length>separate.report.sourceBridges.length,'A shared family must exercise a real cross-pigment join');
 assert.equal(gap.report.sourceBridges.length,0,'Real background is never a pigment transition');
 const colors=new Set(connected.report.expectedColors.map(([,c])=>c));assert(colors.has(ink)&&colors.has(brown));requireAudit(audit(clone(connected.image),connected.report));
});
test('an already-incomplete plan cannot certify an open exterior',()=>{const x=fresh(),cells=[];for(let y=2;y<=5;y++)for(let a=2;a<=5;a++){const p=y*8+a;if(a===2||a===5||y===2||y===5){x.data.writeUInt32BE(ink,p*4);cells.push(p);}else x.data.writeUInt32BE(skin,p*4);}const make=cells=>({version:1,method:'joint-source-band',colors:['#432443'],sourceBand:[...Array(64).keys()],pathCells:cells,expectedColors:cells.map(p=>[p,ink]),expectedFillColors:[],protectedColors:[],filledMaterialCells:[],sourcePathCount:1,unresolved:[],exteriorClosureRequired:true,background:'#FFFFFF',sourceInkEvidence:{executed:true}});requireAudit(audit(x,make(cells)));const gap=19;x.data.writeUInt32BE(white,gap*4);const a=audit(x,make(cells.filter(p=>p!==gap)));assert.equal(a.missingPathPixels,0);assert(a.exposedMaterialPixels>0);assert.equal(a.status,'FAIL');});
test('source/exterior evidence missing is unverified',()=>{const a=audit(im,{...report,exteriorClosureRequired:true,background:'#FFFFFF'});assert.equal(a.status,'UNVERIFIED');});
test('canvas-edge crop is not an open exterior, but an internal break still is',()=>{const x=fresh(),cells=[];for(let y=2;y<8;y++)for(let a=2;a<=5;a++){const p=y*8+a;if(a===2||a===5||y===2){x.data.writeUInt32BE(ink,p*4);cells.push(p);}else x.data.writeUInt32BE(skin,p*4);}const make=c=>({version:1,method:'joint-source-band',colors:['#432443'],sourceBand:[...Array(64).keys()],pathCells:c,expectedColors:c.map(p=>[p,ink]),expectedFillColors:[],protectedColors:[],filledMaterialCells:[],sourcePathCount:1,unresolved:[],exteriorClosureRequired:true,background:'#FFFFFF',sourceInkEvidence:{executed:true}});requireAudit(audit(x,make(cells)));const gap=34;x.data.writeUInt32BE(white,gap*4);assert.equal(audit(x,make(cells.filter(p=>p!==gap))).status,'FAIL');});
test('declared solid material closes a mixed line/material silhouette',()=>{const x=fresh(),cells=[];for(let y=2;y<=5;y++)for(let a=2;a<=5;a++){const p=y*8+a;if(a===2){x.data.writeUInt32BE(0x191c29ff,p*4);}else if(a===5||y===2||y===5){x.data.writeUInt32BE(ink,p*4);cells.push(p);}else x.data.writeUInt32BE(skin,p*4);}const r={version:1,method:'joint-source-band',colors:['#432443'],solidExteriorColors:['#191C29'],sourceBand:[...Array(64).keys()],pathCells:cells,expectedColors:cells.map(p=>[p,ink]),expectedFillColors:[],protectedColors:[],filledMaterialCells:[],sourcePathCount:1,unresolved:[],exteriorClosureRequired:true,background:'#FFFFFF',sourceInkEvidence:{executed:true}};requireAudit(audit(x,r));assert.equal(audit(x,{...r,solidExteriorColors:[]}).status,'FAIL');});
test('reviewed background ownership overrides raw color distance without erasing assigned material',()=>{
 const palette=parsePalette({colors:['#FFFFFF','#432443','#FFCC99']}),source=new PNG({width:32,height:32}),labels=new PNG({width:32,height:32}),base=new PNG({width:8,height:8});
 for(let p=0;p<1024;p++){source.data.writeUInt32BE(0xe8ddd1ff,p*4);labels.data.writeUInt32BE(white,p*4);}base.data.fill(255);
 for(let y=12;y<16;y++)for(let x=4;x<28;x++){source.data.writeUInt32BE(ink,(y*32+x)*4);labels.data.writeUInt32BE(ink,(y*32+x)*4);}
 const owners=new Int16Array(1024).fill(-1);owners[0]=0;owners[1]=1;
 const material={owners,interior:new Map(),plan:{regions:[{material:'background'},{material:'skin'}]}};
 const policy={layout:'joint-source-band',width:1,background:'#FFFFFF',backgroundTolerance:10,sourceStrokeColors:['#432443'],sourceInkRoles:[{name:'ink',color:'#432443',kind:'stroke',observation:'Observed fixture stroke'}]};
 let observed;require('./raster-owned-stroke-bands.cjs').joint(PNG,source,base,palette,policy,material,{mask:new Uint8Array(1024),cells:new Set()},labels,e=>{if(e.stage.endsWith('source-ownership'))observed=PNG.sync.read(e.png);});
 assert.equal(observed.data.readUInt32BE(0),0xffffffff);assert.equal(observed.data.readUInt32BE(4),0x4466aaff);assert.equal(observed.data.readUInt32BE(8),0x4466aaff);
});
for(const variant of ['background-fringe','protected-feature'])test(variant+' cannot seed another region with background or raw feature RGB',()=>{
 const W=40,N=10,palette=parsePalette({colors:['#FFFFFF','#432443','#FFCC99']}),source=new PNG({width:W,height:W}),labels=new PNG({width:W,height:W});
 for(let y=0;y<W;y++)for(let x=0;x<W;x++){const c=x<4||y<4||x>=36||y>=36?white:x<12||y<12||x>=28||y>=28?ink:skin;source.data.writeUInt32BE(c,(y*W+x)*4);labels.data.writeUInt32BE(c,(y*W+x)*4);}
 // Real enclosed negative space remains background, unlike a mislabeled
 // foreground fringe. Both cases use the same palette and source geometry.
 for(let y=20;y<24;y++)for(let x=20;x<24;x++){source.data.writeUInt32BE(white,(y*W+x)*4);labels.data.writeUInt32BE(white,(y*W+x)*4);}
 const mask=new Uint8Array(W*W),cells=new Set();for(let y=12;y<15;y++)for(let x=12;x<15;x++){labels.data.writeUInt32BE(variant==='background-fringe'?white:0x734c55ff,(y*W+x)*4);if(variant==='protected-feature'){mask[y*W+x]=1;cells.add(3*N+3);}}
 const b=require('./build-palette-native.cjs'),base=b.buildNative(PNG,source,palette,N,N,'#FFFFFF','area-vote').image;
 const policy={layout:'joint-source-band',width:1,background:'#FFFFFF',backgroundTolerance:10,sourceStrokeColors:['#432443'],sourceInkRoles:[{name:'fixture contour',color:'#432443',kind:'stroke',observation:'Closed source border around skin and a real enclosed gap'}]};
 const result=require('./raster-owned-stroke-bands.cjs').joint(PNG,source,base,palette,policy,null,{mask,cells},labels);
 assert.equal(result.image.data.readUInt32BE((2*N+3)*4),skin);
 assert.equal(result.image.data.readUInt32BE((5*N+5)*4),white);
 for(const p of cells)assert.equal(result.image.data.readUInt32BE(p*4),base.data.readUInt32BE(p*4));
 assert.equal(b.inspect(result.image,palette).offPalettePixels,0);
});
test('invalid composed curve is rejected in favor of an independently audited source layout',()=>{
 const b=require('./build-palette-native.cjs'),flow=require('./source-curve-flow.cjs'),joint=require('./raster-owned-stroke-bands.cjs').joint;
 const source=new PNG({width:64,height:64}),labels=new PNG({width:64,height:64});
 for(let y=0;y<64;y++)for(let x=0;x<64;x++){const color=x>=12&&x<52&&y>=12&&y<52?(x<16||x>=48||y<16||y>=48?ink:skin):white;source.data.writeUInt32BE(color,(y*64+x)*4);labels.data.writeUInt32BE(color,(y*64+x)*4);}
 const palette=parsePalette({colors:['#FFFFFF','#432443','#FFCC99']}),base=b.buildNative(PNG,source,palette,16,16,'#FFFFFF','area-vote').image;
 const policy={layout:'joint-source-band',width:1,background:'#FFFFFF',backgroundTolerance:10,sourceStrokeColors:['#432443'],sourceInkRoles:[{name:'contour',color:'#432443',kind:'stroke',observation:'Observed closed fixture contour'}]},features={mask:new Uint8Array(4096),cells:new Set()};
 const reference=joint(PNG,source,base,palette,policy,null,features,labels),original=flow.layoutCurveFlow;
 try{
  flow.layoutCurveFlow=()=>({paths:[],report:{executed:true,accepted:1,records:[{accepted:true,before:2,after:1}]}});
  const result=joint(PNG,source,base,palette,{...policy,curveFlow:{version:1,method:'anchored-source-curve'}},null,features,labels);
  assert(result.image.data.equals(reference.image.data));assert.equal(result.report.curveFlow.accepted,0);assert.equal(result.report.curveFlow.attemptedAccepted,1);
  assert.equal(result.report.curveFlow.selection,'source-layout-after-rejected-curve');requireAudit(audit(result.image,result.report));
  const broken=clone(result.image),p=result.report.pathCells[0];broken.data.writeUInt32BE(white,p*4);assert.equal(audit(broken,result.report).status,'FAIL');
 }finally{flow.layoutCurveFlow=original;}
});
test('confirmed stroke ownership releases a wrong material label inside its cross-section',()=>{
 const W=48,H=48,step=4,source=new PNG({width:W,height:H}),labels=new PNG({width:W,height:H});
 const grey=0x736b78ff,owners=new Int16Array(W*H).fill(-1);
 for(let y=0;y<H;y++)for(let x=0;x<W;x++){
  const inside=x>=8&&x<40&&y>=8&&y<40,edge=inside&&(x<15||x>=33||y<15||y>=33);
  const fringe=edge&&(x===14||x===33||y===14||y===33),color=fringe?grey:edge?ink:inside?skin:white,p=y*W+x;
  source.data.writeUInt32BE(color,p*4);labels.data.writeUInt32BE(color,p*4);
  if(color===skin)owners[p]=0;if(fringe)owners[p]=1;
 }
 const b=require('./build-palette-native.cjs'),palette=parsePalette({colors:['#FFFFFF','#432443','#FFCC99','#736B78']}),base=b.buildNative(PNG,source,palette,12,12,'#FFFFFF','area-vote').image;
 const material={owners,interior:new Map(),fillCells:new Map(),sourceFills:new Uint8Array(W*H),materialGroups:[0,1],plan:{regions:[{material:'skin'},{material:'provisional-grey'}]}};
 const policy={layout:'joint-source-band',width:1,background:'#FFFFFF',backgroundTolerance:10,sourceStrokeColors:['#432443'],sourceInkRoles:[{name:'observed mixed pigment contour',color:'#432443',paletteColors:['#432443','#736B78'],kind:'stroke',observation:'Both source pigments belong to the same narrow border, not separate fill materials'}]};
 const result=require('./raster-owned-stroke-bands.cjs').joint(PNG,source,base,palette,policy,material,{mask:new Uint8Array(W*H),cells:new Set()},labels);
 requireAudit(audit(result.image,result.report));
 assert.equal(result.report.unresolved.length,0);
 for(let p=0;p<12*12;p++)assert.notEqual(result.image.data.readUInt32BE(p*4),grey,'A confirmed stroke pigment cannot remain as a parallel fill strip');
 for(let y=4;y<8;y++)for(let x=4;x<8;x++)assert.equal(result.image.data.readUInt32BE((y*12+x)*4),skin);
});
test('a locally wide crossing cannot exempt its long thin branches from stroke width',()=>{
 const source=new PNG({width:128,height:128}),palette=parsePalette({colors:['#FFFFFF','#432443']}),b=require('./build-palette-native.cjs');
 for(let y=0;y<128;y++)for(let x=0;x<128;x++){const cross=x>=10&&x<118&&y>=60&&y<68||y>=10&&y<118&&x>=60&&x<68||(x-64)**2+(y-64)**2<144;source.data.writeUInt32BE(cross?ink:white,(y*128+x)*4);}
 const base=b.buildNative(PNG,source,palette,32,32,'#FFFFFF','area-vote').image;
 const policy={layout:'joint-source-band',width:1,background:'#FFFFFF',backgroundTolerance:10,sourceStrokeColors:['#432443'],sourceInkRoles:[{name:'crossed source seams',color:'#432443',kind:'mixed',observation:'Long narrow seam branches meet at a wider source junction'}]};
 const result=require('./raster-owned-stroke-bands.cjs').joint(PNG,source,base,palette,policy,null,{mask:new Uint8Array(16384),cells:new Set()},source);
 requireAudit(audit(result.image,result.report));
 assert(result.report.pathCells.length>40,'The crossing must not hide long paths as fill');
 assert(result.report.filledBranches.every(branch=>branch.sourcePoints.length<16),'A long seam is not a broad material region');
});
test('mixed filled objects keep a flat sole and an internal accent inside their source rim',()=>{
 const W=96,H=80,step=4,b=require('./build-palette-native.cjs'),source=new PNG({width:W,height:H}),grey=0x777788ff,red=0xe02020ff;
 for(let y=0;y<H;y++)for(let x=0;x<W;x++){
  const inside=x>=12&&x<80&&y>=16&&y<68&&x+y<140;
  const c=!inside?white:x>=60&&x<68&&y>=52&&y<64?red:x>=24&&x<68&&y>=28&&y<52?grey:ink;
  source.data.writeUInt32BE(c,(y*W+x)*4);
 }
 const palette=parsePalette({colors:['#FFFFFF','#432443','#777788','#E02020']}),base=b.buildNative(PNG,source,palette,W/step,H/step,'#FFFFFF','area-vote').image;
 const policy={layout:'joint-source-band',width:1,background:'#FFFFFF',backgroundTolerance:10,sourceStrokeColors:['#432443'],sourceInkRoles:[{name:'filled object and rim',color:'#432443',kind:'mixed',observation:'Broad dark material surrounds a grey plane and a separate red inset'}]};
 const result=require('./raster-owned-stroke-bands.cjs').joint(PNG,source,base,palette,policy,null,{mask:new Uint8Array(W*H),cells:new Set()},source),a=audit(result.image,result.report);
 requireAudit(a);assert.equal(a.sourceExteriorChecked,true);assert.equal(a.changedSourceExteriorPixels,0);
 const value=(x,y)=>result.image.data.readUInt32BE((y*24+x)*4);
 for(let x=4;x<17;x++)assert.equal(value(x,16),ink,'A flat source base must remain a continuous dark rim');
 for(let x=0;x<24;x++)assert.equal(value(x,17),white,'No downward protrusion may be introduced');
 assert.equal(value(15,14),red);assert.equal(value(14,14),ink,'The accent must not flood sideways through vacated ink');
 // Falsify the path/fill claims as an old self-consistency-only audit could.
 const altered=clone(result.image),r=structuredClone(result.report),p=16*24+10;altered.data.writeUInt32BE(white,p*4);
 r.pathCells=r.pathCells.filter(q=>q!==p);r.expectedColors=r.expectedColors.filter(([q])=>q!==p);r.expectedFillColors=r.expectedFillColors.filter(([q])=>q!==p);
 assert(audit(altered,r).changedSourceExteriorPixels>0,'Independent source geometry must still reject the missing base');
 const protruding=clone(result.image),spur=17*24+10;protruding.data.writeUInt32BE(ink,spur*4);
 const claims=structuredClone(result.report);claims.pathCells.push(spur);claims.expectedColors.push([spur,ink]);
 assert(audit(protruding,claims).changedSourceExteriorPixels>0,'A self-consistent added path must not protrude beyond source coverage');
 const missing={...result.report};delete missing.sourceExterior;assert.equal(audit(result.image,missing).status,'UNVERIFIED');
});
test('a coarse source rim has one destination owner without inward medial stubs',()=>{
 const W=256,H=256,step=8,b=require('./build-palette-native.cjs'),source=new PNG({width:W,height:H});
 const inside=(x,y)=>((x-126)**2/111**2+(y-124)**2/112**2<1)&&!(x>100&&x<146&&y>173);
 for(let y=0;y<H;y++)for(let x=0;x<W;x++){
  let color=white;if(inside(x,y)){color=skin;for(let dy=-15;dy<=15;dy++)for(let dx=-15;dx<=15;dx++)if(dx*dx+dy*dy<=225&&!inside(x+dx,y+dy))color=ink;}
  source.data.writeUInt32BE(color,(y*W+x)*4);
 }
 // Authored staircase period differs from the locked output grid. This is
 // where the old one-cell replacement halo left detached inward branches.
 const original=Buffer.from(source.data),pitch=12;
 for(let y=0;y<H;y++)for(let x=0;x<W;x++){const sx=Math.min(W-1,Math.floor(x/pitch)*pitch+6),sy=Math.min(H-1,Math.floor(y/pitch)*pitch+6);original.copy(source.data,(y*W+x)*4,(sy*W+sx)*4,(sy*W+sx)*4+4);}
 const palette=parsePalette({colors:['#FFFFFF','#432443','#FFCC99']}),base=b.buildNative(PNG,source,palette,32,32,'#FFFFFF','area-vote').image;
 const policy={layout:'joint-source-band',width:1,background:'#FFFFFF',backgroundTolerance:10,sourceStrokeColors:['#432443'],sourceInkRoles:[{name:'rounded notched plane',color:'#432443',kind:'mixed',observation:'A single source rim, no interior seams'}]};
 const result=require('./raster-owned-stroke-bands.cjs').joint(PNG,source,base,palette,policy,null,{mask:new Uint8Array(W*H),cells:new Set()},source),rim=new Set(result.report.sourceExterior.rimColors.map(([p])=>p));
 requireAudit(audit(result.image,result.report));
 assert.equal(result.report.pathCells.filter(p=>!rim.has(p)).length,0,'A single source contour must not acquire an inner duplicate or detached dot');
 for(let y=23;y<32;y++)assert.equal(result.image.data.readUInt32BE((y*32+15)*4),white,'The concave open notch must remain open');
 assert.equal(b.inspect(result.image,palette).offPalettePixels,0);assert.equal(b.enlarge(PNG,result.image,step).width,W);
 const reference=require('./raster-owned-stroke-bands.cjs').joint(PNG,source,base,palette,policy,null,{mask:new Uint8Array(W*H),cells:new Set()},source,null,false);
 assert(!reference.image.data.equals(result.image.data),'This must exercise actual duplicate-rim removal, not a zero-change preservation case');
 for(let p=0;p<32*32;p++){
  const before=reference.image.data.readUInt32BE(p*4),after=result.image.data.readUInt32BE(p*4);
  assert.equal(after===white,before===white,'Changing the ink owner must not re-flood open space or create a hole');
  if(before===skin&&!result.report.pathCells.includes(p))assert.equal(after,skin,'A valid existing skin side must not be replaced by residual ink');
 }
 // A true internal crease must remain attached when its outer owner moves.
 for(let y=136;y<184;y++)for(let x=94;x<102;x++)if(source.data.readUInt32BE((y*W+x)*4)!==white)source.data.writeUInt32BE(ink,(y*W+x)*4);
 const creaseBase=b.buildNative(PNG,source,palette,32,32,'#FFFFFF','area-vote').image;
 const crease=require('./raster-owned-stroke-bands.cjs').joint(PNG,source,creaseBase,palette,policy,null,{mask:new Uint8Array(W*H),cells:new Set()},source);
 requireAudit(audit(crease.image,crease.report));
 assert.equal(crease.report.topology[0],1,'The source crease and the rim must remain one connected ink network');
 assert(crease.report.pathCells.some(p=>p%32===12&&Math.floor(p/32)<21&&Math.floor(p/32)>=17),'The interior crease must not disappear');
});
console.log(JSON.stringify({status:'PASS',checks}));
