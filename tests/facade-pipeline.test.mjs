import test from 'node:test';
import assert from 'node:assert/strict';
import {segmentRectifiedRow,analyzeSelectedRow} from '../app/segmentation/analyse.js';
import {homography,mapPoint,validateQuad} from '../app/pretraitement/geometry.js';

function inverse(m){
  const[a,b,c,d,e,f,g,h,i]=m,det=a*(e*i-f*h)-b*(d*i-f*g)+c*(d*h-e*g);
  return[e*i-f*h,c*h-b*i,b*f-c*e,f*g-d*i,a*i-c*g,c*d-a*f,d*h-e*g,b*g-a*h,a*e-b*d].map(v=>v/det);
}
function scene(widths=[1,2,2.5,.5],empty=[]){
  const width=850,height=510,points=[{x:80,y:70},{x:740,y:140},{x:715,y:415},{x:100,y:380}];
  const total=widths.reduce((a,b)=>a+b,0),planeWidth=600,planeHeight=280;
  const backward=inverse(homography(points,planeWidth,planeHeight)),data=new Uint8ClampedArray(width*height*4);
  const cuts=[0];for(const w of widths)cuts.push(cuts.at(-1)+w/total*planeWidth);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const p=mapPoint(backward,x,y);let v=175;
    if(p.x>=0&&p.x<planeWidth&&p.y>=0&&p.y<planeHeight){
      v=240;
      const index=cuts.findIndex((edge,i)=>i<cuts.length-1&&p.x>=edge&&p.x<cuts[i+1]);
      if(empty.includes(index)){data.set([175,175,175,255],(y*width+x)*4);continue;}
      if(cuts.some(edge=>Math.abs(p.x-edge)<1.5))v=40;
      const left=cuts[index],extent=cuts[index+1]-left;
      if(p.x>left+extent*.3&&p.x<left+extent*.65&&p.y>110&&p.y<170)v=25;
    }
    data.set([v,v,v,255],(y*width+x)*4);
  }
  return {image:{width,height,data},points,total};
}

test('Une rangée en perspective est segmentée dans son plan puis reprojetée',()=>{
  const {image,points,total}=scene(),before=image.data.slice();
  const result=segmentRectifiedRow(image,{points,modules:total});
  assert.deepEqual(result.candidates.map(c=>c.modules),[1,2,2.5,.5]);
  for(const c of result.candidates){
    assert.ok(validateQuad(c.points,image.width,image.height));
    assert.equal(c.scale.plane,'rangee-redressee');assert.equal(c.scale.source,'nombre-confirme');
    assert.ok(Math.abs(c.points[1].y-c.points[0].y)>2,'Le bord incliné a été remplacé par un rectangle horizontal.');
    assert.ok(c.bottom-c.top>250,'La façade a été raccourcie à son levier.');
  }
  assert.deepEqual(result.rows[0].points,points);assert.deepEqual(image.data,before);
});

test('Un grand appareil sans joint reste entier après redressement',()=>{
  const {image,points,total}=scene([6]);const result=segmentRectifiedRow(image,{points,modules:total});
  assert.equal(result.candidates.length,1);assert.equal(result.candidates[0].modules,null);
  assert.deepEqual(result.rows[0].cuts,[0,6]);
});

test('Les coins croisés et le nombre de modules invalide sont refusés',()=>{
  const {image,points}=scene();
  assert.throws(()=>segmentRectifiedRow(image,{points:[points[0],points[2],points[1],points[3]],modules:6}));
  assert.throws(()=>segmentRectifiedRow(image,{points,modules:0}));
});

test('Un espace vide sépare deux groupes sans étendre leurs quads à toute la rangée',()=>{
  const {image,points,total}=scene([1,1,2,1,1],[2]);
  const result=segmentRectifiedRow(image,{points,modules:total});
  assert.equal(result.rows.length,2);assert.deepEqual(result.candidates.map(c=>c.modules),[1,1,1,1]);
  for(const row of result.rows){
    assert.equal(row.modules,2);assert.ok(row.right-row.left<300);
    const facades=result.candidates.filter(c=>c.groupId===row.groupId);
    assert.deepEqual(row.points[0],facades[0].points[0]);assert.deepEqual(row.points[2],facades.at(-1).points[2]);
  }
  assert.ok(result.rows[0].right<result.rows[1].left);
});

test('Une sélection uniforme ne devient pas une rangée redressée reconnue',()=>{
  const width=360,height=180,data=new Uint8ClampedArray(width*height*4).fill(255);
  const result=analyzeSelectedRow({width,height,data},{modules:8});
  assert.equal(result.candidates.length,0);assert.equal(result.geometrySource,'selection');
  assert.match(result.warnings.join(' '),/indécidable/);
});
