'use strict';
// Observer-declared interior line tone (selective outline). A placed ink cell
// inside ONE declared material - every 4-neighbour that is not ink belongs to
// that material, and no 8-neighbour is background - takes the declared darker
// tone of that material. Lines on the exterior contour or between two
// materials stay ink. Feature cells (eyes, required forms) never change.
// At 8 px cells a 2-3 px interior strand otherwise has the same weight as the
// exterior contour and a strand-heavy plane (hair, cloth folds) reads as noise.
//   outlinePolicy.interiorShade: [{material, color, observation}]
function assertInteriorShade(policy,materialPlan,palette){
 const list=policy?.interiorShade;if(list===undefined)return [];
 if(!Array.isArray(list)||!list.length)throw Error('interiorShade must be a non-empty list');
 if(policy.layout!=='joint-source-band')throw Error('interiorShade runs inside the joint-source-band outline layout');
 if(!materialPlan?.regions?.length)throw Error('interiorShade needs material regions to know which plane a line lies in');
 const colors=new Map();for(const r of materialPlan.regions){if(!colors.has(r.material))colors.set(r.material,new Set());for(const c of r.colors??[])colors.get(r.material).add(c);}
 const seen=new Set(),hexes=new Set(palette.map(p=>p.hex));
 for(const e of list){
  if(!e||typeof e!=='object'||Object.keys(e).some(k=>!['material','color','observation'].includes(k)))throw Error('interiorShade entry is {material, color, observation}');
  if(!colors.has(e.material))throw Error('interiorShade material is not a material region: '+e.material);
  if(seen.has(e.material))throw Error('interiorShade material declared twice: '+e.material);seen.add(e.material);
  if(!hexes.has(e.color)||!colors.get(e.material).has(e.color))throw Error('interiorShade colour must be one of the material colours: '+e.material+' '+e.color);
  if(typeof e.observation!=='string'||!e.observation.trim())throw Error('interiorShade needs a source observation: '+e.material);
  if((policy.colors??[]).includes(e.color))throw Error('interiorShade colour cannot be an outline ink colour');
 }
 return list;
}
function applyInteriorShade(image,policy,materialPlan,palette,featureCells){
 const list=assertInteriorShade(policy,materialPlan,palette);if(!list.length)return null;
 const W=image.width,H=image.height,rgba=c=>parseInt(c.slice(1)+'ff',16),ink=new Set((policy.colors??[]).map(rgba)),bg=rgba(policy.background);
 const owners=new Map();for(const r of materialPlan.regions)for(const c of r.colors??[]){const v=rgba(c);if(!owners.has(v))owners.set(v,new Set());owners.get(v).add(r.material);}
 const shade=new Map(list.map(e=>[e.material,rgba(e.color)])),value=p=>image.data.readUInt32BE(p*4),changes=[];
 for(let y=0;y<H;y++)for(let x=0;x<W;x++){const p=y*W+x;if(!ink.has(value(p))||featureCells?.has(p))continue;
  let exterior=false,materials=new Set(),ambiguous=false;
  for(let dy=-1;dy<=1&&!exterior;dy++)for(let dx=-1;dx<=1;dx++){if(!dx&&!dy)continue;const u=x+dx,v=y+dy;if(u<0||v<0||u>=W||v>=H){exterior=true;break;}const q=v*W+u,c=value(q);if(c===bg){exterior=true;break;}
   if(ink.has(c)||Math.abs(dx)+Math.abs(dy)!==1)continue;const o=owners.get(c);if(!o||o.size!==1){ambiguous=true;continue;}materials.add([...o][0]);}
  if(exterior||ambiguous||materials.size!==1)continue;const m=[...materials][0];if(!shade.has(m))continue;changes.push([p,shade.get(m),m]);}
 // Decide on the placed lines first, then write, so one change never decides another.
 for(const [p,c] of changes)image.data.writeUInt32BE(c,p*4);
 const byMaterial={};for(const [,,m] of changes)byMaterial[m]=(byMaterial[m]||0)+1;
 return {version:1,rule:'interior-line-shade',declared:list,cells:changes.map(([p,c])=>[p,c]),byMaterial};
}
module.exports={assertInteriorShade,applyInteriorShade};
