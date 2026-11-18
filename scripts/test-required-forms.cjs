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
 assert.deepEqual(clipped.report.features[0].edges,['left']);
});
test('an adjacent colour missing from contextSamples is named as the clipping edge',()=>{
 // Mouth-like fixture: a dark line sits on a lip tone darker than skin. With
 // only skin as context the lip is classified as ink and reaches the window.
 const lip=0x763f36ff,source=fill(128,64,skin),base=fill(16,8,skin);rect(source,8,28,64,12,lip);rect(source,20,30,32,2,ink);
 const region=[12,20,50,16],line={...feature,sourceRegion:region};
 const skinOnly=allocateRequiredForms(PNG,source,base,grid,palette,policy([line]));
 assert.equal(skinOnly.report.features[0].action,'search-region-clips-source');assert.deepEqual(skinOnly.report.features[0].edges,['left','right','bottom']);
 assert.throws(()=>buildNative(PNG,source,palette,16,8,'#FFF7E6','area-vote',null,null,null,null,policy([line])),/search-region-clips-source at left\/right\/bottom edge/);
 const both=allocateRequiredForms(PNG,source,base,grid,palette,policy([{...line,contextSamples:[[197,131,78],[118,63,54]]}]));
 assert.deepEqual(both.report.unresolved,[]);
});

test('conversion stops at a missing required form before later passes can look successful',()=>{
 const source=fill(128,64,skin),stages=[];
 assert.throws(()=>buildNative(PNG,source,palette,16,8,'#FFF7E6','area-vote',null,null,null,null,policy([feature]),null,null,e=>stages.push(e.stage)),/Required source forms unresolved/);
 assert(stages.includes('required-forms'),'Keep evidence of the failing stage');
 assert(!stages.includes('eye-placement'),'Do not continue after a required form failure');
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
test('source-path retains a thick bent open stroke without thickening its fill',()=>{
 const source=fill(128,64,skin);rect(source,18,18,7,22,ink);rect(source,18,33,40,7,ink);rect(source,51,18,7,22,ink);
 const curve={version:1,axis:'y',observation:'Two observed ends and the flat lower bend of the source U.',landmarks:[{name:'start',kind:'endpoint',sourceRegion:[16,16,14,14]},{name:'low bend',kind:'max',sourceRegion:[25,30,24,13]},{name:'end',kind:'endpoint',sourceRegion:[49,16,13,14]}]};
 const base=buildNative(PNG,source,palette,16,8,'#FFF7E6','area-vote').image,p={version:1,placement:'source-path',features:[{...feature,curve}]},a=allocateRequiredForms(PNG,source,base,grid,palette,p);
 assert.deepEqual(a.report.unresolved,[]);assert.equal(a.report.features[0].action,'source-path-and-adjacent-fill');assert.deepEqual(a.report.features[0].nativeTopology,{components:1,holes:0});
 const points=[];for(let q=0;q<128;q++){if(a.image.data.readUInt32BE(q*4)===ink)points.push(q);if(q%16<1||q%16>=9||Math.floor(q/16)<1||Math.floor(q/16)>=6)assert.equal(a.image.data.readUInt32BE(q*4),base.data.readUInt32BE(q*4));}
 assert(new Set(points.map(q=>Math.floor(q/16))).size>=2);assert(new Set(points.map(q=>q%16)).size>=4);assert.equal(inspect(a.image,palette).offPalettePixels,0);
 const saved=PNG.sync.read(PNG.sync.write(a.image));assert(allocateRequiredForms(PNG,source,saved,grid,palette,p).image.data.equals(saved.data));
});
test('vacated source-path ink retains two different adjacent material tones',()=>{
 const source=fill(128,64,skin),shade=0x763f36ff;rect(source,40,0,88,64,shade);rect(source,18,18,8,22,ink);rect(source,18,32,40,8,ink);rect(source,50,18,8,22,ink);
 const curve={version:1,axis:'y',observation:'Source U crosses two material tones.',landmarks:[{name:'start',kind:'endpoint',sourceRegion:[16,16,14,14]},{name:'low bend',kind:'max',sourceRegion:[25,30,24,13]},{name:'end',kind:'endpoint',sourceRegion:[49,16,13,14]}]};
 const f={...feature,curve,contextSamples:[[197,131,78],[118,63,54]]},p={version:1,placement:'source-path',features:[f]},base=buildNative(PNG,source,palette,16,8,'#FFF7E6','area-vote').image,r=allocateRequiredForms(PNG,source,base,grid,palette,p);
 assert.deepEqual(r.report.unresolved,[]);let restoredShade=0;
 const touched=new Set();for(let q=0;q<128*64;q++)if(source.data.readUInt32BE(q*4)===ink)touched.add(Math.floor(q/128/8)*16+Math.floor(q%128/8));
 for(const q of touched)if(q%16>=5&&r.image.data.readUInt32BE(q*4)!==ink){assert.equal(r.image.data.readUInt32BE(q*4),shade);restoredShade++;}
 assert(restoredShade>0);
});
test('unobserved skeleton terminal is not protected as part of an open seam',()=>{
 const {planObservedCurve}=require('./raster-source-ink-paths.cjs'),mask=new Set();for(let x=16;x<=96;x++)mask.add(32*128+x);for(let y=32;y<=42;y++)mask.add(y*128+56);
 const curve={version:1,axis:'y',observation:'Straight seam; lower attached spur is not a semantic turn.',landmarks:[{name:'start',kind:'endpoint',sourceRegion:[12,28,10,10]},{name:'end',kind:'endpoint',sourceRegion:[90,28,12,10]}]},fixed=planObservedCurve(mask,128,64,grid,16,8,curve);
 assert(fixed.curve.ignoredSkeletonEndpoints===1);assert([...fixed.cells].every(p=>Math.floor(p/16)===4));assert.equal(fixed.cells.size,11);
 assert.throws(()=>planObservedCurve(mask,128,64,grid,16,8,{...curve,target:[3,3]}),/Observed curve/);
});
test('required source-path cannot silently use unobserved endpoints',()=>{const s=fill(128,64,skin),base=fill(16,8,skin);rect(s,16,25,40,2,ink);assert.throws(()=>allocateRequiredForms(PNG,s,base,grid,palette,{version:1,placement:'source-path',features:[feature]}),/observed curve landmarks/);});
test('two bends and a central crest are jointly retained without branches, also after transpose',()=>{
 const {planObservedCurve}=require('./raster-source-ink-paths.cjs'),points=[[18,16],[18,34],[28,46],[44,46],[60,22],[76,46],[96,46],[110,26]],mask=new Set();
 for(let y=0;y<64;y++)for(let x=0;x<128;x++)for(let i=1;i<points.length;i++){const[a,b]=points[i-1],[c,d]=points[i],t=Math.max(0,Math.min(1,((x-a)*(c-a)+(y-b)*(d-b))/((c-a)**2+(d-b)**2)));if(Math.hypot(x-a-t*(c-a),y-b-t*(d-b))<=3){mask.add(y*128+x);break;}}
 const curve={version:1,axis:'y',observation:'Two source bends separated by a raised central cusp.',landmarks:[{name:'start',kind:'endpoint',sourceRegion:[12,10,14,16]},{name:'first bend',kind:'max',sourceRegion:[28,40,18,13]},{name:'crest',kind:'min',sourceRegion:[54,16,14,18]},{name:'second bend',kind:'max',sourceRegion:[78,40,18,13]},{name:'end',kind:'endpoint',sourceRegion:[102,20,15,14]}]};
 for(const transpose of[false,true])for(const smooth of[false,true]){
  const sw=transpose?64:128,sh=transpose?128:64,nw=sw/8,nh=sh/8,m=transpose?new Set([...mask].map(p=>p%128*64+Math.floor(p/128))):mask,c=structuredClone(curve);if(transpose){c.axis='x';c.landmarks.forEach(v=>{const[x,y,w,h]=v.sourceRegion;v.sourceRegion=[y,x,h,w];});}
  if(smooth)c.flow='smooth';
  const g={x:Array.from({length:nw},(_,i)=>[i*8,(i+1)*8]),y:Array.from({length:nh},(_,i)=>[i*8,(i+1)*8])},r=planObservedCurve(m,sw,sh,g,nw,nh,c),marks=r.curve.landmarks;
  assert(marks[2].ordinate<marks[1].ordinate&&marks[2].ordinate<marks[3].ordinate);assert(marks[1].minimumRun>=2&&marks[3].minimumRun>=2);
  let ends=0;for(const p of r.cells){let neighbors=0;for(const q of r.cells)if(p!==q&&Math.max(Math.abs(p%nw-q%nw),Math.abs(Math.floor(p/nw)-Math.floor(q/nw)))===1)neighbors++;assert(neighbors<=2);if(neighbors===1)ends++;}assert.equal(ends,2);
 }
 const coarse={x:Array.from({length:4},(_,i)=>[i*32,(i+1)*32]),y:Array.from({length:2},(_,i)=>[i*32,(i+1)*32])};assert.throws(()=>planObservedCurve(mask,128,64,coarse,4,2,curve),/cannot|capacity|collapse/i);
});
test('smooth cap crossing a row does not force an extra endpoint step; explicit corners keep their extent',()=>{
 const {planObservedCurve}=require('./raster-source-ink-paths.cjs'),sw=64,sh=32,nw=16,nh=8,mask=new Set();
 for(let x=8;x<=36;x++){const y=23-Math.round((x-8)/5);mask.add(y*sw+x);mask.add((y+1)*sw+x);}
 const g={x:Array.from({length:nw},(_,i)=>[i*4,(i+1)*4]),y:Array.from({length:nh},(_,i)=>[i*4,(i+1)*4])};
 const curve={version:1,axis:'y',observation:'Shallow two-source-pixel seam; its left cap crosses the row boundary at y24.',landmarks:[{name:'start',kind:'endpoint',sourceRegion:[6,20,6,8]},{name:'end',kind:'endpoint',sourceRegion:[34,15,5,8]}]};
 const smooth=planObservedCurve(mask,sw,sh,g,nw,nh,{...curve,flow:'smooth'}),corner=planObservedCurve(mask,sw,sh,g,nw,nh,curve);
 assert.equal(Math.floor(smooth.curve.orderedCells[0]/nw),5,'centered cap must not protrude to the lower row');
 assert.equal(Math.floor(corner.curve.orderedCells[0]/nw),6,'unqualified corner cap keeps its observed extreme');
 const support=new Set([...mask].map(p=>Math.floor(p/sw/4)*nw+Math.floor(p%sw/4)));
 for(const result of [smooth,corner]){assert([...result.cells].every(p=>support.has(p)));assert.deepEqual(result.nativeTopology,{components:1,holes:0});assert.equal(result.cells.size,8);}
});
test('smooth shallow stroke jointly fits its cap and middle instead of adding a low terminal dot',()=>{
 const {planObservedCurve}=require('./raster-source-ink-paths.cjs');
 // Source-only raster fixture: a gentle rising seam with one trailing cap
 // pixel in the lower grid row. No destination pixels are supplied to it.
 const rows=['...............#######','...........###########','........##############','.....######...........','....#####.............','..#####...............','..####................','.##...................','.#....................'];
 const original=new Set();rows.forEach((row,y)=>[...row].forEach((v,x)=>{if(v==='#')original.add((y+8)*64+x+8);}));
 const baseCurve={version:1,axis:'y',flow:'smooth',observation:'A shallow rising seam; the thin outer cap is not a lower corner.',landmarks:[{name:'start',kind:'endpoint',sourceRegion:[6,12,7,7]},{name:'end',kind:'endpoint',sourceRegion:[24,6,8,7]}]};
 const g={x:Array.from({length:16},(_,i)=>[i*4,i*4+4]),y:Array.from({length:16},(_,i)=>[i*4,i*4+4])};
 for(const transpose of[false,true])for(const reflect of[false,true])for(const reverse of[false,true]){
  const transform=([x,y],size)=>{let p=transpose?[y,x]:[x,y];return reflect?[size-1-p[0],p[1]]:p;},m=new Set([...original].map(p=>{const[x,y]=transform([p%64,Math.floor(p/64)],64);return y*64+x;})),c=structuredClone(baseCurve);
  if(transpose)c.axis='x';c.landmarks.forEach(mark=>{const[x,y,a,b]=mark.sourceRegion,points=[[x,y],[x+a-1,y+b-1]].map(p=>transform(p,64)),xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);mark.sourceRegion=[Math.min(...xs),Math.min(...ys),Math.max(...xs)-Math.min(...xs)+1,Math.max(...ys)-Math.min(...ys)+1];});if(reverse)c.landmarks.reverse();
  const result=planObservedCurve(m,64,64,g,16,16,c),expected=new Set([[2,3],[3,3],[4,2],[5,2],[6,2],[7,2]].map(p=>{const[x,y]=transform(p,16);return y*16+x;}));
  assert.deepEqual(result.cells,expected,'Same source shape must survive transpose/reflection and observation order');assert.deepEqual(result.nativeTopology,{components:1,holes:0});
 }
});
test('centerline scoring keeps an observed small terminal bend instead of flattening it',()=>{
 const {planObservedCurve}=require('./raster-source-ink-paths.cjs'),rows=['............','............','............','............','..##........','..##........','..##........','..##........','..##........','..##........','.##.........','.###........','.###........','.###........','...###......','...###......'];
 const mask=new Set();rows.forEach((row,y)=>[...row].forEach((v,x)=>{if(v==='#')mask.add((y+9)*64+x+8);}));
 const g={x:Array.from({length:16},(_,i)=>[i*4,i*4+4]),y:Array.from({length:16},(_,i)=>[i*4,i*4+4])},curve={version:1,axis:'x',flow:'smooth',observation:'Vertical source shade with a real rightward terminal bend.',landmarks:[{name:'upper',kind:'endpoint',sourceRegion:[9,11,5,7]},{name:'tip',kind:'endpoint',sourceRegion:[11,22,8,6]}]};
 for(const reverse of[false,true]){const c=structuredClone(curve);if(reverse)c.landmarks.reverse();const r=planObservedCurve(mask,64,64,g,16,16,c);assert.deepEqual(r.cells,new Set([3*16+2,4*16+2,5*16+2,6*16+3]));assert.deepEqual(r.nativeTopology,{components:1,holes:0});}
});
test('a cap farther from its skeleton remains a supported candidate rather than losing the required seam',()=>{
 const {planObservedCurve}=require('./raster-source-ink-paths.cjs'),rows=['....................','....................','....................','...............#....','...............##...','..............###...','...........####.....','..........####......','........#####.......','......####..........','.#######............','.#####..............'];
 const mask=new Set();rows.forEach((row,y)=>[...row].forEach((v,x)=>{if(v==='#')mask.add((y+10)*64+x+8);}));
 const g={x:Array.from({length:16},(_,i)=>[i*4,i*4+4]),y:Array.from({length:16},(_,i)=>[i*4,i*4+4])},curve={version:1,axis:'y',flow:'smooth',observation:'Gentle seam rises to a short thicker cap.',landmarks:[{name:'left',kind:'endpoint',sourceRegion:[8,18,6,6]},{name:'right',kind:'endpoint',sourceRegion:[20,10,6,7]}]};
 const r=planObservedCurve(mask,64,64,g,16,16,curve);assert.equal(r.curve.orderedCells[0],5*16+2);assert.equal(r.curve.orderedCells.at(-1),3*16+6);assert.equal(r.cells.size,5);assert.deepEqual(r.nativeTopology,{components:1,holes:0});
});
console.log(count+' required-form tests passed');
