import test from 'node:test';
import assert from 'node:assert/strict';
import {parseOCR} from '../training/ocr.mjs';
test('OCR prudent : marquages explicites, pas de famille ni référence inventée',()=>{
  const fields=parseOCR('HAGER\nRéf. MFS716\nC16\nIΔn 0,03 A\nType A\n1P+N',94);
  for(const [key,value]of Object.entries({marque:'Hager',reference:'MFS716',calibre:'16 A',courbe:'C',sensibilite:'30 mA',classe:'A',poles:'1P+N'}))assert.equal(fields[key].valeur,value,key);
  assert.equal(fields.famille,undefined);
  for(const [source,key]of [['C16 20 A','calibre'],['C16 B10','courbe'],['HAGER LEGRAND','marque'],['0,03 A','sensibilite'],['0,03 A','calibre'],['A9F74216','reference'],['type A9F74216','classe'],['Réf. C16','calibre']])assert.equal(parseOCR(source,95)[key].valeur,'inconnu',source);
  assert.equal(parseOCR('C16',79).calibre.valeur,'inconnu');
});
