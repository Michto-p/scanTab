import test from 'node:test';
import assert from 'node:assert/strict';
import {validateQuad,rectifiedSize,homography,mapPoint} from '../app/pretraitement/geometry.js';
test('Quadrilatères croisés, inversés et externes rejetés',()=>{
  const p=[{x:0,y:0},{x:200,y:0},{x:200,y:100},{x:0,y:100}];
  assert.equal(validateQuad(p,200,100),true);
  assert.equal(validateQuad([p[0],p[2],p[1],p[3]],200,100),false);
  assert.equal(validateQuad([...p].reverse(),200,100),false);
  assert.equal(validateQuad([{x:-1,y:0},...p.slice(1)],200,100),false);
  assert.equal(validateQuad(Array(4).fill({x:1,y:1}),200,100),false);
  assert.deepEqual(rectifiedSize(p),{width:200,height:100});
});
test('Homographie identité et coins d’une perspective conservés',()=>{
  const p=[{x:0,y:0},{x:320,y:0},{x:320,y:180},{x:0,y:180}];
  const point=mapPoint(homography(p,320,180),123.5,67.5);
  assert.ok(Math.abs(point.x-123.5)<1e-7&&Math.abs(point.y-67.5)<1e-7);
  const source=[{x:21,y:13},{x:280,y:39},{x:301,y:190},{x:8,y:211}],m=homography(source,300,200);
  [[0,0],[300,0],[300,200],[0,200]].forEach(([x,y],i)=>{const q=mapPoint(m,x,y);assert.ok(Math.abs(q.x-source[i].x)<1e-6&&Math.abs(q.y-source[i].y)<1e-6);});
});
