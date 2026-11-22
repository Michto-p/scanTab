import test from 'node:test';
import assert from 'node:assert/strict';
import {createLabels,validateDevice,invalidateDevice,validateLabels} from '../app/interface/labels.js';
test('Aucune caractéristique inventée et confirmation humaine explicite',()=>{
  const labels=createLabels();assert.ok(Object.values(labels).every(r=>r.valeur==='inconnu'&&r.confiance===0));
  const source={id:'test',labels,rect:{modules:1.5}};
  assert.throws(()=>validateDevice(source,'AA'),/famille identifiable/);
  labels.famille.valeur='disjoncteur';labels.marque.valeur='   ';
  assert.throws(()=>validateDevice(source,''),/initiales/);
  const validated=validateDevice(source,' AA ');
  assert.equal(validated.validatedBy,'AA');assert.ok(Number.isFinite(Date.parse(validated.validatedAt)));
  assert.deepEqual(validated.labels.modules,{valeur:1.5,confiance:1,niveau:'manuel'});
  assert.deepEqual(validated.labels.marque,{valeur:'inconnu',confiance:0,niveau:'manuel'});
  assert.equal(source.validatedAt,undefined);assert.equal(source.labels.modules.valeur,'inconnu');
  const invalid=invalidateDevice(validated);assert.equal(invalid.validatedAt,null);assert.ok(validated.validatedAt);
});
test('Largeur incohérente et confiance invalide refusées',()=>{
  const labels=createLabels();labels.famille.valeur='contacteur';labels.modules.valeur=2;
  assert.throws(()=>validateDevice({labels,rect:{modules:1}},'AA'),/correspondre au découpage/);
  labels.modules.valeur=1.25;assert.equal(validateLabels(labels,{validator:'AA'}).valid,false);
  labels.modules.valeur=1;labels.famille.confiance=NaN;assert.equal(validateLabels(labels,{validator:'AA'}).valid,false);
});
