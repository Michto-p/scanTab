import {FIELDS,FAMILIES} from '../interface/labels.js';
import {reviewRecognitionDimensions} from './formats.js';

const automaticLevels=new Set(['ocr_reference','ocr_caracteristiques','regles_ocr','classifieur']);
const unknown=value=>value==null||(typeof value==='string'&&(!value.trim()||value.trim().toLocaleLowerCase('fr')==='inconnu'));
function identityConflicts(labels,fields){
  const conflicts=[];
  for(const [key,name] of [['famille','famille'],['marque','marque'],['reference','référence']]){
    const current=labels[key],read=fields?.[key];
    const normalize=value=>String(value).trim().toLocaleLowerCase('fr').replace(/\s+/g,key==='reference'?'':' ');
    if(current?.niveau==='manuel'&&!unknown(current.valeur)&&!unknown(read?.valeur)&&read.confiance>=.8&&normalize(current.valeur)!==normalize(read.valeur))conflicts.push('La '+name+' lue diffère de votre saisie : vérifier l’appareil et la référence avant de proposer son format.');
  }
  return conflicts;
}

// Une proposition peut compléter l'inconnu ou améliorer une proposition automatique.
// Une saisie connue et une validation humaine gardent toujours la priorité.
export function mergeRecognition(device,result) {
  if(!device?.labels||device.validatedAt)return 0;
  let count=0;
  for(const {key} of FIELDS) {
    if(key==='modules')continue;
    const field=result?.champs?.[key],previous=device.labels[key];
    if(!field||typeof field.valeur!=='string'||field.valeur.length>200||unknown(field.valeur)||!Number.isFinite(field.confiance)||field.confiance<.8||field.confiance>1||!automaticLevels.has(field.niveau))continue;
    const value=field.valeur.trim();
    if(key==='famille'&&!FAMILIES.includes(value))continue;
    if(previous&&!unknown(previous.valeur)) {
      if(!automaticLevels.has(previous.niveau)||!Number.isFinite(previous.confiance)||field.confiance<=previous.confiance)continue;
    }
    device.labels[key]={valeur:value,confiance:field.confiance,niveau:field.niveau};
    count++;
  }
  return count;
}

// L'appareil peut être lu avant que son échelle géométrique soit connue.
// Une référence ou une largeur écrite peut alors proposer son format sans
// déplacer les bords ni remplacer une largeur déjà renseignée.
export function applyRecognition(device,result){
  if(!device?.labels||device.validatedAt)return 0;
  const conflicts=identityConflicts(device.labels,result?.champs);
  // Des données de catalogue liées à une identité contradictoire ne complètent
  // pas les champs inconnus sous une autre marque ou une autre famille humaine.
  const usable=conflicts.length&&result?.format?{...result,champs:Object.fromEntries(Object.entries(result.champs??{}).filter(([,field])=>field?.niveau!=='ocr_reference'))}:result;
  let count=mergeRecognition(device,usable);
  device.recognition={texte:result?.texte??'',confianceOCR:result?.confianceOCR??0,identite:result?.champs??{},limites:[...(result?.limites??[]),...conflicts],conflits:conflicts,preuves:result?.preuves??[],moteur:result?.moteur??'inconnu',format:conflicts.length?null:result?.format??null,sources:result?.sources??[]};
  const review=reviewRecognitionDimensions(device);
  if(unknown(device.labels.modules?.valeur)&&review.largeurLue&&!review.avertissements.length){
    device.labels.modules={...review.largeurLue};count++;
  }
  return count;
}

// Une correction d'identité après l'OCR retire les formats automatiques devenus
// incompatibles. Les dimensions géométriques et les saisies humaines restent.
export function refreshReadingAfterCorrection(device){
  const reading=device?.recognition;if(!reading?.identite)return;
  const previous=reading.conflits??[];reading.conflits=identityConflicts(device.labels,reading.identite);
  reading.limites=[...(reading.limites??[]).filter(text=>!previous.includes(text)),...reading.conflits];
  const width=device.labels.modules;
  if(reading.conflits.length&&['ocr_reference','ocr_caracteristiques'].includes(width?.niveau)&&(!Number.isFinite(device.rect?.modules)||device.detection?.scaleKnown===false))device.labels.modules={valeur:'inconnu',confiance:0,niveau:'geometrie'};
}
