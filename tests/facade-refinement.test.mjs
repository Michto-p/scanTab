import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {refineFacadeGroups} from '../app/segmentation/affinage.js';
import {homography,mapPoint,validateQuad} from '../app/pretraitement/geometry.js';

const fixture=JSON.parse(await readFile(new URL('./photos/affinage-groupes.annotations.json',import.meta.url),'utf8'));
const rect=(x,y,width,height)=>[{x,y},{x:x+width,y},{x:x+width,y:y+height},{x,y:y+height}];
function candidate(points,id){return{id,points,confiance:.91,confidence:.91,niveau:'geometrie',modules:null,scale:null};}
function scene(widths=fixture.row.widths){
  const {width,height,row}=fixture,data=new Uint8ClampedArray(width*height*4),facades=[];
  for(let p=0;p<data.length;p+=4)data.set([185,185,185,255],p);
  let left=row.x;
  for(const [index,units]of widths.entries()){
    const w=units*row.unit;
    for(let y=row.y;y<row.y+row.height;y++)for(let x=left;x<left+w;x++){
      let gray=x-left<2||left+w-x<=2||y-row.y<2||row.y+row.height-y<=2?35:238;
      if(x>left+w*.32&&x<left+w*.65&&y>row.y+row.height*.43&&y<row.y+row.height*.66)gray=30;
      data.set([gray,gray,gray,255],(y*width+x)*4);
    }
    facades.push(candidate(rect(left,row.y,w,row.height),`f-${index}`));left+=w;
  }
  return{image:{width,height,data},facades};
}
function inverse(m){const[a,b,c,d,e,f,g,h,i]=m,det=a*(e*i-f*h)-b*(d*i-f*g)+c*(d*h-e*g);return[e*i-f*h,c*h-b*i,b*f-c*e,f*g-d*i,a*i-c*g,c*d-a*f,d*h-e*g,b*g-a*h,a*e-b*d].map(v=>v/det);}
function rotated(source){
  const {width,height,points}=fixture.rotation,transform=homography(points,source.width,source.height),back=inverse(transform),data=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const p=mapPoint(back,x+.5,y+.5),sx=Math.floor(p.x),sy=Math.floor(p.y),index=(y*width+x)*4;
    if(sx>=0&&sy>=0&&sx<source.width&&sy<source.height)data.set(source.data.subarray((sy*source.width+sx)*4,(sy*source.width+sx)*4+4),index);else data.set([185,185,185,255],index);
  }
  return{image:{width,height,data},transform};
}

test('Affinage : les enfants cohérents sont comparés entre eux, pas à la hauteur du contenant',()=>{
  const{image}=scene(),before=image.data.slice(),parent=candidate(fixture.parent,'contenant'),result=refineFacadeGroups(image,[parent]);
  assert.equal(result.length,7,JSON.stringify(result));
  const widths=result.map(c=>(Math.hypot(c.points[1].x-c.points[0].x,c.points[1].y-c.points[0].y)+Math.hypot(c.points[2].x-c.points[3].x,c.points[2].y-c.points[3].y))/2).sort((a,b)=>a-b);
  assert.ok(widths.at(-1)>widths[0]*3.6,'Le grand appareil a été coupé par une grille uniforme.');
  for(const c of result){assert.equal(c.modules,null);assert.equal(c.scale,null);assert.ok(c.bottom-c.top>270);assert.ok(c.confiance<=parent.confiance);assert.ok(validateQuad(c.points,image.width,image.height));}
  assert.deepEqual(image.data,before);assert.deepEqual(parent.points,fixture.parent);
});

test('Affinage : le plan incliné est redressé puis les sept contours sont reprojetés',()=>{
  const source=scene(),{image,transform}=rotated(source.image),points=fixture.parent.map(p=>mapPoint(transform,p.x,p.y));
  const result=refineFacadeGroups(image,[candidate(points,'photo-inclinee')]);
  assert.equal(result.length,7,JSON.stringify(result));
  for(const c of result){assert.ok(validateQuad(c.points,image.width,image.height));assert.ok(Math.abs(c.points[1].y-c.points[0].y)>10);assert.equal(c.modules,null);assert.equal(c.scale,null);}
});

test('Affinage : une largeur relative répétée permet de rechercher le joint réel oublié',()=>{
  const{image,facades}=scene(),fused=candidate([facades[4].points[0],facades[5].points[1],facades[5].points[2],facades[4].points[3]],'fusion');
  const supplied=[...facades.slice(0,4),fused,facades[6]],before=JSON.stringify(supplied),result=refineFacadeGroups(image,supplied);
  assert.equal(result.length,7,JSON.stringify(result));
  for(const c of result){assert.equal(c.modules,null);assert.equal(c.scale,null);assert.ok(c.bottom-c.top>270);}
  assert.equal(JSON.stringify(supplied),before);
});

test('Affinage : un grand appareil sans joint reste entier, même avec un contenant large',()=>{
  const{image,facades}=scene([10]),result=refineFacadeGroups(image,[facades[0]]);
  assert.equal(result.length,1);assert.equal(result[0].id,facades[0].id);assert.equal(result[0].modules,null);
});

test('Affinage : sans trois largeurs répétées, aucun repère ni séparation ne sont inventés',()=>{
  const{image,facades}=scene([1,2,2.5]),result=refineFacadeGroups(image,facades);
  assert.deepEqual(result.map(c=>c.id),facades.map(c=>c.id));
});

test('Affinage : les vrais demi-modules et les appareils de deux et demi restent entiers',()=>{
  const{image,facades}=scene([4,1,1,1,.5,2.5]),result=refineFacadeGroups(image,facades);
  assert.equal(result.length,6,JSON.stringify(result));
  const widths=result.map(c=>c.right-c.left).sort((a,b)=>a-b);
  assert.ok(widths[0]<55&&widths[0]>35);assert.ok(widths.some(w=>w>210&&w<240));
  for(const c of result){assert.equal(c.modules,null);assert.equal(c.scale,null);}
});

test('Affinage : les entrées invalides restent disponibles pour correction',()=>{
  const invalid={id:'invalide',points:null},image={width:30,height:30,data:new Uint8ClampedArray(3600)};
  assert.deepEqual(refineFacadeGroups(image,[invalid]),[invalid]);assert.deepEqual(refineFacadeGroups(null,[invalid]),[invalid]);
});
