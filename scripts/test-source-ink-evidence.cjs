'use strict';
const assert=require('node:assert/strict'),{reconcileSourceInk}=require('./source-ink-evidence.cjs'),{PNG}=require(require.resolve('pngjs',{paths:[__dirname,process.cwd()]}));
const make=(gap,width=3)=>{const im=new PNG({width:64,height:48}),mask=new Set(),pigment=new Uint32Array(64*48),color=0x7c6d9bff;for(let p=0;p<64*48;p++)im.data.writeUInt32BE(0xffffffff,p*4);for(let x=8;x<57;x++)for(let y=22;y<25;y++){const p=y*64+x;im.data.writeUInt32BE(color,p*4);if(x<28||x>37){mask.add(p);pigment[p]=color;}}for(let x=28;x<=37;x++)for(let y=24-Math.floor(width/2);y<=24+Math.floor(width/2);y++)im.data.writeUInt32BE(gap,(y*64+x)*4);return{im,mask,pigment};};
let tests=0;const test=(name,f)=>{f();tests++;console.log('PASS '+name);};
test('continuous raw stroke survives a different palette-role interval',()=>{const t=make(0x663276ff),r=reconcileSourceInk(t.im,t.mask,t.pigment,4,()=>false);assert(r.addedSourcePixels>0);for(let x=28;x<=37;x++)assert([22,23,24,25].some(y=>t.mask.has(y*64+x)));assert(r.intervals.every(v=>v.color===0x7c6d9bff));});
test('real bright negative space is not bridged',()=>{const t=make(0xffffffff,7),r=reconcileSourceInk(t.im,t.mask,t.pigment,4,()=>false);assert.equal(r.addedSourcePixels,0);});
test('protected source feature cannot become a connecting stroke',()=>{const t=make(0x663276ff),r=reconcileSourceInk(t.im,t.mask,t.pigment,4,p=>p%64>=28&&p%64<=37);assert.equal(r.addedSourcePixels,0);});
test('one-sided fringe cannot seed a new line',()=>{const t=make(0x663276ff);for(const p of [...t.mask])if(p%64>37){t.mask.delete(p);t.pigment[p]=0;}const r=reconcileSourceInk(t.im,t.mask,t.pigment,4,()=>false);assert.equal(r.addedSourcePixels,0);});
test('different material anchors are not arbitrarily joined',()=>{const t=make(0x663276ff);for(const p of t.mask)if(p%64>37)t.pigment[p]=0x9d446dff;const r=reconcileSourceInk(t.im,t.mask,t.pigment,4,()=>false);assert.equal(r.addedSourcePixels,0);});
test('same closed contour can have a missing role interval',()=>{
 const t=make(0x663276ff);
 // The two anchors already meet around the lower half of a closed outline.
 // Component identity must not suppress the observed upper interval.
 for(let y=24;y<=38;y++)for(const x of [8,56]){const p=y*64+x;t.im.data.writeUInt32BE(0x7c6d9bff,p*4);t.mask.add(p);t.pigment[p]=0x7c6d9bff;}
 for(let x=8;x<=56;x++){const p=38*64+x;t.im.data.writeUInt32BE(0x7c6d9bff,p*4);t.mask.add(p);t.pigment[p]=0x7c6d9bff;}
 const r=reconcileSourceInk(t.im,t.mask,t.pigment,4,()=>false);
 assert(r.addedSourcePixels>0);
 for(let x=28;x<=37;x++)assert([22,23,24,25].some(y=>t.mask.has(y*64+x)));
});
test('one-pixel mixed fringe belongs to its ink, not a second palette stroke',()=>{
 const im=new PNG({width:32,height:24}),mask=new Set(),pigment=new Uint32Array(768);
 im.data.fill(255);for(let y=4;y<20;y++)for(let x=10;x<=13;x++){const p=y*32+x;im.data.writeUInt32BE(x===13?0x888888ff:0x222222ff,p*4);if(x<13){mask.add(p);pigment[p]=0x222222ff;}}
 const r=reconcileSourceInk(im,mask,pigment,4,p=>p===12*32+13);
 assert(r.fringeSourcePixels.includes(10*32+13));assert(!mask.has(12*32+13));
 for(let y=4;y<20;y++)assert(!mask.has(y*32+14),'Must not grow across flat white material');
});
console.log(JSON.stringify({tests,status:'PASS',scope:'Source role continuity only; saved image needs separate visual review'}));
