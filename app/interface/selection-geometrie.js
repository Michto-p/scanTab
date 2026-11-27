const TOLERANCE=2;
const clone=value=>structuredClone(value);
const unknown=value=>value==null||(typeof value==='string'&&(!value.trim()||value.trim().toLocaleLowerCase('fr')==='inconnu'));
const moduleNumber=value=>typeof value==='number'&&Number.isFinite(value)&&value>=.5&&value<=100&&Number.isInteger(value*2)?value:null;
function cloneDevice(device){
  // Les Blobs sont immuables : conserver leur référence évite de recréer les
  // PNG déjà présents pendant une simple réconciliation de métadonnées.
  const {blob,cutoutBlob,...metadata}=device,result=clone(metadata);
  if(Object.hasOwn(device,'blob'))result.blob=blob;
  if(Object.hasOwn(device,'cutoutBlob'))result.cutoutBlob=cutoutBlob;
  return result;
}

function boxOf(value){
  const rect=value?.rect;
  const box=rect?{left:rect.x,right:rect.x+rect.width,top:rect.y,bottom:rect.y+rect.height}:{left:value?.left,right:value?.right,top:value?.top,bottom:value?.bottom};
  return Object.values(box).every(Number.isFinite)&&box.right>box.left&&box.bottom>box.top?box:null;
}
function quadOf(value,box){
  const points=value?.quad??value?.points;
  if(points!=null)return Array.isArray(points)&&points.length===4&&points.every(point=>Number.isFinite(point?.x)&&Number.isFinite(point?.y))?points:null;
  return [{x:box.left,y:box.top},{x:box.right,y:box.top},{x:box.right,y:box.bottom},{x:box.left,y:box.bottom}];
}
const sameBox=(a,b)=>a&&b&&['left','right','top','bottom'].every(key=>Math.abs(a[key]-b[key])<=TOLERANCE);
const sameQuad=(a,b)=>a&&b&&a.every((point,index)=>Math.hypot(point.x-b[index].x,point.y-b[index].y)<=TOLERANCE);
const sameGeometry=(a,b)=>sameBox(a.box,b.box)&&sameQuad(a.quad,b.quad);

function moduleField(candidate,count){
  const scale=candidate.scale,source=scale?.source;
  const levels=[scale?.confidence,candidate.confiance??candidate.confidence].filter(value=>Number.isFinite(value)&&value>=0&&value<=1);
  return {valeur:count,confiance:levels.length?Math.min(...levels):0,niveau:source==='nombre-confirme'||source==='repere-18-mm'?'calibration':'geometrie'};
}
function reconcileWidth(device,candidate){
  const next=moduleNumber(candidate.modules),previous=moduleNumber(device.rect?.modules);
  // Une absence d'échelle dans la nouvelle proposition ne réfute jamais une
  // largeur déjà connue sur les mêmes pixels et le même contour.
  if(next===null)return;
  if(previous===next)return;
  device.rect={...device.rect,modules:next};
  device.detection={...device.detection,scaleKnown:true};
  if(candidate.scale)device.detection.scale=clone(candidate.scale);
  const label=device.labels?.modules;
  if(label?.niveau!=='manuel')device.labels={...device.labels,modules:moduleField(candidate,next)};
  else if(!unknown(label.valeur)){
    const manuallyEntered=typeof label.valeur==='string'?Number(label.valeur.trim().replace(',','.')):label.valeur;
    device.detection.manualModulesConflict=!Number.isFinite(manuallyEntered)||manuallyEntered!==next;
  }
  device.validatedAt=null;device.validatedBy=null;
}

/** Prépare la sélection sans modifier les photos ni les objets d'entrée. */
export function prepareSelectedCandidates(existing,candidates){
  if(!Array.isArray(existing)||!Array.isArray(candidates))throw Error('Les vignettes et les zones sélectionnées doivent être des listes.');
  const devices=existing.map(cloneDevice),selectedIds=[],selected=new Set(),crops=[],cropByTarget=new Map();
  const known=devices.map(device=>{const box=boxOf(device);return {device,box,quad:box?quadOf(device,box):null};});
  const prepared=[];
  for(const candidate of candidates){
    const box=boxOf(candidate),quad=box?quadOf(candidate,box):null;
    if(!box||!quad)throw Error('Une zone sélectionnée a des limites ou des coins invalides.');
    if(candidate.modules!=null&&moduleNumber(candidate.modules)===null)throw Error('Une largeur proposée doit être inconnue ou arrondie au demi-module entre 0,5 et 100.');
    const entry={candidate,box,quad};
    const duplicate=prepared.find(previous=>sameGeometry(previous,entry));
    if(duplicate){
      const oldWidth=moduleNumber(duplicate.candidate.modules),newWidth=moduleNumber(candidate.modules);
      if(oldWidth!==null&&newWidth!==null&&oldWidth!==newWidth)throw Error('La même zone sélectionnée porte deux largeurs contradictoires.');
      if(oldWidth===null&&newWidth!==null)duplicate.candidate=candidate;
      continue;
    }
    prepared.push(entry);
  }
  const select=id=>{if(!selected.has(id)){selected.add(id);selectedIds.push(id);}};
  for(const entry of prepared){
    const exact=known.find(previous=>sameGeometry(previous,entry));
    if(exact){
      if(typeof exact.device.id!=='string'||!exact.device.id)throw Error('Une vignette à réutiliser ne possède pas d’identifiant.');
      reconcileWidth(exact.device,entry.candidate);select(exact.device.id);continue;
    }
    const target=known.find(previous=>sameBox(previous.box,entry.box));
    const crop={...clone(entry.candidate),...entry.box};
    if(target){
      if(typeof target.device.id!=='string'||!target.device.id)throw Error('Une vignette à redresser ne possède pas d’identifiant.');
      crop.replaceDeviceId=target.device.id;select(target.device.id);
      // Plusieurs propositions pour la même cible ne créent jamais deux
      // remplacements concurrents. La dernière proposition précise le contour.
      if(cropByTarget.has(target.device.id)){crops[cropByTarget.get(target.device.id)]=crop;continue;}
      cropByTarget.set(target.device.id,crops.length);
    }
    crops.push(crop);
  }
  return {devices,crops,selectedIds};
}
