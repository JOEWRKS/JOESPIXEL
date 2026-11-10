'use strict';

function maskComponents(keys, width) {
  const pending=new Set(keys),components=[];
  while(pending.size){
    const q=[pending.values().next().value];pending.delete(q[0]);
    for(let i=0;i<q.length;i++)for(const j of [q[i]-1,q[i]+1,q[i]-width,q[i]+width]){
      if(pending.has(j)&&Math.abs(j%width-q[i]%width)+Math.abs(Math.floor(j/width)-Math.floor(q[i]/width))===1){pending.delete(j);q.push(j);}
    }
    components.push(q);
  }
  return components;
}

// Zhang-Suen thinning retains endpoints and holes. It is applied to masks,
// never to RGB images, so it cannot add blended colors or move an image layer.
function thinMask(keys, width) {
  const mask=new Set(keys);
  for(;;){
    let count=0;
    for(let phase=0;phase<2;phase++){
      const remove=[];
      for(const k of mask){
        const p=[-width,-width+1,1,width+1,width,width-1,-1,-width-1].map(d=>Math.abs((k+d)%width-k%width)<=1&&mask.has(k+d)?1:0);
        const n=p.reduce((a,b)=>a+b,0),transitions=p.reduce((s,v,i)=>s+(!v&&p[(i+1)%8]?1:0),0);
        if(n<2||n>6||transitions!==1)continue;
        if(phase===0?(p[0]*p[2]*p[4]||p[2]*p[4]*p[6]):(p[0]*p[2]*p[6]||p[0]*p[4]*p[6]))continue;
        remove.push(k);
      }
      for(const k of remove)mask.delete(k);count+=remove.length;
    }
    if(!count)return mask;
  }
}

// Source-driven conversion stages. Rectangles and semantic colors are input annotations,
// never per-character output pixel patterns. No new RGB colors or alpha values are produced.
function refineStructure(PNG, source, native, palette, fit, config, helpers) {
  const {toLab, refineRegions}=helpers, W=native.width,H=native.height,N=W*H;
  const index=hex=>palette.findIndex(c=>c.hex===String(hex).toUpperCase());
  const hexOf=(im,k)=>'#'+im.data.subarray(k*4,k*4+3).toString('hex').toUpperCase();
  const values=im=>Array.from({length:N},(_,k)=>index(hexOf(im,k)));
  const lab=palette.map(c=>toLab(c.rgb)),dist=(a,b)=>a.reduce((s,v,i)=>s+(v-b[i])**2,0);
  const nearest=(rgb,colors)=>{const l=toLab(rgb);return colors.reduce((best,c)=>dist(l,lab[c])<dist(l,lab[best])?c:best,colors[0]);};
  const colors=list=>{
    if(!Array.isArray(list)||!list.length)throw new Error('Structure colors must be nonempty palette entries.');
    const c=list.map(index);if(c.some(i=>i<0)||new Set(c).size!==c.length)throw new Error('Structure colors must be unique palette entries.');return c;
  };
  const rect=r=>{
    if(!Array.isArray(r)||r.length!==4||!r.every(Number.isSafeInteger)||r[2]<1||r[3]<1||r[0]<fit.offsetX||r[1]<fit.offsetY||r[0]+r[2]>fit.offsetX+fit.fitWidth||r[1]+r[3]>fit.offsetY+fit.fitHeight)throw new Error('Structure rectangle outside fitted source.');return r;
  };
  const number=(v,min,max,name)=>{if(!Number.isFinite(v)||v<min||v>max)throw new Error('Invalid structure '+name);return v;};
  const inRect=(x,y,r)=>x>=r[0]&&y>=r[1]&&x<r[0]+r[2]&&y<r[1]+r[3];
  const around=k=>{const x=k%W,y=Math.floor(k/W);return[[x-1,y],[x+1,y],[x,y-1],[x,y+1]].filter(([a,b])=>a>=0&&a<W&&b>=0&&b<H).map(([a,b])=>b*W+a);};
  if(!config||typeof config!=='object'||Array.isArray(config))throw new Error('Structure configuration must be an object.');
  for(const im of [source,native])for(let i=3;i<im.data.length;i+=4)if(im.data[i]!==255)throw new Error('Structure requires opaque images.');
  if(values(native).some(i=>i<0))throw new Error('Structure requires palette-compliant native input.');
  const features=(config.features??[]).map(f=>{
    if(!f||!f.name||!['curve','eye'].includes(f.kind))throw new Error('Structure feature requires name and curve/eye kind.');
    rect(f.rect);const p={...f,skin:colors(f.skin)};
    if(f.preserveSkinOutsideEye!==undefined&&(f.kind!=='eye'||typeof f.preserveSkinOutsideEye!=='boolean'||!['source-detail','source-area','source-components'].includes(f.rasterization)))throw new Error('preserveSkinOutsideEye requires source eye sampling and boolean value.');
    if(f.preserveBaseRoles!==undefined&&(f.rasterization!=='source-components'||typeof f.preserveBaseRoles!=='boolean'))throw new Error('preserveBaseRoles requires source-components and boolean.');
    if(f.preserveSourceEyeTopology!==undefined&&(f.rasterization!=='source-components'||typeof f.preserveSourceEyeTopology!=='boolean'))throw new Error('preserveSourceEyeTopology requires source-components and boolean.');
    if(f.jointEyeRegions!==undefined&&(f.preserveSourceEyeTopology!==true||typeof f.jointEyeRegions!=='boolean'))throw new Error('jointEyeRegions requires source eye topology and boolean.');
    if(f.restoreThinEyeLines!==undefined&&(f.rasterization!=='source-components'||typeof f.restoreThinEyeLines!=='boolean'))throw new Error('restoreThinEyeLines requires source-components and boolean.');
    if(f.eyeBoundaryCoverage!==undefined&&(f.rasterization!=='source-components'||typeof f.eyeBoundaryCoverage!=='boolean'))throw new Error('eyeBoundaryCoverage requires source-components and boolean.');
    if(f.rasterization!==undefined&&!['legacy','source-shape','source-detail','source-area','source-components','whole-curve','source-mark'].includes(f.rasterization))throw new Error('Invalid feature rasterization.');
    if(['source-components'].includes(f.rasterization)&&f.kind!=='eye')throw new Error('Source components require an eye feature.');
    if(['whole-curve','source-mark'].includes(f.rasterization)&&f.kind!=='curve')throw new Error('Curve rasterization requires a curve feature.');
    if(f.coverageColor!==undefined&&(f.rasterization!=='whole-curve'||typeof f.coverageColor!=='boolean'))throw new Error('coverageColor requires whole-curve and boolean.');
    if(f.rasterization==='source-area'&&f.kind!=='eye')throw new Error('source-area currently supports eye role sampling only.');
    if(f.kind==='curve'){
      p.ink=colors(f.ink);p.contrast=number(f.contrast??28,1,200,'contrast');p.minCoverage=number(f.minCoverage??0.14,0.01,1,'coverage');
    }else{
      p.ink=colors(f.ink);p.iris=colors(f.iris);p.white=colors(f.white);p.glint=colors([f.glint])[0];
      if(f.preserveSourceEyeTopology&&(!p.white.includes(p.glint)||p.white.some(c=>p.ink.includes(c)||p.iris.includes(c))))throw new Error('Source eye topology requires distinct white/glint and iris/ink palette roles.');
      const rgb=[0,1,2].map(c=>p.iris.reduce((s,i)=>s+palette[i].rgb[c],0));
      p.irisAxis=rgb.indexOf(Math.max(...rgb));
      if(p.irisAxis===0&&f.rasterization!=='source-components')throw new Error('Eye role segmentation currently supports green- or blue-dominant iris palettes only.');
    }return p;
  });
  const claimed=new Set();for(const f of features){const[x,y,w,h]=f.rect;for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++){const k=yy*W+xx;if(claimed.has(k))throw new Error('Overlapping structure feature rectangles.');claimed.add(k);}}
  const planes=(config.planes??[]).map(p=>({...p,rect:rect(p.rect),eligible:colors(p.eligible),colors:colors(p.colors)}));
  for(const p of planes)if(p.sourceRoles){
    if(p.mode||!Array.isArray(p.sourceRoles)||!p.sourceRoles.length)throw new Error('Source material roles need a nonempty array and no other plane mode.');
    for(const r of p.sourceRoles)if(!Array.isArray(r.rgb)||r.rgb.length!==3||!r.rgb.every(v=>Number.isFinite(v)&&v>=0&&v<=255)||!p.colors.includes(index(r.color)))throw new Error('Invalid source material prototype or destination color.');
    number(p.coherence??.0008,0,.01,'material coherence');number(p.edgeThreshold??.025,0,1,'material edge threshold');
  }
  for(const p of planes)if(p.mode!==undefined){
    if(p.mode!=='source-tones')throw new Error('Invalid plane mode.');
    if(p.shadowLayer!==undefined&&typeof p.shadowLayer!=='boolean')throw new Error('Invalid shadowLayer flag.');
    if(p.shadowSampling!==undefined&&!['dark-pigment','cell-mean'].includes(p.shadowSampling))throw new Error('Invalid shadowSampling mode.');
    if(p.colors.length!==3||!p.colors.every((c,i)=>i===0||palette[c].rgb.reduce((s,v,k)=>s+v*[.2126,.7152,.0722][k],0)>palette[p.colors[i-1]].rgb.reduce((s,v,k)=>s+v*[.2126,.7152,.0722][k],0)))throw new Error('Source tones require ordered shadow/base/light palette colors.');
  }
  const contour=config.contour;
  if(contour){
    if(index(contour.color)<0||index(contour.background)<0||index(contour.color)===index(contour.background))throw new Error('Invalid contour palette colors.');
    if(contour.mode!==undefined&&!['one-cell','source-coverage'].includes(contour.mode))throw new Error('Invalid contour mode.');
    if(contour.mode==='source-coverage'&&contour.width!==undefined)throw new Error('Source coverage derives width from the source; do not specify width.');
    if(contour.mode!=='source-coverage'&&(contour.width??1)!==1)throw new Error('Only one-cell contour width is currently supported.');
    if(contour.sourceThinJunctions!==undefined&&typeof contour.sourceThinJunctions!=='boolean')throw new Error('sourceThinJunctions must be boolean.');
    number(contour.bandDepth??3,1,5,'contour band depth');
    if(!Number.isInteger(contour.bandDepth??3))throw new Error('Contour band depth must be integer.');
    if(!Array.isArray(contour.seeds??[]))throw new Error('Contour seeds must be an array.');
    for(const p of contour.seeds??[])if(!Array.isArray(p)||p.length!==2||!p.every(Number.isSafeInteger)||p[0]<0||p[0]>=W||p[1]<0||p[1]>=H)throw new Error('Invalid contour seed.');
  }
  let image=new PNG({width:W,height:H});native.data.copy(image.data);
  const stages=[],suspects=[],skinChoices=new Map();
  const recordStage=(name,previous,detail)=>{const a=values(previous),b=values(image),changes=[];for(let k=0;k<N;k++)if(a[k]!==b[k])changes.push({x:k%W,y:Math.floor(k/W),from:palette[a[k]].hex,to:palette[b[k]].hex});stages.push({name,...detail,changes});};
  const copy=()=>{const p=new PNG({width:W,height:H});image.data.copy(p.data);return p;};
  const put=(x,y,c)=>image.data.set([...palette[c].rgb,255],(y*W+x)*4);
  const samples=(x,y)=>{
    const l=(x-fit.offsetX)*source.width/fit.fitWidth,r=(x+1-fit.offsetX)*source.width/fit.fitWidth,u=(y-fit.offsetY)*source.height/fit.fitHeight,b=(y+1-fit.offsetY)*source.height/fit.fitHeight,a=[];
    for(let yy=Math.floor(u);yy<Math.min(source.height,Math.ceil(b));yy++)for(let xx=Math.floor(l);xx<Math.min(source.width,Math.ceil(r));xx++){
      const weight=(Math.min(r,xx+1)-Math.max(l,xx))*(Math.min(b,yy+1)-Math.max(u,yy)),i=(yy*source.width+xx)*4;
      a.push({rgb:[...source.data.subarray(i,i+3)],weight,sx:xx,sy:yy});
    }return a;
  };
  const mean=a=>{const sum=[0,0,0];let total=0;for(const p of a){total+=p.weight;for(let i=0;i<3;i++)sum[i]+=p.rgb[i]*p.weight;}return total?sum.map(s=>s/total):null;};
  const luma=rgb=>rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;
  const hue=rgb=>{const max=Math.max(...rgb),min=Math.min(...rgb),d=max-min;if(!d)return 0;const i=rgb.indexOf(max);return ((i===0?(rgb[1]-rgb[2])/d:i===1?(rgb[2]-rgb[0])/d+2:(rgb[0]-rgb[1])/d+4)*60+360)%360;};
  const hueDistance=(a,b)=>Math.min(Math.abs(a-b),360-Math.abs(a-b));
  const centerSample=(x,y,points)=>{
    const sx=Math.floor((x+.5-fit.offsetX)*source.width/fit.fitWidth),sy=Math.floor((y+.5-fit.offsetY)*source.height/fit.fitHeight);
    return points.find(p=>p.sx===sx&&p.sy===sy);
  };
  // Source skin, source eye detail and source line pigment remain separate masks.
  // Match actual source color with the shared coherence pass. Never stretch a
  // narrow source luminance range into forced shadow/base/highlight roles.
  for(const p of planes.filter(p=>p.mode==='source-tones')){
    const previous=copy(),v=values(image),[x,y,w,h]=p.rect,cells=[];
    for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++){
      if(!p.eligible.includes(v[yy*W+xx]))continue;
      const all=samples(xx,yy),warm=all.filter(q=>luma(q.rgb)>110&&q.rgb[0]-q.rgb[1]>30&&q.rgb[1]-q.rgb[2]>20);
      const total=all.reduce((s,q)=>s+q.weight,0),area=warm.reduce((s,q)=>s+q.weight,0);
      if(area/total<.6)continue;
      const rgb=mean(warm);cells.push({x:xx,y:yy,rgb,L:luma(rgb)});
    }
    for(const c of cells)if(skinChoices.has(c.y*W+c.x))throw new Error('Overlapping structure plane masks.');
    let regions=[];
    if(cells.length){
      const sourceColors=new Map(cells.map(c=>[c.y*W+c.x,c.rgb]));
      const result=refineRegions(PNG,source,image,palette,fit,[{name:p.name||'source-skin',pixels:cells.map(c=>[c.x,c.y]),colors:p.colors.map(i=>palette[i].hex),coherence:p.coherence??.0008,edgeThreshold:p.edgeThreshold??.025}],sourceColors);
      image=result.image;regions=result.report.regions;
    }
    const mapped=values(image),byKey=new Map(cells.map(c=>[c.y*W+c.x,c]));
    const pending=new Set(cells.filter(c=>mapped[c.y*W+c.x]===p.colors[2]).map(c=>c.y*W+c.x)),suppressedWeakSkinSpecks=[];
    while(pending.size){
      const component=[pending.values().next().value];pending.delete(component[0]);
      for(let i=0;i<component.length;i++)for(const j of around(component[i]))if(pending.has(j)){pending.delete(j);component.push(j);}
      if(component.length>2)continue;
      const border=[...new Set(component.flatMap(around))].filter(k=>byKey.has(k)&&!component.includes(k));
      if(border.length<2||!border.every(k=>mapped[k]===p.colors[1]))continue;
      // A tiny light island is removed only when its source color is ambiguous
      // between the existing base/light entries. Strong highlights remain.
      if(!component.every(k=>{const l=toLab(byKey.get(k).rgb),support=around(k).filter(j=>border.includes(j)).length;return dist(l,lab[p.colors[1]])-dist(l,lab[p.colors[2]])<(p.coherence??.0008)*support;}))continue;
      for(const k of component){mapped[k]=p.colors[1];put(k%W,Math.floor(k/W),p.colors[1]);suppressedWeakSkinSpecks.push([k%W,Math.floor(k/W)]);}
    }
    for(const c of cells)skinChoices.set(c.y*W+c.x,mapped[c.y*W+c.x]);
    const paletteCounts=Object.fromEntries(p.colors.map(i=>[palette[i].hex,cells.filter(c=>skinChoices.get(c.y*W+c.x)===i).length]));
    recordStage(p.name||'source-skin-tones',previous,{kind:'skin-tones',toneSeparationApplied:false,skinCells:cells.length,paletteCounts,suppressedWeakSkinSpecks,regions:regions.map(({changes,...r})=>r),meaning:'Source warm-skin mask; actual color distance and bounded neighbor coherence. No forced tone separation or contrast expansion.'});
  }
  // Material coherence uses the existing tested pass, with masks derived from input roles.
  for(const p of planes.filter(p=>p.sourceRoles)){
    const previous=copy(),v=values(image),[x,y,w,h]=p.rect;
    const anchors=p.sourceRoles.map(r=>({lab:toLab(r.rgb),color:colors([r.color])[0]}));
    const material=new Map();
    for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++){
      if(claimed.has(yy*W+xx)||!p.eligible.includes(v[yy*W+xx]))continue;
      const all=samples(xx,yy),rgb=mean(all),l=toLab(rgb);
      const chosen=anchors.reduce((a,b)=>dist(l,b.lab)<dist(l,a.lab)?b:a);
      material.set(yy*W+xx,{l,chosen});
    }
    for(let pass=0;pass<8;pass++){
      let changed=0;
      for(const [k,c] of material){
        const neighbors=around(k).map(j=>material.get(j)).filter(n=>n&&dist(c.l,n.l)<(p.edgeThreshold??.025)**2);
        const score=a=>dist(c.l,a.lab)+(p.coherence??.0008)*neighbors.filter(n=>n.chosen.color!==a.color).length;
        const next=anchors.reduce((a,b)=>score(b)<score(a)?b:a,c.chosen);
        if(next!==c.chosen){c.chosen=next;changed++;}
      }
      if(!changed)break;
    }
    for(const [k,c] of material)put(k%W,Math.floor(k/W),c.chosen.color);
    recordStage(p.name||'material-source-roles',previous,{kind:'source-material-roles',sourcePrototypes:p.sourceRoles});
  }
  if(planes.some(p=>!p.mode&&!p.sourceRoles)){
    const previous=copy(),v=values(image),occupied=new Set(skinChoices.keys()),regions=[];
    for(const p of planes.filter(p=>!p.mode&&!p.sourceRoles)){const pixels=[],[x,y,w,h]=p.rect;for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++){
      const k=yy*W+xx;if(!claimed.has(k)&&p.eligible.includes(v[k])){if(occupied.has(k))throw new Error('Overlapping structure plane masks.');occupied.add(k);pixels.push([xx,yy]);}
    }if(pixels.length)regions.push({name:p.name,pixels,colors:p.colors.map(i=>palette[i].hex),coherence:p.coherence??0.0008,edgeThreshold:p.edgeThreshold??0.025});}
    if(regions.length){const r=refineRegions(PNG,source,image,palette,fit,regions);image=r.image;recordStage('material-planes',previous,{regions:r.report.regions.map(r=>({name:r.name,cells:r.cells,converged:r.converged}))});}
  }
  for(const f of features){
    const previous=copy(),[x,y,w,h]=f.rect,cells=[];
    for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++)cells.push({x:xx,y:yy,samples:samples(xx,yy)});
    if(f.kind==='curve'){
      // Estimate surrounding skin from all ROI samples. Keep source pigment separate from underpaint.
      const lights=cells.flatMap(c=>c.samples.map(p=>luma(p.rgb))).sort((a,b)=>a-b),skinLight=lights[Math.floor(lights.length*.65)];
      const pigment=new Set();
      for(const c of cells)for(const p of c.samples)if(skinLight-luma(p.rgb)>=f.contrast)pigment.add(p.sy*source.width+p.sx);
      const pending=new Set(pigment),components=[];
      const sourceLeft=(x-fit.offsetX)*source.width/fit.fitWidth,sourceRight=(x+w-fit.offsetX)*source.width/fit.fitWidth;
      const sourceTop=(y-fit.offsetY)*source.height/fit.fitHeight,sourceBottom=(y+h-fit.offsetY)*source.height/fit.fitHeight;
      while(pending.size){const q=[pending.values().next().value];pending.delete(q[0]);
        for(let i=0;i<q.length;i++){const k=q[i],sx=k%source.width,sy=Math.floor(k/source.width);for(const j of [k-1,k+1,k-source.width,k+source.width])if(pending.has(j)&&Math.abs(j%source.width-sx)+Math.abs(Math.floor(j/source.width)-sy)===1){pending.delete(j);q.push(j);}}
        const xs=q.map(k=>k%source.width),ys=q.map(k=>Math.floor(k/source.width));
        const touchesBorder=Math.min(...xs)<=Math.floor(sourceLeft)||Math.max(...xs)>=Math.ceil(sourceRight)-1||Math.min(...ys)<=Math.floor(sourceTop)||Math.max(...ys)>=Math.ceil(sourceBottom)-1;
        components.push({pixels:q,touchesBorder});
      }
      // Isolated source components prevent a nose or jaw shadow at the ROI edge joining the mouth.
      const component=components.filter(c=>!c.touchesBorder).sort((a,b)=>b.pixels.length-a.pixels.length)[0];
      if(!component){suspects.push({feature:f.name,reason:'No isolated source curve inside rectangle; original cells retained.'});recordStage(f.name,previous,{kind:f.kind,path:[]});continue;}
      const chosenPigment=new Set(component.pixels);
      for(const c of cells){c.ink=c.samples.filter(p=>chosenPigment.has(p.sy*source.width+p.sx));c.coverage=c.ink.reduce((s,p)=>s+p.weight,0)/c.samples.reduce((s,p)=>s+p.weight,0);}
      const peaks=Array.from({length:w},(_,i)=>Math.max(...cells.filter(c=>c.x===x+i).map(c=>c.coverage)));
      const supported=peaks.map((v,i)=>v>=f.minCoverage?i:-1).filter(i=>i>=0);
      if(!supported.length){suspects.push({feature:f.name,reason:'No source-supported curve; original cells retained.'});recordStage(f.name,previous,{kind:f.kind,path:[]});continue;}
      const sourceShape=['source-shape','source-detail','whole-curve','source-mark'].includes(f.rasterization),sourceDetail=f.rasterization==='source-detail';
      // Keep the sub-cell centerline. Coverage maxima alone favor flat, thick rows.
      const columns=Array.from({length:w},(_,i)=>{
        const points=cells.filter(c=>c.x===x+i).flatMap(c=>c.ink),area=points.reduce((s,p)=>s+p.weight,0);
        const weights=points.map(p=>p.weight*(skinLight-luma(p.rgb))**2),mass=weights.reduce((a,b)=>a+b,0);
        return {area,center:area?points.reduce((s,p,i)=>s+((p.sy+.5)*fit.fitHeight/source.height+fit.offsetY)*weights[i],0)/mass:null};
      });
      let left=supported[0],right=supported.at(-1);
      if(sourceShape){
        // Discard only low-mass tails, not arbitrary native coordinates.
        const total=columns.reduce((s,c)=>s+c.area,0);let mass=0;
        for(let i=0;i<w;i++){mass+=columns[i].area;if(mass>=total*.05){left=Math.max(left,i);break;}}
        mass=0;for(let i=w-1;i>=0;i--){mass+=columns[i].area;if(mass>=total*.05){right=Math.min(right,i);break;}}
      }
      if(left>right){suspects.push({feature:f.name,reason:'Trimmed source extent has no supported curve; original cells retained.'});recordStage(f.name,previous,{kind:f.kind,path:[]});continue;}
      const dp=[],back=[];
      for(let xx=left;xx<=right;xx++){
        dp[xx]=[];back[xx]=[];
        for(let yy=0;yy<h;yy++){
          const c=cells[yy*w+xx],reward=sourceShape&&columns[xx].center!==null?c.coverage-.25*(c.y+.5-columns[xx].center)**2:c.coverage;
          if(xx===left){dp[xx][yy]=reward;back[xx][yy]=-1;continue;}
          let best=-Infinity,at=-1;
          for(let py=Math.max(0,yy-1);py<=Math.min(h-1,yy+1);py++){const score=dp[xx-1][py]+reward-(sourceShape?0:0.025)*Math.abs(yy-py);if(score>best){best=score;at=py;}}
          dp[xx][yy]=best;back[xx][yy]=at;
        }
      }
      let yy=dp[right].indexOf(Math.max(...dp[right]));const path=[];
      for(let xx=right;xx>=left;xx--){path.push(cells[yy*w+xx]);yy=back[xx][yy];}path.reverse();
      if(f.rasterization==='source-mark'){
        const area=cells.reduce((s,c)=>s+c.coverage,0);
        const supported=cells.filter(c=>c.coverage>=f.minCoverage*.5).sort((a,b)=>b.coverage-a.coverage);
        path.splice(0,path.length,...supported.slice(0,Math.max(1,Math.round(area))));
      }
      let wholeCurveCandidates;
      if(f.rasterization==='whole-curve'){
        // Quantize the entire measured path at a shared phase. Compare relative
        // heights over all pairs, so a shallow returning corner cannot disappear
        // merely because its individual cell has less coverage than its neighbor.
        const candidates=new Map();
        const profile=columns.slice(left,right+1).map(c=>c.center);
        const sourceMax=Math.max(...profile),sourceMin=Math.min(...profile);
        const downThenUp=sourceMax-profile[0]>.25&&sourceMax-profile.at(-1)>.25;
        const upThenDown=profile[0]-sourceMin>.25&&profile.at(-1)-sourceMin>.25;
        const plateau=profile.filter(v=>Math.abs(v-(downThenUp?sourceMax:sourceMin))<.25).length;
        for(let phase=0;phase<1;phase+=1/32){
          const p=Array.from({length:right-left+1},(_,i)=>{
            const xx=left+i, row=Math.floor(columns[xx].center+phase);
            return cells[(row-y)*w+xx];
          });
          if(p.some((c,i)=>!c||(i&&Math.abs(c.y-p[i-1].y)>1)))continue;
          // Color is sampled along the same displaced whole curve, not from an
          // unrelated cell at the old coordinates. The displacement is global
          // and bounded to half a native cell, never a hand-added corner pixel.
          if(phase>.5)continue;
          const rows=p.map(c=>c.y),lo=Math.min(...rows),hi=Math.max(...rows);
          if(downThenUp&&(hi<=rows[0]||hi<=rows.at(-1)||rows.filter(v=>v===hi).length<plateau))continue;
          if(upThenDown&&(lo>=rows[0]||lo>=rows.at(-1)||rows.filter(v=>v===lo).length<plateau))continue;
          const key=p.map(c=>c.y).join(',');if(candidates.has(key))continue;
          let absolute=0,relative=0,pairs=0;
          for(let i=0;i<p.length;i++){
            const a=columns[p[i].x-x].center;absolute+=(p[i].y+.5-a)**2;
            for(let j=i+1;j<p.length;j++){
              relative+=((p[j].y-p[i].y)-(columns[p[j].x-x].center-a))**2;pairs++;
            }
          }
          const score=absolute/p.length+2*relative/Math.max(1,pairs);
          candidates.set(key,{path:p,phase,score});
        }
        const ranked=[...candidates.values()].sort((a,b)=>a.score-b.score);
        if(!ranked.length){
          suspects.push({feature:f.name,reason:'No whole-curve candidate preserves the measured turn; source conversion retained for review.'});
          recordStage(f.name,previous,{kind:f.kind,rasterization:f.rasterization,path:[],wholeCurveCandidates:[]});continue;
        }
        if(ranked.length){
          const selected=ranked[0];
          path.splice(0,path.length,...selected.path.map(c=>{
            const column=cells.filter(q=>q.x===c.x).flatMap(q=>q.ink);
            return {...c,ink:column,coverage:columns[c.x-x].area/(source.width*source.height/(fit.fitWidth*fit.fitHeight)),sourcePhase:selected.phase};
          }));
        }
        wholeCurveCandidates=ranked.map(c=>({phase:c.phase,score:c.score,rows:c.path.map(p=>p.y)}));
      }
      const suppressedQuantizationKinks=[];
      if(sourceShape&&!['whole-curve','source-mark'].includes(f.rasterization)){
        const selected=[...path];
        for(let i=1;i<selected.length-1;i++){
          const a=selected[i-1],c=selected[i],b=selected[i+1];
          if(a.y!==b.y||c.y===a.y)continue;
          const bend=columns[c.x-x].center-(columns[a.x-x].center+columns[b.x-x].center)/2;
          const alternative=cells[(a.y-y)*w+c.x-x];
          if(Math.abs(bend)<.5&&alternative.coverage>=f.minCoverage*.5){
            path[i]=alternative;suppressedQuantizationKinks.push({x:c.x,fromY:c.y,toY:alternative.y,sourceBend:bend});
          }
        }
      }
      if(path.some(c=>c.coverage<f.minCoverage*.5)){
        suspects.push({feature:f.name,reason:'Source curve has unsupported gap; original cells retained.'});recordStage(f.name,previous,{kind:f.kind,path:[],candidate:path.map(c=>[c.x,c.y,c.coverage])});continue;
      }
      // A coherent skin underpaint prevents the old quantized stroke remaining beside the new path.
      const skinSamples=cells.flatMap(c=>c.samples.filter(p=>skinLight-luma(p.rgb)<f.contrast));
      const base=nearest(mean(skinSamples)||mean(cells.flatMap(c=>c.samples)),f.skin);
      // Retain other source components (e.g. the nose) instead of clearing the whole rectangle.
      for(const c of cells)if(!c.samples.some(p=>pigment.has(p.sy*source.width+p.sx)&&!chosenPigment.has(p.sy*source.width+p.sx))){
        const backgroundSamples=c.samples.filter(p=>!chosenPigment.has(p.sy*source.width+p.sx));
        const underpaint=sourceDetail?(skinChoices.get(c.y*W+c.x)??nearest(mean(backgroundSamples)||palette[base].rgb,f.skin)):base;
        put(c.x,c.y,underpaint);
      }
      const pigmentHue=hue(mean(cells.flatMap(c=>c.ink))),hueErrors=f.ink.map(i=>hueDistance(hue(palette[i].rgb),pigmentHue));
      const strokeColors=sourceShape?f.ink.filter((i,n)=>hueErrors[n]<=Math.min(...hueErrors)+10):f.ink;
      for(const c of path){
        const pigmentMean=sourceDetail?mean([...c.ink].sort((a,b)=>luma(a.rgb)-luma(b.rgb)).slice(0,Math.max(1,Math.ceil(c.ink.length*.5)))):mean(c.ink);
        const coverage=Math.min(1,c.coverage),skinMean=mean(skinSamples);
        const colorSample=f.coverageColor?pigmentMean.map((v,i)=>v*coverage+skinMean[i]*(1-coverage)):pigmentMean;
        put(c.x,c.y,nearest(colorSample,strokeColors));
      }
      recordStage(f.name,previous,{kind:f.kind,rasterization:f.rasterization??'legacy',skinLight,sourceComponents:components.length,excludedSourceComponents:components.length-1,wholeCurveCandidates,suppressedQuantizationKinks,path:path.map(c=>({x:c.x,y:c.y,coverage:c.coverage,sourceCenterY:columns[c.x-x].center,sourceInkMean:mean(c.ink)}))});
    }else{
      if(f.rasterization==='source-components'){
        // Source-role prototypes are observations of the source, not output dots.
        // Keeping pupil, iris light and glint separate prevents a nearest-color
        // vote from replacing every green sample with the same palette entry.
        if(!Array.isArray(f.sourceRoles)||f.sourceRoles.length<2)throw new Error('Source eye role prototypes required.');
        const roles=f.sourceRoles.map(r=>{
          if(!r.name||!Array.isArray(r.rgb)||r.rgb.length!==3||!r.rgb.every(v=>Number.isFinite(v)&&v>=0&&v<=255))throw new Error('Invalid source role prototype.');
          return {...r,lab:toLab(r.rgb),colors:colors(r.colors)};
        });
        if(new Set(roles.map(r=>r.name)).size!==roles.length)throw new Error('Duplicate source eye role.');
        const sourceRole=p=>roles.reduce((best,r)=>dist(toLab(p.rgb),r.lab)<dist(toLab(p.rgb),best.lab)?r:best,roles[0]);
        const counts={},sourceArea={},whiteSource=new Map(),cellRoles=new Map();
        for(const c of cells){
          const groups=new Map(roles.map(r=>[r.name,[]]));
          for(const p of c.samples){const r=sourceRole(p);groups.get(r.name).push(p);if(r.name==='white')whiteSource.set(p.sy*source.width+p.sx,p);}
          const area=c.samples.reduce((s,p)=>s+p.weight,0);
          const ranked=roles.map(r=>({r,points:groups.get(r.name),weight:groups.get(r.name).reduce((s,p)=>s+p.weight,0)})).sort((a,b)=>b.weight-a.weight);
          const chosen=ranked[0];
          c.roleGroups=groups;
          for(const r of ranked)sourceArea[r.r.name]=(sourceArea[r.r.name]??0)+r.weight/area;
          counts[chosen.r.name]=(counts[chosen.r.name]??0)+1;
          cellRoles.set(c.y*W+c.x,chosen.r.name);
          if(f.preserveBaseRoles||(chosen.r.name==='skin'&&f.preserveSkinOutsideEye))continue;
          put(c.x,c.y,nearest(mean(chosen.points),chosen.r.colors));
        }
        const todo=new Set(whiteSource.keys()),glints=[],rejectedGlints=[],glintMasks=[];
        while(todo.size){
          const q=[todo.values().next().value];todo.delete(q[0]);
          for(let i=0;i<q.length;i++)for(const j of [q[i]-1,q[i]+1,q[i]-source.width,q[i]+source.width])if(todo.has(j)&&Math.abs(j%source.width-q[i]%source.width)+Math.abs(Math.floor(j/source.width)-Math.floor(q[i]/source.width))===1){todo.delete(j);q.push(j);}
          const area=q.length*fit.fitWidth*fit.fitHeight/(source.width*source.height);
          if(area<.5){rejectedGlints.push({sourceArea:area,reason:'Below half a native cell; no invented minimum-size glint.'});continue;}
          const component=new Set(q),support=cells.map(c=>({c,weight:c.samples.filter(p=>component.has(p.sy*source.width+p.sx)).reduce((s,p)=>s+p.weight,0)})).filter(c=>c.weight>0).sort((a,b)=>b.weight-a.weight);
          if(!support.length)continue;
          // Classify against the ORIGINAL boundary, not the already quantized eye.
          // A large glint is valid when it lies inside iris/pupil pigment. Sclera
          // touching skin/lids is not promoted merely because it is white.
          const border=new Set();for(const j of q)for(const n of [j-1,j+1,j-source.width,j+source.width])if(n>=0&&n<source.width*source.height&&!component.has(n)&&Math.abs(n%source.width-j%source.width)+Math.abs(Math.floor(n/source.width)-Math.floor(j/source.width))===1)border.add(n);
          let irisBoundary=0;for(const j of border){const role=sourceRole({rgb:[...source.data.subarray(j*4,j*4+3)]}).name;if(['iris','iris-light','pupil'].includes(role))irisBoundary++;}
          const enclosure=irisBoundary/Math.max(1,border.size);
          if(enclosure<.5){rejectedGlints.push({sourceArea:area,irisBoundaryFraction:enclosure,reason:'White component is not predominantly enclosed by source iris/pupil.'});continue;}
          const xs=q.map(j=>(j%source.width+.5)*fit.fitWidth/source.width+fit.offsetX),ys=q.map(j=>(Math.floor(j/source.width)+.5)*fit.fitHeight/source.height+fit.offsetY);
          const center=[xs.reduce((a,b)=>a+b,0)/xs.length,ys.reduce((a,b)=>a+b,0)/ys.length];
          const variance=[xs.reduce((s,v)=>s+(v-center[0])**2,0)/xs.length,ys.reduce((s,v)=>s+(v-center[1])**2,0)/ys.length];
          const chosen=support.slice(0,Math.max(1,Math.round(area)));
          const selected=new Set(chosen.map(({c})=>c.y*W+c.x)),restored=[];
          for(const {c,weight} of support){
            if(f.preserveBaseRoles)continue;
            const key=c.y*W+c.x;if(selected.has(key)||cellRoles.get(key)!=='white')continue;
            const whiteArea=c.roleGroups.get('white').reduce((s,p)=>s+p.weight,0);
            if(weight<whiteArea*.95)continue;
            const under=roles.filter(r=>r.name!=='white').map(r=>({r,points:c.roleGroups.get(r.name),area:c.roleGroups.get(r.name).reduce((s,p)=>s+p.weight,0)})).sort((a,b)=>b.area-a.area)[0];
            if(!['pupil','iris','iris-light'].includes(under.r.name)||!under.area)continue;
            put(c.x,c.y,nearest(mean(under.points),under.r.colors));restored.push([c.x,c.y]);
          }
          for(const {c} of chosen)put(c.x,c.y,f.glint);
          glintMasks.push(component);
          glints.push({sourceArea:area,irisBoundaryFraction:enclosure,sourceCenter:center,sourceVariance:variance,cells:chosen.map(({c})=>[c.x,c.y]),restoredBoundaryCells:restored});
        }
        // At the iris/sclera boundary, decide region occupancy before choosing
        // a palette color. Otherwise several ink/iris shades can each lose to
        // one minority white shade and create a notch in a continuous edge.
        // This is source-area sampling, not smoothing or thin-line expansion.
        const boundarySampling=[];
        if(f.eyeBoundaryCoverage){
          const eyeNames=new Set(['pupil','iris','iris-light']),glintCells=new Set(glints.flatMap(g=>g.cells.map(([x,y])=>y*W+x))),currentValues=values(image);
          for(const c of cells){
            const k=c.y*W+c.x;if(glintCells.has(k))continue;
            // Protect the complete source catchlight footprint, including its
            // mixed edge cells, rather than only the selected white centers.
            if(c.samples.some(p=>glintMasks.some(g=>g.has(p.sy*source.width+p.sx))))continue;
            const ranked=roles.map(r=>({r,points:c.roleGroups.get(r.name),area:c.roleGroups.get(r.name).reduce((s,p)=>s+p.weight,0)}));
            const total=c.samples.reduce((s,p)=>s+p.weight,0),eyeArea=ranked.filter(g=>eyeNames.has(g.r.name)).reduce((s,g)=>s+g.area,0);
            const exterior=ranked.filter(g=>!eyeNames.has(g.r.name)).sort((a,b)=>b.area-a.area);
            // Only source-supported sclera boundaries: do not relabel skin,
            // eyelids, isolated catchlights, or uniform eye interiors.
            if(eyeArea<=0||eyeArea>=total||exterior[0]?.r.name!=='white'||Math.abs(eyeArea/total-.5)<1e-10)continue;
            const old=currentValues[k],current=sourceRole({rgb:palette[old].rgb}),inside=eyeArea/total>.5;
            if(eyeNames.has(current.name)===inside)continue;
            const choice=ranked.filter(g=>eyeNames.has(g.r.name)===inside&&g.area>0).sort((a,b)=>b.area-a.area)[0];
            const color=nearest(mean(choice.points),choice.r.colors);
            put(c.x,c.y,color);boundarySampling.push({x:c.x,y:c.y,sourceEyeCoverage:eyeArea/total,sourceExteriorRole:exterior[0].r.name,from:palette[old].hex,to:palette[color].hex,inside});
          }
        }
        const thinLines=[],separators=[],jointRegions=[];let storedWhiteComponents=[],unresolvedWhiteMerges=0;
        if(f.preserveSourceEyeTopology){
          // Thin the SOURCE pigment, then project its centerline through the
          // same source/native transform as the area votes. No output template.
          const roleMap=new Map();for(const c of cells)for(const p of c.samples)roleMap.set(p.sy*source.width+p.sx,sourceRole(p).name);
          const skeleton=thinMask([...roleMap].filter(([,r])=>r==='pupil').map(([k])=>k),source.width);
          const narrow=[...skeleton].filter(k=>[1,source.width].some(step=>{
            const scale=step===1?fit.fitWidth/source.width:fit.fitHeight/source.height,ends=[];
            for(const sign of [-1,1]){
              let n=1;while(n<Math.ceil(1/scale)+2&&roleMap.get(k+sign*n*step)==='pupil')n++;
              ends.push({n,role:roleMap.get(k+sign*n*step)});
            }
            return ends.every(e=>['iris','iris-light'].includes(e.role))&&(ends[0].n+ends[1].n-1)*scale<=1;
          }));
          const projected=thinMask(narrow.map(k=>Math.floor((Math.floor(k/source.width)+.5)*fit.fitHeight/source.height+fit.offsetY)*W+Math.floor((k%source.width+.5)*fit.fitWidth/source.width+fit.offsetX)),W);
          // A clipped line at the annotation border is not evidence of an
          // internal pupil. Keep those runs exactly as the base conversion.
          for(const group of maskComponents(projected,W))if(group.some(k=>k%W===x||k%W===x+w-1||Math.floor(k/W)===y||Math.floor(k/W)===y+h-1))for(const k of group)projected.delete(k);
          const current=values(image),eyeColors=new Set(f.iris),pupil=roles.find(r=>r.name==='pupil');
          const jointMask=new Set();
          if(f.jointEyeRegions){
            // Select isolated subcell pupil strokes enclosed by iris in the
            // source. Solid pupils, lashes and clipped components retain the
            // previous conversion; there is no character or output-coordinate rule.
            const sourceBounds=[Math.min(...[...roleMap.keys()].map(k=>k%source.width)),Math.min(...[...roleMap.keys()].map(k=>Math.floor(k/source.width))),Math.max(...[...roleMap.keys()].map(k=>k%source.width)),Math.max(...[...roleMap.keys()].map(k=>Math.floor(k/source.width)))];
            const sourceNeighbors=k=>[k-1,k+1,k-source.width,k+source.width].filter(j=>Math.abs(j%source.width-k%source.width)+Math.abs(Math.floor(j/source.width)-Math.floor(k/source.width))===1);
            const inner=maskComponents([...roleMap].filter(([,r])=>r==='pupil').map(([k])=>k),source.width).filter(q=>{
              if(q.length*fit.fitWidth*fit.fitHeight/(source.width*source.height)<.5)return false;
              if(q.some(k=>k%source.width<=sourceBounds[0]||k%source.width>=sourceBounds[2]||Math.floor(k/source.width)<=sourceBounds[1]||Math.floor(k/source.width)>=sourceBounds[3]))return false;
              const border=[...new Set(q.flatMap(sourceNeighbors))].filter(k=>!q.includes(k));
              return border.length&&border.filter(k=>['iris','iris-light'].includes(roleMap.get(k))).length/border.length>.8&&q.length/Math.max(1,thinMask(q,source.width).size)*fit.fitWidth/source.width<1;
            });
            const irisKeys=new Set([...roleMap].filter(([,r])=>['iris','iris-light'].includes(r)).map(([k])=>k));
            for(const q of inner){
              const region=new Set(q),queue=q.slice();
              for(let i=0;i<queue.length;i++)for(const j of sourceNeighbors(queue[i]))if(irisKeys.has(j)&&!region.has(j)){region.add(j);queue.push(j);}
              for(const g of glintMasks)if([...g].some(k=>sourceNeighbors(k).some(j=>region.has(j))))for(const k of g)region.add(k);
              const bounds=[Math.min(...q.map(k=>k%source.width)),Math.min(...q.map(k=>Math.floor(k/source.width))),Math.max(...q.map(k=>k%source.width)),Math.max(...q.map(k=>Math.floor(k/source.width)))];
              const clusters=[];
              for(const name of ['pupil','iris','iris-light'])clusters.push({name,keys:new Set([...region].filter(k=>roleMap.get(k)===name))});
              const sampleCluster=new Map();clusters.forEach((g,i)=>{for(const k of g.keys)sampleCluster.set(k,i);});
              const eyePalette=palette.map((p,i)=>['pupil','iris','iris-light'].includes(sourceRole({rgb:p.rgb}).name)?i:-1).filter(i=>i>=0);
              const joint=[];
              for(const c of cells){
                const k=c.y*W+c.x;if(f.white.includes(current[k])||!eyePalette.includes(current[k]))continue;
                if(!c.samples.some(p=>p.sx>=bounds[0]&&p.sx<=bounds[2]&&p.sy>=bounds[1]&&p.sy<=bounds[3]))continue;
                const mass=clusters.map(()=>0),total=c.samples.reduce((s,p)=>s+p.weight,0);
                for(const p of c.samples){const j=sampleCluster.get(p.sy*source.width+p.sx);if(j!==undefined)mass[j]+=p.weight/total;}
                if(mass.reduce((a,b)=>a+b,0)<.5)continue;
                const sum=mass.reduce((a,b)=>a+b,0),weights=mass.map(v=>v/sum);joint.push({c,k,weights,owner:weights.indexOf(Math.max(...weights))});
              }
              const area=clusters.map((_,i)=>joint.reduce((s,c)=>s+c.weights[i],0)),budget=area.map(Math.floor);
              // A shared cell has exactly one owner. Allocate the measured
              // source area across pupil and iris together instead of OR-ing a
              // one-cell black skeleton onto an already quantized iris.
              const order=area.map((v,i)=>({i,f:v%1})).sort((a,b)=>b.f-a.f);
              for(let n=joint.length-budget.reduce((a,b)=>a+b,0),i=0;i<n;i++)budget[order[i].i]++;
              // Reserve the source-measured dark area as one connected region.
              // Independent strongest-cell picks can create floating black dots.
              let selected=new Set(),bestMass=-1;
              const supported=joint.filter(c=>c.weights[0]>0);
              for(const seed of supported){
                const chosen=new Set([seed.k]);
                while(chosen.size<budget[0]){
                  const next=supported.filter(c=>!chosen.has(c.k)&&[...chosen].some(k=>Math.max(Math.abs(c.k%W-k%W),Math.abs(Math.floor(c.k/W)-Math.floor(k/W)))===1)).sort((a,b)=>b.weights[0]-a.weights[0])[0];
                  if(!next)break;chosen.add(next.k);
                }
                const mass=joint.filter(c=>chosen.has(c.k)).reduce((s,c)=>s+c.weights[0],0);
                if(chosen.size===budget[0]&&mass>bestMass){selected=chosen;bestMass=mass;}
              }
              if(selected.size!==budget[0]){suspects.push({feature:f.name,reason:'Joint pupil area cannot remain connected on source-supported cells; base retained.'});continue;}
              for(const c of joint)c.owner=selected.has(c.k)?0:c.weights[1]>=c.weights[2]?1:2;
              const counts=clusters.map((_,i)=>joint.filter(c=>c.owner===i).length);
              for(let step=0;step<joint.length;step++){
                let best=null;for(const c of joint)if(c.owner!==0&&counts[c.owner]>budget[c.owner])for(let i=1;i<clusters.length;i++)if(counts[i]<budget[i]&&c.weights[i]>0){const cost=c.weights[c.owner]-c.weights[i];if(!best||cost<best.cost)best={c,i,cost};}
                if(!best)break;counts[best.c.owner]--;best.c.owner=best.i;counts[best.i]++;
              }
              if(counts.some((n,i)=>n!==budget[i])){suspects.push({feature:f.name,reason:'Joint source color areas cannot fit on supported cells; base retained.',budget,counts});continue;}
              const applied=[];
              for(const {c,k,owner}of joint){
                const group=clusters[owner],points=c.samples.filter(p=>group.keys.has(p.sy*source.width+p.sx));
                const allowed=group.name==='pupil'?pupil.colors:eyePalette.filter(i=>sourceRole({rgb:palette[i].rgb}).name===group.name);
                const color=nearest(mean(points),allowed);put(c.x,c.y,color);jointMask.add(k);applied.push({x:c.x,y:c.y,color:palette[color].hex,owner:group.name});
              }
              jointRegions.push({sourcePupilArea:q.length*fit.fitWidth*fit.fitHeight/(source.width*source.height),budgets:clusters.map((g,i)=>({name:g.name,area:area[i],budget:budget[i],count:counts[i]})),applied});
            }
          }
          // Add-only line restoration is opt-in. Detecting source ink alone
          // does not justify turning an entire native cell black.
          if(pupil&&f.restoreThinEyeLines===true)for(const c of cells){
            const k=c.y*W+c.x;if(!projected.has(k)||!eyeColors.has(current[k]))continue;
            if(jointMask.has(k))continue;
            const points=c.roleGroups.get('pupil');if(!points.length)continue;
            const color=nearest(mean(points),pupil.colors);put(c.x,c.y,color);
            thinLines.push({x:c.x,y:c.y,sourceCoverage:points.reduce((s,p)=>s+p.weight,0)/c.samples.reduce((s,p)=>s+p.weight,0)});
          }
          const sourceCellArea=fit.fitWidth*fit.fitHeight/(source.width*source.height);
          const components=maskComponents(whiteSource.keys(),source.width).filter(q=>q.length*sourceCellArea>=.5).map(q=>new Set(q));
          const glintIds=new Set(components.map((c,i)=>glintMasks.some(g=>g.has(c.values().next().value))?i:-1).filter(i=>i>=0));
          const owner=new Map(),support=new Map(),byKey=new Map(cells.map(c=>[c.y*W+c.x,c]));
          for(const c of cells){
            const k=c.y*W+c.x,weights=components.map(s=>c.samples.filter(p=>s.has(p.sy*source.width+p.sx)).reduce((a,p)=>a+p.weight,0)),total=c.samples.reduce((s,p)=>s+p.weight,0);
            if(Math.max(...weights)>0){owner.set(k,weights.indexOf(Math.max(...weights)));support.set(k,weights.reduce((a,b)=>a+b,0)/total);}
          }
          const white=new Set(cells.filter(c=>f.white.includes(current[c.y*W+c.x])&&owner.has(c.y*W+c.x)).map(c=>c.y*W+c.x));
          for(let iteration=0;iteration<cells.length;iteration++){
            const conflicts=new Set();
            for(const k of white)for(const j of around(k))if(white.has(j)&&owner.get(k)!==owner.get(j)&&(glintIds.has(owner.get(k))||glintIds.has(owner.get(j)))){conflicts.add(k);conflicts.add(j);}
            const candidates=[...conflicts].filter(k=>support.get(k)<1-1e-6&&[...white].filter(j=>owner.get(j)===owner.get(k)).length>Math.max(1,Math.floor(components[owner.get(k)].size*sourceCellArea/2))).sort((a,b)=>support.get(a)-support.get(b));
            if(!candidates.length)break;
            const k=candidates[0],c=byKey.get(k),points=c.samples.filter(p=>sourceRole(p).name!=='white');
            // Use only ink/iris actually present in this source cell. A skin
            // separator must not be invented to make a connectivity score pass.
            const pigmentPoints=points.filter(p=>['pupil','iris','iris-light'].includes(sourceRole(p).name));
            if(!pigmentPoints.length){support.set(k,1);continue;}
            const color=nearest(mean(pigmentPoints),[...new Set([...f.ink,...f.iris])]);put(c.x,c.y,color);white.delete(k);
            separators.push({x:c.x,y:c.y,whiteCoverage:support.get(k),color:palette[color].hex});
          }
          storedWhiteComponents=maskComponents(white,W).map(q=>({cells:q.map(k=>[k%W,Math.floor(k/W)]),sourceOwners:[...new Set(q.map(k=>owner.get(k)))]}));
          unresolvedWhiteMerges=storedWhiteComponents.filter(c=>c.sourceOwners.length>1&&c.sourceOwners.some(i=>glintIds.has(i))).length;
          if(unresolvedWhiteMerges)suspects.push({feature:f.name,reason:'Source-disconnected glint/sclera still merged; topology refinement must not count as visual success.',unresolvedWhiteMerges});
        }
        recordStage(f.name,previous,{kind:'eye',rasterization:f.rasterization,sourceArea,counts,glints,rejectedGlints,boundarySampling,sourceTopology:f.preserveSourceEyeTopology?{restoreThinEyeLines:f.restoreThinEyeLines===true,thinLines,separators,jointRegions,storedWhiteComponents,unresolvedWhiteMerges}:null,relocatedPixels:0});
        continue;
      }
      // Vote by semantic color role before choosing a shade, so several whites do not lose to one black.
      const sourceAreaMode=f.rasterization==='source-area',sourceDetail=f.rasterization==='source-detail',sourceShape=f.rasterization==='source-shape'||sourceDetail||sourceAreaMode;
      const classify=rgb=>{const L=luma(rgb),sat=(Math.max(...rgb)-Math.min(...rgb))/Math.max(1,...rgb);if(L>165&&sat<(sourceShape?.3:.24))return'white';if((sourceDetail||sourceAreaMode)&&L<60)return'ink';if((sourceShape&&f.irisAxis===1?rgb[1]>=rgb[0]*.8&&rgb[1]>=rgb[2]*1.1&&L<180:rgb.every((v,c)=>c===f.irisAxis||rgb[f.irisAxis]>v*1.04))&&L>=45)return'iris';if(L<90)return'ink';return'skin';};
      const roles={ink:f.ink,iris:f.iris,white:f.white,skin:f.skin},roleAt=new Map(),glintSource=new Map(),names=Object.keys(roles);
      for(const c of cells){const groups={ink:[],iris:[],white:[],skin:[]};for(const p of c.samples){const role=classify(p.rgb);groups[role].push(p);if(role==='white')glintSource.set(p.sy*source.width+p.sx,p);}
        const total=c.samples.reduce((s,p)=>s+p.weight,0);c.groups=groups;c.fractions=Object.fromEntries(names.map(r=>[r,groups[r].reduce((s,p)=>s+p.weight,0)/total]));
        c.role=names.reduce((best,r)=>c.fractions[r]>c.fractions[best]?r:best,'skin');
      }
      const sourceArea=Object.fromEntries(names.map(r=>[r,cells.reduce((s,c)=>s+c.fractions[r],0)])),targetCounts=Object.fromEntries(names.map(r=>[r,Math.floor(sourceArea[r])])),counts=Object.fromEntries(names.map(r=>[r,cells.filter(c=>c.role===r).length]));
      if(sourceShape&&!sourceDetail&&!sourceAreaMode){
        const remainder=[...names].sort((a,b)=>(sourceArea[b]%1)-(sourceArea[a]%1));
        let missing=cells.length-Object.values(targetCounts).reduce((a,b)=>a+b,0);for(let i=0;i<missing;i++)targetCounts[remainder[i]]++;
        // Shared area budgets prevent small irises/whites vanishing under independent majority votes.
        for(let n=0;n<cells.length;n++){
          let best=null;for(const c of cells)if(counts[c.role]>targetCounts[c.role])for(const r of names)if(counts[r]<targetCounts[r]&&c.fractions[r]>0){const cost=c.fractions[c.role]-c.fractions[r];if(!best||cost<best.cost)best={c,r,cost};}
          if(!best)break;counts[best.c.role]--;best.c.role=best.r;counts[best.r]++;
        }
        if(names.some(r=>counts[r]!==targetCounts[r]))suspects.push({feature:f.name,reason:'Source role area budget could not be met without painting unsupported cells.',targetCounts,counts:{...counts}});
      }
      for(const c of cells){
        if(sourceDetail){const p=centerSample(c.x,c.y,c.samples);c.role=classify(p.rgb);roleAt.set(c.y*W+c.x,c.role);if(c.role==='skin'&&f.preserveSkinOutsideEye)continue;put(c.x,c.y,c.role==='skin'&&skinChoices.has(c.y*W+c.x)?skinChoices.get(c.y*W+c.x):nearest(p.rgb,roles[c.role]));}
        else{roleAt.set(c.y*W+c.x,c.role);if(sourceAreaMode&&c.role==='skin'&&f.preserveSkinOutsideEye)continue;put(c.x,c.y,nearest(mean(c.groups[c.role]),roles[c.role]));}
      }
      if(sourceAreaMode){
        recordStage(f.name,previous,{kind:f.kind,rasterization:f.rasterization,sourceRoleArea:sourceArea,roleCounts:Object.fromEntries(names.map(r=>[r,cells.filter(c=>c.role===r).length])),glints:[],glintRelocation:false});
        continue;
      }
      const pending=new Set(glintSource.keys()),glints=[],highlightCandidates=[],detailGlints=[],nativeArea=source.width*source.height/(fit.fitWidth*fit.fitHeight);
      while(pending.size){const q=[pending.values().next().value];pending.delete(q[0]);for(let i=0;i<q.length;i++){const k=q[i],sx=k%source.width,sy=Math.floor(k/source.width);for(const j of [k-1,k+1,k-source.width,k+source.width])if(pending.has(j)&&Math.abs(j%source.width-sx)+Math.abs(Math.floor(j/source.width)-sy)===1){pending.delete(j);q.push(j);}}
        const xs=q.map(k=>k%source.width),ys=q.map(k=>Math.floor(k/source.width)),cx=xs.reduce((a,b)=>a+b+.5,0)/q.length,cy=ys.reduce((a,b)=>a+b+.5,0)/q.length;
        const nx=Math.floor(cx*fit.fitWidth/source.width)+fit.offsetX,ny=Math.floor(cy*fit.fitHeight/source.height)+fit.offsetY,area=q.length/nativeArea;
        const compact=(Math.max(...xs)-Math.min(...xs)+1)*fit.fitWidth/source.width<=1.5&&(Math.max(...ys)-Math.min(...ys)+1)*fit.fitHeight/source.height<=1.5;
        const neighbors=around(ny*W+nx).filter(k=>roleAt.get(k)==='iris'||roleAt.get(k)==='ink');
        const targetRole=roleAt.get(ny*W+nx);
        const touchesBorder=Math.min(...xs)<=Math.floor((x-fit.offsetX)*source.width/fit.fitWidth)||Math.max(...xs)>=Math.ceil((x+w-fit.offsetX)*source.width/fit.fitWidth)-1||Math.min(...ys)<=Math.floor((y-fit.offsetY)*source.height/fit.fitHeight)||Math.max(...ys)>=Math.ceil((y+h-fit.offsetY)*source.height/fit.fitHeight)-1;
        // A sub-cell highlight can already have won the white vote and merged with sclera.
        // Re-evaluate that measured compact component too; large whites remain untouched.
        const eligibleRole=['iris','ink'].includes(targetRole)||(sourceShape&&targetRole==='white'&&area<.75);
        const accepted=area>=(sourceDetail?.25:.03)&&area<=1.5&&compact&&!touchesBorder&&inRect(nx,ny,f.rect)&&eligibleRole&&neighbors.length>=2;
        if(area<=2)highlightCandidates.push({x:nx,y:ny,sourceAreaInNativeCells:area,compact,touchesBorder,targetRole,eligible:accepted,accepted:sourceDetail?false:accepted});
        if(accepted&&sourceDetail){detailGlints.push({x:nx,y:ny,sourceAreaInNativeCells:area,sourceMean:mean(q.map(k=>glintSource.get(k)))});}
        else if(accepted){
          const c=cells.find(c=>c.x===nx&&c.y===ny),chosen=sourceShape?nearest(mean(c.samples),[...f.ink,...f.iris,...f.white]):f.glint;
          put(nx,ny,chosen);glints.push({x:nx,y:ny,sourceAreaInNativeCells:area,color:palette[chosen].hex});
        }
      }
      if(sourceDetail&&detailGlints.length){
        const g=detailGlints.sort((a,b)=>b.sourceAreaInNativeCells-a.sourceAreaInNativeCells)[0],color=nearest(g.sourceMean,f.white),origin=g.y*W+g.x;
        // A sub-cell glint and the sclera can collapse into adjacent white cells.
        // Snap at most one cell horizontally within existing iris/ink; never add an eye template.
        const choices=[-1,0,1].map(dx=>({x:g.x+dx,y:g.y,dx})).filter(c=>inRect(c.x,c.y,f.rect)&&(c.dx===0||(['ink','iris'].includes(roleAt.get(c.y*W+c.x))&&['ink','iris'].includes(roleAt.get((c.y+1)*W+c.x)))));
        const score=c=>Math.abs(c.dx)+2*around(c.y*W+c.x).filter(k=>k!==origin&&roleAt.get(k)==='white').length;
        choices.sort((a,b)=>score(a)-score(b)||Math.abs(a.dx)-Math.abs(b.dx));const chosen=g.sourceAreaInNativeCells<.75?choices[0]:{x:g.x,y:g.y,dx:0};
        if(chosen.dx!==0){const c=cells.find(c=>c.x===g.x&&c.y===g.y),under=[...c.groups.ink,...c.groups.iris];if(under.length)put(g.x,g.y,nearest(mean(under),[...f.ink,...f.iris]));else{chosen.x=g.x;chosen.dx=0;}}
        put(chosen.x,chosen.y,color);glints.push({...g,x:chosen.x,y:chosen.y,sourceCell:[g.x,g.y],horizontalSnap:chosen.dx,color:palette[color].hex});
        const candidate=highlightCandidates.find(c=>c.x===g.x&&c.y===g.y&&c.sourceAreaInNativeCells===g.sourceAreaInNativeCells);if(candidate)candidate.accepted=true;
      }
      const actualRoleCounts=Object.fromEntries(names.map(r=>[r,cells.filter(c=>c.role===r).length]));
      recordStage(f.name,previous,{kind:f.kind,rasterization:f.rasterization??'legacy',sourceRoleArea:sourceArea,roleCountsBeforeGlints:actualRoleCounts,targetRoleCounts:sourceShape&&!sourceDetail?targetCounts:null,glints,highlightCandidates});
    }
  }
  if(contour?.mode==='source-coverage'){
    const previous=copy(),v=values(image),ink=index(contour.color),bgColor=index(contour.background),bg=new Set(),q=[];
    const seed=k=>{if(v[k]===bgColor&&!bg.has(k)){bg.add(k);q.push(k);}};
    for(let k=0;k<N;k++)if(k<W||k>=N-W||k%W===0||k%W===W-1)seed(k);
    for(const [x,y]of contour.seeds??[])seed(y*W+x);
    for(let n=0;n<q.length;n++)for(const j of around(q[n]))seed(j);
    const boundary=new Set();for(const k of bg)for(const j of around(k))if(!bg.has(j)){boundary.add(j);boundary.add(k);}
    const threshold=(luma(palette[ink].rgb)+luma(palette[bgColor].rgb))/2;
    const inkFamily=palette.map((c,i)=>({i,l:luma(c.rgb)})).filter(c=>c.l<=luma(palette[ink].rgb)+35).map(c=>c.i);
    const evidence=[];
    for(const k of boundary){const x=k%W,y=Math.floor(k/W);if(claimed.has(k)||!inRect(x,y,[fit.offsetX,fit.offsetY,fit.fitWidth,fit.fitHeight])||(!inkFamily.includes(v[k])&&v[k]!==bgColor))continue;
      const all=samples(x,y),total=all.reduce((s,p)=>s+p.weight,0),dark=all.filter(p=>luma(p.rgb)<threshold),coverage=dark.reduce((s,p)=>s+p.weight,0)/total;
      // Only source dark-vs-exterior decisions. Interior stroke width/materials
      // are untouched; no one-cell rim is painted and no neighbor donor is used.
      const chosen=coverage>=.5?nearest(mean(dark),inkFamily):bgColor;
      if(chosen!==v[k]){put(x,y,chosen);evidence.push({x,y,sourceInkCoverage:coverage,from:palette[v[k]].hex,to:palette[chosen].hex});}
    }
    recordStage('contour',previous,{mode:'source-coverage',sourceLumaThreshold:threshold,fixedWidth:false,interiorStrokeCellsRepainted:0,evidence});
  }
  if(contour&&contour.mode!=='source-coverage'){
    const previous=copy(),v=values(image),ink=index(contour.color),bgColor=index(contour.background),bg=new Set(),q=[];
    const seed=k=>{if(v[k]===bgColor&&!bg.has(k)){bg.add(k);q.push(k);}};
    for(let k=0;k<N;k++)if(k<W||k>=N-W||k%W===0||k%W===W-1)seed(k);
    for(const[x,y]of contour.seeds??[]){if(v[y*W+x]!==bgColor)throw new Error('Contour seed is not background-colored.');seed(y*W+x);}
    for(let p=0;p<q.length;p++)for(const j of around(q[p]))seed(j);
    const depth=new Int16Array(N).fill(-1);for(const k of q)depth[k]=0;
    for(let p=0;p<q.length;p++)for(const j of around(q[p]))if(depth[j]<0){depth[j]=depth[q[p]]+1;q.push(j);}
    const rim=new Set();for(let k=0;k<N;k++)if(!bg.has(k)&&around(k).some(j=>bg.has(j)))rim.add(k);
    for(let k=0;k<N;k++)if(v[k]===ink&&!rim.has(k)&&depth[k]>0&&depth[k]<=(contour.bandDepth??3)&&!claimed.has(k)){
      const seen=new Set([k]);let queue=[k],donors=[];
      for(let d=0;d<3&&!donors.length;d++){const next=[];for(const p of queue)for(const j of around(p))if(!seen.has(j)&&!bg.has(j)&&!rim.has(j)&&!claimed.has(j)){seen.add(j);next.push(j);if(v[j]!==ink)donors.push(v[j]);}queue=next;}
      if(donors.length){const counts=new Map();for(const c of donors)counts.set(c,(counts.get(c)||0)+1);const chosen=[...counts].sort((a,b)=>b[1]-a[1]||a[0]-b[0])[0][0];put(k%W,Math.floor(k/W),chosen);}
      else suspects.push({x:k%W,y:Math.floor(k/W),reason:'Interior contour duplicate has no safe material donor.'});
    }
    for(const k of rim)if(!claimed.has(k))put(k%W,Math.floor(k/W),ink);
    const after=values(image),wide=[],blocks=[],preventedThickening=[],skipped=new Set(),sourceThinned=[];
    if(contour.sourceThinJunctions){
      // Resolve filled contour squares only where source darkness supports
      // removing a pixel and the local eight-connected stroke stays connected.
      // Material replacement never changes foreground/background occupancy.
      for(let pass=0;pass<3;pass++)for(let y=1;y<H-2;y++)for(let x=1;x<W-2;x++){
        const k=y*W+x,square=[k,k+1,k+W,k+W+1];
        if(!square.every(j=>after[j]===ink)||!square.some(j=>rim.has(j)))continue;
        const candidates=square.filter(j=>!claimed.has(j)).map(j=>{
          const a=samples(j%W,Math.floor(j/W)),all=a.reduce((s,p)=>s+p.weight,0);
          return {k:j,coverage:a.filter(p=>luma(p.rgb)<70).reduce((s,p)=>s+p.weight,0)/all};
        }).sort((a,b)=>a.coverage-b.coverage);
        for(const c of candidates){
          if(c.coverage>=.5)continue;
          const cx=c.k%W,cy=Math.floor(c.k/W),neighbors=[];
          for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if(dx||dy){const j=(cy+dy)*W+cx+dx;if(after[j]===ink)neighbors.push(j);}
          const connected=new Set(neighbors.slice(0,1)),queue=neighbors.slice(0,1);
          for(let n=0;n<queue.length;n++)for(const j of neighbors)if(!connected.has(j)&&Math.max(Math.abs(j%W-queue[n]%W),Math.abs(Math.floor(j/W)-Math.floor(queue[n]/W)))<=1){connected.add(j);queue.push(j);}
          if(connected.size!==neighbors.length)continue;
          const visited=new Set([c.k]),search=[c.k],donors=[];
          for(let n=0;n<search.length&&!donors.length;n++)for(const j of around(search[n])){
            if(visited.has(j)||bg.has(j)||Math.abs(j%W-cx)+Math.abs(Math.floor(j/W)-cy)>3)continue;
            visited.add(j);search.push(j);if(after[j]!==ink)donors.push(j);
          }
          if(!donors.length)continue;
          const rgb=mean(samples(cx,cy)),color=nearest(rgb,[...new Set(donors.map(j=>after[j]))]);
          after[c.k]=color;put(cx,cy,color);skipped.add(c.k);sourceThinned.push({x:cx,y:cy,sourceDarkCoverage:c.coverage,color:palette[color].hex});break;
        }
      }
    }
    // Painting both sides of a two-cell-wide tip can thicken an already-correct run.
    // Keep that prior material cell and report it; do not silently change silhouette.
    const at=(a,b)=>a<0||b<0||a>=W||b>=H?-1:b*W+a;
    for(const k of rim){const x=k%W,y=Math.floor(k/W);
      for(const[dx,dy]of [[1,0],[-1,0],[0,1],[0,-1]]){
        if(![-1,0,1].every(t=>v[at(x+t*dy,y+t*dx)]===ink&&bg.has(at(x+dx+t*dy,y+dy+t*dx))))continue;
        if(v[at(x-dx,y-dy)]===ink||after[at(x-dx,y-dy)]!==ink)continue;
        for(let n=1;n<20&&after[at(x-n*dx,y-n*dy)]===ink;n++){
          const j=at(x-n*dx,y-n*dy);if(rim.has(j)&&v[j]!==ink&&!claimed.has(j)){
            put(j%W,Math.floor(j/W),v[j]);after[j]=v[j];skipped.add(j);
            const point={x:j%W,y:Math.floor(j/W),reason:'Outline addition would thicken a prior one-cell run; original material retained for review.'};
            preventedThickening.push(point);suspects.push(point);
          }
        }
      }
    }
    for(const k of rim){const x=k%W,y=Math.floor(k/W);if(after[k]!==ink&&!skipped.has(k))suspects.push({x,y,reason:'Protected feature intersects contour.'});
      for(const[dx,dy]of [[1,0],[-1,0],[0,1],[0,-1]]){
        const at=(a,b)=>a<0||b<0||a>=W||b>=H?-1:b*W+a;
        if(![-1,0,1].every(t=>after[at(x+t*dy,y+t*dx)]===ink&&bg.has(at(x+dx+t*dy,y+dy+t*dx))))continue;
        let width=0;while(width<20&&after[at(x-width*dx,y-width*dy)]===ink)width++;if(width>1)wide.push({x,y,dx,dy,width});
      }
    }
    for(let y=0;y<H-1;y++)for(let x=0;x<W-1;x++){const k=y*W+x,c=[k,k+1,k+W,k+W+1];if(c.every(j=>after[j]===ink)&&c.some(j=>rim.has(j)))blocks.push({x,y});}
    for(const p of wide)suspects.push({...p,reason:'Axis-aligned ray crosses multiple ink pixels; compare against source to distinguish stroke thickness from a curl or junction.'});
    for(const p of blocks)suspects.push({...p,reason:'Solid 2x2 contour junction needs source-shape review.'});
    recordStage('contour',previous,{boundaryCells:rim.size,negativeSpaceSeeds:contour.seeds??[],silhouetteChanged:0,wideSamples:wide,solid2x2Blocks:blocks,preventedThickening,sourceThinned});
  }
  // Keep the finished skin base intact, then restore only supported dark pigment.
  // This layer cannot brighten skin, repaint eye/mouth pigment or alter the outline.
  for(const p of planes.filter(p=>p.mode==='source-tones'&&p.shadowLayer)){
    const previous=copy(),v=values(image),[x,y,w,h]=p.rect,cells=[],protectedCells=new Set();
    for(const f of features){
      if(f.kind==='curve')for(const c of stages.find(s=>s.name===f.name)?.path??[])protectedCells.add(c.y*W+c.x);
      else for(let yy=f.rect[1];yy<f.rect[1]+f.rect[3];yy++)for(let xx=f.rect[0];xx<f.rect[0]+f.rect[2];xx++)if(!f.skin.includes(v[yy*W+xx]))protectedCells.add(yy*W+xx);
    }
    for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++){
      const k=yy*W+xx;if(!p.colors.slice(1).includes(v[k])||protectedCells.has(k))continue;
      const all=samples(xx,yy),area=all.reduce((s,q)=>s+q.weight,0),skin=all.filter(q=>q.rgb[0]-q.rgb[1]>30&&q.rgb[1]-q.rgb[2]>20&&luma(q.rgb)>110);
      if(skin.reduce((s,q)=>s+q.weight,0)/area<.6)continue;
      cells.push({x:xx,y:yy,k,all,skin,area});
    }
    const lights=cells.flatMap(c=>c.skin.map(q=>luma(q.rgb))).sort((a,b)=>a-b),baseLight=lights.length?lights[Math.floor(lights.length*.65)]:null,evidence=[];
    for(const c of cells){
      const dark=c.skin.filter(q=>luma(q.rgb)<baseLight-32&&luma(q.rgb)<175),coverage=dark.reduce((s,q)=>s+q.weight,0)/c.area;
      if(coverage<.25||(!dark.includes(centerSample(c.x,c.y,c.all))&&coverage<.4))continue;
      const rgb=mean(dark);if(luma(rgb)>luma(palette[p.colors[0]].rgb)+20)continue;
      const cellMean=mean(c.skin),chosen=p.shadowSampling==='cell-mean'?nearest(cellMean,p.colors.slice(0,2)):p.colors[0];
      put(c.x,c.y,chosen);evidence.push({x:c.x,y:c.y,sourceCoverage:coverage,sourceShadowMean:rgb,sourceCellMean:cellMean,chosen:palette[chosen].hex});
    }
    recordStage((p.name||'skin')+'-shadow-layer',previous,{kind:'skin-shadow-layer',sampling:p.shadowSampling??'dark-pigment',baseLight,evidence,meaning:'Source-supported shadow candidates; cell-mean mode selects an existing palette entry from all warm-skin samples, not just dark samples.'});
  }
  return {image,report:{algorithmVersion:5,inputAnnotations:'Rectangles, role palettes and optional negative-space seeds; no output pixel patches.',manualOutputEdits:0,stages,suspects,visualAcceptance:'NOT ASSESSED BY SCRIPT',reviewRequired:true}};
}

module.exports={refineStructure,thinMask};
