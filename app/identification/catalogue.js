// Extrait embarqué, vérifié le 23/11/2026 dans les fiches officielles Legrand.
// Ces références précises ne définissent pas la largeur de toutes les prises.
// Les URL documentent les valeurs ; ce module ne fait aucun accès réseau.
const products=Object.freeze([
  Object.freeze({reference:'004280',sources:Object.freeze(['https://www.legrand.fr/pro/catalogue/prise-de-courant-modulaire-10a-a-16a-250v-2pt-a-eclips-25-modules'])}),
  Object.freeze({reference:'004283',sources:Object.freeze(['https://www.legrand.fr/pro/catalogue/prise-de-courant-modulaire-10a-a-16a-250v-2pt-a-eclips-et-a-voyant-25-modules'])}),
  Object.freeze({reference:'092782',sources:Object.freeze(['https://www.legrand.fr/catalogue/signalisation-et-prise/prise-de-courant-modulaire-avec-terre-10a-et-16a-25-modules'])})
]);
const confidence=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=100?(value>1?value/100:value):0;
const otherBrand=/\b(?:abb|hager|schneider|siemens|eaton|gewiss|chint|merlin\s+gerin|moeller)\b/i;
const referencePattern=reference=>new RegExp('(?<![\\p{L}\\p{N}])'+reference[0]+'[ \\t]*'+reference.slice(1,4)+'[ \\t]*'+reference.slice(4)+'(?![\\p{L}\\p{N}])','u');

// Correspondance exacte, sans correction des lettres/chiffres ni rapprochement flou.
// La marque explicite est obligatoire même lorsqu'une référence est préfixée « Réf. ».
export function identifyCatalogReference(text,score=0) {
  const trust=confidence(score);
  if(typeof text!=='string'||trust<.8)return null;
  const source=text.normalize('NFKC');
  if(!/\blegrand\b/i.test(source)||otherBrand.test(source))return null;
  const matches=products.filter(product=>referencePattern(product.reference).test(source));
  if(matches.length!==1)return null;
  const product=matches[0],result=valeur=>({valeur,confiance:Math.min(trust,.96),niveau:'ocr_reference'});
  return {
    champs:{famille:result('prise modulaire'),marque:result('Legrand'),reference:result(product.reference),calibre:result('16 A'),poles:result('2P+T')},
    format:{modules:result(2.5),largeurMm:result(45)},
    sources:[...product.sources],
    preuves:['Référence exacte Legrand '+product.reference+' dans le catalogue embarqué.'],
    limites:['Correspondance de référence à confirmer sur la vignette ; le catalogue embarqué est limité à trois produits.']
  };
}
