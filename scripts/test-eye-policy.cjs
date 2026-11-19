'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {PNG}=require(require.resolve('pngjs',{paths:[__dirname,process.cwd()]}));
const {parsePalette,buildNative,enlarge}=require('./build-palette-native.cjs');
const {applyEyePolicy,auditEyePolicy,assertEyePolicy,affineEyeGrid}=require('./eye-plane-policy.cjs');
const palette=parsePalette({colors:['#FFFFFF','#101010','#206080','#3080A0']});
const base=new PNG({width:10,height:10});base.data.fill(255);
for(let y=2;y<8;y++)for(let x=2;x<8;x++)base.data.set([...(x===2||x===7||y===2||y===7?palette[1]:palette[2+(x+y)%2]).rgb,255],(y*10+x)*4);
const source=enlarge(PNG,base,4),grid=affineEyeGrid(source,base,{fitWidth:10,fitHeight:10,offsetX:0,offsetY:0});
// Subcell reflection actually in the source, absent from the baseline.
for(let y=17;y<19;y++)for(let x=17;x<19;x++)source.data.set([255,255,255,255],(y*40+x)*4);
const policy={version:1,visibility:'visible',observation:'Synthetic enclosed lens, two source lens tones and a small reflection.',eyes:[{name:'lens',rect:[8,8,24,24],reflection:'if-room',roles:[
 {name:'rim',color:'#101010',colors:['#101010'],samples:[[16,16,16]]},
 {name:'lens',color:'#3080A0',colors:['#206080','#3080A0'],samples:[[32,96,128],[48,128,160]]},
 {name:'light',color:'#FFFFFF',colors:['#FFFFFF'],samples:[[255,255,255]]}
]}]};
let n=0;function test(name,fn){fn();n++;console.log('PASS '+name);}
test('missing policy and off-palette representatives rejected',()=>{
 assert.throws(()=>assertEyePolicy(null,palette));const bad=structuredClone(policy);bad.eyes[0].roles[0].color='#222222';assert.throws(()=>assertEyePolicy(bad,palette));
});
const out=applyEyePolicy(PNG,source,base,palette,policy,grid);
test('flat lens planes, original boundary and outside preserved',()=>{
 for(let y=0;y<10;y++)for(let x=0;x<10;x++){
  const p=(y*10+x)*4;if(x<=2||x>=7||y<=2||y>=7)assert.equal(out.image.data.readUInt32BE(p),base.data.readUInt32BE(p));
  else assert.notEqual(out.image.data.readUInt32BE(p),0x206080ff);
 }
});
test('source-supported reflection fits inside without moving boundary',()=>{
 assert(out.report.eyes[0].reflection.some(r=>r.reason==='source-highlight-restored'));
 const saved=PNG.sync.read(PNG.sync.write(out.image));assert.equal(auditEyePolicy(PNG,source,saved,palette,policy,grid).status,'PASS');
 assert.equal(auditEyePolicy(PNG,source,base,palette,policy,grid).status,'FAIL');
});
test('no-room reflection is omitted and cannot erase a one-cell eye',()=>{
 const b=new PNG({width:10,height:10});b.data.fill(255);b.data.set([...palette[2].rgb,255],(4*10+4)*4);
 const p=structuredClone(policy);p.eyes[0].rect=[16,16,4,4];
 const a=applyEyePolicy(PNG,source,b,palette,p,grid);
 assert(a.report.eyes[0].reflection.some(r=>r.reason==='omitted-no-interior-room'));
 assert.notEqual(a.image.data.readUInt32BE((4*10+4)*4),0xffffffff);
});
test('build API connects common eye rule and marks unreviewed helpers',()=>{
 assert.equal(buildNative(PNG,source,palette,10,10,'#FFFFFF').eyePolicyReport.status,'UNASSESSED_CANDIDATE_ONLY');
 const r=buildNative(PNG,source,palette,10,10,'#FFFFFF','nearest',null,null,null,policy);
 assert.equal(r.eyePolicyReport.rule,'flat-eye-planes/no-gradients');
});
test('direct CLI refuses missing observation before emitting PNG',()=>{
 const d=fs.mkdtempSync(path.join(os.tmpdir(),'pixel-eye-policy-'));
 fs.writeFileSync(path.join(d,'source.png'),PNG.sync.write(source));fs.writeFileSync(path.join(d,'palette.json'),JSON.stringify({colors:palette.map(p=>p.hex)}));
 const config={source:'source.png',palette:'palette.json',width:10,height:10,scale:4,background:'#FFFFFF',output:'result'};
 fs.writeFileSync(path.join(d,'job.json'),JSON.stringify(config));
 const r=spawnSync(process.execPath,[path.join(__dirname,'build-palette-native.cjs'),path.join(d,'job.json')],{encoding:'utf8'});
 assert.notEqual(r.status,0);assert.match(r.stderr+r.stdout,/eyePolicy/);assert(!fs.existsSync(path.join(d,'result.native.png')));
});
test('source partitions keep dark iris pigment out of the lid and pool iris tones',()=>{
 const ep=require('./eye-plane-policy.cjs'),pal=parsePalette({colors:['#FFFFFF','#101010','#CC2020','#601010']}),s=new PNG({width:24,height:24});s.data.fill(255);
 const polygon=[[7.8,7.9],[12.1,7.9],[12.1,12.2]],inside=[];
 for(let y=8;y<12;y++)for(let x=8;x<12;x++){
  const isIris=ep.inSourcePolygon(x+.5,y+.5,polygon);if(isIris)inside.push([x,y]);s.data.set([16,16,16,255],(y*24+x)*4);
 }
 assert.equal(inside.length,10);inside.slice(0,5).forEach(([x,y])=>s.data.set([204,32,32,255],(y*24+x)*4));
 const p={version:1,visibility:'visible',placement:'source-partitions',observation:'Synthetic overlapping dark pigment; source iris ownership distinguishes it from the lid.',eyes:[{
  name:'eye',rect:[4,4,16,16],sourcePolygon:[[4,4],[20,4],[20,20],[4,20]],reflection:'off',baseRoles:['lid','sclera'],partitions:[{name:'iris',observation:'Triangle occupies ten of sixteen source samples in a cell.',sourcePolygon:polygon,roles:['iris','iris-dark']}],roles:[
   {name:'lid',family:'lid',color:'#101010',colors:['#101010'],samples:[[16,16,16]],required:false},
   {name:'sclera',family:'white',color:'#FFFFFF',colors:['#FFFFFF'],samples:[[255,255,255]]},
   {name:'iris',family:'iris',color:'#CC2020',colors:['#CC2020'],samples:[[204,32,32]],required:false},
   {name:'iris-dark',family:'iris',color:'#601010',colors:['#601010'],samples:[[16,16,16]],required:false}
  ]}]};
 const base=buildNative(PNG,s,pal,6,6,'#FFFFFF','area-vote').image,g=affineEyeGrid(s,base,{fitWidth:6,fitHeight:6,offsetX:0,offsetY:0});
 assert.equal(base.data.readUInt32BE((2*6+2)*4),0x101010ff);
 const a=applyEyePolicy(PNG,s,base,pal,p,g);assert.notEqual(a.image.data.readUInt32BE((2*6+2)*4),0x101010ff);
 assert.equal(a.sourceRoleMap.data.readUInt32BE((inside[9][1]*24+inside[9][0])*4),0x601010ff);
 assert.equal(a.sourceRoleMap.data.readUInt32BE((11*24+8)*4),0x101010ff);
 const own=ep.eyeOwnership(s,p,6,6);for(let q=0;q<36;q++)if(!own.cells.has(q))assert.equal(a.image.data.readUInt32BE(q*4),base.data.readUInt32BE(q*4));
 assert.deepEqual(applyEyePolicy(PNG,s,a.image,pal,p,g).image.data,a.image.data);
 assert.equal(auditEyePolicy(PNG,s,base,pal,p,g).status,'FAIL');assert.equal(auditEyePolicy(PNG,s,a.image,pal,p,g).status,'PASS');
 const built=buildNative(PNG,s,pal,6,6,'#FFFFFF','area-vote',null,null,null,p);assert.deepEqual(built.image.data,a.image.data);
 assertEyePolicy(ep.remapEyePolicy(p,g),pal);
 const bad=structuredClone(p);bad.eyes[0].partitions.push(structuredClone(bad.eyes[0].partitions[0]));assert.throws(()=>applyEyePolicy(PNG,s,base,pal,bad,g),/Overlapping source/);
 bad.eyes[0].partitions[0].roles=['missing'];assert.throws(()=>assertEyePolicy(bad,pal),/partition/);
});
test('partition highlight recovery preserves the iris and protected pupil',()=>{
 const p=structuredClone(policy);p.placement='source-partitions';p.eyes[0].sourcePolygon=[[8,8],[32,8],[32,32],[8,32]];
 p.eyes[0].roles.forEach(r=>{r.family=r.name==='rim'?'rim':'lens';r.required=r.name!=='light';});
 p.eyes[0].baseRoles=['rim'];p.eyes[0].partitions=[{name:'interior',observation:'Original lens interior, excluding the rim.',sourcePolygon:[[12,12],[28,12],[28,28],[12,28]],roles:['lens','light']}];
 const a=applyEyePolicy(PNG,source,base,palette,p,grid);
 assert(a.report.eyes[0].reflection.some(r=>r.status==='source-highlight-preserved'));
 assert.equal(auditEyePolicy(PNG,source,a.image,palette,p,grid).status,'PASS');
 const protectedPolicy=structuredClone(p);protectedPolicy.eyes[0].roles.find(r=>r.name==='lens').protect=true;
 const protectedResult=applyEyePolicy(PNG,source,base,palette,protectedPolicy,grid);
 assert(protectedResult.report.eyes[0].reflection.every(r=>r.status==='omitted-no-room'));
 assert.equal(protectedResult.image.data.readUInt32BE((4*10+4)*4),0x3080a0ff);
});
test('source stroke and filled pigment have separate geometry on the same grid',()=>{
 const s=new PNG({width:64,height:64});s.data.fill(255);
 for(let y=10;y<54;y++)for(let x=10;x<54;x++)s.data.set([...(x<18||x>=46||y<18||y>=46?[16,16,16]:[48,128,160]),255],(y*64+x)*4);
 // A dark pupil is filled pigment, even though it shares the rim RGB.
 for(let y=26;y<38;y++)for(let x=26;x<38;x++)s.data.set([16,16,16,255],(y*64+x)*4);
 const poly=[[8,8],[56,8],[56,56],[8,56]],p={version:1,visibility:'visible',placement:'source-partitions',geometryPolicy:'source-stroke-fill',observation:'Thick square rim enclosing a separate filled pupil.',eyes:[{name:'synthetic eye',rect:[8,8,48,48],sourcePolygon:poly,reflection:'off',baseRoles:['rim','lens','white'],partitions:[{name:'pupil',observation:'Dark interior pigment is a fill, not a line.',sourcePolygon:[[24,24],[40,24],[40,40],[24,40]],roles:['pupil','lens']}],roles:[
  {name:'rim',family:'rim',geometry:'stroke',width:1,closed:true,color:'#101010',colors:['#101010'],samples:[[16,16,16]]},
  {name:'pupil',family:'pupil',geometry:'fill',color:'#101010',colors:['#101010'],samples:[[16,16,16]]},
  {name:'lens',family:'lens',geometry:'fill',color:'#3080A0',colors:['#3080A0'],samples:[[48,128,160]]},
  {name:'white',family:'white',geometry:'fill',color:'#FFFFFF',colors:['#FFFFFF'],samples:[[255,255,255]]}
 ]}]};
 const b=buildNative(PNG,s,palette,16,16,'#FFFFFF','area-vote').image,g=affineEyeGrid(s,b,{fitWidth:16,fitHeight:16,offsetX:0,offsetY:0}),a=applyEyePolicy(PNG,s,b,palette,p,g),saved=PNG.sync.read(PNG.sync.write(a.image)),report=a.report.eyes[0],stroke=report.geometry.strokes[0];
 assert.deepEqual(stroke.nativeTopology,{components:1,holes:1});assert(report.roles.find(r=>r.name==='pupil').nativeCells>=4);
 assert.equal(auditEyePolicy(PNG,s,saved,palette,p,g).status,'PASS');
 const owner=require('./eye-plane-policy.cjs').eyeOwnership(s,p,16,16);for(let q=0;q<256;q++)if(!owner.cells.has(q))assert.equal(saved.data.readUInt32BE(q*4),b.data.readUInt32BE(q*4));
 const excess=stroke.footprint.find(q=>!stroke.cells.includes(q)&&saved.data.readUInt32BE(q*4)!==0x101010ff);assert.notEqual(excess,undefined);
 saved.data.writeUInt32BE(0x101010ff,excess*4);let audit=auditEyePolicy(PNG,s,saved,palette,p,g);assert.equal(audit.status,'FAIL');assert(audit.strokes[0].excessInk.includes(excess));
 a.image.data.copy(saved.data);saved.data.writeUInt32BE(0xffffffff,stroke.cells[0]*4);audit=auditEyePolicy(PNG,s,saved,palette,p,g);assert.equal(audit.status,'FAIL');assert(audit.strokes[0].missingCells.length);
 const bad=structuredClone(p);delete bad.eyes[0].roles[0].geometry;assert.throws(()=>assertEyePolicy(bad,palette),/geometry/);
 const tiny=buildNative(PNG,s,palette,2,2,'#FFFFFF','area-vote').image;assert.throws(()=>applyEyePolicy(PNG,s,tiny,palette,p,affineEyeGrid(s,tiny,{fitWidth:2,fitHeight:2,offsetX:0,offsetY:0})),/capacity|coverage|thickness|required role/i);
});
test('splitting same-family same-color observations cannot change the winning tone',()=>{
 const s=new PNG({width:8,height:8});s.data.fill(255);
 const a=[40,80,120],b=[60,100,140],c=[170,200,220];
 for(let p=0;p<64;p++)s.data.set([...(p<20?a:p<40?b:c),255],p*4);
 const native=new PNG({width:1,height:1});native.data.fill(255);
 const shape=[[0,0],[8,0],[8,8],[0,8]],role=(name,color,samples)=>({name,color,colors:[color],samples,family:'iris',geometry:'fill',required:false});
 const merged={version:1,visibility:'visible',placement:'source-partitions',geometryPolicy:'source-stroke-fill',observation:'Two source observations share one output tone.',eyes:[{name:'fixture',rect:[0,0,8,8],sourcePolygon:shape,baseRoles:['dark','light'],reflection:'off',roles:[role('dark','#206080',[a,b]),role('light','#3080A0',[c])],partitions:[{name:'all',sourcePolygon:shape,roles:['dark','light'],observation:'Whole observed iris face.'}]}]};
 const split=structuredClone(merged);split.eyes[0].roles=[role('dark-a','#206080',[a]),role('dark-b','#206080',[b]),role('light','#3080A0',[c])];split.eyes[0].baseRoles=['dark-a','dark-b','light'];split.eyes[0].partitions[0].roles=split.eyes[0].baseRoles;
 const g={x:[[0,8]],y:[[0,8]]},x=applyEyePolicy(PNG,s,native,palette,merged,g),y=applyEyePolicy(PNG,s,native,palette,split,g);
 assert(x.image.data.equals(y.image.data));assert.equal(y.image.data.readUInt32BE(0),0x206080ff);
 split.eyes[0].roles.reverse();assert(applyEyePolicy(PNG,s,native,palette,split,g).image.data.equals(x.image.data));
});
test('observed oval keeps width and height across subcell phases without changing surrounding eye',()=>{
 for(const cx of [32,36]){
  const s=new PNG({width:80,height:64});s.data.fill(255);for(let y=8;y<52;y++)for(let x=16;x<64;x++)s.data.set([48,128,160,255],(y*80+x)*4);
  for(let y=0;y<64;y++)for(let x=0;x<80;x++)if(((x+.5-cx)/8)**2+((y+.5-28)/12)**2<=1)s.data.set([16,16,16,255],(y*80+x)*4);
  const poly=[[8,4],[72,4],[72,56],[8,56]],p={version:1,visibility:'visible',placement:'source-partitions',geometryPolicy:'source-stroke-fill',observation:'One observed vertical oval within an iris at two grid phases.',eyes:[{name:'eye',rect:[8,4,64,52],sourcePolygon:poly,reflection:'off',baseRoles:['pupil','iris','white'],partitions:[{name:'observed eye',sourcePolygon:poly,roles:['pupil','iris','white'],observation:'Original source colors define the pupil and iris.'}],roles:[
   {name:'pupil',family:'iris',geometry:'fill',shape:'source-oval',protect:true,color:'#101010',colors:['#101010'],samples:[[16,16,16]]},
   {name:'iris',family:'iris',geometry:'fill',color:'#3080A0',colors:['#3080A0'],samples:[[48,128,160]]},
   {name:'white',family:'white',geometry:'fill',color:'#FFFFFF',colors:['#FFFFFF'],samples:[[255,255,255]]}]}]};
  const b=buildNative(PNG,s,palette,10,8,'#FFFFFF','area-vote').image,g=affineEyeGrid(s,b,{fitWidth:10,fitHeight:8,offsetX:0,offsetY:0}),plain=structuredClone(p);delete plain.eyes[0].roles[0].shape;
  const before=applyEyePolicy(PNG,s,b,palette,plain,g),after=applyEyePolicy(PNG,s,b,palette,p,g),shape=after.report.eyes[0].fillShapes[0];
  assert.deepEqual(shape.nativeExtent,[2,3]);assert.equal(shape.cells.length,6);assert(shape.centerDisplacementCells<=.51);
  for(let q=0;q<80;q++)if(!shape.cells.includes(q)&&!shape.cleared.includes(q))assert.equal(after.image.data.readUInt32BE(q*4),before.image.data.readUInt32BE(q*4));
  if(cx===36)assert(!before.image.data.equals(after.image.data),'offset source must exercise actual restoration');
  assert.equal(auditEyePolicy(PNG,s,after.image,palette,p,g).status,'PASS');
  const bad=structuredClone(p);bad.eyes[0].roles[0].geometry='stroke';bad.eyes[0].roles[0].width=1;assert.throws(()=>assertEyePolicy(bad,palette),/protected source fill/);
 }
});
test('eye fringe consumes assigned skin instead of reclassifying it as a hair highlight',()=>{
 const pal=parsePalette({colors:['#FFFFFF','#101010','#3080A0','#FFCC99','#FFF0CC']}),s=new PNG({width:8,height:8}),assigned=new PNG({width:8,height:8}),b=new PNG({width:1,height:1});b.data.fill(255);
 for(let y=0;y<8;y++)for(let x=0;x<8;x++){s.data.set([...(x<3?[48,128,160]:[255,240,204]),255],(y*8+x)*4);assigned.data.writeUInt32BE(0xffcc99ff,(y*8+x)*4);}
 const owners=new Int16Array(64).fill(0),material={owners,sourceExceptions:new Uint8Array(64),sourceLabels:assigned,plan:{regions:[{material:'skin',colors:['#FFCC99']}]}};
 const p={version:1,visibility:'visible',placement:'source-partitions',geometryPolicy:'source-stroke-fill',observation:'An eye occupies three source columns; the remaining five are reviewed skin despite their hair-like raw RGB.',eyes:[{name:'fixture',rect:[0,0,8,8],sourcePolygon:[[0,0],[3,0],[3,8],[0,8]],baseRoles:['iris'],reflection:'off',partitions:[{name:'inner',sourcePolygon:[[0,0],[3,0],[3,8],[0,8]],roles:['iris'],observation:'Actual blue columns only.'}],roles:[{name:'iris',family:'iris',geometry:'fill',color:'#3080A0',colors:['#3080A0'],samples:[[48,128,160]],required:false}]}]};
 const result=applyEyePolicy(PNG,s,b,pal,p,{x:[[0,8]],y:[[0,8]]},material);
 assert.equal(result.image.data.readUInt32BE(0),0xffcc99ff);
});

test('partition fringe can remain skin; sample coordinates reject stale RGB and wrong material ownership',()=>{
 const pal=parsePalette({colors:['#FFFFFF','#101010','#3080A0','#FFCC99']}),s=new PNG({width:8,height:8}),b=new PNG({width:1,height:1});b.data.fill(255);
 for(let y=0;y<8;y++)for(let x=0;x<8;x++)s.data.set([...(x<3?[48,128,160]:[255,204,153]),255],(y*8+x)*4);
 const shape=[[0,0],[8,0],[8,8],[0,8]],p={version:1,visibility:'visible',placement:'source-partitions',geometryPolicy:'source-stroke-fill',observation:'Broad iris partition includes a skin-colored antialias fringe.',eyes:[{name:'fixture',rect:[0,0,8,8],sourcePolygon:shape,baseRoles:['skin'],contextRoles:['skin'],reflection:'off',partitions:[{name:'iris',sourcePolygon:shape,roles:['iris'],observation:'Iris envelope includes its real surrounding skin.'}],roles:[
 {name:'iris',family:'iris',geometry:'fill',color:'#3080A0',colors:['#3080A0'],samples:[[48,128,160]],required:false},
 {name:'skin',family:'skin',geometry:'fill',color:'#FFCC99',colors:['#FFCC99'],samples:[[255,204,153]],samplePoints:[[5,4]],required:false}]}]};
 const material={owners:new Int16Array(64).fill(0),sourceExceptions:new Uint8Array(64),sourceLabels:s,plan:{regions:[{material:'skin',colors:['#FFCC99']},{material:'hair',colors:['#FFCC99']}]}},g={x:[[0,8]],y:[[0,8]]};
 const result=applyEyePolicy(PNG,s,b,pal,p,g,material);assert.equal(result.image.data.readUInt32BE(0),0xffcc99ff);
 const legacy=structuredClone(p);delete legacy.eyes[0].contextRoles;assert.equal(applyEyePolicy(PNG,s,b,pal,legacy,g,material).image.data.readUInt32BE(0),0x3080a0ff);
 material.owners[4*8+5]=1;assert.throws(()=>applyEyePolicy(PNG,s,b,pal,p,g,material),/different material owner/);material.owners[4*8+5]=0;
 const stale=structuredClone(p);stale.eyes[0].roles[1].samples[0][0]=254;assert.throws(()=>applyEyePolicy(PNG,s,b,pal,stale,g,material),/sample changed/);
 const bad=structuredClone(p);bad.eyes[0].contextRoles=['iris'];assert.throws(()=>assertEyePolicy(bad,pal),/context/);
});
test('clipped closed-eye ownership cannot exempt a parallel old rim as unknown context',()=>{
 const s=new PNG({width:64,height:64});s.data.fill(255);
 for(let y=0;y<64;y++)for(let x=0;x<64;x++){const r=Math.hypot(x+.5-32,y+.5-32);s.data.writeUInt32BE(r<16?0x3080a0ff:r<24?0x101010ff:0xffffffff,(y*64+x)*4);}
 const make=radius=>{const poly=Array.from({length:64},(_,i)=>[32+radius*Math.cos(i*Math.PI/32),32+radius*Math.sin(i*Math.PI/32)]);return{version:1,visibility:'visible',placement:'source-partitions',geometryPolicy:'source-stroke-fill',observation:'Full source ring versus an observation that clips its outer cross-section.',eyes:[{name:'round lens',rect:[32-radius,32-radius,radius*2,radius*2],sourcePolygon:poly,reflection:'off',baseRoles:['rim','lens','white'],partitions:[{name:'observed lens',sourcePolygon:poly,roles:['rim','lens','white'],observation:'Source colors only.'}],roles:[
  {name:'rim',family:'rim',geometry:'stroke',width:1,closed:true,color:'#101010',colors:['#101010'],samples:[[16,16,16]]},
  {name:'lens',family:'lens',geometry:'fill',color:'#3080A0',colors:['#3080A0'],samples:[[48,128,160]]},
  {name:'white',family:'white',geometry:'fill',color:'#FFFFFF',colors:['#FFFFFF'],samples:[[255,255,255]],required:false}
 ]}]};};
 const b=buildNative(PNG,s,palette,16,16,'#FFFFFF','area-vote').image,g=affineEyeGrid(s,b,{fitWidth:16,fitHeight:16,offsetX:0,offsetY:0});
 const clipped=make(19),bad=applyEyePolicy(PNG,s,b,palette,clipped,g),badAudit=auditEyePolicy(PNG,s,bad.image,palette,clipped,g);
 assert.equal(badAudit.status,'FAIL');assert(badAudit.strokes[0].excessInk.length>0,'Unowned dark context must not masquerade as a declared fill');
 const full=make(26),good=applyEyePolicy(PNG,s,b,palette,full,g);assert.equal(auditEyePolicy(PNG,s,good.image,palette,full,g).status,'PASS');
 for(let y=5;y<11;y++)for(let x=5;x<11;x++)assert.equal(good.image.data.readUInt32BE((y*16+x)*4),0x3080a0ff,'Interior reallocation must not borrow exterior white');
 assert.equal(good.image.data.readUInt32BE(0),0xffffffff);
 const typed=structuredClone(full);typed.eyes[0].roles[0].interiorRoles=['lens'];
 const typedResult=applyEyePolicy(PNG,s,b,palette,typed,g);assert.equal(auditEyePolicy(PNG,s,typedResult.image,palette,typed,g).status,'PASS');
 typed.eyes[0].roles[0].interiorRoles=['rim'];assert.throws(()=>assertEyePolicy(typed,palette),/observed non-stroke/);
});
console.log(n+' eye policy checks passed');
