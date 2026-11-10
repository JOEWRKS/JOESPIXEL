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
console.log(n+' eye policy checks passed');
