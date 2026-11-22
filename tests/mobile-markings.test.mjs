import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {identifyMarkings,inferFamily,parseOCR} from '../app/identification/markings.js';
import {parseOCR as parsePC} from '../training/ocr.mjs';

test('Le téléphone et le PC partagent un parseur de marquages sans DOM',()=>{
  assert.equal(parsePC,parseOCR);
  const fields=parseOCR('HAGER\nRéf. MFS716\nC16\nIΔn 0,03 A\nType A\n1P+N',.94);
  for(const [key,value]of Object.entries({marque:'Hager',reference:'MFS716',calibre:'16 A',courbe:'C',sensibilite:'30 mA',classe:'A',poles:'1P+N'}))assert.equal(fields[key].valeur,value,key);
  assert.equal(fields.famille,undefined);
  assert.equal(fields.reference.niveau,'ocr_reference');
  assert.equal(parseOCR('C16',79).calibre.valeur,'inconnu');
  assert.equal(parseOCR('C16',0).calibre.valeur,'inconnu');
});

test('Courbes et calibres lisibles donnent une suggestion provisoire sans modèle',()=>{
  for(const [source,amperes,curve]of [['C16','16 A','C'],['B 10','10 A','B'],['D0,5','0.5 A','D']]){
    const result=identifyMarkings(source,.96);
    assert.equal(result.champs.famille.valeur,'disjoncteur',source);
    assert.equal(result.champs.famille.confiance,.82);
    assert.equal(result.champs.famille.niveau,'regles_ocr');
    assert.equal(result.champs.calibre.valeur,amperes);
    assert.equal(result.champs.courbe.valeur,curve);
    assert.ok(result.limites.some(limit=>limit.includes('fonction différentielle non lue')));
  }
  assert.equal(inferFamily('C16',null,.95).valeur,'disjoncteur');
});

test('Le différentiel reste ambigu sans preuves de sa famille exacte',()=>{
  for(const source of ['40 A 30 mA TEST','30 mA','IΔn 0.03 A TEST','C16 30 mA','IEC 61009-1','C16 TEST','RCD 63 A'])assert.equal(identifyMarkings(source,.98).champs.famille.valeur,'inconnu',source);
  for(const source of ['C16 30 mA TEST','B10 IΔn 0,03 A IEC/EN 61009-1']){
    const family=identifyMarkings(source,.98).champs.famille;
    assert.equal(family.valeur,'disjoncteur différentiel',source);
    assert.equal(family.confiance,.88);
  }
  assert.equal(identifyMarkings('EN 61008-1 40 A 30 mA',.98).champs.famille.valeur,'interrupteur différentiel');
});

test('Les noms explicites identifient la famille et les contradictions restent inconnues',()=>{
  for(const [source,family]of [
    ['Disjoncteur différentiel C16 30 mA','disjoncteur différentiel'],
    ['Interrupteur différentiel sectionneur 40 A 30 mA','interrupteur différentiel'],
    ['RCCB 40 A','interrupteur différentiel'],['RCBO C16','disjoncteur différentiel'],
    ['EN 60898-1 C16','disjoncteur'],['MCB C16','disjoncteur'],
    ['Interrupteur sectionneur 63 A','interrupteur sectionneur'],['CONTACTEUR 25 A','contacteur'],
    ['Télérupteur 16 A','télérupteur'],['PARAFOUDRE','parafoudre'],['PORTE-FUSIBLE','porte-fusible'],
    ['MINUTERIE','minuterie'],['TRANSFORMATEUR 230 V 12 V','transformateur']
  ])assert.equal(identifyMarkings(source,.97).champs.famille.valeur,family,source);
  for(const source of ['RCCB C16 30 mA TEST','EN 61008-1 EN 61009-1','EN 61008-1 C16','Contacteur C16','Disjoncteur différentiel EN 61008-1','Disjoncteur différentiel et interrupteur différentiel','C16 B10','C16 20 A'])assert.equal(identifyMarkings(source,.97).champs.famille.valeur,'inconnu',source);
});

test('La classe B et les références étiquetées ne deviennent pas une courbe',()=>{
  const b=parseOCR('Type B 40 A 30 mA',.97);
  assert.equal(b.classe.valeur,'B');assert.equal(b.calibre.valeur,'40 A');assert.equal(b.courbe.valeur,'inconnu');
  assert.equal(identifyMarkings('RCCB Type B 40 A 30 mA',.97).champs.famille.valeur,'interrupteur différentiel');
  for(const source of ['Réf. C16','Référence C16','Réf. C16\nRéf. B20']){
    const result=identifyMarkings(source,.97);
    assert.equal(result.champs.calibre.valeur,'inconnu',source);
    assert.equal(result.champs.famille.valeur,'inconnu',source);
  }
  assert.equal(identifyMarkings('C16',.79).champs.famille.valeur,'inconnu');
  assert.equal(identifyMarkings(null,1).champs.famille.valeur,'inconnu');
});

test('Les textes du dessin de recette conservent les valeurs et leur ambiguïté',async()=>{
  const svg=await readFile(new URL('photos/ocr-marquages.svg',import.meta.url),'utf8');
  const source=[...svg.matchAll(/<text\b[^>]*>([^<]+)<\/text>/g)].map(match=>match[1]).join('\n');
  const result=identifyMarkings(source,.95);
  assert.equal(result.champs.marque.valeur,'Hager');
  assert.equal(result.champs.calibre.valeur,'16 A');
  assert.equal(result.champs.sensibilite.valeur,'30 mA');
  assert.equal(result.champs.famille.valeur,'inconnu');
  assert.ok(result.preuves.includes('courbe : C'));
});
