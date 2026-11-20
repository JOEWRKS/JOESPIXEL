#!/usr/bin/env node
'use strict';

// Opaque PNG only. Use the installed pngjs dependency or an existing workspace copy.
// This enforces a supplied palette; it never learns or expands one.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { refineStructure } = require('./refine-structure.cjs');

function loadPng() {
  try {
    return require(require.resolve('pngjs', { paths: [__dirname, process.cwd()] })).PNG;
  } catch {
    throw new Error('pngjs is unavailable. Install the declared package dependencies before conversion.');
  }
}

function parsePalette(document) {
  const colors = document.colors?.map(entry => typeof entry === 'string' ? entry : entry.hex);
  if (!colors?.length || colors.some(hex => !/^#[0-9a-f]{6}$/i.test(hex))) {
    throw new Error('Palette must contain explicit #RRGGBB colors.');
  }
  const normalized = colors.map(hex => hex.toUpperCase());
  if (new Set(normalized).size !== normalized.length) throw new Error('Duplicate palette colors.');
  if (document.colorCount !== undefined && document.colorCount !== normalized.length) {
    throw new Error('Declared palette colorCount differs from the actual list.');
  }
  return normalized.map(hex => ({
    hex,
    rgb: [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16)),
  }));
}

const hexOf = (data, index) => '#' + [...data.subarray(index, index + 3)]
  .map(value => value.toString(16).padStart(2, '0')).join('').toUpperCase();

// Pre-conversion palette planning. Never invoked during rasterization: the caller
// must save/freeze the returned list before prepare(). Rectangles describe source
// features, not output dots. Keep the count while reserving poorly represented
// source colors that would otherwise lose to large clothing/background fields.
function preserveSourceColors(source, palette, regions, background) {
  if(!Array.isArray(regions)||!regions.length)throw new Error('Source color regions required.');
  const distance=(a,b)=>a.reduce((s,v,i)=>s+(v-b[i])**2,0);
  const hist=new Map();
  const add=(x,y,weight)=>{const k=(y*source.width+x)*4;if(source.data[k+3]!==255)throw new Error('Opaque palette planning input required.');const rgb=[...source.data.subarray(k,k+3)],hex=hexOf(source.data,k);const p=hist.get(hex);if(p)p.weight+=weight;else hist.set(hex,{rgb,hex,lab:toLab(rgb),weight});};
  for(let y=0;y<source.height;y++)for(let x=0;x<source.width;x++)add(x,y,1);
  const featureBins=[];
  for(const r of regions){const [x,y,w,h]=r.rect??[];if(!r.name||![x,y,w,h].every(Number.isSafeInteger)||x<0||y<0||w<1||h<1||x+w>source.width||y+h>source.height)throw new Error('Invalid source color region.');
    if(!Array.isArray(r.roles)||!r.roles.length||r.roles.some(p=>!p.name||!Array.isArray(p.rgb)||p.rgb.length!==3||!p.rgb.every(v=>Number.isFinite(v)&&v>=0&&v<=255)))throw new Error('Source color regions require observed role RGB samples.');
    const points=[],weight=source.width*source.height/(regions.length*w*h);
    for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++){add(xx,yy,weight);points.push(hist.get(hexOf(source.data,(yy*source.width+xx)*4)));}
    for(const role of r.roles){const target=toLab(role.rgb),p=points.reduce((a,b)=>distance(b.lab,target)<distance(a.lab,target)?b:a);if(distance(p.lab,target)>.055**2)throw new Error('Role sample is not supported inside source region: '+r.name+'/'+role.name);featureBins.push({...p,region:r.name,role:role.name,support:1});}
  }
  const colors=palette.map(p=>({...p})),locked=new Set([background.toUpperCase()]),changes=[];
  const represented=(p,c)=>distance(toLab(c.rgb),p.lab)<=.04**2||p.rgb.every((v,i)=>Math.abs(v-c.rgb[i])<=8);
  // Preserve isolated gamut colors irrespective of their pixel frequency.
  // Otherwise an eye reservation can erase a tiny yellow button elsewhere.
  for(const c of colors)if(Math.min(...colors.filter(p=>p!==c).map(p=>distance(toLab(c.rgb),toLab(p.rgb))))>.08**2)locked.add(c.hex);
  // Existing critical colors are reserved too: a rare iris must not be removed
  // to make room for a different rare mark merely because its global count is low.
  for(const p of featureBins){const best=colors.reduce((a,b)=>distance(toLab(b.rgb),p.lab)<distance(toLab(a.rgb),p.lab)?b:a);if(represented(p,best))locked.add(best.hex);}
  // Stop when all observed roles are represented or no unreserved entry remains.
  for(let attempt=0;attempt<featureBins.length;attempt++){
    const labs=colors.map(c=>toLab(c.rgb));
    const missing=featureBins.map(p=>({...p,error:Math.min(...labs.map(l=>distance(l,p.lab)))})).filter(p=>!colors.some(c=>represented(p,c))&&!locked.has(p.hex)).sort((a,b)=>b.error*Math.sqrt(b.support)-a.error*Math.sqrt(a.support));
    if(!missing.length)break;const selected=missing[0],usage=new Float64Array(colors.length);
    // Remove the least costly redundant representative, not the least frequent
    // color (which could be the only yellow button or gold laurel color).
    for(const p of hist.values()){const errors=labs.map(l=>distance(p.lab,l));let best=0;for(let i=1;i<labs.length;i++)if(errors[i]<errors[best])best=i;const second=Math.min(...errors.filter((_,i)=>i!==best)),added=distance(p.lab,selected.lab);usage[best]+=p.weight*(Math.min(second,added)-Math.min(errors[best],added));}
    const candidates=colors.map((c,i)=>({c,i,usage:usage[i]})).filter(x=>!locked.has(x.c.hex));candidates.sort((a,b)=>a.usage-b.usage);const replace=candidates[0];if(!replace)break;
    changes.push({region:selected.region,sourceRole:selected.role,sourceColor:selected.hex,previousNearestError:Math.sqrt(selected.error),replaced:replace.c.hex});colors[replace.i]={hex:selected.hex,rgb:selected.rgb};locked.add(selected.hex);
  }
  const roleCoverage=featureBins.map(p=>{const best=colors.reduce((a,b)=>distance(toLab(b.rgb),p.lab)<distance(toLab(a.rgb),p.lab)?b:a);const error=Math.sqrt(distance(toLab(best.rgb),p.lab));return{region:p.region,role:p.role,sourceColor:p.hex,paletteColor:best.hex,error,represented:colors.some(c=>represented(p,c))};});
  return {palette:colors,report:{sourcePixelsSha256:crypto.createHash('sha256').update(source.data).digest('hex'),sourceSize:[source.width,source.height],changes,count:colors.length,roleCoverage,allRolesRepresented:roleCoverage.every(r=>r.represented),sourceRectangles:regions,meaning:'Source-color coverage only; no feature geometry guarantee. Save and freeze before conversion.'}};
}

function inspect(png, palette) {
  const allowed = new Set(palette.map(color => color.hex));
  const used = new Set();
  let offPalettePixels = 0;
  let partialAlphaPixels = 0;
  let transparentPixels = 0;
  for (let i = 0; i < png.data.length; i += 4) {
    const alpha = png.data[i + 3];
    if (alpha === 0) { transparentPixels++; continue; }
    if (alpha !== 255) partialAlphaPixels++;
    const hex = hexOf(png.data, i);
    used.add(hex);
    if (!allowed.has(hex)) offPalettePixels++;
  }
  return {
    width: png.width, height: png.height, colorsUsed: used.size,
    usedHex: used.size <= 256 ? [...used].sort() : null,
    offPaletteExamples: [...used].filter(hex => !allowed.has(hex)).slice(0, 8),
    offPalettePixels, partialAlphaPixels, transparentPixels,
  };
}

// Perceptual nearest color selection changes only which existing entry is chosen.
// No interpolated RGB is ever written.
function toLab(rgb) {
  const [r, g, b] = rgb.map(channel => {
    const v = channel / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  const l = Math.cbrt(0.4122214708*r + 0.5363325363*g + 0.0514459929*b);
  const m = Math.cbrt(0.2119034982*r + 0.6806995451*g + 0.1073969566*b);
  const s = Math.cbrt(0.0883024619*r + 0.2817188376*g + 0.6299787005*b);
  return [
    0.2104542553*l + 0.793617785*m - 0.0040720468*s,
    1.9779984951*l - 2.428592205*m + 0.4505937099*s,
    0.0259040371*l + 0.7827717662*m - 0.808675766*s,
  ];
}

// Opt-in regional pass. Masks and material palettes must be reviewed by the caller.
// Source means are decision statistics only; no averaged/interpolated RGB is output.
function refineRegions(PNG, source, native, palette, fit, regions, sourceColors = null) {
  if (!Array.isArray(regions)) throw new Error('Regions must be an array.');
  if (!fit || ![fit.fitWidth,fit.fitHeight,fit.offsetX,fit.offsetY].every(Number.isSafeInteger) ||
      fit.fitWidth<1 || fit.fitHeight<1 || fit.offsetX<0 || fit.offsetY<0 ||
      fit.offsetX+fit.fitWidth>native.width || fit.offsetY+fit.fitHeight>native.height) {
    throw new Error('Invalid fitted source bounds.');
  }
  const indexOf = hex => palette.findIndex(p => p.hex === String(hex).toUpperCase());
  const occupied = new Set();
  const prepared = regions.map(region => {
    if (!region || typeof region.name !== 'string' || !region.name.trim() ||
        !Array.isArray(region.pixels) || !region.pixels.length ||
        !Array.isArray(region.colors) || !region.colors.length) {
      throw new Error('Each region requires a name, nonempty pixels, and palette colors.');
    }
    const colors = region.colors.map(indexOf);
    if (colors.some(i => i < 0) || new Set(colors).size !== colors.length) {
      throw new Error('Region colors must be unique fixed palette entries.');
    }
    const coherence = region.coherence ?? 0;
    const edgeThreshold = region.edgeThreshold ?? 0.025;
    if (!Number.isFinite(coherence) || coherence < 0 || coherence > 0.01 ||
        !Number.isFinite(edgeThreshold) || edgeThreshold <= 0 || edgeThreshold > 1) {
      throw new Error('Invalid region coherence or edgeThreshold.');
    }
    const pixels = region.pixels.map(point => {
      if (!Array.isArray(point) || point.length !== 2 || !point.every(Number.isSafeInteger)) {
        throw new Error('Region pixels must be integer [x,y] coordinates.');
      }
      const [x,y] = point;
      if (x < fit.offsetX || y < fit.offsetY || x >= fit.offsetX + fit.fitWidth ||
          y >= fit.offsetY + fit.fitHeight) throw new Error('Region pixel outside fitted source.');
      const key = y*native.width+x;
      if (occupied.has(key)) throw new Error('Duplicate or overlapping region pixel.');
      occupied.add(key);
      return {x,y,key};
    }).sort((a,b) => a.key-b.key);
    return {name:region.name,colors,coherence,edgeThreshold,pixels};
  });
  const sourceStats = inspect(source,palette), nativeStats = inspect(native,palette);
  if (sourceStats.partialAlphaPixels || sourceStats.transparentPixels || nativeStats.offPalettePixels ||
      nativeStats.partialAlphaPixels || nativeStats.transparentPixels) {
    throw new Error('Regional refinement requires opaque source and compliant opaque native input.');
  }
  const image = new PNG({width:native.width,height:native.height});native.data.copy(image.data);
  const labs = palette.map(p => toLab(p.rgb));
  const distance = (a,b) => a.reduce((sum,v,i) => sum+(v-b[i])**2,0);
  function sourceMean(x,y) {
    const left=(x-fit.offsetX)*source.width/fit.fitWidth, right=(x+1-fit.offsetX)*source.width/fit.fitWidth;
    const top=(y-fit.offsetY)*source.height/fit.fitHeight, bottom=(y+1-fit.offsetY)*source.height/fit.fitHeight;
    const sum=[0,0,0];let area=0;
    for(let sy=Math.floor(top);sy<Math.min(source.height,Math.ceil(bottom));sy++) {
      for(let sx=Math.floor(left);sx<Math.min(source.width,Math.ceil(right));sx++) {
        const weight=(Math.min(right,sx+1)-Math.max(left,sx))*(Math.min(bottom,sy+1)-Math.max(top,sy));
        const p=(sy*source.width+sx)*4;
        for(let channel=0;channel<3;channel++)sum[channel]+=source.data[p+channel]*weight;
        area+=weight;
      }
    }
    return toLab(sum.map(value => value/area));
  }
  const reports=[];
  for(const region of prepared) {
    const {colors,coherence,edgeThreshold}=region;
    const cells=region.pixels.map(p => {
      // Internal semantic sampling can exclude eye/outline pigment from skin means.
      const rgb=sourceColors?.get(p.key);
      if(rgb&&(!Array.isArray(rgb)||rgb.length!==3||rgb.some(v=>!Number.isFinite(v)||v<0||v>255)))throw new Error('Invalid semantic source color.');
      const lab=rgb?toLab(rgb):sourceMean(p.x,p.y),costs=colors.map(i => distance(lab,labs[i]));
      return {...p,lab,costs,label:costs.indexOf(Math.min(...costs))};
    });
    const byKey=new Map(cells.map(c => [c.key,c]));
    let passes=0,converged=true;
    if(coherence) {
      // Resolve nearly tied cells toward their own mask's aggregate preference.
      const totals=colors.map((_,i) => cells.reduce((sum,c) => sum+c.costs[i],0));
      const preference=totals.indexOf(Math.min(...totals));
      for(const c of cells)if(c.costs[preference]-c.costs[c.label]<coherence)c.label=preference;
      converged=false;
      for(let pass=0;pass<12;pass++) {
        let changes=0;passes++;
        for(const c of (pass%2?[...cells].reverse():cells)) {
          const neighbors=[[c.x-1,c.y],[c.x+1,c.y],[c.x,c.y-1],[c.x,c.y+1]]
            .filter(([x,y]) => x>=0&&x<native.width&&y>=0&&y<native.height)
            .map(([x,y]) => byKey.get(y*native.width+x)).filter(Boolean);
          const energies=colors.map((_,i) => c.costs[i]+neighbors.reduce((sum,n) =>
            sum+(i===n.label?0:coherence*Math.max(0,1-Math.sqrt(distance(c.lab,n.lab))/edgeThreshold)),0));
          const best=energies.indexOf(Math.min(...energies));
          if(best!==c.label){c.label=best;changes++;}
        }
        if(!changes){converged=true;break;}
      }
    }
    const changes=[];
    for(const c of cells) {
      const from=hexOf(native.data,c.key*4),to=palette[colors[c.label]].hex;
      if(from!==to)changes.push({x:c.x,y:c.y,from,to});
      image.data.set([...palette[colors[c.label]].rgb,255],c.key*4);
    }
    reports.push({name:region.name,cells:cells.length,coherence,edgeThreshold,passes,converged,changes});
  }
  return {image,report:{
    meaning:'Explicit masks; source-area color statistics and bounded neighbor consistency. Not semantic recognition or visual acceptance.',
    regions:reports,
  }};
}

function buildNative(PNG, source, palette, width, height, background, sampling = 'nearest', protection = null, regions = null, structure = null, eyePolicy = null, formPolicy = null, outlinePolicy = null, materialPlan = null, trace = null) {
  const emit=(stage,image,details)=>require('./conversion-trace.cjs').snapshot(PNG,trace,stage,image,details);
  emit('source',source);
  if(eyePolicy)require('./eye-plane-policy.cjs').assertEyePolicy(eyePolicy,palette);
  if(materialPlan && sampling!=='source-region-area')throw Error('Material assignment requires source-region-area; no ignored plan or fallback');
  const material=materialPlan?require('./material-assignment.cjs').compile(PNG,source,palette,width,height,require('./material-assignment.cjs').readPlan(materialPlan),{eyePolicy,formPolicy,outlinePolicy}):null;
  if((material?.fixedCells.size||material?.plan.surfaces?.length||material?.plan.lineLayouts?.length)&&outlinePolicy?.layout!=='joint-source-band')throw Error('Surface and preservation constraints require joint-source-band; no ignored contract');
  const built=buildCandidate(PNG,source,palette,width,height,background,sampling,protection,regions,structure,eyePolicy,material,outlinePolicy?.layout==='joint-source-band');
  const requireClaims=(image,claims,phase)=>{
    const changed=claims.filter(([p,c])=>image.data.readUInt32BE(p*4)!==c);
    if(changed.length)throw Error(phase+' overwrote previously assigned feature cells: '+changed.map(([p])=>p).join(','));
  };
  built.materialContext=material;
  if(built.sourceLabels)emit('source-color-assignment',built.sourceLabels);
  emit('area-placement',built.image);
  if(formPolicy){
    const sourceStrokeRepair = sampling==='source-region-area' &&
      formPolicy.features?.length && formPolicy.features.every(f=>f.kind==='stroke');
    if((sampling!=='area-vote'&&!sourceStrokeRepair)||protection||regions||structure)
      throw Error('Form allocation requires plain area-vote, or observed strokes after source-region-area, without stacked corrections');
    const grid=require('./eye-plane-policy.cjs').affineEyeGrid(source,built.image,built.fit);
    const forms=require('./raster-observed-details.cjs').allocateRequiredForms(PNG,source,built.image,grid,palette,formPolicy,material);
    built.image=forms.image;built.formReport=forms.report;
    emit('required-forms',built.image,forms.report);
    if(forms.report.unresolved.length)throw Error('Required source forms unresolved: '+forms.report.unresolved.map(name=>{
      const r=forms.report.features.find(r=>r.name===name);
      return name+(r?.action?' ('+r.action+(r.edges?' at '+r.edges.join('/')+' edge of sourceRegion; see input-contract contextSamples':'')+')':'');
    }).join(', '));
  }
  // Required forms must be owned by the outline route. joint-source-band takes
  // formPolicy features as ownership and never reads mode; only the legacy
  // contour route needs the reviewed source-silhouette-width mode for that.
  const outlineOwnsForms=outlinePolicy?.layout==='joint-source-band'||outlinePolicy?.mode==='source-silhouette-width';
  if(outlinePolicy&&(protection||regions||structure||(formPolicy&&!outlineOwnsForms)||!['area-vote','source-region-area'].includes(sampling)||outlinePolicy.background!==background))
    throw Error('Source ink width allocation requires plain fixed-area conversion and matching background; no stacked repair'+
      (formPolicy&&!outlineOwnsForms?' (required forms need outlinePolicy.layout "joint-source-band" or legacy mode "source-silhouette-width")':''));
  if(!eyePolicy){if(outlinePolicy)throw Error('Outline conversion must retain the common eye policy');return {...built,eyePolicyReport:{status:'UNASSESSED_CANDIDATE_ONLY'}};}
  const {applyEyePolicy,affineEyeGrid}=require('./eye-plane-policy.cjs');
  const eyes=applyEyePolicy(PNG,source,built.image,palette,eyePolicy,affineEyeGrid(source,built.image,built.fit),material);
  requireClaims(eyes.image,built.formReport?.expectedColors??[],'Eye placement');
  if(eyes.sourceRoleMap)emit('eye-source-roles',eyes.sourceRoleMap);
  emit('eye-placement',eyes.image,eyes.report);
  if(outlinePolicy){
    if(outlinePolicy.layout==='joint-source-band'){
      const owned=require('./raster-owned-stroke-bands.cjs');
      const ownership=require('./eye-plane-policy.cjs').eyeOwnership(source,eyePolicy,width,height);
      // Search rectangles locate a feature; only its actual pigment and
      // touched grid cells belong to it. This matches material exceptions.
      // Protection stops the exterior owner, never the stroke's own verification.
      for(const f of formPolicy?.features??[]){
        const [rx,ry,rw,rh]=f.sourceRegion??[];if(!rw)continue;
        const isStroke=require('./raster-observed-details.cjs').sourceStrokeClassifier(f);
        const formCells=new Set();
        for(let y=ry;y<ry+rh;y++)for(let x=rx;x<rx+rw;x++){
          const q=y*source.width+x;
          if(!isStroke([...source.data.subarray(q*4,q*4+3)]))continue;
          if(ownership.mask[q])throw Error('Required form and eye source ownership overlap');
          const p=Math.floor(y*height/source.height)*width+Math.floor(x*width/source.width);
          if(ownership.cells.has(p))throw Error('Required form and another feature compete for one grid cell');
          ownership.mask[q]=1;formCells.add(p);
        }
        for(const p of formCells)ownership.cells.add(p);
      }
      const assignedFeatures=[...ownership.cells].map(p=>[p,eyes.image.data.readUInt32BE(p*4)]);
      const result=owned.joint(PNG,source,eyes.image,palette,outlinePolicy,material,ownership,built.sourceLabels,trace);
      requireClaims(result.image,assignedFeatures,'Joint boundary placement');
      requireClaims(result.image,built.formReport?.expectedColors??[],'Joint boundary placement');
      result.report.surfaceAudit=require('./material-surface-layout.cjs').auditMaterialSurfaces(result.image,result.report.surfaceLayout);
      if(result.report.surfaceAudit.status==='FAIL')throw Error('Source-observed surface or boundary was lost during joint placement: '+JSON.stringify(result.report.surfaceAudit));
      result.report.savedWidth=owned.auditRenderedStrokeBands(result.image,result.report);
      emit('saved-stroke-audit',result.image,result.report.savedWidth);
      owned.requireRenderedStrokeAudit(result.report.savedWidth);
      if(material){
        const allocations=new Map([...result.report.expectedColors,...result.report.expectedFillColors]);
        const audit=require('./material-assignment.cjs').audit(result.image,material,allocations);
        emit('material-audit',result.image,audit);
        if(audit.violations)throw Error('Material ownership overwritten after joint stroke placement: '+JSON.stringify(audit.invalidColors));
        built.materialReport={...built.materialReport,audit};
      }
      return {...built,image:result.image,eyePolicyReport:eyes.report,outlineReport:result.report};
    }
    // Separate feature ownership from pass order. A later contour operation
    // must not overwrite an already reviewed eye or required form, even if
    // that feature needed no color change in this particular run.
    const {allocateOnePixelOutline,protectOutlineFeatures}=require('./raster-outline-contour.cjs');
    const policy=protectOutlineFeatures(outlinePolicy,eyePolicy,formPolicy);
    const outline=allocateOnePixelOutline(PNG,source,eyes.image,palette,affineEyeGrid(source,eyes.image,built.fit),policy,material?.interior,material);
    if(outlinePolicy.observedStrokes){
      if(outlinePolicy.mode!=='source-silhouette-width')throw Error('Observed stroke layout requires the reviewed source-silhouette-width route');
      const planned=outlinePolicy.observedStrokes;
      const excluded=[...(planned.excluded??[]),...(outlinePolicy.protectedSourceRegions??[]),...(formPolicy?.features??[]).map(f=>f.sourceRegion)];
      const ownership=require('./eye-plane-policy.cjs').eyeOwnership(source,eyePolicy,outline.image.width,outline.image.height);
      const layout=require('./raster-source-ink-paths.cjs').allocateObservedStrokeLayout(PNG,source,outline.image,palette,{...planned,excluded},outline.report.pathCells,material,ownership);
      outline.image=layout.image;outline.report.observedStrokeLayout=layout.report;
      // The external contour remains a separate, immutable owner. Internal
      // material/contact strokes cannot move it or overwrite required features.
      const expected=outline.report.expectedColors??[];
      if(expected.some(([p,c])=>outline.image.data.readUInt32BE(p*4)!==c))throw Error('Observed internal lines changed the external contour');
    }
    if(material){const audit=require('./material-assignment.cjs').audit(outline.image,material);if(audit.violations)throw Error('Material ownership overwritten after placement: '+audit.violations);built.materialReport={...built.materialReport,audit};}
    return {...built,image:outline.image,eyePolicyReport:eyes.report,outlineReport:outline.report};
  }
  if(material){const audit=require('./material-assignment.cjs').audit(eyes.image,material);if(audit.violations)throw Error('Material ownership overwritten after placement: '+audit.violations);built.materialReport={...built.materialReport,audit};}
  return {...built,image:eyes.image,eyePolicyReport:eyes.report};
}
function resolveSourcePlanes(PNG,source,palette,width,height,eyePolicy,material,options={coherentPlanes:true,preserveSmallRegions:true}){
  const segmented=require('./source-region-palette.cjs').segmentSourceRegions(PNG,source,palette,width,height,options,material);
  // Eye source samples belong to the observed role planner, not a global
  // palette classifier. Context outside those shapes keeps the shared labels.
  if(eyePolicy?.visibility==='visible')for(const eye of eyePolicy.eyes){
    const[x,y,w,h]=eye.rect;if(x+w>source.width||y+h>source.height)throw Error('Eye region outside source');
    for(let row=Math.ceil(y);row<Math.ceil(y+h);row++)for(let col=Math.ceil(x);col<Math.ceil(x+w);col++)
      if(require('./eye-plane-policy.cjs').eyeOwnsSource(eye,col+.5,row+.5)){
        const begin=(row*source.width+col)*4;source.data.copy(segmented.image.data,begin,begin,begin+4);
      }
  }
  if(material)material.sourceLabels=segmented.image;
  return segmented;
}
function buildCandidate(PNG, source, palette, width, height, background, sampling = 'nearest', protection = null, regions = null, structure = null, eyePolicy = null, material = null, shareStrokeLabels = false) {
  if (structure && protection) throw new Error('Structure and legacy protection must be separate candidates.');
  if (protection && regions?.length) throw new Error('Compare legacy protection and regions as separate candidates.');
  if (!['nearest', 'area-vote', 'source-region-area', 'source-shape-grid', 'source-shared-boundaries'].includes(sampling)) throw new Error('Sampling mode is unsupported.');
  if (![width, height].every(n => Number.isSafeInteger(n) && n > 0 && n <= 4096)) {
    throw new Error('Native dimensions must be positive integers <= 4096.');
  }
  const sourceStats = inspect(source, palette);
  if (sourceStats.partialAlphaPixels || sourceStats.transparentPixels) {
    throw new Error('This helper requires opaque input. Do not flatten alpha silently.');
  }
  const bg = palette.find(color => color.hex === background.toUpperCase());
  if (!bg) throw new Error('Background must be an exact palette entry.');
  if (['source-region-area', 'source-shape-grid', 'source-shared-boundaries'].includes(sampling)) {
    if (protection || regions || structure) throw new Error('Compare source-region conversion without stacked corrections.');
    const segmented=resolveSourcePlanes(PNG,source,palette,width,height,sampling==='source-region-area'?eyePolicy:null,material,
      {coherentPlanes:sampling==='source-region-area',preserveSmallRegions:shareStrokeLabels});
    if (sampling === 'source-shared-boundaries') {
      const result = require('./raster-shared-boundaries.cjs')
        .rasterSharedBoundaries(PNG, segmented.image, width, height, background);
      const [fitWidth, fitHeight, offsetX, offsetY] = result.report.fit;
      return { image: result.image, fit: { fitWidth, fitHeight, offsetX, offsetY }, sampling,
        sourceRegionReport: segmented.report, shapeRasterReport: result.report };
    }
    if (sampling === 'source-shape-grid') {
      const result = require('./raster-source-shapes.cjs')
        .rasterSourceShapes(PNG, segmented.image, palette, width, height, background);
      const { fitWidth, fitHeight, offsetX, offsetY } = result.report;
      return { image: result.image, fit: { fitWidth, fitHeight, offsetX, offsetY }, sampling,
        sourceRegionReport: segmented.report, shapeRasterReport: result.report };
    }
    if(material)material.sourceLabels=segmented.image;
    const result = buildCandidate(PNG, segmented.image, palette, width, height, background, 'area-vote', null, null, null, null, material);
    if(material)result.materialReport={method:segmented.report.method,interiorCells:material.interior.size,planeReport:segmented.report.planeReport};
    return { ...result, sampling, sourceRegionReport: segmented.report, ...(shareStrokeLabels?{sourceLabels:segmented.image}:{}) };
  }
  const colorIndex = hex => palette.findIndex(c => c.hex === String(hex).toUpperCase());
  const fraction = n => Number.isFinite(n) && n > 0 && n <= 1;
  const features = protection?.features || [];
  const outline = protection?.externalOutline;
  if (protection && sampling !== 'area-vote') throw new Error('Protection requires area-vote sampling.');
  if (outline && (colorIndex(outline.color) < 0 || !fraction(outline.minCoverage) ||
      !fraction(outline.backgroundMinCoverage))) throw new Error('Invalid outline protection.');
  for (const f of features) {
    if (!f.name || !Array.isArray(f.rect) || f.rect.length !== 4 || !f.rect.every(Number.isSafeInteger) ||
        f.rect[0] < 0 || f.rect[1] < 0 || f.rect[2] < 1 || f.rect[3] < 1 ||
        f.rect[0]+f.rect[2] > width || f.rect[1]+f.rect[3] > height ||
        !Array.isArray(f.colors) || !f.colors.length || f.colors.some(c => colorIndex(c) < 0) ||
        new Set(f.colors.map(colorIndex)).size !== f.colors.length || !fraction(f.minCoverage)) {
      throw new Error('Invalid feature protection; use named native rectangles and palette colors.');
    }
  }
  const out = new PNG({ width, height });
  for (let i = 0; i < out.data.length; i += 4) out.data.set([...bg.rgb, 255], i);
  const baseChoices = protection ? new Uint16Array(width * height).fill(colorIndex(background)) : null;
  const factor = Math.min(width / source.width, height / source.height);
  const fitWidth = Math.max(1, Math.round(source.width * factor));
  const fitHeight = Math.max(1, Math.round(source.height * factor));
  const offsetX = Math.floor((width - fitWidth) / 2);
  const offsetY = Math.floor((height - fitHeight) / 2);
  const labs = palette.map(color => toLab(color.rgb));
  const cache = new Map();
  function paletteIndex(sx, sy) {
    const i = (sy * source.width + sx) * 4;
    const key = (source.data[i] << 16) | (source.data[i+1] << 8) | source.data[i+2];
    if (cache.has(key)) return cache.get(key);
    const lab = toLab([...source.data.subarray(i, i + 3)]);
    let chosen = 0, bestDistance = Infinity;
    labs.forEach((candidate, index) => {
      const distance = candidate.reduce((sum, v, channel) => sum + (v - lab[channel]) ** 2, 0);
      if (distance < bestDistance) { bestDistance = distance; chosen = index; }
    });
    cache.set(key, chosen);
    return chosen;
  }
  // External background is a 4-connected flood from image-border background.
  // Interior white highlights are not automatically treated as external space.
  let exterior = null;
  if (outline) {
    exterior = new Uint8Array(source.width * source.height);
    const queue = new Int32Array(exterior.length), bgIndex = colorIndex(background);
    let tail = 0;
    function seed(x,y) {
      const k = y*source.width+x;
      if (!exterior[k] && paletteIndex(x,y) === bgIndex) { exterior[k]=1; queue[tail++]=k; }
    }
    for (let x=0;x<source.width;x++) { seed(x,0); seed(x,source.height-1); }
    for (let y=0;y<source.height;y++) { seed(0,y); seed(source.width-1,y); }
    for (let head=0;head<tail;head++) {
      const k=queue[head], x=k%source.width, y=Math.floor(k/source.width);
      if(x>0)seed(x-1,y); if(x+1<source.width)seed(x+1,y);
      if(y>0)seed(x,y-1); if(y+1<source.height)seed(x,y+1);
    }
  }
  const protectionReport = protection ? {
    changes: [], suspectsBefore: [], suspectsAfter: [],
    meaning: 'Source-supported palette coverage candidates in declared regions; not semantic missing-feature detection.',
  } : null;
  let ambiguousCells = 0, centerChangedCells = 0;
  const ambiguityExamples = [];
  for (let y = 0; y < fitHeight; y++) {
    for (let x = 0; x < fitWidth; x++) {
      const sx = Math.min(source.width - 1, Math.floor((x + 0.5) * source.width / fitWidth));
      const sy = Math.min(source.height - 1, Math.floor((y + 0.5) * source.height / fitHeight));
      const center = paletteIndex(sx, sy);
      let chosen = center;
      if (sampling === 'area-vote') {
        // Vote for existing palette entries by exact source-pixel overlap area.
        // Never average RGB, generate shades, dither or smooth neighboring cells.
        const left = x * source.width / fitWidth, right = (x+1) * source.width / fitWidth;
        const top = y * source.height / fitHeight, bottom = (y+1) * source.height / fitHeight;
        const votes = new Float64Array(palette.length);
        let exteriorArea = 0;
        for (let yy = Math.floor(top); yy < Math.min(source.height, Math.ceil(bottom)); yy++) {
          const wy = Math.min(bottom, yy+1) - Math.max(top, yy);
          for (let xx = Math.floor(left); xx < Math.min(source.width, Math.ceil(right)); xx++) {
            const wx = Math.min(right, xx+1) - Math.max(left, xx);
            const area = wx * wy;
            votes[paletteIndex(xx, yy)] += area;
            if (exterior?.[yy*source.width+xx]) exteriorArea += area;
          }
        }
        // Ties prefer the center's palette entry, otherwise first palette order.
        const total = (right-left) * (bottom-top), epsilon = total * 1e-10;
        // A reviewed fill family already owns a strict source-area majority.
        // Its tones must not split that majority and lose to a minority ink
        // color. Select the tone within that family during cell placement.
        const fillColors = material?.fillCells?.get((y+offsetY)*width+x+offsetX);
        const eligible = fillColors ? palette.map((p,k)=>fillColors.includes(p.hex)?k:-1).filter(k=>k>=0) : null;
        if (eligible && !eligible.includes(chosen)) chosen = eligible[0];
        for (const k of eligible??votes.keys()) if (votes[k] > votes[chosen] + epsilon) chosen = k;
        if (eligible && !(votes[chosen] > 0)) throw new Error('Declared fill majority has no supported palette tone');
        const dominance = votes[chosen] / total;
        if (dominance < 0.6) {
          ambiguousCells++;
          if (ambiguityExamples.length < 20) ambiguityExamples.push({ x: x+offsetX, y: y+offsetY, dominance });
        }
        if (chosen !== center) centerChangedCells++;
        if (protection) {
          const baseChosen = chosen, nx=x+offsetX, ny=y+offsetY, reasons=[];
          baseChoices[ny*width+nx] = baseChosen;
          if (outline) {
            const k=colorIndex(outline.color), coverage=votes[k]/total;
            if (coverage >= outline.minCoverage && exteriorArea/total >= outline.backgroundMinCoverage && chosen !== k) {
              protectionReport.suspectsBefore.push({x:nx,y:ny,feature:'external-outline',coverage});
              chosen=k; reasons.push('external-outline');
            }
          }
          for (const f of features) {
            const [rx,ry,rw,rh]=f.rect;
            if(nx<rx || nx>=rx+rw || ny<ry || ny>=ry+rh)continue;
            const indices=f.colors.map(colorIndex), coverage=indices.reduce((s,k)=>s+votes[k],0)/total;
            if(coverage >= f.minCoverage/2 && !indices.includes(baseChosen)) {
              protectionReport.suspectsBefore.push({x:nx,y:ny,feature:f.name,coverage});
            }
            if(coverage >= f.minCoverage && !indices.includes(chosen)) {
              chosen=indices.reduce((best,k)=>votes[k]>votes[best]+epsilon?k:best,indices[0]);
              reasons.push(f.name);
            }
          }
          // Inspect the final choice after all rules, including rule conflicts.
          if(outline) {
            const k=colorIndex(outline.color), coverage=votes[k]/total;
            if(coverage>=outline.minCoverage && exteriorArea/total>=outline.backgroundMinCoverage && chosen!==k)
              protectionReport.suspectsAfter.push({x:nx,y:ny,feature:'external-outline',coverage});
          }
          for(const f of features) {
            const [rx,ry,rw,rh]=f.rect;
            if(nx<rx || nx>=rx+rw || ny<ry || ny>=ry+rh)continue;
            const indices=f.colors.map(colorIndex), coverage=indices.reduce((s,k)=>s+votes[k],0)/total;
            if(coverage>=f.minCoverage/2 && !indices.includes(chosen))
              protectionReport.suspectsAfter.push({x:nx,y:ny,feature:f.name,coverage});
          }
          if(chosen!==baseChosen)protectionReport.changes.push({x:nx,y:ny,from:palette[baseChosen].hex,to:palette[chosen].hex,reasons});
        }
      }
      out.data.set([...palette[chosen].rgb, 255], ((y + offsetY) * width + x + offsetX) * 4);
    }
  }
  // Limit automatic external-outline additions to source-supported bridges.
  // An opposite-neighbor test rejects parallel thickening; it does not prove
  // artistic correctness and does not automatically join across empty space.
  if (outline && outline.bridgeOnly !== false) {
    const k=colorIndex(outline.color), retained=[];
    protectionReport.outlineReviewOnly=[];
    for(const change of protectionReport.changes) {
      if(change.reasons.length!==1 || change.reasons[0]!=='external-outline') { retained.push(change); continue; }
      const neighbors=[];
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++) {
        const nx=change.x+dx,ny=change.y+dy;
        if((dx||dy)&&nx>=0&&nx<width&&ny>=0&&ny<height&&baseChoices[ny*width+nx]===k)neighbors.push([dx,dy]);
      }
      const opposite=neighbors.some(([ax,ay],i)=>neighbors.slice(i+1).some(([bx,by])=>ax*bx+ay*by<0));
      // Opposing directions alone can form a protruding triangle along an
      // already connected stair-step. Require separate local 8-connected runs.
      const pending=new Set(neighbors.map((_,i)=>i));
      let runs=0;
      while(pending.size) {
        runs++;
        const queue=[pending.values().next().value];pending.delete(queue[0]);
        for(let q=0;q<queue.length;q++)for(const i of [...pending]) {
          const [ax,ay]=neighbors[queue[q]],[bx,by]=neighbors[i];
          if(Math.max(Math.abs(ax-bx),Math.abs(ay-by))<=1){pending.delete(i);queue.push(i);}
        }
      }
      const bridge=opposite && runs>=2;
      if(bridge)retained.push(change);
      else {
        const index=(change.y*width+change.x)*4;
        out.data.set([...palette[baseChoices[change.y*width+change.x]].rgb,255],index);
        protectionReport.outlineReviewOnly.push({...change,reason:!opposite
          ? 'No opposing baseline outline neighbors; avoid automatic thickening.'
          : 'Baseline outline neighbors already connect locally; avoid a protruding corner.'});
        protectionReport.suspectsAfter.push({x:change.x,y:change.y,feature:'external-outline',reason:'review-only; not an accepted bridge'});
      }
    }
    protectionReport.changes=retained;
  }
  const fit={fitWidth,fitHeight,offsetX,offsetY};
  const regional=regions===null?{image:out,report:null}:refineRegions(PNG,source,out,palette,fit,regions);
  const structured=structure===null?{image:regional.image,report:null}:refineStructure(PNG,source,regional.image,palette,fit,structure,{toLab,refineRegions});
  return { image: structured.image, fit, regionReport:regional.report, structureReport:structured.report,
    sampling, protectionReport, diagnostics: sampling === 'area-vote' ? {
      evaluatedCells: fitWidth * fitHeight, ambiguousCells, centerChangedCells,
      ambiguityThreshold: 0.6, ambiguityExamples,
      interpretation: 'Low palette dominance marks mixed cells, not art defects. Thin features may disappear even in high-dominance cells.',
    } : null };
}

function enlarge(PNG, native, scale) {
  if (!Number.isSafeInteger(scale) || scale < 1 || scale > 8) throw new Error('Scale must be an integer 1–8.');
  const out = new PNG({ width: native.width * scale, height: native.height * scale });
  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) {
      const sourceIndex = (Math.floor(y / scale) * native.width + Math.floor(x / scale)) * 4;
      out.data.set(native.data.subarray(sourceIndex, sourceIndex + 4), (y * out.width + x) * 4);
    }
  }
  return out;
}

function verifyDisplay(native,image,placement,background){
  const {cell,origin:[ox,oy]}=placement,bg=parseInt(background.slice(1)+'ff',16);
  for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++){
    const gx=Math.floor((x-ox)/cell),gy=Math.floor((y-oy)/cell);
    const expected=gx>=0&&gy>=0&&gx<native.width&&gy<native.height
      ?native.data.readUInt32BE((gy*native.width+gx)*4):bg;
    if(image.data.readUInt32BE((y*image.width+x)*4)!==expected)return false;
  }
  return true;
}

function exactBlocks(native, review, scale) {
  if (review.width !== native.width * scale || review.height !== native.height * scale) return false;
  for (let y = 0; y < review.height; y++) {
    for (let x = 0; x < review.width; x++) {
      const a = (Math.floor(y / scale) * native.width + Math.floor(x / scale)) * 4;
      const b = (y * review.width + x) * 4;
      for (let c = 0; c < 4; c++) if (native.data[a+c] !== review.data[b+c]) return false;
    }
  }
  return true;
}

function run(configPath) {
  const PNG = loadPng();
  const base = path.dirname(path.resolve(configPath));
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const resolve = value => path.resolve(base, value);
  const paletteBytes = fs.readFileSync(resolve(config.palette));
  const palette = parsePalette(JSON.parse(paletteBytes));
  require('./eye-plane-policy.cjs').assertEyePolicy(config.eyePolicy,palette);
  const sourcePath = resolve(config.source);
  const sourceBytes = fs.readFileSync(sourcePath);
  require('./stage-gates.cjs').assertProductionStages(config.stageChecks,2,{
    outputSha256:require('node:crypto').createHash('sha256').update(sourceBytes).digest('hex'),
    paletteSha256:require('node:crypto').createHash('sha256').update(paletteBytes).digest('hex'),grid:{canvas:[config.width*config.scale,config.height*config.scale],cell:config.scale,native:[config.width,config.height],origin:[0,0]}});
  const source = PNG.sync.read(sourceBytes);
  require('./stage-gates.cjs').assertExecution(config.stageChecks,'fixed-asset-grid',config);
  const outputBase = resolve(config.output);
  const paths = {
    native: outputBase + '.native.png',
    review: outputBase + '@' + config.scale + 'x.png',
    report: outputBase + '.validation.json',
  };
  for (const output of Object.values(paths)) {
    if (fs.existsSync(output) || output === sourcePath || output === resolve(config.palette)) {
      throw new Error('Refusing to overwrite: ' + output);
    }
  }
  const { image: native, fit, sampling, diagnostics, protectionReport, regionReport, structureReport, sourceRegionReport, shapeRasterReport, eyePolicyReport, formReport, outlineReport, materialContext } = buildNative(PNG, source, palette,
    config.width, config.height, config.background, config.sampling, config.protection, config.regions, config.structure, config.eyePolicy, config.formPolicy??null, config.outlinePolicy??null, config.materialPlan??null);
  const review = enlarge(PNG, native, config.scale);
  const nativeBytes = PNG.sync.write(native);
  const reviewBytes = PNG.sync.write(review);
  fs.mkdirSync(path.dirname(outputBase), { recursive: true });
  fs.writeFileSync(paths.native, nativeBytes, { flag: 'wx' });
  fs.writeFileSync(paths.review, reviewBytes, { flag: 'wx' });
  const readNative = PNG.sync.read(fs.readFileSync(paths.native));
  const readReview = PNG.sync.read(fs.readFileSync(paths.review));
  const stats = inspect(readNative, palette);
  const reviewStats = inspect(readReview, palette);
  const blocks = exactBlocks(readNative, readReview, config.scale);
  const technicalPass = stats.width === config.width && stats.height === config.height &&
    !stats.offPalettePixels && !stats.partialAlphaPixels && !stats.transparentPixels &&
    !reviewStats.offPalettePixels && !reviewStats.partialAlphaPixels &&
    !reviewStats.transparentPixels && blocks;
  const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
  const report = {
    status: 'AWAITING_REVIEW', deliveryEligible: false,
    technicalPass, visualAcceptance: 'NOT ASSESSED BY SCRIPT', config, fit, eyePolicyReport, formReport, outlineReport,
    savedEyeAudit:require('./eye-plane-policy.cjs').auditEyePolicy(PNG,source,readNative,palette,config.eyePolicy,require('./eye-plane-policy.cjs').affineEyeGrid(source,readNative,fit),materialContext),
    algorithm: sampling === 'source-shared-boundaries'
      ? 'source segmentation; shared whole-image boundary graph; common edge/junction fitting before integer rasterization; no per-cell color vote or output repaint; full visual review required'
      : sampling === 'source-shape-grid'
      ? 'source segmentation; background/foreground coverage; connected luminance-region coverage before exact palette-color selection; single global grid; no output corrections; visual review required'
      : sampling === 'source-region-area'
      ? 'experimental source-region color segmentation followed by exact area vote; no output repaint; shape fidelity unverified'
      : sampling === 'area-vote'
      ? 'source pixels mapped to fixed Oklab-nearest palette entries; exact overlap-area categorical vote per target cell; center tie-break; dithering OFF'
      : 'nearest pixel-center sampling; fixed-palette Oklab nearest entry; dithering OFF',
    sampling, diagnostics, sourceRegionReport: sourceRegionReport ?? null, shapeRasterReport: shapeRasterReport ?? null, protection: config.protection || null, protectionReport,
    regions: config.regions || null, regionReport,
    regionalAlgorithm: regionReport ? 'source-cell RGB mean used only for Oklab candidate costs; mask-local edge-weighted label consistency; fixed palette output' : null,
    structure: config.structure || null, structureReport,
    source: inspect(source, palette), native: stats, review: reviewStats,
    exactIntegerBlocksAndRoundTrip: blocks,
    hashes: { source: sha(sourceBytes), paletteFile: sha(paletteBytes), native: sha(nativeBytes), review: sha(reviewBytes) },
    paths,
  };
  fs.writeFileSync(paths.report, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  if (!technicalPass) throw new Error('Generated files failed technical verification; inspect report.');
  console.log(JSON.stringify({ status: 'AWAITING_REVIEW', deliveryEligible: false, technicalPass, sourceColors: report.source.colorsUsed,
    native: stats, exactIntegerBlocksAndRoundTrip: blocks,
    shapeReviewRequired: structureReport?.reviewRequired ?? null,
    structureSuspects: structureReport?.suspects.length ?? null, paths }, null, 2));
}

// An authored draft need not already contain a recoverable periodic grid.
// This explicit path uses the asset grid locked before conversion, without
// inferring a new resolution, cropping, or substituting for visual review.
function assertFixedGridPlacement(contract, source) {
  if(contract.outlineDecision?.mode==='continuous'||contract.outlinePolicy){
    if(!contract.outlinePolicy?.sourceStrokeColors?.length)throw Error('Required saved-stroke thickness audit is not configured');
    if(contract.outlinePolicy.layout!=='joint-source-band')throw Error('Formal outlined delivery requires the joint source-band renderer and final saved-PNG stroke audit; legacy partial audits are diagnostic only');
    if((contract.eyePolicy?.eyes??[]).some(eye=>!eye.sourcePolygon))throw Error('Joint source-band layout requires actual source eye polygons, not rectangular line exclusions');
    if(contract.outlinePolicy.curveFlow?.version!==1||contract.outlinePolicy.curveFlow?.method!=='anchored-source-curve')throw Error('Formal outlined delivery requires executed anchored curve-flow placement; no silent curve bypass');
  }
  const p=contract.gridPlacement;
  if(!p)return false;
  const ok=p.mode==='fixed-asset-grid' && ['illustration','pixel-designed'].includes(contract.sourceAssessment?.representation) && !contract.redesign &&
    p.sourceSha256===contract.source?.sha256 && p.cell===contract.scale &&
    JSON.stringify(p.origin)==='[0,0]' && JSON.stringify(p.canvas)===JSON.stringify([source.width,source.height]) &&
    source.width===contract.width*contract.scale && source.height===contract.height*contract.scale &&
    contract.sourceToNative?.scaleX===1/contract.scale && contract.sourceToNative?.scaleY===1/contract.scale &&
    contract.sourceToNative?.offsetX===0 && contract.sourceToNative?.offsetY===0;
  if(!ok)throw Error('Fixed asset grid must bind the current draft, locked canvas, cell size and unchanged coordinate mapping');
  if(contract.outlineDecision?.mode==='continuous'&&!contract.outlinePolicy)
    throw Error('Continuous outline was declared but no executable outlinePolicy is connected');
  if(contract.outlineDecision?.mode==='continuous'&&(!Array.isArray(contract.outlinePolicy.sourceStrokeColors)||!contract.outlinePolicy.sourceStrokeColors.length))
    throw Error('Required saved-stroke thickness audit is not configured; missing sourceStrokeColors cannot pass as zero defects');
  return true;
}
module.exports = { parsePalette, inspect, buildNative, resolveSourcePlanes, refineRegions, enlarge, exactBlocks, verifyDisplay, preserveSourceColors, toLab, assertFixedGridPlacement };
if (require.main === module) {
  try {
    if (process.argv.length !== 3) throw new Error('Usage: node build-palette-native.cjs job.json');
    run(process.argv[2]);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
