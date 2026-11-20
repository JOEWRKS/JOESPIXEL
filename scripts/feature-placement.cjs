'use strict';
// Feature inventory routes. An inventoried feature names HOW the grid keeps it, and the run
// measures that it did. Without this, an internal mark thinner than half a cell (a nose tick,
// a brow, a crease) loses every area vote and the draft goes to review without it, although
// the inventory already carried a criterion for it. Names never select behaviour here: the
// routes are declared by the observer and checked the same way for every feature.
//   {route:"formPolicy", feature:"<formPolicy feature name>"}  dedicated source-path placement
//   {route:"measured", sourceRegion:[x,y,w,h], color:"#RRGGBB"}  ordinary area/outline placement,
//      measured: at least one native cell of that colour under the source region
//   {route:"omitted", reason:"..."}  recorded decision that the grid drops it; review sees it
const ROUTED_CHARACTER_MARKS=['nose','mouth'];
const fail=m=>{throw Error('Feature placement: '+m);};

function assertFeaturePlacement(contract,palette,sourceSize){
 const forms=new Set((contract.formPolicy?.features??[]).map(f=>f.name)),colors=new Set(palette.map(p=>p.hex));
 for(const f of contract.features??[]){
  const p=f.placement;
  if(p===undefined){
   if(contract.kind==='character'&&ROUTED_CHARACTER_MARKS.includes(f.id))fail(f.id+' needs a placement route. Internal marks thinner than half a cell vanish under area voting; route it through formPolicy, declare it measured with its source region and colour, or record it as omitted with a reason.');
   continue;
  }
  if(!p||typeof p!=='object')fail(f.id+' placement must be an object');
  const keys=Object.keys(p),only=allowed=>keys.every(k=>allowed.includes(k));
  if(p.route==='formPolicy'){
   if(!only(['route','feature'])||!forms.has(p.feature))fail(f.id+' routes to formPolicy feature '+JSON.stringify(p.feature)+', which formPolicy does not declare');
  }else if(p.route==='measured'){
   const [x,y,w,h]=p.sourceRegion??[];
   if(!only(['route','sourceRegion','color'])||![x,y,w,h].every(Number.isSafeInteger)||x<0||y<0||w<1||h<1||x+w>sourceSize[0]||y+h>sourceSize[1])fail(f.id+' measured route needs a source region inside the source');
   if(!colors.has(p.color))fail(f.id+' measured route colour is not in the palette');
  }else if(p.route==='omitted'){
   if(!only(['route','reason'])||typeof p.reason!=='string'||!p.reason.trim())fail(f.id+' omitted route needs a reason');
  }else fail(f.id+' has unknown placement route '+JSON.stringify(p.route));
 }
}

// Runs on the built native image. A route that kept nothing stops the run before review.
function measureFeaturePlacement(contract,native,formReport){
 const map=contract.sourceToNative,report=[];
 const cell=(x,y)=>native.data.readUInt32BE((y*native.width+x)*4);
 for(const f of contract.features??[]){
  const p=f.placement;if(!p)continue;
  if(p.route==='omitted'){report.push({id:f.id,route:p.route,reason:p.reason});continue;}
  if(p.route==='formPolicy'){
   const placed=(formReport?.features??[]).find(r=>r.name===p.feature);
   if(!placed?.cells)fail(f.id+' formPolicy feature '+p.feature+' placed no cells ('+(placed?.action??'not run')+(placed?.reason?': '+placed.reason:'')+')');
   report.push({id:f.id,route:p.route,feature:p.feature,cells:placed.cells});continue;
  }
  const [x,y,w,h]=p.sourceRegion,want=parseInt(p.color.slice(1)+'ff',16);
  const x0=Math.max(0,Math.floor(x*map.scaleX+map.offsetX)),y0=Math.max(0,Math.floor(y*map.scaleY+map.offsetY));
  const x1=Math.min(native.width,Math.ceil((x+w)*map.scaleX+map.offsetX)),y1=Math.min(native.height,Math.ceil((y+h)*map.scaleY+map.offsetY));
  let cells=0;for(let yy=y0;yy<y1;yy++)for(let xx=x0;xx<x1;xx++)if(cell(xx,yy)===want)cells++;
  if(!cells)fail(f.id+' kept no '+p.color+' cell in native cells x'+x0+'-'+(x1-1)+' y'+y0+'-'+(y1-1)+'. Area voting erased the observed mark: declare it as a lineMark of its line material when it belongs to the ink network, route it through formPolicy when it stands alone, or record it as omitted. Keep the measured region on the mark itself; other lines of the same colour inside it would satisfy this check.');
  report.push({id:f.id,route:p.route,color:p.color,nativeRegion:[x0,y0,x1-x0,y1-y0],cells});
 }
 return report;
}
module.exports={assertFeaturePlacement,measureFeaturePlacement,ROUTED_CHARACTER_MARKS};
