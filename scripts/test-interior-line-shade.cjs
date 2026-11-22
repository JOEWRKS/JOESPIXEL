'use strict';
// Interior line tone: which placed ink cells take a declared material tone. Mechanics only.
const assert=require('node:assert/strict');
const {PNG}=require(require.resolve('pngjs',{paths:[__dirname,process.cwd()]}));
const {applyInteriorShade,assertInteriorShade}=require('./interior-line-shade.cjs');
let passed=0;const test=(name,fn)=>{fn();passed++;console.log('PASS '+name);};
const BG='#FDF4E2',K='#150D0A',h='#AD4E2B',H='#692E19',s='#FECAA5';
const palette=[BG,K,h,H,s].map(hex=>({hex}));
const plan={regions:[{material:'hair',colors:[h,H]},{material:'skin',colors:[s]}]};
const policy=extra=>({layout:'joint-source-band',background:BG,colors:[K],interiorShade:[{material:'hair',color:H,observation:'Thin strands inside the hair plane.'}],...extra});
// 9x7: background frame, ink contour, hair left (x2-4), skin right (x6-7), a hair strand at x3 rows 2-4,
// and the hair/skin line at x5.
const rows=['.........','.KKKKKKK.','.KhKhKssK','.KhKhKssK','.KhKhKssK','.KKKKKKK.','.........'];
const image=()=>{const p=new PNG({width:9,height:7}),c={'.':BG,K,h,s};rows.forEach((r,y)=>[...r].forEach((ch,x)=>p.data.writeUInt32BE(parseInt(c[ch].slice(1)+'ff',16),(y*9+x)*4)));return p;};
const at=(p,x,y)=>'#'+p.data.readUInt32BE((y*9+x)*4).toString(16).padStart(8,'0').slice(0,6).toUpperCase();
test('a strand inside one declared plane takes its tone; contour and material boundary stay ink',()=>{
 const p=image(),r=applyInteriorShade(p,policy(),plan,palette,new Set());
 for(const y of [2,3,4])assert.equal(at(p,3,y),H,'strand row '+y);
 for(const [x,y] of [[1,3],[3,1],[5,3],[8,3]])assert.equal(at(p,x,y),K,'kept ink at '+x+','+y);
 assert.equal(r.byMaterial.hair,3);assert.equal(r.cells.length,3);
});
test('feature cells and undeclared materials keep ink',()=>{
 const p=image();applyInteriorShade(p,policy(),plan,palette,new Set([3*9+3]));assert.equal(at(p,3,3),K);
 const q=image();assert.equal(applyInteriorShade(q,{layout:'joint-source-band',background:BG,colors:[K]},plan,palette,new Set()),null);assert.equal(at(q,3,3),K);
});
test('declarations are checked',()=>{
 const bad=[[{interiorShade:[{material:'cloth',color:H,observation:'x'}]},/not a material region/],[{interiorShade:[{material:'hair',color:s,observation:'x'}]},/one of the material colours/],
  [{interiorShade:[{material:'hair',color:H}]},/source observation/],[{layout:'one-pixel'},/joint-source-band/],[{interiorShade:[]},/non-empty/]];
 for(const [extra,re] of bad)assert.throws(()=>assertInteriorShade(policy(extra),plan,palette),re);
 assert.throws(()=>assertInteriorShade(policy(),null,palette),/material regions/);
});
console.log(JSON.stringify({passed,scope:'Interior line tone mechanics; visual review still required.'}));
