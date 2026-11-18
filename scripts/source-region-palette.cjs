'use strict';

// Experimental source-space color segmentation. This does not certify shape
// fidelity and is deliberately not the default conversion mode.
function segmentSourceRegions(PNG, source, palette, width, height, options = {}, material = null) {
  if(Object.keys(options).some(k=>!['preserveSmallRegions','coherentPlanes'].includes(k))||
    Object.values(options).some(value=>typeof value!=='boolean'))
    throw Error('Invalid source-region options');
  const preserveSmallRegions=options.preserveSmallRegions===true;
  const { toLab } = require('./build-palette-native.cjs');
  const w = source.width, h = source.height, count = w * h;
  const distance = (a, b) => a.reduce((sum, v, c) => sum + (v - b[c]) ** 2, 0);
  const chroma = rgb => {
    const sum = rgb.reduce((a, b) => a + b, 0) + 12;
    return rgb.map(v => (v + 4) / sum);
  };
  const entries = palette.map(p => ({ ...p, lab: toLab(p.rgb), chroma: chroma(p.rgb) }));
  const initial = new Uint16Array(count), cache = new Map();
  const materialChoices=material?.plan.regions.map(r=>new Set(r.colors));
  const materialDomain=p=>material?(material.sourceExceptions[p]?-2:material.owners[p]<0?-1:material.materialGroups[material.owners[p]]):0;
  for (let p = 0; p < count; p++) {
    const raw = source.data.readUInt32BE(p * 4);
    const owner=material&&!material.sourceExceptions[p]?material.owners[p]:-1;
    const family=owner>=0?material.materialGroups[owner]:-1;
    const key=family+':'+raw, allowed=owner>=0?materialChoices[owner]:null;
    let chosen = cache.get(key);
    if (chosen === undefined) {
      const rgb = [...source.data.subarray(p * 4, p * 4 + 3)];
      const lab = toLab(rgb), normalized = chroma(rgb);
      let best = Infinity;
      entries.forEach((entry, index) => {
        if(allowed&&!allowed.has(entry.hex))return;
        const score = distance(lab, entry.lab) + .05 * distance(normalized, entry.chroma);
        if (score < best) { best = score; chosen = index; }
      });
      cache.set(key, chosen);
    }
    initial[p] = chosen;
  }

  const cell = Math.max(w / width, h / height);
  const radius = Math.max(1, Math.round(cell * .2));
  const stable = new Uint8Array(count);
  const samples = entries.map(() => ({ count: 0, sum: [0, 0, 0] }));
  for (let y = radius; y < h - radius; y++) {
    for (let x = radius; x < w - radius; x++) {
      const p = y * w + x, label = initial[p];
      let uniform = true;
      for (let dy = -radius; dy <= radius && uniform; dy++)
        for (let dx = -radius; dx <= radius; dx++)
          if (initial[(y + dy) * w + x + dx] !== label) { uniform = false; break; }
      if (!uniform) continue;
      stable[p] = 1;
      const sample = samples[label];
      sample.count++;
      for (let c = 0; c < 3; c++) sample.sum[c] += source.data[p * 4 + c];
    }
  }
  const centers = samples.map((sample, index) => ({
    index, count: sample.count,
    rgb: sample.sum.map(value => value / (sample.count || 1)),
  })).filter(sample => preserveSmallRegions ? sample.count > 0 : sample.count >= cell * cell);
  if (!centers.length) throw new Error('No supported source-region seeds; do not silently fall back.');
  centers.forEach(center => { center.lab = toLab(center.rgb); });
  const centerByPalette = new Map(centers.map((center, index) => [center.index, index]));
  const labels = new Int32Array(count);
  labels.fill(-1);
  let seedCount = 0;
  for (let p = 0; p < count; p++) {
    if (stable[p] && centerByPalette.has(initial[p])) {
      labels[p] = centerByPalette.get(initial[p]);
      seedCount++;
    }
  }
  // A feature need not occupy a full target cell to supply a real source color.
  // Thin coherent source components may have no radius-sized interior at all.
  // Give those components their own observed prototype; never invent target dots.
  // Isolated pixels and one-pixel antialias fringes are not seed evidence.
  const visited = new Uint8Array(count), queue = new Int32Array(count);
  let smallComponentSeeds = 0, smallComponents = 0;
  for (let start = 0; preserveSmallRegions && start < count; start++) {
    if (visited[start]) continue;
    let head = 0, length = 1, hasSeed = false;
    queue[0] = start; visited[start] = 1;
    const index = initial[start], core = [], sum = [0, 0, 0];
    while (head < length) {
      const p = queue[head++], x = p % w, y = Math.floor(p / w);
      hasSeed ||= labels[p] >= 0;
      let support = 0;
      for (const q of [x ? p - 1 : -1, x < w - 1 ? p + 1 : -1,
        y ? p - w : -1, y < h - 1 ? p + w : -1]) {
        if (q < 0 || initial[q] !== index || materialDomain(q)!==materialDomain(start)) continue;
        support++;
        if (!visited[q]) { visited[q] = 1; queue[length++] = q; }
      }
      if (support >= 3) {
        core.push(p);
        for (let c = 0; c < 3; c++) sum[c] += source.data[p * 4 + c];
      }
    }
    if(hasSeed)continue;
    const explicitlyObserved=material&&(material.owners[start]>=0||material.sourceExceptions[start]);
    if((core.length<2||length<4)&&!explicitlyObserved)continue;
    // A small, explicitly assigned source region cannot borrow a different
    // material's prototype merely because it has no radius-sized interior.
    const seeds=core.length?core:Array.from(queue.subarray(0,length));
    const observedSum=[0,0,0];for(const p of seeds)for(let c=0;c<3;c++)observedSum[c]+=source.data[p*4+c];
    const rgb=observedSum.map(v=>v/seeds.length),label=centers.length;
    centers.push({index,count:seeds.length,rgb,lab:toLab(rgb),local:true});
    for(const p of seeds)labels[p]=label;
    seedCount+=seeds.length;smallComponentSeeds+=seeds.length;smallComponents++;
  }

  // Grow only through source pixels, using their distance from observed source
  // colors. No target-cell masks or character/feature coordinates are involved.
  const heap = [], best = new Float64Array(count);
  best.fill(Infinity);
  function push(item) {
    heap.push(item);
    let i = heap.length - 1;
    while (i) {
      const parent = (i - 1) >> 1;
      if (heap[parent][0] <= item[0]) break;
      heap[i] = heap[parent]; i = parent;
    }
    heap[i] = item;
  }
  function pop() {
    const first = heap[0], last = heap.pop();
    if (heap.length) {
      let i = 0;
      while (i * 2 + 1 < heap.length) {
        let child = i * 2 + 1;
        if (child + 1 < heap.length && heap[child + 1][0] < heap[child][0]) child++;
        if (heap[child][0] >= last[0]) break;
        heap[i] = heap[child]; i = child;
      }
      heap[i] = last;
    }
    return first;
  }
  const neighbors = p => {
    const x = p % w, y = Math.floor(p / w);
    return [x ? p - 1 : -1, x < w - 1 ? p + 1 : -1,
      y ? p - w : -1, y < h - 1 ? p + w : -1];
  };
  const labs = new Map();
  function offer(p, label, parentCost) {
    if (p < 0 || labels[p] >= 0) return;
    if(material&&!material.sourceExceptions[p]&&material.owners[p]>=0&&
      !materialChoices[material.owners[p]].has(palette[centers[label].index].hex))return;
    const raw = source.data.readUInt32BE(p * 4);
    let lab = labs.get(raw);
    if (!lab) {
      lab = toLab([...source.data.subarray(p * 4, p * 4 + 3)]);
      labs.set(raw, lab);
    }
    const cost = Math.max(parentCost, distance(lab, centers[label].lab)) + .00001;
    if (cost < best[p]) { best[p] = cost; push([cost, p, label]); }
  }
  for (let p = 0; p < count; p++)
    if (labels[p] >= 0)
      for (const next of neighbors(p)) offer(next, labels[p], 0);
  while (heap.length) {
    const [cost, p, label] = pop();
    if (labels[p] >= 0 || cost > best[p]) continue;
    labels[p] = label;
    for (const next of neighbors(p)) offer(next, label, cost);
  }
  const image = new PNG({ width: w, height: h });
  for (let p = 0; p < count; p++) {
    if (labels[p] < 0) throw new Error('Unassigned source pixel '+JSON.stringify({x:p%w,y:Math.floor(p/w),owner:material?.owners[p],color:palette[initial[p]].hex}));
    image.data.set([...palette[centers[labels[p]].index].rgb, 255], p * 4);
  }
  const planeReport = options.coherentPlanes
    ? consolidateSourcePlanes(source, image, palette, material) : null;
  return {
    image,
    report: {
      status: 'EXPERIMENTAL_NOT_A_FIDELITY_PASS', method:material?'material-constrained-connected-planes':'source-connected-planes', radius, seedCount, preserveSmallRegions, smallComponents, smallComponentSeeds, planeReport,
      sourceCenters: centers.map(c => ({ palette: palette[c.index].hex, rgb: c.rgb, samples: c.count, local: !!c.local })),
      limitation: 'Subpixel or unsupported source regions may still be lost. Source color retention is not target shape fidelity.',
    },
  };
}

// Palette labels are proposals, not proof of distinct source shading. Reject a
// boundary only when connected source regions have weak observed contrast that
// quantization amplifies at least threefold. Never smooth destination pixels.
function consolidateSourcePlanes(source, segmented, palette, material=null) {
  const { toLab } = require('./build-palette-native.cjs');
  const w = source.width, h = source.height, n = w * h;
  if (segmented.width !== w || segmented.height !== h) throw Error('Source-plane size mismatch');
  const distance = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
  const maxContrast = .02, amplification = 3;
  const ids = new Int32Array(n).fill(-1), queue = new Int32Array(n);
  const values = Uint32Array.from({length:n}, (_, p) => segmented.data.readUInt32BE(p * 4));
  const domain=p=>material?(material.sourceExceptions[p]?-2:material.owners[p]<0?-1:material.materialGroups[material.owners[p]]):0;
  const regions = [];
  const neighbors = p => {
    const x = p % w, y = Math.floor(p / w);
    return [x ? p-1 : -1, x<w-1 ? p+1 : -1, y ? p-w : -1, y<h-1 ? p+w : -1];
  };
  for (let start = 0; start < n; start++) {
    if (ids[start] >= 0) continue;
    const id = regions.length, sum = [0,0,0];
    let head = 0, tail = 1;
    queue[0] = start; ids[start] = id;
    while (head < tail) {
      const p = queue[head++];
      for (let c=0; c<3; c++) sum[c] += source.data[p*4+c];
      for (const q of neighbors(p)) {
        if (q<0 || ids[q]>=0 || values[q]!==values[start] || domain(q)!==domain(start)) continue;
        ids[q]=id; queue[tail++]=q;
      }
    }
    regions.push({color:values[start], count:tail, lab:toLab(sum.map(v=>v/tail))});
  }
  const paletteLabs = new Map(palette.map(c => [Number.parseInt(c.hex.slice(1)+'ff',16), toLab(c.rgb)]));
  const adjacent = new Set();
  for (let p=0; p<n; p++) {
    for (const q of [p%w<w-1 ? p+1 : -1, p+w<n ? p+w : -1]) {
      if(q>=0 && ids[p]!==ids[q] && domain(p)===domain(q) && domain(p)!==-2) adjacent.add([Math.min(ids[p],ids[q]),Math.max(ids[p],ids[q])].join(':'));
    }
  }
  const candidates=[];
  for (const key of adjacent) {
    const [a,b]=key.split(':').map(Number), left=regions[a], right=regions[b];
    const contrast=distance(left.lab,right.lab);
    const paletteContrast=distance(paletteLabs.get(left.color),paletteLabs.get(right.color));
    if(contrast<Math.min(maxContrast,paletteContrast/amplification)) candidates.push({a,b,contrast});
  }
  const parent=regions.map((_,i)=>i), members=regions.map((_,i)=>[i]);
  const votes=regions.map(r=>new Map([[r.color,r.count]]));
  function root(i) { return parent[i]===i ? i : (parent[i]=root(parent[i])); }
  let mergedRegions=0;
  for (const edge of candidates.sort((a,b)=>a.contrast-b.contrast)) {
    const a=root(edge.a), b=root(edge.b);
    if(a===b) continue;
    // Complete-link bound prevents chaining a gradient across a genuine shade.
    if(members[a].some(i=>members[b].some(j=>distance(regions[i].lab,regions[j].lab)>=maxContrast))) continue;
    parent[b]=a; members[a].push(...members[b]);
    for(const [color,count] of votes[b]) votes[a].set(color,(votes[a].get(color)||0)+count);
    mergedRegions++;
  }
  const colors=regions.map((_,i)=>[...votes[root(i)]].sort((a,b)=>b[1]-a[1]||a[0]-b[0])[0][0]);
  let changedSourcePixels=0;
  for(let p=0;p<n;p++) {
    const color=colors[ids[p]];
    if(color!==values[p]) changedSourcePixels++;
    segmented.data.writeUInt32BE(color,p*4);
  }
  return {mode:'connected-source-contrast', maxContrast, amplification,
    regions:regions.length, mergedRegions, changedSourcePixels,
    limitation:'Weak-contrast boundaries require saved visual review; this is not semantic material recognition.'};
}

module.exports = { segmentSourceRegions, consolidateSourcePlanes };
