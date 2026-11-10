'use strict';
const {toLab}=require('./build-palette-native.cjs');
// Optional measured-grid outline pass. No character coordinates or output-dot overrides.
function rasterOutlineContour(PNG,input,palette,background,lineColors,source,grid,{operation='thin-only'}={}){
 if(!['thin-only','repaint-only','rebuild'].includes(operation))throw Error('Unknown contour operation');
 if(!Array.isArray(lineColors)||!lineColors.length||lineColors.some(c=>c===background||!palette.some(p=>p.hex===c)))
  throw Error('Contour colors must be explicit non-background fixed-palette entries');
 if(grid.x.length!==input.width||grid.y.length!==input.height)throw Error('Contour source mapping must match native grid');
 const w=input.width,h=input.height,n=w*h,bg=parseInt(background.slice(1)+'ff',16),lines=new Set(lineColors.map(c=>parseInt(c.slice(1)+'ff',16)));
 const rgba=Array.from({length:n},(_,p)=>input.data.readUInt32BE(p*4));
 const exterior=new Uint8Array(n),seen=new Uint8Array(n),queue=new Int32Array(n);
 const neighbors=(p)=>{const x=p%w,y=Math.floor(p/w);return [x?p-1:-1,x+1<w?p+1:-1,y?p-w:-1,y+1<h?p+w:-1].filter(v=>v>=0);};
 // Distinguish enclosed negative space from eye/metal whites using original
 // source colors, before fixed-palette assignment merges those color roles.
 const samples=[[],[],[]];
 for(let y=0;y<source.height;y++)for(let x=0;x<source.width;x++)if(x===0||y===0||x===source.width-1||y===source.height-1)
  for(let c=0;c<3;c++)samples[c].push(source.data[(y*source.width+x)*4+c]);
 const ranges=samples.map(a=>{a.sort((a,b)=>a-b);return [a[Math.floor(a.length*.01)]-2,a[Math.floor(a.length*.99)]+2];});
 const sourceBackgroundSupport=p=>{
  const [l,r]=grid.x[p%w],[t,b]=grid.y[Math.floor(p/w)];let total=0,match=0;
  for(let y=Math.max(0,Math.ceil(t));y<Math.min(source.height,b);y++)for(let x=Math.max(0,Math.ceil(l));x<Math.min(source.width,r);x++){
   total++;if(ranges.every(([lo,hi],c)=>source.data[(y*source.width+x)*4+c]>=lo&&source.data[(y*source.width+x)*4+c]<=hi))match++;
  }return total?match/total:0;
 };
 for(let p=0;p<n;p++)if(rgba[p]===bg&&!seen[p]){
  let head=0,tail=1,border=false;queue[0]=p;seen[p]=1;
  while(head<tail){const q=queue[head++],x=q%w,y=Math.floor(q/w);border ||= !x||!y||x===w-1||y===h-1;for(const a of neighbors(q))if(!seen[a]&&rgba[a]===bg){seen[a]=1;queue[tail++]=a;}}
  const support=Array.from(queue.subarray(0,tail)).reduce((s,q)=>s+sourceBackgroundSupport(q),0)/tail;
  if(border||support>.5)for(let i=0;i<tail;i++)exterior[queue[i]]=1;
 }
 const depth=new Int16Array(n);depth.fill(32767);let head=0,tail=0;
 for(let p=0;p<n;p++)if(exterior[p]){depth[p]=0;queue[tail++]=p;}
 while(head<tail){const p=queue[head++];for(const q of neighbors(p))if(depth[q]>depth[p]+1){depth[q]=depth[p]+1;queue[tail++]=q;}}
 const edge=Uint8Array.from(depth,d=>d===1?1:0);
 // Topology-preserving thinning of the geometric contour, never the full
 // character or its facial/detail strokes (Zhang-Suen two subiterations).
 let changed=true;
 while(changed){changed=false;for(let phase=0;phase<2;phase++){
  const remove=[];
  for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
   const p=y*w+x;if(!edge[p])continue;
   // Do not shave an already one-cell staircase or its protruding fingertip.
   // Only a pixel participating in a solid 2x2 contour block is redundant.
   let doubled=false;
   for(const dy of [-1,0])for(const dx of [-1,0]){
    const q=(y+dy)*w+x+dx;if(edge[q]&&edge[q+1]&&edge[q+w]&&edge[q+w+1])doubled=true;
   }
   if(!doubled)continue;
   const a=[edge[p-w],edge[p-w+1],edge[p+1],edge[p+w+1],edge[p+w],edge[p+w-1],edge[p-1],edge[p-w-1]],b=a.reduce((s,v)=>s+v,0);
   let transitions=0;for(let k=0;k<8;k++)if(!a[k]&&a[(k+1)%8])transitions++;
   if(b<2||b>6||transitions!==1)continue;
   if(phase===0?(a[0]*a[2]*a[4]||a[2]*a[4]*a[6]):(a[0]*a[2]*a[6]||a[0]*a[4]*a[6]))continue;
   remove.push(p);
  }
  for(const p of remove){edge[p]=0;changed=true;}
 }}
 const out=new PNG({width:w,height:h});input.data.copy(out.data);
 let filled=0,outlined=0,unresolved=0;const preservedInternal=[],unsupportedFill=[],fillDecisions=[],thinnedJunctions=[],unprovenThickness=[];
 const entries=palette.map(c=>({value:parseInt(c.hex.slice(1)+'ff',16),lab:toLab(c.rgb)})),pixelCache=new Map(),cellCache=new Map();
 function sourceCell(p){
  if(cellCache.has(p))return cellCache.get(p);
  const [l,r]=grid.x[p%w],[t,b]=grid.y[Math.floor(p/w)],votes=new Map(),sum=[0,0,0];let total=0,materialArea=0,lineArea=0,backgroundArea=0;
  for(let y=Math.max(0,Math.floor(t));y<Math.min(source.height,Math.ceil(b));y++)for(let x=Math.max(0,Math.floor(l));x<Math.min(source.width,Math.ceil(r));x++){
   const k=(y*source.width+x)*4,key=source.data.readUInt32BE(k),area=Math.max(0,Math.min(r,x+1)-Math.max(l,x))*Math.max(0,Math.min(b,y+1)-Math.max(t,y));if(!area)continue;
   let q=pixelCache.get(key);if(!q){const lab=toLab([...source.data.subarray(k,k+3)]);let best=Infinity,color=null;
    for(const c of entries){const score=(lab[0]-c.lab[0])**2+4*((lab[1]-c.lab[1])**2+(lab[2]-c.lab[2])**2);if(score<best){best=score;color=c.value;}}
    q={lab,color};pixelCache.set(key,q);
   }
   // Background is a source role, not one exact quantized palette entry.
   const isBackground=ranges.every(([lo,hi],c)=>source.data[k+c]>=lo&&source.data[k+c]<=hi);
   total+=area;if(isBackground||q.color===bg){backgroundArea+=area;continue;}
   votes.set(q.color,(votes.get(q.color)||0)+area);
   if(lines.has(q.color))lineArea+=area;
   else if(q.color!==bg){materialArea+=area;for(let c=0;c<3;c++)sum[c]+=q.lab[c]*area;}
  }
  const result={votes,total,lineArea,materialArea,backgroundArea,lab:materialArea?sum.map(v=>v/materialArea):null};cellCache.set(p,result);return result;
 }
 // A continuation can run through an unnecessarily thick outer junction.
 // Test redundancy against the original contour, but connectivity against
 // current output so adjacent removals cannot cumulatively sever a stroke.
 function doubledContourBlock(p){
  const x=p%w,y=Math.floor(p/w);let doubled=false;
  for(const dy of [-1,0])for(const dx of [-1,0]){
   const xx=x+dx,yy=y+dy;if(xx<0||yy<0||xx+1>=w||yy+1>=h)continue;
   const q=yy*w+xx,ps=[q,q+1,q+w,q+w+1];
   if(ps.some(v=>edge[v])&&ps.every(v=>lines.has(rgba[v])))doubled=true;
  }
  return doubled;
 }
 function redundantJunction(p){
  if(!doubledContourBlock(p))return false;
  const x=p%w,y=Math.floor(p/w);
  const ring=[];
  for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
   const xx=x+dx,yy=y+dy;if((!dx&&!dy)||xx<0||yy<0||xx>=w||yy>=h)continue;
   if(lines.has(out.data.readUInt32BE((yy*w+xx)*4)))ring.push([xx,yy]);
  }
  if(ring.length<2)return false;
  const connected=new Set([0]),pending=[0];
  while(pending.length){const i=pending.pop();for(let j=0;j<ring.length;j++)if(!connected.has(j)&&Math.max(Math.abs(ring[i][0]-ring[j][0]),Math.abs(ring[i][1]-ring[j][1]))<=1){connected.add(j);pending.push(j);}}
  return connected.size===ring.length;
 }
 // Distance from the silhouette is not evidence that an internal seam is
 // redundant. Keep source-supported material seams and dark structures that
 // continue inward. Actual removal and fill selection need separate evidence.
 for(let p=0;p<n;p++)if(operation!=='repaint-only'&&!exterior[p]&&!edge[p]&&depth[p]<=2&&lines.has(rgba[p])){
  const x=p%w,y=Math.floor(p/w),evidence=sourceCell(p),inward=[],inwardVotes=new Map();let stripSupport=false,internalContinuation=false;
  for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
   const xx=x+dx,yy=y+dy;if(xx<0||yy<0||xx>=w||yy>=h)continue;const q=yy*w+xx;
   if(depth[q]<=depth[p])continue;
   const s=sourceCell(q);
   // A rasterized inward cell can itself be duplicate ink. Its native label
   // must not hide majority material evidence in the original source cell.
   // Keep real source-supported inward strokes protected as before.
   if(lines.has(rgba[q])&&s.lineArea>s.total/2){internalContinuation=true;continue;}
   if(rgba[q]===bg)continue;
   // A narrow material sliver beside a seam need not occupy half a cell.
   // Require at least one full source-pixel area rather than majority fill.
   if(s.lab&&s.materialArea>=1){
    inward.push(s.lab);
    // A doubled contour requires an outward contour and an actual inward
    // material surface on opposite sides. A narrow dark part has neither.
    const ox=x-dx,oy=y-dy,outer=oy*w+ox;
    if(ox>=0&&oy>=0&&ox<w&&oy<h&&edge[outer]&&lines.has(rgba[outer])&&s.materialArea>s.total/2){
     stripSupport=true;
     for(const [color,area]of s.votes)if(!lines.has(color)&&color!==bg)inwardVotes.set(color,(inwardVotes.get(color)||0)+area);
    }
   }
  }
  const materialJoin=inward.some((a,i)=>inward.slice(i+1).some(b=>Math.hypot(a[1]-b[1],a[2]-b[2])>.04));
  const redundant=internalContinuation&&stripSupport&&!materialJoin&&redundantJunction(p);
  if(evidence.lineArea/evidence.total>=.5&&(materialJoin||(internalContinuation&&!redundant))){preservedInternal.push(p);continue;}
  // Correction of an existing outline must preserve its exterior pixels.
  // A local material vote alone is not evidence of duplicate thickness.
  if(operation==='thin-only'&&(depth[p]!==2||!doubledContourBlock(p))){unprovenThickness.push(p);continue;}
  let best=-Infinity,color=null;
  const localMaterial=[...evidence.votes].filter(([c])=>!lines.has(c)&&c!==bg);
  // Do not renormalize a tiny material sliver after discarding the line.
  // Local replacement needs majority material evidence. Otherwise thinning
  // needs positive doubled-strip evidence, not merely a missing seam flag.
  const localFill=evidence.materialArea>evidence.total/2;
  const thinStrip=evidence.lineArea>evidence.total/2&&stripSupport&&!materialJoin;
  const fillVotes=localFill?new Map(localMaterial):thinStrip?inwardVotes:new Map();
  // Palette order is deterministic for exact ties; loop traversal cannot
  // propagate an unrelated nearby material into this cell.
  for(const c of entries){const support=fillVotes.get(c.value)||0;if(support>0&&support>best){best=support;color=c.value;}}
  if(color!==null){out.data.writeUInt32BE(color,p*4);filled++;if(redundant)thinnedJunctions.push(p);fillDecisions.push({pixel:p,reason:redundant?'connected-redundant-junction':localFill?'source-material-majority':'supported-double-contour',lineFraction:evidence.lineArea/evidence.total,materialFraction:evidence.materialArea/evidence.total,backgroundFraction:evidence.backgroundArea/evidence.total});}
  else{unresolved++;unsupportedFill.push(p);}
 }
 if(operation!=='thin-only'){
  const repaint=repaintContour(out,rgba,edge,lines);
  outlined=repaint.outlined;unresolved+=repaint.unresolved;
 }
 // Rebuilding a continuous contour is a component operation. Manhattan depth
 // can leave a diagonal corner's third-depth ink behind after the adjacent
 // duplicate band is filled. Remove only newly detached or dangling redundant ink:
 // it belonged to the original exterior-connected component, is absent from
 // that component's topology-preserving skeleton, and has source material
 // support. Original isolated details and retained internal seams are protected.
 const redundantCornerRemnants=[];
 if(operation==='rebuild'){
  const adjacent8=p=>{const x=p%w,y=Math.floor(p/w),r=[];for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
   const xx=x+dx,yy=y+dy;if((dx||dy)&&xx>=0&&yy>=0&&xx<w&&yy<h)r.push(yy*w+xx);
  }return r;};
  const connectedToEdge=values=>{const visited=new Set(),pending=[];
   for(let p=0;p<n;p++)if(edge[p]&&lines.has(values(p))){visited.add(p);pending.push(p);}
   for(let i=0;i<pending.length;i++)for(const q of adjacent8(pending[i]))if(!visited.has(q)&&lines.has(values(q))){visited.add(q);pending.push(q);}
   return visited;
  };
  const originalComponent=connectedToEdge(p=>rgba[p]);
  const retained=connectedToEdge(p=>out.data.readUInt32BE(p*4));
  const skeleton=require('./refine-structure.cjs').thinMask([...originalComponent],w);
  const protectedInk=new Set(preservedInternal);
  for(const p of originalComponent)if((!retained.has(p)||(depth[p]>2&&adjacent8(p).filter(q=>lines.has(out.data.readUInt32BE(q*4))).length<=1))&&!skeleton.has(p)&&!protectedInk.has(p)&&lines.has(out.data.readUInt32BE(p*4))){
   const votes=new Map();
   for(const q of [p,...adjacent8(p)]){
    if(q!==p&&(out.data.readUInt32BE(q*4)===bg||lines.has(out.data.readUInt32BE(q*4))))continue;
    for(const [color,area]of sourceCell(q).votes)if(color!==bg&&!lines.has(color))votes.set(color,(votes.get(color)||0)+area);
   }
   let best=0,color=null;for(const c of entries)if((votes.get(c.value)||0)>best){best=votes.get(c.value);color=c.value;}
   if(color!==null){out.data.writeUInt32BE(color,p*4);filled++;redundantCornerRemnants.push(p);}
  }
 }
 const mask=new PNG({width:w,height:h});for(let p=0;p<n;p++)mask.data.set(edge[p]?[0,0,0,255]:[255,255,255,255],p*4);
 let changedPixels=0,interiorChanges=0;
 for(let p=0;p<n;p++)if(out.data.readUInt32BE(p*4)!==rgba[p]){changedPixels++;if(depth[p]>2)interiorChanges++;}
 return {image:out,mask,edge,depth,report:{method:'source-backed-contour',operation,logicalWidth:1,
  colors:lineColors,filled,outlined,unresolved,changedPixels,interiorChanges,preservedInternal,unsupportedFill,fillDecisions,thinnedJunctions,unprovenThickness,redundantCornerRemnants,
  sourceBackgroundRanges:ranges,
  limitation:'Uniform border-background artwork only. Palette roles and inward material transfer require saved-image review. Not semantic shape certification.'}};
}
// Deliberate outline construction/recoloring, never an implicit thinning step.
function repaintContour(out,rgba,edge,lines){
 const w=out.width,h=out.height;let outlined=0,unresolved=0;
 for(let p=0;p<w*h;p++)if(edge[p]){
  const x=p%w,y=Math.floor(p/w);let best=Infinity,color=null;
  for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){
   const xx=x+dx,yy=y+dy;if(xx<0||yy<0||xx>=w||yy>=h)continue;const q=yy*w+xx;
   if(!lines.has(rgba[q]))continue;const score=dx*dx+dy*dy;if(score<best){best=score;color=rgba[q];}
  }
  if(color!==null){out.data.writeUInt32BE(color,p*4);outlined++;}else unresolved++;
 }
 return {outlined,unresolved};
}
function inspectSavedOutline(image,mask,depth,lineColors,preservedInternal=[]){
 const lines=new Set(lineColors.map(c=>parseInt(c.slice(1)+'ff',16))),w=image.width,h=image.height;
 const internal=new Set(preservedInternal);
 let missingContourPixels=0,residualInnerLinePixels=0,solidLineBlocks=0,solidMaskBlocks=0,preservedInternalLinePixels=0,missingInternalLinePixels=0;
 for(let p=0;p<w*h;p++){
  const on=mask.data[p*4]===0,line=lines.has(image.data.readUInt32BE(p*4));
  if(on&&!line)missingContourPixels++;
  if(internal.has(p)){if(line)preservedInternalLinePixels++;else missingInternalLinePixels++;}
  else if(!on&&depth[p]>0&&depth[p]<=2&&line)residualInnerLinePixels++;
 }
 for(let y=0;y<h-1;y++)for(let x=0;x<w-1;x++){
  const ps=[y*w+x,y*w+x+1,(y+1)*w+x,(y+1)*w+x+1];
  if(ps.every(p=>mask.data[p*4]===0))solidMaskBlocks++;
  if(ps.some(p=>mask.data[p*4]===0)&&ps.every(p=>lines.has(image.data.readUInt32BE(p*4))))solidLineBlocks++;
 }
 return {missingContourPixels,residualInnerLinePixels,solidLineBlocks,solidMaskBlocks,preservedInternalLinePixels,missingInternalLinePixels,
  scope:'Stored-color checks near the contour; not proof of visual staircase or semantic boundary correctness'};
}
// Explicit ink networks need a width constraint before cell color assignment.
// This is separate from legacy thin-only: trace the source stroke, rasterize
// its connected paths once, and assign the vacated ink band from source material.
// Enclosed/disconnected details (eyes, mouth) never enter the exterior network.
function allocateOnePixelOutline(PNG,source,input,palette,grid,policy,materialInterior=null,materialSource=null){
 if(policy?.mode==='source-silhouette-width')return allocateSilhouetteOutline(PNG,source,input,palette,grid,policy,materialInterior,materialSource);
 if(policy?.version!==1||policy.mode!=='source-path-width'||policy.width!==1||policy.scope!=='exterior-connected'||
   typeof policy.observation!=='string'||!policy.observation.trim())throw Error('Explicit one-pixel source ink policy required');
 const background=policy.background,lineColors=policy.colors,allowed=new Set(palette.map(p=>p.hex));
 if(!allowed.has(background)||!Array.isArray(lineColors)||!lineColors.length||new Set(lineColors).size!==lineColors.length||
   lineColors.some(c=>!allowed.has(c)||c===background))throw Error('Observed ink/background colors must belong to fixed palette');
 const sw=source.width,sh=source.height,n=sw*sh,w=input.width,h=input.height;
 const measured=policy.registration==='measured';
 if(policy.registration!==undefined&&!measured)throw Error('Unknown outline registration');
 const step=measured?grid?.x?.[0]?.[1]-grid?.x?.[0]?.[0]:sw/w;
 const originX=measured?grid?.x?.[0]?.[0]:0,originY=measured?grid?.y?.[0]?.[0]:0,scale=1/step;
 if(!Number.isFinite(step)||step<=0||!Number.isFinite(originX)||!Number.isFinite(originY)||
   !measured&&Math.abs(scale-h/sh)>1e-10||grid?.x?.length!==w||grid?.y?.length!==h||
   ['x','y'].some(axis=>grid[axis].some(([a,b],i)=>Math.abs(a-(axis==='x'?originX:originY)-i*step)>1e-8||Math.abs(b-a-step)>1e-8)))
  throw Error('Source ink paths require one uniform full-canvas grid, or explicit measured square registration');
 const bg=parseInt(background.slice(1)+'ff',16),lines=new Set(lineColors.map(c=>parseInt(c.slice(1)+'ff',16)));
 const segmented=require('./source-region-palette.cjs').segmentSourceRegions(PNG,source,palette,w,h).image;
 const colors=Uint32Array.from({length:n},(_,p)=>segmented.data.readUInt32BE(p*4));
 const around=(p,W,H,diagonal=false)=>{const x=p%W,y=Math.floor(p/W),a=[];
  for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if((dx||dy)&&(diagonal||!dx||!dy)&&x+dx>=0&&x+dx<W&&y+dy>=0&&y+dy<H)a.push((y+dy)*W+x+dx);return a;};
 const sourceOutside=new Uint8Array(n),backgroundQueue=[];
 const offerBackground=p=>{if(!sourceOutside[p]&&colors[p]===bg){sourceOutside[p]=1;backgroundQueue.push(p);}};
 for(let x=0;x<sw;x++){offerBackground(x);offerBackground((sh-1)*sw+x);}for(let y=0;y<sh;y++){offerBackground(y*sw);offerBackground(y*sw+sw-1);}
 for(let i=0;i<backgroundQueue.length;i++)for(const q of around(backgroundQueue[i],sw,sh))offerBackground(q);
 if(!backgroundQueue.length)throw Error('Source ink path mode requires a visible uniform exterior background');
 const visited=new Uint8Array(n),stroke=new Set(),components=[];
 for(let p=0;p<n;p++)if(!visited[p]&&lines.has(colors[p])){const part=[p];visited[p]=1;let exterior=false;
  for(let i=0;i<part.length;i++)for(const q of around(part[i],sw,sh,true)){
   if(sourceOutside[q])exterior=true;if(!visited[q]&&lines.has(colors[q])){visited[q]=1;part.push(q);}
  }components.push({pixels:part.length,exterior});if(exterior)for(const q of part)stroke.add(q);
 }
 if(!stroke.size)throw Error('No source-supported exterior ink network; do not invent a border');
 // Grow actual neighboring source colors into the source ink band. It never
 // changes the source file or replaces a native material plane with a constant.
 const nearest=new Int32Array(n),distance=new Int32Array(n),queue=new Int32Array(n);nearest.fill(-1);let head=0,tail=0;
 for(let p=0;p<n;p++)if(!stroke.has(p)){nearest[p]=p;queue[tail++]=p;}
 while(head<tail){const p=queue[head++];for(const q of around(p,sw,sh))if(nearest[q]<0){nearest[q]=nearest[p];distance[q]=distance[p]+1;queue[tail++]=q;}}
 let maxRadius=0;for(const p of stroke)maxRadius=Math.max(maxRadius,distance[p]*scale);
 if(maxRadius>2){const error=new Error('Observed ink colors include a broad fill or oversized junction; explicit stroke-only evidence required');
  error.diagnostics={maxSourceRadius:maxRadius,components,registration:{step,origin:[originX,originY]}};throw error;}
 const {traceStrokePaths,rasterPath}=require('./raster-source-ink-paths.cjs');
 const paths=traceStrokePaths(stroke,sw,sh,p=>[(p%sw+.5-originX)*scale,(Math.floor(p/sw)+.5-originY)*scale],scale);
 const cells=new Set();for(const path of paths)for(let i=1;i<path.length;i++)for(const[x,y]of rasterPath(path[i-1],path[i],false))
  if(x>=0&&x<w&&y>=0&&y<h)cells.add(y*w+x);
 if(!cells.size)throw Error('No representable source ink paths');
 const out=new PNG({width:w,height:h});input.data.copy(out.data);const band=new Set();
 for(const p of stroke){const x=Math.floor((p%sw-originX)*scale),y=Math.floor((Math.floor(p/sw)-originY)*scale);
  if(x>=0&&y>=0&&x<w&&y<h)band.add(y*w+x);}
 for(const p of band){const x=p%w,y=Math.floor(p/w),votes=new Map(),[l,r]=grid.x[x],[t,b]=grid.y[y];
  for(let sy=Math.floor(t);sy<Math.ceil(b);sy++)for(let sx=Math.floor(l);sx<Math.ceil(r);sx++){
   const area=Math.max(0,Math.min(r,sx+1)-Math.max(l,sx))*Math.max(0,Math.min(b,sy+1)-Math.max(t,sy));if(!area)continue;
   const q=sy*sw+sx,color=sx<0||sy<0||sx>=sw||sy>=sh?bg:colors[nearest[q]];votes.set(color,(votes.get(color)||0)+area);
  }out.data.writeUInt32BE([...votes].sort((a,b)=>b[1]-a[1]||a[0]-b[0])[0][0],p*4);
 }
 const radius=Math.ceil(1.5/scale);
 for(const p of cells){const x=p%w,y=Math.floor(p/w);let best=Infinity,color=null;
  for(let dy=-radius;dy<=radius;dy++)for(let dx=-radius;dx<=radius;dx++){
   const sx=Math.floor(originX+(x+.5)/scale)+dx,sy=Math.floor(originY+(y+.5)/scale)+dy,q=sy*sw+sx;
   if(sx<0||sy<0||sx>=sw||sy>=sh||!stroke.has(q))continue;const d=dx*dx+dy*dy;
   if(d<best){best=d;color=colors[q];}
  }if(color===null)throw Error('Grid path has no nearby original ink color');out.data.writeUInt32BE(color,p*4);
 }
 // The same path network defines the exterior. A separately sampled fringe
 // must not survive outside it. Only the measured source band may be changed.
 const exterior=new Set(),flood=[];const offer=p=>{if(!cells.has(p)&&!exterior.has(p)){exterior.add(p);flood.push(p);}};
 for(let x=0;x<w;x++){offer(x);offer((h-1)*w+x);}for(let y=0;y<h;y++){offer(y*w);offer(y*w+w-1);}
 for(let i=0;i<flood.length;i++)for(const q of around(flood[i],w,h))offer(q);
 if(exterior.size+cells.size===w*h)throw Error('Source ink paths lost enclosure; no contour-only success');
 for(const p of exterior)if(band.has(p))out.data.writeUInt32BE(bg,p*4);
 let changedPixels=0,outsideBandChanges=0;
 for(let p=0;p<w*h;p++)if(out.data.readUInt32BE(p*4)!==input.data.readUInt32BE(p*4)){
  changedPixels++;if(!band.has(p)&&!cells.has(p))outsideBandChanges++;
 }
 const report={method:'source-path-width',logicalWidth:1,registration:{step,origin:[originX,originY]},colors:lineColors,components,expectedPathComponents:components.filter(c=>c.exterior).length,paths:paths.length,maxSourceRadius:maxRadius,
  pathCells:[...cells],sourceBand:[...band],changedPixels,outsideBandChanges,
  limitation:'Opt-in for observed distinct exterior-connected ink on uniform full-canvas background. Not a dark-material detector or an aesthetic approval.'};
 report.savedWidth=inspectOnePixelOutline(out,report);
 if(report.savedWidth.missingPathPixels||report.savedWidth.residualBandInk||report.savedWidth.solidLineBlocks||report.savedWidth.pathComponents!==report.expectedPathComponents||outsideBandChanges){
  const error=new Error('One-pixel path constraint unresolved; do not export a partially thinned contour');error.diagnostics=report;throw error;}
 return {image:out,report};
}
function inspectOnePixelOutline(image,report){
 const cells=new Set(report.pathCells),band=new Set(report.sourceBand),lines=new Set(report.colors.map(c=>parseInt(c.slice(1)+'ff',16))),w=image.width,h=image.height;
 const has=p=>lines.has(image.data.readUInt32BE(p*4));let missingPathPixels=0,residualBandInk=0,solidLineBlocks=0;
 for(const p of cells)if(!has(p))missingPathPixels++;
 for(const p of band)if(!cells.has(p)&&has(p))residualBandInk++;
 for(let y=0;y<h-1;y++)for(let x=0;x<w-1;x++){const a=[y*w+x,y*w+x+1,(y+1)*w+x,(y+1)*w+x+1];if(a.some(p=>cells.has(p))&&a.every(has))solidLineBlocks++;}
 const pending=new Set([...cells].filter(has));let pathComponents=0;
 while(pending.size){pathComponents++;const q=[pending.values().next().value];pending.delete(q[0]);
  for(let i=0;i<q.length;i++)for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
   const x=q[i]%w+dx,y=Math.floor(q[i]/w)+dy,p=y*w+x;
   if((dx||dy)&&x>=0&&x<w&&y>=0&&y<h&&pending.has(p)){pending.delete(p);q.push(p);}
  }
 }
 return {missingPathPixels,residualBandInk,solidLineBlocks,pathComponents,scope:'Declared source ink network only. Direct curve/junction visual review remains required.'};
}
// Separate geometric boundary ownership from dark material classification.
// The same continuous source contour owns the filled silhouette and its rim.
function allocateSilhouetteOutline(PNG,source,input,palette,grid,policy,materialInterior=null,materialSource=null){
 const {rasterSharedBoundaries}=require('./raster-shared-boundaries.cjs');
 const {thinMask}=require('./refine-structure.cjs');
 const w=input.width,h=input.height,sw=source.width,sh=source.height,step=sw/w;
 const byHex=new Map(palette.map(p=>[p.hex,p])),bgEntry=byHex.get(policy.background);
 if(policy.version!==1||policy.width!==1||policy.scope!=='exterior-connected'||!bgEntry||
    !policy.observation||!Number.isFinite(policy.backgroundTolerance)||policy.backgroundTolerance<0||policy.backgroundTolerance>32||
    !Array.isArray(policy.colors)||!policy.colors.length||policy.colors.some(c=>!byHex.has(c)||c===policy.background)||
    Math.abs(sh/h-step)>1e-9||grid.x.length!==w||grid.y.length!==h||['x','y'].some(axis=>grid[axis].some(([a,b],i)=>Math.abs(a-i*step)>1e-8||Math.abs(b-a-step)>1e-8)))
  throw Error('Explicit uniform source silhouette, local ink colors and observed background tolerance required');
 const protectedRegions=policy.protectedSourceRegions??[];
 if(!Array.isArray(protectedRegions)||protectedRegions.some(r=>!Array.isArray(r)||r.length!==4||!r.every(Number.isFinite)||r[2]<=0||r[3]<=0))throw Error('Invalid source protection rectangles');
 const featureCells=require('./eye-plane-policy.cjs').eyeOwnership(source,{eyes:policy.protectedSourceShapes??[]},w,h).cells;
 const bg=parseInt(policy.background.slice(1)+'ff',16),fg=0x000000ff;
 const foreground=new Uint8Array(sw*sh),binary=new PNG({width:sw,height:sh});
 if(materialSource&&(materialSource.owners?.length!==sw*sh||!Array.isArray(materialSource.plan?.regions)))throw Error('Source material ownership must match the silhouette source');
 let materialForegroundPixels=0;
 for(let p=0;p<sw*sh;p++){
  foreground[p]=Number(source.data[p*4+3]>=128&&bgEntry.rgb.some((c,k)=>Math.abs(source.data[p*4+k]-c)>policy.backgroundTolerance));
  // Reviewed source ownership precedes colour similarity. A skin highlight
  // cannot become a background hole after stage 4 already assigned it to skin.
  // Unassigned space still uses the observed background classifier unchanged.
  const owner=materialSource?.owners[p]??-1;
  if(owner>=0&&materialSource.plan.regions[owner].material!=='background'&&!foreground[p]){foreground[p]=1;materialForegroundPixels++;}
 }
 // A sub-cell background island is not a resolvable negative space. Likewise,
 // isolated sub-cell foreground noise must not acquire an invented outline.
 // Classify whole source regions before tracing; never delete output dots.
 const coreTolerance=policy.backgroundCoreTolerance;
 if(!Number.isFinite(coreTolerance)||coreTolerance<0||coreTolerance>policy.backgroundTolerance)throw Error('Observed background core tolerance required');
 const seen=new Uint8Array(sw*sh),queue=new Int32Array(sw*sh);
 let unresolvedSourceIslands=0;
 for(let p=0;p<sw*sh;p++)if(!seen[p]){
  const value=foreground[p];let head=0,tail=1;queue[0]=p;seen[p]=1;let touchesBorder=false,backgroundCore=0;
  while(head<tail){const q=queue[head++],x=q%sw,y=Math.floor(q/sw);
   if(!value&&bgEntry.rgb.every((c,k)=>Math.abs(source.data[q*4+k]-c)<=coreTolerance))backgroundCore++;
   if(!x||!y||x===sw-1||y===sh-1)touchesBorder=true;
   for(const r of [x?q-1:-1,x+1<sw?q+1:-1,y?q-sw:-1,y+1<sh?q+sw:-1])
    if(r>=0&&!seen[r]&&foreground[r]===value){seen[r]=1;queue[tail++]=r;}
  }
  if(!touchesBorder&&(tail<step*step||(!value&&backgroundCore<tail*.5))){unresolvedSourceIslands++;for(let i=0;i<tail;i++)foreground[queue[i]]=1-value;}
 }
 for(let p=0;p<sw*sh;p++)binary.data.writeUInt32BE(foreground[p]?fg:bg,p*4);
 const shape=rasterSharedBoundaries(PNG,binary,w,h,policy.background,.5,false,grid,null,false);
 const occupied=Uint8Array.from({length:w*h},(_,p)=>shape.image.data.readUInt32BE(p*4)!==bg?1:0);
 const adjacent=(p,W,H)=>{const x=p%W,y=Math.floor(p/W);return [x?p-1:-1,x+1<W?p+1:-1,y?p-W:-1,y+1<H?p+W:-1].filter(q=>q>=0);};
 const boundary=new Set();for(let p=0;p<w*h;p++)if(occupied[p]&&adjacent(p,w,h).some(q=>!occupied[q]))boundary.add(p);
 // A small enclosed fill pocket at a taper cannot fit two rim sides plus a
 // readable material plane. Collapse that pocket into the stroke network
 // before thinning the network, rather than nicking a final 2x2 ink block.
 const insideSeen=new Set();let collapsedFillPockets=0;
 for(let p=0;p<w*h;p++)if(occupied[p]&&!boundary.has(p)&&!insideSeen.has(p)){
  const part=[p];insideSeen.add(p);
  for(let i=0;i<part.length;i++)for(const q of adjacent(part[i],w,h))if(occupied[q]&&!boundary.has(q)&&!insideSeen.has(q)){insideSeen.add(q);part.push(q);}
  if(part.length<4){collapsedFillPockets++;for(const q of part)boundary.add(q);}
 }
 const cells=thinMask(boundary,w);
 if(!cells.size)throw Error('No resolvable source silhouette; no outline was allocated');
 if([...featureCells].some(p=>cells.has(p)))throw Error('Eye/exterior ownership conflict: return to source assignment or grid capacity; do not omit the required rim');
 if(materialInterior&&[...materialInterior.keys()].some(p=>cells.has(p)))throw Error('Material/contour ownership conflict: return to source assignment or grid capacity; do not omit the required rim');
 const entries=palette.map(p=>({...p,value:parseInt(p.hex.slice(1)+'ff',16)})),ink=policy.colors.map(c=>entries.find(p=>p.hex===c));
 const inkValues=new Set(ink.map(c=>c.value));
 const nearest=(r,g,b,list)=>{let best=Infinity,choice=null;for(const p of list){const d=(r-p.rgb[0])**2+(g-p.rgb[1])**2+(b-p.rgb[2])**2;if(d<best){best=d;choice=p;}}return choice.value;};
 const out=new PNG({width:w,height:h});input.data.copy(out.data);
 const band=new Set(),protectedCells=new Set(),expected=[],unresolved=[];
 for(let p=0;p<w*h;p++){
  const x=p%w,y=Math.floor(p/w),sx=(x+.5)*step,sy=(y+.5)*step;
  if(materialInterior?.has(p)||featureCells.has(p)||protectedRegions.some(([a,b,c,d])=>x*step<a+c&&(x+1)*step>a&&y*step<b+d&&(y+1)*step>b)){protectedCells.add(p);continue;}
  const before=input.data.readUInt32BE(p*4),near=cells.has(p)||adjacent(p,w,h).some(q=>cells.has(q));
  if(!near)continue;
  band.add(p);
  const votes=new Map(),fills=new Map();
  const radius=Math.ceil(step*1.5);
  for(let yy=Math.max(0,Math.floor(sy)-radius);yy<Math.min(sh,Math.ceil(sy)+radius);yy++)for(let xx=Math.max(0,Math.floor(sx)-radius);xx<Math.min(sw,Math.ceil(sx)+radius);xx++){
   const q=yy*sw+xx,k=q*4;
   // Sample actual ink just inside the source edge, not its background-mixed
   // antialias fringe. Placement still belongs exclusively to the silhouette.
   if(foreground[q]){const c=nearest(source.data[k],source.data[k+1],source.data[k+2],ink),entry=ink.find(v=>v.value===c);
    const error=entry.rgb.reduce((sum,v,i)=>sum+(v-source.data[k+i])**2,0);
    const weight=1/((1+(xx-sx)**2+(yy-sy)**2)*(25+error));votes.set(c,(votes.get(c)||0)+weight);}
   if(foreground[q]&&xx>=x*step&&xx<(x+1)*step&&yy>=y*step&&yy<(y+1)*step){const c=nearest(source.data[k],source.data[k+1],source.data[k+2],entries);if(c!==bg&&!inkValues.has(c))fills.set(c,(fills.get(c)||0)+1);}
  }
  const winner=m=>[...m].sort((a,b)=>b[1]-a[1]||a[0]-b[0])[0]?.[0];
  let color=before;
  if(cells.has(p)){color=winner(votes);if(color===undefined){unresolved.push(p);continue;}expected.push([p,color]);}
  else if(!occupied[p])color=bg;
  else if(before===bg||(inkValues.has(before)&&fills.size&&[...fills.values()].reduce((a,b)=>a+b,0)>step*step*.5))color=winner(fills)??before;
  out.data.writeUInt32BE(color,p*4);
 }
 // Optional integration of observed stroke ownership. A new rim cannot leave
 // the old source rim underneath it. Transfer only the immediately adjoining
 // redundant ink from a connected interior material cell, never from a broad
 // source-color search or across the contour. Protected features remain locked.
 const strokeColors=policy.sourceStrokeColors??[];
 if(!Array.isArray(strokeColors)||strokeColors.some(c=>!policy.colors.includes(c))||
    (strokeColors.length&&!policy.sourceStrokeObservation))throw Error('Explicit source stroke observation required');
 const strokeValues=new Set(strokeColors.map(c=>parseInt(c.slice(1)+'ff',16)));
 const replacedRim=[];
 if(strokeValues.size){
  const owner=new Int32Array(w*h).fill(-1),distance=new Int16Array(w*h).fill(-1),queue=[];
  for(let p=0;p<w*h;p++)if(occupied[p]&&!cells.has(p)&&!strokeValues.has(input.data.readUInt32BE(p*4))&&input.data.readUInt32BE(p*4)!==bg){owner[p]=p;distance[p]=0;queue.push(p);}
  for(let i=0;i<queue.length;i++)for(const q of adjacent(queue[i],w,h))if(occupied[q]&&!cells.has(q)&&distance[q]<0){owner[q]=owner[queue[i]];distance[q]=distance[queue[i]]+1;queue.push(q);}
  for(let p=0;p<w*h;p++){
   if(cells.has(p)||protectedCells.has(p)||!occupied[p]||!strokeValues.has(out.data.readUInt32BE(p*4)))continue;
   const x=p%w,y=Math.floor(p/w);
   // A diagonal touch alone is not a parallel, redundant rim. It may be an
   // interior contact line meeting a concave silhouette corner. Keep that
   // ownership; the combined rendered-block check below still rejects width.
   const near=adjacent(p,w,h).some(q=>cells.has(q));
   if(!near)continue;
   let fill=owner[p]>=0&&distance[p]<=2?input.data.readUInt32BE(owner[p]*4):null;
   let sourceDistance=null;
   if(fill===null){
    // A tapered tip may have no full native material cell. Search only along
    // its ORIGINAL connected foreground, within two cells, for actual pigment.
    // Do not borrow across empty space or substitute another arbitrary color.
    const start=Math.floor((y+.5)*step)*sw+Math.floor((x+.5)*step),seen=new Set([start]),pending=[[start,0]];
    for(let i=0;i<pending.length&&fill===null;i++){
     const [q,d]=pending[i];if(!foreground[q]||d>step*2)continue;
     const k=q*4,c=nearest(source.data[k],source.data[k+1],source.data[k+2],entries);
     if(c!==bg&&!strokeValues.has(c)){fill=c;sourceDistance=d;break;}
     for(const r of adjacent(q,sw,sh))if(!seen.has(r)&&foreground[r]){seen.add(r);pending.push([r,d+1]);}
    }
   }
   if(fill===null){unresolved.push(p);continue;}
   band.add(p);out.data.writeUInt32BE(fill,p*4);replacedRim.push({pixel:p,materialSource:owner[p],distance:distance[p],sourceDistance});
  }
  // Thinned diagonal corners can leave source-occupied cells on the exterior
  // side of the new path. The same path must own both the ink and its fill.
  const exterior=new Set(),pending=[];
  const offer=p=>{if(!cells.has(p)&&!exterior.has(p)){exterior.add(p);pending.push(p);}};
  for(let x=0;x<w;x++){if(!occupied[x])offer(x);if(!occupied[(h-1)*w+x])offer((h-1)*w+x);}
  for(let y=0;y<h;y++){if(!occupied[y*w])offer(y*w);if(!occupied[y*w+w-1])offer(y*w+w-1);}
  for(let i=0;i<pending.length;i++)for(const q of adjacent(pending[i],w,h))offer(q);
  for(const p of band)if(exterior.has(p)&&!protectedCells.has(p))out.data.writeUInt32BE(bg,p*4);
 }
 let changedPixels=0,outsideBandChanges=0,protectedChanges=0;
 for(let p=0;p<w*h;p++)if(out.data.readUInt32BE(p*4)!==input.data.readUInt32BE(p*4)){changedPixels++;if(!band.has(p))outsideBandChanges++;if(protectedCells.has(p))protectedChanges++;}
 const missingPathPixels=expected.filter(([p,c])=>out.data.readUInt32BE(p*4)!==c).length;
 let solidPathBlocks=0;for(let y=0;y<h-1;y++)for(let x=0;x<w-1;x++){const p=y*w+x;if([p,p+1,p+w,p+w+1].every(q=>cells.has(q)))solidPathBlocks++;}
 let solidRenderedStrokeBlocks=0;const renderedBlockLocations=[];
 if(strokeValues.size)for(let y=0;y<h-1;y++)for(let x=0;x<w-1;x++){const p=y*w+x,block=[p,p+1,p+w,p+w+1];if(block.some(q=>cells.has(q))&&block.every(q=>strokeValues.has(out.data.readUInt32BE(q*4)))){solidRenderedStrokeBlocks++;renderedBlockLocations.push([x,y]);}}
 if(unresolved.length||outsideBandChanges||protectedChanges||missingPathPixels||solidPathBlocks||solidRenderedStrokeBlocks)throw Error('Silhouette allocation unresolved: '+JSON.stringify({unresolved,outsideBandChanges,protectedChanges,missingPathPixels,solidPathBlocks,solidRenderedStrokeBlocks,renderedBlockLocations}));
 return {image:out,report:{method:'source-silhouette-width',logicalWidth:1,changedPixels,outsideBandChanges,protectedChanges,
  colors:policy.colors,pathCells:expected.map(([p])=>p),sourceBand:[...band],expectedColors:expected,
  sourceGeometry:{chains:shape.report.sharedChains,gaps:shape.report.gaps,conflicts:shape.report.conflicts,unresolvedSourceIslands,collapsedFillPockets,materialForegroundPixels},
  savedWidth:{missingPathPixels,solidPathBlocks,solidRenderedStrokeBlocks:strokeValues.size?solidRenderedStrokeBlocks:null,renderedStrokeChecked:strokeValues.size>0},replacedRim,
  limitation:'Explicit uniform backdrop and source foreground classification. Preserved regions excluded; visual thickness and narrow strands require saved review.'}};
}
function protectOutlineFeatures(policy,eyePolicy,formPolicy){
 if(policy.mode!=='source-silhouette-width')return policy;
 if(formPolicy?.features?.some(f=>f.kind!=='stroke'))throw Error('Silhouette outline can share ownership only with observed stroke forms');
 const featureRegions=[...(eyePolicy?.eyes??[]).filter(e=>!e.sourcePolygon).map(e=>e.rect),...(formPolicy?.features??[]).map(f=>f.sourceRegion)];
 return {...policy,protectedSourceRegions:[...(policy.protectedSourceRegions??[]),...featureRegions],protectedSourceShapes:(eyePolicy?.eyes??[]).filter(e=>e.sourcePolygon).map(e=>({rect:e.rect,sourcePolygon:e.sourcePolygon}))};
}
module.exports={rasterOutlineContour,inspectSavedOutline,allocateOnePixelOutline,inspectOnePixelOutline,allocateSilhouetteOutline,protectOutlineFeatures};
