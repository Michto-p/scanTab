import test from 'node:test';
import assert from 'node:assert/strict';
import {createLabels,validateDevice} from '../app/interface/labels.js';
import {mergeRecognition} from '../app/identification/results.js';

const field=(valeur,confiance=.95,niveau='ocr_caracteristiques')=>({valeur,confiance,niveau});
const device=()=>({id:'test',labels:createLabels(),rect:{modules:1},validatedAt:null,validatedBy:null});

test('Fusion : les valeurs inconnues reçoivent les propositions et les modules restent intacts',()=>{
  const sample=device();sample.labels.modules={valeur:1,confiance:.85,niveau:'geometrie'};
  const originalModules=sample.labels.modules;
  const count=mergeRecognition(sample,{champs:{famille:field('disjoncteur',.82,'regles_ocr'),calibre:field('16 A'),modules:field('2',1),nonPrevu:field('ignoré')}});
  assert.equal(count,2);assert.equal(sample.labels.famille.valeur,'disjoncteur');assert.equal(sample.labels.calibre.valeur,'16 A');
  assert.equal(sample.labels.modules,originalModules);assert.equal(sample.labels.nonPrevu,undefined);
  assert.equal(sample.validatedAt,null);assert.equal(sample.validatedBy,null);
});

test('Fusion : une suggestion plus forte améliore une proposition automatique sans la valider',()=>{
  const sample=device();sample.labels.famille=field('disjoncteur',.82,'regles_ocr');
  assert.equal(mergeRecognition(sample,{champs:{famille:field('disjoncteur différentiel',.94,'regles_ocr')}}),1);
  assert.deepEqual(sample.labels.famille,field('disjoncteur différentiel',.94,'regles_ocr'));
  for(const alternative of [field('disjoncteur',.82,'regles_ocr'),field('disjoncteur',.94,'classifieur'),field('inconnu',1,'classifieur')])assert.equal(mergeRecognition(sample,{champs:{famille:alternative}}),0);
  assert.equal(sample.labels.famille.valeur,'disjoncteur différentiel');assert.equal(sample.validatedAt,null);
});

test('Fusion : les corrections connues restent prioritaires même avec un score manuel nul',()=>{
  const sample=device();sample.labels.famille=field('contacteur',0,'manuel');sample.labels.calibre=field('25 A',0,'manuel');
  assert.equal(mergeRecognition(sample,{champs:{famille:field('disjoncteur',1,'classifieur'),calibre:field('16 A',1),marque:field('Hager')}}),1);
  assert.deepEqual(sample.labels.famille,field('contacteur',0,'manuel'));assert.deepEqual(sample.labels.calibre,field('25 A',0,'manuel'));
  assert.equal(sample.labels.marque.valeur,'Hager');
});

test('Fusion : aucune modification d’un appareil validé humainement',()=>{
  const sample=device();sample.labels.famille=field('disjoncteur',0,'manuel');
  const validated=validateDevice(sample,'AB'),before=structuredClone(validated);
  assert.equal(mergeRecognition(validated,{champs:{famille:field('disjoncteur différentiel',1,'classifieur'),marque:field('Hager',1)}}),0);
  assert.deepEqual(validated,before);
});

test('Fusion : les valeurs, scores, familles et provenances invalides sont ignorés',()=>{
  for(const invalid of [
    null,field('',.95),field('  ',.95),field('inconnu',1),field(' INCONNU ',1),field('x'.repeat(201),1),
    field(16,.95),field('16 A',NaN),field('16 A',Infinity),field('16 A',-.1),field('16 A',.79),field('16 A',1.01),
    field('16 A',1,'manuel'),field('16 A',1,'geometrie'),field('16 A',1,'non_prevu')
  ]){
    const sample=device();assert.equal(mergeRecognition(sample,{champs:{calibre:invalid}}),0);assert.equal(sample.labels.calibre.valeur,'inconnu');
  }
  assert.equal(mergeRecognition(device(),{champs:{famille:field('famille inventée',1,'classifieur')}}),0);
  assert.equal(mergeRecognition(null,{}),0);assert.equal(mergeRecognition(device(),null),0);
  const sample=device();sample.labels.marque=field('Saisie étrangère',0,'non_prevu');
  assert.equal(mergeRecognition(sample,{champs:{marque:field('Hager',1)}}),0);
});
