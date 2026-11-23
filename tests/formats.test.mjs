import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {identifyMarkings,parseOCR} from '../app/identification/markings.js';
import {identifyCatalogReference} from '../app/identification/catalogue.js';
import {readMarkedWidth,reviewRecognitionDimensions} from '../app/identification/formats.js';
import {createLabels,FAMILIES,validateDevice} from '../app/interface/labels.js';

const field=(valeur,confiance=.9,niveau='geometrie')=>({valeur,confiance,niveau});
const device=(modules,famille='inconnu')=>({id:'appareil',rect:{x:20,y:30,width:180,height:320,modules},labels:{...createLabels(),modules:field(modules),famille:field(famille,.94,'regles_ocr')},recognition:{texte:'',confianceOCR:0}});

test('Prise modulaire : le nom explicite et 2P+T sont lus sans déduire une protection de 16 A',()=>{
  for(const name of ['Prise modulaire','PRISE DE COURANT']) {
    const {champs}=identifyMarkings(name+' 16 A 250 V 2P+T',.96);
    assert.equal(champs.famille.valeur,'prise modulaire');
    assert.equal(champs.poles.valeur,'2P+T');assert.equal(champs.calibre.valeur,'16 A');
    assert.equal(champs.courbe.valeur,'inconnu');assert.equal(champs.famille.niveau,'regles_ocr');
  }
  for(const text of ['16 A','2P+T 16 A 250 V','prise RJ45','Prise modulaire C16','Prise modulaire et disjoncteur','Prise de courant 30 mA'])assert.equal(identifyMarkings(text,.96).champs.famille.valeur,'inconnu',text);
  assert.equal(parseOCR('2P + T',.95).poles.valeur,'2P+T');
  assert.equal(parseOCR('2P+T 1P+N',.95).poles.valeur,'inconnu');
  assert.ok(FAMILIES.includes('prise modulaire'));
});

test('Catalogue embarqué : seules trois références exactes accompagnées de la marque sont résolues',()=>{
  for(const reference of ['004280','004283','092782'])for(const printed of [reference,reference[0]+' '+reference.slice(1,4)+' '+reference.slice(4)]) {
    const result=identifyCatalogReference('LEGRAND\n'+printed,.93);
    assert.equal(result.champs.reference.valeur,reference);assert.equal(result.champs.famille.valeur,'prise modulaire');
    assert.deepEqual(result.format.modules,field(2.5,.93,'ocr_reference'));
    assert.deepEqual(result.format.largeurMm,field(45,.93,'ocr_reference'));
    assert.equal(result.champs.calibre.valeur,'16 A');assert.equal(result.champs.poles.valeur,'2P+T');
    assert.ok(result.sources.every(source=>source.startsWith('https://www.legrand.fr/')));
  }
  for(const text of ['004280','HAGER 004280','LEGRAND HAGER 004280','LEGRAND O04280','LEGRAND 04280','LEGRAND X004280','LEGRAND 0042800','LEGRAND 004280 et 004283','LEGRAND 004281'])assert.equal(identifyCatalogReference(text,.95),null,text);
  assert.equal(identifyCatalogReference('LEGRAND 004280',.79),null);
});

test('La cascade référence précède les règles sans masquer une contradiction de marquages',()=>{
  const good=identifyMarkings('LEGRAND\n004280\n16 A\n2P+T',.97);
  assert.equal(good.champs.famille.valeur,'prise modulaire');assert.equal(good.champs.famille.niveau,'ocr_reference');
  assert.equal(good.champs.reference.valeur,'004280');assert.equal(good.format.modules.valeur,2.5);
  assert.equal(good.champs.modules,undefined);
  for(const suffix of ['C16','20 A','16 A 20 A','disjoncteur','contacteur','30 mA','1P+N','Réf. 004281']) {
    const result=identifyMarkings('LEGRAND 004280\n'+suffix,.97);
    assert.equal(result.champs.famille.valeur,'inconnu',suffix);assert.equal(result.format,null,suffix);
    assert.ok(result.limites.some(limit=>limit.includes('se contredisent')),suffix);
  }
});

test('Largeur marquée : 18 mm par module, demi-modules et seuil OCR, sans confondre hauteur ou courant',()=>{
  for(const [text,modules] of [['Largeur 45 mm',2.5],['largeur : 36mm',2],['WIDTH=18 mm',1],['2,5 modules',2.5],['largeur 17,5 mm',1],['largeur 45 mm / 2,5 modules',2.5]]) {
    const result=readMarkedWidth(text,.92);assert.equal(result.modules.valeur,modules,text);
    assert.equal(result.largeurMm.valeur,modules*18);assert.equal(result.modules.niveau,'ocr_caracteristiques');
  }
  for(const text of ['16 A','250 V','Hauteur 45 mm','2,5 mm²','45 mm','Référence 004280','1,25 modules','Largeur 2 mm'])assert.equal(readMarkedWidth(text,.95).modules.valeur,'inconnu',text);
  assert.equal(readMarkedWidth('2,5 modules',.79).modules.valeur,'inconnu');
  assert.equal(readMarkedWidth('largeur 18 mm / 2,5 modules',.95).ambigue,true);
});

test('Fractions explicites : le demi-module est lu sans récupérer un dénominateur ou un facteur',()=>{
  for(const [text,modules] of [['1/2 module',.5],['1 / 2module',.5],['½ module',.5],['3/2 modules',1.5],['5/2 modules',2.5],['Largeur 45 mm / 2,5 modules',2.5]])assert.equal(readMarkedWidth(text,.95).modules.valeur,modules,text);
  for(const text of ['2/3 modules','1/3 module','1/0 module','1//2 modules','/1 module','/ 1 module','-1 module','- 1 module','−1 module','− 1 module','+1 module','1 1/2 modules','2 x1module','2x1 module','2 x 1 module','2×1 module','2 * 1 module','1 module x 2','1 module ×2','largeur-18mm','largeur -18 mm','largeur −18 mm','largeur 18 mm x2'])assert.equal(readMarkedWidth(text,.95).modules.valeur,'inconnu',text);
});

test('La famille ne force jamais la découpe ni les modules et le rapport ne modifie pas les données',()=>{
  for(const family of ['disjoncteur','interrupteur différentiel','prise modulaire','inconnu'])for(const width of [1,2,2.5,4]) {
    const sample=device(width,family),before=structuredClone(sample),report=reviewRecognitionDimensions(sample);
    assert.equal(report.modules.valeur,width);assert.equal(report.largeurMm.valeur,width*18);
    assert.equal(report.largeurLue,null);assert.equal(report.statut,'inconnu');assert.deepEqual(report.avertissements,[]);
    assert.deepEqual(sample,before);
  }
});

test('Le rapport avertit des écarts avec une largeur lue ou référencée, sans recalage automatique',()=>{
  const sample=device(1,'prise modulaire');sample.recognition={texte:'LEGRAND 004280',confianceOCR:.96,...identifyMarkings('LEGRAND 004280',.96)};
  const before=structuredClone(sample),report=reviewRecognitionDimensions(sample);
  assert.equal(report.largeurLue.valeur,2.5);assert.equal(report.statut,'a_verifier');assert.equal(report.avertissements.length,1);
  assert.deepEqual(sample,before);
  sample.labels.modules=field(2.5);sample.rect.modules=2.5;
  assert.equal(reviewRecognitionDimensions(sample).statut,'coherent');
  sample.recognition.texte+=' largeur 18 mm';
  const conflict=reviewRecognitionDimensions(sample);assert.equal(conflict.largeurLue,null);assert.equal(conflict.statut,'a_verifier');
  sample.recognition={texte:'2 modules',confianceOCR:.95};sample.labels.modules=field(2);
  assert.equal(reviewRecognitionDimensions(sample).statut,'a_verifier');
  sample.rect.modules=2;
  assert.equal(reviewRecognitionDimensions(sample).statut,'coherent');
  sample.recognition={texte:'1 module et 2 modules',confianceOCR:.95};assert.equal(reviewRecognitionDimensions(sample).statut,'a_verifier');
});

test('Les conflits humains sont visibles même si les nombres du format coïncident',()=>{
  const sample=device(2.5,'contacteur');
  sample.recognition={texte:'LEGRAND 004280',confianceOCR:.96,...identifyMarkings('LEGRAND 004280',.96),conflits:['La famille lue diffère de votre saisie.',null,'']};
  const before=structuredClone(sample),report=reviewRecognitionDimensions(sample);
  assert.equal(report.statut,'a_verifier');assert.ok(report.avertissements.includes('La famille lue diffère de votre saisie.'));
  assert.deepEqual(sample,before);
});

test('Un appareil découpé sans échelle demande une largeur humaine avant validation',()=>{
  const sample=device(null,'prise modulaire');sample.blob=new Blob(['pixels originaux'],{type:'image/png'});sample.labels.modules=field('inconnu',0,'manuel');
  assert.throws(()=>validateDevice(sample,'AA'),/largeur/i);
  sample.labels.modules=field('2,5',0,'manuel');const before=structuredClone(sample),validated=validateDevice(sample,'AA');
  assert.equal(validated.rect.modules,2.5);assert.equal(validated.labels.modules.valeur,2.5);
  assert.equal(validated.labels.modules.niveau,'manuel');assert.equal(validated.validatedBy,'AA');
  assert.equal(validated.rect.x,20);assert.equal(validated.rect.width,180);assert.equal(validated.blob,sample.blob);
  assert.deepEqual(sample,before);
  const calibrated=device(2,'prise modulaire');calibrated.labels.modules=field(2.5,0,'manuel');
  assert.throws(()=>validateDevice(calibrated,'AA'),/correspondre au découpage/);
  const editable={...validated,detection:{scaleKnown:false},labels:{...validated.labels,modules:field('3',0,'manuel')}};
  const corrected=validateDevice(editable,'BB');assert.equal(corrected.rect.modules,3);assert.equal(corrected.blob,sample.blob);
});

test('Le dessin de lecture existant reste sans largeur inventée',async()=>{
  const svg=await readFile(new URL('photos/ocr-marquages.svg',import.meta.url),'utf8');
  const texte=[...svg.matchAll(/<text\b[^>]*>([^<]+)<\/text>/g)].map(match=>match[1]).join('\n');
  const report=reviewRecognitionDimensions({rect:{modules:null},labels:createLabels(),recognition:{texte,confianceOCR:.95,...identifyMarkings(texte,.95)}});
  assert.equal(report.modules.valeur,'inconnu');assert.equal(report.largeurLue,null);
  assert.equal(report.statut,'inconnu');
});
