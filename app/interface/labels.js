export const FAMILIES = Object.freeze(['inconnu','disjoncteur','interrupteur différentiel','disjoncteur différentiel','interrupteur sectionneur','prise modulaire','contacteur','télérupteur','parafoudre','porte-fusible','minuterie','transformateur','autre']);
export const FIELDS = Object.freeze([
  {key:'famille',label:'Famille'},{key:'marque',label:'Marque'},{key:'reference',label:'Référence'},
  {key:'calibre',label:'Calibre (A)'},{key:'courbe',label:'Courbe'},{key:'sensibilite',label:'Sensibilité (mA)'},
  {key:'classe',label:'Classe différentielle'},{key:'poles',label:'Pôles'},{key:'modules',label:'Largeur (modules)'}
]);
export const createLabels = () => Object.fromEntries(FIELDS.map(({key})=>[key,{valeur:'inconnu',confiance:0,niveau:'manuel'}]));
const moduleCount = value => { const n=typeof value==='string'?Number(value.trim().replace(',','.')):value;return Number.isFinite(n)&&n>0&&n<=100&&Number.isInteger(n*2)?n:NaN; };
export function validateLabels(labels,{validator='',modules}={}) {
  const errors=[];
  if(typeof validator!=='string'||!validator.trim())errors.push('Renseignez le nom ou les initiales de la personne qui valide.');
  for(const {key,label} of FIELDS){
    const r=labels?.[key];
    if(!r||!['string','number'].includes(typeof r.valeur)||(typeof r.valeur==='number'&&!Number.isFinite(r.valeur))||!Number.isFinite(r.confiance)||r.confiance<0||r.confiance>1||typeof r.niveau!=='string'||!r.niveau.trim())errors.push(label+' : résultat invalide.');
  }
  if(!FAMILIES.includes(labels?.famille?.valeur)||labels?.famille?.valeur==='inconnu')errors.push('Choisissez une famille identifiable avant de valider. Sinon, laissez cet appareil à vérifier.');
  if(!Number.isFinite(moduleCount(labels?.modules?.valeur==='inconnu'?modules:labels?.modules?.valeur)))errors.push('La largeur doit être positive et arrondie au demi-module.');
  return {valid:errors.length===0,errors};
}
export function invalidateDevice(device) { return {...device,validatedAt:null,validatedBy:null}; }
export function validateDevice(device,validator) {
  const labels={};
  for(const {key} of FIELDS){let value=device.labels?.[key]?.valeur;if(typeof value==='string')value=value.trim();if(value==null||value===''||String(value).toLocaleLowerCase('fr')==='inconnu')value='inconnu';labels[key]={valeur:value,confiance:value==='inconnu'?0:1,niveau:'manuel'};}
  if(labels.modules.valeur==='inconnu')labels.modules.valeur=device.rect?.modules??device.modules;
  labels.modules={valeur:moduleCount(labels.modules.valeur),confiance:1,niveau:'manuel'};
  const check=validateLabels(labels,{validator});
  const editableWidth=device.detection?.scaleKnown===false||!Number.isFinite(device.rect?.modules);
  if(!editableWidth&&labels.modules.valeur!==device.rect.modules)check.errors.push('La largeur validée doit correspondre au découpage. Corrigez la rangée.');
  if(check.errors.length)throw Error(check.errors.join('\n'));
  // Confiance 1 = confirmation humaine, pas une probabilité de reconnaissance.
  // Un appareil isolé peut être découpé avant que son échelle soit connue.
  // Seule cette confirmation humaine renseigne alors sa largeur, sans changer ses pixels.
  const rect=device.rect&&editableWidth?{...device.rect,modules:labels.modules.valeur}:device.rect;
  return {...device,rect,labels,validatedAt:new Date().toISOString(),validatedBy:validator.trim()};
}
