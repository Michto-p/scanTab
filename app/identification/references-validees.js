import {FIELDS,validateLabels,visibleFieldsForFamily} from '../interface/labels.js';
import {readOCRConflicts} from './markings.js';

const propertyKeys=['famille','calibre','courbe','sensibilite','classe','poles','modules'];
const identity=value=>typeof value==='string'?value.normalize('NFKC').trim().toLocaleLowerCase('fr'):'';
const reference=value=>identity(value).replace(/\s+/g,'');
const unknown=value=>value==null||(typeof value==='string'&&(!identity(value)||identity(value)==='inconnu'));
const known=field=>field&&!unknown(field.valeur)&&typeof field.confiance==='number'&&Number.isFinite(field.confiance)&&field.confiance>=.8&&field.confiance<=1;
const readIdentity=field=>known(field)&&typeof field.valeur==='string'&&field.valeur.length<=200&&['ocr_reference','ocr_caracteristiques'].includes(field.niveau);
const strings=value=>Array.isArray(value)?value.filter(item=>typeof item==='string'):[];
function canonical(key,value){
  if(key==='modules')return String(Number(String(value).replace(',','.')));
  let source=identity(String(value)).replace(/\s+/g,'').replace(',','.');
  if(key==='calibre')source=source.replace(/a$/,'');
  if(key==='sensibilite')source=source.replace(/ma$/,'');
  return source;
}
function humanValidated(device){
  if(typeof device?.id!=='string'||!device.id.trim()||typeof device.validatedAt!=='string'||!Number.isFinite(Date.parse(device.validatedAt))||typeof device.validatedBy!=='string'||!device.validatedBy.trim())return false;
  if(!validateLabels(device.labels,{validator:device.validatedBy}).valid)return false;
  if(!FIELDS.every(({key})=>{const field=device.labels[key];return field.niveau==='manuel'&&field.confiance===(unknown(field.valeur)?0:1);} ))return false;
  if(Number.isFinite(device.rect?.modules)&&Number(device.labels.modules.valeur)!==device.rect.modules)return false;
  return ['marque','reference'].every(key=>typeof device.labels[key].valeur==='string'&&!unknown(device.labels[key].valeur)&&device.labels[key].valeur.length<=200);
}

// Les références identiques ne sont rapprochées qu'après lecture de la marque.
// Les seules sources sont des validations humaines locales complètes. Le résultat
// reste une proposition : ni validation nouvelle, ni apprentissage sur les prédictions.
export function applyKnownReference(result,validatedDevices=[]) {
  if(!result||typeof result!=='object'||!readIdentity(result.champs?.marque)||!readIdentity(result.champs?.reference)||!Array.isArray(validatedDevices))return result;
  const brand=identity(result.champs.marque.valeur),ref=reference(result.champs.reference.valeur);
  const matches=validatedDevices.filter(device=>humanValidated(device)&&identity(device.labels.marque.valeur)===brand&&reference(device.labels.reference.valeur)===ref);
  if(!matches.length)return result;
  const sources=[...new Map(matches.map(device=>[device.id,{id:device.id,validé_par:device.validatedBy.trim(),date:device.validatedAt}])).values()];
  const values={};
  for(const key of propertyKeys){
    const options=new Map();
    for(const device of matches){const value=device.labels[key].valeur;if(!unknown(value))options.set(canonical(key,value),value);}
    values[key]=options;
  }
  const conflict=(message,keys)=>({...result,limites:[...strings(result.limites),message],baseValidee:{statut:'conflit',sources,champsEnConflit:keys}});
  const divergent=propertyKeys.filter(key=>values[key].size>1);
  if(divergent.length)return conflict('Les validations locales de cette marque et référence se contredisent : aucun attribut de la base n’est proposé.',divergent);
  const trust=Math.min(result.champs.marque.confiance,result.champs.reference.confiance,.96);
  const contradictoryMarkings=readOCRConflicts(result.texte,trust);
  if(contradictoryMarkings.length)return conflict('Plusieurs marquages de cette vignette se contredisent : la base locale ne choisit pas une valeur à leur place.',contradictoryMarkings);
  const proposals=Object.fromEntries(propertyKeys.filter(key=>values[key].size===1).map(key=>[key,[...values[key].values()][0]]));
  const incompatible=[];
  const familyFields=new Set(visibleFieldsForFamily(proposals.famille).map(({key})=>key));
  for(const key of propertyKeys){
    const read=result.champs[key];if(!known(read))continue;
    // La suggestion provisoire tirée de C16 n'exclut pas une fonction différentielle.
    const provisionalFamily=key==='famille'&&read.niveau==='regles_ocr'&&read.confiance<=.82;
    if(!provisionalFamily&&proposals[key]!==undefined&&canonical(key,read.valeur)!==canonical(key,proposals[key]))incompatible.push(key);
    else if(['courbe','sensibilite','classe'].includes(key)&&proposals.famille!=='autre'&&!familyFields.has(key))incompatible.push(key);
  }
  if(known(result.format?.modules)&&proposals.modules!==undefined&&canonical('modules',result.format.modules.valeur)!==canonical('modules',proposals.modules))incompatible.push('modules');
  if(incompatible.length)return conflict('La référence validée localement contredit les marquages de cette vignette : vérifier la référence et les limites de l’appareil.',incompatible);
  const field=valeur=>({valeur,confiance:trust,niveau:'base_validee'}),champs={...result.champs};
  for(const key of propertyKeys){
    if(key==='modules'||proposals[key]===undefined)continue;
    if(key==='famille'||!known(champs[key]))champs[key]=field(proposals[key]);
  }
  const modules=Number(String(proposals.modules).replace(',','.'));
  return {...result,champs,
    format:{modules:field(modules),largeurMm:field(modules*18)},
    preuves:[...strings(result.preuves),'Marque et référence exactes retrouvées dans les validations humaines de cet appareil.'],
    limites:[...strings(result.limites),'Attributs issus de validations humaines locales ; cette nouvelle lecture doit être confirmée à son tour.'],
    baseValidee:{statut:'rapprochement',sources,champsProposes:Object.keys(proposals)}
  };
}
