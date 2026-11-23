import {identifyCatalogReference} from './catalogue.js';

const KEYS = ['marque','reference','calibre','courbe','sensibilite','classe','poles'];
const unknown = (niveau='ocr_caracteristiques') => ({valeur:'inconnu',confiance:0,niveau});
const confidence = value => typeof value==='number' && Number.isFinite(value) && value>=0 && value<=100 ? (value>1 ? value/100 : value) : 0;
const number = source => Number(source.replace(',','.'));
const referencePattern = /\br[ée]f(?:[ée]rence)?\.?\s*[:#=]?\s*([A-Z0-9][A-Z0-9._/-]{1,39})(?=$|[\s;,:()])/giu;
const markingsOnly = text => text.replace(referencePattern,'');

// Les valeurs connues viennent d'un marquage explicite et non d'une largeur ou d'une couleur.
// Le score global Tesseract constitue un seuil de lecture, pas une probabilité calibrée.
function readOCR(text,score=0) {
  const trust=confidence(score),sets=Object.fromEntries(KEYS.map(key=>[key,new Set()]));
  const finish=()=>({champs:Object.fromEntries(Object.entries(sets).map(([key,values])=>[key,trust>=.8&&values.size===1 ? {valeur:[...values][0],confiance:trust,niveau:key==='reference'?'ocr_reference':'ocr_caracteristiques'} : unknown(key==='reference'?'ocr_reference':'ocr_caracteristiques')])),contradictions:Object.entries(sets).filter(([,values])=>values.size>1).map(([key])=>key)});
  if(typeof text!=='string'||trust<.8)return finish();
  const source=text.normalize('NFKC');
  for(const [brand,re] of [
    ['ABB',/\bABB\b/i],['Hager',/\bHAGER\b/i],['Legrand',/\bLEGRAND\b/i],
    ['Schneider Electric',/\bSCHNEIDER(?:\s+ELECTRIC)?\b/i],['Siemens',/\bSIEMENS\b/i],
    ['Eaton',/\bEATON\b/i],['Gewiss',/\bGEWISS\b/i],['Chint',/\bCHINT\b/i],
    ['Merlin Gerin',/\bMERLIN\s+GERIN\b/i],['Moeller',/\bMOELLER\b/i]
  ])if(re.test(source))sets.marque.add(brand);
  for(const match of source.matchAll(referencePattern))if(/\d/.test(match[1]))sets.reference.add(match[1].replace(/[.]+$/,'').toUpperCase());
  // « Réf. C16 » n'est pas un marquage de courbe et de calibre.
  const markings=markingsOnly(source);
  for(const match of markings.matchAll(/(?<![\p{L}\p{N}.,])(\d+(?:[.,]\d+)?)\s*mA\b/giu)) {
    const value=number(match[1]);if(value>0&&value<=3000)sets.sensibilite.add(value+' mA');
  }
  const residualZones=[];
  for(const match of markings.matchAll(/\bI\s*[Δ∆δ]\s*n\s*[:=]?\s*(\d+(?:[.,]\d+)?)\s*(mA|A)\b/giu)) {
    residualZones.push([match.index,match.index+match[0].length]);
    const value=number(match[1])*(match[2].toLowerCase()==='ma'?1:1000);
    if(value>0&&value<=3000)sets.sensibilite.add(Number(value.toFixed(6))+' mA');
  }
  const curveMarkings=markings.replace(/\b(?:classe(?:\s+diff[ée]rentielle)?|type)\s*[:=]?\s*(?:AC|A|F|B)\b/giu,'');
  for(const match of curveMarkings.matchAll(/\b([BCD])\s*(\d{1,3}(?:[.,]\d+)?)\b/giu)) {
    const value=number(match[2]);if(value>=.5&&value<=1000){sets.courbe.add(match[1].toUpperCase());sets.calibre.add(value+' A');}
  }
  for(const match of markings.matchAll(/\bcourbe\s*[:=]?\s*([BCD])\b/giu))sets.courbe.add(match[1].toUpperCase());
  for(const match of markings.matchAll(/(?<![\p{L}\p{N}.,])(\d+(?:[.,]\d+)?)\s*A\b/giu)) {
    const value=number(match[1]);
    if(value>=.5&&value<=1000&&!residualZones.some(([start,end])=>match.index<end&&match.index+match[0].length>start))sets.calibre.add(value+' A');
  }
  for(const match of markings.matchAll(/\b(?:classe(?:\s+diff[ée]rentielle)?|type)\s*[:=]?\s*(AC|A|F|B)\b/giu))sets.classe.add(match[1].toUpperCase());
  for(const match of markings.matchAll(/\b([1-4])\s*P\s*\+\s*([NT])\b|\b([1-4])\s*P\b/giu))sets.poles.add(match[1]?match[1]+'P+'+match[2].toUpperCase():match[3]+'P');
  return finish();
}

export function parseOCR(text,score=0) { return readOCR(text,score).champs; }

const known = field => field?.valeur!==undefined && field.valeur!=='inconnu' && Number.isFinite(field.confiance) && field.confiance>=.8;
const fold = text => text.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase();
const hasStandard = (text,code) => new RegExp('\\b(?:iec|en|cei)(?:[\\s/]*(?:iec|en|cei))*\\s*'+code+'(?!\\d)','i').test(text);

// Ces règles donnent une suggestion à vérifier. Elles n'utilisent aucun réseau neuronal.
// C16 ne permet pas d'exclure un différentiel dont les autres marquages seraient illisibles.
export function inferFamily(text,champs=null,score=0) {
  const trust=confidence(score),empty=()=>unknown('regles_ocr');
  if(typeof text!=='string'||trust<.8)return empty();
  if(!champs||typeof champs!=='object')champs=parseOCR(text,score);
  const source=fold(markingsOnly(text.normalize('NFKC'))),explicit=new Set();
  const differentialBreaker=/\bdisjoncteurs?\s+differentiels?\b|\brcbo\b/.test(source);
  const differentialSwitch=/\binterrupteurs?\s+differentiels?\b|\brccb\b/.test(source);
  if(differentialBreaker)explicit.add('disjoncteur différentiel');
  if(differentialSwitch)explicit.add('interrupteur différentiel');
  const otherNames=source.replace(/\binterrupteurs?\s+differentiels?(?:\s+sectionneurs?)?\b/g,'');
  // Le courant assigné (16 A, par exemple) et 2P+T ne suffisent pas à nommer une prise.
  // Le nom explicite évite de transformer tout appareil de même largeur en même famille.
  for(const [family,pattern] of [
    ['interrupteur sectionneur',/\b(?:interrupteurs?\s+)?sectionneurs?\b/],
    ['prise modulaire',/\bprises?\s+(?:modulaires?|de\s+courant)\b/],
    ['contacteur',/\bcontacteurs?\b/],['télérupteur',/\btelerupteurs?\b/],
    ['parafoudre',/\bparafoudres?\b/],['porte-fusible',/\bporte[ -]?fusibles?\b/],
    ['minuterie',/\bminuteries?\b/],['transformateur',/\btransformateurs?\b/]
  ])if(pattern.test(otherNames))explicit.add(family);
  const breakerName=/\bdisjoncteurs?\b|\bmcb\b/.test(source.replace(/\bdisjoncteurs?\s+differentiels?\b/g,''));
  if(explicit.size&&breakerName&&!explicit.has('disjoncteur différentiel'))return empty();
  if(explicit.size>1)return empty();
  const curve=known(champs.courbe),rated=known(champs.calibre),residual=known(champs.sensibilite);
  const test=/\btest\b/.test(source),residualWord=/\bdifferentiel(?:le)?s?\b|\brcd\b/.test(source);
  const standardMCB=hasStandard(source,'60898'),standardRCCB=hasStandard(source,'61008'),standardRCBO=hasStandard(source,'61009');
  const curveSource=source.replace(/\b(?:classe(?:\s+differentielle)?|type)\s*[:=]?\s*(?:ac|a|f|b)\b/g,'');
  const shortCurve=[...curveSource.matchAll(/\b([bcd])\s*(\d{1,3}(?:[.,]\d+)?)\b/g)].filter(match=>number(match[2])>=.5&&number(match[2])<=1000);
  // Plusieurs calibres ou courbes suggèrent une lecture contradictoire ou une découpe trop large.
  if(shortCurve.length&&(!curve||!rated))return empty();
  if(standardRCCB&&(standardMCB||standardRCBO||curve))return empty();
  const result=(value,ceiling)=>({valeur:value,confiance:Math.min(trust,ceiling),niveau:'regles_ocr'});
  if(explicit.size) {
    const family=[...explicit][0];
    if(family==='interrupteur différentiel')return curve||standardRCBO||standardMCB?empty():result(family,.94);
    if(family==='disjoncteur différentiel')return standardRCCB?empty():result(family,.94);
    if(curve||residual||standardMCB||standardRCCB||standardRCBO)return empty();
    return result(family,.94);
  }
  if(standardRCCB)return result('interrupteur différentiel',.9);
  if(curve&&rated&&residual&&(test||standardRCBO))return result('disjoncteur différentiel',.88);
  // Une sensibilité et TEST caractérisent une fonction différentielle, pas RCCB plutôt que RCBO.
  if(residual||test||residualWord||standardRCBO)return empty();
  if(standardMCB)return result('disjoncteur',.9);
  if(/\bdisjoncteurs?\b|\bmcb\b/.test(source))return result('disjoncteur',.9);
  if(curve&&rated)return result('disjoncteur',.82);
  return empty();
}

export function identifyMarkings(text,score=0) {
  const reading=readOCR(text,score),champs=reading.champs;
  champs.famille=inferFamily(text,champs,score);
  const preuves=[],catalogue=identifyCatalogReference(text,score),sources=[];
  const limites=['Lecture OCR et règles indicatives : confirmation humaine nécessaire. Les scores ne sont pas des probabilités calibrées.'];
  let format=null;
  if(catalogue) {
    // Une référence trouvée ne masque jamais un autre marquage contradictoire.
    const conflict=Object.entries(catalogue.champs).some(([key,field])=>known(champs[key])&&champs[key].valeur!==field.valeur);
    const otherFamily=typeof text==='string'&&/\b(?:disjoncteurs?|interrupteurs?|contacteurs?|telerupteurs?|parafoudres?|porte[ -]?fusibles?|minuteries?|transformateurs?|rcbo|rccb|mcb)\b/.test(fold(markingsOnly(text.normalize('NFKC'))));
    if(reading.contradictions.length||conflict||otherFamily||known(champs.courbe)||known(champs.sensibilite)) {
      champs.famille=unknown('regles_ocr');
      limites.push('La référence du catalogue et les autres marquages se contredisent : vérifier la lecture et les limites de la vignette.');
    } else {
      for(const [key,field] of Object.entries(catalogue.champs))champs[key]=field;
      format=catalogue.format;sources.push(...catalogue.sources);preuves.push(...catalogue.preuves);limites.push(...catalogue.limites);
    }
  }
  for(const key of ['courbe','calibre','sensibilite','reference'])if(known(champs[key]))preuves.push(key+' : '+champs[key].valeur);
  if(champs.famille.valeur==='disjoncteur'&&champs.famille.confiance<=.82)limites.push('Courbe et calibre lisibles ; une fonction différentielle non lue reste possible.');
  if(champs.famille.valeur==='inconnu')limites.push('Marquages insuffisants ou contradictoires pour proposer une famille.');
  return {champs,preuves,limites,format,sources};
}
