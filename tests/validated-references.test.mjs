import test from 'node:test';
import assert from 'node:assert/strict';
import {createLabels,validateDevice} from '../app/interface/labels.js';
import {identifyMarkings} from '../app/identification/markings.js';
import {applyKnownReference} from '../app/identification/references-validees.js';
import {applyRecognition,refreshReadingAfterCorrection} from '../app/identification/results.js';

const field=(valeur,confiance=.95,niveau='ocr_caracteristiques')=>({valeur,confiance,niveau});
function source({id='validé-1',reference='MFS716',calibre='16 A',modules=2,family='disjoncteur différentiel',courbe='C',sensibilite='30 mA',classe='A'}={}) {
  const labels=createLabels();
  for(const [key,value] of Object.entries({famille:family,marque:'Hager',reference,calibre,courbe,sensibilite,classe,poles:'1P+N',modules}))labels[key]={valeur:value,confiance:0,niveau:'manuel'};
  return validateDevice({id,rect:{modules},labels},'AA');
}
const reading=(text='HAGER\nRéf. MFS716\nC16',score=.95)=>({...identifyMarkings(text,score),texte:text,confianceOCR:score,moteur:'tesseract-embarque'});

test('Marque et référence exactes rapprochent une validation humaine locale sans valider la nouvelle lecture',()=>{
  const validated=source(),result=reading(),before=structuredClone({validated,result});
  const enriched=applyKnownReference(result,[validated]);
  assert.equal(enriched.champs.famille.valeur,'disjoncteur différentiel');assert.equal(enriched.champs.famille.niveau,'base_validee');
  assert.equal(enriched.champs.sensibilite.valeur,'30 mA');assert.equal(enriched.champs.classe.valeur,'A');
  assert.equal(enriched.champs.calibre.niveau,'ocr_caracteristiques');
  assert.equal(enriched.format.modules.valeur,2);assert.equal(enriched.format.modules.confiance,.95);assert.equal(enriched.format.modules.niveau,'base_validee');
  assert.deepEqual(enriched.baseValidee.sources,[{id:validated.id,validé_par:'AA',date:validated.validatedAt}]);
  assert.ok(enriched.preuves.some(text=>text.includes('validations humaines')));
  const target={rect:{modules:null},detection:{scaleKnown:false},labels:createLabels()};applyRecognition(target,enriched);
  assert.equal(target.labels.modules.valeur,2);assert.equal(target.labels.famille.niveau,'base_validee');assert.ok(!target.validatedAt);
  assert.deepEqual({validated,result},before);
});

test('Une prédiction, une validation périmée ou des champs non humains ne servent jamais de référence',()=>{
  for(const transform of [device=>({...device,validatedAt:null,validatedBy:null}),device=>({...device,validatedAt:'date invalide'}),device=>({...device,validatedBy:' '}),device=>({...device,labels:{...device.labels,calibre:field('16 A',1,'ocr_caracteristiques')}}),device=>({...device,labels:{...device.labels,calibre:field('16 A',0,'manuel')}}),device=>({...device,rect:{modules:1}})]) {
    const result=reading();assert.equal(applyKnownReference(result,[transform(source())]),result);
  }
});

test('La recherche est exacte : casse et espaces de référence admis, aucune correction floue ou marque devinée',()=>{
  const validated=source();
  const spaced=reading();spaced.champs.reference=field('M F S 7 1 6',.91,'ocr_reference');
  assert.equal(applyKnownReference(spaced,[validated]).format.modules.confiance,.91);
  for(const [key,value] of [['reference','MFS7I6'],['reference','MFS-716'],['marque','Legrand'],['marque','inconnu'],['reference','inconnu']]) {
    const result=reading();result.champs[key]=field(value,.95,key==='reference'?'ocr_reference':'ocr_caracteristiques');
    assert.equal(applyKnownReference(result,[validated]),result,key+' '+value);
  }
  const weak=reading();weak.champs.reference.confiance=.79;assert.equal(applyKnownReference(weak,[validated]),weak);
});

test('Des validations contradictoires de même référence sont exclues sans vote ni sélection de la plus récente',()=>{
  const result=reading(),enriched=applyKnownReference(result,[source(),source({id:'validé-2',calibre:'20 A'})]);
  assert.deepEqual(enriched.champs,result.champs);assert.equal(enriched.baseValidee.statut,'conflit');
  assert.ok(enriched.baseValidee.champsEnConflit.includes('calibre'));assert.equal(enriched.champs.famille.niveau,'regles_ocr');
  const width=applyKnownReference(result,[source(),source({id:'validé-2',modules:3})]);assert.ok(width.baseValidee.champsEnConflit.includes('modules'));
});

test('La base ne masque pas les marquages contradictoires ni une autre famille explicite',()=>{
  const validated=source();
  for(const text of ['HAGER Réf. MFS716 B20','HAGER Réf. MFS716 C16 20 A','HAGER Réf. MFS716 CONTACTEUR 16 A']) {
    const result=reading(text),enriched=applyKnownReference(result,[validated]);
    assert.equal(enriched.baseValidee.statut,'conflit',text);assert.deepEqual(enriched.champs,result.champs,text);
  }
  const conflictingFormat=reading();conflictingFormat.format={modules:field(1,.95,'ocr_reference')};
  assert.ok(applyKnownReference(conflictingFormat,[validated]).baseValidee.champsEnConflit.includes('modules'));
});

test('Une validation partiellement inconnue peut être complétée par une autre cohérente, sans gonfler les scores',()=>{
  const incomplete=source({id:'partiel',classe:'inconnu'}),complete=source({id:'complet'});
  const enriched=applyKnownReference(reading(),[incomplete,complete]);
  assert.equal(enriched.champs.classe.valeur,'A');assert.equal(enriched.champs.classe.confiance,.95);assert.equal(enriched.baseValidee.sources.length,2);
});

test('Les propositions de base respectent les corrections humaines et leur largeur est retirée après correction incompatible',()=>{
  const enriched=applyKnownReference(reading(),[source()]);
  const target={rect:{modules:null},detection:{scaleKnown:false},labels:createLabels()};target.labels.famille={valeur:'contacteur',confiance:0,niveau:'manuel'};
  applyRecognition(target,enriched);assert.equal(target.labels.famille.valeur,'contacteur');assert.equal(target.labels.modules.valeur,'inconnu');assert.equal(target.labels.sensibilite.valeur,'inconnu');
  const corrected={rect:{modules:null},detection:{scaleKnown:false},labels:createLabels()};applyRecognition(corrected,enriched);
  corrected.labels.reference={valeur:'AUTRE',confiance:0,niveau:'manuel'};refreshReadingAfterCorrection(corrected);
  assert.equal(corrected.labels.modules.valeur,'inconnu');assert.ok(corrected.recognition.conflits.length);
});
