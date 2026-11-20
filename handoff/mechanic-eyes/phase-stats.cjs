'use strict';
// Grid-phase stability: shift the source 0..7 px on both axes (64 phases), place the
// eyes with the same observations, and count distinct per-eye role-cell signatures.
// Usage: node phase-stats.cjs <full 1024x1536 source PNG> [placement]
const W=require('path').join(__dirname,'..','..')+'/';
const fs=require('fs'),{PNG}=require(W+'node_modules/pngjs');
const {buildNative,parsePalette}=require(W+'scripts/build-palette-native.cjs');
const c=JSON.parse(fs.readFileSync(__dirname+'/case.json')),pal=parsePalette(c.palette);
const src=PNG.sync.read(fs.readFileSync(process.argv[2])),placement=process.argv[3]||c.rimInRing.placement;
const shift=(p,dx,dy)=>{const q=JSON.parse(JSON.stringify(p));q.placement=placement;for(const e of q.eyes){e.rect=[e.rect[0]+dx,e.rect[1]+dy,e.rect[2],e.rect[3]];const sp=a=>a.map(([x,y])=>[x+dx,y+dy]);if(e.sourcePolygon)e.sourcePolygon=sp(e.sourcePolygon);for(const pt of e.partitions??[])pt.sourcePolygon=sp(pt.sourcePolygon);}return q;};
const sig=new Map(),core=new Map(),blocked=[];
for(let dy=0;dy<8;dy++)for(let dx=0;dx<8;dx++){
 const face=new PNG({width:192,height:128});for(let y=0;y<128;y++)for(let x=0;x<192;x++){const i=((128-dy+y)*1024+(384-dx+x))*4;face.data.set(src.data.subarray(i,i+4),(y*192+x)*4);}
 try{const r=buildNative(PNG,face,pal,24,16,c.background,'source-region-area',null,null,null,shift(c.rimInRing,dx,dy));
  for(const e of r.eyePolicyReport.eyes){const k=e.name+' '+e.roles.map(o=>o.name+':'+o.nativeCells).join(' ');if(!sig.has(e.name))sig.set(e.name,new Map());const m=sig.get(e.name);m.set(k,(m.get(k)||0)+1);
   // Core structure: iris, pupil and reflection cells only (the lid and sclera rims follow the curved outline).
   const ck=e.roles.filter(o=>o.family==='iris').map(o=>o.name+':'+o.nativeCells).join(' ');if(!core.has(e.name))core.set(e.name,new Map());core.get(e.name).set(ck,(core.get(e.name).get(ck)||0)+1);}}
 catch(e){blocked.push([dx,dy,e.message.slice(0,90)]);}
}
console.log('placement',placement,'blocked',blocked.length,'of 64');for(const b of blocked.slice(0,3))console.log('  blocked',JSON.stringify(b));
for(const [name,m] of core)console.log(name,'core signatures',m.size,JSON.stringify([...m]));
for(const [name,m] of sig){console.log(name,'distinct signatures',m.size);for(const [k,n] of [...m].sort((a,b)=>b[1]-a[1]).slice(0,4))console.log('  ',n,k.slice(name.length+1));}
