const W=require('path').join(__dirname,'..','..')+'/';
const fs=require('fs'),{PNG}=require(W+'node_modules/pngjs');
const {buildNative,parsePalette}=require(W+'scripts/build-palette-native.cjs');
const c=JSON.parse(fs.readFileSync(W+'handoff/mechanic-eyes/case.json')),pal=parsePalette(c.palette);
// Needs the full 1024x1536 source; pass its path as the first argument.
const src=PNG.sync.read(fs.readFileSync(process.argv[2]));
const L={'150D0A':'K','FAEDE6':'W','F3F5F4':'L','499246':'G','224D29':'D','FECAA5':'s','AD4E2B':'h','692E19':'H','9D4626':'h'};
const shiftPolicy=(p,dx,dy)=>{const q=JSON.parse(JSON.stringify(p));for(const e of q.eyes){e.rect=[e.rect[0]+dx,e.rect[1]+dy,e.rect[2],e.rect[3]];const sp=a=>a.map(([x,y])=>[x+dx,y+dy]);if(e.sourcePolygon)e.sourcePolygon=sp(e.sourcePolygon);for(const pt of e.partitions??[])pt.sourcePolygon=sp(pt.sourcePolygon);for(const r of e.roles){if(r.samplePoints)r.samplePoints=sp(r.samplePoints);if(r.attachedFill)r.attachedFill.sourcePolygon=sp(r.attachedFill.sourcePolygon);}}return q;};
const out=[];
for(const [dx,dy] of [[0,0],[2,0],[4,0],[6,0],[0,2],[0,4],[0,6],[3,3],[5,5]]){
 const face=new PNG({width:192,height:128});for(let y=0;y<128;y++)for(let x=0;x<192;x++){const i=((128-dy+y)*1024+(384-dx+x))*4;face.data.set(src.data.subarray(i,i+4),(y*192+x)*4);}
 let txt;try{const r=buildNative(PNG,face,pal,24,16,c.background,'source-region-area',null,null,null,shiftPolicy({...c.rimInRing,placement:process.env.PLACEMENT||c.rimInRing.placement},dx,dy));
  const rows=[];for(let y=2;y<=10;y++){let s='';for(let x=3;x<=21;x++){const i=(y*24+x)*4;s+=L[[0,1,2].map(k=>r.image.data[i+k].toString(16).padStart(2,'0')).join('').toUpperCase()]||'.';}rows.push(s);}
  txt=rows;}catch(e){txt=['BLOCKED: '+e.message.slice(0,110)];}
 out.push(['shift '+dx+','+dy,txt]);}
for(const [h,t] of out){console.log(h);console.log(t.join('\n'));}
