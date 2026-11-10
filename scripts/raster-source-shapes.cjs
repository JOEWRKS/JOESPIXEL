'use strict';

// Source-space classification followed by a single raster pass. Background,
// luminance family and exact palette color are separate decisions. This avoids
// splitting one dark region's vote between outline/navy shades. No coordinates,
// character names, mirrored pixels, restoration strokes or output edits.
function rasterSourceShapes(PNG, source, palette, width, height, background) {
  const { toLab } = require('./build-palette-native.cjs');
  const w = source.width, h = source.height;
  const bg = parseInt(background.slice(1) + 'ff', 16);
  const entries = palette.map(p => ({
    color: parseInt(p.hex.slice(1) + 'ff', 16), luminance: toLab(p.rgb)[0],
  }));
  const allowed = new Set(entries.map(p => p.color));
  if (!allowed.has(bg)) throw Error('Background is outside the supplied palette');
  const colors = new Uint32Array(w * h);
  for (let p = 0; p < colors.length; p++) {
    colors[p] = source.data.readUInt32BE(p * 4);
    if (!allowed.has(colors[p])) throw Error('Shape rasterizer requires opaque palette-segmented source');
  }
  // Equal weight per locked palette entry, not frequency in the image. Small
  // highlights therefore do not disappear from the family model.
  const values = entries.map(p => p.luminance);
  let low = Math.min(...values), high = Math.max(...values);
  for (let step = 0; step < 12 && high > low; step++) {
    const split = (low + high) / 2;
    const a = values.filter(v => v < split), b = values.filter(v => v >= split);
    if (!a.length || !b.length) break;
    low = a.reduce((sum,v) => sum+v,0) / a.length;
    high = b.reduce((sum,v) => sum+v,0) / b.length;
  }
  const threshold = (low + high) / 2;
  const dark = new Set(entries.filter(p => p.luminance < threshold).map(p => p.color));
  const factor = Math.min(width / w, height / h);
  const fw = Math.max(1, Math.round(w * factor)), fh = Math.max(1, Math.round(h * factor));
  const ox = Math.floor((width-fw)/2), oy = Math.floor((height-fh)/2);
  // Keep disconnected bright/dark regions separate. For example, a small
  // bright interior and a bright exterior must not outvote the separating rim.
  const regions=new Int32Array(w*h);regions.fill(-1);
  const queue=new Int32Array(w*h),family=c=>c===bg?0:dark.has(c)?1:2;
  let regionCount=0;
  for(let p=0;p<colors.length;p++){
    if(regions[p]>=0)continue;
    const group=family(colors[p]);let head=0,tail=1;queue[0]=p;regions[p]=regionCount;
    while(head<tail){
      const k=queue[head++],x=k%w,y=Math.floor(k/w);
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
        const xx=x+dx,yy=y+dy;if((!dx&&!dy)||xx<0||yy<0||xx>=w||yy>=h)continue;
        // Complementary connectivity: light regions must not leak diagonally
        // through a dark staircase whose pixels touch at their corners.
        if(group!==1&&dx&&dy)continue;
        const j=yy*w+xx;
        if(regions[j]<0&&family(colors[j])===group){regions[j]=regionCount;queue[tail++]=j;}
      }
    }
    regionCount++;
  }
  const image = new PNG({width,height});
  for (let p=0;p<width*height;p++) image.data.writeUInt32BE(bg,p*4);
  const silhouetteChanges=[],familyChanges=[];
  for (let y=0;y<fh;y++) for (let x=0;x<fw;x++) {
    const left=x*w/fw,right=(x+1)*w/fw,top=y*h/fh,bottom=(y+1)*h/fh;
    const votes=new Map(),byRegion=new Map(),total=(right-left)*(bottom-top);
    for(let sy=Math.floor(top);sy<Math.min(h,Math.ceil(bottom));sy++)
      for(let sx=Math.floor(left);sx<Math.min(w,Math.ceil(right));sx++){
        const area=(Math.min(right,sx+1)-Math.max(left,sx))*(Math.min(bottom,sy+1)-Math.max(top,sy));
        const p=sy*w+sx,color=colors[p];
        votes.set(color,(votes.get(color)||0)+area);
        // Dark shades retain a joint coverage vote even when source AA splits
        // a stroke. Separate light islands still cannot vote across that stroke.
        const key=dark.has(color)?-1:regions[p];
        const r=byRegion.get(key)||{area:0,colors:new Map()};
        r.area+=area;r.colors.set(color,(r.colors.get(color)||0)+area);byRegion.set(key,r);
      }
    const ordered=[...votes].sort((a,b)=>b[1]-a[1]||a[0]-b[0]);
    const ordinary=ordered[0][0],foreground=ordered.filter(([c])=>c!==bg);
    const foregroundArea=total-(votes.get(bg)||0);
    let selected=bg;
    if(foregroundArea>total/2){
      const groups=[...byRegion.values()].filter(r=>!r.colors.has(bg)).sort((a,b)=>b.area-a.area);
      const region=groups[0];
      selected=[...region.colors].sort((a,b)=>b[1]-a[1]||a[0]-b[0])[0][0];
      if(selected!==foreground[0][0]) familyChanges.push({
        x:x+ox,y:y+oy,from:foreground[0][0].toString(16),to:selected.toString(16),
        selectedRegionCoverage:region.area/total,
        colorCoverage:Object.fromEntries(ordered.map(([c,a])=>[c.toString(16),a/total])),
      });
    }
    if((ordinary===bg)!==(selected===bg))silhouetteChanges.push({
      x:x+ox,y:y+oy,from:ordinary.toString(16),to:selected.toString(16),
      foregroundCoverage:foregroundArea/total,
    });
    image.data.writeUInt32BE(selected,((y+oy)*width+x+ox)*4);
  }
  return {image,report:{
    status:'REQUIRES_SAVED_IMAGE_REVIEW',
    fitWidth:fw,fitHeight:fh,offsetX:ox,offsetY:oy,
    familyLuminanceThreshold:threshold,
    darkFamily:palette.filter(p=>dark.has(parseInt(p.hex.slice(1)+'ff',16))).map(p=>p.hex),
    silhouetteChanges,familyChanges,regionCount,
    limitations:[
      'Palette luminance families are not semantic eye/mouth labels. Other styles require a separate saved-image comparison.',
      'This preserves source coverage, not every source staircase. It does not certify artistic fidelity.',
    ],
  }};
}
module.exports={rasterSourceShapes};
