// Le module de 18 mm est l'unité de la grille, pas une règle de classification.
// Une famille ne fixe jamais à elle seule une largeur ni un nombre de pôles.
const unknown=(niveau='geometrie')=>({valeur:'inconnu',confiance:0,niveau});
const confidence=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=100?(value>1?value/100:value):0;
const numeric=value=>typeof value==='number'?value:typeof value==='string'&&value.trim()?Number(value.trim().replace(',','.')):NaN;
const halfModules=value=>Number.isFinite(value)&&value>0&&value<=100&&Number.isInteger(value*2);
const validField=field=>field&&halfModules(numeric(field.valeur))&&typeof field.confiance==='number'&&field.confiance>=.8&&field.confiance<=1&&['ocr_reference','ocr_caracteristiques','base_validee'].includes(field.niveau);
const numberText=value=>String(value).replace('.',',');
const rounded=value=>Math.round(value*2)/2;

// Seules une largeur nommée ou une quantité suivie de « module(s) » sont lues.
// Ni 16 A, ni une hauteur, ni une dimension de conducteur ne deviennent une largeur.
export function readMarkedWidth(text,score=0) {
  const trust=confidence(score),values=new Set(),preuves=[];
  const empty={modules:unknown('ocr_caracteristiques'),largeurMm:unknown('ocr_caracteristiques'),preuves,ambigue:false};
  if(typeof text!=='string'||trust<.8)return empty;
  const source=text.normalize('NFKC').normalize('NFD').replace(/\p{M}/gu,'').replace(/[⁄∕]/g,'/');
  // Ne jamais lire seulement le dénominateur d'une fraction ou le dernier
  // facteur d'une expression : « 1/2 module » vaut 0,5, pas 2 modules.
  let expressionAmbigue=/\d+(?:[.,]\d+)?\s*[x×*]\s*\d+(?:[.,]\d+)?\s*modules?\b/iu.test(source);
  const contextAmbiguous=(match,measure=false)=>{
    const before=source.slice(0,match.index),after=source.slice(match.index+match[0].length);
    const signOrFactor=/[+\-−‐‑‒–—×x*]\s*$/iu.test(before);
    const slash=/\/\s*$/.test(before)&&!/\bmm\s*\/\s*$/iu.test(before);
    const mixedNumber=match[1].includes('/')&&/[0-9.,][ \t]+$/.test(before);
    // « 45 mm / 2,5 modules » décrit deux fois le même format, pas une division.
    const equivalentModule=measure&&/^\s*\/\s*\d+(?:[.,]\d+)?\s*modules?\b/iu.test(after);
    const followingFactor=!equivalentModule&&/^\s*(?:[×*\/]|x(?=\s*\d))\s*[+\-−]?\s*\d/iu.test(after);
    return (!measure&&(signOrFactor||slash||mixedNumber))||followingFactor;
  };
  for(const match of source.matchAll(/(?<![\p{L}\p{N}.,])([0-9]+(?:[.,][0-9]+)?(?:\s*\/\s*[0-9]+(?:[.,][0-9]+)?)?)\s*modules?\b/giu)) {
    const parts=match[1].split('/'),value=parts.length===2?numeric(parts[0])/numeric(parts[1]):numeric(parts[0]);
    if(contextAmbiguous(match)||!halfModules(value)){expressionAmbigue=true;continue;}
    values.add(value);preuves.push('Largeur marquée : '+numberText(value)+' module(s).');
  }
  for(const match of source.matchAll(/\b(?:largeur|width)\s*[:=]?\s*([0-9]+(?:[.,][0-9]+)?)\s*mm(?![\p{L}\p{N}²])/giu)) {
    const width=numeric(match[1]),value=rounded(width/18);
    if(contextAmbiguous(match,true)){expressionAmbigue=true;continue;}
    if(halfModules(value)){values.add(value);preuves.push('Largeur marquée : '+numberText(width)+' mm, soit '+numberText(value)+' module(s) au demi-module.');}
  }
  if(expressionAmbigue||values.size!==1)return {...empty,ambigue:expressionAmbigue||values.size>1};
  const value=[...values][0],result=valeur=>({valeur,confiance:trust,niveau:'ocr_caracteristiques'});
  return {modules:result(value),largeurMm:result(value*18),preuves,ambigue:false};
}

// Rapport pur : aucune correction de découpe, d'étiquette ou de validation.
export function reviewRecognitionDimensions(device) {
  const field=device?.labels?.modules,value=numeric(field?.valeur),rectValue=numeric(device?.rect?.modules);
  const modules=halfModules(value)?{valeur:value,confiance:confidence(field.confiance),niveau:field.niveau||'geometrie'}:
    halfModules(rectValue)?{valeur:rectValue,confiance:0,niveau:'decoupage'}:unknown();
  const largeurMm=typeof modules.valeur==='number'?{...modules,valeur:modules.valeur*18}:unknown(modules.niveau);
  const recognition=device?.recognition,marked=readMarkedWidth(recognition?.texte,recognition?.confianceOCR),catalogue=recognition?.format?.modules;
  const reference=validField(catalogue)?{...catalogue,valeur:numeric(catalogue.valeur)}:null;
  const read=validField(marked.modules)?marked.modules:null,avertissements=[];
  if(Array.isArray(recognition?.conflits))avertissements.push(...recognition.conflits.filter(text=>typeof text==='string'&&text.trim()));
  if(device?.detection?.scaleKnown!==false&&halfModules(value)&&halfModules(rectValue)&&value!==rectValue)avertissements.push('La largeur saisie diffère du découpage calibré. Corriger les limites ou l’échelle avant validation.');
  let largeurLue=reference||read,statut='inconnu';
  if(marked.ambigue)avertissements.push('La largeur écrite est ambiguë : vérifier le marquage et que la vignette contient un seul appareil.');
  if(reference&&read&&reference.valeur!==read.valeur) {
    largeurLue=null;avertissements.push('La largeur marquée et celle de la référence du catalogue se contredisent.');
  }
  if(largeurLue&&typeof modules.valeur==='number') {
    if(modules.valeur!==largeurLue.valeur)avertissements.push('La découpe fait '+numberText(modules.valeur)+' module(s), mais '+numberText(largeurLue.valeur)+' module(s) sont indiqués par '+(['ocr_reference','base_validee'].includes(largeurLue.niveau)?'la référence':'le marquage')+'. Vérifier les limites et l’échelle.');
    else if(modules.confiance>=.8)statut='coherent';
  }
  if(avertissements.length)statut='a_verifier';
  return {modules,largeurMm,largeurLue,statut,avertissements,preuves:marked.preuves};
}
