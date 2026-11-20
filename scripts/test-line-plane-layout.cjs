'use strict';
const assert=require('node:assert/strict'),{PNG}=require('pngjs');
const layout=require('./source-line-layout.cjs'),{auditMaterialSurfaces}=require('./material-surface-layout.cjs');
const palette=[{hex:'#FFFFFF'},{hex:'#222222'},{hex:'#CC9977'}];
function fixture(){
 const source=new PNG({width:32,height:32});for(let p=0;p<1024;p++)source.data.writeUInt32BE(0xcc9977ff,p*4);
 const observation='Synthetic source geometry, not an artwork approval.';
 const paths=[{id:'edge',points:[[8,4],[8,28]],color:'#222222',priority:'required',observation}];
 const planes=[{id:'plane',polygon:[[10,4],[24,4],[24,28],[10,28]],axis:[[16,8],[16,24]],colors:['#CC9977'],observation}];
 const l={id:'shape',sourcePolygon:[[4,4],[28,4],[28,28],[4,28]],paths,planes,observation};
 return {source,base:{width:8,height:8},material:{plan:{lineLayouts:[l]},exceptions:new Uint8Array(1024),fixedCells:new Map()},features:{cells:new Set(),mask:new Uint8Array(1024)}};
}
const run=f=>layout.plan(f.source,f.base,f.source,f.material,f.features);
let count=0;function test(name,fn){fn();count++;console.log('PASS '+name);}
test('source observations produce connected plane and line without drawing outside domain',()=>{
 const f=fixture();layout.validate(f.material.plan.lineLayouts,32,32,palette);const r=run(f);
 assert(r.lines.size&&r.fills.size);for(const p of r.lines.keys())assert(!r.fills.has(p));
 for(const p of [...r.lines.keys(),...r.fills.keys()])assert(r.domain.has(p));
 assert(r.reports[0].planes[0].route.length>=4);
});
test('feature and preservation ownership are hard exclusions',()=>{
 const f=fixture();f.features.cells.add(18);f.material.fixedCells.set(19,0xcc9977ff);const r=run(f);
 assert(!r.domain.has(18)&&!r.domain.has(19));
});
test('two source paths meeting at one tip must still share a tip cell',()=>{
 const f=fixture(),l=f.material.plan.lineLayouts[0],p=l.paths[0];l.paths=[{...p,id:'left',points:[[8,4],[12,16],[16,28]]},{...p,id:'right',points:[[24,4],[20,16],[16,28]]}];
 l.planes[0].axis=[[16,8],[16,20]];const r=run(f),paths=r.reports[0].paths;
 const tip=path=>path.cells.filter(p=>Math.hypot(p%8+.5-4,Math.floor(p/8)+.5-7)<=.9);
 assert(tip(paths[0]).some(p=>tip(paths[1]).includes(p)));
 assert(paths.every(p=>p.endpoints.every(e=>e.distanceInCells<=.9)));
});
test('missing material cannot be fabricated from a desired plane color',()=>{
 const f=fixture();f.material.plan.lineLayouts[0].planes[0].colors=['#FFFFFF'];assert.throws(()=>run(f),/material coverage missing/);
});
test('required line and plane collision is blocked instead of silently erasing the plane',()=>{
 const f=fixture(),l=f.material.plan.lineLayouts[0];l.planes[0].polygon=[[6,4],[10,4],[10,28],[6,28]];l.planes[0].axis=[[8,8],[8,24]];
 f.features.cells=new Set(Array.from({length:64},(_,p)=>p).filter(p=>p%8!==2));assert.throws(()=>run(f),/conflict/);
});
test('destination paint and unknown priority are rejected',()=>{
 const f=fixture(),l=f.material.plan.lineLayouts[0];l.paths[0].nativeCells=[1];assert.throws(()=>layout.validate([l],32,32,palette),/invalid/);delete l.paths[0].nativeCells;l.paths[0].priority='force';assert.throws(()=>layout.validate([l],32,32,palette),/invalid/);
});
test('saved material route corruption is detected independently of line count',()=>{
 const image=new PNG({width:8,height:8});for(let p=0;p<64;p++)image.data.writeUInt32BE(0xcc9977ff,p*4);
 const reports=[{id:'plane',colors:['#CC9977'],contourColor:'#222222',pathCells:[],fillCells:[],jointLayout:{planes:[{id:'body',colors:['#CC9977'],route:[18,26,34]}]}}];
 assert.equal(auditMaterialSurfaces(image,reports).status,'PASS');image.data.writeUInt32BE(0x222222ff,26*4);assert.equal(auditMaterialSurfaces(image,reports).status,'FAIL');
});
test('no new observation keeps the existing route empty rather than inventing lines',()=>{const f=fixture();f.material.plan.lineLayouts=[];const r=run(f);assert.equal(r.domain.size,0);assert.equal(r.lines.size,0);});
test('saved audit retains the declared pigment of each boundary',()=>{const im=new PNG({width:2,height:1});im.data.writeUInt32BE(0x222222ff,0);im.data.writeUInt32BE(0x774433ff,4);const r=[{id:'two-pigments',colors:[],fillCells:[],pathCells:[0,1],contourColor:'#222222',pathColors:[[0,'#222222'],[1,'#774433']]}];assert.equal(auditMaterialSurfaces(im,r).status,'PASS');im.data.writeUInt32BE(0x222222ff,4);assert.equal(auditMaterialSurfaces(im,r).status,'FAIL');});
console.log(JSON.stringify({passed:count,scope:'Joint allocation mechanics only; visual inspection remains required.'}));
