import test from 'node:test';
import assert from 'node:assert/strict';
import {createLabels,validateDevice} from '../app/interface/labels.js';
import {prepareSelectedCandidates} from '../app/interface/selection-geometrie.js';

function conflict(){
  const labels=createLabels();
  labels.famille={valeur:'disjoncteur',confiance:1,niveau:'manuel'};
  labels.modules={valeur:1,confiance:1,niveau:'manuel'};
  const points=[{x:20,y:40},{x:120,y:40},{x:120,y:340},{x:20,y:340}];
  const source={id:'appareil-confirmé',rect:{x:20,y:40,width:100,height:300,modules:1},quad:points,blob:new Blob(['PNG inchangé']),labels,detection:{scaleKnown:true},validatedAt:'2026-11-26T12:00:00Z',validatedBy:'AB'};
  const candidate={left:20,right:120,top:40,bottom:340,points,modules:2,confiance:.9,scale:{pixelsPerModule:50,confidence:.9,source:'separations-visibles'}};
  return prepareSelectedCandidates([source],[candidate]).devices[0];
}

test('La validation humaine peut conserver sa largeur après une estimation contradictoire sur les mêmes pixels',()=>{
  const device=conflict(),before=structuredClone(device);
  assert.equal(device.detection.manualModulesConflict,true);
  const validated=validateDevice(device,' CD ');
  assert.equal(validated.rect.modules,1);
  assert.deepEqual(validated.labels.modules,{valeur:1,confiance:1,niveau:'manuel'});
  assert.equal(validated.detection.scaleKnown,true);
  assert.equal(Object.hasOwn(validated.detection,'manualModulesConflict'),false);
  assert.equal(Object.hasOwn(validated.detection,'scale'),false,'Le pas calculé pour deux modules ne décrit plus la largeur confirmée.');
  assert.equal(validated.id,device.id);assert.equal(validated.blob,device.blob);
  assert.deepEqual(validated.quad,device.quad);
  assert.equal(validated.validatedBy,'CD');assert.ok(validated.validatedAt);
  assert.deepEqual(device,before,'Une validation ne modifie pas sa source.');
});

test('Accepter la nouvelle largeur résout le conflit et conserve le pas encore cohérent',()=>{
  const device=conflict();
  device.labels.modules={valeur:'2',confiance:0,niveau:'manuel'};
  const validated=validateDevice(device,'CD');
  assert.equal(validated.rect.modules,2);
  assert.equal(validated.labels.modules.valeur,2);
  assert.equal(validated.detection.scaleKnown,true);
  assert.equal(Object.hasOwn(validated.detection,'manualModulesConflict'),false);
  assert.deepEqual(validated.detection.scale,device.detection.scale);
  const invalid=conflict();invalid.labels.modules.valeur='1,25';
  assert.throws(()=>validateDevice(invalid,'CD'),/largeur/i);
  assert.equal(invalid.detection.manualModulesConflict,true);
});
