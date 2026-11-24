import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {identifyMarkings,parseOCR,reconcileMarkingReadings} from '../app/identification/markings.js';

function tsv(lines){
  return 'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n'+lines.map((words,line)=>words.map(([text,score],word)=>[5,1,1,1,line+1,word+1,word*80,line*30,70,24,score,text].join('\t')).join('\n')).join('\n');
}

test('Des mots fiables restent lisibles malgré une confiance globale faible',()=>{
  const text='HAGER\nB10\nQF2\n???',evidence=tsv([[['HAGER',96]],[['B10',94]],[['QF2',91]],[['???',12]]]);
  assert.equal(identifyMarkings(text,.42).champs.marque.valeur,'inconnu');
  const result=identifyMarkings(text,.42,{tsv:evidence});
  assert.equal(result.champs.marque.valeur,'Hager');assert.equal(result.champs.calibre.valeur,'10 A');
  assert.equal(result.champs.courbe.valeur,'B');assert.equal(result.champs.famille.valeur,'disjoncteur');
  assert.equal(result.champs.reference.valeur,'inconnu');
  assert.equal(result.champs.calibre.confiance,.91,'Le score conservateur ne dépasse pas le plus faible mot retenu.');
  assert.equal(result.champs.famille.confiance,.82);
});

test('Aucun seuil global ni score de mot n’est abaissé',()=>{
  assert.equal(identifyMarkings('HAGER C16',.79).champs.marque.valeur,'inconnu');
  for(const score of [0,20,79.99]){
    const result=identifyMarkings('HAGER C16',.99,{tsv:tsv([[['HAGER',score]],[['C16',score]]])});
    assert.ok(Object.values(result.champs).every(field=>field.valeur==='inconnu'));
  }
  assert.equal(identifyMarkings('HAGER C16',.1,{tsv:tsv([[['HAGER',80]],[['C16',80]]])}).champs.calibre.confiance,.8);
});

test('Les trous de lecture et les mots de lignes distinctes ne créent pas de marquage',()=>{
  for(const [text,words]of [
    ['C ??? 16',[[['C',95],['???',10],['16',96]]]],
    ['30 ??? mA',[[['30',95],['???',10],['mA',96]]]],
    ['Type ??? B',[[['Type',95],['???',10],['B',96]]]]
  ]){
    const fields=identifyMarkings(text,.4,{tsv:tsv(words)}).champs;
    for(const key of ['calibre','courbe','sensibilite','classe'])assert.equal(fields[key].valeur,'inconnu',text+' '+key);
  }
  const reference=identifyMarkings('HAGER\nMB\n110A\nB10',.5,{tsv:tsv([[['HAGER',96]],[['MB',94]],[['110A',94]],[['B10',95]]])});
  assert.equal(reference.champs.reference.valeur,'inconnu','Une référence n’est pas assemblée entre lignes indépendantes.');
});

test('Une contradiction ou indication différentielle faible ne disparaît pas',()=>{
  const conflict=identifyMarkings('HAGER C16 B10',.55,{tsv:tsv([[['HAGER',96]],[['C16',95]],[['B10',40]]])});
  assert.equal(conflict.champs.marque.valeur,'Hager');assert.equal(conflict.champs.calibre.valeur,'inconnu');assert.equal(conflict.champs.famille.valeur,'inconnu');
  const residual=identifyMarkings('C16 TEST',.5,{tsv:tsv([[['C16',95]],[['TEST',50]]])});
  assert.equal(residual.champs.calibre.valeur,'16 A');assert.equal(residual.champs.famille.valeur,'inconnu');
  const reference=identifyMarkings('Réf. C16',.5,{tsv:tsv([[['Réf.',20],['C16',96]]])});
  assert.equal(reference.champs.reference.valeur,'inconnu');assert.equal(reference.champs.calibre.valeur,'inconnu');assert.equal(reference.champs.courbe.valeur,'inconnu');assert.equal(reference.champs.famille.valeur,'inconnu');
});

test('Références exactes Hager sans préfixe, marque et marquages cohérents obligatoires',()=>{
  for(const [reference,curve,current]of [['MB 110A','B',10],['MB116A','B',16],['MB 125A','B',25],['MC 116A','C',16],['MC316A','C',16]]){
    const result=identifyMarkings(`HAGER\n${reference}\n${curve}${current}`,.96);
    assert.equal(result.champs.reference.valeur,reference.replace(' ',''));
    assert.equal(result.champs.calibre.valeur,current+' A','Le nombre de la référence ne devient pas un calibre.');
    assert.ok(result.sources.some(url=>url.startsWith('https://assets.hager.com/')));
    assert.equal(result.champs.poles.valeur,'inconnu');assert.equal(result.format,null);
  }
  for(const text of ['MB110A B10','HAGER MB110A','HAGER MB110A C16','LEGRAND MB110A B10','HAGER MB110A MB116A B10 B16','HAGER MB199A B99','HAGER MB TOA B10','HAGER QF1 B10','HAGER AD960J C10 30 mA'])assert.equal(identifyMarkings(text,.98).champs.reference.valeur,'inconnu',text);
  assert.equal(identifyMarkings('HAGER SBN140 40A',.96).champs.reference.valeur,'SBN140');
  assert.equal(identifyMarkings('HAGER AD916J B16 IΔn0,03A',.96).champs.reference.valeur,'AD916J');
  assert.equal(identifyMarkings('HAGER AD916J B16',.96).champs.reference.valeur,'inconnu');
});

test('IΔn0,03A est une sensibilité et reste distinct du courant assigné',()=>{
  for(const text of ['C16 IΔn0,03A','C16 I∆n 0.03 A','C16 Iδn=30mA']){
    const fields=parseOCR(text,.95);assert.equal(fields.sensibilite.valeur,'30 mA');assert.equal(fields.calibre.valeur,'16 A');
  }
  assert.equal(parseOCR('0,03A',.99).sensibilite.valeur,'inconnu');
  assert.equal(parseOCR('An 0,03 A',.99).sensibilite.valeur,'inconnu');
});

test('Les mots trop faibles observés sur la vraie photo restent inconnus',async()=>{
  const fixture=JSON.parse(await readFile(new URL('./photos/tableau-hager-portrait-commons.ocr-psm11-observe.json',import.meta.url),'utf8'));
  for(const reading of fixture.results){
    const result=identifyMarkings(reading.texte,reading.confiance,{tsv:reading.tsv});
    for(const key of ['marque','reference','calibre','courbe','sensibilite','famille'])assert.equal(result.champs[key].valeur,'inconnu',reading.fichier+' '+key);
  }
});

test('Un suffixe de référence fragmentée ne devient pas un courant assigné',()=>{
  const result=identifyMarkings('hager sma\nje 116A',.61,{tsv:tsv([[['hager',96],['sma',20]],[['je',35],['116A',87]]])});
  assert.equal(result.champs.marque.valeur,'Hager');assert.equal(result.champs.calibre.valeur,'inconnu');
  assert.equal(result.champs.reference.valeur,'inconnu');assert.equal(result.champs.famille.valeur,'inconnu');
  for(const text of ['116A','je 116A','MC 116A','HAGER MC 116A'])assert.equal(parseOCR(text,.98).calibre.valeur,'inconnu',text);
  assert.equal(parseOCR('In 125A',.98).calibre.valeur,'125 A');
  assert.equal(parseOCR('125 A',.98).calibre.valeur,'125 A');
  assert.equal(parseOCR('C125 125A',.98).calibre.valeur,'125 A');
});

test('Les deux lectures peuvent compléter une marque sans choisir entre valeurs contradictoires',()=>{
  const first={...identifyMarkings('HAGER',.95),texte:'HAGER',confianceOCR:.55};
  const second={...identifyMarkings('HAGER MC116A C16',.98),texte:'HAGER MC116A C16',confianceOCR:.78};
  const result=reconcileMarkingReadings(first,second);
  assert.equal(result.champs.marque.valeur,'Hager');assert.equal(result.champs.reference.valeur,'MC116A');
  assert.equal(result.champs.calibre.valeur,'16 A');assert.equal(result.champs.famille.valeur,'disjoncteur');
  const conflict=reconcileMarkingReadings(second,{...identifyMarkings('HAGER C20',.99),texte:'HAGER C20',confianceOCR:.99});
  assert.equal(conflict.champs.calibre.valeur,'inconnu');assert.equal(conflict.champs.famille.valeur,'inconnu');
  const brands=reconcileMarkingReadings(first,{...identifyMarkings('LEGRAND 004280',.99),texte:'LEGRAND 004280'});
  assert.equal(brands.champs.marque.valeur,'inconnu');assert.equal(brands.champs.reference.valeur,'inconnu');assert.equal(brands.champs.famille.valeur,'inconnu');assert.equal(brands.format,null);
});

test('Un symbole de schéma isolé ne suffit pas à déclarer deux pôles',()=>{
  const lines=[[['HAGER',96]],[['MC116A',95]],[['C16',94]],[['2P',93]]],base=tsv(lines);
  const moveRight=base.split('\n').map(row=>row.endsWith('\t2P')?row.replace(/^(5\t(?:[^\t]*\t){5})[^\t]+\t/,'$1'+'220\t'):row).join('\n');
  const isolated=identifyMarkings('HAGER\nMC116A\nC16\n2P',.6,{tsv:moveRight});
  assert.equal(isolated.champs.calibre.valeur,'16 A');assert.equal(isolated.champs.poles.valeur,'inconnu');
  assert.equal(identifyMarkings('HAGER\nMC116A\nC16\n2P',.6,{tsv:base}).champs.poles.valeur,'2P','Un marquage aligné est corroboré par les autres lignes.');
  assert.equal(identifyMarkings('Pôles 2P',.6,{tsv:tsv([[['Pôles',96],['2P',93]]])}).champs.poles.valeur,'2P');
  assert.equal(identifyMarkings('1P+N',.6,{tsv:tsv([[['1P+N',95]]])}).champs.poles.valeur,'1P+N');
});

test('Le 2P fantôme du schéma de la vraie photo Hager reste inconnu',async()=>{
  const observed=JSON.parse(await readFile(new URL('./photos/ocr-reel-pwa-observe.json',import.meta.url),'utf8'));
  const source=observed.results.find(result=>result.fichier.includes('simple-c16')),readings=source.passagesTesseract.map(reading=>({...identifyMarkings(reading.texte,reading.confiance,{tsv:reading.tsv}),texte:reading.texte,confianceOCR:reading.confiance/100}));
  const result=reconcileMarkingReadings(readings[0],readings[1]);
  assert.equal(result.champs.calibre.valeur,'16 A');assert.equal(result.champs.courbe.valeur,'C');assert.equal(result.champs.poles.valeur,'inconnu');
});
