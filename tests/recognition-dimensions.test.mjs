import test from 'node:test';
import assert from 'node:assert/strict';
import {applyRecognition,refreshReadingAfterCorrection} from '../app/identification/results.js';
import {reviewRecognitionDimensions} from '../app/identification/formats.js';
import {createLabels} from '../app/interface/labels.js';

const field=valeur=>({valeur,confiance:.95,niveau:'ocr_reference'});
const reading=()=>({champs:{famille:field('prise modulaire'),marque:field('Legrand'),reference:field('004280')},format:{modules:field(2.5),largeurMm:field(45)},texte:'LEGRAND 004280',confianceOCR:.95,sources:['fiche constructeur locale'],limites:[],moteur:'tesseract-embarque'});
const device=()=>({rect:{x:0,y:0,width:250,height:420,modules:null},blob:new Blob(['original']),labels:createLabels(),validatedAt:null,validatedBy:null});

test('Lecture avant calibration : une référence précise propose 2,5 modules sans changer la découpe',()=>{
  const d=device(),blob=d.blob,rect=structuredClone(d.rect);
  applyRecognition(d,reading());
  assert.deepEqual(d.rect,rect);assert.equal(d.blob,blob);
  assert.equal(d.labels.modules.valeur,2.5);assert.equal(d.labels.modules.niveau,'ocr_reference');
  assert.equal(d.labels.famille.valeur,'prise modulaire');assert.equal(d.validatedAt,null);
  assert.equal(d.recognition.confianceOCR,.95);assert.deepEqual(d.recognition.sources,['fiche constructeur locale']);
});

test('Format lu et géométrie en conflit : le bord et la largeur existants restent à corriger',()=>{
  const d=device();d.rect.modules=2;d.labels.modules={valeur:2,confiance:.9,niveau:'geometrie'};
  applyRecognition(d,reading());
  assert.equal(d.labels.modules.valeur,2);assert.equal(d.rect.modules,2);
  const review=reviewRecognitionDimensions(d);assert.equal(review.statut,'a_verifier');assert.ok(review.avertissements[0].includes('2,5'));
});

test('Une largeur ou une référence saisie humainement garde sa priorité',()=>{
  const width=device();width.labels.modules={valeur:'3',confiance:0,niveau:'manuel'};
  applyRecognition(width,reading());assert.equal(width.labels.modules.valeur,'3');
  const reference=device();reference.labels.reference={valeur:'MANUEL-1',confiance:0,niveau:'manuel'};
  applyRecognition(reference,reading());assert.equal(reference.labels.modules.valeur,'inconnu');assert.equal(reference.labels.reference.valeur,'MANUEL-1');
  assert.ok(reference.recognition.limites.some(text=>text.includes('diffère')));
});

test('Une lecture ne touche ni les étiquettes ni les preuves déjà validées',()=>{
  const d=device();d.validatedAt='2026-11-23T10:00:00Z';d.recognition={texte:'lecture confirmée'};
  const before=structuredClone(d);assert.equal(applyRecognition(d,reading()),0);
  assert.deepEqual(d.labels,before.labels);assert.deepEqual(d.recognition,before.recognition);
});

test('Un format de source non prévue ne devient pas une largeur confirmée',()=>{
  for(const niveau of ['manuel','classifieur','invente']){
    const d=device(),result=reading();result.format.modules.niveau=niveau;
    applyRecognition(d,result);assert.equal(d.labels.modules.valeur,'inconnu');assert.equal(d.validatedAt,null);
  }
});

test('Un format de référence ne s’applique pas sous une autre famille ou marque humaine',()=>{
  for(const [key,valeur] of [['famille','contacteur'],['marque','Hager'],['reference','AUTRE']]){
    const d=device();d.labels[key]={valeur,confiance:0,niveau:'manuel'};
    applyRecognition(d,reading());assert.equal(d.labels[key].valeur,valeur);assert.equal(d.labels.modules.valeur,'inconnu');
    assert.ok(d.recognition.conflits.length);assert.equal(d.recognition.format,null);
    assert.equal(reviewRecognitionDimensions(d).statut,'a_verifier');
  }
});

test('Une référence corrigée après lecture retire son ancienne largeur automatique',()=>{
  const d=device();applyRecognition(d,reading());assert.equal(d.labels.modules.valeur,2.5);
  d.labels.reference={valeur:'AUTRE-REFERENCE',confiance:0,niveau:'manuel'};refreshReadingAfterCorrection(d);
  assert.equal(d.labels.modules.valeur,'inconnu');assert.equal(reviewRecognitionDimensions(d).statut,'a_verifier');
  d.labels.modules={valeur:'3',confiance:0,niveau:'manuel'};refreshReadingAfterCorrection(d);assert.equal(d.labels.modules.valeur,'3');
});
