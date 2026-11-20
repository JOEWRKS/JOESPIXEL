#!/usr/bin/env node
'use strict';
// Stage-4 capacity probes: the same source, canvas, palette and method for every candidate
// grid; only the native count differs. Writes native / expanded / outlineMask PNGs and a JSON
// list of file evidence for selection.candidates. Probes are capacity evidence, not drafts.
//
// node scripts/capacity-probe.cjs --source S.png --palette P.json --out DIR
//   --background "#RRGGBB" --ink "#RRGGBB[,#RRGGBB]" 128x192 64x96 ...
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {PNG}=require(require.resolve('pngjs',{paths:[__dirname,process.cwd()]}));
const {parsePalette}=require('./build-palette-native.cjs');
const {thinMask}=require('./refine-structure.cjs');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');

function probe(source,palette,{background,ink,candidates}){
 const bg=palette.findIndex(p=>p.hex===background);if(bg<0)throw Error('Background must be a palette colour');
 const inkSet=new Set(ink.map(h=>{const i=palette.findIndex(p=>p.hex===h);if(i<0)throw Error('Ink colour not in palette: '+h);return i;}));
 if(inkSet.has(bg))throw Error('Ink cannot be the background');
 const sw=source.width,sh=source.height,idx=new Uint8Array(sw*sh),rgb=palette.map(p=>p.rgb);
 for(let p=0;p<sw*sh;p++){const i=p*4;if(source.data[i+3]<128){idx[p]=bg;continue;}let b=0,bd=Infinity;for(let j=0;j<rgb.length;j++){const c=rgb[j],d=(source.data[i]-c[0])**2+(source.data[i+1]-c[1])**2+(source.data[i+2]-c[2])**2;if(d<bd){bd=d;b=j;}}idx[p]=b;}
 return candidates.map(([nw,nh])=>{
  const cell=sw/nw;if(!Number.isInteger(cell)||sh/nh!==cell)throw Error(`Canvas ${sw}x${sh} is not divisible by ${nw}x${nh}`);
  const counts=Array.from({length:nw*nh},()=>new Float64Array(palette.length));
  for(let y=0;y<sh;y++){const gy=Math.floor(y/cell);for(let x=0;x<sw;x++)counts[gy*nw+Math.floor(x/cell)][idx[y*sw+x]]++;}
  const fill=new Int16Array(nw*nh),inkKeys=[];
  counts.forEach((c,k)=>{const tot=cell*cell;if(c[bg]/tot>=.5){fill[k]=bg;return;}
   let b=-1,bv=-1;for(let j=0;j<palette.length;j++)if(j!==bg&&!inkSet.has(j)&&c[j]>bv){bv=c[j];b=j;}fill[k]=b<0?[...inkSet][0]:b;
   if([...inkSet].reduce((s,j)=>s+c[j],0)/tot>=.3)inkKeys.push(k);});
  // One-dot ink allocation: thinned observed ink plus every figure cell touching background.
  const line=new Set(thinMask(inkKeys,nw)),inkColor=[...inkSet][0];
  for(let k=0;k<nw*nh;k++){if(fill[k]===bg)continue;const x=k%nw,y=Math.floor(k/nw);if([[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy])=>{const a=x+dx,b=y+dy;return a>=0&&b>=0&&a<nw&&b<nh&&fill[b*nw+a]===bg;}))line.add(k);}
  const native=new PNG({width:nw,height:nh}),mask=new PNG({width:nw,height:nh}),expanded=new PNG({width:sw,height:sh});
  for(let k=0;k<nw*nh;k++){const c=line.has(k)?inkColor:fill[k];native.data.set([...palette[c].rgb,255],k*4);mask.data.set(line.has(k)?[255,255,255,255]:[0,0,0,255],k*4);}
  for(let y=0;y<sh;y++)for(let x=0;x<sw;x++){const k=Math.floor(y/cell)*nw+Math.floor(x/cell);expanded.data.set(native.data.subarray(k*4,k*4+4),(y*sw+x)*4);}
  return {id:`n${nw}x${nh}`,grid:{canvas:[sw,sh],native:[nw,nh],cell,origin:[0,0]},images:{native,expanded,outlineMask:mask},inkCells:line.size,outlineColors:[palette[inkColor].hex]};
 });
}
module.exports={probe};

if(require.main===module){
 const args=process.argv.slice(2),opt={},sizes=[];
 for(let i=0;i<args.length;i++){if(args[i].startsWith('--'))opt[args[i].slice(2)]=args[++i];else sizes.push(args[i]);}
 for(const k of ['source','palette','out','background','ink'])if(!opt[k])throw Error('Missing --'+k);
 if(!sizes.length)throw Error('List at least one candidate such as 128x192');
 const source=PNG.sync.read(fs.readFileSync(opt.source)),palette=parsePalette(JSON.parse(fs.readFileSync(opt.palette)));
 const results=probe(source,palette,{background:opt.background.toUpperCase(),ink:opt.ink.toUpperCase().split(','),candidates:sizes.map(s=>s.split('x').map(Number))});
 fs.mkdirSync(opt.out,{recursive:true});
 const report=results.map(r=>{const files={};for(const [name,image] of Object.entries(r.images)){const bytes=PNG.sync.write(image),p=path.resolve(opt.out,`${r.id}-${name}.png`);fs.writeFileSync(p,bytes,{flag:'wx'});files[name]={path:p,sha256:hash(bytes)};}
  return {id:r.id,grid:r.grid,...files,outlineWidth:1,outlineColors:r.outlineColors,inkCells:r.inkCells,status:'UNVERIFIED',observation:'Probe written; inspect expanded PNG and boundaries before any verdict.'};});
 fs.writeFileSync(path.resolve(opt.out,'probe-report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify(report.map(r=>({id:r.id,cell:r.grid.cell,inkCells:r.inkCells})),null,1));
}
