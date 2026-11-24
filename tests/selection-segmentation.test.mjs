import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {segmentSelection} from '../app/segmentation/automatic.js';
import {deviceRects,validateRow} from '../app/segmentation/rows.js';

const fixture=JSON.parse(await readFile(new URL('./photos/selection-modulaire.annotations.json',import.meta.url),'utf8'));
function sceneRaster(scene={}){
  const width=scene.imageWidth??1000,height=scene.imageHeight??700,data=new Uint8ClampedArray(width*height*4);
  const widths=scene.widths??[2,1,1,2.5],modules=widths.reduce((sum,value)=>sum+value,0),pitch=scene.pitch??48;
  const bounds=scene.bounds??{x:scene.x??120,y:scene.y??125,width:modules*pitch,height:scene.height??180};
  const fill=(left,top,extent,span,gray)=>{for(let y=Math.max(0,Math.floor(top));y<Math.min(height,Math.ceil(top+span));y++)for(let x=Math.max(0,Math.floor(left));x<Math.min(width,Math.ceil(left+extent));x++){const index=(y*width+x)*4;data[index]=gray;data[index+1]=gray;data[index+2]=gray;data[index+3]=255;}};
  fill(0,0,width,height,195);
  // Un coffret voisin contrasté ne participe jamais au calcul de la ROI.
  fill(width*.74,20,width*.2,height-40,30);fill(width*.76,40,width*.16,height-80,150);
  let module=0;
  for(let index=0;index<widths.length;index++){
    const extent=widths[index]*bounds.width/modules,left=bounds.x+module*bounds.width/modules;
    if(!scene.emptyIndices?.includes(index)){
      fill(left,bounds.y,extent,bounds.height,242);
      const joint=scene.weak?219:55;
      fill(left,bounds.y,2,bounds.height,joint);fill(left+extent-2,bounds.y,2,bounds.height,joint);
      fill(left+extent*.28,bounds.y+bounds.height*.38,Math.max(4,extent*.35),bounds.height*.2,35);
      if(scene.markings){
        // Plusieurs lignes d'impression et bornes restent courtes.
        for(let letter=0;letter<Math.floor(extent/9);letter++)fill(left+5+letter*8,bounds.y+12,2,bounds.height*.12,45);
        fill(left+extent*.48,bounds.y+bounds.height*.78,3,bounds.height*.12,45);
      }
    }
    module+=widths[index];
  }
  return {image:{width,height,data},bounds,modules};
}

for(const scene of fixture.scenes)test(`Sélection calibrée : ${scene.nom}`,()=>{
  const {image,bounds,modules}=sceneRaster(scene),result=segmentSelection(image,bounds,modules);
  assert.deepEqual(result.candidates.map(candidate=>candidate.modules),scene.expected??scene.widths,JSON.stringify(result));
  assert.equal(result.rows.length,scene.groups??1);
  result.rows.forEach(row=>assert.equal(validateRow(row,image.width,image.height),true));
  assert.deepEqual(result.rows.flatMap(row=>deviceRects(row,image.width).map(rect=>rect.modules)),scene.expected??scene.widths);
  for(const candidate of result.candidates){
    assert.equal(candidate.niveau,'geometrie');assert.ok(candidate.confiance>=.78&&candidate.confiance<1);
    assert.equal(candidate.scale.source,'nombre-confirme');assert.equal(candidate.scale.confidence,1);
    assert.equal(candidate.scale.moduleMillimeters,18);assert.equal(candidate.scale.pixelsPerModule,bounds.width/modules);
    assert.ok(candidate.left>=bounds.x&&candidate.right<=bounds.x+bounds.width);
    assert.equal(candidate.top,bounds.y);assert.equal(candidate.bottom,bounds.y+bounds.height);
  }
});

test('Un appareil ou groupe large sans joint ne reçoit aucune découpe uniforme',()=>{
  const {image,bounds,modules}=sceneRaster({widths:[6.5],markings:true}),result=segmentSelection(image,bounds,modules);
  assert.equal(result.candidates.length,1);
  assert.equal(result.candidates[0].modules,null);
  assert.ok(result.candidates[0].confiance<.78);
  assert.deepEqual(result.rows[0].cuts,[0,6.5]);
  assert.match(result.warnings.join(' '),/un ou plusieurs appareils|inconnue/);
});

test('Une petite façade isolée garde une largeur inconnue faute de joints démontrant un appareil unique',()=>{
  const {image,bounds,modules}=sceneRaster({widths:[2.5]}),result=segmentSelection(image,bounds,modules);
  assert.equal(result.candidates.length,1);assert.equal(result.candidates[0].modules,null);
  assert.equal(result.rows[0].modules,2.5);assert.equal(result.candidates[0].scale.pixelsPerModule,48);
});

test('Une zone uniforme ou transparente ne fabrique aucun appareil',()=>{
  for(const alpha of [0,255]){
    const width=400,height=300,data=new Uint8ClampedArray(width*height*4).fill(255);
    for(let index=3;index<data.length;index+=4)data[index]=alpha;
    const result=segmentSelection({width,height,data},{x:20,y:20,width:300,height:200},8);
    assert.deepEqual(result.candidates,[]);assert.deepEqual(result.rows,[]);assert.match(result.warnings.join(' '),/aucune découpe uniforme/i);
  }
});

test('La ROI est calculée avant réduction et conserve les coordonnées de la photo',()=>{
  const {image,bounds,modules}=sceneRaster(fixture.large),result=segmentSelection(image,bounds,modules);
  assert.deepEqual(result.candidates.map(candidate=>candidate.modules),fixture.large.widths);
  assert.equal(result.candidates[0].left,bounds.x);assert.equal(result.candidates.at(-1).right,bounds.x+bounds.width);
  assert.equal(result.rows[0].scale.pixelsPerModule,fixture.large.pitch);
});

test('La sélection fractionnaire reste immuable et ne dérive pas à chaque joint',()=>{
  const bounds={x:120.4,y:124.2,width:312.6,height:180.6},{image,modules}=sceneRaster({bounds}),before=image.data.slice();
  const result=segmentSelection(image,bounds,modules);
  assert.deepEqual(image.data,before);assert.deepEqual(bounds,{x:120.4,y:124.2,width:312.6,height:180.6});
  assert.deepEqual(result.candidates.map(candidate=>candidate.modules),[2,1,1,2.5]);
  let cursor=bounds.x;
  for(const candidate of result.candidates){assert.ok(Math.abs(candidate.left-cursor)<1e-8);cursor=candidate.right;}
  assert.ok(Math.abs(cursor-(bounds.x+bounds.width))<1e-8);
});

test('Une zone contenant deux rangées demande des sélections séparées',()=>{
  const first=sceneRaster({imageWidth:1000,imageHeight:700,widths:[1,1,1,1,1,1],bounds:{x:120,y:80,width:288,height:150}});
  const second=sceneRaster({imageWidth:1000,imageHeight:700,widths:[1,1,1,1,1,1],bounds:{x:120,y:420,width:288,height:150}});
  for(let y=420;y<570;y++)for(let x=120;x<408;x++){const index=(y*1000+x)*4;first.image.data.set(second.image.data.subarray(index,index+4),index);}
  const result=segmentSelection(first.image,{x:120,y:65,width:288,height:520},12);
  assert.deepEqual(result.candidates,[]);assert.match(result.warnings.join(' '),/plusieurs rangées/);
});

test('Une résolution trop faible ne sert pas à inventer des séparations',()=>{
  const {image}=sceneRaster();const result=segmentSelection(image,{x:10,y:10,width:20,height:30},13);
  assert.deepEqual(result.candidates,[]);assert.match(result.warnings.join(' '),/peu de pixels/);
});

test('Les valeurs invalides et les zones hors image sont refusées',()=>{
  const {image,bounds}=sceneRaster();
  for(const modules of [0,-1,.25,1.25,101,NaN,Infinity,'6.5',null])assert.throws(()=>segmentSelection(image,bounds,modules),/modules/);
  for(const invalid of [null,{...bounds,x:-1},{...bounds,y:-1},{...bounds,width:0},{...bounds,height:NaN},{...bounds,x:999},{...bounds,y:699}])assert.throws(()=>segmentSelection(image,invalid,6.5),/zone/);
  assert.throws(()=>segmentSelection(null,bounds,6.5),/Image invalide/);
});
