import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {snapHalfModule} from '../app/pretraitement/geometry.js';
import {validateRow,deviceRects,suggestRows} from '../app/segmentation/rows.js';
export async function fixture() {
  const annotation=JSON.parse(await readFile(new URL('./photos/tableau-synthetique.annotations.json',import.meta.url),'utf8'));
  const svg=await readFile(new URL('./photos/'+annotation.fixture,import.meta.url),'utf8');
  const data=new Uint8ClampedArray(annotation.width*annotation.height*4);
  // Rasterisation limitée aux rectangles opaques de ce dessin de test.
  for(const match of svg.matchAll(/<rect\s+([^>]+)\/>/g)){
    const a=Object.fromEntries([...match[1].matchAll(/([\w-]+)="([^"]+)"/g)].map(m=>[m[1],m[2]]));
    const rgb=a.fill.slice(1).match(/../g).map(v=>parseInt(v,16));
    for(let y=Number(a.y);y<Number(a.y)+Number(a.height);y++)for(let x=Number(a.x);x<Number(a.x)+Number(a.width);x++)data.set([...rgb,255],(y*annotation.width+x)*4);
  }
  return {annotation,image:{width:annotation.width,height:annotation.height,data}};
}
test('Demi-modules jointifs et largeur physique explicite sur la référence',async()=>{
  const {annotation}=await fixture(),row={...annotation.rows[0],cuts:[0,.5,2,4,13]};
  assert.equal(snapHalfModule(1.26),1.5);assert.equal(snapHalfModule(1.24),1);
  assert.equal(validateRow(row,720,520),true);
  const rects=deviceRects(row,720);
  assert.deepEqual(rects.map(r=>r.modules),[.5,1.5,2,9]);
  assert.equal(rects[0].x,row.left);assert.equal(rects[0].width,22);
  rects.slice(1).forEach((r,i)=>assert.equal(r.x,rects[i].x+rects[i].width));
  assert.equal(rects.at(-1).x+rects.at(-1).width,row.right);
  for(const cuts of [[0,1,1,13],[0,1.25,13],[0,12]])assert.equal(validateRow({...row,cuts},720,520),false);
});
test('Deux rangées proposées sur le dessin annoté, rien inventé sur fond uniforme',async()=>{
  const {annotation,image}=await fixture(),rows=suggestRows(image);
  assert.equal(rows.length,2);
  rows.forEach((r,i)=>{assert.equal(validateRow(r,720,520),true);assert.ok(Math.abs(r.top-annotation.rows[i].top)<=annotation.tolerance_px);assert.ok(Math.abs(r.bottom-annotation.rows[i].bottom)<=annotation.tolerance_px);});
  const data=new Uint8ClampedArray(120*100*4).fill(240);
  for(let i=3;i<data.length;i+=4)data[i]=255;
  assert.deepEqual(suggestRows({width:120,height:100,data}),[]);
});
