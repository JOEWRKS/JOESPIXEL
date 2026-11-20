'use strict';
// Eye construction placement: grid-phase stability on a real face crop and the
// construction rules on a synthetic eye. Mechanics only; not artwork approval.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PNG}=require(require.resolve('pngjs',{paths:[__dirname,process.cwd()]}));
const {buildNative,parsePalette}=require('./build-palette-native.cjs');
const {place}=require('./eye-construction.cjs');
let passed=0;const test=(name,fn)=>{fn();passed++;console.log('PASS '+name);};

test('a measured length keeps its rounded size wherever it falls between grid lines',()=>{
 for(let s=0;s<1;s+=.125){assert.equal(place(2+s,4.75+s).n,3);assert.equal(place(5+s,5.2+s).n,1);}
});

// Synthetic eye on 8px cells: lid y8-16, opening y16-48, white x8-40, iris x40-72 touching the
// right corner (no sclera there), dark iris top, pupil x52-60, glint x44-48.
const syn=()=>{const s=new PNG({width:96,height:64}),put=(x0,y0,x1,y1,c)=>{for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++)s.data.set([...c,255],(y*96+x)*4);};
 put(0,0,96,64,[254,202,165]);put(8,8,72,16,[21,13,10]);put(8,16,40,48,[250,237,230]);put(40,16,72,32,[34,77,41]);put(40,32,72,48,[73,146,70]);put(52,20,60,40,[21,13,10]);put(44,20,48,26,[243,245,244]);return s;};
const role=(name,family,geometry,color,rgb,extra={})=>({name,family,geometry,color,colors:[color],samples:[rgb],...extra});
const synPolicy={version:1,visibility:'visible',placement:'source-construction',geometryPolicy:'source-stroke-fill',observation:'Synthetic eye.',eyes:[{name:'eye',rect:[0,0,96,64],reflection:'if-room',sourcePolygon:[[8,8],[72,8],[72,48],[8,48]],baseRoles:['lid'],
 partitions:[{name:'white',observation:'Sclera left of the iris.',sourcePolygon:[[8,16],[40,16],[40,48],[8,48]],roles:['white']},{name:'iris',observation:'Iris to the right corner.',sourcePolygon:[[40,16],[72,16],[72,48],[40,48]],roles:['iris','iris-dark','pupil','light']}],
 roles:[role('lid','lid','stroke','#150D0A',[21,13,10],{width:1,closed:false,thickness:'source'}),role('white','white','fill','#FAEDE6',[250,237,230]),role('iris','iris','fill','#499246',[73,146,70]),role('iris-dark','iris','fill','#224D29',[34,77,41],{required:false}),role('pupil','iris','fill','#150D0A',[21,13,10],{protect:true}),role('light','iris','feature','#F3F5F4',[243,245,244],{required:false})]}]};
const synPalette=parsePalette({colors:['#FECAA5','#150D0A','#FAEDE6','#499246','#224D29','#F3F5F4']});
test('construction keeps sclera only where observed and places pupil and glint inside the iris',()=>{
 const r=buildNative(PNG,syn(),synPalette,12,8,'#FECAA5','source-region-area',null,null,null,synPolicy),img=r.image;
 const at=(x,y)=>'#'+[0,1,2].map(k=>img.data[(y*12+x)*4+k].toString(16).padStart(2,'0')).join('').toUpperCase();
 const where=hex=>{const out=[];for(let y=0;y<8;y++)for(let x=0;x<12;x++)if(at(x,y)===hex)out.push([x,y]);return out;};
 assert(where('#FAEDE6').every(([x])=>x>=1&&x<=4),'white only left of the iris '+JSON.stringify(where('#FAEDE6')));
 assert(where('#FAEDE6').length>=12,'white keeps its four columns');
 for(const hex of ['#499246','#224D29','#F3F5F4'])assert(where(hex).every(([x,y])=>x>=5&&x<=8&&y>=2&&y<=5),hex+' inside the iris box');
 assert.deepEqual([...new Set(where('#150D0A').filter(([,y])=>y===1).map(([x])=>x))].length>=7,true);
 const glint=where('#F3F5F4'),pupil=where('#150D0A').filter(([x,y])=>y>=2&&x>=5);
 assert.equal(glint.length,1);assert(pupil.length>=1);assert(glint[0][0]<Math.min(...pupil.map(([x])=>x)),'glint stays on the observed side of the pupil');
 assert(where('#224D29').some(([,y])=>y===2)&&where('#499246').some(([,y])=>y===5),'dark iris on top, light below');
 const e=r.eyePolicyReport.eyes[0];assert.equal(e.placement,'source-construction');assert(e.decisions.some(d=>/right side has no sclera/.test(d)));
});

// Real crop, 64 grid phases (0..7 px on both axes), same observations.
const dir=path.join(__dirname,'..','handoff','mechanic-eyes'),c=JSON.parse(fs.readFileSync(path.join(dir,'case.json')));
const face=PNG.sync.read(fs.readFileSync(path.join(dir,'face.png'))),pal=parsePalette(c.palette);
test('the real eyes keep their iris structure across grid phases',()=>{
 // face.png is x384-576, y128-256 of the source; a phase shift crops a few pixels earlier, so
 // the crop is padded from its own edge pixels (the eyes are far from the edges).
 const shifted=(dx,dy)=>{const s=new PNG({width:192,height:128});for(let y=0;y<128;y++)for(let x=0;x<192;x++){const sx=Math.max(0,x-dx),sy=Math.max(0,y-dy),i=(sy*192+sx)*4;s.data.set(face.data.subarray(i,i+4),(y*192+x)*4);}return s;};
 const policy=(dx,dy)=>{const q=JSON.parse(JSON.stringify(c.rimInRing));q.placement='source-construction';for(const e of q.eyes){e.rect=[e.rect[0]+dx,e.rect[1]+dy,e.rect[2],e.rect[3]];const sp=a=>a.map(([x,y])=>[x+dx,y+dy]);e.sourcePolygon=sp(e.sourcePolygon);for(const p of e.partitions)p.sourcePolygon=sp(p.sourcePolygon);}return q;};
 const sig=new Map();
 for(let dy=0;dy<8;dy++)for(let dx=0;dx<8;dx++){const r=buildNative(PNG,shifted(dx,dy),pal,24,16,c.background,'source-region-area',null,null,null,policy(dx,dy));
  for(const e of r.eyePolicyReport.eyes){const n=name=>e.roles.find(o=>o.name===name).nativeCells;if(!sig.has(e.name))sig.set(e.name,[]);sig.get(e.name).push([n('iris'),n('iris-dark'),n('pupil'),n('light')]);}}
 for(const [name,list] of sig){
  // Pupil, glint and light iris are identical in all 64 phases; a sloping lid may take at most one dark iris cell.
  for(const k of [0,2,3])assert.equal(new Set(list.map(v=>v[k])).size,1,name+' role '+k+' varies: '+JSON.stringify([...new Set(list.map(v=>v.join('/')))]));
  const dark=list.map(v=>v[1]);assert(Math.max(...dark)-Math.min(...dark)<=1,name+' dark iris varies by more than one cell');
 }
});
console.log(JSON.stringify({passed,scope:'Construction rules and grid-phase stability; visual review still required.'}));
