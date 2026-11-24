import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {divideFacadeRow,groupFacadeRows,measureRectifiedFacades} from '../app/pretraitement/rangees.js';
import {homography,mapPoint,rectifiedSize,validateQuad} from '../app/pretraitement/geometry.js';
import {warpPixels} from '../app/pretraitement/pixels.js';

const fixture=JSON.parse(await readFile(new URL('./photos/rangees-perspective.annotations.json',import.meta.url),'utf8'));
function facades(scene){
  return scene.rows.flatMap((row,rowIndex)=>{
    const transform=homography(row.points,row.width,row.height);
    return row.cuts.slice(0,-1).map((left,index)=>{
      const right=row.cuts[index+1];
      return {id:`${rowIndex}-${index}`,points:[[left,0],[right,0],[right,row.height],[left,row.height]].map(([x,y])=>mapPoint(transform,x,y)),confidence:.9,niveau:'geometrie'};
    });
  });
}

for(const scene of fixture.scenes)test(`Groupement et orientation : ${scene.nom}`,()=>{
  const source=facades(scene),snapshot=structuredClone(source),result=groupFacadeRows(source,{width:scene.width,height:scene.height});
  assert.equal(result.rows.length,scene.rows.length);
  assert.deepEqual(source,snapshot,'Les quads source ne doivent pas changer.');
  for(let index=0;index<result.rows.length;index++){
    const actual=result.rows[index],expected=scene.rows[index];
    assert.equal(actual.niveau,'geometrie');assert.equal(actual.confidence,.9);
    assert.equal(validateQuad(actual.points,scene.width,scene.height),true);
    assert.equal(actual.facades.length,expected.cuts.length-1);
    assert.deepEqual(actual.facadeIds,expected.cuts.slice(0,-1).map((_,i)=>`${index}-${i}`));
    actual.points.forEach((point,i)=>assert.ok(Math.hypot(point.x-expected.points[i].x,point.y-expected.points[i].y)<1e-6,JSON.stringify(actual.points)));
    for(const facade of actual.facades)assert.deepEqual(facade.points,snapshot.find(item=>item.id===facade.id).points);
    assert.deepEqual(actual.rectifiedSize,rectifiedSize(actual.points));
    assert.ok(Math.abs(actual.orientation)>0);
    assert.equal(Object.hasOwn(actual,'modules'),false,'Une orientation ne donne aucune dimension en modules.');
  }
});

test('Les façades de hauteurs différentes sont entièrement conservées',()=>{
  const points=[
    [{x:100,y:100},{x:170,y:100},{x:170,y:320},{x:100,y:320}],
    [{x:170,y:130},{x:270,y:130},{x:270,y:320},{x:170,y:320}],
    [{x:270,y:120},{x:430,y:120},{x:430,y:320},{x:270,y:320}]
  ];
  const {rows}=groupFacadeRows(points.map((points,id)=>({id,points,confiance:.88})),{width:600,height:450});
  assert.equal(rows.length,1);assert.equal(rows[0].facades.length,3);assert.equal(rows[0].confidence,.88);
  const q=rows[0].points;
  for(const point of points.flat())for(let index=0;index<4;index++){
    const a=q[index],b=q[(index+1)%4];
    assert.ok((b.x-a.x)*(point.y-a.y)-(b.y-a.y)*(point.x-a.x)>=-1e-6,'Une façade sort de l’enveloppe.');
  }
});

test('Des façades éloignées ou d’orientations incompatibles ne sont pas réunies',()=>{
  const a={points:[{x:50,y:50},{x:100,y:50},{x:100,y:230},{x:50,y:230}],confidence:.9};
  const b={points:[{x:700,y:50},{x:750,y:50},{x:750,y:230},{x:700,y:230}],confidence:.9};
  const c={points:[{x:145,y:50},{x:210,y:75},{x:145,y:245},{x:80,y:220}],confidence:.9};
  assert.equal(groupFacadeRows([a,b],{width:900,height:350}).rows.length,2);
  assert.equal(groupFacadeRows([a,c],{width:900,height:350}).rows.length,2);
});

test('Façades invalides, faible score et absence de score ne deviennent pas confiantes',()=>{
  const points=[{x:10,y:10},{x:70,y:10},{x:70,y:200},{x:10,y:200}];
  assert.equal(groupFacadeRows(null,{width:400,height:300}).rows.length,0);
  const result=groupFacadeRows([{points:[...points].reverse(),confidence:1},{points,confidence:.3}],{width:400,height:300});
  assert.equal(result.rows.length,1);assert.equal(result.rows[0].confidence,.3);assert.equal(result.warnings.length,1);
  assert.equal(groupFacadeRows([{points}],{width:400,height:300}).rows[0].confidence,0);
  assert.equal(groupFacadeRows([{points:[{x:-1,y:10},...points.slice(1)]}],{width:400,height:300}).rows.length,0);
});

test('Le redressement d’une petite façade garde la pleine résolution et sa couleur',()=>{
  const scene=fixture.scenes[0],source={width:scene.width,height:scene.height,data:new Uint8ClampedArray(scene.width*scene.height*4)};
  for(let index=0;index<source.data.length;index+=4)source.data.set([240,240,240,255],index);
  const points=scene.rows[0].points;
  // Un aplat à l'intérieur du quad permet de contrôler que le redressement
  // utilise réellement les pixels de cette petite façade au lieu du coffret.
  for(let y=390;y<650;y++)for(let x=0;x<source.width;x++){
    const inside=points.every((a,index)=>{const b=points[(index+1)%4];return(b.x-a.x)*(y-a.y)-(b.y-a.y)*(x-a.x)>=0;});
    if(inside)source.data.set([23,91,164,255],(y*source.width+x)*4);
  }
  const before=source.data.slice(),row=groupFacadeRows(facades(scene),{width:scene.width,height:scene.height}).rows[0],output=warpPixels(source,row.points);
  assert.equal(output.width,76);assert.equal(output.height,271);
  const center=(Math.floor(output.height/2)*output.width+Math.floor(output.width/2))*4;
  assert.deepEqual([...output.data.slice(center,center+4)],[23,91,164,255]);
  assert.deepEqual(source.data,before,'Le redressement doit conserver l’original.');
});

test('Projection d’une rangée trapézoïdale : proportions 1, 2 et 2,5 conservées',()=>{
  const scene=fixture.scenes.find(scene=>scene.relativeWidths);
  const row=groupFacadeRows(facades(scene),scene).rows[0],snapshot=structuredClone(row),projection=measureRectifiedFacades(row);
  assert.deepEqual(row,snapshot,'La mesure ne modifie aucune coordonnée source.');
  assert.equal(projection.width,row.rectifiedSize.width);assert.equal(projection.height,row.rectifiedSize.height);
  const pitch=projection.width/5.5,expectedWidths=scene.relativeWidths;
  projection.facades.forEach((facade,index)=>{
    assert.ok(Math.abs(facade.rectifiedBounds.width/pitch-expectedWidths[index])<1e-8);
    assert.equal(facade.rectifiedBounds.top,0);assert.equal(facade.rectifiedBounds.bottom,projection.height);
    assert.deepEqual(facade.points,snapshot.facades[index].points);
    assert.equal(Object.hasOwn(facade,'modules'),false,'Le pas de cet essai reste externe au module de projection.');
  });
  for(let i=0;i<projection.facades.length-1;i++)assert.ok(Math.abs(projection.facades[i].rectifiedBounds.right-projection.facades[i+1].rectifiedBounds.left)<1e-8);
});

test('La matrice inverse projette les quatre coins et revient aux coordonnées source',()=>{
  const scene=fixture.scenes[2],row=groupFacadeRows(facades(scene),scene).rows[0],projection=measureRectifiedFacades(row);
  const forward=homography(row.points,projection.width,projection.height),expected=[[0,0],[projection.width,0],[projection.width,projection.height],[0,projection.height]];
  row.points.forEach((point,index)=>{
    const target=mapPoint(projection.transform,point.x,point.y);
    assert.ok(Math.hypot(target.x-expected[index][0],target.y-expected[index][1])<1e-8);
  });
  for(const facade of projection.facades)facade.rectifiedPoints.forEach((point,index)=>{
    const source=mapPoint(forward,point.x,point.y);
    assert.ok(Math.hypot(source.x-facade.points[index].x,source.y-facade.points[index].y)<1e-8);
  });
  assert.throws(()=>measureRectifiedFacades({...row,points:null}),/coins/);
  assert.throws(()=>measureRectifiedFacades({...row,facades:[{points:[{x:NaN,y:1}]}]}),/coins/);
});

test('Le découpage manuel suit les proportions et partage exactement les joints du trapèze',()=>{
  const row={points:[{x:100,y:80},{x:700,y:130},{x:650,y:440},{x:140,y:390}],modules:5.5,cuts:[0,1,3,5.5],calibrationConfirmed:true},before=structuredClone(row),pieces=divideFacadeRow(row);
  assert.deepEqual(pieces.map(piece=>piece.rect.modules),[1,2,2.5]);assert.deepEqual(row,before);
  const measurement=measureRectifiedFacades({points:row.points,facades:pieces});
  pieces.forEach((piece,index)=>{
    assert.equal(validateQuad(piece.points,900,600),true);
    const bounds=measurement.facades[index].rectifiedBounds;
    assert.ok(Math.abs(bounds.width/measurement.width*row.modules-piece.rect.modules)<1e-8);
    assert.ok(piece.rect.x<=Math.min(...piece.points.map(p=>p.x)));assert.ok(piece.rect.width>0&&piece.rect.height>0);
    if(index){assert.deepEqual(piece.points[0],pieces[index-1].points[1]);assert.deepEqual(piece.points[3],pieces[index-1].points[2]);}
  });
  assert.deepEqual(pieces[0].points[0],row.points[0]);assert.deepEqual(pieces[0].points[3],row.points[3]);
  assert.deepEqual(pieces.at(-1).points[1],row.points[1]);assert.deepEqual(pieces.at(-1).points[2],row.points[2]);
});

test('Des coins flottants aux limites ne sont pas déplacés hors du contour source',()=>{
  const row={points:[{x:0,y:0},{x:342.17,y:0},{x:342.17,y:220},{x:0,y:220}],modules:5,cuts:[0,1,3,5],calibrationConfirmed:true};
  const pieces=divideFacadeRow(row);
  for(const piece of pieces){
    assert.equal(validateQuad(piece.points,342.17,220),true);
    assert.equal(piece.points[0].y,0);assert.equal(piece.points[1].y,0);assert.equal(piece.points[2].y,220);assert.equal(piece.points[3].y,220);
  }
  assert.equal(pieces.at(-1).points[1].x,342.17);
  assert.equal(pieces.at(-1).points[2].x,342.17);
  const single=divideFacadeRow({...row,cuts:[0,5]});assert.equal(single.length,1);assert.deepEqual(single[0].points,row.points);
});

test('Un total ou des coupes non confirmés et les coins invalides sont refusés',()=>{
  const row={points:[{x:10,y:10},{x:300,y:10},{x:300,y:220},{x:10,y:220}],modules:5,cuts:[0,1,3,5],calibrationConfirmed:true};
  assert.throws(()=>divideFacadeRow({...row,calibrationConfirmed:false}),/Confirmez/);
  for(const modules of [0,-1,.3,101,NaN])assert.throws(()=>divideFacadeRow({...row,modules}),/modules/);
  for(const cuts of [[1,3,5],[0,1,4],[0,1,1,5],[0,2,1,5],[0,1.2,5]])assert.throws(()=>divideFacadeRow({...row,cuts}),/séparations/);
  assert.throws(()=>divideFacadeRow({...row,points:[row.points[0],row.points[2],row.points[1],row.points[3]]}));
});
