'use strict';
// Construction placement for visible eyes (references/eye-construction-design.md).
// Source pixels keep their observed role labels, but only aggregate source
// measurements reach the grid: extents taken from percentiles, per-column
// medians, area shares and centroids. Lengths are rounded to whole cells and
// centred on the measured centre, so shifting the source by a few pixels moves
// the eye on the grid instead of changing its structure. No input is a native
// coordinate; the same rules run for every eye.

function locator(grid){
 const f=axis=>v=>{const a=grid[axis];let i=a.findIndex(([lo,hi])=>v>=lo&&v<hi);if(i<0)i=v<a[0][0]?0:a.length-1;const [lo,hi]=a[i];return i+(v-lo)/(hi-lo);};
 return {u:f('x'),v:f('y')};
}
// A measured interval [a,b] in cell units becomes n = round(length) cells
// (at least one) centred on the interval centre. The size does not depend on
// where the interval falls between grid lines.
function place(a,b){const n=Math.max(1,Math.round(b-a));return {start:Math.round((a+b)/2-n/2),n};}
const pct=(values,p)=>{const s=[...values].sort((x,y)=>x-y);return s[Math.min(s.length-1,Math.max(0,Math.round(p*(s.length-1))))];};
const median=values=>pct(values,.5);
const luminance=hex=>{const n=parseInt(hex.slice(1),16);return .299*(n>>16)+.587*(n>>8&255)+.114*(n&255);};

function constructEye({eye,roles,labels,source,grid,width,height,contextColorAt}){
 const loc=locator(grid),W=source.width,cellArea=(grid.x[0][1]-grid.x[0][0])*(grid.y[0][1]-grid.y[0][0]),cellW=grid.x[0][1]-grid.x[0][0];
 const idx=pred=>roles.map((r,i)=>pred(r)?i:-1).filter(i=>i>=0);
 const lidRoles=idx(r=>r.geometry==='stroke'),whiteRoles=idx(r=>r.family==='white'&&r.geometry!=='stroke');
 const irisFamily=idx(r=>r.family==='iris'),pupilRoles=idx(r=>r.family==='iris'&&r.geometry==='fill'&&r.protect===true);
 const lightRoles=idx(r=>r.family==='iris'&&r.geometry==='feature'),toneRoles=idx(r=>r.family==='iris'&&r.geometry==='fill'&&r.protect!==true);
 if(!lidRoles.length)throw Error('Eye construction needs an observed lid stroke: '+eye.name);
 const groups=new Map();for(const [q,r] of labels){if(!groups.has(r))groups.set(r,[]);groups.get(r).push(q);}
 const pixels=list=>list.flatMap(r=>groups.get(r)??[]);
 const xs=q=>q%W,ys=q=>Math.floor(q/W);
 // Measurements use connected bodies only: antialias pixels that took a
 // fill colour away from the body (an iris tone in the skin beside the lid)
 // must not stretch an extent. The lid and the iris are their largest
 // 4-connected body; white, pupil and light keep bodies of a quarter cell.
 const bodies=list=>{const set=new Set(list),seen=new Set(),out=[];for(const s of list){if(seen.has(s))continue;const part=[s];seen.add(s);for(let i=0;i<part.length;i++){const p=part[i],x=p%W;for(const n of [x?p-1:-1,x+1<W?p+1:-1,p-W,p+W])if(n>=0&&set.has(n)&&!seen.has(n)){seen.add(n);part.push(n);}}out.push(part);}return out.sort((a,b)=>b.length-a.length);};
 const largest=list=>bodies(list)[0]??[],substantial=list=>bodies(list).filter(b=>b.length>=cellArea/4).flat();
 const lid=largest(pixels(lidRoles)),iris=largest(pixels(irisFamily)),irisSet=new Set(iris);
 const white=substantial(pixels(whiteRoles)),pupil=pixels(pupilRoles).filter(q=>irisSet.has(q)),light=pixels(lightRoles).filter(q=>irisSet.has(q));
 const opening=white.concat(iris);
 if(!lid.length)throw Error('Eye construction found no lid pigment: '+eye.name);
 if(!opening.length)throw Error('Eye construction found no open eye (white or iris) pigment: '+eye.name);
 const colOf=sx=>Math.floor(loc.u(sx+.5)),rowOf=sy=>Math.floor(loc.v(sy+.5));
 // Columns come from the rounded horizontal extent (so the count does not
 // depend on the phase); each column takes the median top and bottom of the
 // set over its source columns, or of the nearest measured column.
 const columnBands=(list,columns)=>{const bySource=new Map();for(const q of list){const x=xs(q),y=ys(q),b=bySource.get(x);if(!b)bySource.set(x,[y,y]);else{if(y<b[0])b[0]=y;if(y>b[1])b[1]=y;}}
  const xsAll=list.map(xs),span=place(loc.u(pct(xsAll,.02)),loc.u(pct(xsAll,.98)+1));
  const byCell=new Map();for(const [x,b] of bySource){const c=colOf(x);if(!byCell.has(c))byCell.set(c,[]);byCell.get(c).push(b);}
  const measuredCols=[...byCell.keys()],out=new Map(),cols=columns??Array.from({length:span.n},(_,i)=>span.start+i);
  for(const c of cols){if(c<0||c>=width)continue;const near=byCell.has(c)?c:measuredCols.reduce((p,q)=>Math.abs(q-c)<Math.abs(p-c)?q:p);const bands=byCell.get(near);out.set(c,{top:loc.v(median(bands.map(b=>b[0]))),bottom:loc.v(median(bands.map(b=>b[1]))+1)});}
  return out;};
 const measured={};
 // 1. Lid: per column, rounded measured thickness centred on the band.
 const lidBands=columnBands(lid),lidRows=new Map();
 for(const [c,b] of lidBands){const p=place(b.top,b.bottom);lidRows.set(c,Array.from({length:p.n},(_,i)=>p.start+i));}
 // A column whose rows differ from two agreeing neighbours is a notch.
 for(const c of [...lidRows.keys()].sort((a,b)=>a-b)){const l=lidRows.get(c-1),r=lidRows.get(c+1),m=lidRows.get(c);if(l&&r&&l.join()===r.join()&&m.join()!==l.join()&&Math.abs(m.length-l.length)<=1)lidRows.set(c,[...l]);}
 measured.lid={columns:[...lidBands].map(([c,b])=>({column:c,top:+b.top.toFixed(2),bottom:+b.bottom.toFixed(2)}))};
 const lidBottom=c=>lidBands.get(c)?.bottom,lidLastRow=c=>lidRows.has(c)?Math.max(...lidRows.get(c)):null;
 const cells=new Map(),decisions=[];const set=(c,r,role)=>{if(c>=0&&c<width&&r>=0&&r<height)cells.set(r*width+c,role);};
 const lidColor=roles[lidRoles[0]].color,ink=(c,r)=>{const [a,b]=grid.x[c]??[0,0],[d,e]=grid.y[r]??[0,0];let n=0;for(let y=Math.floor(d);y<Math.ceil(e);y++)for(let x=Math.floor(a);x<Math.ceil(b);x++){const q=y*W+x,l=labels.get(q);if(l!==undefined?lidRoles.includes(l):contextColorAt(q)===lidColor)n++;}return n;};
 // 2-3. Horizontal structure hangs from the iris box: the box is the rounded
 // iris width; each side gets the rounded measured sclera width (from the
 // iris edge to the white's outer extent). Rounding the opening span on its
 // own dropped a 6 px white column and let the column count follow the phase.
 let box=null,openCols;
 if(iris.length){
  const ixs=iris.map(xs),ix0=loc.u(pct(ixs,.02)),ix1=loc.u(pct(ixs,.98)+1),iy0=loc.v(pct(iris.map(ys),.02)),iy1=loc.v(pct(iris.map(ys),.98)+1);
  const pc=place(ix0,ix1),c0=pc.start,c1=pc.start+pc.n-1;
  const leftWhite=white.filter(q=>xs(q)<pct(ixs,.02)).map(xs),rightWhite=white.filter(q=>xs(q)>pct(ixs,.98)).map(xs);
  const wl=leftWhite.length>=cellArea/4?ix0-loc.u(pct(leftWhite,.02)):0,wr=rightWhite.length>=cellArea/4?loc.u(pct(rightWhite,.98)+1)-ix1:0;
  const nl=Math.round(wl),nr=Math.round(wr);
  openCols=Array.from({length:nl+pc.n+nr},(_,i)=>c0-nl+i);
  measured.iris={sourceBox:[pct(ixs,.02),pct(iris.map(ys),.02),pct(ixs,.98)+1,pct(iris.map(ys),.98)+1],scleraCells:[+wl.toFixed(2),+wr.toFixed(2)],scleraColumns:[nl,nr]};
  const lidCols=[];for(let c=c0;c<=c1;c++)if(lidRows.has(c))lidCols.push(c);
  // Rows: the rounded height visible below the lid, hung under the median
  // lid row of the iris columns. A sloping lid that covers an iris cell in
  // one column takes it (the lid is written last); the count stays.
  const top=lidCols.length?median(lidCols.map(lidLastRow))+1:place(iy0,iy1).start,visTop=lidCols.length?Math.max(iy0,median(lidCols.map(lidBottom))):iy0;
  const visible=Math.max(1,Math.round(iy1-visTop)),rows=Array.from({length:visible},(_,i)=>top+i);
  // Pupil and reflection are placed relative to the iris box, by their
  // measured offset from the iris centre, so they move with the box.
  box={c0,c1,rows,mapU:u=>u-(ix0+ix1)/2+(c0+c1+1)/2,mapV:v=>v-(visTop+iy1)/2+(rows[0]+rows.at(-1)+1)/2};
  // A side without sclera closes with ink when ink lies within two cells.
  for(const [dir,n] of [[-1,nl],[1,nr]]){if(n)continue;const c=dir<0?c0-1:c1+1;if(c<0||c>=width)continue;
   for(const r of rows)if(ink(c,r)+ink(c+dir,r)>=cellArea/4){set(c,r,lidRoles[0]);(measured.sideContour??=[]).push([c,r]);}
   decisions.push((dir<0?'left':'right')+' side has no sclera');}
 }
 // The upper lid bounds every open column: an open column past the measured
 // lid span takes the nearest measured lid band (a lid end that droops
 // below its neighbours otherwise left the top of the sclera open).
 if(openCols){const missing=openCols.filter(c=>!lidRows.has(c));if(missing.length){const extra=columnBands(lid,missing);for(const [c,b] of extra){const p=place(b.top,b.bottom);lidRows.set(c,Array.from({length:p.n},(_,i)=>p.start+i));lidBands.set(c,b);}decisions.push('lid extended over open columns '+missing.join(','));}}
 // Opening rows per column, hung from that column's lid.
 const openBands=columnBands(opening,openCols),open=new Map();
 for(const [c,b] of openBands){let rows=[];
  if(lidLastRow(c)!==null){const n=Math.round(b.bottom-Math.max(b.top,lidBottom(c)));for(let i=1;i<=n;i++)rows.push(lidLastRow(c)+i);}
  else{const p=place(b.top,b.bottom);for(let r=p.start;r<p.start+p.n;r++)rows.push(r);}
  if(rows.length)open.set(c,rows);}
 measured.opening={columns:[...openBands].map(([c,b])=>({column:c,top:+b.top.toFixed(2),bottom:+b.bottom.toFixed(2)}))};
 // 7. Sclera: open cells outside the iris box.
 const whiteRole=whiteRoles[0];
 for(const [c,rows] of open)for(const r of rows){if(box&&c>=box.c0&&c<=box.c1&&box.rows.includes(r))continue;if(whiteRole!==undefined)set(c,r,whiteRole);}
 if(box){
  // 4. Iris tones: darker tone takes the measured area share from the top.
  const tones=toneRoles.map(r=>({r,n:(groups.get(r)??[]).filter(q=>irisSet.has(q)).length,lum:luminance(roles[r].color)})).sort((a,b)=>a.lum-b.lum);
  const h=box.rows.length;let darkRows=0;
  if(tones.length>=2){const dark=tones[0],lit=tones.slice(1).reduce((s,t)=>s+t.n,0);darkRows=Math.round(dark.n/Math.max(1,dark.n+lit)*h);
   if(lit>=cellArea/2&&darkRows>=h&&h>1)darkRows=h-1;if(dark.n>=cellArea/2&&darkRows<1&&h>1)darkRows=1;
   measured.irisTones={darkPixels:dark.n,lightPixels:lit,darkRows,rows:h};}
  const fillTone=tones.length?tones.at(-1).r:pupilRoles[0];
  box.rows.forEach((r,i)=>{for(let c=box.c0;c<=box.c1;c++)set(c,r,i<darkRows?tones[0].r:fillTone);});
  // 5. Pupil inside the box.
  let pupilCells=[];
  if(pupil.length){const pc=place(loc.u(pct(pupil.map(xs),.02)),loc.u(pct(pupil.map(xs),.98)+1)),pr=place(loc.v(pct(pupil.map(ys),.02)),loc.v(pct(pupil.map(ys),.98)+1));
   const w=box.c1-box.c0+1,h=box.rows.length;let n=Math.min(pc.n,w);if(w>=3&&n>=w)n=w-2;const nr=Math.min(pr.n,h);
   const cu=box.mapU((loc.u(pct(pupil.map(xs),.02))+loc.u(pct(pupil.map(xs),.98)+1))/2),cv=box.mapV((loc.v(pct(pupil.map(ys),.02))+loc.v(pct(pupil.map(ys),.98)+1))/2);
   const c0=Math.min(Math.max(Math.round(cu-n/2),box.c0),box.c1-n+1),r0=Math.min(Math.max(Math.round(cv-nr/2),box.rows[0]),box.rows.at(-1)-nr+1);
   const prow=Array.from({length:nr},(_,i)=>r0+i);
   for(const r of prow)for(let c=c0;c<c0+n;c++){set(c,r,pupilRoles[0]);pupilCells.push([c,r]);}
   measured.pupil={sourceBox:[pct(pupil.map(xs),.02),pct(pupil.map(ys),.02),pct(pupil.map(xs),.98)+1,pct(pupil.map(ys),.98)+1]};}
  // 6. Reflection: the box cell nearest the largest light component's centroid, never on the pupil.
  if(light.length&&eye.reflection!=='off'){
   const lset=new Set(light),seen=new Set();let best=[];for(const s of light){if(seen.has(s))continue;const part=[s];seen.add(s);for(let i=0;i<part.length;i++){const p=part[i];for(const n of [p-1,p+1,p-W,p+W])if(lset.has(n)&&!seen.has(n)){seen.add(n);part.push(n);}}if(part.length>best.length)best=part;}
   if(best.length>=3){const cu=box.mapU(best.reduce((s,q)=>s+loc.u(xs(q)+.5),0)/best.length),cv=box.mapV(best.reduce((s,q)=>s+loc.v(ys(q)+.5),0)/best.length);
    const pupilAt=new Set(pupilCells.map(([c,r])=>c+','+r)),pcx=pupilCells.length?pupilCells.reduce((s,[c])=>s+c+.5,0)/pupilCells.length:cu;
    let pick=null,bd=Infinity;for(const r of box.rows)for(let c=box.c0;c<=box.c1;c++){if(pupilAt.has(c+','+r))continue;const d=(c+.5-cu)**2+(r+.5-cv)**2,tie=Math.sign(c+.5-pcx)===Math.sign(cu-pcx)?0:1e-6;if(d+tie<bd){bd=d+tie;pick=[c,r];}}
    if(pick){set(pick[0],pick[1],lightRoles[0]);measured.reflection={sourceCentroid:[+cu.toFixed(2),+cv.toFixed(2)],cell:pick};}else decisions.push('reflection omitted: no iris cell beside the pupil');
   }else decisions.push('reflection omitted: under three source pixels');
  }
 }
 // 1 (cont). Lid cells override everything inside the eye.
 for(const [c,rows] of lidRows)for(const r of rows)set(c,r,lidRoles[0]);
 // 8. Contour: the cell just outside the opening on a row/column end, when at
 // least a quarter of it is the lid-colour ink in the source.

 const contour=[];const rowsAll=new Map();for(const [c,rows] of open)for(const r of rows){if(!rowsAll.has(r))rowsAll.set(r,[]);rowsAll.get(r).push(c);}
 for(const [r,cs] of rowsAll)for(const c of [Math.min(...cs)-1,Math.max(...cs)+1])if(c>=0&&c<width&&!cells.has(r*width+c)&&ink(c,r)>=cellArea/4){set(c,r,lidRoles[0]);contour.push([c,r]);}
 for(const [c,rows] of open){const r=Math.max(...rows)+1;if(r<height&&!cells.has(r*width+c)&&ink(c,r)>=cellArea/4){set(c,r,lidRoles[0]);contour.push([c,r]);}}
 if(contour.length)measured.contourCells=contour;
 return {cells,measured,decisions};
}
module.exports={constructEye,place,locator};
