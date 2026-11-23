import test from 'node:test';
import assert from 'node:assert/strict';
import {warpPixels} from '../app/pretraitement/pixels.js';

function gradient(width,height){
  const data=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)data.set([x*5,y*7,90,255],(y*width+x)*4);
  return {width,height,data};
}

test('Redressement en pixels : identité exacte, source intacte et progression terminée',()=>{
  const source=gradient(40,30),before=source.data.slice(),progress=[];
  const result=warpPixels(source,[{x:0,y:0},{x:40,y:0},{x:40,y:30},{x:0,y:30}],value=>progress.push(value));
  assert.deepEqual(result,{width:40,height:30,data:before});
  assert.deepEqual(source.data,before);assert.equal(progress.at(-1),1);
});

test('Redressement en pixels : prélèvement des marquages dans les coordonnées originales',()=>{
  const source=gradient(40,30);
  const result=warpPixels(source,[{x:10,y:5},{x:30,y:5},{x:30,y:25},{x:10,y:25}]);
  assert.equal(result.width,20);assert.equal(result.height,20);
  for(let y=0;y<20;y++)for(let x=0;x<20;x++)assert.deepEqual(
    result.data.slice((y*20+x)*4,(y*20+x+1)*4),
    source.data.slice(((y+5)*40+x+10)*4,((y+5)*40+x+11)*4));
});

test('Redressement en pixels : coins invalides et sortie démesurée rejetés avant allocation',()=>{
  const source=gradient(40,30);
  assert.throws(()=>warpPixels(source,[{x:0,y:0},{x:40,y:30},{x:40,y:0},{x:0,y:30}]),/coins/);
  assert.throws(()=>warpPixels({width:10000,height:10000,data:null},[{x:0,y:0},{x:10000,y:0},{x:10000,y:10000},{x:0,y:10000}]),/40 mégapixels/);
});
