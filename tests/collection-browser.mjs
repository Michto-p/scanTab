import {readFile} from 'node:fs/promises';

// Les dessins restent lus par Node puis injectés : aucune ressource de test
// n'est téléchargée par la PWA pendant cette recette hors ligne.
export async function runCollectionBrowserTests({evaluate,call,appBase='/app/',timeoutMs=120000}) {
  const [tableau,prise]=await Promise.all([
    readFile(new URL('./photos/tableau-lecture-autonome.svg',import.meta.url),'utf8'),
    readFile(new URL('./photos/prise-isolee.svg',import.meta.url),'utf8')
  ]);
  await evaluate(`(${startCollectionQA.toString()})(${JSON.stringify({appBase,tableau,prise})})`);
  const deadline=Date.now()+timeoutMs;
  while(Date.now()<deadline){
    const state=await evaluate('window.__collectionQA || null');
    if(state&&state.status!=='pending'){
      if(state.status!=='pass')throw Error('Recette collecte multi-photo : '+JSON.stringify(state));
      return state;
    }
    await new Promise(done=>setTimeout(done,150));
  }
  throw Error('Délai de recette collecte multi-photo dépassé : '+JSON.stringify(await evaluate('window.__collectionQA || null')));
}

function startCollectionQA({appBase,tableau,prise}) {
  const qa=window.__collectionQA={status:'pending',tests:[]};
  const assert=(condition,message)=>{if(!condition)throw Error(message);};
  const pause=ms=>new Promise(done=>setTimeout(done,ms));
  const observers=new Set();
  const automatic=document.querySelector('#auto-after-photo');
  const initialAutomatic=automatic?.checked;
  const initialValidator=document.querySelector('#validator')?.value||'';
  const idle=async()=>{
    const deadline=performance.now()+45000;
    while(document.querySelector('#workspace').getAttribute('aria-busy')==='true'){
      if(performance.now()>deadline)throw Error('Le traitement du lot ne libère pas l’interface.');
      await pause(25);
    }
  };
  const setAutomatic=value=>{automatic.checked=value;automatic.dispatchEvent(new Event('change',{bubbles:true}));};
  const photo=(name,source=tableau)=>new File([source],name+'.svg',{type:'image/svg+xml'});
  const submit=async files=>{
    const transfer=new DataTransfer();files.forEach(file=>transfer.items.add(file));
    const input=document.querySelector('#import-file');input.files=transfer.files;
    input.dispatchEvent(new Event('change',{bubbles:true}));await idle();
  };
  const observe=(node,callback)=>{
    const observer=new MutationObserver(callback);observers.add(observer);
    observer.observe(node,{childList:true,subtree:true,characterData:true});
    return observer;
  };
  const stopObserving=observer=>{observer.disconnect();observers.delete(observer);};
  const pass=nom=>qa.tests.push({nom,succes:true});
  let currentTest='Chargement de la collecte hors ligne';
  void(async()=>{
    try{
      assert(automatic,'L’option de parcours automatique est absente.');await idle();
      const {listSessions,loadSession}=await import(new URL(appBase+'base/store.js',location.href));
      const ids=async()=>new Set((await listSessions()).map(session=>session.id));
      const addedSince=async previous=>(await listSessions()).filter(session=>!previous.has(session.id));
      assert(document.querySelector('#import-file').multiple&&!document.querySelector('#camera-file').multiple,'La galerie doit accepter plusieurs photos et la caméra une seule.');

      currentTest='Un fichier invalide conserve les autres photos du lot et le mode manuel';
      const beforeManual=await ids();setAutomatic(false);
      await submit([photo('première'),new File(['pas une image'],'illisible.jpg',{type:'image/jpeg'}),photo('troisième')]);
      const manual=await addedSince(beforeManual);
      assert(manual.length===2&&new Set(manual.map(session=>session.seance)).size===1,'Une photo valide a été perdue ou la séance a été divisée après le fichier invalide.');
      assert(manual.every(session=>session.deviceCount===0&&session.validatedCount===0),'Le mode manuel a analysé ou validé une photo.');
      const manualMessage=document.querySelector('#message').textContent;
      assert(manualMessage.includes('2 photos enregistrées')&&manualMessage.includes('1 à reprendre'),'Le bilan ne signale pas les deux photos sauvegardées et le fichier invalide.');
      pass(currentTest);

      currentTest='Deux photos sont préparées sans OCR puis leurs sélections sont lues explicitement';
      const beforeAutomatic=await ids();setAutomatic(true);
      await submit([photo('analyse-un'),photo('analyse-deux')]);
      const prepared=await Promise.all((await addedSince(beforeAutomatic)).map(session=>loadSession(session.id)));
      assert(prepared.length===2,'Le lot automatique n’a pas conservé exactement deux photos.');
      assert(new Set(prepared.map(session=>session.seance)).size===1,'Les photos automatiques ne sont pas dans la même séance.');
      assert(prepared.every(session=>session.rectified&&session.devices.length===0&&session.candidates.length===6),'Le lot doit cadrer les photos puis attendre le choix humain avant l’OCR.');
      const analysed=[];
      for(const preparation of prepared){
        document.querySelector('#saved-photos').value=preparation.id;document.querySelector('[data-action="open"]').click();await idle();
        document.querySelector('[data-action="select-all"]').click();await idle();document.querySelector('#read-selection').click();await idle();
        const session=await loadSession(preparation.id);analysed.push(session);
        assert(session.devices.length===6,'La photo '+session.id+' ne contient pas les six appareils attendus.');
        assert(session.devices.some(device=>device.labels.calibre.valeur==='16 A'&&device.recognition?.moteur==='tesseract-embarque'),'L’OCR embarqué n’a pas lu le calibre de la photo '+session.id+'.');
        assert(session.devices.every(device=>device.blob instanceof Blob&&!device.validatedAt&&!device.validatedBy),'Une vignette manque ou un appareil a été validé automatiquement.');
      }
      assert(new Set(analysed.flatMap(session=>session.devices.map(device=>device.id))).size===12,'Les appareils des deux photos partagent leurs identifiants.');
      pass(currentTest);

      currentTest='Toucher un appareil repéré sur la photo ouvre sa vignette';
      const visiblePhoto=await loadSession(document.querySelector('#saved-photos').value),target=visiblePhoto.devices[1].rect,working=await createImageBitmap(visiblePhoto.rectified);
      const photoCanvas=document.querySelector('#photo-canvas'),bounds=photoCanvas.getBoundingClientRect();
      photoCanvas.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:9,pointerType:'touch',clientX:bounds.left+(target.x+target.width/2)/working.width*bounds.width,clientY:bounds.top+(target.y+target.height/2)/working.height*bounds.height}));working.close();
      assert(document.querySelector('.device-heading h2').textContent==='Appareil 2 sur 6','Le cadre touché ne sélectionne pas le deuxième appareil.');
      pass(currentTest);

      currentTest='L’arrêt entre deux photos conserve la première et laisse les suivantes non importées';
      const beforeStop=await ids();setAutomatic(false);
      const betweenPhotos=observe(document.querySelector('#batch-status'),()=>{
        if(document.querySelector('#batch-status').textContent.startsWith('Photo 2/'))document.querySelector('#analysis-cancel').click();
      });
      try{await submit([photo('avant-arrêt'),photo('arrêt'),photo('après-arrêt')]);}
      finally{stopObserving(betweenPhotos);}
      assert((await addedSince(beforeStop)).length===1,'L’arrêt entre les photos n’a pas conservé exactement la première nouvelle photo.');
      assert(document.querySelector('#message').textContent.startsWith('Lot arrêté : 1 photo enregistrée conservée.'),'Le bilan du lot arrêté est absent.');
      pass(currentTest);

      currentTest='L’annulation d’une lecture choisie conserve l’original et les découpes sans validation';
      const beforeOCRStop=await ids();setAutomatic(true);
      await submit([photo('ocr-arrêt')]);
      const duringOCR=observe(document.querySelector('#analysis-status'),()=>{
        if(document.querySelector('#analysis-status').textContent.startsWith('Appareil '))document.querySelector('#analysis-cancel').click();
      });
      try{document.querySelector('[data-action="select-all"]').click();await idle();document.querySelector('#read-selection').click();await idle();}
      finally{stopObserving(duringOCR);}
      const stopped=await addedSince(beforeOCRStop);
      assert(stopped.length===1,'L’annulation OCR a perdu la photo courante.');
      const interrupted=await loadSession(stopped[0].id);
      assert(interrupted.original instanceof Blob&&interrupted.devices.length>0,'L’original ou les découpes ont disparu à l’arrêt de l’OCR.');
      assert(interrupted.devices.every(device=>!device.validatedAt&&!device.validatedBy),'L’arrêt de l’OCR a créé une validation.');
      assert(!document.querySelector('#workspace').inert&&document.querySelector('#analysis-progress').hidden,'L’annulation ne libère pas l’interface.');
      pass(currentTest);

      currentTest='Un appareil isolé est découpé et lu malgré une échelle inconnue';
      let beforeIsolatedOCR;
      const isolatedProgress=observe(document.querySelector('#analysis-status'),()=>{
        if(!beforeIsolatedOCR&&document.querySelector('#analysis-status').textContent.startsWith('Appareil ')){
          beforeIsolatedOCR=loadSession(document.querySelector('#saved-photos').value);
        }
      });
      try{
        await submit([photo('prise-isolée',prise)]);
        const preparedIsolated=await loadSession(document.querySelector('#saved-photos').value);
        assert(preparedIsolated.devices.length===0&&preparedIsolated.candidates.length===1,'La prise isolée doit être proposée sans lecture implicite.');
        document.querySelector('[data-action="select-all"]').click();await idle();document.querySelector('#read-selection').click();await idle();
      }
      finally{stopObserving(isolatedProgress);}
      const beforeReading=await beforeIsolatedOCR;
      assert(beforeReading?.devices.length===1&&beforeReading.devices[0].rect.modules===null,'La découpe isolée exige ou invente un pas de 18 mm avant l’OCR.');
      assert(beforeReading.devices[0].labels.modules.valeur==='inconnu','Une largeur a été attribuée avant toute lecture ou calibration.');
      const isolated=await loadSession(document.querySelector('#saved-photos').value),device=isolated?.devices[0];
      assert(isolated.devices.length===1&&device.rect.modules===null,'La lecture a modifié l’échelle géométrique inconnue.');
      for(const [key,value]of Object.entries({famille:'prise modulaire',marque:'Legrand',reference:'004280',calibre:'16 A',modules:2.5})){
        assert(device.labels[key]?.valeur===value,'Appareil isolé : '+key+' attendu '+value+' ; résultat '+JSON.stringify(device.labels)+' ; OCR '+JSON.stringify(device.recognition));
      }
      assert(device.recognition?.moteur==='tesseract-embarque'&&!device.validatedAt&&!device.validatedBy,'La prise n’a pas été lue localement ou a été validée automatiquement.');
      const bitmap=await createImageBitmap(device.blob);
      try{
        assert(bitmap.width===Math.round(device.rect.x+device.rect.width)-Math.round(device.rect.x)&&bitmap.height===Math.round(device.rect.y+device.rect.height)-Math.round(device.rect.y),'La vignette de l’appareil isolé a été réduite à la taille de l’aperçu.');
        assert(bitmap.width>220&&bitmap.height>380,'La façade isolée a été tronquée.');
      }finally{bitmap.close();}
      pass(currentTest);

      currentTest='Corriger la référence retire le format périmé et la relecture peut le proposer à nouveau';
      const referenceInput=document.querySelector('[data-label="reference"]');referenceInput.value='AUTRE-REFERENCE';referenceInput.dispatchEvent(new Event('input',{bubbles:true}));
      assert(document.querySelector('[data-label="modules"]').value==='inconnu'&&document.querySelector('.dimension-warning'),'Le format de l’ancienne référence reste présenté comme fiable après correction.');
      referenceInput.value='004280';referenceInput.dispatchEvent(new Event('input',{bubbles:true}));
      document.querySelector('[data-action="read-one"]').click();await idle();
      const reread=(await loadSession(isolated.id)).devices[0];
      assert(reread.labels.modules.valeur===2.5&&reread.rect.modules===null&&!reread.validatedAt,'La relecture ne propose plus le format ou modifie le découpage/validation.');
      pass(currentTest);

      currentTest='La validation humaine confirme les 2,5 modules sans changer la vignette';
      const validationName=document.querySelector('[data-validator]');validationName.value='Recette prise isolée';validationName.dispatchEvent(new Event('input',{bubbles:true}));
      const validate=document.querySelector('[data-action="validate"]');assert(validate&&!validate.disabled,'La prise isolée ne peut pas être validée.');validate.click();await idle();
      const confirmed=(await loadSession(isolated.id)).devices[0];
      assert(confirmed.validatedBy==='Recette prise isolée'&&confirmed.validatedAt&&confirmed.rect.modules===2.5,'La validation humaine n’a pas confirmé la largeur de la prise.');
      assert(confirmed.labels.modules.valeur===2.5&&confirmed.labels.modules.confiance===1&&confirmed.labels.modules.niveau==='manuel','La largeur validée n’a pas une provenance humaine explicite.');
      assert(confirmed.blob.size===device.blob.size&&confirmed.rect.x===device.rect.x&&confirmed.rect.y===device.rect.y&&confirmed.rect.width===device.rect.width&&confirmed.rect.height===device.rect.height,'La confirmation de largeur a changé les pixels ou les limites de l’appareil.');
      const [originalPNG,confirmedPNG]=await Promise.all([device.blob.arrayBuffer(),confirmed.blob.arrayBuffer()]);
      const beforeBytes=new Uint8Array(originalPNG),afterBytes=new Uint8Array(confirmedPNG);
      assert(beforeBytes.every((value,index)=>value===afterBytes[index]),'La validation a réencodé ou changé le PNG original.');
      pass(currentTest);

      currentTest='Le ZIP exporte la largeur confirmée et le PNG original de la prise isolée';
      const groupPhotos=await Promise.all((await listSessions()).filter(session=>session.seance===isolated.seance).map(session=>loadSession(session.id)));
      const expectedIds=new Set(groupPhotos.flatMap(session=>session.devices.filter(device=>device.validatedAt&&device.validatedBy).map(device=>device.id)));
      const {createCurrentBatch}=await import(new URL(appBase+'interface/workspace.js',location.href));
      const batch=await createCurrentBatch(),archive=new Uint8Array(await batch.blob.arrayBuffer());
      assert(!batch.unsaved,'L’export repose sur une photo non enregistrée.');
      const view=new DataView(archive.buffer,archive.byteOffset,archive.byteLength),entries=new Map();let offset=0;
      while(offset+30<=archive.length&&view.getUint32(offset,true)===0x04034b50){
        assert(view.getUint16(offset+8,true)===0&&(view.getUint16(offset+6,true)&8)===0,'La recette attend un ZIP sans compression ni descripteur différé.');
        const length=view.getUint32(offset+18,true),nameLength=view.getUint16(offset+26,true),extraLength=view.getUint16(offset+28,true);
        const start=offset+30+nameLength+extraLength,end=start+length;
        assert(end<=archive.length,'Une entrée ZIP dépasse la taille de l’archive.');
        const name=new TextDecoder().decode(archive.subarray(offset+30,offset+30+nameLength));
        assert(!entries.has(name),'Le ZIP contient une entrée en double.');entries.set(name,archive.subarray(start,end));offset=end;
      }
      assert(entries.has('labels.json'),'Le ZIP ne contient pas labels.json.');
      const records=JSON.parse(new TextDecoder().decode(entries.get('labels.json')));
      assert(Array.isArray(records)&&records.length===expectedIds.size&&batch.count===expectedIds.size,'Le ZIP n’exporte pas exactement les validations de la séance.');
      assert(new Set(records.map(record=>record.id)).size===records.length&&records.every(record=>expectedIds.has(record.id)),'Une proposition non validée a été incluse dans le ZIP.');
      assert(records.every(record=>Number.isFinite(record.modules?.valeur)&&record.modules.valeur>0&&Number.isInteger(record.modules.valeur*2)&&record.modules.niveau==='manuel'&&record.modules.confiance===1&&record['validé_par']),'Une largeur inconnue ou non confirmée a été exportée.');
      const record=records.find(record=>record.id===confirmed.id);
      assert(record?.modules.valeur===2.5&&record.modules.niveau==='manuel'&&record['validé_par']==='Recette prise isolée','Le ZIP a perdu la largeur ou la personne ayant validé la prise.');
      const png=entries.get(`vignettes/${confirmed.id}.png`);
      assert(png?.length===beforeBytes.length&&png.every((value,index)=>value===beforeBytes[index]),'Le ZIP ne conserve pas exactement les octets PNG de la vignette originale.');
      assert(entries.size===records.length+1&&records.every(record=>entries.has(`vignettes/${record.id}.png`)),'Le ZIP contient des vignettes sans validation ou omet un appareil validé.');
      pass(currentTest);qa.status='pass';
    }catch(error){
      qa.tests.push({nom:currentTest,succes:false,detail:error.message});qa.status='fail';
      qa.lastMessage=document.querySelector('#message')?.textContent;
    }finally{
      observers.forEach(observer=>observer.disconnect());
      if(automatic)setAutomatic(initialAutomatic);
      const validator=document.querySelector('#validator');if(validator){validator.value=initialValidator;validator.dispatchEvent(new Event('input',{bubbles:true}));}
    }
  })();
  return true;
}
