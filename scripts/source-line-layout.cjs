'use strict';
// Source-space observations only. Required paths compete for cells with their
// neighbouring planes BEFORE raster output; old ink is replaced, never overlaid.
const {rasterPath}=require('./raster-source-ink-paths.cjs');
const inside=(x,y,poly)=>{let v=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const[a,b]=poly[i],[c,d]=poly[j];if((b>y)!==(d>y)&&x<(c-a)*(y-b)/(d-b)+a)v=!v;}return v;};
const need=(v,m)=>{if(!v)throw Error('Line-plane layout: '+m);};
const cache=new WeakMap();
function validate(layouts,sw,sh,palette){
 const colors=new Set(palette.map(p=>p.hex)),ids=new Set();
 const points=p=>Array.isArray(p)&&p.length>=2&&p.every(q=>Array.isArray(q)&&q.length===2&&q.every(Number.isFinite)&&q[0]>=0&&q[0]<sw&&q[1]>=0&&q[1]<sh);
 for(const l of layouts??[]){
  need(Object.keys(l).every(k=>['id','sourcePolygon','observation','paths','planes'].includes(k))&&l.id&&!ids.has(l.id)&&l.observation,'identity/observation or unknown destination instruction');ids.add(l.id);
  need(points(l.sourcePolygon)&&l.sourcePolygon.length>=3&&Array.isArray(l.paths)&&l.paths.length&&Array.isArray(l.planes)&&l.planes.length,'source domain, paths and adjacent planes required');
  const local=new Set();for(const p of l.paths){need(Object.keys(p).every(k=>['id','points','color','priority','observation'].includes(k))&&p.id&&!local.has(p.id)&&points(p.points)&&colors.has(p.color)&&['required','omit-subcell'].includes(p.priority)&&p.observation,'invalid observed path');local.add(p.id);}
  for(const p of l.planes){need(Object.keys(p).every(k=>['id','polygon','axis','colors','observation'].includes(k))&&p.id&&!local.has(p.id)&&points(p.polygon)&&p.polygon.length>=3&&points(p.axis)&&Array.isArray(p.colors)&&p.colors.length&&p.colors.every(c=>colors.has(c))&&p.observation,'invalid connected plane');local.add(p.id);}
 }
}
function plan(source,base,labels,material,features){
 const cached=material&&cache.get(material);if(cached&&cached.features===features&&cached.labels===labels&&cached.width===base.width)return cached.result;
 const layouts=material?.plan.lineLayouts??[],sw=source.width,w=base.width,h=base.height,step=sw/w;
 const fills=new Map(),lines=new Map(),domain=new Set(),reports=[];
 const neighbors=p=>{const x=p%w,y=Math.floor(p/w);return [x?p-1:-1,x+1<w?p+1:-1,y?p-w:-1,y+1<h?p+w:-1].filter(q=>q>=0);};
 const locked=new Set([...features.cells,...(material?.fixedCells?.keys()??[])]);
 for(let p=0;p<material.exceptions.length;p++)if(material.exceptions[p])locked.add(Math.floor(p/sw/step)*w+Math.floor(p%sw/step));
 for(const l of layouts){
  const local=new Set(),votes=new Map(),ink=new Set(l.paths.map(p=>parseInt(p.color.slice(1)+'ff',16)));
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(inside((x+.5)*step,(y+.5)*step,l.sourcePolygon)&&!locked.has(y*w+x)){
   const p=y*w+x;need(!domain.has(p),'overlapping layout domains');local.add(p);const counts=new Map();
   for(let yy=y*step;yy<(y+1)*step;yy++)for(let xx=x*step;xx<(x+1)*step;xx++){const c=labels.data.readUInt32BE((yy*sw+xx)*4);if(!ink.has(c))counts.set(c,(counts.get(c)||0)+1);}
   votes.set(p,counts);
  }
  const planeMasks=l.planes.map(plane=>{
   const mask=new Map();for(const p of local){let count=0;const x=p%w*step,y=Math.floor(p/w)*step;
    for(let yy=y;yy<y+step;yy++)for(let xx=x;xx<x+step;xx++)if(inside(xx+.5,yy+.5,plane.polygon))count++;
    if(count>=step*step/8&&[...votes.get(p).keys()].some(c=>plane.colors.includes('#'+c.toString(16).slice(0,6).toUpperCase())))mask.set(p,count/(step*step));
   }return mask;
  });
  planeMasks.forEach((mask,i)=>need(mask.size,'source material coverage missing for plane '+l.planes[i].id));
  const planeRoute=(plane,mask,occupied)=>{
   const near=point=>[...mask.keys()].filter(p=>!occupied.has(p)&&Math.abs((p%w+.5)*step-point[0])<=step*.75&&Math.abs((Math.floor(p/w)+.5)*step-point[1])<=step*.75).sort((a,b)=>mask.get(b)-mask.get(a)||a-b);
   const starts=near(plane.axis[0]),ends=new Set(near(plane.axis.at(-1)));if(!starts.length||!ends.size)return null;
   const queue=[...starts],parent=new Map(starts.map(p=>[p,null]));let end;
   for(let i=0;i<queue.length;i++){const p=queue[i];if(ends.has(p)){end=p;break;}for(const q of neighbors(p).sort((a,b)=>(mask.get(b)||0)-(mask.get(a)||0)))if(mask.has(q)&&!occupied.has(q)&&!parent.has(q)){parent.set(q,p);queue.push(q);}}
   if(end===undefined)return null;const route=[];for(let p=end;p!==null;p=parent.get(p))route.push(p);return route;
  };
  const choices=l.paths.filter(p=>p.priority==='required').map(path=>{
   const result=new Map();for(const dx of [0,-.25,.25,-.5,.5])for(const dy of [0,-.25,.25,-.5,.5]){
    const cells=new Set();for(let i=1;i<path.points.length;i++)for(const[x,y]of rasterPath(path.points[i-1].map((v,k)=>v/step+(k?dy:dx)),path.points[i].map((v,k)=>v/step+(k?dy:dx)),false))if(local.has(y*w+x))cells.add(y*w+x);
    if(!cells.size)continue;
    const ends=[path.points[0],path.points.at(-1)].map(point=>({key:point.join(','),cells:new Set([...cells].filter(p=>Math.hypot(p%w+.5-point[0]/step,Math.floor(p/w)+.5-point[1]/step)<=.9))}));
    if(ends.some(e=>!e.cells.size))continue;
    const key=[...cells].sort((a,b)=>a-b).join(',');const cost=(dx*dx+dy*dy)*cells.size;
    if(!result.has(key)||cost<result.get(key).cost)result.set(key,{cells,cost,path,ends,offset:[dx,dy]});
   }need(result.size,'required path has no capacity: '+path.id);return [...result.values()].sort((a,b)=>a.cost-b.cost);
  });
  let beam=[{cells:new Set(),cost:0,paths:[]}];
  for(const options of choices){const next=[];for(const state of beam)for(const c of options){
   if(c.ends.some(end=>state.paths.some(p=>p.ends.some(other=>end.key===other.key&&![...end.cells].some(q=>other.cells.has(q))))))continue;
   const cells=new Set([...state.cells,...c.cells]);if([...cells].some(p=>p%w+1<w&&[p+1,p+w,p+w+1].every(q=>cells.has(q))))continue;
   const routes=l.planes.map((p,i)=>planeRoute(p,planeMasks[i],cells));if(routes.some(p=>!p))continue;
   // A wide source plane should not survive as only a hairline corridor.
   const loss=planeMasks.reduce((sum,mask)=>sum+[...mask].reduce((s,[p,a])=>s+(cells.has(p)?a*a:0),0),0);
   next.push({cells,cost:state.cost+c.cost,score:state.cost+c.cost+loss*4,paths:[...state.paths,c],routes});
  }next.sort((a,b)=>a.score-b.score);beam=next.slice(0,256);need(beam.length,'required lines conflict with connected planes in the tested candidates: '+l.id+' (bounded search; not proof that this grid is impossible)');}
  const chosen=beam[0],planeClaims=new Map();
  chosen.routes.forEach((route,i)=>{for(const p of route){const colors=l.planes[i].colors;if(planeClaims.has(p))need(JSON.stringify(planeClaims.get(p))===JSON.stringify(colors),'different material planes collide');planeClaims.set(p,colors);}});
  for(const p of local){domain.add(p);if(chosen.cells.has(p))continue;let counts=[...votes.get(p)];const allowed=planeClaims.get(p);if(allowed)counts=counts.filter(([c])=>allowed.includes('#'+c.toString(16).slice(0,6).toUpperCase()));
   need(counts.length,'no observed fill sample for selected plane');counts.sort((a,b)=>b[1]-a[1]||a[0]-b[0]);fills.set(p,counts[0][0]);}
  for(const c of chosen.paths)for(const p of c.cells){need(!lines.has(p)||lines.get(p)===c.path.color,'different ink roles collide');lines.set(p,c.path.color);}
  reports.push({id:l.id,method:'source-line-plane-layout',domain:[...local],paths:chosen.paths.map(c=>({id:c.path.id,cells:[...c.cells],offset:c.offset,endpoints:[c.path.points[0],c.path.points.at(-1)].map(point=>({source:point,featureOverlap:locked.has(Math.floor(point[1]/step)*w+Math.floor(point[0]/step)),distanceInCells:Math.min(...[...c.cells].map(p=>Math.hypot(p%w+.5-point[0]/step,Math.floor(p/w)+.5-point[1]/step)))}))})),planes:l.planes.map((p,i)=>({id:p.id,colors:p.colors,route:chosen.routes[i]})),omitted:l.paths.filter(p=>p.priority==='omit-subcell').map(p=>({id:p.id,observation:p.observation})),observation:l.observation});
 }
 const result={fills,lines,domain,reports};if(material)cache.set(material,{features,labels,width:base.width,result});return result;
}
function evidence(PNG,source,palette,options){
 const b=require('./build-palette-native.cjs'),m=require('./material-assignment.cjs');
 const material=m.compile(PNG,source,palette,options.width,options.height,m.readPlan(options.materialPlan),{eyePolicy:options.eyePolicy,formPolicy:options.formPolicy,outlinePolicy:options.outlinePolicy});
 const labels=b.resolveSourcePlanes(PNG,source,palette,options.width,options.height,options.eyePolicy,material,{coherentPlanes:true,preserveSmallRegions:options.outlinePolicy?.layout==='joint-source-band'}).image;
 const features=require('./eye-plane-policy.cjs').eyeOwnership(source,options.eyePolicy,options.width,options.height);
 const result=plan(source,{width:options.width,height:options.height},labels,material,features);
 return {version:1,executed:true,method:'source-line-plane-layout',layouts:result.reports,lines:[...result.lines],fills:[...result.fills],scope:'Source observations and protected feature ownership, before raster output. Not visual approval.'};
}
module.exports={validate,plan,evidence};
