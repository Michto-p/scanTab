import {FIELDS,FAMILIES} from '../interface/labels.js';

const automaticLevels=new Set(['ocr_reference','ocr_caracteristiques','regles_ocr','classifieur']);
const unknown=value=>value==null||(typeof value==='string'&&(!value.trim()||value.trim().toLocaleLowerCase('fr')==='inconnu'));

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
