'use strict';
const assert=require('node:assert/strict');
const {PNG}=require(require.resolve('pngjs',{paths:[__dirname,process.cwd()]}));
const {parsePalette}=require('./build-palette-native.cjs');
const {rasterOutlineContour,inspectSavedOutline}=require('./raster-outline-contour.cjs');
const {allocateOnePixelOutline,inspectOnePixelOutline}=require('./raster-outline-contour.cjs');
const palette=parsePalette({colors:['#FFFFFF','#202020','#66AA88','#995533']});
const rgba=i=>parseInt(palette[i].hex.slice(1)+'ff',16),grid={x:Array.from({length:9},(_,i)=>[i*3,i*3+3]),y:Array.from({length:9},(_,i)=>[i*3,i*3+3])};
const rows=['000000000','011111110','013333310','013333310','011222210','013333310','013333310','011111110','000000000'];
function fixture(sourceCenter){
 const input=new PNG({width:9,height:9}),source=new PNG({width:27,height:27});
 for(let y=0;y<9;y++)for(let x=0;x<9;x++){
  const c=Number(rows[y][x]);input.data.writeUInt32BE(rgba(c),(y*9+x)*4);
  for(let yy=0;yy<3;yy++)for(let xx=0;xx<3;xx++)source.data.writeUInt32BE(rgba(x===2&&y===4?sourceCenter:c),((y*3+yy)*27+x*3+xx)*4);
 }return{input,source};
}
const target=4*9+2;
function run(center,operation='rebuild'){const f=fixture(center);return rasterOutlineContour(PNG,f.input,palette,'#FFFFFF',['#202020'],f.source,grid,{operation});}
const seam=run(1),stored=PNG.sync.read(PNG.sync.write(seam.image));
assert.equal(stored.data.readUInt32BE(target*4),rgba(1));assert(seam.report.preservedInternal.includes(target),'source-supported material seam retained');
const audit=inspectSavedOutline(stored,seam.mask,seam.depth,['#202020'],seam.report.preservedInternal);
assert.equal(audit.missingInternalLinePixels,0);assert(audit.preservedInternalLinePixels>0);
stored.data.writeUInt32BE(rgba(2),target*4);
assert.equal(inspectSavedOutline(stored,seam.mask,seam.depth,['#202020'],seam.report.preservedInternal).missingInternalLinePixels,1);
const fill=run(3);assert.equal(fill.image.data.readUInt32BE(target*4),rgba(3),'source brown wins over equally near green');
assert(!fill.report.preservedInternal.includes(target),'source material is not protected as a seam');
const absent=run(0);assert.equal(absent.image.data.readUInt32BE(target*4),rgba(1),'no source-supported fill: retain line and report');assert(absent.report.unsupportedFill.includes(target));
console.log('PASS: internal seam, source-driven fill, unsupported-fill reporting');
const thinSingle=run(3,'thin-only');
assert.equal(thinSingle.image.data.readUInt32BE(target*4),rgba(1),'thinning must not become local recoloring of a one-cell line');
assert(thinSingle.report.unprovenThickness.includes(target));

// A legitimate blue contour near a dark detail must not be painted black
// merely because both lie near the geometric silhouette.
{
 const p=parsePalette({colors:['#FFFFFF','#202020','#995533','#356BBD']}),im=new PNG({width:9,height:9}),source=new PNG({width:27,height:27});
 for(let y=0;y<9;y++)for(let x=0;x<9;x++){
  let color=0xffffffff;
  if(x>=1&&x<=7&&y>=1&&y<=7)color=x===1||x===7||y===1||y===7?0x356bbdff:0x995533ff;
  if(x===3&&y===3)color=0x202020ff;
  im.data.writeUInt32BE(color,(y*9+x)*4);
  for(let v=0;v<3;v++)for(let u=0;u<3;u++)source.data.writeUInt32BE(color,((y*3+v)*27+x*3+u)*4);
 }
 const args=[PNG,im,p,'#FFFFFF',['#202020'],source,grid];
 const thin=rasterOutlineContour(...args),paint=rasterOutlineContour(...args,{operation:'repaint-only'});
 assert(PNG.sync.read(PNG.sync.write(thin.image)).data.equals(im.data),'default must preserve legitimate colored borders');
 assert.equal(thin.report.operation,'thin-only');assert.equal(thin.report.outlined,0);
 assert(!paint.image.data.equals(im.data),'repaint must be explicit and independently executable');assert.equal(paint.report.filled,0);
 for(let i=0;i<81;i++)if(!paint.edge[i])assert.equal(paint.image.data.readUInt32BE(i*4),im.data.readUInt32BE(i*4),'repaint-only must leave interior unchanged');
 assert.throws(()=>rasterOutlineContour(...args,{operation:'typo'}),/Unknown contour operation/);
 console.log('PASS: colored outlines preserved by default; repaint-only is separate and explicit');
}

// A source-supported line can be a boundary within one material. Its
// continuation is evidence even when the materials have identical chroma.
{
 const f=fixture(1);
 for(let x=3;x<=6;x++){
  f.input.data.writeUInt32BE(rgba(1),(4*9+x)*4);
  for(let yy=12;yy<15;yy++)for(let xx=x*3;xx<x*3+3;xx++)f.source.data.writeUInt32BE(rgba(1),(yy*27+xx)*4);
 }
 // All remaining inward material is brown; no chromatic join can protect it.
 for(let y=0;y<9;y++)for(let x=0;x<9;x++)if(f.input.data.readUInt32BE((y*9+x)*4)===rgba(2)){
  f.input.data.writeUInt32BE(rgba(3),(y*9+x)*4);
  for(let yy=y*3;yy<y*3+3;yy++)for(let xx=x*3;xx<x*3+3;xx++)f.source.data.writeUInt32BE(rgba(3),(yy*27+xx)*4);
 }
 const result=rasterOutlineContour(PNG,f.input,palette,'#FFFFFF',['#202020'],f.source,grid);
 assert.equal(result.image.data.readUInt32BE(target*4),rgba(1),'same-material internal boundary must survive');
 assert(result.report.preservedInternal.includes(target));
 console.log('PASS: same-material inward boundary continuation');
}

// Reproduce the real minority-fill failure without a character-specific
// coordinate rule. Rotate a narrow dark part and try both brown and pale fill.
for(const fragment of ['#995533','#FFF0DE'])for(let turn=0;turn<4;turn++){
 const p=parsePalette({colors:['#FFFFFF','#202020','#995533','#FFF0DE']}),f={input:new PNG({width:9,height:9}),source:new PNG({width:27,height:27})};
 const rotate=(x,y)=>{for(let i=0;i<turn;i++)[x,y]=[8-y,x];return[x,y];};
 for(let y=0;y<9;y++)for(let x=0;x<9;x++){
  const [xx,yy]=rotate(x,y),color=x>=3&&x<=5&&y>=1&&y<=7?0x202020ff:0xffffffff;
  f.input.data.writeUInt32BE(color,(yy*9+xx)*4);
  for(let v=0;v<3;v++)for(let u=0;u<3;u++)f.source.data.writeUInt32BE(color,((yy*3+v)*27+xx*3+u)*4);
 }
 f.source.data.writeUInt32BE(parseInt(fragment.slice(1)+'ff',16),(12*27+12)*4);
 const r=rasterOutlineContour(PNG,f.input,p,'#FFFFFF',['#202020'],f.source,grid),saved=PNG.sync.read(PNG.sync.write(r.image));
 assert.equal(saved.data.readUInt32BE((4*9+4)*4),0x202020ff,'minority source color must not replace the 8/9 dark area');
 assert(r.report.unsupportedFill.includes(4*9+4),'ambiguity is reported, not certified as an internal seam');
}
console.log('PASS: minority brown/pale fill rejected in four rotations');

// A diagonal outer band meets a one-cell internal stroke. Continuation alone
// must not preserve redundant width at their junction. Rotations guard against
// matching one character's orientation or a particular scan-order example.
for(let turn=0;turn<4;turn++){
 const size=13,im=new PNG({width:size,height:size}),source=new PNG({width:size*3,height:size*3});
 const inside=(x,y)=>x>=2&&y>=2&&x<=10&&y<=10&&x<=y+2;
 const rotate=(x,y)=>{for(let i=0;i<turn;i++)[x,y]=[size-1-y,x];return[x,y];};
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  let color=rgba(0);
  if(inside(x,y)){
   let depth=Infinity;
   for(let yy=0;yy<size;yy++)for(let xx=0;xx<size;xx++)if(!inside(xx,yy))depth=Math.min(depth,Math.abs(xx-x)+Math.abs(yy-y));
   color=depth<=2||(y===6&&x>=3&&x<=7)?rgba(1):rgba(3);
  }
  const [xx,yy]=rotate(x,y);im.data.writeUInt32BE(color,(yy*size+xx)*4);
  for(let v=0;v<3;v++)for(let u=0;u<3;u++)source.data.writeUInt32BE(color,((yy*3+v)*size*3+xx*3+u)*4);
 }
 const mapping={x:Array.from({length:size},(_,i)=>[i*3,(i+1)*3]),y:Array.from({length:size},(_,i)=>[i*3,(i+1)*3])};
 const r=rasterOutlineContour(PNG,im,palette,'#FFFFFF',['#202020'],source,mapping),saved=PNG.sync.read(PNG.sync.write(r.image));
 for(const [x,y]of [[6,5],[7,6]]){const [xx,yy]=rotate(x,y),p=yy*size+xx;assert.equal(saved.data.readUInt32BE(p*4),rgba(3),'redundant junction width must be filled');assert(r.report.thinnedJunctions.includes(p));}
 for(let x=4;x<=6;x++){const [xx,yy]=rotate(x,6);assert.equal(saved.data.readUInt32BE((yy*size+xx)*4),rgba(1),'inward stroke must survive junction cleanup');}
 const [anchorX,anchorY]=rotate(6,6),start=anchorY*size+anchorX,seen=new Set([start]),pending=[start];
 while(pending.length){const p=pending.pop();for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
  const xx=p%size+dx,yy=Math.floor(p/size)+dy,q=yy*size+xx;if(xx<0||yy<0||xx>=size||yy>=size||seen.has(q))continue;
  if(saved.data.readUInt32BE(q*4)===rgba(1)){seen.add(q);pending.push(q);}
 }}
 assert([...seen].some(p=>r.edge[p]),'saved inner stroke remains connected to the contour');
 assert(saved.data.equals(rasterOutlineContour(PNG,im,palette,'#FFFFFF',['#202020'],source,mapping).image.data));
}
console.log('PASS: redundant diagonal junction thinned without cutting its inner stroke in four rotations');

{
 const f=fixture(0),p=parsePalette({colors:['#FFFFFF','#202020','#66AA88','#995533','#FFF0DE']});
 // The raw backdrop maps to a different palette swatch than the declared
 // final backdrop. It is still background, not inward material.
 for(let k=0;k<f.source.data.length;k+=4)if(f.source.data.readUInt32BE(k)===0xffffffff)f.source.data.writeUInt32BE(0xfff0deff,k);
 const r=rasterOutlineContour(PNG,f.input,p,'#FFFFFF',['#202020'],f.source,grid,{operation:'rebuild'});
 assert.equal(r.image.data.readUInt32BE(target*4),rgba(1));
 assert(r.report.unsupportedFill.includes(target));
 console.log('PASS: raw background is excluded even when its palette entry differs');
}

// A thin colored contact stroke can disappear in area assignment even when
// the surrounding filled shape is correct. Restore its source path, not a
// guessed output dot; leave the protected mark and broad filled pigment alone.
{
 const {allocateObservedStrokeLayout,auditObservedStrokeLayout}=require('./raster-source-ink-paths.cjs');
 const {buildNative,enlarge,exactBlocks,inspect}=require('./build-palette-native.cjs');
 const pal=parsePalette({colors:['#FFFFFF','#28446E','#DEA65A']}),src=new PNG({width:64,height:64});
 for(let p=0;p<64*64;p++)src.data.writeUInt32BE(0xdea65aff,p*4);
 for(let x=8;x<56;x++)for(let k=0;k<2;k++)src.data.writeUInt32BE(0x28446eff,((18+Math.floor(x/6)+k)*64+x)*4);
 for(let y=40;y<56;y++)for(let x=8;x<24;x++)src.data.writeUInt32BE(0x28446eff,(y*64+x)*4);
 const base=buildNative(PNG,src,pal,16,16,'#FFFFFF','area-vote').image;
 const policy={version:1,excluded:[[8,40,16,16]],roles:[{name:'colored contact',rect:[0,0,64,64],samples:[[40,68,110]],context:[[222,166,90]],tolerance:10,color:'#28446E',replaceColors:['#28446E'],observation:'Synthetic narrow line and separately protected filled square.'}]};
 const original=Buffer.from(src.data),r=allocateObservedStrokeLayout(PNG,src,base,pal,policy),saved=PNG.sync.read(PNG.sync.write(r.image));
 assert(r.report.expectedColors.length>8,'source line spans multiple target cells');
 assert(!saved.data.equals(base.data),'must restore a real missing line, not merely preserve');
 assert.equal(auditObservedStrokeLayout(saved,r.report).missingPathPixels,0);
 for(let y=10;y<14;y++)for(let x=2;x<6;x++)assert.equal(saved.data.readUInt32BE((y*16+x)*4),base.data.readUInt32BE((y*16+x)*4),'filled feature remains identical');
 assert(src.data.equals(original));assert.equal(inspect(saved,pal).offPalettePixels,0);assert(exactBlocks(saved,enlarge(PNG,saved,8),8));
 assert(saved.data.equals(allocateObservedStrokeLayout(PNG,src,base,pal,policy).image.data),'deterministic reconstruction');
 const bad=PNG.sync.read(PNG.sync.write(saved)),[p]=r.report.expectedColors[0];bad.data.writeUInt32BE(0xdea65aff,p*4);
 assert.equal(auditObservedStrokeLayout(bad,r.report).missingPathPixels,1,'saved-image loss is detected');
 assert.throws(()=>allocateObservedStrokeLayout(PNG,src,base,pal,{...policy,roles:[{...policy.roles[0],color:'#000000'}]}),/invalid source role/);
 assert.throws(()=>allocateObservedStrokeLayout(PNG,src,base,pal,{...policy,roles:[{...policy.roles[0],pixels:[[1,2]]}]}),/destination-dot/);
 console.log('PASS: observed colored contact restoration, protected fill, saved-path loss detection, fixed grid/palette and deterministic replay');
}

// Source-path allocation: a two-cell colored ink band, flat material,
// disconnected inner mark, and two different local material outline colors.
{
 const {coalesceStrokeJunctions}=require('./raster-source-ink-paths.cjs');
 const w=16,cells=new Set([85,86,101,102,100,99,70,54,103,104]);
 const paths=[[[3.5,6.5],[5.9,5.9]],[[6.5,3.5],[5.9,5.9]],[[8.5,6.5],[5.9,5.9]]];
 const result=coalesceStrokeJunctions(cells,paths,w,16,new Set()),block=new Set([85,86,101,102]);
 assert.equal(result.changes.length,1,'three source branches share one anchor');
 assert(![...block].every(p=>result.cells.has(p)),'quantized junction does not remain a solid 2x2');
 for(const p of cells)if(!block.has(p))assert(result.cells.has(p),'incident branches are retained');
 const seen=new Set([99]),queue=[99];for(let i=0;i<queue.length;i++)for(const p of result.cells)if(!seen.has(p)&&Math.max(Math.abs(p%w-queue[i]%w),Math.abs(Math.floor(p/w)-Math.floor(queue[i]/w)))===1){seen.add(p);queue.push(p);}
 assert([54,104].every(p=>seen.has(p)),'all source-supported arms remain connected');
 const loop=new Set([85,86,101,102]);assert.deepEqual(coalesceStrokeJunctions(loop,[],w,16,new Set()).cells,loop,'a closed small loop is not shaved as a junction');
 assert.deepEqual(coalesceStrokeJunctions(cells,paths,w,16,new Set([85])).cells,cells,'locked exterior junction is not displaced');
 console.log('PASS: source-junction contraction retains branches and protects closed loops/locked contours');
}
{
 const {buildNative,enlarge,exactBlocks}=require('./build-palette-native.cjs');
 const pal=parsePalette({colors:['#FFFFFF','#28446E','#4F3529','#DEA65A','#C3744B']});
 const src=new PNG({width:128,height:128}),v=i=>parseInt(pal[i].hex.slice(1)+'ff',16);
 for(let y=0;y<128;y++)for(let x=0;x<128;x++){
  const radius=Math.hypot(x+.5-64,y+.5-64);let c=radius>49?0:radius>41?(y<64?1:2):3;
  if(x>=56&&x<64&&y>=48&&y<56)c=1; // disconnected detail must not be thinned
  if(x>=56&&x<76&&y>=72&&y<80)c=4; // accepted interior shade
  src.data.writeUInt32BE(v(c),(y*128+x)*4);
 }
 const original=Buffer.from(src.data),eyes={version:1,visibility:'not-visible',observation:'Synthetic colored round prop, no eyes.',eyes:[]};
 const policy={version:1,mode:'source-path-width',width:1,scope:'exterior-connected',background:'#FFFFFF',colors:['#28446E','#4F3529'],observation:'Distinct source ink band, two local colors; not the disconnected inner mark.'};
 const base=buildNative(PNG,src,pal,32,32,'#FFFFFF','area-vote',null,null,null,eyes);
 const g={x:Array.from({length:32},(_,i)=>[i*4,i*4+4]),y:Array.from({length:32},(_,i)=>[i*4,i*4+4])};
 const result=buildNative(PNG,src,pal,32,32,'#FFFFFF','area-vote',null,null,null,eyes,null,policy);
 assert(result.outlineReport.changedPixels>0);assert.equal(result.outlineReport.outsideBandChanges,0);
 assert.deepEqual(inspectOnePixelOutline(result.image,result.outlineReport),result.outlineReport.savedWidth);
 assert.equal(result.outlineReport.savedWidth.solidLineBlocks,0);assert.equal(result.outlineReport.savedWidth.missingPathPixels,0);
 const band=new Set([...result.outlineReport.sourceBand,...result.outlineReport.pathCells]);
 for(let p=0;p<1024;p++)if(!band.has(p))assert.equal(result.image.data.readUInt32BE(p*4),base.image.data.readUInt32BE(p*4),'unrelated material and inner marks unchanged');
 for(const rgb of [v(1),v(2)])assert(result.outlineReport.pathCells.some(p=>result.image.data.readUInt32BE(p*4)===rgb),'retain both local ink colors');
 assert(src.data.equals(original),'source bytes immutable');
 const saved=PNG.sync.read(PNG.sync.write(result.image));assert(exactBlocks(saved,enlarge(PNG,saved,8),8));
 assert(allocateOnePixelOutline(PNG,src,saved,pal,g,policy).image.data.equals(saved.data),'saved-source check is idempotent');
 const replay=buildNative(PNG,src,pal,32,32,'#FFFFFF','area-vote',null,null,null,eyes,null,policy);assert(saved.data.equals(replay.image.data));
 const tampered=PNG.sync.read(PNG.sync.write(saved)),p=result.outlineReport.pathCells[0];tampered.data.writeUInt32BE(v(3),p*4);
 assert.equal(inspectOnePixelOutline(tampered,result.outlineReport).missingPathPixels,1);
 assert(!allocateOnePixelOutline(PNG,src,tampered,pal,g,policy).image.data.equals(tampered.data),'missing saved line is rejected');
 assert.throws(()=>allocateOnePixelOutline(PNG,src,saved,pal,g,{...policy,colors:['#000001']}),/fixed palette/);
 assert.throws(()=>allocateOnePixelOutline(PNG,src,saved,pal,{...g,x:g.x.map(([a,b])=>[a+1,b+1])},policy),/uniform full-canvas/);
 const padded=new PNG({width:130,height:130});for(let q=0;q<130*130;q++)padded.data.writeUInt32BE(v(0),q*4);
 for(let y=0;y<128;y++)src.data.copy(padded.data,((y+1)*130+1)*4,y*128*4,(y+1)*128*4);
 const shifted={x:g.x.map(([a,b])=>[a+1,b+1]),y:g.y.map(([a,b])=>[a+1,b+1])};
 const phased=allocateOnePixelOutline(PNG,padded,base.image,pal,shifted,{...policy,registration:'measured'});
 assert(phased.image.data.equals(saved.data),'source and grid translated together retain the same saved native pixels');
 assert.deepEqual(phased.report.registration,{step:4,origin:[1,1]});
 assert.throws(()=>allocateOnePixelOutline(PNG,padded,base.image,pal,{...shifted,x:shifted.x.map(([a,b],i)=>[a,b+(i===5?.2:0)])},{...policy,registration:'measured'}),/uniform/);
 assert.throws(()=>buildNative(PNG,src,pal,32,32,'#FFFFFF','nearest',null,null,null,eyes,null,policy),/plain fixed-area/);
 const filled=PNG.sync.read(PNG.sync.write(src));for(let q=0;q<128*128;q++)if(filled.data.readUInt32BE(q*4)!==v(0))filled.data.writeUInt32BE(v(1),q*4);
 assert.throws(()=>allocateOnePixelOutline(PNG,filled,saved,pal,g,policy),/broad fill/,'a dark material mass is not silently skeletonized');
 const empty=new PNG({width:128,height:128});for(let q=0;q<128*128;q++)empty.data.writeUInt32BE(v(0),q*4);
 assert.throws(()=>allocateOnePixelOutline(PNG,empty,saved,pal,g,policy),/No source-supported/);
 console.log('PASS: source paths, local ink colors, unchanged inner marks/shade, replay, saved-line defect detection, grid/role guards and broad-fill rejection');
}
