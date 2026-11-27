import {loadPhoto,clarity} from '../capture/photo.js';
import {validateQuad,snapHalfModule,quadsOverlap,mapPoint,homography,rectifiedSize} from '../pretraitement/geometry.js';
import {rectify,rectifyDevice,cropDevice,cutoutDevice,pngBlob} from '../pretraitement/image.js';
import {calculateImage} from '../pretraitement/calcul.js';
import {validateRow,deviceRects} from '../segmentation/rows.js';
import {calibrateRow} from '../segmentation/automatic.js';
import {divideFacadeRow,measureRectifiedFacades} from '../pretraitement/rangees.js';
import {recognizeLocal} from '../identification/local.js';
import {applyRecognition,refreshReadingAfterCorrection} from '../identification/results.js';
import {createLabels,validateDevice,invalidateDevice,changeDeviceFamily} from './labels.js';
import {workspaceMarkup,selectionMarkup,readingMarkup,dimensionsMarkup} from './vue.js';
import {prepareSelectedCandidates} from './selection-geometrie.js';
import {applyKnownReference} from '../identification/references-validees.js';
import {saveSession,loadSession,listSessions,deleteSession,listValidatedDevices} from '../base/store.js';
import {exportBatch} from '../exports/zip.js';

const $=selector=>document.querySelector(selector);
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const levelNames={manuel:'Saisie ou validation',ocr_reference:'Référence lue',ocr_caracteristiques:'Marquage lu',base_validee:'Référence validée sur cet appareil',regles_ocr:'Règle sur les marquages',classifieur:'Modèle de famille',decoupage:'Découpage',geometrie:'Estimation géométrique',calibration:'Repère confirmé'};
const corners=['Haut gauche','Haut droit','Bas droit','Bas gauche'];
const steps=[['capture','Photo'],['perspective','Redresser'],['rows','Découper'],['labels','Valider']];
const uuid=()=>crypto.randomUUID();
const newGroup=()=>`seance-${new Date().toISOString().slice(0,10)}-${uuid().slice(0,8)}`;
function preference(key,value){try{if(value!==undefined)localStorage.setItem('scan-tableau-'+key,value);return localStorage.getItem('scan-tableau-'+key);}catch{return null;}}
let session=null,original=null,corrected=null,step='capture',selected=0,busy=false,drag=null;
let group=preference('seance')||newGroup(),validator=preference('validator')||'';
let saveTimer,saveChain=Promise.resolve(),revision=0,savedRevision=0,thumbnailUrls=[],photosMetadata=[];
let analysisController=null,calibrating=null;
let photoBatch=null;
let automaticAfterPhoto=preference('auto-cadrage')!=='false',showOriginal=false,previewUrl='';
let selectionDrawing=false,editingFamily=false;
let viewBounds=null;

function message(text,error=false){const node=$('#message');node.textContent=text;node.classList.toggle('error',error);}
function fail(error){message(error.name==='QuotaExceededError'?'Stockage plein. Exportez vos appareils validés avant de fermer cette page.':error.message||'Cette opération a échoué.',true);}
async function persist(){
  clearTimeout(saveTimer);
  if(!session)return;
  const snapshot=structuredClone(session),version=revision;
  $('#save-status').textContent='Enregistrement…';
  saveChain=saveChain.catch(()=>{}).then(()=>saveSession(snapshot)).then(()=>{if(session?.id===snapshot.id){savedRevision=Math.max(savedRevision,version);$('#save-status').textContent=savedRevision===revision?'Enregistré sur cet appareil':'Modifications en cours';}});
  try{await saveChain;}catch(error){$('#save-status').textContent='Non enregistré — gardez cette page ouverte';throw error;}
}
function changed(){revision++;$('#save-status').textContent='Modifications en cours';clearTimeout(saveTimer);saveTimer=setTimeout(()=>persist().catch(fail),400);}
async function run(fn){
  if(busy)return;
  busy=true;$('#workspace').setAttribute('aria-busy','true');$('#workspace').inert=true;
  const controls=[...$('#workspace').querySelectorAll('button,input,select')];
  controls.forEach(node=>{node.dataset.wasDisabled=String(node.disabled);node.disabled=true;});
  try{await fn();}catch(error){if(error.name==='AbortError')message(error.message);else fail(error);}finally{busy=false;$('#workspace').inert=false;$('#workspace').removeAttribute('aria-busy');controls.forEach(node=>{node.disabled=node.dataset.wasDisabled==='true';delete node.dataset.wasDisabled;});render();}
}
function releaseCanvases(){for(const canvas of new Set([original,corrected]))if(canvas){canvas.width=0;canvas.height=0;}}
function defaults(width,height){return [{x:0,y:0},{x:width,y:0},{x:width,y:height},{x:0,y:height}];}
function editGeometry(){session.pointsSource='manuel';session.geometryDirty=Boolean(session.rectified);changed();draw();}
function editRows(){
  calibrating=null;
  session.cutsDirty=true;
  if(session.selection?.rowIndex!=null){
    const row=session.rows[session.selection.rowIndex];
    if(row)session.selection={...session.selection,bounds:{x:row.left,y:row.top,width:row.right-row.left,height:row.bottom-row.top},points:row.points??null,modules:row.calibrationConfirmed===false?'':row.modules};
    else session.selection=null;
    session.chosenCandidates=[];
  }
  changed();draw();
}
function widthEditable(device){return device.detection?.manualModulesConflict||device.detection?.scaleKnown===false||!Number.isFinite(device.rect?.modules);}
function containsPoint(point,points,rect){
  if(points?.length===4)return points.every((a,i)=>{const b=points[(i+1)%4];return (b.x-a.x)*(point.y-a.y)-(b.y-a.y)*(point.x-a.x)>=0;});
  return point.x>=rect.x&&point.x<=rect.x+rect.width&&point.y>=rect.y&&point.y<=rect.y+rect.height;
}
function enabled(name){return name==='capture'||(name==='perspective'&&original)||(name==='rows'&&corrected&&!session.geometryDirty)||(name==='labels'&&session?.devices.length&&!session.geometryDirty&&!session.cutsDirty);}
function updateExportButton(){const validated=session&&(session.devices.some(d=>d.validatedAt)||photosMetadata.some(s=>s.id!==session.id&&s.seance===group&&s.validatedCount>0));$('#export').disabled=!validated||session.geometryDirty||session.cutsDirty;}
function updateSummary(){$('#summary').textContent=session?.devices.length?`${session.devices.length} vignettes proposées · ${session.devices.filter(d=>d.validatedAt).length} validées sur cette photo`:session?'Sélectionnez les appareils à lire.':'Photo, sélection, lecture.';}

function draw(){
  const canvas=$('#photo-canvas'),source=step==='perspective'||!corrected?original:corrected;
  $('#empty-photo').hidden=Boolean(source);canvas.hidden=!source;
  if(!source)return;
  viewBounds={x:0,y:0,width:source.width,height:source.height};
  if(step==='rows'&&session.selection?.bounds&&!selectionDrawing&&!$('#manual-rows')?.closest('details')?.open){
    const b=session.selection.bounds,padding=Math.max(8,b.height*.08),x=Math.max(0,b.x-padding),y=Math.max(0,b.y-padding);
    viewBounds={x,y,width:Math.min(source.width,b.x+b.width+padding)-x,height:Math.min(source.height,b.y+b.height+padding)-y};
  }
  const view=viewBounds,scale=Math.min(1,1100/view.width,800/view.height);
  canvas.width=Math.max(1,Math.round(view.width*scale));canvas.height=Math.max(1,Math.round(view.height*scale));
  const ctx=canvas.getContext('2d');ctx.drawImage(source,view.x,view.y,view.width,view.height,0,0,canvas.width,canvas.height);
  const sx=canvas.width/view.width,sy=canvas.height/view.height;ctx.translate(-view.x*sx,-view.y*sy);
  canvas.dataset.view=JSON.stringify(view);
  ctx.lineWidth=2;
  const outline=(points,rect,fill=false)=>{
    const contour=points?.length===4?points:[{x:rect.x,y:rect.y},{x:rect.x+rect.width,y:rect.y},{x:rect.x+rect.width,y:rect.y+rect.height},{x:rect.x,y:rect.y+rect.height}];
    ctx.beginPath();contour.forEach((p,i)=>i?ctx.lineTo(p.x*sx,p.y*sy):ctx.moveTo(p.x*sx,p.y*sy));ctx.closePath();if(fill)ctx.fill();ctx.stroke();
  };
  if(step==='perspective'){
    ctx.beginPath();session.points.forEach((p,i)=>i?ctx.lineTo(p.x*sx,p.y*sy):ctx.moveTo(p.x*sx,p.y*sy));ctx.closePath();ctx.fillStyle='#164f9120';ctx.fill();ctx.strokeStyle=validateQuad(session.points,source.width,source.height)?'#f4b544':'#ed4747';ctx.stroke();
    session.points.forEach((p,i)=>{const x=Math.min(canvas.width-10,Math.max(10,p.x*sx)),y=Math.min(canvas.height-10,Math.max(10,p.y*sy));ctx.beginPath();ctx.arc(x,y,10,0,Math.PI*2);ctx.fillStyle='#164f91';ctx.fill();ctx.strokeStyle='#fff';ctx.stroke();ctx.fillStyle='#fff';ctx.font='bold 12px Arial';ctx.textAlign='center';ctx.fillText(String(i+1),x,y+4);});
  }
  if(step==='rows'&&$('#manual-rows')?.closest('details')?.open)session.rows.forEach((row,i)=>{
    const left=(row.left??0)*sx,right=(row.right??source.width)*sx,top=row.top*sy,bottom=row.bottom*sy;
    ctx.fillStyle='#164f9120';ctx.strokeStyle='#f4b544';outline(row.points,{x:row.left,y:row.top,width:row.right-row.left,height:row.bottom-row.top},true);
    if(row.points&&row.calibrationConfirmed!==false&&validateRow(row,source.width,source.height))divideFacadeRow(row).slice(0,-1).forEach(({points})=>{ctx.beginPath();ctx.moveTo(points[1].x*sx,points[1].y*sy);ctx.lineTo(points[2].x*sx,points[2].y*sy);ctx.stroke();});
    else if(!row.points)row.cuts.slice(1,-1).forEach(cut=>{const x=left+(right-left)*cut/row.modules;ctx.beginPath();ctx.moveTo(x,top);ctx.lineTo(x,bottom);ctx.stroke();});
    ctx.fillStyle='#164f91';ctx.fillRect(left,Math.max(0,top-24),100,24);ctx.fillStyle='#fff';ctx.textAlign='left';ctx.font='14px Arial';ctx.fillText(`Rangée ${i+1}`,left+6,Math.max(18,top-7));
  });
  if(step==='rows'){
    const chosen=new Set(session.chosenCandidates??[]);
    (session.candidates??[]).forEach((candidate,index)=>{
      const x=candidate.left*sx,y=candidate.top*sy,w=(candidate.right-candidate.left)*sx,h=(candidate.bottom-candidate.top)*sy;
      ctx.strokeStyle=chosen.has(index)?'#176caa':'#74858e';ctx.lineWidth=chosen.has(index)?3:1;
      ctx.fillStyle=chosen.has(index)?'#176caa30':'#ffffff08';outline(candidate.points,{x:candidate.left,y:candidate.top,width:candidate.right-candidate.left,height:candidate.bottom-candidate.top},true);
      if(chosen.has(index)){ctx.fillStyle='#176caa';ctx.fillRect(x,y,22,20);ctx.fillStyle='#fff';ctx.font='bold 12px Arial';ctx.textAlign='center';ctx.fillText('✓',x+11,y+14);}
    });
    const bounds=drag?.selection?drag.bounds:session.selection?.bounds;
    if(bounds){ctx.strokeStyle='#c68c18';ctx.lineWidth=3;ctx.setLineDash([7,4]);ctx.strokeRect(bounds.x*sx,bounds.y*sy,bounds.width*sx,bounds.height*sy);ctx.setLineDash([]);}
  }
  if(step==='rows'&&calibrating?.first!=null){
    const row=session.rows[calibrating.row];let a={x:calibrating.first,y:row.top},b={x:calibrating.first,y:row.bottom};
    if(row.points){const plane=measureRectifiedFacades({...row,facades:[]}),p=calibrating.firstPoint,position=mapPoint(plane.transform,p.x,p.y),back=homography(row.points,plane.width,plane.height);a=mapPoint(back,position.x,0);b=mapPoint(back,position.x,plane.height);}
    ctx.strokeStyle='#b62e2e';ctx.beginPath();ctx.moveTo(a.x*sx,a.y*sy);ctx.lineTo(b.x*sx,b.y*sy);ctx.stroke();
  }
  if(step==='labels'&&session.devices[selected]){
    ctx.strokeStyle='#164f91';ctx.lineWidth=1.5;
    for(const device of session.devices)outline(device.quad,device.rect);
    const device=session.devices[selected];ctx.strokeStyle='#f4b544';ctx.lineWidth=4;outline(device.quad,device.rect);
  }
  $('#photo-info').textContent=`${source.width} × ${source.height} px · ${step==='perspective'?'Original':'Image de travail'} · découpes pleine résolution`;
}

function rowPanel(row,i){
  const width=corrected.width,height=corrected.height;
  const slider=(key,label,max)=>`<label>${label}<input type="range" min="0" max="100" step="0.1" value="${(row[key]/max*100).toFixed(1)}" data-row="${i}" data-bound="${key}" aria-label="${label}, rangée ${i+1}"></label>`;
  return `<fieldset class="row-editor"><legend>Rangée ${i+1}</legend><div class="two-col">${slider('top','Haut',height)}${slider('bottom','Bas',height)}${slider('left','Gauche',width)}${slider('right','Droite',width)}</div><label>Nombre de modules (1 module = 18 mm)<input type="number" min="0.5" max="100" step="0.5" value="${row.calibrationConfirmed===false?'':row.modules}" placeholder="À calibrer" data-row="${i}" data-modules></label><label>Séparations intérieures, en modules<input value="${escape(row.cuts.slice(1,-1).join('; '))}" data-row="${i}" data-cuts placeholder="1; 2; 4; 6.5" inputmode="text"></label><p class="hint">${row.calibrationConfirmed===false?'Échelle inconnue.':`Largeur proposée : ${row.modules} modules, soit ${row.modules*18} mm à confirmer.`}</p><button data-action="calibrate-row" data-index="${i}">Repérer un appareil de 18 mm</button><p class="hint">Une séparation tous les 0,5 module est possible. Retirez une séparation pour réunir un appareil large.</p><button data-action="remove-row" data-index="${i}" class="danger">Retirer cette rangée</button></fieldset>`;
}

function dimensionPanel(device){return dimensionsMarkup(device);}
function renderPanel(){
  const panel=$('#tools');panel.hidden=!session;
  if(!session){panel.replaceChildren();return;}
  if(step==='capture'){
    panel.innerHTML='<h2>Photo enregistrée</h2><p class="hint">Cadrez le tableau, puis choisissez les appareils à lire.</p><button class="primary full" data-action="auto-analyze">Cadrer et repérer</button>';
  }else if(step==='perspective'){
    panel.innerHTML=`<h2>Ajuster le cadrage</h2><p class="hint">Déplacez les quatre coins sur la photo.</p><details class="fine-settings"><summary>Positions précises</summary><div class="corner-grid">${session.points.map((p,i)=>`<fieldset><legend>${i+1}. ${corners[i]}</legend><div class="two-col">${['x','y'].map(axis=>`<label>${axis==='x'?'Horizontal':'Vertical'} (%)<input type="number" min="0" max="100" step="0.1" data-point="${i}" data-axis="${axis}" value="${(p[axis]/(axis==='x'?session.width:session.height)*100).toFixed(1)}"></label>`).join('')}</div></fieldset>`).join('')}</div></details><div class="stack"><button class="primary" data-action="auto-analyze">Appliquer et sélectionner</button><button data-action="rectify">Appliquer le cadrage seul</button><button data-action="reset-points">Reprendre toute la photo</button></div>`;
  }else if(step==='rows'){
    panel.innerHTML=selectionMarkup(session,{drawing:selectionDrawing});
    $('#manual-rows').innerHTML=session.rows.map(rowPanel).join('');
    $('#manual-rows').closest('details').addEventListener('toggle',draw);
  }else{
    const device=session.devices[selected];
    if(!device){step='rows';renderPanel();return;}
    panel.innerHTML=readingMarkup(device,{selected,total:session.devices.length,previewUrl,showOriginal,validator,levelNames,widthEditable:widthEditable(device),editingFamily});
  }
}
function renderThumbs(){
  thumbnailUrls.forEach(url=>URL.revokeObjectURL(url));thumbnailUrls=[];previewUrl='';
  const list=$('#thumbnails');list.replaceChildren();list.hidden=step!=='labels';
  if(step!=='labels')return;
  session.devices.forEach((d,i)=>{const url=URL.createObjectURL(d.cutoutBlob||d.blob);thumbnailUrls.push(url);const button=document.createElement('button');button.dataset.device=String(i);button.className='thumbnail'+(i===selected?' selected':'')+(d.validatedAt?' validated':'');button.setAttribute('aria-label',`Appareil ${i+1}, ${d.validatedAt?'validé':'à vérifier'}`);button.setAttribute('aria-pressed',String(i===selected));const img=new Image();img.src=url;img.alt='';button.append(img,document.createTextNode(String(i+1)));list.append(button);});
  const device=session.devices[selected];previewUrl=thumbnailUrls[selected];
  if(showOriginal&&device?.cutoutBlob){previewUrl=URL.createObjectURL(device.blob);thumbnailUrls.push(previewUrl);}
}
function render(){
  $('#steps').innerHTML=steps.map(([name,title],i)=>`<button data-step="${name}" aria-current="${step===name?'step':'false'}" ${enabled(name)?'':'disabled'}><span>${i+1}</span>${title}</button>`).join('');
  updateExportButton();
  updateSummary();
  $('#workspace').dataset.stage=step;$('#workspace').classList.toggle('has-photo',Boolean(session));$('#photo-actions').hidden=!session;
  renderThumbs();renderPanel();draw();
}
async function refreshPhotos(){
  const photos=await listSessions(),select=$('#saved-photos');photosMetadata=photos;select.innerHTML='<option value="">Choisir une photo enregistrée</option>';
  photos.forEach(s=>{const option=document.createElement('option');option.value=s.id;option.textContent=`${s.name}${s.sourceName?` — ${s.sourceName}`:''} · ${s.validatedCount}/${s.deviceCount} validés · ${new Date(s.createdAt).toLocaleDateString('fr-FR')}`;select.append(option);});
  if(session)select.value=session.id;
  return photos;
}
function updatePhotoBatch(){
  const node=$('#batch-status');
  if(!node)return;
  node.hidden=!photoBatch;
  if(photoBatch)node.textContent=`Photo ${photoBatch.index}/${photoBatch.total} · ${photoBatch.imported} enregistrée${photoBatch.imported>1?'s':''} sur cet appareil${photoBatch.failed?` · ${photoBatch.failed} à reprendre`:''}`;
}
async function importPhoto(file,{signal}={}){
  if(!file)return;
  checkAnalysis(signal);analysisStage('Lecture de la photo…');
  const photo=await loadPhoto(file);
  checkAnalysis(signal);
  // Ne jamais remplacer une photo dont l'enregistrement a échoué.
  try{if(session)await persist();}catch(error){error.photoStorageFailure=true;throw error;}
  checkAnalysis(signal);
  releaseCanvases();original=photo.canvas;corrected=null;selected=0;showOriginal=false;calibrating=null;selectionDrawing=false;editingFamily=false;step='capture';
  session={id:uuid(),seance:group,name:$('#session-name').value.trim()||'Tableau électrique',createdAt:new Date().toISOString(),original:photo.blob,rectified:null,width:photo.width,height:photo.height,points:defaults(photo.width,photo.height),pointsSource:'original',rows:[],devices:[],quality:clarity(original),geometryDirty:false,cutsDirty:false};
  session.sourceName=(file.name||'Photo').slice(0,200);
  revision=1;savedRevision=0;message(session.quality.warning||'Photo chargée. Vérifiez les marquages, puis cadrez le tableau.');
  try{await persist();await refreshPhotos();}catch(error){error.photoStorageFailure=true;throw error;}
  if(photoBatch){photoBatch.imported++;updatePhotoBatch();}
  render();
  checkAnalysis(signal);
  if(automaticAfterPhoto)await autoAnalyzePhoto();
}
async function importPhotos(files){
  const photos=Array.from(files||[]);if(!photos.length)return;
  if(photos.length===1)return importPhoto(photos[0]);
  const batch={controller:new AbortController(),index:0,total:photos.length,imported:0,failed:0,issues:[]};
  photoBatch=batch;$('#analysis-progress').hidden=false;
  try{
    for(const file of photos){
      checkAnalysis(batch.controller.signal);batch.index++;updatePhotoBatch();
      $('#analysis-meter').removeAttribute('value');
      try{await importPhoto(file,{signal:batch.controller.signal});}
      catch(error){
        if(error.name==='AbortError'){batch.controller.abort();throw error;}
        // Un fichier illisible ou une analyse échouée n'efface pas les autres photos.
        // Un stockage indisponible impose de garder la photo courante ouverte.
        if(error.photoStorageFailure||error.name==='QuotaExceededError'||(session&&revision!==savedRevision))throw error;
        batch.failed++;batch.issues.push(`${file.name||`Photo ${batch.index}`} : ${error.message||'lecture impossible'}`);updatePhotoBatch();
      }
      await new Promise(resolve=>setTimeout(resolve,0));
    }
    checkAnalysis(batch.controller.signal);
    message(`${batch.imported} photos enregistrées dans la même séance, sur cet appareil.${batch.failed?` ${batch.failed} à reprendre : ${batch.issues.slice(0,2).join(' ; ')}.`:' Vérifiez les appareils avant de les valider.'}`,Boolean(batch.failed));
  }catch(error){
    if(error.name==='AbortError')throw new DOMException(`Lot arrêté : ${batch.imported} photo${batch.imported>1?'s':''} enregistrée${batch.imported>1?'s':''} conservée${batch.imported>1?'s':''}. Les photos restantes n’ont pas été importées.`,'AbortError');
    throw error;
  }finally{photoBatch=null;updatePhotoBatch();$('#analysis-progress').hidden=true;}
}
async function openPhoto(){
  const id=$('#saved-photos').value;if(!id)return;
  if(session)await persist();
  const loaded=await loadSession(id);if(!loaded)throw Error('Cette photo n’existe plus sur cet appareil.');
  // Les versions précédentes ne stockaient pas la provenance des coins.
  // Préserver leurs cadrages enregistrés, y compris ceux encore à appliquer.
  loaded.pointsSource??='manuel';
  const photo=await loadPhoto(loaded.original),redressed=loaded.rectified?await loadPhoto(loaded.rectified):null;
  releaseCanvases();calibrating=null;session=loaded;original=photo.canvas;corrected=redressed?.canvas??null;group=session.seance||session.id;selected=0;showOriginal=false;revision=0;savedRevision=0;
  $('#session-name').value=session.name;$('#group-id').value=group;preference('seance',group);
  step=enabled('labels')?'labels':enabled('rows')?'rows':'perspective';$('#save-status').textContent='Enregistré sur cet appareil';message('Photo et validations restaurées.');
}
async function applyPerspective({replaceConfirmed=false,signal}={}){
  if(!validateQuad(session.points,session.width,session.height))throw Error('Les coins sont invalides ou se croisent. Suivez le contour dans l’ordre indiqué.');
  if(session.devices.length&&!replaceConfirmed&&!confirm('Le redressement remplacera les vignettes et leurs étiquettes sur cette photo. Continuer ?'))return;
  analysisStage('Redressement…');checkAnalysis(signal);
  // Un cadrage inchangé ne justifie ni rééchantillonnage ni copie de tous les pixels.
  const full=defaults(original.width,original.height).every((p,i)=>Math.abs(p.x-session.points[i].x)<.01&&Math.abs(p.y-session.points[i].y)<.01);
  const result=full?original:await rectify(original,session.points,{signal,onProgress:progress=>{$('#analysis-meter').value=progress;}}),blob=await pngBlob(result);
  checkAnalysis(signal);
  corrected=result;calibrating=null;session.rectified=blob;session.appliedPoints=structuredClone(session.points);session.rows=[];session.candidates=[];session.chosenCandidates=[];session.selection=null;session.devices=[];session.geometryDirty=false;session.cutsDirty=false;selected=0;showOriginal=false;step='rows';changed();await persist();message('Photo cadrée. Sélectionnez les appareils à lire.');
}
function addRow(){const height=corrected.height;session.rows.push({top:Math.round(height*.2),bottom:Math.round(height*.8),left:0,right:corrected.width,modules:1,cuts:[0,1],calibrationConfirmed:false});editRows();message('Rangée ajoutée : ajustez ses limites puis renseignez son échelle ou repérez un appareil de 18 mm.');}
function layoutSample(source=corrected,maximum=1100){
  const sample=document.createElement('canvas'),scale=Math.min(1,maximum/source.width,maximum/source.height);sample.width=Math.max(1,Math.round(source.width*scale));sample.height=Math.max(1,Math.round(source.height*scale));sample.getContext('2d').drawImage(source,0,0,sample.width,sample.height);
  return {image:sample.getContext('2d').getImageData(0,0,sample.width,sample.height),sx:source.width/sample.width,sy:source.height/sample.height};
}
async function proposeRows({signal}={}){
  if(session.rows.length&&!confirm('Remplacer les rangées et leurs séparations manuelles par une nouvelle proposition ?'))return;
  return detectLayout({signal,legacy:true});
}
async function detectLayout({signal,legacy=false}={}){
  calibrating=null;
  analysisStage('Repérage des appareils et estimation des largeurs…');checkAnalysis(signal);
  const {image,sx,sy}=layoutSample(),result=await calculateImage(legacy?'rangées':'appareils',image,{signal});checkAnalysis(signal);
  const points=value=>value?.map(p=>({x:p.x*sx,y:p.y*sy}));
  const scale=source=>source?{...source,pixelsPerModule:source.pixelsPerModule*sx,pixelsPerMillimeter:source.pixelsPerMillimeter*sx}:null;
  session.rows=result.rows.map(r=>({...r,points:points(r.points),top:r.top*sy,bottom:r.bottom*sy,left:r.left*sx,right:r.right*sx,calibrationConfirmed:r.calibrationConfirmed??true,scale:scale(r.scale)}));
  // Les limites d'une façade suffisent pour la lire ; le pas de 18 mm reste
  // inconnu si aucune répétition ou référence précise ne le démontre.
  const candidates=(result.candidates??[]).filter(c=>c.confiance>=.75).map(c=>({...c,points:points(c.points),left:c.left*sx,right:c.right*sx,top:c.top*sy,bottom:c.bottom*sy,scale:scale(c.scale)}));
  if(!session.rows.length)session.rows=result.bands.map(r=>({...r,top:r.top*sy,bottom:r.bottom*sy,left:0,right:corrected.width,modules:1,cuts:[0,1],calibrationConfirmed:false}));
  session.layoutWarnings=result.warnings;session.candidates=candidates;session.chosenCandidates=[];session.selection=null;changed();draw();
  const unknown=candidates.filter(c=>!Number.isFinite(c.modules)).length;
  message(candidates.length?String(candidates.length)+' zones proposées.'+(unknown?' '+unknown+' restent sans échelle : vérifiez qu’il s’agit bien d’appareils ; leur lecture peut continuer.':' Vérifiez les appareils larges et leurs séparations.'):'Aucun appareil suffisamment délimité. Corrigez le cadrage ou tracez les rangées pour poursuivre.');
  return {rows:session.rows,candidates};
}
function chooseArea(bounds,{modules='',rowIndex=null}={}){
  session.selection={bounds,modules,rowIndex,points:rowIndex===null?null:session.rows[rowIndex]?.points??null};selectionDrawing=false;
  session.chosenCandidates=(session.candidates??[]).flatMap((c,index)=>{const x=(c.left+c.right)/2,y=(c.top+c.bottom)/2;return x>=bounds.x&&x<=bounds.x+bounds.width&&y>=bounds.y&&y<=bounds.y+bounds.height?[index]:[];});
  changed();render();message('Zone choisie. Indiquez sa largeur totale en modules, puis lancez la lecture.');
}
async function previewSelection({signal}={}){
  const area=session.selection;if(!area)return;
  const bounds=area.bounds,total=area.modules===''?null:Number(String(area.modules).replace(',','.'));
  // Extraire la zone AVANT de réduire l'aperçu : un appareil petit dans une
  // grande photo doit garder ses joints pour le calcul, et tous ses pixels
  // d'origine pour la découpe qui suit.
  const sample=document.createElement('canvas'),ratio=Math.min(1,1400/bounds.width,1000/bounds.height);
  sample.width=Math.max(1,Math.round(bounds.width*ratio));sample.height=Math.max(1,Math.round(bounds.height*ratio));
  sample.getContext('2d').drawImage(corrected,bounds.x,bounds.y,bounds.width,bounds.height,0,0,sample.width,sample.height);
  const image=sample.getContext('2d').getImageData(0,0,sample.width,sample.height),rx=bounds.width/image.width,ry=bounds.height/image.height;
  sample.width=0;sample.height=0;
  analysisStage('Recherche des séparations dans la zone…');checkAnalysis(signal);
  // bounds est l'enveloppe du quad : seuls des arrondis flottants peuvent
  // dépasser de quelques ulps l'aperçu, sans signifier un coin hors photo.
  const rowPoints=area.points?.map(p=>({x:Math.max(0,Math.min(image.width,(p.x-bounds.x)/rx)),y:Math.max(0,Math.min(image.height,(p.y-bounds.y)/ry))}));
  const result=total===null?await calculateImage('appareils',image,{signal}):await calculateImage('zone-modulaire',image,{signal,points:rowPoints,modules:total});
  const scale=value=>value?{...value,pixelsPerModule:value.pixelsPerModule*rx,pixelsPerMillimeter:value.pixelsPerMillimeter*rx}:null;
  const points=value=>value?.map(p=>({x:bounds.x+p.x*rx,y:bounds.y+p.y*ry}));
  result.candidates=result.candidates.map(c=>({...c,points:points(c.points),left:bounds.x+c.left*rx,right:bounds.x+c.right*rx,top:bounds.y+c.top*ry,bottom:bounds.y+c.bottom*ry,scale:scale(c.scale)}));
  result.rows=result.rows.map(r=>({...r,points:points(r.points),left:bounds.x+r.left*rx,right:bounds.x+r.right*rx,top:bounds.y+r.top*ry,bottom:bounds.y+r.bottom*ry,scale:scale(r.scale),calibrationConfirmed:r.calibrationConfirmed??true}));
  // Sans étalon, le rectangle tracé reste lisible même si sa segmentation est
  // indécidable. Sa largeur reste inconnue jusqu'à une preuve ou confirmation.
  if(total===null&&!result.candidates.length)result.candidates=[{left:bounds.x,right:bounds.x+bounds.width,top:bounds.y,bottom:bounds.y+bounds.height,modules:null,confiance:.5,niveau:'geometrie',groupId:'zone-choisie',reason:'Zone choisie : séparations et largeur à confirmer.'}];
  checkAnalysis(signal);session.candidates=result.candidates;session.chosenCandidates=result.candidates.map((_,i)=>i);session.layoutWarnings=result.warnings;
  if(result.rows.length)session.rows=result.rows;
  area.previewedModules=area.modules;changed();draw();
  message(result.candidates.length?`${result.candidates.length} découpes proposées. ${result.warnings.join(' ')}`:result.warnings.join(' ')||'Aucune séparation fiable. Ajustez la zone.');
}
async function readSelection(){
  return withAnalysis(async signal=>{
    if(session.selection)await previewSelection({signal});
    const candidates=(session.chosenCandidates??[]).map(i=>session.candidates[i]).filter(Boolean);
    if(!candidates.length)throw Error(session.layoutWarnings?.join(' ')||'Sélectionnez un appareil ou encadrez une rangée.');
    // Revenir à la sélection permet d'ajouter une autre rangée, sans perdre les
    // lectures déjà corrigées. Une même découpe n'est pas créée deux fois.
    const beforeIds=new Set(session.devices.map(d=>d.id)),prepared=prepareSelectedCandidates(session.devices,candidates);
    session.devices=prepared.devices;changed();
    if(prepared.crops.length)await cropDetected(prepared.crops,{signal,append:true});
    const targetIds=new Set([...prepared.selectedIds,...session.devices.filter(d=>!beforeIds.has(d.id)).map(d=>d.id)]);
    const indices=session.devices.flatMap((d,i)=>targetIds.has(d.id)?[i]:[]);
    step='labels';await readDevicesCore(indices,signal);editingFamily=false;
  });
}
async function cropRegions(regions,{signal,append=false}={}){
  const existing=append?session.devices:[],devices=[],started=performance.now();
  for(const region of regions){
    checkAnalysis(signal);analysisStage('Découpage et détourage : appareil '+(devices.length+1)+'/'+regions.length+'…');
    const {rect,rowIndex,scale,detection,points}=region,labels=createLabels(),previous=existing.find(d=>d.id===region.replaceDeviceId);
    labels.modules=Number.isFinite(rect.modules)?{valeur:rect.modules,confiance:Math.min(scale?.confidence??0,detection?.confiance??1),niveau:Number.isFinite(detection?.confiance)||scale?.source==='separations-visibles'?'geometrie':scale?.source==='nombre-confirme'||scale?.source==='repere-18-mm'?'calibration':'decoupage'}:{valeur:'inconnu',confiance:0,niveau:'geometrie'};
    // Un contour corrigé exige une nouvelle lecture et validation, tout en
    // conservant les corrections déjà saisies explicitement par la personne.
    if(previous)for(const [key,field]of Object.entries(previous.labels))if(field.niveau==='manuel')labels[key]=structuredClone(field);
    if(previous&&labels.modules.niveau==='manuel'&&labels.modules.valeur!=='inconnu'&&Number.isFinite(rect.modules)){
      const count=Number(String(labels.modules.valeur).trim().replace(',','.'));detection.manualModulesConflict=!Number.isFinite(count)||count!==rect.modules;
    }
    const straight=points?await rectifyDevice(corrected,points,{signal}):null;
    const blob=straight?.blob??await cropDevice(corrected,rect);checkAnalysis(signal);
    const cutout=await cutoutDevice(blob,{signal});checkAnalysis(signal);
    devices.push({id:previous?.id??uuid(),rowIndex:previous?.rowIndex??rowIndex,rect,quad:straight?.points??null,imageSize:straight?{width:straight.width,height:straight.height}:null,blob,cutoutBlob:cutout.blob,cutout:cutout.details,detection,labels,validatedAt:null,validatedBy:null});
  }
  checkAnalysis(signal);const replacements=new Map(devices.map(d=>[d.id,d]));session.devices=[...existing.map(d=>replacements.get(d.id)??d),...devices.filter(d=>!existing.some(old=>old.id===d.id))];session.cutsDirty=false;session.cropDurationMs=Math.round(performance.now()-started);selected=session.devices.findIndex(d=>d.id===devices[0]?.id);showOriginal=false;editingFamily=false;step='labels';changed();await persist();
  message(String(devices.length)+' vignettes créées. La lecture et la validation restent indépendantes de l’estimation du pas de 18 mm.');return true;
}
async function cropDetected(candidates,{signal,append=false}={}){
  const groups=new Map(),offset=append?Math.max(-1,...session.devices.map(d=>d.rowIndex).filter(i=>Number.isInteger(i)&&i>=0))+1:0;
  const regions=candidates.filter(c=>[c.left,c.right,c.top,c.bottom].every(Number.isFinite)&&c.left>=0&&c.right<=corrected.width&&c.top>=0&&c.bottom<=corrected.height&&c.right>c.left&&c.bottom>c.top).map(c=>{
    if(!groups.has(c.groupId))groups.set(c.groupId,-1-groups.size-(append?session.devices.length:0));
    return {replaceDeviceId:c.replaceDeviceId,rowIndex:Number.isInteger(c.rowIndex)&&c.rowIndex>=0?c.rowIndex+offset:groups.get(c.groupId),points:c.points,rect:{x:c.left,y:c.top,width:c.right-c.left,height:c.bottom-c.top,modules:c.modules},scale:c.scale,detection:{confiance:c.confiance,niveau:c.niveau,edgeSupport:c.edgeSupport,reason:c.reason,scaleKnown:Number.isFinite(c.modules)}};
  });
  if(!regions.length)throw Error('Aucune façade suffisamment délimitée pour la lecture.');
  return cropRegions(regions,{signal,append});
}
async function crop({replaceConfirmed=false,signal}={}){
  if(!session.rows.length||!session.rows.every(r=>validateRow(r,corrected.width,corrected.height)))throw Error('Vérifiez les limites, le nombre de modules et les séparations de chaque rangée.');
  if(session.rows.some(r=>r.calibrationConfirmed===false))throw Error('Échelle inconnue : renseignez le nombre de modules ou repérez les deux bords d’un appareil de 18 mm.');
  const ordered=[...session.rows].sort((a,b)=>a.top-b.top||a.left-b.left);
  const contour=row=>row.points??[{x:row.left,y:row.top},{x:row.right,y:row.top},{x:row.right,y:row.bottom},{x:row.left,y:row.bottom}];
  if(ordered.some((r,i)=>ordered.slice(0,i).some(other=>quadsOverlap(contour(r),contour(other)))))throw Error('Les zones d’appareils se chevauchent. Corrigez leurs limites.');
  if(session.devices.length&&!replaceConfirmed&&!confirm('Ce découpage remplacera les vignettes et leurs étiquettes sur cette photo. Continuer ?'))return;
  const regions=ordered.flatMap((row,rowIndex)=>(row.points?divideFacadeRow(row):deviceRects(row,corrected.width).map(rect=>({rect}))).map(region=>({...region,rowIndex,scale:row.scale,detection:{niveau:'geometrie',scaleKnown:true}})));
  session.rows=ordered;return cropRegions(regions,{signal});
}
async function validate(){const d=validateDevice(session.devices[selected],$('#validator').value);session.devices[selected]=d;changed();await persist();await refreshPhotos();message('Appareil validé. Toute correction ultérieure demandera une nouvelle validation.');}
function checkAnalysis(signal){
  if(signal?.aborted)throw new DOMException('Analyse annulée. La photo et les propositions terminées sont conservées.','AbortError');
}
function analysisStage(status){
  $('#analysis-status').textContent=status;$('#analysis-meter').removeAttribute('value');message(status);
}
async function withAnalysis(action){
  if(analysisController)throw Error('Une analyse locale est déjà en cours.');
  analysisController=new AbortController();const {signal}=analysisController;
  $('#analysis-progress').hidden=false;
  try{return await action(signal);}
  finally{analysisController=null;$('#analysis-progress').hidden=!photoBatch;await persist();await refreshPhotos();}
}
async function readDevicesCore(indices,signal){
  const meter=$('#analysis-meter'),text=$('#analysis-status');let finished=0,proposals=0;const started=performance.now();
  const validatedDevices=await listValidatedDevices();checkAnalysis(signal);
  for(const index of indices){
    checkAnalysis(signal);
    const device=session.devices[index];if(device.validatedAt)continue;
    selected=index;showOriginal=false;
    // L'interface est immobilisée pendant le lot. Recréer et décoder toutes
    // les miniatures à chaque OCR multipliait les allocations sur téléphone.
    if(finished===0)render();
    const result=await recognizeLocal(device.blob,{signal,onProgress:event=>{text.textContent='Appareil '+(finished+1)+'/'+indices.length+' · '+event.status+'…';meter.value=(finished+event.progress)/indices.length;}});
    checkAnalysis(signal);
    proposals+=applyRecognition(device,applyKnownReference(result,validatedDevices));changed();finished++;meter.value=finished/indices.length;
    await new Promise(resolve=>setTimeout(resolve,0));
  }
  checkAnalysis(signal);session.analysisDurationMs=Math.round(performance.now()-started);
  selected=indices[0]??selected;
  message('Analyse terminée sur cet appareil : '+finished+' vignettes, '+proposals+' propositions en '+(session.analysisDurationMs/1000).toFixed(1)+' s. Vérifiez les résultats avant de valider.');
}
async function readDevices(indices){return withAnalysis(signal=>readDevicesCore(indices,signal));}
async function autoAnalyzePhoto(){
  if(!session)throw Error('Prenez ou importez une photo.');
  if(session.devices.length&&!confirm('Reprendre l’analyse automatique remplacera les découpes et les étiquettes de cette photo. Continuer ?'))return;
  return withAnalysis(async signal=>{
    analysisStage('Recherche des contours et des rangées…');
    if(!corrected||session.geometryDirty){
      // Un grand contour de coffret n'est plus un préalable : chaque façade
      // conserve ses quatre coins et sera redressée lors de sa propre découpe.
      await applyPerspective({replaceConfirmed:true,signal});
    }
    checkAnalysis(signal);step='rows';await detectLayout({signal});
    message(session.candidates.length?'Contours proposés. Touchez les appareils à lire, ou choisissez une rangée.':'Aucun contour assez fiable. Encadrez une seule rangée pour poursuivre.');
  });
}
export async function createCurrentBatch(){
  if(busy)throw Error('Attendez la fin de l’opération de collecte en cours.');
  if(!session)throw Error('Ouvrez une photo et validez ses appareils avant de les envoyer.');
  const root=$('#workspace');busy=true;root.inert=true;root.setAttribute('aria-busy','true');
  try{return await collectBatch();}finally{busy=false;root.inert=false;root.removeAttribute('aria-busy');render();}
}
export function currentAnalysisTarget(){
  if(busy||!enabled('labels')||step!=='labels')throw Error('Sélectionnez une vignette à l’étape Valider.');
  const device=session.devices[selected];
  if(device.validatedAt)throw Error('Cet appareil est déjà validé. Remettez-le à vérifier avant de demander une analyse.');
  return {sessionId:session.id,deviceId:device.id,revision,blob:device.blob};
}
export function applyPCAnalysis(target,result){
  const device=session?.devices[selected];
  if(!device||session.id!==target.sessionId||device.id!==target.deviceId||revision!==target.revision||device.validatedAt)throw Error('La photo ou les étiquettes ont changé pendant l’analyse. Résultat écarté ; relancez sur la vignette souhaitée.');
  const count=applyRecognition(device,result);
  if(count)session.devices[selected]=invalidateDevice(device);changed();render();
  message(`${count} propositions ajoutées. Vérifiez les marquages et validez vous-même ; les champs illisibles restent inconnus.`);
  return count;
}
async function collectBatch(){
  if(session.geometryDirty||session.cutsDirty)throw Error('Appliquez les changements de cadrage avant l’export.');
  let unsaved=false;try{await persist();}catch{unsaved=true;}
  const metadata=await listSessions();const photos=await Promise.all(metadata.filter(s=>s.seance===group&&s.id!==session.id).map(s=>loadSession(s.id)));
  if(photos.some(s=>!s))throw Error('Une photo de la séance a changé dans une autre fenêtre. Rechargez la liste avant de réessayer.');
  photos.push(session);
  if(photos.some(s=>(s.geometryDirty||s.cutsDirty)&&s.devices.some(d=>d.validatedAt)))throw Error('Une photo de cette séance a un cadrage modifié. Appliquez son découpage avant d’exporter la séance.');
  const blob=await exportBatch({id:group,seance:group,devices:photos.flatMap(s=>s.devices)});
  return {blob,seance:group,count:photos.reduce((n,s)=>n+s.devices.filter(d=>d.validatedAt).length,0),unsaved};
}
async function exportGroup(){
  const {blob,count,unsaved}=await collectBatch(),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=`scan-tableau-${group.replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,100)}.zip`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
  message(`ZIP préparé : ${count} appareils validés de la séance. Les appareils à vérifier sont exclus.${unsaved?' Attention : la photo ouverte n’a pas pu être sauvegardée sur cet appareil.':''}`);
}

function exportDevicePNG(){
  const device=session.devices[selected],url=URL.createObjectURL(device.cutoutBlob||device.blob),a=document.createElement('a');
  a.href=url;a.download='appareil-'+(selected+1)+(device.cutoutBlob?'-detoure.png':'-original.png');document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
  message(device.cutoutBlob?'PNG détouré préparé. Vérifiez le contour sur l’aperçu et comparez avec l’original.':'PNG original préparé : le fond n’a pas pu être retiré avec assez de confiance.');
}

function pointerCoordinates(event){const canvas=$('#photo-canvas'),r=canvas.getBoundingClientRect(),source=step==='perspective'?original:corrected,view=viewBounds??{x:0,y:0,width:source.width,height:source.height};return {x:Math.max(0,Math.min(source.width,view.x+(event.clientX-r.left)/r.width*view.width)),y:Math.max(0,Math.min(source.height,view.y+(event.clientY-r.top)/r.height*view.height)),threshold:24/r.width*view.width};}
function pointerDown(event){
  if(busy||!['perspective','rows','labels'].includes(step))return;
  const p=pointerCoordinates(event);
  if(step==='labels'){
    const hit=session.devices.map((device,index)=>({rect:device.rect,points:device.quad,index})).filter(({rect,points})=>containsPoint(p,points,rect)).sort((a,b)=>a.rect.width*a.rect.height-b.rect.width*b.rect.height)[0];
    if(hit){selected=hit.index;showOriginal=false;editingFamily=false;render();}return;
  }
  if(step==='rows'&&!calibrating&&!$('#manual-rows')?.closest('details')?.open){
    if(selectionDrawing){drag={selection:true,first:p,bounds:{x:p.x,y:p.y,width:0,height:0}};event.currentTarget.setPointerCapture(event.pointerId);event.preventDefault();draw();return;}
    const hit=(session.candidates??[]).map((c,index)=>({c,index})).filter(({c})=>containsPoint(p,c.points,{x:c.left,y:c.top,width:c.right-c.left,height:c.bottom-c.top})).sort((a,b)=>(a.c.right-a.c.left)*(a.c.bottom-a.c.top)-(b.c.right-b.c.left)*(b.c.bottom-b.c.top))[0];
    if(hit){const chosen=new Set(session.chosenCandidates??[]);chosen.has(hit.index)?chosen.delete(hit.index):chosen.add(hit.index);session.chosenCandidates=[...chosen];session.selection=null;changed();render();}
    else message('Encadrez la rangée si ses appareils ne sont pas proposés.');
    return;
  }
  if(step==='rows'&&calibrating){
    const row=session.rows[calibrating.row];
    if(!row||!containsPoint(p,row.points,{x:row.left,y:row.top,width:row.right-row.left,height:row.bottom-row.top})){message('Touchez le bord de l’appareil à l’intérieur de la rangée sélectionnée.',true);return;}
    if(calibrating.first==null){calibrating.first=p.x;calibrating.firstPoint={x:p.x,y:p.y};draw();message('Touchez maintenant l’autre bord de ce même appareil de 18 mm.');return;}
    if(row.points){
      const index=calibrating.row,first=calibrating.firstPoint;
      void run(()=>withAnalysis(async signal=>{
        try{
          analysisStage('Calibration dans le plan redressé…');
          const {image,sx,sy}=layoutSample(),point=p=>({x:p.x/sx,y:p.y/sy});
          const result=await calculateImage('calibration-rangée',image,{points:row.points.map(point),first:point(first),second:point(p),signal});checkAnalysis(signal);
          const size=rectifiedSize(row.points),factor=size.width/result.rectifiedSize.width;
          session.rows[index]={...row,modules:result.modules,cuts:result.cuts,calibrationConfirmed:true,scale:{...result.scale,pixelsPerModule:result.scale.pixelsPerModule*factor,pixelsPerMillimeter:result.scale.pixelsPerMillimeter*factor}};
          calibrating=null;editRows();message('Échelle établie sur votre repère de 18 mm, dans la rangée redressée. Vérifiez les joints.');
        }catch(error){if(calibrating){calibrating.first=null;calibrating.firstPoint=null;}throw error;}
      }));return;
    }
    try{
      const {image,sx,sy}=layoutSample(),scaled={...row,top:row.top/sy,bottom:row.bottom/sy,left:row.left/sx,right:row.right/sx};
      const result=calibrateRow(image,scaled,Math.abs(p.x-calibrating.first)/sx);
      session.rows[calibrating.row]={...result,top:result.top*sy,bottom:result.bottom*sy,left:result.left*sx,right:result.right*sx,calibrationConfirmed:true,scale:{...result.scale,pixelsPerModule:result.scale.pixelsPerModule*sx,pixelsPerMillimeter:result.scale.pixelsPerMillimeter*sx}};
      calibrating=null;editRows();render();message('Échelle établie sur votre repère de 18 mm. Vérifiez les séparations avant la lecture.');
    }catch(error){calibrating.first=null;fail(error);}
    return;
  }
  if(step==='perspective'){
    const closest=session.points.map((q,i)=>({i,d:Math.hypot(q.x-p.x,q.y-p.y)})).sort((a,b)=>a.d-b.d)[0];
    if(closest.d>p.threshold*2)return;drag={point:closest.i};
  }else{
    const candidates=session.rows.flatMap((r,i)=>[{row:i,bound:'top',d:Math.abs(r.top-p.y)},{row:i,bound:'bottom',d:Math.abs(r.bottom-p.y)}]).sort((a,b)=>a.d-b.d);
    if(candidates[0]?.d<p.threshold/2)drag=candidates[0];
    else{const i=session.rows.findIndex(r=>containsPoint(p,r.points,{x:r.left,y:r.top,width:r.right-r.left,height:r.bottom-r.top}));if(i<0)return;const row=session.rows[i],plane=row.points?measureRectifiedFacades({...row,facades:[]}):null;
      const fraction=plane?mapPoint(plane.transform,p.x,p.y).x/plane.width:(p.x-row.left)/(row.right-row.left),cut=snapHalfModule(fraction*row.modules);
      if(cut<=0||cut>=row.modules)return;row.cuts=row.cuts.includes(cut)?row.cuts.filter(c=>c!==cut):[...row.cuts,cut].sort((a,b)=>a-b);editRows();renderPanel();draw();return;}
  }
  event.currentTarget.setPointerCapture(event.pointerId);event.preventDefault();
}
function pointerMove(event){if(!drag||busy)return;const p=pointerCoordinates(event);if(drag.selection){drag.bounds={x:Math.min(p.x,drag.first.x),y:Math.min(p.y,drag.first.y),width:Math.abs(p.x-drag.first.x),height:Math.abs(p.y-drag.first.y)};}else if(drag.point!==undefined){session.points[drag.point]={x:p.x,y:p.y};editGeometry();}else{const row=session.rows[drag.row];row[drag.bound]=drag.bound==='top'?Math.min(row.bottom-1,Math.round(p.y)):Math.max(row.top+1,Math.round(p.y));row.points=null;editRows();}draw();}
function pointerEnd(event){
  if(!drag)return;
  const previous=drag;drag=null;
  if(previous.selection){
    if(event.type==='pointercancel'){draw();return;}
    const bounds=previous.bounds;
    if(bounds.width<3||bounds.height<3){message('Faites glisser le doigt du coin haut gauche au coin bas droit de la rangée.');draw();return;}
    chooseArea(bounds);return;
  }
  renderPanel();draw();
}

export async function mountWorkspace(){
  $('#workspace').innerHTML=workspaceMarkup({group,validator,automaticAfterPhoto});
  $('#import-file').multiple=true;
  const batchStatus=document.createElement('small');batchStatus.id='batch-status';batchStatus.hidden=true;batchStatus.setAttribute('aria-live','polite');$('#analysis-progress').prepend(batchStatus);
  preference('seance',group);
  $('#workspace').addEventListener('click',event=>{
    const button=event.target.closest('button');if(!button||button.disabled||busy)return;
    if(button.dataset.step){calibrating=null;selectionDrawing=false;editingFamily=false;step=button.dataset.step;render();return;}
    if(button.dataset.device!==undefined){selected=Number(button.dataset.device);showOriginal=false;editingFamily=false;render();return;}
    if(button.dataset.selectRow!==undefined){const index=Number(button.dataset.selectRow),row=session.rows[index];chooseArea({x:row.left??0,y:row.top,width:(row.right??corrected.width)-(row.left??0),height:row.bottom-row.top},{modules:row.calibrationConfirmed===false?'':row.modules,rowIndex:index});return;}
    const action=button.dataset.action;
    if(action==='import'||action==='camera'){$(action==='camera'?'#camera-file':'#import-file').click();return;}
    const actions={rectify:()=>withAnalysis(signal=>applyPerspective({signal})),crop:()=>withAnalysis(signal=>crop({signal})),validate,suggest:()=>withAnalysis(signal=>proposeRows({signal})),'add-row':addRow,open:openPhoto,export:exportGroup,
      'auto-analyze':autoAnalyzePhoto,'read-one':()=>readDevices([selected]),'read-row':()=>readDevices(session.devices.flatMap((d,i)=>d.rowIndex===session.devices[selected].rowIndex&&!d.validatedAt?[i]:[])),
      'read-selection':readSelection,'preview-selection':()=>withAnalysis(signal=>previewSelection({signal})),
      'draw-selection':()=>{selectionDrawing=!selectionDrawing;message(selectionDrawing?'Faites glisser le doigt autour d’une seule rangée, d’un coin à l’autre.':'Tracé annulé.');},
      'select-all':()=>{session.selection=null;const all=(session.candidates??[]).map((_,i)=>i);session.chosenCandidates=session.chosenCandidates?.length===all.length?[]:all;changed();},
      'back-selection':()=>withAnalysis(async signal=>{step='rows';selectionDrawing=false;editingFamily=false;await detectLayout({signal});message('Choisissez les appareils à ajouter. Les lectures précédentes sont conservées.');}),
      'edit-family':()=>{editingFamily=true;},
      'confirm-family':()=>{session.devices[selected]=changeDeviceFamily(session.devices[selected],session.devices[selected].labels.famille.valeur,{humanChoice:true});refreshReadingAfterCorrection(session.devices[selected]);editingFamily=false;changed();},
      'crop-read':()=>withAnalysis(async signal=>{if(await crop({signal}))await readDevicesCore(session.devices.map((_,i)=>i),signal);}),
      'toggle-cutout':()=>{showOriginal=!showOriginal;},'export-cutout':exportDevicePNG,
      'calibrate-row':()=>{calibrating={row:Number(button.dataset.index),first:null};message('Touchez les deux bords verticaux d’un appareil connu d’un module (18 mm), dans cette rangée.');},
      'reset-points':()=>{session.points=defaults(session.width,session.height);editGeometry();},
      'remove-row':()=>{session.rows.splice(Number(button.dataset.index),1);session.selection=null;session.chosenCandidates=[];editRows();},
      previous:()=>{selected--;showOriginal=false;editingFamily=false;},next:()=>{selected++;showOriginal=false;editingFamily=false;},
      invalidate:async()=>{session.devices[selected]=invalidateDevice(session.devices[selected]);changed();await persist();await refreshPhotos();message('Appareil remis à vérifier.');},
      'new-group':async()=>{if(session)await persist();calibrating=null;session=null;original=null;corrected=null;step='capture';group=newGroup();preference('seance',group);$('#group-id').value=group;$('#save-status').textContent='Nouvelle séance';message('Nouvelle séance prête. Prenez ou importez les photos de cette prise de vue.');},
      delete:async()=>{const id=$('#saved-photos').value;if(!id)return;if(!confirm('Supprimer cette photo et ses validations de cet appareil ?'))return;if(session?.id===id){clearTimeout(saveTimer);await saveChain.catch(()=>{});calibrating=null;session=null;original=null;corrected=null;step='capture';revision=0;savedRevision=0;}await deleteSession(id);await refreshPhotos();message('Photo supprimée de cet appareil.');}
    };
    if(actions[action])void run(actions[action]);
  });
  $('#import-file').addEventListener('change',event=>{const files=Array.from(event.target.files||[]);event.target.value='';void run(()=>importPhotos(files));});
  $('#camera-file').addEventListener('change',event=>{const file=event.target.files[0];event.target.value='';void run(()=>importPhoto(file));});
  $('#auto-after-photo').addEventListener('change',event=>{automaticAfterPhoto=event.target.checked;preference('auto-cadrage',String(automaticAfterPhoto));});
  $('#session-name').addEventListener('input',event=>{if(session){session.name=event.target.value;changed();}});
  $('#validator').addEventListener('input',event=>{validator=event.target.value;preference('validator',validator);});
  $('#group-id').addEventListener('change',event=>{const value=event.target.value.trim();if(!value){event.target.value=group;return;}group=value;preference('seance',group);if(session){session.seance=group;session.devices=session.devices.map(invalidateDevice);changed();render();message('Séance modifiée : confirmez à nouveau les étiquettes de cette photo.');}});
  $('#tools').addEventListener('input',event=>{
    const input=event.target;
    if(input.id==='selection-modules'){session.selection.modules=input.value;session.selection.previewedModules=null;changed();return;}
    if(input.dataset.validator!==undefined){validator=input.value;$('#validator').value=validator;preference('validator',validator);return;}
    if(input.dataset.point!==undefined){const value=Number(input.value);if(!input.value||value<0||value>100)return;session.points[Number(input.dataset.point)][input.dataset.axis]=value/100*(input.dataset.axis==='x'?session.width:session.height);editGeometry();return;}
    if(input.dataset.label){const key=input.dataset.label;if(key==='modules'&&!widthEditable(session.devices[selected]))return;if(key==='famille'){session.devices[selected]=changeDeviceFamily(session.devices[selected],input.value,{humanChoice:true});refreshReadingAfterCorrection(session.devices[selected]);editingFamily=false;changed();render();return;}const provenance=input.closest('label')?.querySelector('small');if(provenance)provenance.textContent='Saisie en cours · à confirmer';const d=session.devices[selected];d.labels[key]={valeur:input.value.trim()||'inconnu',confiance:0,niveau:'manuel'};refreshReadingAfterCorrection(d);
      const widthInput=$('[data-label="modules"]');if(key!=='modules'&&widthInput&&widthInput.value!==String(d.labels.modules.valeur)){widthInput.value=d.labels.modules.valeur;}
      if($('.dimension-note'))$('.dimension-note').outerHTML=dimensionPanel(d);session.devices[selected]=invalidateDevice(d);changed();updateExportButton();updateSummary();document.querySelector(`[data-device="${selected}"]`)?.classList.remove('validated');const badge=$('#tools .badge');if(badge){badge.textContent='À vérifier';badge.classList.remove('validated');}$('#tools .validation-note')?.remove();return;}
    if(input.dataset.bound){const row=session.rows[Number(input.dataset.row)],bound=input.dataset.bound,max=['left','right'].includes(bound)?corrected.width:corrected.height;row[bound]=Math.round(Number(input.value)/100*max);row.points=null;editRows();return;}
  });
  $('#tools').addEventListener('change',event=>{
    const input=event.target;
    if(input.dataset.modules!==undefined){const row=session.rows[Number(input.dataset.row)],modules=Number(input.value);if(!Number.isFinite(modules)||modules<.5||modules>100||snapHalfModule(modules)!==modules){input.value=row.modules;message('Choisissez un nombre entre 0,5 et 100 modules, par demi-module.',true);return;}const unchanged=row.calibrationConfirmed!==false&&row.modules===modules,pitch=(row.points?rectifiedSize(row.points).width:row.right-row.left)/modules;row.modules=modules;row.calibrationConfirmed=true;row.scale={source:'nombre-confirme',confidence:1,moduleMillimeters:18,pixelsPerModule:pitch,pixelsPerMillimeter:pitch/18,...(row.points?{plane:'rangee-redressee'}:{})};if(!unchanged)row.cuts=[0,modules];editRows();renderPanel();}
    if(input.dataset.cuts!==undefined){const row=session.rows[Number(input.dataset.row)],cuts=input.value.trim()?input.value.split(';').map(s=>Number(s.trim().replace(',','.'))):[];const next={...row,cuts:[0,...cuts,row.modules]};if(!validateRow(next,corrected.width,corrected.height)){input.value=row.cuts.slice(1,-1).join('; ');message('Séparations invalides : utilisez des demi-modules croissants, séparés par des points-virgules.',true);return;}row.cuts=next.cuts;editRows();}
  });
  const canvas=$('#photo-canvas');canvas.addEventListener('pointerdown',pointerDown);canvas.addEventListener('pointermove',pointerMove);for(const name of ['pointerup','pointercancel'])canvas.addEventListener(name,pointerEnd);
  window.addEventListener('pagehide',()=>{if(session&&revision!==savedRevision)void persist().catch(()=>{});});
  window.addEventListener('beforeunload',event=>{if(session&&revision!==savedRevision){event.preventDefault();event.returnValue='';}});
  const stopAnalysis=()=>{photoBatch?.controller.abort();analysisController?.abort();};
  $('#analysis-cancel').addEventListener('click',stopAnalysis);
  window.addEventListener('pagehide',stopAnalysis);
  render();
  try{await refreshPhotos();}catch(error){message('Stockage local indisponible. Gardez cette page ouverte et exportez votre collecte avant de la fermer.',true);}
  window.__scanTableauReady=true;
}
