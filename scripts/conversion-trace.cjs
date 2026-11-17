'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
// Diagnostics receive serialized copies, never mutable renderer state.
function snapshot(PNG,trace,stage,image,details={}){
 if(!trace)return;
 trace({stage,width:image.width,height:image.height,pixelsSha256:hash(image.data),png:PNG.sync.write(image),details:structuredClone(details)});
}
function createTrace(directory,bindings={}){
 fs.mkdirSync(directory,{recursive:true});const stages=[];
 const record=event=>{
  const file=String(stages.length).padStart(2,'0')+'-'+event.stage.replace(/[^a-z0-9-]/gi,'-')+'.png';
  fs.writeFileSync(path.join(directory,file),event.png,{flag:'wx'});
  stages.push({stage:event.stage,file,width:event.width,height:event.height,pixelsSha256:event.pixelsSha256,pngSha256:hash(event.png),details:event.details});
 };
 const finish=(status,error=null)=>fs.writeFileSync(path.join(directory,'trace.json'),JSON.stringify({version:1,purpose:'Diagnostic snapshots, not visual acceptance or delivery',bindings,status,error,stages},null,2)+'\n',{flag:'wx'});
 return {record,finish};
}
module.exports={snapshot,createTrace};
