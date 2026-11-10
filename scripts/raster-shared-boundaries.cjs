'use strict';

// Experimental whole-image conversion. Each boundary between two source
// regions is traced and simplified ONCE, then shared by both regions.
// No target-dot coordinates, character branches or output repainting.
function rasterSharedBoundaries(PNG, source, width, height, background, tolerance = .18, alignAxes = true, sourceGrid = null, registration = null, roundVertices = true) {
  const w = source.width, h = source.height, stride = w + 1;
  const bg = parseInt(background.slice(1) + 'ff', 16);
  const factor = Math.min(width / w, height / h);
  const fw = sourceGrid ? sourceGrid.x.length : Math.round(w * factor);
  const fh = sourceGrid ? sourceGrid.y.length : Math.round(h * factor);
  if(sourceGrid&&(fw!==width||fh!==height))throw Error('Measured grid counts must define the native canvas');
  const ox = Math.floor((width - fw) / 2), oy = Math.floor((height - fh) / 2);
  const colors = new Uint32Array(w * h);
  for (let i = 0; i < colors.length; i++) colors[i] = source.data.readUInt32BE(i * 4);
  const edges = [], nodes = new Map();
  function add(a, b, right, left) {
    if (right === left) return;
    const id = edges.length;
    edges.push({ a, b, right, left, used: false });
    for (const p of [a, b]) {
      if (!nodes.has(p)) nodes.set(p, []);
      nodes.get(p).push(id);
    }
  }
  for (let y = 0; y <= h; y++) for (let x = 0; x < w; x++)
    add(y * stride + x, y * stride + x + 1,
      y < h ? colors[y * w + x] : bg, y ? colors[(y - 1) * w + x] : bg);
  for (let y = 0; y < h; y++) for (let x = 0; x <= w; x++)
    add(y * stride + x, (y + 1) * stride + x,
      x ? colors[y * w + x - 1] : bg, x < w ? colors[y * w + x] : bg);
  function coordinateMap(size, intervals) {
    const result=new Float64Array(size+1);let k=0;
    for(let p=0;p<=size;p++){
      while(k+1<intervals.length&&p>=intervals[k][1])k++;
      const [a,b]=intervals[k];
      if(!(b>a))throw Error('Non-monotone measured grid');
      result[p]=k+(p-a)/(b-a);
    }
    return result;
  }
  const mapped=sourceGrid?[coordinateMap(w,sourceGrid.x),coordinateMap(h,sourceGrid.y)]:null;
  const unregisteredPoint = p => mapped
    ? [mapped[0][p%stride],mapped[1][Math.floor(p/stride)]]
    : [(p % stride) * fw / w + ox, Math.floor(p / stride) * fh / h + oy];
  const point = p => {
    const original=unregisteredPoint(p),result=registration?registration(original):original;
    if(!Array.isArray(result)||result.length!==2||result.some(v=>!Number.isFinite(v)))
      throw Error('Invalid shared geometry registration');
    return result;
  };
  function simplify(points) {
    if (points.length <= 2) return points;
    const a = points[0], b = points.at(-1), vx = b[0] - a[0], vy = b[1] - a[1];
    let greatest = 0, cut = 0;
    for (let i = 1; i < points.length - 1; i++) {
      const p = points[i], t = Math.max(0, Math.min(1,
        ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / (vx * vx + vy * vy || 1)));
      const distance = Math.hypot(p[0] - a[0] - t * vx, p[1] - a[1] - t * vy);
      if (distance > greatest) { greatest = distance; cut = i; }
    }
    return greatest > tolerance
      ? [...simplify(points.slice(0, cut + 1)).slice(0, -1), ...simplify(points.slice(cut))]
      : [a, b];
  }
  const boundaries = new Map(), traces = [], geometry = [];
  function record(color, a, b) {
    if (!boundaries.has(color)) boundaries.set(color, []);
    boundaries.get(color).push([a, b]);
  }
  function trace(id, start) {
    const edge = edges[id], right = edge.a === start ? edge.right : edge.left;
    const left = edge.a === start ? edge.left : edge.right;
    let p = start;
    const points = [point(p)];
    while (true) {
      const e = edges[id];
      e.used = true;
      p = e.a === p ? e.b : e.a;
      points.push(point(p));
      const adjacent = nodes.get(p);
      if (p === start || adjacent.length !== 2) break;
      id = adjacent.find(i => !edges[i].used);
      if (id === undefined) break;
    }
    const reduced = simplify(points);
    geometry.push({ points: reduced, right, left });
    traces.push({ right: right.toString(16), left: left.toString(16),
      sourceVertices: points.length, reducedVertices: reduced.length });
  }
  // Start at junctions first so a shared chain never receives two independent
  // approximations. Remaining degree-two components are closed loops.
  for (const [p, adjacent] of nodes) if (adjacent.length !== 2)
    for (const id of adjacent) if (!edges[id].used) trace(id, p);
  edges.forEach((e, id) => { if (!e.used) trace(id, e.a); });
  // A nearly horizontal/vertical source run is one edge, not a sloped line
  // whose two endpoints round to different rows. Share junction constraints.
  const vertices = [], vertexIds = new Map();
  function vertex(p) {
    const key = p.join(',');
    if (!vertexIds.has(key)) { vertexIds.set(key, vertices.length); vertices.push(p); }
    return vertexIds.get(key);
  }
  const mesh = geometry.map(g => ({ ...g, ids: g.points.map(vertex) }));
  const parents = [vertices.map((_,i)=>i), vertices.map((_,i)=>i)];
  function root(axis, i) {
    while (parents[axis][i] !== i) { parents[axis][i] = parents[axis][parents[axis][i]]; i = parents[axis][i]; }
    return i;
  }
  let alignedSegments = 0, mergedMicroEdges = 0;
  if (alignAxes) for (const g of mesh) for (let k=0;k+1<g.ids.length;k++) {
    const i=g.ids[k],j=g.ids[k+1],a=vertices[i],b=vertices[j];
    const dx=Math.abs(a[0]-b[0]),dy=Math.abs(a[1]-b[1]);
    if (Math.hypot(dx,dy)<=tolerance) {
      for(let axis=0;axis<2;axis++) parents[axis][root(axis,j)]=root(axis,i);
      mergedMicroEdges++;continue;
    }
    const axis=dx<dy?0:1,short=Math.min(dx,dy),long=Math.max(dx,dy);
    if(short<=tolerance && long>=.5 && short<long/3) {
      parents[axis][root(axis,j)]=root(axis,i);alignedSegments++;
    }
  }
  const coordinates = [new Map(),new Map()];
  for(let axis=0;axis<2;axis++)for(let i=0;i<vertices.length;i++) {
    const r=root(axis,i),list=coordinates[axis].get(r)||[];
    list.push(vertices[i][axis]);coordinates[axis].set(r,list);
  }
  const fitted=vertices.map((p,i)=>p.map((v,axis)=>{
    const list=coordinates[axis].get(root(axis,i));
    const mean=list.reduce((a,b)=>a+b,0)/list.length;
    return roundVertices?Math.round(mean):mean;
  }));
  let collapsedSegments=0;
  for(const g of mesh)for(let i=0;i+1<g.ids.length;i++){
    const a=fitted[g.ids[i]],b=fitted[g.ids[i+1]];
    if(a[0]===b[0]&&a[1]===b[1]){collapsedSegments++;continue;}
    record(g.right,a,b);record(g.left,b,a);
  }
  // Add the canvas enclosure for the background, which surrounds all regions.
  for (const [a, b] of [
    [[0,0],[width,0]], [[width,0],[width,height]],
    [[width,height],[0,height]], [[0,height],[0,0]],
  ]) record(bg, a, b);
  const image = new PNG({ width, height }), claims = new Uint8Array(width * height);
  for (const [color, segments] of boundaries) for (let y = 0; y < height; y++) {
    const cy = y + .5, crosses = [];
    for (const [a, b] of segments) if ((a[1] > cy) !== (b[1] > cy))
      crosses.push(a[0] + (cy - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
    crosses.sort((a, b) => a - b);
    if (crosses.length % 2) throw Error('Open shared boundary');
    for (let i = 0; i < crosses.length; i += 2)
      for (let x = Math.max(0, Math.ceil(crosses[i] - .5)); x < Math.min(width, crosses[i + 1] - .5); x++) {
        const p = y * width + x;
        claims[p]++;
        image.data.writeUInt32BE(color, p * 4);
      }
  }
  const gaps = [...claims].filter(c => !c).length, conflicts = [...claims].filter(c => c > 1).length;
  if (gaps || conflicts) throw Error(`Shared raster topology conflict: ${gaps} gaps, ${conflicts} overlaps`);
  return { image, report: { status: 'EXPERIMENTAL_REQUIRES_FULL_IMAGE_REVIEW',
    fit: [fw, fh, ox, oy], measuredSourceGrid:!!sourceGrid, tolerance, boundaryEdges: edges.length,
    sharedChains: traces.length, alignedSegments, mergedMicroEdges, collapsedSegments, gaps, conflicts, traces } };
}
module.exports = { rasterSharedBoundaries };
