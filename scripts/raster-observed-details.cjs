'use strict';
// Source annotations identify a search window and observed role colors only.
// Recover compact missing regions, or resample a demonstrably thin profile.
// Neither mode accepts output coordinates or a prescribed expression pattern.
function rasterObservedDetails(PNG,source,baseline,grid,features,palette){
 if(!Array.isArray(palette)||!palette.length)throw Error('Fixed palette required');
 const allowedColors=new Set(palette.map(p=>parseInt(p.hex.slice(1)+'ff',16)));
 if(!Array.isArray(features))throw Error('Observed details must be an array');
 for(const [axis,count] of [['x',baseline.width],['y',baseline.height]]){
  if(!Array.isArray(grid?.[axis])||grid[axis].length!==count)throw Error('Measured grid and baseline dimensions differ');
  grid[axis].forEach((v,i)=>{if(!Array.isArray(v)||v.length!==2||!v.every(Number.isFinite)||v[1]<=v[0]||i&&Math.abs(v[0]-grid[axis][i-1][1])>1e-6)throw Error('Invalid measured grid');});
 }
 for(let p=0;p<baseline.width*baseline.height;p++)if(!allowedColors.has(baseline.data.readUInt32BE(p*4)))throw Error('Baseline outside fixed palette');
 const allowedCells=new Set(),claimed=new Map();
 for(const f of features){
  if(!f||Object.keys(f).some(k=>!['name','sourceRegion','colors','mode','observation'].includes(k))||typeof f.name!=='string'||!f.name.trim())throw Error('Source-only feature annotation required');
  if(!['compact-islands','thin-profile','curve-profile'].includes(f.mode))throw Error('Unknown observed detail mode');
  if(!Array.isArray(f.sourceRegion)||f.sourceRegion.length!==4)throw Error('Invalid source region');
  const [x,y,w,h]=f.sourceRegion;
  if(![x,y,w,h].every(Number.isSafeInteger)||x<0||y<0||w<=0||h<=0||x+w>source.width||y+h>source.height)throw Error('Invalid source region');
  if(!Array.isArray(f.colors)||!f.colors.length||f.colors.some(c=>!/^#[0-9a-f]{6}$/i.test(c)||!allowedColors.has(parseInt(c.slice(1)+'ff',16))))throw Error('Observed role color outside fixed palette');
  for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++)if(!allowedColors.has(source.data.readUInt32BE((yy*source.width+xx)*4)))throw Error('Source checkpoint outside fixed palette');
  for(let yy=0;yy<baseline.height;yy++)for(let xx=0;xx<baseline.width;xx++)if(grid.x[xx][0]<x+w&&grid.x[xx][1]>x&&grid.y[yy][0]<y+h&&grid.y[yy][1]>y)allowedCells.add(yy*baseline.width+xx);
 }
 const image=new PNG({width:baseline.width,height:baseline.height});baseline.data.copy(image.data);
 const W=baseline.width,H=baseline.height,reports=[];
 const map=(axis,v)=>{let i=0;while(i+1<grid[axis].length&&v>=grid[axis][i][1])i++;const [a,b]=grid[axis][i];return i+(v-a)/(b-a);};
 const unpack=c=>[(c>>>24)&255,(c>>>16)&255,(c>>>8)&255];
 for(const f of features){
  const [rx,ry,rw,rh]=f.sourceRegion,colors=new Set(f.colors.map(c=>parseInt(c.slice(1)+'ff',16))),seen=new Set(),parts=[];
  for(let y=ry;y<ry+rh;y++)for(let x=rx;x<rx+rw;x++){
   const p=y*source.width+x;if(seen.has(p)||!colors.has(source.data.readUInt32BE(p*4)))continue;
   const points=[p];seen.add(p);let border=false;
   for(let k=0;k<points.length;k++){
    const q=points[k],xx=q%source.width,yy=Math.floor(q/source.width);border ||= xx===rx||xx===rx+rw-1||yy===ry||yy===ry+rh-1;
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
     const u=xx+dx,v=yy+dy,n=v*source.width+u;
     if(u<rx||v<ry||u>=rx+rw||v>=ry+rh||seen.has(n)||!colors.has(source.data.readUInt32BE(n*4)))continue;
     seen.add(n);points.push(n);
    }
   }
   const cells=new Map(),bounds=[Infinity,Infinity,-Infinity,-Infinity];
   for(const q of points){const x=q%source.width,y=Math.floor(q/source.width);bounds[0]=Math.min(bounds[0],x);bounds[1]=Math.min(bounds[1],y);bounds[2]=Math.max(bounds[2],x+1);bounds[3]=Math.max(bounds[3],y+1);
    for(let gy=Math.max(0,Math.floor(map('y',y)));gy<Math.min(H,Math.ceil(map('y',y+1)));gy++)
     for(let gx=Math.max(0,Math.floor(map('x',x)));gx<Math.min(W,Math.ceil(map('x',x+1)));gx++){
      const [a,b]=grid.x[gx],[c,d]=grid.y[gy],area=Math.max(0,Math.min(b,x+1)-Math.max(a,x))*Math.max(0,Math.min(d,y+1)-Math.max(c,y))/((b-a)*(d-c));
      if(!area)continue;const n=gy*W+gx,v=cells.get(n)||{area:0,colors:new Map(),points:[]};v.area+=area;
      const color=source.data.readUInt32BE(q*4);v.colors.set(color,(v.colors.get(color)||0)+area);v.points.push(q);cells.set(n,v);
     }
   }
   parts.push({points,set:new Set(points),cells,border,bounds});
  }
  const changes=[],decisions=[],partAt=new Map();
  parts.forEach((part,id)=>part.points.forEach(p=>partAt.set(p,id)));
  const sourceParts=parts.slice();
  const shade=(part,v,centralAxis=null)=>{
   // Weight observed interior samples; do not select an antialiased edge merely
   // because the cell centre fell on it. Only observed role colors can win.
   const votes=new Map();
   let samples=v.points;
   if(centralAxis){
    const columns=new Map();for(const p of part.points){const a=centralAxis==='x'?p%source.width:Math.floor(p/source.width),b=centralAxis==='x'?Math.floor(p/source.width):p%source.width,list=columns.get(a)||[];list.push(b);columns.set(a,list);}
    samples=v.points.filter(p=>{const a=centralAxis==='x'?p%source.width:Math.floor(p/source.width),b=centralAxis==='x'?Math.floor(p/source.width):p%source.width,list=columns.get(a).slice().sort((a,b)=>a-b);return b===list[Math.floor(list.length/2)];});
    if(!samples.length)samples=v.points;
   }
   for(const p of samples){let interior=1;for(const q of [p-1,p+1,p-source.width,p+source.width])if(part.set.has(q))interior++;
    const color=source.data.readUInt32BE(p*4);votes.set(color,(votes.get(color)||0)+interior);}
   return [...votes].sort((a,b)=>b[1]-a[1]||a[0]-b[0])[0][0];
  };
  const write=(p,c)=>{const old=image.data.readUInt32BE(p*4);if(old!==c){
   if(claimed.has(p)&&claimed.get(p)!==f)throw Error('Conflicting observed detail scopes');
   if(!allowedColors.has(c)||!allowedCells.has(p))throw Error('Detail assignment exceeds palette or source scope');
   claimed.set(p,f);image.data.writeUInt32BE(c,p*4);changes.push({cell:[p%W,Math.floor(p/W)],before:old.toString(16),after:c.toString(16)});
  }};
  for(const part of parts.sort((a,b)=>b.points.length-a.points.length)){
   const [x0,y0,x1,y1]=part.bounds,span=[map('x',x1)-map('x',x0),map('y',y1)-map('y',y0)],area=[...part.cells.values()].reduce((a,b)=>a+b.area,0);
   if(part.border||part.points.length<3){decisions.push({bounds:part.bounds,reason:part.border?'source-crosses-search-boundary':'source-fragment'});continue;}
   if(f.mode==='compact-islands'){
    if(area<.04||area>1||Math.max(...span)>1.5||Math.max(...span)/Math.min(...span)>3){decisions.push({bounds:part.bounds,reason:'not-compact-subcell-region'});continue;}
    const light=c=>{const [r,g,b]=unpack(c);return (.2126*r+.7152*g+.0722*b)/255;};
    const ring=new Set();for(const p of part.points)for(const q of [p-1,p+1,p-source.width,p+source.width])if(!part.set.has(q))ring.add(q);
    const centerLight=part.points.reduce((n,p)=>n+light(source.data.readUInt32BE(p*4)),0)/part.points.length;
    const ringLight=[...ring].reduce((n,p)=>n+light(source.data.readUInt32BE(p*4)),0)/ring.size;
    if(centerLight-ringLight<.12){decisions.push({bounds:part.bounds,reason:'not-a-contrasting-light-island',contrast:centerLight-ringLight});continue;}
    const cx=part.points.reduce((n,p)=>n+p%source.width+.5,0)/part.points.length,cy=part.points.reduce((n,p)=>n+Math.floor(p/source.width)+.5,0)/part.points.length;
    const step=grid.x[Math.max(0,Math.min(W-1,Math.floor(map('x',cx))))].reduce((a,b)=>b-a);
    const radius=Math.max(1,Math.round(step*.65));
    const ringSamples=[[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]].map(([dx,dy])=>{
     const x=Math.max(0,Math.min(source.width-1,Math.floor(cx)+dx*radius)),y=Math.max(0,Math.min(source.height-1,Math.floor(cy)+dy*radius));
     return light(source.data.readUInt32BE((y*source.width+x)*4));
    });
    if(ringSamples.filter(v=>centerLight-v>=.12).length<6){decisions.push({bounds:part.bounds,reason:'light-region-not-enclosed'});continue;}
    // Quantization can break a sclera/background edge into tiny islands. Do not
    // count fragments beside an already represented larger light region as a
    // new reflection. Compare actual source pixels, not overlapping bboxes.
    const gap=Math.max(1,Math.round(step*.25));let nearRepresented=false;
    for(const p of part.points){const x=p%source.width,y=Math.floor(p/source.width);
     for(let dy=-gap;dy<=gap&&!nearRepresented;dy++)for(let dx=-gap;dx<=gap;dx++){
      if(dx*dx+dy*dy>gap*gap||x+dx<0||x+dx>=source.width||y+dy<0||y+dy>=source.height)continue;const q=(y+dy)*source.width+x+dx,id=partAt.get(q),other=id===undefined?null:sourceParts[id];
      if(!other||other===part||other.points.length<=part.points.length)continue;
      if([...other.cells].some(([n,v])=>v.area>=.03&&colors.has(baseline.data.readUInt32BE(n*4)))){nearRepresented=true;break;}
     }
     if(nearRepresented)break;
    }
    if(nearRepresented){decisions.push({bounds:part.bounds,reason:'fragment-near-represented-light-region'});continue;}
    const existing=[...part.cells].filter(([p,v])=>v.area>=.03&&colors.has(image.data.readUInt32BE(p*4)));
    if(existing.length){decisions.push({bounds:part.bounds,reason:'already-represented'});continue;}
    const [p,v]=[...part.cells].sort((a,b)=>b[1].area-a[1].area||a[0]-b[0])[0];
    if(v.area<.05){decisions.push({bounds:part.bounds,reason:'insufficient-cell-support'});continue;}
    write(p,shade(part,v));decisions.push({bounds:part.bounds,reason:'missing-source-island',sourceArea:area});
   }else if(f.mode==='thin-profile'||f.mode==='curve-profile'){
    const horizontal=span[0]>=span[1],axis=horizontal?'x':'y',other=horizontal?'y':'x',lo=horizontal?x0:y0,hi=horizontal?x1:y1;
    const columns=new Map();
    for(const p of part.points){const a=horizontal?p%source.width:Math.floor(p/source.width),b=horizontal?Math.floor(p/source.width):p%source.width,v=columns.get(a)||[];v.push(b);columns.set(a,v);}
    const widths=[...columns].map(([a,v])=>map(other,Math.max(...v)+1)-map(other,Math.min(...v)));
    const width=widths.sort((a,b)=>a-b)[Math.floor(widths.length/2)];
    if(Math.max(...widths)>=1.5||Math.max(...span)<1.25){decisions.push({bounds:part.bounds,reason:'not-a-thin-profile',width,maxWidth:Math.max(...widths)});continue;}
    const start=Math.round(map(axis,lo)),end=Math.round(map(axis,hi)),target=new Map();
    if(end<=start){decisions.push({bounds:part.bounds,reason:'no-span'});continue;}
    for(let a=start;a<end;a++){
     const candidates=[...part.cells].filter(([p])=>(horizontal?p%W:Math.floor(p/W))===a).sort((u,v)=>v[1].area-u[1].area||u[0]-v[0]);
     if(!candidates.length)continue;target.set(candidates[0][0],shade(part,candidates[0][1],axis));
    }
    if(f.mode==='curve-profile'){
     // Quantize a shared source profile phase, not independent area winners.
     // Terminal columns describe actual endpoints; a cell-wide vote can hide
     // their turn. No prescribed smile, destination coordinates or extra cells.
     const profile=[];
     for(let a=start;a<end;a++){
      const candidates=[...part.cells].filter(([p])=>(horizontal?p%W:Math.floor(p/W))===a);
      let points=candidates.flatMap(([,v])=>v.points);
      if(a===start||a===end-1){const terminal=a===start?lo:hi-1;points=part.points.filter(p=>(horizontal?p%source.width:Math.floor(p/source.width))===terminal);}
      if(!points.length)break;
      const center=points.reduce((s,p)=>s+map(other,(horizontal?Math.floor(p/source.width):p%source.width)+.5),0)/points.length;
      profile.push({a,center,candidates});
     }
     const sourceRange=profile.length?Math.max(...profile.map(p=>p.center))-Math.min(...profile.map(p=>p.center)):0;
     const requiredRange=Math.round(sourceRange);let best=null;
     for(let phase=-16;phase<=16&&profile.length===end-start;phase++){
      const route=[];let score=0,valid=true;
      for(const p of profile){const row=Math.floor(p.center+phase/32),cell=horizontal?row*W+p.a:p.a*W+row;
       const supported=p.candidates.find(([q])=>q===cell);
       if(!supported||route.length&&Math.abs(row-route.at(-1).row)>1){valid=false;break;}
       route.push({cell,row,value:supported[1]});score+=(row+.5-p.center)**2;
      }
      if(!valid||Math.max(...route.map(r=>r.row))-Math.min(...route.map(r=>r.row))!==requiredRange)continue;
      if(!best||score<best.score-1e-9)best={score,route,phase:phase/32};
     }
     if(!best){decisions.push({bounds:part.bounds,reason:'whole-profile-does-not-fit-source-supported-cells',sourceRange});continue;}
     target.clear();for(const r of best.route)target.set(r.cell,shade(part,r.value,axis));
     decisions.push({bounds:part.bounds,reason:'joint-source-profile-phase',sourceRange,requiredRange,phase:best.phase});
    }
    // The source profile must remain adjacent on the grid; no invented corner
    // or connecting pixel is appended to make an invalid profile pass.
    const ps=[...target.keys()];
    if(ps.length!==end-start||ps.some((p,i)=>i&&Math.abs((horizontal?Math.floor(p/W):p%W)-(horizontal?Math.floor(ps[i-1]/W):ps[i-1]%W))>1)){
     decisions.push({bounds:part.bounds,reason:'profile-needs-more-than-one-row-step'});continue;
    }
    // Clear only old role cells overlapping THIS component, using actual
    // non-role source support. Unrelated skin, nose, eyes and hair stay fixed.
    for(const [p,v] of part.cells){
     if(target.has(p)||!colors.has(image.data.readUInt32BE(p*4)))continue;
     const gx=p%W,gy=Math.floor(p/W),[a,b]=grid.x[gx],[c,d]=grid.y[gy],votes=new Map();
     for(let yy=Math.max(0,Math.floor(c));yy<Math.min(source.height,Math.ceil(d));yy++)for(let xx=Math.max(0,Math.floor(a));xx<Math.min(source.width,Math.ceil(b));xx++){
      const color=source.data.readUInt32BE((yy*source.width+xx)*4);if(!colors.has(color))votes.set(color,(votes.get(color)||0)+1);
     }
     if(votes.size)write(p,[...votes].sort((u,v)=>v[1]-u[1])[0][0]);
    }
    for(const [p,c] of target)write(p,c);
    decisions.push({bounds:part.bounds,reason:'source-profile-resampled',width,cells:ps.length});
   }else throw Error('Unknown observed detail mode');
  }
  reports.push({name:f.name,mode:f.mode,changes,decisions});
 }
 let changedCells=0,outsideChangedCells=0;
 for(let p=0;p<W*H;p++)if(image.data.readUInt32BE(p*4)!==baseline.data.readUInt32BE(p*4)){changedCells++;if(!allowedCells.has(p))outsideChangedCells++;}
 return {image,report:{method:'source-component-completeness',changedCells,outsideChangedCells,features:reports,
  limitation:'Source search/color annotations required. Compact light recovery and single-valued thin profiles only; no complete face fidelity verdict. Compare the reopened PNG.'}};
}
// Flat semantic color planes. Samples describe colors observed in the source,
// not destination dots. Null output colors are protected context (skin/hair).
// This does not invent a pupil, sclera or highlight when absent from the source.
function rasterFlatColorRegions(PNG,source,baseline,features,roles,cell,palette){
 if(!Number.isSafeInteger(cell)||cell<1||source.width!==baseline.width*cell||source.height!==baseline.height*cell)throw Error('Uniform source/grid correspondence required');
 const allowed=new Set(palette.map(p=>p.hex.toUpperCase()));
 const rgb=v=>Array.isArray(v)&&v.length===3&&v.every(n=>Number.isInteger(n)&&n>=0&&n<=255);
 if(!roles.length||roles.some(r=>!r.name||!r.samples?.length||!r.samples.every(rgb)||r.color!==null&&!allowed.has(r.color?.toUpperCase())))throw Error('Observed role samples and fixed palette colors required');
 for(const f of features){
  const [x,y,w,h]=f.rect??[];
  if(!f.name||![x,y,w,h].every(Number.isSafeInteger)||x<0||y<0||w<=0||h<=0||x+w>source.width||y+h>source.height)throw Error('Invalid source search region');
  if(f.editableColors!==undefined&&(!Array.isArray(f.editableColors)||!f.editableColors.length||f.editableColors.some(c=>!allowed.has(c))))throw Error('Editable material colors must belong to the fixed palette');
 }
 for(let p=0;p<baseline.width*baseline.height;p++){
  const hex='#'+baseline.data.subarray(p*4,p*4+3).toString('hex').toUpperCase();
  if(!allowed.has(hex)||baseline.data[p*4+3]!==255)throw Error('Baseline must use opaque fixed palette');
 }
 const image=new PNG({width:baseline.width,height:baseline.height});baseline.data.copy(image.data);
 const changes=[],claimed=new Set(),distance=(a,b)=>a.reduce((s,v,i)=>s+(v-b[i])**2,0);
 for(const f of features){
  const [x,y,w,h]=f.rect;
  for(let gy=Math.floor(y/cell);gy<Math.ceil((y+h)/cell);gy++)for(let gx=Math.floor(x/cell);gx<Math.ceil((x+w)/cell);gx++){
   const counts=roles.map(()=>0);let total=0;
   for(let sy=gy*cell;sy<(gy+1)*cell;sy++)for(let sx=gx*cell;sx<(gx+1)*cell;sx++){
    if(sx<x||sx>=x+w||sy<y||sy>=y+h)continue;
    const i=(sy*source.width+sx)*4;
    if(source.data[i+3]!==255)throw Error('Opaque source required');
    const sample=[...source.data.subarray(i,i+3)];
    const scores=roles.map(r=>Math.min(...r.samples.map(v=>distance(v,sample))));
    counts[scores.indexOf(Math.min(...scores))]++;total++;
   }
   if(total<cell*cell*.5)continue;
   const best=counts.indexOf(Math.max(...counts)),role=roles[best];
   // No minority-role promotion to meet a desired count or position score.
   if(!role.color||counts[best]<cell*cell*.3)continue;
   const p=(gy*baseline.width+gx)*4,c=parseInt(role.color.slice(1)+'ff',16);
   // An observed pigment may share a source cell with an eyelid, hair or glove.
   // Optional local color work cannot take ownership of that other material.
   const oldHex='#'+baseline.data.subarray(p,p+3).toString('hex').toUpperCase();
   if(f.editableColors&&!f.editableColors.includes(oldHex))continue;
   if(claimed.has(p))throw Error('Overlapping flat-region assignments');claimed.add(p);
   if(image.data.readUInt32BE(p)!==c){image.data.writeUInt32BE(c,p);changes.push({feature:f.name,cell:[gx,gy],role:role.name,coverage:counts[best]/(cell*cell)});}
  }
 }
 return {image,report:{method:'observed-flat-color-planes',changes,limitation:'Observed source samples and aligned uniform grid required. No highlight reservation or whole-eye fidelity guarantee. Review the saved image.'}};
}
// Explicit capacity decisions are source observations, not destination strokes.
// Required thin components receive a connected one-cell representation before
// area colours can erase them. Optional subcell components are not promoted.
function sourceCellOwnership(PNG,source,grid,palette,background){
 // Preserve the supplied source intervals, including phase and clipped last
 // cells. Fitting the whole source to native dimensions changes this mapping.
 const quantized=require('./build-palette-native.cjs').buildNative(PNG,source,palette,source.width,source.height,background,'nearest').image;
 const colors=palette.map(p=>parseInt(p.hex.slice(1)+'ff',16)),indices=new Map(colors.map((c,i)=>[c,i])),bg=indices.get(parseInt(background.slice(1)+'ff',16));
 const out=new PNG({width:grid.x.length,height:grid.y.length});
 const index=(x,y)=>x<0||y<0||x>=source.width||y>=source.height?bg:indices.get(quantized.data.readUInt32BE((y*source.width+x)*4));
 for(let y=0;y<out.height;y++)for(let x=0;x<out.width;x++){
  const [l,r]=grid.x[x],[t,b]=grid.y[y],total=(r-l)*(b-t),votes=new Float64Array(colors.length);let covered=0;
  for(let yy=Math.max(0,Math.floor(t));yy<Math.min(source.height,Math.ceil(b));yy++)for(let xx=Math.max(0,Math.floor(l));xx<Math.min(source.width,Math.ceil(r));xx++){
   const area=(Math.min(r,xx+1)-Math.max(l,xx))*(Math.min(b,yy+1)-Math.max(t,yy));votes[index(xx,yy)]+=area;covered+=area;
  }
  votes[bg]+=Math.max(0,total-covered);let chosen=index(Math.floor((l+r)/2),Math.floor((t+b)/2));
  for(let k=0;k<votes.length;k++)if(votes[k]>votes[chosen]+total*1e-10)chosen=k;
  out.data.writeUInt32BE(colors[chosen],(y*out.width+x)*4);
 }
 return out;
}
function allocateRequiredForms(PNG,source,baseline,grid,palette,policy){
 const fail=m=>{throw Error('Form policy: '+m);};
 if(policy?.version!==1||!Array.isArray(policy.features)||!policy.features.length)fail('observed features required');
 const {toLab}=require('./build-palette-native.cjs');
 // Reuse the established grid/palette validation even for exterior-only jobs.
 rasterObservedDetails(PNG,source,baseline,grid,[],palette);
 const allowed=new Map(palette.map(p=>[p.hex,parseInt(p.hex.slice(1)+'ff',16)]));
 const image=new PNG({width:baseline.width,height:baseline.height});baseline.data.copy(image.data);
 const reserved=new Map(),reports=[],unresolved=[];
 const assign=(p,color,name)=>{if(reserved.has(p)&&reserved.get(p).color!==color)fail('required forms compete for a cell');reserved.set(p,{color,name});image.data.writeUInt32BE(color,p*4);};
 const dist=(a,b)=>a.reduce((s,v,i)=>s+(v-b[i])**2,0);
 for(const f of [...policy.features].sort((a,b)=>(a.priority==='required'?0:1)-(b.priority==='required'?0:1))){
  if(Object.keys(f).some(k=>!['name','kind','priority','observation','sourceRegion','color','samples','contextSamples','background'].includes(k)))fail('output coordinates and unknown fields forbidden');
  if(!f.name||!f.observation||!['required','optional'].includes(f.priority)||!['stroke','exterior'].includes(f.kind)||!allowed.has(f.color))fail('invalid observed role');
  const color=allowed.get(f.color);
  if(f.kind==='exterior'){
   if(f.priority!=='required'||!allowed.has(f.background)||f.background===f.color)fail('explicit required exterior and background needed');
   // Geometry only: reuse the silhouette mask, not its proposed thinning edits.
   // This is an explicit continuous outline decision, never a default for photos.
   // Read capacity from the source placement, never from a previously inked
   // output: otherwise each verification would consume more material capacity.
   const ownership=sourceCellOwnership(PNG,source,grid,palette,f.background);
   const contour=require('./raster-outline-contour.cjs').rasterOutlineContour(PNG,ownership,palette,f.background,[f.color],source,grid,{operation:'thin-only'});
   const materialLabs=new Map(palette.map(p=>[allowed.get(p.hex),toLab(p.rgb)]));
   let cells=0,materialOnlyCells=0;for(let p=0;p<contour.edge.length;p++)if(contour.edge[p]){
    const x=p%baseline.width,y=Math.floor(p/baseline.width),material=materialLabs.get(ownership.data.readUInt32BE(p*4));let hasInterior=false;
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const xx=x+dx,yy=y+dy;if(xx>=0&&yy>=0&&xx<baseline.width&&yy<baseline.height){const q=yy*baseline.width+xx,c=ownership.data.readUInt32BE(q*4);if(contour.depth[q]>=2&&c!==color&&dist(material,materialLabs.get(c))<.15**2)hasInterior=true;}}
    // A one-cell wire/ring/tip has no separate interior colour budget. Replacing
    // its only material cell with outline would erase the object, not outline it.
    // A neighbouring different object/ink is not interior material capacity.
    if(!hasInterior&&ownership.data.readUInt32BE(p*4)!==color){materialOnlyCells++;continue;}
    assign(p,color,f.name);cells++;
   }
   reports.push({name:f.name,kind:f.kind,priority:f.priority,action:'one-cell-silhouette-boundary',cells,materialOnlyCells});continue;
  }
  const [rx,ry,rw,rh]=f.sourceRegion??[];
  if(![rx,ry,rw,rh].every(Number.isSafeInteger)||rx<0||ry<0||rw<1||rh<1||rx+rw>source.width||ry+rh>source.height)fail('source search region required');
  const valid=s=>Array.isArray(s)&&s.length>0&&s.every(c=>Array.isArray(c)&&c.length===3&&c.every(v=>Number.isFinite(v)&&v>=0&&v<=255));
  if(!valid(f.samples)||!valid(f.contextSamples))fail('source stroke and context colour observations required');
  const ink=f.samples.map(toLab),context=f.contextSamples.map(toLab),mask=new Set();
  for(let y=ry;y<ry+rh;y++)for(let x=rx;x<rx+rw;x++){
   const p=y*source.width+x,lab=toLab([...source.data.subarray(p*4,p*4+3)]);
   if(Math.min(...ink.map(c=>dist(c,lab)))<Math.min(...context.map(c=>dist(c,lab))))mask.add(p);
  }
  const seen=new Set(),parts=[];
  for(const p of mask)if(!seen.has(p)){
   const part=[p];seen.add(p);for(let i=0;i<part.length;i++){const x=part[i]%source.width,y=Math.floor(part[i]/source.width);for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
    const q=(y+dy)*source.width+x+dx;if(x+dx>=rx&&x+dx<rx+rw&&y+dy>=ry&&y+dy<ry+rh&&mask.has(q)&&!seen.has(q)){seen.add(q);part.push(q);}
   }}parts.push(part);
  }
  parts.sort((a,b)=>b.length-a.length);
  const main=parts[0];if(!main){if(f.priority==='required')unresolved.push(f.name);reports.push({name:f.name,action:'no-source-component'});continue;}
  if(parts[1]?.length>=main.length/2){if(f.priority==='required')unresolved.push(f.name);reports.push({name:f.name,action:'multiple-comparable-components-require-separate-observations'});continue;}
  const xs=main.map(p=>p%source.width),ys=main.map(p=>Math.floor(p/source.width));
  const bounds=[Math.min(...xs),Math.min(...ys),Math.max(...xs)+1,Math.max(...ys)+1];
  if(main.some(p=>p%source.width===rx||p%source.width===rx+rw-1||Math.floor(p/source.width)===ry||Math.floor(p/source.width)===ry+rh-1)){
   unresolved.push(f.name);reports.push({name:f.name,action:'search-region-clips-source'});continue;
  }
  const cellX=grid.x[0][1]-grid.x[0][0],cellY=grid.y[0][1]-grid.y[0][0];
  const span=[(bounds[2]-bounds[0])/cellX,(bounds[3]-bounds[1])/cellY];
  const contextColor=palette.filter(p=>p.hex!==f.color).reduce((a,b)=>Math.min(...context.map(c=>dist(toLab(b.rgb),c)))<Math.min(...context.map(c=>dist(toLab(a.rgb),c)))?b:a);
  const bg=allowed.get(contextColor.hex);
  // Assign the simplified component AND its vacated coverage together. Leaving
  // the old area-vote shades underneath would make a thin line visually thick.
  // Only cells actually touched by observed component pigment are eligible.
  const footprint=new Set();for(const p of main){const x=p%source.width,y=Math.floor(p/source.width),gx=grid.x.findIndex(v=>x>=v[0]&&x<v[1]),gy=grid.y.findIndex(v=>y>=v[0]&&y<v[1]);if(gx>=0&&gy>=0)footprint.add(gy*baseline.width+gx);}
  const clearVacated=keep=>{let count=0;for(const p of footprint)if(!keep.has(p)&&!reserved.has(p)){image.data.writeUInt32BE(bg,p*4);count++;}return count;};
  if(f.priority==='optional'&&Math.min(...span)<1){const cleared=clearVacated(new Set());reports.push({name:f.name,priority:f.priority,action:'omitted-below-one-cell',span,cleared});continue;}
  // Existing profile raster handles source-supported steps and rejects a jump
  // larger than one row. It does not force a smile or append endpoint pixels.
  const checkpoint=new PNG({width:source.width,height:source.height}),empty=new PNG({width:baseline.width,height:baseline.height});
  for(let p=0;p<source.width*source.height;p++)checkpoint.data.writeUInt32BE(bg,p*4);
  for(const p of main)checkpoint.data.writeUInt32BE(color,p*4);
  for(let p=0;p<baseline.width*baseline.height;p++)empty.data.writeUInt32BE(bg,p*4);
  const result=rasterObservedDetails(PNG,checkpoint,empty,grid,[{name:f.name,mode:'curve-profile',sourceRegion:f.sourceRegion,colors:[f.color],observation:f.observation}],palette);
  const path=[];for(let p=0;p<baseline.width*baseline.height;p++)if(result.image.data.readUInt32BE(p*4)===color)path.push(p);
  if(!path.length){if(f.priority==='required')unresolved.push(f.name);reports.push({name:f.name,priority:f.priority,action:'no-fitting-continuous-path',span,decisions:result.report.features[0].decisions});continue;}
  if(f.priority==='optional'&&path.some(p=>reserved.has(p)&&reserved.get(p).color!==color)){reports.push({name:f.name,priority:f.priority,action:'omitted-required-form-conflict'});continue;}
  const cleared=clearVacated(new Set(path));for(const p of path)assign(p,color,f.name);
  reports.push({name:f.name,priority:f.priority,action:'source-connected-profile',span,cells:path.length,cleared,omittedSatelliteComponents:parts.length-1,decisions:result.report.features[0].decisions});
 }
 return {image,report:{method:'explicit-feature-capacity',features:reports,unresolved,reservedCells:reserved.size,status:unresolved.length?'UNRESOLVED_REQUIRED_FORMS':'AWAITING_SAVED_VISUAL_REVIEW',limitation:'Observed source roles and outline decision are required. A fitted path is not a visual or expression pass.'}};
}
module.exports={rasterObservedDetails,rasterFlatColorRegions,allocateRequiredForms};
