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
test('source planes are decided once and shared without modifying the source',()=>{
 const before=Buffer.from(source.data),a=b.resolveSourcePlanes(PNG,source,palette,6,6,null,compiled);
 assert.equal(compiled.sourceLabels,a.image);assert(source.data.equals(before));
 assert.equal(a.report.method,'material-constrained-connected-planes');
});
test('adjacent material in a feature-touched cell is still assigned',()=>{
 const contaminated=new PNG({width:24,height:24});source.data.copy(contaminated.data);
 const adjacent=4*24+4,feature=5*24+5;contaminated.data.set([255,247,230,255],adjacent*4);
 const result=b.resolveSourcePlanes(PNG,source,palette,6,6,null,compiled).image;
 assert.equal(compiled.exceptions[adjacent],1);assert.equal(compiled.sourceExceptions[adjacent],0);
 assert.equal(result.data.readUInt32BE(adjacent*4),0xf4d3b7ff);
 assert(palette.some(c=>parseInt(c.hex.slice(1)+'ff',16)===result.data.readUInt32BE(feature*4)));
 assert.equal(compiled.interior.has(7),false);
});
test('partial source feature protects its whole grid cell',()=>{for(let y=4;y<8;y++)for(let x=4;x<8;x++)assert.equal(compiled.exceptions[y*24+x],1);});
test('saved color contamination is detected',()=>{const im=b.buildNative(PNG,source,palette,6,6,'#FFF7E6','source-region-area',null,null,null,null,null,null,artifact).image;im.data.set([121,91,89,255],compiled.interior.keys().next().value*4);assert.equal(m.audit(im,compiled).violations,1);});
test('material constraints and connected planes cannot undo each other',()=>{
 const im=new PNG({width:24,height:24}),pal=b.parsePalette({colors:['#F182A0','#F26A83','#F59BB8']});
 for(let y=0;y<24;y++)for(let x=0;x<24;x++)im.data.set(x>=16?[245,155,184,255]:x>=8&&x<12?[246,115,146,255]:[247,118,148,255],(y*24+x)*4);
 const p={...structuredClone(plan),sourcePixelsSha256:hash(im.data),paletteColors:pal.map(c=>c.hex),protectedFeatures:[],regions:[{id:'cloth',material:'cloth',polygon:[[0,0],[24,0],[24,24],[0,24]],colors:pal.map(c=>c.hex),baseColor:pal[0].hex,boundaryRoles:[],observation}],inventory:[{id:'cloth',decision:'assigned',regionIds:['cloth'],observation}]};
 const comp=m.compile(PNG,im,pal,6,6,p,policies),resolved=b.resolveSourcePlanes(PNG,im,pal,6,6,null,comp);
 assert.equal(resolved.image.data.readUInt32BE((12*24+9)*4),resolved.image.data.readUInt32BE((12*24+4)*4),'amplified jitter must not be reintroduced by a second assignment');
 assert.equal(resolved.image.data.readUInt32BE((12*24+20)*4),0xf59bb8ff,'real shade must remain');
 const region=p.regions[0];p.regions=[{...region,id:'left',polygon:[[0,0],[11,0],[11,24],[0,24]]},{...region,id:'right',polygon:[[11,0],[24,0],[24,24],[11,24]]}];p.inventory[0].regionIds=['left','right'];
 const split=b.resolveSourcePlanes(PNG,im,pal,6,6,null,m.compile(PNG,im,pal,6,6,p,policies));assert(split.image.data.equals(resolved.image.data),'observation fragmentation cannot change the resolved colors');
});
test('separate material contracts remain barriers even at equal source RGB',()=>{
 const p=structuredClone(plan);p.protectedFeatures=[];const r=p.regions[0];p.regions=[{...r,id:'left',polygon:[[0,0],[12,0],[12,24],[0,24]],colors:['#F4D3B7'],baseColor:'#F4D3B7'},{...r,id:'right',material:'cloth',polygon:[[12,0],[24,0],[24,24],[12,24]],colors:['#CC9787'],baseColor:'#CC9787'}];p.inventory=[{id:'both',decision:'assigned',regionIds:['left','right'],observation}];
 const resolved=b.resolveSourcePlanes(PNG,source,palette,6,6,null,m.compile(PNG,source,palette,6,6,p,policies)).image;
 for(let y=0;y<24;y++)for(let x=0;x<24;x++)assert.equal(resolved.data.readUInt32BE((y*24+x)*4),x<12?0xf4d3b7ff:0xcc9787ff);
});
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
test('historical seven-stage source map remains bound to its executable plan',()=>assert.equal(g.assertStages(ledger(),7).through,7));
test('six-stage records cannot start new production',()=>assert.throws(()=>g.assertProductionStages(fixtureSixLedger(sourceAsset,paletteAsset,sourceAsset,plan.grid),2),/Eight-stage/));
test('missing material stage blocks historical validation',()=>{const l=ledger();l.stages.splice(3,1);assert.throws(()=>g.assertStages(l,4),/Stage 4/);});
test('failed material observation cannot hide under parent PASS',()=>{const l=ledger();l.stages[3].checks.ambiguity.status='FAIL';assert.throws(()=>g.assertStages(l,4),/ambiguity/);});
test('forged source map is rejected',()=>{const l=ledger(),im=PNG.sync.read(fs.readFileSync(map.path));im.data.set([0,0,0,255],0);l.stages[3].assignment.map=asset('forged.png',PNG.sync.write(im));assert.throws(()=>g.assertStages(l,4),/ownership map differs/);});
test('execution snapshot includes reviewed plan',()=>assert.equal(g.assertExecution(ledger(),'fixed-asset-grid',{width:6,height:6,scale:4,background:'#FFF7E6',materialPlan:artifact,sampling:'source-region-area'}).status,'MATCH'));
test('overlapping eye and line windows require actual eye shape',()=>{const l=ledger(),o=l.stages[3].executionOptions;l.stages[0].execution.operations.push('eyePolicy','outlinePolicy');o.eyePolicy={eyes:[{rect:[4,4,12,12]}]};o.outlinePolicy={observedStrokes:{roles:[{rect:[8,4,12,12]}]}};assert.throws(()=>g.assertStages(l,4),/actual eye ownership polygon/);});
test('material protection cannot contradict the observed eye shape',()=>{const p=structuredClone(plan),o={...policies,eyePolicy:{eyes:[{rect:[4,4,8,8],sourcePolygon:[[4,4],[12,4],[12,12],[4,12]]}]}};p.boundaryPolicySha256=m.policyHash(o);assert.throws(()=>m.compile(PNG,source,palette,6,6,p,o),/eye and material ownership shapes differ/);});
test('observed internal strokes reserve ink without exempting surrounding skin from its palette',()=>{
 const im=new PNG({width:48,height:48});for(let p=0;p<48*48;p++)im.data.writeUInt32BE(0xf9e6bfff,p*4);
 for(let y=20;y<25;y++)for(let x=12;x<34;x++)im.data.writeUInt32BE(0x774c41ff,(y*48+x)*4);
 const pal=b.parsePalette({colors:['#FFF7E6','#F9E6BF','#F4D3B7','#CC9787','#795B59']});
 const formPolicy={version:1,placement:'source-path',features:[{name:'observed seam',kind:'stroke',priority:'required',sourceRegion:[8,16,30,14],color:'#795B59',samples:[[119,76,65]],contextSamples:[[249,230,191]],observation,curve:{version:1,axis:'y',observation,landmarks:[{name:'start',kind:'endpoint',sourceRegion:[11,19,5,7]},{name:'end',kind:'endpoint',sourceRegion:[30,19,5,7]}]}}]};
 const pol={eyePolicy:null,formPolicy,outlinePolicy:null},p={version:1,sourcePixelsSha256:hash(im.data),paletteColors:pal.map(p=>p.hex),grid:{native:[12,12],cell:4,canvas:[48,48],origin:[0,0]},boundaryPolicySha256:m.policyHash(pol),observation,unassigned:'preserve-existing-source-regions',regions:[{id:'skin',material:'skin',polygon:[[0,0],[48,0],[48,48],[0,48]],colors:['#F4D3B7','#CC9787'],baseColor:'#F4D3B7',boundaryRoles:[],observation}],protectedFeatures:[],inventory:[{id:'skin',decision:'assigned',regionIds:['skin'],observation}]};
 const compiled=m.compile(PNG,im,pal,12,12,p,pol),assigned=b.resolveSourcePlanes(PNG,im,pal,12,12,null,compiled);
 assert.equal(assigned.image.data.readUInt32BE((20*48+14)*4),0x795b59ff);assert.equal(assigned.image.data.readUInt32BE((18*48+14)*4),0xf4d3b7ff);
 const result=b.buildNative(PNG,im,pal,12,12,'#FFF7E6','source-region-area',null,null,null,null,formPolicy,null,asset('stroke-skin-plan.json',JSON.stringify(p)));
 assert.deepEqual(result.formReport.unresolved,[]);assert.equal(m.audit(result.image,compiled).violations,0);
 let seam=0;for(let q=0;q<144;q++){const color=result.image.data.readUInt32BE(q*4);assert([0xf4d3b7ff,0xcc9787ff,0x795b59ff].includes(color));if(color===0x795b59ff)seam++;}assert(seam>2);
 const split=structuredClone(p),region=split.regions[0];split.regions=[{...region,id:'skin-left',polygon:[[0,0],[17,0],[17,48],[0,48]]},{...region,id:'skin-right',polygon:[[17,0],[48,0],[48,48],[17,48]]}];split.inventory[0].regionIds=split.regions.map(r=>r.id);
 const splitResult=b.buildNative(PNG,im,pal,12,12,'#FFF7E6','source-region-area',null,null,null,null,formPolicy,null,asset('split-stroke-skin-plan.json',JSON.stringify(split)));assert(splitResult.image.data.equals(result.image.data),'splitting one material into observations must not change its colors or stroke context');
});
test('explicit surface membership, not observation IDs or color equality, controls interior protection',()=>{
 const p=structuredClone(plan);p.protectedFeatures=[];
 const policy={...policies,outlinePolicy:{sourceStrokeColors:['#24242D']}};p.boundaryPolicySha256=m.policyHash(policy);
 p.surfaces=[{id:'connected',regionIds:['skin'],contourColor:'#24242D',observation}];
 const whole=m.compile(PNG,source,palette,6,6,p,policy),r=p.regions[0];
 p.regions=[{...r,id:'left',polygon:[[4,4],[11,4],[11,20],[4,20]]},{...r,id:'right',polygon:[[11,4],[20,4],[20,20],[11,20]]}];p.inventory[0].regionIds=['left','right'];p.surfaces[0].regionIds=['left','right'];
 const split=m.compile(PNG,source,palette,6,6,p,policy);assert.deepEqual([...split.interior.keys()],[...whole.interior.keys()]);
 p.regions.reverse();p.surfaces[0].regionIds.reverse();assert.deepEqual([...m.compile(PNG,source,palette,6,6,p,policy).interior.keys()],[...whole.interior.keys()]);
 delete p.surfaces;assert(m.compile(PNG,source,palette,6,6,p,policy).interior.size<whole.interior.size,'equal material is not enough to merge unspecified objects');
 assert.deepEqual([...m.compile(PNG,source,palette,6,6,p,policy).colorInterior.keys()],[...whole.colorInterior.keys()],'fragment IDs cannot remove material color obligations');
});
test('preservation cannot be silently accepted without same-source executed baseline evidence',()=>{
 const p=structuredClone(plan);p.preserveOutside={baseline:sourceAsset,sourcePixelsSha256:p.sourcePixelsSha256,sourceRegions:[[4,4,16,16]],observation};
 assert.throws(()=>m.compile(PNG,source,palette,6,6,p,policies),/baseline grid changed/);
 const native=new PNG({width:6,height:6});for(let q=0;q<36;q++)native.data.writeUInt32BE(0xf4d3b7ff,q*4);p.preserveOutside.baseline=asset('fixed.png',PNG.sync.write(native));
 assert.throws(()=>m.compile(PNG,source,palette,6,6,p,policies),/executed stroke evidence/);
 p.preserveOutside.sourcePixelsSha256='0'.repeat(64);assert.throws(()=>m.compile(PNG,source,palette,6,6,p,policies),/same observed source/);
});
for(const rotated of [false,true])test('declared dark fill survives contour thinning with its bend and gap '+rotated,()=>{
 const W=64,im=new PNG({width:W,height:W}),pal=b.parsePalette({colors:['#FFFFFF','#432443','#FFCC99']});
 const at=(x,y)=>rotated?[W-1-y,x]:[x,y];
 for(let y=0;y<W;y++)for(let x=0;x<W;x++){
  const [u,v]=at(x,y),body=x>=8&&x<56&&y>=8&&y<56,rim=body&&(x<12||x>=52||y<12||y>=52);
  const bent=x>=16&&x<44&&y>=28&&y<36||x>=36&&x<44&&y>=20&&y<28;
  const gap=x>=28&&x<32&&y>=28&&y<32;
  im.data.writeUInt32BE(gap?0xffffffff:rim||bent?0x432443ff:body?0xffcc99ff:0xffffffff,(v*W+u)*4);
 }
 const eyePolicy={version:1,visibility:'not-visible',observation:'Synthetic material fixture has no eyes',eyes:[]};
 const outlinePolicy={version:1,layout:'joint-source-band',width:1,background:'#FFFFFF',backgroundTolerance:10,sourceStrokeColors:['#432443'],sourceInkRoles:[{name:'shared dark pigment',kind:'mixed',color:'#432443',observation:'Narrow outer rim shares pigment with filled interior bend'}]},pol={eyePolicy,formPolicy:null,outlinePolicy};
 const rects=[[16,28,12,8],[32,28,12,8],[28,32,4,4],[36,20,8,8]],transform=([x,y])=>rotated?[64-y,x]:[x,y];
 const regions=rects.map(([x,y,w,h],i)=>({id:'fill-'+i,material:'cloth',geometry:'fill',polygon:[[x,y],[x+w,y],[x+w,y+h],[x,y+h]].map(transform),colors:['#432443'],baseColor:'#432443',boundaryRoles:[],observation}));
 const p={version:1,sourcePixelsSha256:hash(im.data),paletteColors:pal.map(c=>c.hex),grid:{native:[16,16],cell:4,canvas:[64,64],origin:[0,0]},boundaryPolicySha256:m.policyHash(pol),observation,unassigned:'preserve-existing-source-regions',regions,protectedFeatures:[],inventory:[{id:'cloth',decision:'assigned',regionIds:regions.map(r=>r.id),observation}]};
 const old=b.buildNative(PNG,im,pal,16,16,'#FFFFFF','source-region-area',null,null,null,eyePolicy,null,outlinePolicy);
 const compiled=m.compile(PNG,im,pal,16,16,p,pol),out=b.buildNative(PNG,im,pal,16,16,'#FFFFFF','source-region-area',null,null,null,eyePolicy,null,outlinePolicy,asset('fill-'+rotated+'.json',JSON.stringify(p)));
 assert(compiled.fillCells.size>8);assert([...compiled.fillCells.keys()].some(q=>old.image.data.readUInt32BE(q*4)!==0x432443ff),'fixture must reproduce a real lost fill');
 for(const q of compiled.fillCells.keys())assert.equal(out.image.data.readUInt32BE(q*4),0x432443ff);
 assert.equal(m.audit(out.image,compiled).violations,0);
 const [gx,gy]=at(29,29);assert.equal(out.image.data.readUInt32BE((Math.floor(gy/4)*16+Math.floor(gx/4))*4),0xffffffff);
 const broken=PNG.sync.read(PNG.sync.write(out.image));broken.data.writeUInt32BE(0xffcc99ff,[...compiled.fillCells.keys()][0]*4);assert(m.audit(broken,compiled).lostFillCells.length>0);
 const line=out.outlineReport.pathCells[0];broken.data.writeUInt32BE(0xffffffff,line*4);assert.equal(require('./raster-owned-stroke-bands.cjs').auditRenderedStrokeBands(broken,out.outlineReport).status,'FAIL');
 const invalid=structuredClone(p);invalid.regions[0].geometry='stroke';assert.throws(()=>m.compile(PNG,im,pal,16,16,invalid,pol),/explicit fill/);
 // A new source may preserve its old output only after exact outside-source,
 // grid, palette and executed-baseline evidence checks, never by assumption.
 const baseSource=asset('edit-base-source-'+rotated+'.png',PNG.sync.write(im)),baseNative=asset('edit-base-native-'+rotated+'.png',PNG.sync.write(out.image)),basePalette=asset('edit-base-palette-'+rotated+'.json',JSON.stringify({colors:pal.map(c=>c.hex)}));
 const run=asset('edit-base-run-'+rotated+'.json',JSON.stringify({source:baseSource,native:baseNative,palette:basePalette,outlineReport:out.outlineReport}));
 const edited=PNG.sync.read(PNG.sync.write(im));edited.data.writeUInt32BE(0xffffffff,(14*64+14)*4);
 const editPlan=structuredClone(p);editPlan.sourcePixelsSha256=hash(edited.data);editPlan.preserveOutside={baseline:baseNative,baselineRun:run,sourcePixelsSha256:hash(edited.data),sourceRegions:[[12,12,4,4]],observation,sourceEdit:{baselineSourcePixelsSha256:hash(im.data),observation}};
 assert.equal(m.compile(PNG,edited,pal,16,16,editPlan,pol).fixedCells.size,255);
 const undeclared=structuredClone(editPlan);delete undeclared.preserveOutside.sourceEdit;assert.throws(()=>m.compile(PNG,edited,pal,16,16,undeclared,pol),/different source/);
 const outside=PNG.sync.read(PNG.sync.write(edited));outside.data.writeUInt32BE(0xffcc99ff,0);const outsidePlan=structuredClone(editPlan);outsidePlan.sourcePixelsSha256=outsidePlan.preserveOutside.sourcePixelsSha256=hash(outside.data);assert.throws(()=>m.compile(PNG,outside,pal,16,16,outsidePlan,pol),/outside declared/);
 const wrong=structuredClone(editPlan);wrong.preserveOutside.sourceEdit.baselineSourcePixelsSha256='0'.repeat(64);assert.throws(()=>m.compile(PNG,edited,pal,16,16,wrong,pol),/executed baseline source/);
 const misaligned=structuredClone(editPlan);misaligned.preserveOutside.sourceRegions=[[13,12,4,4]];assert.throws(()=>m.compile(PNG,edited,pal,16,16,misaligned,pol),/grid-aligned/);
 const reordered=structuredClone(editPlan);reordered.paletteColors.reverse();assert.throws(()=>m.compile(PNG,edited,[...pal].reverse(),16,16,reordered,pol),/baseline palette/);
});
test('three tones of a declared majority fill do not lose their cell to minority ink',()=>{
 const pal=b.parsePalette({colors:['#FFFFFF','#24242D','#34343F','#464653','#5E5B66']}),im=new PNG({width:32,height:32});
 for(let y=0;y<32;y++)for(let x=0;x<32;x++){const body=x>=4&&x<28&&y>=4&&y<28,rim=body&&(x<8||x>=24||y<8||y>=24);im.data.writeUInt32BE(rim?0x24242dff:body?0x464653ff:0xffffffff,(y*32+x)*4);}
 const fillPoints=[];for(let y=12;y<16;y++)for(let x=12;x<16;x++){const i=(y-12)*4+x-12;im.data.writeUInt32BE(i<9?[0x34343fff,0x464653ff,0x5e5b66ff][Math.floor(i/3)]:0x24242dff,(y*32+x)*4);if(i<9)fillPoints.push([x,y]);}
 const eyePolicy={version:1,visibility:'not-visible',observation,eyes:[]},outlinePolicy={version:1,layout:'joint-source-band',width:1,background:'#FFFFFF',backgroundTolerance:0,sourceStrokeColors:['#24242D'],sourceInkRoles:[{name:'observed ink',kind:'mixed',color:'#24242D',observation}]},pol={eyePolicy,formPolicy:null,outlinePolicy};
 const p={version:1,sourcePixelsSha256:hash(im.data),paletteColors:pal.map(c=>c.hex),grid:{native:[8,8],cell:4,canvas:[32,32],origin:[0,0]},boundaryPolicySha256:m.policyHash(pol),observation,unassigned:'preserve-existing-source-regions',regions:[{id:'material',material:'cloth',geometry:'fill',polygon:[[12,12],[16,12],[16,14],[13,14],[13,15],[12,15]],colors:['#34343F','#464653','#5E5B66'],baseColor:'#464653',boundaryRoles:[],observation}],protectedFeatures:[],inventory:[{id:'cloth',decision:'assigned',regionIds:['material'],observation}]};
 const raw=b.buildNative(PNG,im,pal,8,8,'#FFFFFF','area-vote');assert.equal(raw.image.data.readUInt32BE((3*8+3)*4),0x24242dff,'fixture reproduces minority-color victory');
 const out=b.buildNative(PNG,im,pal,8,8,'#FFFFFF','source-region-area',null,null,null,eyePolicy,null,outlinePolicy,asset('three-tone-majority.json',JSON.stringify(p)));
 assert(p.regions[0].colors.includes('#'+out.image.data.subarray((3*8+3)*4,(3*8+3)*4+3).toString('hex').toUpperCase()));
 assert.equal(out.outlineReport.savedWidth.status,'PASS');assert.equal(b.inspect(out.image,pal).offPalettePixels,0);
});
test('source material witnesses reject missing coverage and disconnected planes',()=>{
 const p=structuredClone(plan);p.protectedFeatures=[];p.roleWitnesses=[{material:'skin',points:[[8,8],[16,16]],connected:true,observation:'Two observed points on one source skin plane.'}];
 assert.doesNotThrow(()=>m.compile(PNG,source,palette,6,6,p,policies));
 p.roleWitnesses[0].points[0]=[2,2];assert.throws(()=>m.compile(PNG,source,palette,6,6,p,policies),/coverage missing/);
 p.roleWitnesses[0].points=[[8,8],[16,16]];const r=p.regions[0];p.regions=[{...r,id:'top',polygon:[[4,4],[20,4],[20,11],[4,11]]},{...r,id:'bottom',polygon:[[4,13],[20,13],[20,20],[4,20]]}];p.inventory[0].regionIds=['top','bottom'];assert.throws(()=>m.compile(PNG,source,palette,6,6,p,policies),/connection missing/);
});
console.log(JSON.stringify({passed,scope:'Ownership/stage-gate mechanics only, not artwork quality',directory:dir}));
