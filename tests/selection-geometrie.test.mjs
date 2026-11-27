import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareSelectedCandidates} from '../app/interface/selection-geometrie.js';

const quad=[{x:10,y:20},{x:110,y:20},{x:110,y:320},{x:10,y:320}];
const field=(valeur,niveau='geometrie',confiance=.85)=>({valeur,niveau,confiance});
function device(overrides={}){
  return {id:'vignette-1',rect:{x:10,y:20,width:100,height:300,modules:null},quad:structuredClone(quad),blob:new Blob(['pixels originaux'],{type:'image/png'}),labels:{modules:field('inconnu'),reference:field('MC116A','manuel',1)},detection:{scaleKnown:false},validatedAt:null,validatedBy:null,...overrides};
}
function candidate(overrides={}){
  return {left:10,right:110,top:20,bottom:320,points:structuredClone(quad),modules:2,confiance:.9,scale:{confidence:1,source:'nombre-confirme'},...overrides};
}

test('Une largeur confirmée après une lecture sans échelle réutilise id et pixels',async()=>{
  const source=device(),selection=candidate(),before=structuredClone({source,selection});
  const result=prepareSelectedCandidates([source],[selection]),updated=result.devices[0];
  assert.deepEqual(result.selectedIds,['vignette-1']);assert.deepEqual(result.crops,[]);
  assert.equal(updated.id,source.id);assert.equal(updated.rect.modules,2);assert.equal(updated.detection.scaleKnown,true);
  assert.deepEqual(updated.labels.modules,field(2,'calibration',.9));
  assert.equal(updated.blob,source.blob,'Le PNG immuable lui-même est réutilisé.');
  assert.equal(await updated.blob.text(),'pixels originaux');assert.deepEqual({source,selection},before);
  assert.equal(source.rect.modules,null);
});

test('Une re-détection sans échelle conserve largeur et validation déjà connues',()=>{
  const source=device({rect:{x:10,y:20,width:100,height:300,modules:2},labels:{modules:field(2,'manuel',1),reference:field('MC116A','manuel',1)},detection:{scaleKnown:true,scale:{confidence:1,source:'nombre-confirme'}},validatedAt:'2026-11-24T12:00:00Z',validatedBy:'AA'});
  const result=prepareSelectedCandidates([source],[candidate({modules:null,scale:null})]);
  assert.deepEqual(result.devices,[source]);assert.equal(result.crops.length,0);assert.deepEqual(result.selectedIds,[source.id]);
});

test('Une nouvelle largeur connue retire la validation et conserve les corrections manuelles',()=>{
  const source=device({rect:{x:10,y:20,width:100,height:300,modules:1},labels:{modules:field('1','manuel',1),reference:field('ma correction','manuel',0)},detection:{scaleKnown:true},validatedAt:'2026-11-24T12:00:00Z',validatedBy:'AA'});
  const before=structuredClone(source),updated=prepareSelectedCandidates([source],[candidate({modules:2})]).devices[0];
  assert.equal(updated.rect.modules,2);assert.equal(updated.validatedAt,null);assert.equal(updated.validatedBy,null);
  assert.deepEqual(updated.labels,source.labels);assert.equal(updated.detection.manualModulesConflict,true);
  assert.deepEqual(source,before);
});

test('Une largeur manuelle laissée inconnue reste intentionnellement vide',()=>{
  const source=device({labels:{modules:field('inconnu','manuel',0)}}),updated=prepareSelectedCandidates([source],[candidate()]).devices[0];
  assert.equal(updated.rect.modules,2);assert.deepEqual(updated.labels.modules,source.labels.modules);
  assert.notEqual(updated.detection.manualModulesConflict,true);
});

test('Même enveloppe et contour différent demandent un remplacement du PNG avec le même id',()=>{
  const source=device({validatedAt:'2026-11-24T12:00:00Z',validatedBy:'AA'}),before=structuredClone(source);
  const tilted=candidate({points:[{x:15,y:20},{x:110,y:27},{x:104,y:320},{x:10,y:310}]});
  const result=prepareSelectedCandidates([source],[tilted]);
  assert.deepEqual(result.selectedIds,[source.id]);assert.equal(result.crops.length,1);
  assert.equal(result.crops[0].replaceDeviceId,source.id);assert.deepEqual(result.crops[0].points,tilted.points);
  assert.deepEqual(result.devices,[source],'La validation et les pixels d’origine attendent le remplacement atomique par l’appelant.');
  assert.deepEqual(source,before);
});

test('Un quad rectangulaire absent et une dérive inférieure à deux pixels sont équivalents',()=>{
  const source=device({quad:null}),near=candidate({points:quad.map(point=>({x:point.x+.7,y:point.y+.7})),left:10.7,right:110.7,top:20.7,bottom:320.7,modules:null});
  assert.deepEqual(prepareSelectedCandidates([source],[near]).selectedIds,[source.id]);
  const noQuad=candidate({points:undefined,modules:null});assert.equal(prepareSelectedCandidates([source],[noQuad]).crops.length,0);
});

test('Une même sélection et un même remplacement ne créent aucun doublon',()=>{
  const source=device(),first=candidate(),copy=structuredClone(first);
  const selected=prepareSelectedCandidates([source],[first,copy,first]);assert.deepEqual(selected.selectedIds,[source.id]);assert.equal(selected.crops.length,0);
  const tilted=candidate({points:[{x:15,y:20},{x:110,y:27},{x:104,y:320},{x:10,y:310}]});
  const replacement=prepareSelectedCandidates([source],[tilted,structuredClone(tilted)]);assert.equal(replacement.crops.length,1);assert.deepEqual(replacement.selectedIds,[source.id]);
  const fresh=prepareSelectedCandidates([],[first,copy]);assert.equal(fresh.crops.length,1);assert.deepEqual(fresh.selectedIds,[]);assert.deepEqual(fresh.devices,[]);
});

test('La liste conserve les anciennes vignettes et ajoute seulement les nouvelles demandes de coupe',()=>{
  const source=device(),newZone=candidate({left:210,right:310,points:quad.map(point=>({...point,x:point.x+200}))});
  const result=prepareSelectedCandidates([source],[newZone]);assert.deepEqual(result.devices,[source]);assert.equal(result.crops.length,1);assert.equal(result.crops[0].replaceDeviceId,undefined);assert.deepEqual(result.selectedIds,[]);
});

test('Une zone invalide ou deux largeurs contradictoires ne sont pas acceptées',()=>{
  const source=device(),before=structuredClone(source);
  assert.throws(()=>prepareSelectedCandidates([source],[candidate({right:9})]),/limites/);
  assert.throws(()=>prepareSelectedCandidates([source],[candidate({modules:1.3})]),/largeur/);
  assert.throws(()=>prepareSelectedCandidates([source],[candidate({modules:1}),candidate({modules:2})]),/contradictoires/);
  assert.deepEqual(source,before);
});
