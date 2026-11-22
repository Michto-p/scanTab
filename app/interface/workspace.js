import {loadPhoto,clarity} from '../capture/photo.js';
import {validateQuad,snapHalfModule} from '../pretraitement/geometry.js';
import {rectify,cropDevice,pngBlob} from '../pretraitement/image.js';
import {suggestRows,validateRow,deviceRects} from '../segmentation/rows.js';
import {createLabels,FIELDS,FAMILIES,validateDevice,invalidateDevice} from './labels.js';
import {saveSession,loadSession,listSessions,deleteSession} from '../base/store.js';
import {exportBatch} from '../exports/zip.js';

const $=selector=>document.querySelector(selector);
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const corners=['Haut gauche','Haut droit','Bas droit','Bas gauche'];
const steps=[['capture','Photo'],['perspective','Redresser'],['rows','Découper'],['labels','Valider']];
const uuid=()=>crypto.randomUUID();
const newGroup=()=>`seance-${new Date().toISOString().slice(0,10)}-${uuid().slice(0,8)}`;
function preference(key,value){try{if(value!==undefined)localStorage.setItem('scan-tableau-'+key,value);return localStorage.getItem('scan-tableau-'+key);}catch{return null;}}
let session=null,original=null,corrected=null,step='capture',selected=0,busy=false,drag=null;
let group=preference('seance')||newGroup(),validator=preference('validator')||'';
let saveTimer,saveChain=Promise.resolve(),revision=0,savedRevision=0,thumbnailUrls=[],photosMetadata=[];

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
  busy=true;$('#workspace').setAttribute('aria-busy','true');
  const controls=[...$('#workspace').querySelectorAll('button,input,select')];
  controls.forEach(node=>{node.dataset.wasDisabled=String(node.disabled);node.disabled=true;});
  try{await fn();}catch(error){fail(error);}finally{busy=false;$('#workspace').removeAttribute('aria-busy');controls.forEach(node=>{node.disabled=node.dataset.wasDisabled==='true';delete node.dataset.wasDisabled;});render();}
}
function defaults(width,height){return [{x:0,y:0},{x:width,y:0},{x:width,y:height},{x:0,y:height}];}
function editGeometry(){session.geometryDirty=Boolean(session.rectified);changed();draw();}
function editRows(){session.cutsDirty=true;changed();draw();}
function enabled(name){return name==='capture'||(name==='perspective'&&original)||(name==='rows'&&corrected&&!session.geometryDirty)||(name==='labels'&&session?.devices.length&&!session.geometryDirty&&!session.cutsDirty);}
function updateExportButton(){const validated=session&&(session.devices.some(d=>d.validatedAt)||photosMetadata.some(s=>s.id!==session.id&&s.seance===group&&s.validatedCount>0));$('#export').disabled=!validated||session.geometryDirty||session.cutsDirty;}

function draw(){
  const canvas=$('#photo-canvas'),source=step==='perspective'||!corrected?original:corrected;
  $('#empty-photo').hidden=Boolean(source);canvas.hidden=!source;
  if(!source)return;
  const scale=Math.min(1,1100/source.width,800/source.height);
  canvas.width=Math.max(1,Math.round(source.width*scale));canvas.height=Math.max(1,Math.round(source.height*scale));
  const ctx=canvas.getContext('2d');ctx.drawImage(source,0,0,canvas.width,canvas.height);
  const sx=canvas.width/source.width,sy=canvas.height/source.height;
  ctx.lineWidth=2;
  if(step==='perspective'){
    ctx.beginPath();session.points.forEach((p,i)=>i?ctx.lineTo(p.x*sx,p.y*sy):ctx.moveTo(p.x*sx,p.y*sy));ctx.closePath();ctx.fillStyle='#164f9120';ctx.fill();ctx.strokeStyle=validateQuad(session.points,source.width,source.height)?'#f4b544':'#ed4747';ctx.stroke();
    session.points.forEach((p,i)=>{const x=Math.min(canvas.width-10,Math.max(10,p.x*sx)),y=Math.min(canvas.height-10,Math.max(10,p.y*sy));ctx.beginPath();ctx.arc(x,y,10,0,Math.PI*2);ctx.fillStyle='#164f91';ctx.fill();ctx.strokeStyle='#fff';ctx.stroke();ctx.fillStyle='#fff';ctx.font='bold 12px Arial';ctx.textAlign='center';ctx.fillText(String(i+1),x,y+4);});
  }
  if(step==='rows')session.rows.forEach((row,i)=>{
    const left=(row.left??0)*sx,right=(row.right??source.width)*sx,top=row.top*sy,bottom=row.bottom*sy;
    ctx.fillStyle='#164f9120';ctx.fillRect(left,top,right-left,bottom-top);ctx.strokeStyle='#f4b544';ctx.strokeRect(left,top,right-left,bottom-top);
    row.cuts.slice(1,-1).forEach(cut=>{const x=left+(right-left)*cut/row.modules;ctx.beginPath();ctx.moveTo(x,top);ctx.lineTo(x,bottom);ctx.stroke();});
    ctx.fillStyle='#164f91';ctx.fillRect(left,Math.max(0,top-24),100,24);ctx.fillStyle='#fff';ctx.textAlign='left';ctx.font='14px Arial';ctx.fillText(`Rangée ${i+1}`,left+6,Math.max(18,top-7));
  });
  if(step==='labels'&&session.devices[selected]){
    const r=session.devices[selected].rect;ctx.strokeStyle='#f4b544';ctx.lineWidth=4;ctx.strokeRect(r.x*sx,r.y*sy,r.width*sx,r.height*sy);
  }
  $('#photo-info').textContent=`${source.width} × ${source.height} px · ${step==='perspective'?'Original':'Image de travail'} · découpes pleine résolution`;
}

function rowPanel(row,i){
  const width=corrected.width,height=corrected.height;
  const slider=(key,label,max)=>`<label>${label}<input type="range" min="0" max="100" step="0.1" value="${(row[key]/max*100).toFixed(1)}" data-row="${i}" data-bound="${key}" aria-label="${label}, rangée ${i+1}"></label>`;
  return `<fieldset class="row-editor"><legend>Rangée ${i+1}</legend><div class="two-col">${slider('top','Haut',height)}${slider('bottom','Bas',height)}${slider('left','Gauche',width)}${slider('right','Droite',width)}</div><label>Nombre de modules (1 module = 18 mm)<input type="number" min="0.5" max="100" step="0.5" value="${row.modules}" data-row="${i}" data-modules></label><label>Séparations intérieures, en modules<input value="${escape(row.cuts.slice(1,-1).join('; '))}" data-row="${i}" data-cuts placeholder="1; 2; 4; 6.5" inputmode="text"></label><p class="hint">Une séparation tous les 0,5 module est possible. Retirez une séparation pour réunir un appareil large.</p><button data-action="remove-row" data-index="${i}" class="danger">Retirer cette rangée</button></fieldset>`;
}

function renderPanel(){
  const panel=$('#tools');
  if(step==='capture'){
    panel.innerHTML=`<h2>Une photo lisible</h2><p>Photographiez le tableau de face, en incluant les appareils en entier. Évitez les reflets sur les marquages.</p><div class="stack"><button class="primary" data-action="camera">Prendre une photo</button><button data-action="import">Importer une photo</button></div>${session?`<div class="quality"><strong>${session.width} × ${session.height} pixels</strong><p>${escape(session.quality?.warning||'Vérifiez les petits marquages en agrandissant la photo originale.')}</p><small>La netteté est une estimation, pas une preuve de lisibilité.</small></div><button class="primary full" data-step="perspective">Cadrer le tableau</button>`:'<p class="hint">La caméra du téléphone conserve la résolution du fichier photo. Aucune photo n’est envoyée à un serveur.</p>'}`;
  }else if(step==='perspective'){
    panel.innerHTML=`<h2>Redresser le tableau</h2><p>Placez les quatre coins autour de la zone à découper. Faites glisser les repères ou ajustez leurs positions ci-dessous.</p><div class="corner-grid">${session.points.map((p,i)=>`<fieldset><legend>${i+1}. ${corners[i]}</legend><div class="two-col">${['x','y'].map(axis=>`<label>${axis==='x'?'Horizontal':'Vertical'} (%)<input type="number" min="0" max="100" step="0.1" data-point="${i}" data-axis="${axis}" value="${(p[axis]/(axis==='x'?session.width:session.height)*100).toFixed(1)}"></label>`).join('')}</div></fieldset>`).join('')}</div><div class="stack"><button class="primary" data-action="rectify">Appliquer le redressement</button><button data-action="reset-points">Reprendre toute la photo</button></div>`;
  }else if(step==='rows'){
    panel.innerHTML=`<h2>Découper les appareils</h2><p>Confirmez la largeur utile et le nombre réel de modules de chaque rangée. La photo seule ne donne pas l’échelle en millimètres.</p><div class="two-col"><button data-action="suggest">Proposer des rangées</button><button data-action="add-row">Ajouter une rangée</button></div><p class="hint">Proposition par contraste : rails DIN non garantis. Touchez l’intérieur d’une rangée pour ajouter ou retirer une séparation. Déplacez ses bords haut et bas pour la cadrer.</p>${session.rows.map(rowPanel).join('')}<button class="primary full" data-action="crop" ${session.rows.length?'':'disabled'}>Créer les vignettes</button>`;
  }else{
    const device=session.devices[selected];
    if(!device){panel.innerHTML='<p>Aucune vignette. Revenez au découpage.</p>';return;}
    panel.innerHTML=`<div class="device-heading"><h2>Appareil ${selected+1} sur ${session.devices.length}</h2><span class="badge ${device.validatedAt?'validated':''}">${device.validatedAt?'Validé':'À vérifier'}</span></div><p class="hint">La collecte utilise la saisie manuelle. L’OCR et la reconnaissance automatique ne sont pas encore intégrés. Laissez « inconnu » si un marquage est illisible.</p><img class="device-preview" src="${thumbnailUrls[selected]}" alt="Vignette pleine résolution de l’appareil ${selected+1}"><div class="label-fields">${FIELDS.map(({key,label})=>`<label>${label}${key==='famille'?`<select data-label="${key}">${FAMILIES.map(f=>`<option ${device.labels[key].valeur===f?'selected':''}>${escape(f)}</option>`).join('')}</select>`:`<input data-label="${key}" value="${escape(device.labels[key].valeur)}" ${key==='modules'?'readonly':''}>`}</label>`).join('')}</div><p class="hint">Origine : saisie manuelle. Une valeur inconnue garde une confiance de 0 ; la validation atteste uniquement votre lecture.</p>${device.validatedAt?`<p class="validation-note">Validé par ${escape(device.validatedBy)} le ${new Date(device.validatedAt).toLocaleString('fr-FR')}.</p>`:''}<label class="validator-field">Validation par<input data-validator value="${escape(validator)}" maxlength="100" autocomplete="name"></label><div class="stack"><button class="primary" data-action="validate">Valider cet appareil</button>${device.validatedAt?'<button data-action="invalidate">Remettre à vérifier</button>':''}</div><div class="two-col navigation"><button data-action="previous" ${selected?'':'disabled'}>Précédent</button><button data-action="next" ${selected<session.devices.length-1?'':'disabled'}>Suivant</button></div>`;
  }
}
function renderThumbs(){
  thumbnailUrls.forEach(url=>URL.revokeObjectURL(url));thumbnailUrls=[];
  const list=$('#thumbnails');list.replaceChildren();list.hidden=step!=='labels';
  if(step!=='labels')return;
  session.devices.forEach((d,i)=>{const url=URL.createObjectURL(d.blob);thumbnailUrls.push(url);const button=document.createElement('button');button.dataset.device=String(i);button.className='thumbnail'+(i===selected?' selected':'')+(d.validatedAt?' validated':'');button.setAttribute('aria-label',`Appareil ${i+1}, ${d.validatedAt?'validé':'à vérifier'}`);button.setAttribute('aria-pressed',String(i===selected));const img=new Image();img.src=url;img.alt='';button.append(img,document.createTextNode(String(i+1)));list.append(button);});
}
function render(){
  $('#steps').innerHTML=steps.map(([name,title],i)=>`<button data-step="${name}" aria-current="${step===name?'step':'false'}" ${enabled(name)?'':'disabled'}><span>${i+1}</span>${title}</button>`).join('');
  updateExportButton();
  $('#summary').textContent=session?`${session.devices.length} appareils · ${session.devices.filter(d=>d.validatedAt).length} validés sur cette photo`:'Une photo, puis une vérification appareil par appareil.';
  renderThumbs();renderPanel();draw();
}
async function refreshPhotos(){
  const photos=await listSessions(),select=$('#saved-photos');photosMetadata=photos;select.innerHTML='<option value="">Choisir une photo enregistrée</option>';
  photos.forEach(s=>{const option=document.createElement('option');option.value=s.id;option.textContent=`${s.name} · ${s.validatedCount}/${s.deviceCount} validés · ${new Date(s.createdAt).toLocaleDateString('fr-FR')}`;select.append(option);});
  if(session)select.value=session.id;
  return photos;
}
async function importPhoto(file){
  if(!file)return;
  message('Lecture de la photo…');
  const photo=await loadPhoto(file);
  if(session)await persist();
  original=photo.canvas;corrected=null;selected=0;step='capture';
  session={id:uuid(),seance:group,name:$('#session-name').value.trim()||'Tableau électrique',createdAt:new Date().toISOString(),original:photo.blob,rectified:null,width:photo.width,height:photo.height,points:defaults(photo.width,photo.height),rows:[],devices:[],quality:clarity(original),geometryDirty:false,cutsDirty:false};
  revision=1;savedRevision=0;message(session.quality.warning||'Photo chargée. Vérifiez les marquages, puis cadrez le tableau.');
  try{await persist();await refreshPhotos();}catch(error){fail(error);}
}
async function openPhoto(){
  const id=$('#saved-photos').value;if(!id)return;
  if(session)await persist();
  const loaded=await loadSession(id);if(!loaded)throw Error('Cette photo n’existe plus sur cet appareil.');
  const photo=await loadPhoto(loaded.original),redressed=loaded.rectified?await loadPhoto(loaded.rectified):null;
  session=loaded;original=photo.canvas;corrected=redressed?.canvas??null;group=session.seance||session.id;selected=0;revision=0;savedRevision=0;
  $('#session-name').value=session.name;$('#group-id').value=group;preference('seance',group);
  step=enabled('labels')?'labels':enabled('rows')?'rows':'perspective';$('#save-status').textContent='Enregistré sur cet appareil';message('Photo et validations restaurées.');
}
async function applyPerspective(){
  if(!validateQuad(session.points,session.width,session.height))throw Error('Les coins sont invalides ou se croisent. Suivez le contour dans l’ordre indiqué.');
  if(session.devices.length&&!confirm('Le redressement remplacera les vignettes et leurs étiquettes sur cette photo. Continuer ?'))return;
  message('Redressement en pleine résolution…');
  const result=await rectify(original,session.points),blob=await pngBlob(result);
  corrected=result;session.rectified=blob;session.appliedPoints=structuredClone(session.points);session.rows=[];session.devices=[];session.geometryDirty=false;session.cutsDirty=false;selected=0;step='rows';changed();await persist();message('Image redressée. Ajoutez ou proposez les rangées, puis vérifiez leur échelle.');
}
function addRow(){const height=corrected.height;session.rows.push({top:Math.round(height*.2),bottom:Math.round(height*.8),left:0,right:corrected.width,modules:13,cuts:Array.from({length:14},(_,i)=>i)});editRows();message('Rangée ajoutée : ajustez son cadrage et son nombre de modules.');}
function proposeRows(){
  if(session.rows.length&&!confirm('Remplacer les rangées et leurs séparations manuelles par une nouvelle proposition ?'))return;
  const sample=document.createElement('canvas'),scale=Math.min(1,1000/corrected.width,1000/corrected.height);sample.width=Math.round(corrected.width*scale);sample.height=Math.round(corrected.height*scale);sample.getContext('2d').drawImage(corrected,0,0,sample.width,sample.height);
  session.rows=suggestRows(sample.getContext('2d').getImageData(0,0,sample.width,sample.height)).map(r=>({...r,top:Math.round(r.top*corrected.height/sample.height),bottom:Math.round(r.bottom*corrected.height/sample.height),left:0,right:corrected.width}));
  editRows();message(session.rows.length?'Rangées proposées. Les 13 modules sont une valeur de départ : confirmez l’échelle et les limites de chaque appareil.':'Aucune rangée fiable proposée. Ajoutez une rangée manuellement.');
}
async function crop(){
  if(!session.rows.length||!session.rows.every(r=>validateRow(r,corrected.width,corrected.height)))throw Error('Vérifiez les limites, le nombre de modules et les séparations de chaque rangée.');
  const ordered=[...session.rows].sort((a,b)=>a.top-b.top);
  if(ordered.some((r,i)=>i&&r.top<ordered[i-1].bottom))throw Error('Les rangées se chevauchent. Corrigez leurs limites.');
  if(session.devices.length&&!confirm('Ce découpage remplacera les vignettes et leurs étiquettes sur cette photo. Continuer ?'))return;
  const devices=[];const started=performance.now();
  for(const [rowIndex,row] of ordered.entries())for(const rect of deviceRects(row,corrected.width)){
    message(`Découpage : appareil ${devices.length+1}…`);
    const labels=createLabels();labels.modules={valeur:rect.modules,confiance:0,niveau:'decoupage'};
    devices.push({id:uuid(),rowIndex,rect,blob:await cropDevice(corrected,rect),labels,validatedAt:null,validatedBy:null});
  }
  session.devices=devices;session.rows=ordered;session.cutsDirty=false;session.cropDurationMs=Math.round(performance.now()-started);selected=0;step='labels';changed();await persist();message(`${devices.length} vignettes créées en ${(session.cropDurationMs/1000).toFixed(2)} s sur cet appareil. Vérifiez chaque vignette avant de valider.`);
}
async function validate(){const d=validateDevice(session.devices[selected],$('#validator').value);session.devices[selected]=d;changed();await persist();await refreshPhotos();message('Appareil validé. Toute correction ultérieure demandera une nouvelle validation.');}
async function exportGroup(){
  if(session.geometryDirty||session.cutsDirty)throw Error('Appliquez les changements de cadrage avant l’export.');
  let unsaved=false;try{await persist();}catch{unsaved=true;}
  const metadata=await listSessions();const photos=await Promise.all(metadata.filter(s=>s.seance===group&&s.id!==session.id).map(s=>loadSession(s.id)));
  if(photos.some(s=>!s))throw Error('Une photo de la séance a changé dans une autre fenêtre. Rechargez la liste avant de réessayer.');
  photos.push(session);
  if(photos.some(s=>(s.geometryDirty||s.cutsDirty)&&s.devices.some(d=>d.validatedAt)))throw Error('Une photo de cette séance a un cadrage modifié. Appliquez son découpage avant d’exporter la séance.');
  const blob=await exportBatch({id:group,seance:group,devices:photos.flatMap(s=>s.devices)}),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=`scan-tableau-${group.replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,100)}.zip`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
  message(`ZIP préparé : ${photos.reduce((n,s)=>n+s.devices.filter(d=>d.validatedAt).length,0)} appareils validés de la séance. Les appareils à vérifier sont exclus.${unsaved?' Attention : la photo ouverte n’a pas pu être sauvegardée sur cet appareil.':''}`);
}

function pointerCoordinates(event){const canvas=$('#photo-canvas'),r=canvas.getBoundingClientRect(),source=step==='perspective'?original:corrected;return {x:Math.max(0,Math.min(source.width,(event.clientX-r.left)/r.width*source.width)),y:Math.max(0,Math.min(source.height,(event.clientY-r.top)/r.height*source.height)),threshold:24/r.width*source.width};}
function pointerDown(event){
  if(busy||!['perspective','rows'].includes(step))return;
  const p=pointerCoordinates(event);
  if(step==='perspective'){
    const closest=session.points.map((q,i)=>({i,d:Math.hypot(q.x-p.x,q.y-p.y)})).sort((a,b)=>a.d-b.d)[0];
    if(closest.d>p.threshold*2)return;drag={point:closest.i};
  }else{
    const candidates=session.rows.flatMap((r,i)=>[{row:i,bound:'top',d:Math.abs(r.top-p.y)},{row:i,bound:'bottom',d:Math.abs(r.bottom-p.y)}]).sort((a,b)=>a.d-b.d);
    if(candidates[0]?.d<p.threshold/2)drag=candidates[0];
    else{const i=session.rows.findIndex(r=>p.y>=r.top&&p.y<=r.bottom&&p.x>=r.left&&p.x<=r.right);if(i<0)return;const row=session.rows[i],cut=snapHalfModule((p.x-row.left)/(row.right-row.left)*row.modules);if(cut<=0||cut>=row.modules)return;row.cuts=row.cuts.includes(cut)?row.cuts.filter(c=>c!==cut):[...row.cuts,cut].sort((a,b)=>a-b);editRows();renderPanel();draw();return;}
  }
  event.currentTarget.setPointerCapture(event.pointerId);event.preventDefault();
}
function pointerMove(event){if(!drag||busy)return;const p=pointerCoordinates(event);if(drag.point!==undefined){session.points[drag.point]={x:p.x,y:p.y};editGeometry();}else{const row=session.rows[drag.row];row[drag.bound]=drag.bound==='top'?Math.min(row.bottom-1,Math.round(p.y)):Math.max(row.top+1,Math.round(p.y));editRows();}draw();}

export async function mountWorkspace(){
  $('#workspace').innerHTML=`<div class="intro"><div><h1>Collecter un tableau</h1><p id="summary"></p></div><button class="primary" id="export" data-action="export" disabled>Exporter la séance en ZIP</button></div><details class="session-options" id="session-details"><summary>Informations de séance et de validation</summary><section class="session-bar" aria-label="Séance de collecte"><label>Nom du tableau<input id="session-name" value="Tableau électrique" maxlength="100"></label><label>Séance photo<input id="group-id" value="${escape(group)}" maxlength="100" aria-describedby="group-hint"></label><label>Votre nom ou vos initiales<input id="validator" value="${escape(validator)}" maxlength="100" autocomplete="name"></label><button data-action="new-group">Nouvelle séance</button><p class="hint" id="group-hint">Gardez le même identifiant de séance pour les photos prises ensemble. Le ZIP regroupe les photos de cette séance.</p></section></details><div class="photo-library"><label class="sr-only" for="saved-photos">Photos enregistrées</label><select id="saved-photos"><option value="">Choisir une photo enregistrée</option></select><button data-action="open">Ouvrir</button><button data-action="delete" class="danger">Supprimer</button><span id="save-status" role="status">Aucune photo ouverte</span></div><nav class="steps" id="steps" aria-label="Étapes de collecte"></nav><p id="message" role="status" aria-live="polite">Commencez par une photo du tableau ou importez une image.</p><div class="workbench"><div class="photo-column"><div class="stage"><div id="empty-photo"><img src="./icons/tableau.svg" width="96" height="96" alt=""><h2>Votre tableau, appareil par appareil</h2><p>Une image nette et cadrée facilite la lecture des marquages.</p><div class="stack"><button class="primary" data-action="camera">Prendre une photo</button><button data-action="import">Importer une photo</button></div></div><canvas id="photo-canvas" hidden aria-label="Photo de travail. Les coins et limites sont également réglables avec les champs du panneau."></canvas></div><p id="photo-info" class="hint"></p><div id="thumbnails" class="thumbnails" aria-label="Appareils découpés" hidden></div></div><aside id="tools" aria-label="Outils de collecte"></aside></div><input type="file" id="import-file" accept="image/*" hidden><input type="file" id="camera-file" accept="image/*" capture="environment" hidden>`;
  preference('seance',group);
  $('#workspace').addEventListener('click',event=>{
    const button=event.target.closest('button');if(!button||button.disabled||busy)return;
    if(button.dataset.step){step=button.dataset.step;render();return;}
    if(button.dataset.device!==undefined){selected=Number(button.dataset.device);render();return;}
    const action=button.dataset.action;
    if(action==='import'||action==='camera'){$(action==='camera'?'#camera-file':'#import-file').click();return;}
    const actions={rectify:applyPerspective,crop,validate,suggest:proposeRows,'add-row':addRow,open:openPhoto,export:exportGroup,
      'reset-points':()=>{session.points=defaults(session.width,session.height);editGeometry();},
      'remove-row':()=>{session.rows.splice(Number(button.dataset.index),1);editRows();},
      previous:()=>{selected--;},next:()=>{selected++;},
      invalidate:async()=>{session.devices[selected]=invalidateDevice(session.devices[selected]);changed();await persist();await refreshPhotos();message('Appareil remis à vérifier.');},
      'new-group':async()=>{if(session)await persist();session=null;original=null;corrected=null;step='capture';group=newGroup();preference('seance',group);$('#group-id').value=group;$('#save-status').textContent='Nouvelle séance';message('Nouvelle séance prête. Prenez ou importez les photos de cette prise de vue.');},
      delete:async()=>{const id=$('#saved-photos').value;if(!id)return;if(!confirm('Supprimer cette photo et ses validations de cet appareil ?'))return;if(session?.id===id){clearTimeout(saveTimer);await saveChain.catch(()=>{});session=null;original=null;corrected=null;step='capture';revision=0;savedRevision=0;}await deleteSession(id);await refreshPhotos();message('Photo supprimée de cet appareil.');}
    };
    if(actions[action])void run(actions[action]);
  });
  for(const selector of ['#import-file','#camera-file'])$(selector).addEventListener('change',event=>{const file=event.target.files[0];event.target.value='';void run(()=>importPhoto(file));});
  $('#session-name').addEventListener('input',event=>{if(session){session.name=event.target.value;changed();}});
  $('#validator').addEventListener('input',event=>{validator=event.target.value;preference('validator',validator);});
  $('#group-id').addEventListener('change',event=>{const value=event.target.value.trim();if(!value){event.target.value=group;return;}group=value;preference('seance',group);if(session){session.seance=group;session.devices=session.devices.map(invalidateDevice);changed();render();message('Séance modifiée : confirmez à nouveau les étiquettes de cette photo.');}});
  $('#tools').addEventListener('input',event=>{
    const input=event.target;
    if(input.dataset.validator!==undefined){validator=input.value;$('#validator').value=validator;preference('validator',validator);return;}
    if(input.dataset.point!==undefined){const value=Number(input.value);if(!input.value||value<0||value>100)return;session.points[Number(input.dataset.point)][input.dataset.axis]=value/100*(input.dataset.axis==='x'?session.width:session.height);editGeometry();return;}
    if(input.dataset.label){const key=input.dataset.label;if(key==='modules')return;const d=session.devices[selected];d.labels[key]={valeur:input.value.trim()||'inconnu',confiance:0,niveau:'manuel'};session.devices[selected]=invalidateDevice(d);changed();updateExportButton();$('#summary').textContent=`${session.devices.length} appareils · ${session.devices.filter(d=>d.validatedAt).length} validés sur cette photo`;document.querySelector(`[data-device="${selected}"]`)?.classList.remove('validated');const badge=$('#tools .badge');if(badge){badge.textContent='À vérifier';badge.classList.remove('validated');}$('#tools .validation-note')?.remove();return;}
    if(input.dataset.bound){const row=session.rows[Number(input.dataset.row)],bound=input.dataset.bound,max=['left','right'].includes(bound)?corrected.width:corrected.height;row[bound]=Math.round(Number(input.value)/100*max);editRows();return;}
  });
  $('#tools').addEventListener('change',event=>{
    const input=event.target;
    if(input.dataset.modules!==undefined){const row=session.rows[Number(input.dataset.row)],modules=Number(input.value);if(!Number.isFinite(modules)||modules<.5||modules>100||snapHalfModule(modules)!==modules){input.value=row.modules;message('Choisissez un nombre entre 0,5 et 100 modules, par demi-module.',true);return;}row.modules=modules;row.cuts=[0,...Array.from({length:Math.ceil(modules)-1},(_,i)=>i+1).filter(c=>c<modules),modules];editRows();renderPanel();}
    if(input.dataset.cuts!==undefined){const row=session.rows[Number(input.dataset.row)],cuts=input.value.trim()?input.value.split(';').map(s=>Number(s.trim().replace(',','.'))):[];const next={...row,cuts:[0,...cuts,row.modules]};if(!validateRow(next,corrected.width,corrected.height)){input.value=row.cuts.slice(1,-1).join('; ');message('Séparations invalides : utilisez des demi-modules croissants, séparés par des points-virgules.',true);return;}row.cuts=next.cuts;editRows();}
  });
  const canvas=$('#photo-canvas');canvas.addEventListener('pointerdown',pointerDown);canvas.addEventListener('pointermove',pointerMove);for(const name of ['pointerup','pointercancel'])canvas.addEventListener(name,()=>{if(drag){drag=null;renderPanel();draw();}});
  window.addEventListener('pagehide',()=>{if(session&&revision!==savedRevision)void persist().catch(()=>{});});
  window.addEventListener('beforeunload',event=>{if(session&&revision!==savedRevision){event.preventDefault();event.returnValue='';}});
  render();
  try{await refreshPhotos();}catch(error){message('Stockage local indisponible. Gardez cette page ouverte et exportez votre collecte avant de la fermer.',true);}
  window.__scanTableauReady=true;
}
