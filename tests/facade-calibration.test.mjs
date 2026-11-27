import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {calibrateFacadeRow,measureRectifiedFacades} from '../app/pretraitement/rangees.js';
import {homography,mapPoint,rectifiedSize} from '../app/pretraitement/geometry.js';

const fixture=JSON.parse(await readFile(new URL('./photos/calibration-rangee.annotations.json',import.meta.url),'utf8'));
function scene(annotation,{joints=true}={}){
  const {width,height,planeWidth,planeHeight}=fixture,points=annotation.points;
  const toSource=homography(points,planeWidth,planeHeight);
  const toPlane=measureRectifiedFacades({points,facades:[]}).transform,size=rectifiedSize(points);
  const data=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const p=mapPoint(toPlane,x,y),px=p.x/size.width*planeWidth,py=p.y/size.height*planeHeight;
    let value=170;
    if(px>=0&&px<planeWidth&&py>=0&&py<planeHeight){
      value=235;
      if(joints&&fixture.cuts.slice(1,-1).some(cut=>Math.abs(px-cut*100)<1.6))value=35;
      // Un marquage court ne devient pas une séparation de façade.
      if(joints&&px>175&&px<190&&py>95&&py<145)value=20;
    }
    data.set([value,value,value,255],(y*width+x)*4);
  }
  const [first,second]=fixture.repere18mm.map(point=>mapPoint(toSource,point.x,point.y));
  return {image:{width,height,data},options:{points,first,second},size};
}

for(const annotation of fixture.scenes)test(`Repère humain de 18 mm dans le plan redressé : ${annotation.nom}`,()=>{
  const {image,options,size}=scene(annotation),before=image.data.slice(),saved=structuredClone(options);
  const result=calibrateFacadeRow(image,options);
  assert.equal(result.modules,fixture.modules);assert.deepEqual(result.cuts,fixture.cuts);
  assert.equal(result.calibrationConfirmed,true);
  assert.equal(result.scale.source,'repere-18-mm');assert.equal(result.scale.plane,'rangee-redressee');
  assert.equal(result.scale.moduleMillimeters,18);assert.equal(result.scale.confidence,1);
  assert.ok(Math.abs(result.scale.pixelsPerModule-size.width/fixture.modules)<1e-8);
  assert.ok(Math.abs(result.scale.pixelsPerMillimeter-size.width/fixture.modules/18)<1e-8);
  assert.deepEqual(result.rectifiedSize,size);assert.deepEqual(result.points,options.points);
  assert.equal(result.left,Math.min(...options.points.map(point=>point.x)));
  assert.equal(result.right,Math.max(...options.points.map(point=>point.x)));
  assert.equal(result.top,Math.min(...options.points.map(point=>point.y)));
  assert.equal(result.bottom,Math.max(...options.points.map(point=>point.y)));
  assert.deepEqual(options,saved);assert.deepEqual(image.data,before);
});

test('Le repère calibre la largeur sans ajouter des coupes régulières sur une façade uniforme',()=>{
  const {image,options}=scene(fixture.scenes[0],{joints:false}),result=calibrateFacadeRow(image,options);
  assert.equal(result.modules,5.5);assert.deepEqual(result.cuts,[0,5.5]);
  assert.ok(result.confidence<.8,'L’absence de joints reste explicite malgré le repère humain.');
});

test('Une calibration sans les deux bords humains, hors rangée ou sans largeur est refusée',()=>{
  const {image,options}=scene(fixture.scenes[0]);
  assert.throws(()=>calibrateFacadeRow(image),/coins/);
  assert.throws(()=>calibrateFacadeRow(image,{...options,second:null}),/deux bords/);
  assert.throws(()=>calibrateFacadeRow(image,{...options,second:{x:0,y:0}}),/dans la rangée/);
  assert.throws(()=>calibrateFacadeRow(image,{...options,second:options.first}),/repère/);
});
