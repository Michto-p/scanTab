import {loadPhoto,clarity} from '../app/capture/photo.js';
import {rectify,rectifyDevice,cropDevice} from '../app/pretraitement/image.js';
import {rectifiedSize} from '../app/pretraitement/geometry.js';
import {suggestRows,deviceRects} from '../app/segmentation/rows.js';
import {createLabels,validateDevice} from '../app/interface/labels.js';
import {saveSession,loadSession,listSessions,listValidatedDevices,deleteSession,closeDatabase} from '../app/base/store.js';
import {exportBatch} from '../app/exports/zip.js';
const qa=window.__qa={status:'pending',tests:[]};
const assert=(value,message)=>{if(!value)throw Error(message);};
async function check(nom,fn){try{await fn();qa.tests.push({nom,succes:true});}catch(error){qa.tests.push({nom,succes:false,detail:error.message});}}
const annotation=await (await fetch('./photos/tableau-synthetique.annotations.json')).json();
let photo,corrected,blob,device;
await check('Import et dimensions originales du dessin annoté',async()=>{const file=await (await fetch('./photos/tableau-synthetique.svg')).blob();photo=await loadPhoto(file);assert(photo.width===720&&photo.height===520,'Dimensions perdues');assert(photo.blob.size===file.size,'Original altéré');});
await check('Redressement identité : dimensions et pixels conservés',async()=>{corrected=await rectify(photo.canvas,[{x:0,y:0},{x:720,y:0},{x:720,y:520},{x:0,y:520}]);assert(corrected.width===720&&corrected.height===520,'Dimensions redressées fausses');const before=photo.canvas.getContext('2d').getImageData(90,130,1,1).data,after=corrected.getContext('2d').getImageData(90,130,1,1).data;assert(before.every((v,i)=>v===after[i]),'Pixels identité altérés');});
await check('Rangées et vignettes PNG en pleine résolution',async()=>{const rows=suggestRows(corrected.getContext('2d').getImageData(0,0,720,520));assert(rows.length===2,'Rangées perdues');const rect=deviceRects(annotation.rows[0],720)[0];blob=await cropDevice(corrected,rect);const crop=await loadPhoto(blob);assert(blob.type==='image/png'&&crop.width===44&&crop.height===150,'Dimensions de découpe incorrectes');});
await check('Façade inclinée : PNG redressé depuis la source pleine résolution',async()=>{
  const points=[{x:76.25,y:69.5},{x:162.5,y:84.75},{x:150.5,y:223.75},{x:69.25,y:210.5}],expected=rectifiedSize(points);
  const before=photo.canvas.getContext('2d').getImageData(0,0,720,520).data;
  const result=await rectifyDevice(photo.canvas,points),decoded=await loadPhoto(result.blob),reference=await rectify(photo.canvas,points);
  try{
    assert(decoded.width===expected.width&&decoded.height===expected.height,'Résolution de façade perdue');
    assert(JSON.stringify(result.points)===JSON.stringify(points),'Coins source altérés');
    const actual=decoded.canvas.getContext('2d').getImageData(0,0,decoded.width,decoded.height).data,wanted=reference.getContext('2d').getImageData(0,0,reference.width,reference.height).data;
    assert(actual.every((v,i)=>v===wanted[i]),'L’extraction de la ROI a décalé les pixels redressés');
    const after=photo.canvas.getContext('2d').getImageData(0,0,720,520).data;assert(after.every((v,i)=>v===before[i]),'Source modifiée');
  }finally{decoded.canvas.width=reference.width=0;}
});
await check('Une façade droite conserve ses pixels sans flou de rééchantillonnage',async()=>{
  const rect={x:74.2,y:70.3,width:88.1,height:149.3},points=[{x:rect.x,y:rect.y},{x:rect.x+rect.width,y:rect.y},{x:rect.x+rect.width,y:rect.y+rect.height},{x:rect.x,y:rect.y+rect.height}];
  const actual=await rectifyDevice(photo.canvas,points),expected=await cropDevice(photo.canvas,rect);
  const one=await loadPhoto(actual.blob),two=await loadPhoto(expected);
  try{
    assert(one.width===two.width&&one.height===two.height,'Les joints arrondis divergent');
    const a=one.canvas.getContext('2d').getImageData(0,0,one.width,one.height).data,b=two.canvas.getContext('2d').getImageData(0,0,two.width,two.height).data;
    assert(a.every((v,i)=>v===b[i]),'Une façade déjà droite a été rééchantillonnée');
  }finally{one.canvas.width=two.canvas.width=0;}
});
await check('Un bruit de contour sous-pixel conserve le crop droit pixel pour pixel',async()=>{
  const rect={x:74.55,y:70.55,width:87.9,height:148.9};
  const points=[{x:74.43,y:70.43},{x:162.33,y:70.67},{x:162.57,y:219.57},{x:74.67,y:219.33}];
  const straight=[{x:rect.x,y:rect.y},{x:rect.x+rect.width,y:rect.y},{x:rect.x+rect.width,y:rect.y+rect.height},{x:rect.x,y:rect.y+rect.height}];
  const rounded=[{x:75,y:71},{x:162,y:71},{x:162,y:219},{x:75,y:219}];
  const noisy=await rectifyDevice(photo.canvas,points),exact=await rectifyDevice(photo.canvas,straight),expected=await cropDevice(photo.canvas,rect);
  const images=await Promise.all([loadPhoto(noisy.blob),loadPhoto(exact.blob),loadPhoto(expected)]);
  try{
    assert(JSON.stringify(noisy.points)===JSON.stringify(rounded),'Les bords ne sont pas la moyenne arrondie des deux coins');
    assert(JSON.stringify(noisy.points)===JSON.stringify(exact.points),'Les contours réellement découpés divergent');
    const reference=images[2],pixels=reference.canvas.getContext('2d').getImageData(0,0,reference.width,reference.height).data;
    for(const image of images.slice(0,2)){
      assert(image.width===reference.width&&image.height===reference.height,'Dimensions modifiées par le bruit sous-pixel');
      const actual=image.canvas.getContext('2d').getImageData(0,0,image.width,image.height).data;
      assert(actual.every((value,index)=>value===pixels[index]),'Le bruit sous-pixel a déclenché un rééchantillonnage');
    }
  }finally{for(const image of images){image.canvas.width=image.canvas.height=0;}}
});
await check('Image uniforme : aucun diagnostic de netteté inventé',async()=>{const c=document.createElement('canvas');c.width=200;c.height=100;c.getContext('2d').fillRect(0,0,200,100);const quality=clarity(c);assert(quality.score===0&&quality.warning,'Limite non signalée');});
const id='qa-'+crypto.randomUUID();
await check('IndexedDB : sauvegarde, réouverture, Blob et suppression',async()=>{
  const labels=createLabels();labels.famille.valeur='disjoncteur';device=validateDevice({id:'appareil-qa',blob,rect:{modules:1},labels},'Recette');
  const source={id,seance:'seance-qa',name:'Recette',original:photo.blob,rectified:blob,width:720,height:520,devices:[device]};
  await saveSession(source);await closeDatabase();
  const saved=await loadSession(id);assert(saved.devices[0].validatedBy==='Recette','Validation perdue');assert(saved.original instanceof Blob&&saved.original.size===photo.blob.size,'Blob original perdu');
  const meta=(await listSessions()).find(s=>s.id===id);assert(meta&&!('original' in meta)&&meta.seance==='seance-qa','Métadonnées incorrectes');
  await deleteSession(id);assert(await loadSession(id)===null,'Suppression incomplète');
});
await check('IndexedDB : références validées de plusieurs photos, sans images ni propositions',async()=>{
  const firstId=id+'-references-1',secondId=id+'-references-2',second={...device,id:'appareil-'+crypto.randomUUID()};
  const proposal={...device,id:'proposition-'+crypto.randomUUID(),validatedAt:null,validatedBy:null};
  try{
    await saveSession({id:firstId,original:photo.blob,devices:[device,proposal]});
    await saveSession({id:secondId,original:photo.blob,devices:[second]});await closeDatabase();
    const references=await listValidatedDevices(),selected=references.filter(item=>[device.id,second.id,proposal.id].includes(item.id));
    assert(selected.length===2&&!selected.some(item=>item.id===proposal.id),'Une proposition non validée est devenue une référence');
    for(const item of selected){assert(Object.keys(item).sort().join(',')==='id,labels,validatedAt,validatedBy','Une image ou une donnée non nécessaire est renvoyée');assert(JSON.stringify(item.labels)===JSON.stringify(device.labels),'Les valeurs ou provenances des étiquettes ont été transformées');}
    selected[0].labels.famille.valeur='autre';
    assert((await loadSession(firstId)).devices[0].labels.famille.valeur==='disjoncteur','La projection a modifié les données sauvegardées');
  }finally{await deleteSession(firstId);await deleteSession(secondId);}
});
await check('Export réel du PNG validé et de labels.json',async()=>{const zip=await exportBatch({id:'photo-qa',seance:'seance-qa',devices:[device]});const bytes=new Uint8Array(await zip.arrayBuffer());assert(bytes[0]===80&&bytes[1]===75,'Archive ZIP absente');assert(new TextDecoder().decode(bytes).includes('labels.json'),'Étiquettes absentes');});
qa.status=qa.tests.every(t=>t.succes)?'pass':'fail';document.querySelector('#results').textContent=JSON.stringify(qa,null,2);
