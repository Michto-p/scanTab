import test from 'node:test';
import assert from 'node:assert/strict';
import {changeDeviceFamily,createLabels,FIELDS,incompatibleFieldsForFamily,validateDevice,validateLabels,visibleFieldsForFamily} from '../app/interface/labels.js';
import {applyRecognition} from '../app/identification/results.js';

const field=(valeur,confiance=.95,niveau='ocr_caracteristiques')=>({valeur,confiance,niveau});
const sample=()=>({id:'appareil',rect:{modules:2},blob:new Blob(['original']),labels:{...createLabels(),famille:field('disjoncteur différentiel',.94,'regles_ocr'),calibre:field('16 A'),courbe:field('C'),sensibilite:field('30 mA'),classe:field('A'),modules:field(2,.95,'geometrie')},validatedAt:'2026-11-24T09:00:00Z',validatedBy:'AA'});
const keys=family=>visibleFieldsForFamily(family).map(({key})=>key);

test('Les champs visibles dépendent du type et restent limités quand il est inconnu',()=>{
  assert.deepEqual(keys('inconnu'),['famille','marque','reference','modules']);
  assert.deepEqual(keys('disjoncteur'),['famille','marque','reference','calibre','courbe','poles','modules']);
  assert.deepEqual(keys('interrupteur différentiel'),['famille','marque','reference','calibre','sensibilite','classe','poles','modules']);
  assert.deepEqual(keys('prise modulaire'),['famille','marque','reference','calibre','poles','modules']);
  assert.deepEqual(keys('disjoncteur différentiel'),FIELDS.map(({key})=>key));
  assert.deepEqual(keys('type absent'),keys('inconnu'));assert.deepEqual(keys('toString'),keys('inconnu'));
  const editable=visibleFieldsForFamily('disjoncteur');editable.pop();assert.ok(keys('disjoncteur').includes('modules'));
});

test('Un choix humain de type nettoie seulement les caractéristiques incompatibles et retire la validation',()=>{
  for(const [family,cleared] of [['disjoncteur',['sensibilite','classe']],['interrupteur différentiel',['courbe']],['prise modulaire',['courbe','sensibilite','classe']]]) {
    const device=sample(),before=structuredClone(device),changed=changeDeviceFamily(device,family,{humanChoice:true});
    assert.equal(changed.labels.famille.valeur,family);assert.equal(changed.labels.famille.niveau,'manuel');
    assert.equal(changed.validatedAt,null);assert.equal(changed.validatedBy,null);assert.equal(changed.blob,device.blob);assert.equal(changed.rect,device.rect);
    assert.deepEqual(incompatibleFieldsForFamily(family),cleared);
    for(const key of ['courbe','sensibilite','classe'])assert.equal(changed.labels[key].valeur,cleared.includes(key)?'inconnu':device.labels[key].valeur,key);
    assert.equal(changed.labels.calibre,device.labels.calibre);assert.deepEqual(device,before);
  }
});

test('Un affichage ou une proposition C16 ne supprime jamais une fonction différentielle non relue',()=>{
  const device=sample();device.validatedAt=null;device.validatedBy=null;device.labels.famille=createLabels().famille;
  visibleFieldsForFamily('disjoncteur');
  applyRecognition(device,{champs:{famille:field('disjoncteur',.82,'regles_ocr')},texte:'C16',confianceOCR:.95});
  assert.equal(device.labels.sensibilite.valeur,'30 mA');assert.equal(device.labels.classe.valeur,'A');
  assert.throws(()=>validateDevice(device,'AA'),/incompatible.*Confirmez/);
  assert.equal(validateLabels(device.labels,{validator:'AA'}).valid,false);
  const confirmed=changeDeviceFamily(device,'disjoncteur',{humanChoice:true});
  assert.equal(validateDevice(confirmed,'AA').labels.sensibilite.valeur,'inconnu');
});

test('Aucune suppression technique sans choix humain explicite et inconnu ne signifie pas incompatible',()=>{
  const device=sample(),before=structuredClone(device);
  assert.throws(()=>changeDeviceFamily(device,'disjoncteur'),/choix humain/);
  assert.throws(()=>changeDeviceFamily(device,'inventé',{humanChoice:true}),/non reconnue/);
  for(const family of ['inconnu','autre','disjoncteur différentiel']) {
    const changed=changeDeviceFamily(device,family,{humanChoice:true});
    for(const key of ['courbe','sensibilite','classe'])assert.equal(changed.labels[key],device.labels[key]);
  }
  assert.deepEqual(device,before);
});
