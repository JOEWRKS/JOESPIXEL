#!/usr/bin/env node
'use strict';
// Material regions from an observed material table. The agent observes WHICH palette colours
// form each material; this tool only decides WHERE: flat source pixels seed their material, and
// transition pixels (antialias between a fill and its outline) take the material of the nearest
// flat area instead of whichever palette colour happens to be closest in RGB. A connected flat
// area is assigned as a whole by the majority of its unshared colours. Output is the
// materialPlan.regions list (row runs in source space) plus a map PNG to compare with the source.
// It is a spatial helper, not semantic recognition: wrong tables give wrong regions.
// The output {regions, inventory} goes into materialPlan; every region is listed under its
// material so the inventory check stays executable.
//
// node scripts/derive-material-regions.cjs --source S.png --palette P.json --materials M.json
//   --out regions.json --map map.png [--flat 12]
// M.json: [{"material":"skin","colors":["#FECAA5","#A37158"],"baseColor":"#FECAA5","observation":"..."}]
// A line material may list observed lineMarks: thin source lines (a nose tick, a brow, a crease)
// whose core is never flat at this resolution, so flat seeding alone hands every pixel of them to
// the surrounding fill. Inside each declared sourceRegion, pixels nearer the observed line
// samples than the context samples seed the line material. The observer declares the marks;
// the tool never searches for them.
//   "lineMarks":[{"name":"nose","sourceRegion":[x,y,w,h],"samples":[[r,g,b]],"contextSamples":[[r,g,b]],"observation":"..."}]
const fs=require('node:fs');
const {PNG}=require(require.resolve('pngjs',{paths:[__dirname,process.cwd()]}));
const {parsePalette}=require('./build-palette-native.cjs');
const {sourceStrokeClassifier}=require('./raster-observed-details.cjs');

function derive(source,palette,materials,{flat=12}={}){
 // A colour may serve several materials (a white top and an eye white, a shirt shadow and
 // steel). Shared colours never seed: their pixels take the material of the surrounding
 // unshared seeds, so ownership follows position, not RGB.
 const hex=new Map(palette.map((p,i)=>[p.hex,i])),owners=palette.map(()=>[]);
 if(new Set(materials.map(m=>m.material)).size!==materials.length)throw Error('Duplicate material name');
 materials.forEach((m,mi)=>{if(!m.material||!Array.isArray(m.colors)||!m.colors.length||!m.colors.includes(m.baseColor))throw Error('Material needs name, colours and a base colour from them: '+JSON.stringify(m.material));
  for(const c of m.colors){const i=hex.get(c);if(i===undefined)throw Error('Material colour not in palette: '+c);owners[i].push(mi);}});
 const unowned=palette.filter((p,i)=>!owners[i].length).map(p=>p.hex);if(unowned.length)throw Error('Palette colours without a material: '+unowned.join(','));
 const owner=owners.map(o=>o.length===1?o[0]:-1);
 const unseeded=materials.filter((m,mi)=>!m.colors.some(c=>owner[hex.get(c)]===mi)).map(m=>m.material);
 if(unseeded.length)throw Error('Material has no unshared colour to seed from: '+unseeded.join(','));
 const w=source.width,h=source.height,d=source.data,rgb=palette.map(p=>p.rgb),label=new Int16Array(w*h).fill(-1);
 const diff=(i,j)=>Math.abs(d[i]-d[j])+Math.abs(d[i+1]-d[j+1])+Math.abs(d[i+2]-d[j+2]);
 const nearest=i=>{let best=0,bd=Infinity;for(let k=0;k<rgb.length;k++){const c=rgb[k],e=(d[i]-c[0])**2+(d[i+1]-c[1])**2+(d[i+2]-c[2])**2;if(e<bd){bd=e;best=k;}}return best;};
 const isFlat=new Uint8Array(w*h);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(y*w+x)*4;let ok=true;for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){const a=x+dx,b=y+dy;if(a<0||b<0||a>=w||b>=h)continue;if(diff(i,(b*w+a)*4)>flat){ok=false;break;}}isFlat[y*w+x]=ok?1:0;}
 // Each connected flat area votes once: neighbouring materials with nearly equal colours (a
 // leather pouch and a hair tone) cannot leave speckles of the wrong material inside it.
 const seen=new Uint8Array(w*h),queue=[];let areas=0;
 for(let s=0;s<w*h;s++){if(!isFlat[s]||seen[s])continue;const area=[s];seen[s]=1;
  for(let q=0;q<area.length;q++){const p=area[q],x=p%w,y=Math.floor(p/w);for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){const a=x+dx,b=y+dy;if(a<0||b<0||a>=w||b>=h)continue;const n=b*w+a;if(isFlat[n]&&!seen[n]&&diff(p*4,n*4)<=flat){seen[n]=1;area.push(n);}}}
  const votes=new Map();for(const p of area){const o=owner[nearest(p*4)];if(o>=0)votes.set(o,(votes.get(o)||0)+1);}
  if(!votes.size)continue;areas++;const m=[...votes].sort((a,b)=>b[1]-a[1]||a[0]-b[0])[0][0];for(const p of area){label[p]=m;queue.push(p);}}
 const lineMarks=[];
 materials.forEach((m,mi)=>{if(m.lineMarks===undefined)return;if(!Array.isArray(m.lineMarks)||!m.lineMarks.length)throw Error('lineMarks must be a non-empty list: '+m.material);
  for(const mark of m.lineMarks){const [x0,y0,rw,rh]=mark.sourceRegion??[];
   if(!mark.name||!mark.observation||![x0,y0,rw,rh].every(Number.isSafeInteger)||x0<0||y0<0||rw<1||rh<1||x0+rw>w||y0+rh>h)throw Error('Line mark needs name, observation and a source region inside the source: '+JSON.stringify(mark.name));
   const isLine=sourceStrokeClassifier(mark);let pixels=0;
   for(let y=y0;y<y0+rh;y++)for(let x=x0;x<x0+rw;x++){const p=y*w+x;if(!isLine([d[p*4],d[p*4+1],d[p*4+2]]))continue;if(label[p]!==mi){label[p]=mi;queue.push(p);}pixels++;}
   if(!pixels)throw Error('Line mark has no source pixels nearer its samples than its context: '+mark.name);
   lineMarks.push({material:m.material,name:mark.name,pixels});}});
 if(!queue.length)throw Error('Source has no flat pixels to seed materials');
 for(let q=0;q<queue.length;q++){const p=queue[q],x=p%w,y=Math.floor(p/w);for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){const a=x+dx,b=y+dy;if(a<0||b<0||a>=w||b>=h)continue;const n=b*w+a;if(label[n]<0){label[n]=label[p];queue.push(n);}}}
 const regions=[],counts=materials.map(()=>0);
 for(let y=0;y<h;y++){let x=0;while(x<w){const m=label[y*w+x];let e=x+1;while(e<w&&label[y*w+e]===m)e++;const mat=materials[m];
  regions.push({id:`${mat.material}-${counts[m]++}`,material:mat.material,polygon:[[x,y],[e,y],[e,y+1],[x,y+1]],colors:mat.colors,baseColor:mat.baseColor,boundaryRoles:[],observation:mat.observation??'Material table observation; each connected flat area votes once and transition pixels take the nearest area.'});x=e;}}
 const map=new PNG({width:w,height:h});for(let p=0;p<w*h;p++){const c=rgb[hex.get(materials[label[p]].baseColor)];map.data.set([...c,255],p*4);}
 const inventory=materials.map(m=>({id:m.material,decision:'assigned',regionIds:regions.filter(r=>r.material===m.material).map(r=>r.id),observation:m.observation??'Material table observation.'})).filter(i=>i.regionIds.length);
 return {regions,inventory,map,lineMarks,summary:materials.map((m,i)=>({material:m.material,rows:counts[i],pixels:label.reduce((s,v)=>s+(v===i),0)}))};
}
module.exports={derive};

if(require.main===module){
 const a=process.argv.slice(2),o={};for(let i=0;i<a.length;i+=2)o[a[i].replace(/^--/,'')]=a[i+1];
 for(const k of ['source','palette','materials','out','map'])if(!o[k])throw Error('Missing --'+k);
 const r=derive(PNG.sync.read(fs.readFileSync(o.source)),parsePalette(JSON.parse(fs.readFileSync(o.palette))),JSON.parse(fs.readFileSync(o.materials)),{flat:o.flat?+o.flat:12});
 fs.writeFileSync(o.out,JSON.stringify({regions:r.regions,inventory:r.inventory})+'\n',{flag:'wx'});fs.writeFileSync(o.map,PNG.sync.write(r.map),{flag:'wx'});
 console.log(JSON.stringify({regions:r.regions.length,lineMarks:r.lineMarks,materials:r.summary},null,1));
}
