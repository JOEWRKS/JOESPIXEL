const assert=require('node:assert/strict');
const {PNG}=require(require.resolve('pngjs',{paths:[__dirname,process.cwd()]}));
const {buildNative,parsePalette,inspect}=require('./build-palette-native.cjs');
const {allocateRequiredForms}=require('./raster-observed-details.cjs');
const palette=parsePalette({colors:['#FFF7E6','#171923','#C5834E','#814C30','#763F36']});
const skin=0xc5834eff,ink=0x814c30ff,grid={x:Array.from({length:16},(_,i)=>[i*8,(i+1)*8]),y:Array.from({length:8},(_,i)=>[i*8,(i+1)*8])};
const fill=(w,h,c)=>{const p=new PNG({width:w,height:h});for(let i=0;i<w*h;i++)p.data.writeUInt32BE(c,i*4);return p;};
const rect=(im,x,y,w,h,c)=>{for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++)im.data.writeUInt32BE(c,(yy*im.width+xx)*4);};
const feature={name:'source stroke',kind:'stroke',priority:'required',sourceRegion:[8,8,64,40],color:'#814C30',samples:[[129,76,48]],contextSamples:[[197,131,78]],observation:'Visible narrow connected source mark'};
const policy=f=>({version:1,features:f});let count=0;const test=(name,f)=>{f();count++;console.log('PASS '+name);};
test('required thin form survives an area minority and save/readback',()=>{
 const source=fill(128,64,skin);rect(source,16,25,40,2,ink);
 const base=buildNative(PNG,source,palette,16,8,'#FFF7E6','area-vote');assert(!base.image.data.includes(Buffer.from([129,76,48,255])));
 const built=buildNative(PNG,source,palette,16,8,'#FFF7E6','area-vote',null,null,null,null,policy([feature]));
 const saved=PNG.sync.read(PNG.sync.write(built.image));assert.equal(built.formReport.unresolved.length,0);assert.equal(built.formReport.features[0].cells,5);assert.equal(inspect(saved,palette).offPalettePixels,0);
 assert(allocateRequiredForms(PNG,source,saved,grid,palette,policy([feature])).image.data.equals(saved.data));
 assert(source.data.equals((()=>{const p=fill(128,64,skin);rect(p,16,25,40,2,ink);return p;})().data));
});
test('source sloped path is connected without destination coordinates',()=>{
 const source=fill(128,64,skin),base=fill(16,8,skin);for(let x=16;x<56;x++)rect(source,x,20+Math.floor((x-16)/10),1,2,ink);
 const r=allocateRequiredForms(PNG,source,base,grid,palette,policy([feature]));const path=[];for(let p=0;p<128;p++)if(r.image.data.readUInt32BE(p*4)===ink)path.push([p%16,Math.floor(p/16)]);
 assert.equal(path.length,5);path.sort((a,b)=>a[0]-b[0]);for(let i=1;i<path.length;i++)assert(Math.abs(path[i][1]-path[i-1][1])<=1);
});
test('optional subcell shading is omitted but a required line is retained regardless of declaration order',()=>{
 const source=fill(128,64,skin);rect(source,16,25,40,2,ink);const base=fill(16,8,skin);rect(base,2,3,5,1,ink);
 const optional={...feature,name:'optional shade',priority:'optional'};
 const omitted=allocateRequiredForms(PNG,source,base,grid,palette,policy([optional]));assert(omitted.image.data.equals(fill(16,8,skin).data));
 const kept=allocateRequiredForms(PNG,source,base,grid,palette,policy([optional,feature]));assert(kept.image.data.equals(base.data));
});
test('names do not change rasterization, malformed destination fields are rejected',()=>{
 const source=fill(128,64,skin);rect(source,16,25,40,2,ink);const base=fill(16,8,skin);
 const a=allocateRequiredForms(PNG,source,base,grid,palette,policy([feature]));const b=allocateRequiredForms(PNG,source,base,grid,palette,policy([{...feature,name:'a completely different character'}]));assert(a.image.data.equals(b.image.data));
 assert.throws(()=>allocateRequiredForms(PNG,source,base,grid,palette,policy([{...feature,target:[3,3]}])),/output coordinates/);
});
test('clipped or absent mandatory source strokes remain unresolved, not fabricated',()=>{
 const source=fill(128,64,skin),base=fill(16,8,skin);const missing=allocateRequiredForms(PNG,source,base,grid,palette,policy([feature]));assert.deepEqual(missing.report.unresolved,[feature.name]);assert(missing.image.data.equals(base.data));
 rect(source,8,25,40,2,ink);const clipped=allocateRequiredForms(PNG,source,base,grid,palette,policy([feature]));assert.equal(clipped.report.features[0].action,'search-region-clips-source');
});
test('two comparable source marks are not silently collapsed into one required feature',()=>{
 const source=fill(128,64,skin),base=fill(16,8,skin);rect(source,16,20,40,2,ink);rect(source,16,35,40,2,ink);
 const r=allocateRequiredForms(PNG,source,base,grid,palette,policy([feature]));assert.deepEqual(r.report.unresolved,[feature.name]);assert(r.image.data.equals(base.data));
});
test('vacated stroke cleanup cannot erase a disconnected neighbouring feature with the same colour',()=>{
 const source=fill(128,64,skin),base=fill(16,8,skin);rect(source,16,25,40,2,ink);rect(source,65,10,2,2,ink);rect(base,8,1,1,1,ink);
 const r=allocateRequiredForms(PNG,source,base,grid,palette,policy([feature]));assert.equal(r.image.data.readUInt32BE((1*16+8)*4),ink);
 assert(allocateRequiredForms(PNG,source,r.image,grid,palette,policy([feature])).image.data.equals(r.image.data));
});
test('explicit continuous exterior fills missing outline without changing interior colours',()=>{
 const source=fill(128,64,0xfff7e6ff),base=fill(16,8,0xfff7e6ff);rect(source,24,16,72,32,skin);rect(base,3,2,9,4,skin);
 const p=policy([{name:'silhouette',kind:'exterior',priority:'required',color:'#171923',background:'#FFF7E6',observation:'Explicit outlined style'}]);const r=allocateRequiredForms(PNG,source,base,grid,palette,p);
 assert.equal(r.image.data.readUInt32BE((3*16+6)*4),skin);assert.equal(r.image.data.readUInt32BE((2*16+6)*4),0x171923ff);assert.equal(r.image.data.readUInt32BE(0),0xfff7e6ff);
 assert(allocateRequiredForms(PNG,source,r.image,grid,palette,p).image.data.equals(r.image.data));
});
test('incompatible stacked corrections cannot silently bypass form allocation',()=>{
 const source=fill(128,64,skin);assert.throws(()=>buildNative(PNG,source,palette,16,8,'#FFF7E6','nearest',null,null,null,null,policy([feature])),/plain area-vote/);
});
test('one-cell material loop survives when there is no room for a separate outline',()=>{
 const source=fill(128,64,0xfff7e6ff),base=fill(16,8,0xfff7e6ff);rect(base,4,2,6,1,skin);rect(base,4,5,6,1,skin);rect(base,4,2,1,4,skin);rect(base,9,2,1,4,skin);
 for(let y=0;y<64;y++)for(let x=0;x<128;x++)source.data.writeUInt32BE(base.data.readUInt32BE((Math.floor(y/8)*16+Math.floor(x/8))*4),(y*128+x)*4);
 const p=policy([{name:'any outlined subject',kind:'exterior',priority:'required',color:'#171923',background:'#FFF7E6',observation:'Single-cell loop retains its material silhouette'}]);
 const r=allocateRequiredForms(PNG,source,base,grid,palette,p);assert(r.image.data.equals(base.data));assert(r.report.features[0].materialOnlyCells>0);
});
test('exterior follows supplied clipped/offset source cells rather than a new full-image fit',()=>{
 const source=fill(128,64,0xfff7e6ff),base=fill(16,8,0xfff7e6ff);
 const offset={x:Array.from({length:16},(_,i)=>[i*8-16,(i+1)*8-16]),y:grid.y};
 rect(source,24,16,48,32,skin);rect(base,5,2,6,4,skin);
 const p=policy([{name:'silhouette',kind:'exterior',priority:'required',color:'#171923',background:'#FFF7E6',observation:'Reviewed offset lattice'}]);
 const r=allocateRequiredForms(PNG,source,base,offset,palette,p);
 for(let n=0;n<128;n++)assert.equal(r.image.data.readUInt32BE(n*4)===0xfff7e6ff,base.data.readUInt32BE(n*4)===0xfff7e6ff);
 assert.equal(r.image.data.readUInt32BE((2*16+5)*4),0x171923ff);
 assert(allocateRequiredForms(PNG,source,r.image,offset,palette,p).image.data.equals(r.image.data));
});
test('exterior-only policy validates lattice dimensions before modifying pixels',()=>{
 const source=fill(128,64,skin),base=fill(16,8,skin),p=policy([{name:'outline',kind:'exterior',priority:'required',color:'#171923',background:'#FFF7E6',observation:'explicit'}]);
 assert.throws(()=>allocateRequiredForms(PNG,source,base,{x:grid.x.slice(1),y:grid.y},palette,p),/dimensions differ/);
});
test('clipped trailing cell is not stretched into a different outline location',()=>{
 const source=fill(124,64,0xfff7e6ff),base=fill(16,8,0xfff7e6ff);
 const clipped={x:[...grid.x.slice(0,15),[120,124]],y:grid.y};
 rect(source,72,16,40,32,skin);rect(base,9,2,5,4,skin);
 const p=policy([{name:'shape',kind:'exterior',priority:'required',color:'#171923',background:'#FFF7E6',observation:'Last source cell is clipped, all earlier cells retain their pitch'}]);
 const r=allocateRequiredForms(PNG,source,base,clipped,palette,p);
 for(let n=0;n<128;n++)assert.equal(r.image.data.readUInt32BE(n*4)===0xfff7e6ff,base.data.readUInt32BE(n*4)===0xfff7e6ff);
 assert.equal(r.image.data.readUInt32BE((2*16+9)*4),0x171923ff);
});
test('whole source profile retains a shallow bend and both endpoints without a smile template',()=>{
 const source=fill(128,64,skin),base=fill(16,8,skin);
 for(let x=16;x<56;x++)rect(source,x,18+Math.min(5,x-16,55-x),1,2,ink);
 const r=allocateRequiredForms(PNG,source,base,grid,palette,policy([feature]));assert.equal(r.report.unresolved.length,0);
 const points=[];for(let n=0;n<128;n++)if(r.image.data.readUInt32BE(n*4)===ink)points.push([n%16,Math.floor(n/16)]);
 assert(new Set(points.map(p=>p[1])).size>1);assert.equal(points.length,5);
 assert(allocateRequiredForms(PNG,source,r.image,grid,palette,policy([feature])).image.data.equals(r.image.data));
});
console.log(count+' required-form tests passed');
