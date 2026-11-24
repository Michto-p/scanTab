import {identifyCatalogReference} from './catalogue.js';

const KEYS = ['marque','reference','calibre','courbe','sensibilite','classe','poles'];
const unknown = (niveau='ocr_caracteristiques') => ({valeur:'inconnu',confiance:0,niveau});
const confidence = value => typeof value==='number' && Number.isFinite(value) && value>=0 && value<=100 ? (value>1 ? value/100 : value) : 0;
const number = source => Number(source.replace(',','.'));
const referencePattern = /\br[ée]f(?:[ée]rence)?\.?\s*[:#=]?\s*([A-Z0-9][A-Z0-9._/-]{1,39})(?=$|[\s;,:()])/giu;
// Exemples exacts vérifiés le 24/11/2026 dans les fiches du fabricant.
// Ils autorisent la lecture d'une référence imprimée sans « Réf. », jamais
// l'invention des autres champs à partir d'une famille ou d'une couleur.
const implicitHagerReferences=Object.freeze([
  {reference:'MB110A',pattern:/\bMB[ \t]*110A\b/i,calibre:'10 A',courbe:'B',source:'https://assets.hager.com/step-content/P/PDS_159787330000EN/Document/std.lang.all/PDS_MB110A_0000_en-GB.pdf'},
  {reference:'MB116A',pattern:/\bMB[ \t]*116A\b/i,calibre:'16 A',courbe:'B',source:'https://assets.hager.com/step-content/P/PDS_157376600000EN/Document/std.lang.all/PDS_MB116A_0000_en-GB.pdf'},
  {reference:'MB125A',pattern:/\bMB[ \t]*125A\b/i,calibre:'25 A',courbe:'B',source:'https://assets.hager.com/step-content/P/PDS_160946750000EN/Document/std.lang.all/MB125A_0000_en-GB.pdf'},
  {reference:'MC116A',pattern:/\bMC[ \t]*116A\b/i,calibre:'16 A',courbe:'C',source:'https://assets.hager.com/step-content/P/PDS_158000100000EN/Document/std.lang.all/PDS_MC116A_0000_en-GB.pdf'},
  {reference:'MC316A',pattern:/\bMC[ \t]*316A\b/i,calibre:'16 A',courbe:'C',source:'https://assets.hager.com/step-content/P/PDS_157769650000EN/Document/std.lang.all/PDS_MC316A_0000_en-GB.pdf'},
  {reference:'AD916J',pattern:/\bAD[ \t]*916J\b/i,calibre:'16 A',courbe:'B',sensibilite:'30 mA',source:'https://assets.hager.com/step-content/P/PDS_160150703001EN/Document/std.lang.all/PDS_AD916J_3001_en-GB.pdf'},
  {reference:'SBN140',pattern:/\bSBN[ \t]*140\b/i,calibre:'40 A',source:'https://assets.hager.com/step-content/P/PDS_160823753001EN/Document/std.lang.all/SBN140_3001_en-GB.pdf'}
]);
const markingsOnly = text => text.replace(referencePattern,'').replace(/\b(?:MB|MC|AD|SBN)[ \t]*\d{3}[A-Z]?\b/gi,'');

// TSV Tesseract : les lignes de niveau 5 portent les scores des mots. Un mot
// faible devient un trou explicite ; on ne joint pas « 30 » et « mA » de part
// et d'autre d'un symbole illisible ni des lignes qui n'étaient pas voisines.
function trustedTSV(tsv){
  if(typeof tsv!=='string'||!tsv.trim()||tsv.length>2000000)return null;
  const lines=new Map(),scores=[];let words=0,rejected=0;
  for(const row of tsv.split(/\r?\n/).slice(0,30000)){
    const cells=row.split('\t');if(cells[0]!=='5'||cells.length<12)continue;
    const score=Number(cells[10]),text=cells.slice(11).join(' ').normalize('NFKC').trim();
    if(!text||text.length>200||!Number.isFinite(score)||score<0||score>100)continue;
    const position=cells.slice(1,5).map(Number);if(!position.every(value=>Number.isInteger(value)&&value>=0))continue;
    const key=position.join(':');if(!lines.has(key))lines.set(key,[]);
    const trusted=score>=80,box=cells.slice(6,10).map(Number);
    lines.get(key).push({text:trusted?text:'\uFFFD',trusted,box:box.every(value=>Number.isFinite(value)&&value>=0)?{left:box[0],top:box[1],width:box[2],height:box[3]}:null});words++;
    if(trusted)scores.push(score/100);else rejected++;
  }
  if(!words)return null;
  const detailed=[...lines.values()].map(words=>{
    const boxes=words.filter(word=>word.trusted&&word.box).map(word=>word.box);
    return {text:words.map(word=>word.text).join(' '),left:boxes.length?Math.min(...boxes.map(box=>box.left)):null,height:boxes.length?Math.max(...boxes.map(box=>box.height)):null};
  });
  return {text:detailed.map(line=>line.text).join('\n'),lines:detailed,score:scores.length?Math.min(...scores):0,words,rejected};
}

function polesHaveContext(reading,value){
  if(/^[1-4]P\+[NT]$/.test(value))return true;
  const poleLines=reading.lines.filter(line=>readOCR(line.text,1).champs.poles.valeur===value);
  if(poleLines.some(line=>/\bp[oô]les?\s*[:=]?\s*[1-4]\s*P\b/iu.test(line.text)))return true;
  const anchors=reading.lines.filter(line=>{
    const fields=readOCR(line.text,1).champs;
    return ['marque','calibre','courbe','sensibilite','reference'].some(key=>known(fields[key]))||/\b[A-Z]{1,4}[ \t]*\d{3}[A-Z]?\b/i.test(line.text);
  });
  // Un petit schéma à droite peut être lu « 2P » (borne 2 + symbole).
  // Un symbole nu n'est retenu que dans la colonne du texte principal,
  // corroborée par au moins deux autres lignes de marquages fiables.
  return poleLines.some(line=>Number.isFinite(line.left)&&anchors.filter(anchor=>anchor!==line&&Number.isFinite(anchor.left)&&Math.abs(anchor.left-line.left)<=Math.max(12,Math.max(anchor.height??0,line.height??0)*1.5)).length>=2);
}

// Les valeurs connues viennent d'un marquage explicite et non d'une largeur ou d'une couleur.
// Le seuil de lecture reste à 80 %, pas une probabilité calibrée. Avec TSV,
// le minimum des mots retenus remplace la moyenne globale de la vignette.
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
    // « 116A » est aussi la fin d'une référence dont le préfixe peut être
    // mal lu. Trois chiffres collés à A exigent un contexte de courant ou
    // une courbe concordante ; on ne corrige jamais ce nombre vers 16 A.
    const lineStart=markings.lastIndexOf('\n',match.index)+1,before=markings.slice(lineStart,match.index);
    const currentContext=/\b(?:in|i\s+n|calibre|courant(?:\s+(?:assign[ée]|nominal))?)\s*[:=]?\s*$/iu.test(before);
    if(/^\d{3,}A$/i.test(match[0])&&!currentContext&&!sets.calibre.has(value+' A'))continue;
    if(value>=.5&&value<=1000&&!residualZones.some(([start,end])=>match.index<end&&match.index+match[0].length>start))sets.calibre.add(value+' A');
  }
  if(sets.marque.size===1&&sets.marque.has('Hager'))for(const product of implicitHagerReferences){
    if(!product.pattern.test(source)||sets.calibre.size!==1||!sets.calibre.has(product.calibre))continue;
    if(product.courbe&&(sets.courbe.size!==1||!sets.courbe.has(product.courbe)))continue;
    if(product.sensibilite&&(sets.sensibilite.size!==1||!sets.sensibilite.has(product.sensibilite)))continue;
    if(!product.courbe&&(sets.courbe.size||sets.sensibilite.size))continue;
    sets.reference.add(product.reference);
  }
  for(const match of markings.matchAll(/\b(?:classe(?:\s+diff[ée]rentielle)?|type)\s*[:=]?\s*(AC|A|F|B)\b/giu))sets.classe.add(match[1].toUpperCase());
  for(const match of markings.matchAll(/\b([1-4])\s*P\s*\+\s*([NT])\b|\b([1-4])\s*P\b/giu))sets.poles.add(match[1]?match[1]+'P+'+match[2].toUpperCase():match[3]+'P');
  return finish();
}

export function parseOCR(text,score=0) { return readOCR(text,score).champs; }
export function readOCRConflicts(text,score=0) { return readOCR(text,score).contradictions; }

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

export function identifyMarkings(text,score=0,{tsv}={}) {
  const rawText=text,wordReading=trustedTSV(tsv);
  if(wordReading){text=wordReading.text;score=wordReading.score;}
  const reading=readOCR(text,score),champs=reading.champs;
  const rawReading=wordReading?readOCR(rawText,1):null;
  if(rawReading)for(const key of KEYS)if(known(champs[key])&&!known(rawReading.champs[key])){
    // Un contexte faible reste un contexte : si « Réf. » a disparu du texte
    // filtré, son C16 ne devient pas pour autant un calibre et une courbe.
    champs[key]=unknown(key==='reference'?'ocr_reference':'ocr_caracteristiques');
  }
  if(rawReading)for(const key of rawReading.contradictions){
    champs[key]=unknown(key==='reference'?'ocr_reference':'ocr_caracteristiques');
    if(!reading.contradictions.includes(key))reading.contradictions.push(key);
  }
  if(rawReading?.contradictions.includes('marque')&&implicitHagerReferences.some(product=>product.reference===champs.reference.valeur))champs.reference=unknown('ocr_reference');
  const ambiguousPoles=wordReading&&known(champs.poles)&&!polesHaveContext(wordReading,champs.poles.valeur);
  if(ambiguousPoles)champs.poles=unknown();
  champs.famille=inferFamily(text,champs,score);
  const preuves=[],catalogue=identifyCatalogReference(text,score),sources=[];
  const limites=['Lecture OCR et règles indicatives : confirmation humaine nécessaire. Les scores ne sont pas des probabilités calibrées.'];
  if(ambiguousPoles)limites.push('Le symbole de pôles est isolé des marquages principaux : nombre de pôles inconnu, à confirmer.');
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
  if(wordReading){
    limites.push('Lecture retenue mot par mot au seuil de 80 %. Les mots incertains restent exclus ; les contradictions visibles restent à vérifier.');
    // Une indication différentielle ou un autre type mal lu ne doit pas
    // disparaître pour transformer la proposition en disjoncteur simple.
    const rawCatalog=identifyCatalogReference(rawText,1),rawFamily=rawCatalog?.champs?.famille??inferFamily(rawText,rawReading.champs,1);
    if(known(champs.famille)&&(!known(rawFamily)||rawFamily.valeur!==champs.famille.valeur)){
      champs.famille=unknown('regles_ocr');format=null;
      limites.push('Des mots incertains peuvent changer le type de protection : famille laissée inconnue.');
    }
  }
  const hagerReference=known(champs.marque)&&champs.marque.valeur==='Hager'&&known(champs.reference)?implicitHagerReferences.find(product=>product.reference===champs.reference.valeur):null;
  if(hagerReference){sources.push(hagerReference.source);preuves.push('Référence Hager exacte, sans correction de lettres ni de chiffres.');}
  for(const key of ['courbe','calibre','sensibilite','reference'])if(known(champs[key]))preuves.push(key+' : '+champs[key].valeur);
  if(champs.famille.valeur==='disjoncteur'&&champs.famille.confiance<=.82)limites.push('Courbe et calibre lisibles ; une fonction différentielle non lue reste possible.');
  if(champs.famille.valeur==='inconnu')limites.push('Marquages insuffisants ou contradictoires pour proposer une famille.');
  return {champs,preuves,limites,format,sources};
}

// Deux lectures de la même vignette peuvent se compléter, mais une valeur
// différente ne gagne jamais simplement parce que son score est supérieur.
export function reconcileMarkingReadings(first,second){
  const champs={},conflicts=[];
  for(const key of [...KEYS,'famille']){
    const a=first?.champs?.[key],b=second?.champs?.[key];
    if(known(a)&&known(b)&&a.valeur!==b.valeur){champs[key]=unknown(key==='famille'?'regles_ocr':key==='reference'?'ocr_reference':'ocr_caracteristiques');conflicts.push(key);}
    else champs[key]={...(known(a)&&(!known(b)||a.confiance>b.confiance)?a:b??a??unknown())};
  }
  const texte=[first?.texte,second?.texte].filter(Boolean).join('\n'),raw=readOCR(texte,1);
  for(const key of raw.contradictions){champs[key]=unknown(key==='reference'?'ocr_reference':'ocr_caracteristiques');if(!conflicts.includes(key))conflicts.push(key);}
  if(conflicts.includes('marque'))champs.reference=unknown('ocr_reference');
  if(conflicts.length)champs.famille=unknown('regles_ocr');
  else if(known(champs.famille)){
    const catalogue=identifyCatalogReference(texte,1),family=catalogue?.champs?.famille??inferFamily(texte,raw.champs,1);
    if(!known(family)||family.valeur!==champs.famille.valeur)champs.famille=unknown('regles_ocr');
  }
  const limites=[...new Set([...(first?.limites??[]),...(second?.limites??[]),'Deux lectures locales de la même vignette ; les valeurs contradictoires restent inconnues.'])];
  if(conflicts.length)limites.push('Lectures contradictoires : '+conflicts.join(', ')+'.');
  const sources=known(champs.reference)?[...new Set([...(first?.sources??[]),...(second?.sources??[])])]:[];
  const preuves=['courbe','calibre','sensibilite','reference'].filter(key=>known(champs[key])).map(key=>key+' : '+champs[key].valeur);
  return {...second,champs,texte,preuves,limites,sources,format:known(champs.reference)&&known(champs.famille)?second?.format??first?.format??null:null,confianceOCR:Math.max(first?.confianceOCR??0,second?.confianceOCR??0)};
}
