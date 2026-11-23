import {readFile,mkdir,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';

export async function runCutoutUIBrowserTests({evaluate,call,appBase='/app/',timeoutMs=60000}) {
  const annotation=JSON.parse(await readFile(new URL('./photos/detourage-synthetique.annotations.json',import.meta.url),'utf8'));
  const downloadPath=resolve('.local/qa-cutout-downloads-'+Date.now());await mkdir(downloadPath,{recursive:true});
  await call('Browser.setDownloadBehavior',{behavior:'allow',downloadPath});
  await evaluate(`(${startCutoutUIQA.toString()})(${JSON.stringify({annotation,appBase})})`);
  const deadline=Date.now()+timeoutMs;
  let state;
  while(Date.now()<deadline){
    state=await evaluate('window.__cutoutUIQA || null');
    if(state&&state.status!=='pending')break;
    await new Promise(done=>setTimeout(done,150));
  }
  if(state?.status!=='pass')throw Error('Recette aperçu détourage : '+JSON.stringify(state));
  let file;
  const downloadDeadline=Date.now()+10000;
  while(Date.now()<downloadDeadline){
    file=(await readdir(downloadPath)).find(name=>name.endsWith('-detoure.png'));
    if(file)break;
    await new Promise(done=>setTimeout(done,100));
  }
  if(!file)throw Error('Le bouton de détourage n’a pas téléchargé le PNG attendu.');
  const bytes=await readFile(resolve(downloadPath,file));
  if(!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error('Le fichier téléchargé n’est pas un PNG.');
  const pixels=await evaluate(`(${checkDownloadedCutout.toString()})(${JSON.stringify({base64:bytes.toString('base64'),annotation})})`);
  if(!pixels.valid)throw Error('PNG détouré téléchargé incorrect : '+JSON.stringify(pixels));
  state.tests.push({nom:'Le fichier PNG réellement téléchargé garde sa transparence et ses marquages',succes:true});
  return state;
}

async function checkDownloadedCutout({base64,annotation}) {
  const image=new Image();image.src='data:image/png;base64,'+base64;await image.decode();
  const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
  canvas.getContext('2d').drawImage(image,0,0);
  const pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
  const valid=canvas.width===annotation.width&&canvas.height===annotation.height&&pixels[3]===0&&annotation.protectedPoints.every(([x,y])=>pixels[(y*canvas.width+x)*4+3]===255);
  return {valid,width:canvas.width,height:canvas.height,backgroundAlpha:pixels[3]};
}

function startCutoutUIQA({annotation,appBase}) {
  const qa=window.__cutoutUIQA={status:'pending',tests:[]};
  const assert=(value,message)=>{if(!value)throw Error(message);};
  const pause=ms=>new Promise(done=>setTimeout(done,ms));
  const idle=async()=>{const end=performance.now()+40000;while(document.querySelector('#workspace').getAttribute('aria-busy')==='true'){if(performance.now()>end)throw Error('L’interface de détourage reste occupée.');await pause(50);}};
  const click=async selector=>{const node=document.querySelector(selector);assert(node&&!node.disabled,'Commande indisponible : '+selector);node.click();await idle();};
  const preview=async()=>{
    const image=document.querySelector('.device-preview');await image.decode();
    const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;canvas.getContext('2d').drawImage(image,0,0);
    return {width:canvas.width,height:canvas.height,data:canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data};
  };
  void(async()=>{
    try{
      const {pngBlob}=await import(new URL(appBase+'pretraitement/image.js',location.href));
      const {loadSession}=await import(new URL(appBase+'base/store.js',location.href));
      const automatic=document.querySelector('#auto-after-photo');assert(automatic,'Option d’analyse automatique absente.');automatic.checked=false;automatic.dispatchEvent(new Event('change',{bubbles:true}));
      const canvas=document.createElement('canvas');canvas.width=annotation.width;canvas.height=annotation.height;const context=canvas.getContext('2d');
      const paint=rect=>{context.fillStyle='rgb('+rect.color.join(',')+')';context.fillRect(rect.x,rect.y,rect.width,rect.height);};
      paint({x:0,y:0,width:canvas.width,height:canvas.height,color:annotation.background});paint(annotation.facade);annotation.details.forEach(paint);
      const source=await pngBlob(canvas),input=document.querySelector('#import-file'),transfer=new DataTransfer();transfer.items.add(new File([source],'detourage-annoté.png',{type:'image/png'}));input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));await idle();
      await click('[data-step="perspective"]');await click('[data-action="rectify"]');await click('[data-action="add-row"]');
      for(const [bound,value]of Object.entries({top:0,bottom:100,left:0,right:100})){const slider=document.querySelector('[data-row="0"][data-bound="'+bound+'"]');slider.value=value;slider.dispatchEvent(new Event('input',{bubbles:true}));}
      const modules=document.querySelector('[data-row="0"][data-modules]');modules.value='1';modules.dispatchEvent(new Event('change',{bubbles:true}));
      await click('[data-action="crop"]');
      const session=await loadSession(document.querySelector('#saved-photos').value),device=session?.devices[0];
      assert(session?.devices.length===1&&device.blob instanceof Blob&&device.cutoutBlob instanceof Blob&&device.cutout?.applied,'La vignette et son détourage n’ont pas été conservés séparément.');
      assert(!device.validatedAt&&!device.validatedBy,'La création du détouré a validé l’appareil.');
      let pixels=await preview();assert(pixels.width===annotation.width&&pixels.height===annotation.height&&pixels.data[3]===0,'L’aperçu initial ne présente pas le PNG détouré à sa résolution originale.');
      for(const [x,y]of annotation.protectedPoints)assert(pixels.data[(y*pixels.width+x)*4+3]===255,'L’aperçu a effacé un détail interne.');
      await click('[data-action="toggle-cutout"]');pixels=await preview();
      assert(pixels.data[3]===255&&annotation.background.every((value,index)=>pixels.data[index]===value),'Le comparateur ne restitue pas la vignette originale opaque.');
      await click('[data-action="toggle-cutout"]');pixels=await preview();assert(pixels.data[3]===0,'Le retour au détouré ne fonctionne pas.');
      qa.tests.push({nom:'Aperçu détouré et comparaison avec l’original, sans validation automatique',succes:true});
      await click('[data-action="export-cutout"]');qa.status='pass';
    }catch(error){qa.tests.push({nom:'Aperçu et téléchargement du détourage',succes:false,detail:error.message});qa.status='fail';}
  })();
  return true;
}

export async function runCutoutBrowserTests({evaluate,appBase='/app/',timeoutMs=30000}) {
  const annotation=JSON.parse(await readFile(new URL('./photos/detourage-synthetique.annotations.json',import.meta.url),'utf8'));
  await evaluate(`(${startCutoutQA.toString()})(${JSON.stringify({annotation,appBase})})`);
  const deadline=Date.now()+timeoutMs;
  while(Date.now()<deadline){
    const state=await evaluate('window.__cutoutQA || null');
    if(state&&state.status!=='pending'){
      if(state.status!=='pass')throw Error('Recette détourage : '+JSON.stringify(state));
      return state;
    }
    await new Promise(done=>setTimeout(done,150));
  }
  throw Error('Délai de recette détourage dépassé : '+JSON.stringify(await evaluate('window.__cutoutQA || null')));
}

function startCutoutQA({annotation,appBase}) {
  const qa=window.__cutoutQA={status:'pending',tests:[]};
  const assert=(value,message)=>{if(!value)throw Error(message);};
  void(async()=>{
    try{
      const [{calculateImage},{pngBlob}]=await Promise.all([import(new URL(appBase+'pretraitement/calcul.js',location.href)),import(new URL(appBase+'pretraitement/image.js',location.href))]);
      const scene=background=>{
        const {width,height}=annotation,data=new Uint8ClampedArray(width*height*4);
        const paint=rect=>{for(let y=rect.y;y<rect.y+rect.height;y++)for(let x=rect.x;x<rect.x+rect.width;x++)data.set([...rect.color,255],(y*width+x)*4);};
        paint({x:0,y:0,width,height,color:background});paint(annotation.facade);annotation.details.forEach(paint);return {width,height,data};
      };
      const pixels=scene(annotation.background),original=pixels.data.slice();
      const canvas=document.createElement('canvas');canvas.width=pixels.width;canvas.height=pixels.height;
      canvas.getContext('2d').putImageData(new ImageData(original.slice(),pixels.width,pixels.height),0,0);
      const originalPNG=await pngBlob(canvas);
      const result=await calculateImage('détourage',pixels);
      assert(pixels.data.byteLength===0,'Le détourage n’a pas transféré les pixels au worker.');
      assert(result.applied&&result.confidence>=.8,'Le fond uniforme de la recette n’a pas été isolé.');
      assert(JSON.stringify(result.bounds)===JSON.stringify(annotation.expectedBounds),'Contour différent des annotations.');
      assert(result.imageData.width===annotation.width&&result.imageData.height===annotation.height,'Les dimensions originales ont été réduites.');
      for(let p=0;p<original.length;p+=4)for(let channel=0;channel<3;channel++)assert(original[p+channel]===result.imageData.data[p+channel],'Un pixel RGB a été altéré par le masque.');
      canvas.getContext('2d').putImageData(new ImageData(result.imageData.data,result.imageData.width,result.imageData.height),0,0);
      const cutoutPNG=await pngBlob(canvas),bitmap=await createImageBitmap(cutoutPNG);
      try{canvas.getContext('2d').clearRect(0,0,canvas.width,canvas.height);canvas.getContext('2d').drawImage(bitmap,0,0);}
      finally{bitmap.close();}
      const decoded=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
      assert(decoded[3]===0,'Le PNG exportable n’a pas conservé la transparence du fond.');
      for(const [x,y]of annotation.protectedPoints){const offset=(y*annotation.width+x)*4;for(let c=0;c<4;c++)assert(decoded[offset+c]===original[offset+c],'Un marquage ou détail interne a été effacé.');}
      const originalBitmap=await createImageBitmap(originalPNG);
      try{canvas.getContext('2d').clearRect(0,0,canvas.width,canvas.height);canvas.getContext('2d').drawImage(originalBitmap,0,0);}
      finally{originalBitmap.close();}
      assert(canvas.getContext('2d').getImageData(0,0,1,1).data[3]===255,'La création du détouré a modifié la vignette originale.');
      qa.tests.push({nom:'Worker local : PNG transparent, pleine résolution et marquages internes conservés',succes:true});
      const ambiguous=await calculateImage('détourage',scene([229,231,230]));
      assert(!ambiguous.applied&&ambiguous.imageData.data.every((value,index)=>index%4!==3||value===255),'Un fond ambigu a été effacé.');
      qa.tests.push({nom:'Un fond ambigu conserve la vignette opaque',succes:true});qa.status='pass';
    }catch(error){qa.tests.push({nom:'Détourage réel hors ligne',succes:false,detail:error.message});qa.status='fail';}
  })();
  return true;
}

export async function runAutonomousUIBrowserTests({evaluate,appBase='/app/',timeoutMs=120000}) {
  const source=await readFile(new URL('./photos/tableau-lecture-autonome.svg',import.meta.url),'utf8');
  const annotation=JSON.parse(await readFile(new URL('./photos/tableau-lecture-autonome.annotations.json',import.meta.url),'utf8'));
  await evaluate(`(${startAutonomousUIQA.toString()})(${JSON.stringify({source,annotation,appBase})})`);
  const deadline=Date.now()+timeoutMs;
  while(Date.now()<deadline){
    const state=await evaluate('window.__autonomousQA || null');
    if(state&&state.status!=='pending'){
      if(state.status!=='pass')throw Error('Recette tableau autonome : '+JSON.stringify(state));
      return state;
    }
    await new Promise(done=>setTimeout(done,150));
  }
  throw Error('Délai de recette tableau autonome dépassé : '+JSON.stringify(await evaluate('window.__autonomousQA || null')));
}

function startAutonomousUIQA({source,annotation,appBase}) {
  const qa=window.__autonomousQA={status:'pending',tests:[]};
  const assert=(value,message)=>{if(!value)throw Error(message);};
  const pause=ms=>new Promise(done=>setTimeout(done,ms));
  const idle=async()=>{
    const deadline=performance.now()+100000;
    while(document.querySelector('#workspace').getAttribute('aria-busy')==='true'){
      if(performance.now()>deadline)throw Error('Opération encore active après 100 secondes.');
      await pause(100);
    }
  };
  void(async()=>{
    try{
      assert(navigator.serviceWorker.controller,'La PWA doit être contrôlée par son service worker.');
      const {loadSession}=await import(new URL(appBase+'base/store.js',location.href));
      const importFixture=async()=>{
        const input=document.querySelector('#import-file'),transfer=new DataTransfer();
        transfer.items.add(new File([source],'tableau-lecture-autonome.svg',{type:'image/svg+xml'}));
        input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));await idle();
      };
      const automatic=document.querySelector('#auto-after-photo');
      assert(automatic,'L’option d’analyse après photo est absente.');
      automatic.checked=false;automatic.dispatchEvent(new Event('change',{bubbles:true}));
      await importFixture();
      const manual=await loadSession(document.querySelector('#saved-photos').value);
      assert(!manual.rectified&&manual.devices.length===0,'Le mode manuel a démarré une analyse après l’import.');
      assert(document.querySelector('[data-action="auto-analyze"]')&&!document.querySelector('#workspace').inert,'Le mode manuel ne propose plus sa commande de lancement.');
      qa.tests.push({nom:'L’analyse désactivée respecte l’import manuel hors ligne',succes:true});
      const option=document.querySelector('#auto-after-photo');option.checked=true;option.dispatchEvent(new Event('change',{bubbles:true}));
      let cancelledBeforeOCR=false;
      const progress=document.querySelector('#analysis-progress'),stageObserver=new MutationObserver(()=>{
        const status=document.querySelector('#analysis-status').textContent;
        if(!progress.hidden&&/Recherche.*cadrage/i.test(status)){
          cancelledBeforeOCR=true;qa.cancelledStage=status;stageObserver.disconnect();document.querySelector('#analysis-cancel').click();
        }
      });
      stageObserver.observe(progress,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['hidden']});
      try{await importFixture();}finally{stageObserver.disconnect();}
      assert(cancelledBeforeOCR,'La recherche de cadrage ne propose pas d’arrêt avant l’OCR.');
      assert(/annul/i.test(document.querySelector('#message').textContent),'L’annulation du cadrage n’a pas été signalée.');
      assert(!document.querySelector('#workspace').inert&&progress.hidden,'L’interface reste bloquée après l’annulation du cadrage.');
      const interrupted=await loadSession(document.querySelector('#saved-photos').value);
      assert(interrupted.devices.every(device=>!device.validatedAt&&!device.validatedBy),'Le cadrage annulé a validé un appareil.');
      qa.tests.push({nom:'La recherche de cadrage automatique peut être arrêtée avant l’OCR',succes:true});
      const started=performance.now();await importFixture();qa.durationMs=Math.round(performance.now()-started);
      assert(document.querySelectorAll('.thumbnail').length===6,'Le tableau de huit modules doit fournir six vignettes : '+document.querySelector('#message').textContent);
      const id=document.querySelector('#saved-photos').value;
      const session=await loadSession(id);
      assert(session?.devices.length===6,'La séance complète n’a pas été sauvegardée.');
      assert(session.width===annotation.width&&session.height===annotation.height,'Les dimensions originales n’ont pas été conservées.');
      const row=session.rows[0],expected=annotation.rows[0];
      assert(session.rows.length===1&&row.modules===8,'L’échelle a été forcée à un nombre de modules incorrect.');
      assert(JSON.stringify(session.devices.map(device=>device.rect.modules))===JSON.stringify(expected.devices.map(device=>device.modules)),'Les appareils de deux modules ont été divisés.');
      assert(Math.abs(row.scale.pixelsPerModule-annotation.pixelsPerModule)<2,'Le pas de 18 mm a été mal estimé.');
      qa.tests.push({nom:'L’import démarre seul le cadrage, l’échelle et six appareils de largeurs variables',succes:true});
      for(const [index,device]of session.devices.entries()){
        assert(!device.validatedAt&&!device.validatedBy,'L’appareil '+(index+1)+' a été validé automatiquement.');
        assert(device.blob instanceof Blob&&device.blob.type==='image/png','Vignette PNG absente.');
        const bitmap=await createImageBitmap(device.blob);
        try{assert(Math.abs(bitmap.width-expected.devices[index].modules*annotation.pixelsPerModule)<4&&Math.abs(bitmap.height-(expected.bottom-expected.top))<4,'La découpe a perdu sa pleine résolution.');}
        finally{bitmap.close();}
      }
      qa.tests.push({nom:'Vignettes pleine résolution sauvegardées sans aucune validation automatique',succes:true});
      for(const [index,device]of session.devices.entries()){
        for(const [key,value]of Object.entries(expected.devices[index])){
          assert(device.labels[key]?.valeur===value,'Appareil '+(index+1)+' : '+key+' attendu '+value+' ; résultat '+JSON.stringify(device.labels)+' ; OCR '+JSON.stringify(device.recognition));
          if(key!=='modules')assert(device.labels[key].confiance>=.8&&device.labels[key].niveau!=='manuel','Appareil '+(index+1)+' : score ou provenance automatique perdu.');
        }
      }
      assert(document.querySelector('#summary').textContent.includes('0 validées'),'Le compteur ne reflète pas les vignettes encore non validées.');
      qa.tests.push({nom:'Les marquages proposent différentiel, disjoncteur et contacteur sans PC',succes:true});
      qa.readings=session.devices.map(device=>({modules:device.rect.modules,champs:device.labels,texte:device.recognition?.texte}));
      // Le signal est envoyé pendant une vraie reconnaissance dans le worker,
      // après réception d'une progression du premier appareil de la rangée.
      document.querySelector('[data-action="read-row"]').click();
      const cancelDeadline=performance.now()+10000;
      while(!document.querySelector('#analysis-status').textContent.startsWith('Appareil 1/6')||document.querySelector('#analysis-progress').hidden){
        if(performance.now()>cancelDeadline)throw Error('Aucune progression de lecture disponible pour tester l’annulation en cours.');
        await pause(5);
      }
      assert(document.querySelector('#workspace').inert,'La collecte doit être immobilisée pendant la lecture.');
      document.querySelector('#analysis-cancel').click();await idle();
      assert(/annul/i.test(document.querySelector('#message').textContent),'L’arrêt n’a pas été signalé.');
      assert(!document.querySelector('#workspace').inert&&document.querySelector('#analysis-progress').hidden,'L’interface reste bloquée après annulation.');
      const edited=document.querySelector('[data-label="calibre"]');edited.value='63 A';edited.dispatchEvent(new Event('input',{bubbles:true}));
      document.querySelector('[data-action="read-one"]').click();await idle();
      const resumed=await loadSession(id);
      assert(/Analyse terminée/.test(document.querySelector('#message').textContent),'La lecture ne redémarre pas après arrêt du worker.');
      assert(resumed.devices[0].labels.calibre.valeur==='63 A'&&resumed.devices[0].labels.calibre.niveau==='manuel','La relecture a remplacé la correction humaine.');
      assert(resumed.devices.every(device=>!device.validatedAt&&!device.validatedBy),'La relecture a créé une validation automatique.');
      assert(!document.querySelector('#workspace').inert&&document.querySelector('#analysis-progress').hidden,'La fin de relecture ne restaure pas les commandes.');
      qa.tests.push({nom:'Annulation pendant l’OCR, redémarrage et correction humaine préservée',succes:true});
      document.querySelector('[data-step="rows"]').click();
      document.querySelector('[data-action="calibrate-row"]').click();await idle();
      const canvas=document.querySelector('#photo-canvas'),bounds=canvas.getBoundingClientRect();
      const working=await createImageBitmap(resumed.rectified),calibrationRow=resumed.rows[0];
      for(const x of [calibrationRow.left+2*calibrationRow.scale.pixelsPerModule,calibrationRow.left+3*calibrationRow.scale.pixelsPerModule]){
        const coordinates={clientX:bounds.left+x/working.width*bounds.width,clientY:bounds.top+(calibrationRow.top+calibrationRow.bottom)/2/working.height*bounds.height,pointerId:7,pointerType:'touch',bubbles:true};
        canvas.dispatchEvent(new PointerEvent('pointerdown',{...coordinates,buttons:1}));
        canvas.dispatchEvent(new PointerEvent('pointerup',{...coordinates,buttons:0}));
      }
      working.close();
      assert(/Échelle établie/.test(document.querySelector('#message').textContent),'Les deux touches n’ont pas établi le repère de 18 mm.');
      assert(document.querySelector('[data-row="0"][data-modules]').value==='8','Le repère d’un module n’a pas conservé les huit modules de la rangée.');
      // Le redécoupage constitue une action destructive confirmée uniquement
      // dans la recette ; le dialogue natif est restauré immédiatement.
      const originalConfirm=window.confirm;window.confirm=()=>true;
      try{document.querySelector('[data-action="crop"]').click();}
      finally{window.confirm=originalConfirm;}
      await idle();
      const calibrated=await loadSession(id);
      assert(calibrated.rows[0].scale.source==='repere-18-mm'&&Math.abs(calibrated.rows[0].scale.pixelsPerModule-100)<1,'La calibration de 18 mm n’a pas été enregistrée.');
      assert(!calibrated.cutsDirty&&calibrated.devices.length===6&&document.querySelector('.badge'),'Le redécoupage après calibration ne restaure pas la vue des appareils.');
      assert(calibrated.devices.every(device=>!device.validatedAt&&!device.validatedBy),'La calibration a créé une validation humaine.');
      qa.tests.push({nom:'Deux touches calibrent le repère de 18 mm puis le découpage reste utilisable',succes:true});
      qa.status='pass';
    }catch(error){qa.tests.push({nom:'Parcours autonome photo → échelle → découpe → lecture',succes:false,detail:error.message});qa.status='fail';}
  })();
  return true;
}

// Ce module est chargé par Node : la recette reste exécutable après avoir coupé
// le réseau du navigateur, sans ajouter les outils de test au cache de la PWA.
export async function runMobileOCRBrowserTests({evaluate,appBase='/app/',timeoutMs=120000}) {
  const source=await readFile(new URL('./photos/ocr-marquages.svg',import.meta.url));
  const fixture='data:image/svg+xml;base64,'+source.toString('base64');
  await evaluate(`(${startMobileQA.toString()})(${JSON.stringify({appBase,fixture})})`);
  const deadline=Date.now()+timeoutMs;
  while(Date.now()<deadline){
    const state=await evaluate('window.__mobileQA || null');
    if(state&&state.status!=='pending'){
      if(state.status!=='pass')throw Error('Recette OCR mobile : '+JSON.stringify(state));
      return state;
    }
    await new Promise(done=>setTimeout(done,150));
  }
  throw Error('Délai de recette OCR mobile dépassé : '+JSON.stringify(await evaluate('window.__mobileQA || null')));
}

function startMobileQA({appBase,fixture}) {
  const qa=window.__mobileQA={status:'pending',tests:[],progress:[]};
  const assert=(value,message)=>{if(!value)throw Error(message);};
  const check=async(nom,fn)=>{
    try{await fn();qa.tests.push({nom,succes:true});}
    catch(error){qa.tests.push({nom,succes:false,detail:error.message});}
  };
  void(async()=>{
    let terminate;
    try{
      assert(navigator.serviceWorker.controller,'La page doit être contrôlée par le service worker.');
      const [{recognizeLocal,terminateLocalOCR},{cropDevice,pngBlob},{createLabels},{exportBatch}]=await Promise.all([
        import(new URL(appBase+'identification/local.js',location.href)),
        import(new URL(appBase+'pretraitement/image.js',location.href)),
        import(new URL(appBase+'interface/labels.js',location.href)),
        import(new URL(appBase+'exports/zip.js',location.href))
      ]);
      terminate=terminateLocalOCR;
      let blob,recognition;
      await check('Vignette OCR découpée dans les pixels de pleine résolution',async()=>{
        const image=new Image();image.src=fixture;await image.decode();
        const photo=document.createElement('canvas');photo.width=image.naturalWidth+440;photo.height=image.naturalHeight+240;
        const ctx=photo.getContext('2d');ctx.fillStyle='#aaa';ctx.fillRect(0,0,photo.width,photo.height);ctx.drawImage(image,220,120);
        blob=await cropDevice(photo,{x:220,y:120,width:image.naturalWidth,height:image.naturalHeight});
        const cropped=await createImageBitmap(blob);
        try{assert(cropped.width===600&&cropped.height===720,'La vignette a été réduite à la taille de l’aperçu.');}
        finally{cropped.close();}
      });
      await check('Tesseract embarqué lit les marquages sans serveur PC ni réseau',async()=>{
        assert(blob,'La vignette de recette est absente.');
        const started=performance.now();let ticks=0;const heartbeat=setInterval(()=>ticks++,25);
        try{recognition=await recognizeLocal(blob,{onProgress:event=>{if(qa.progress.length<30)qa.progress.push(typeof event==='string'?event:event?.status||'progression');}});}
        finally{clearInterval(heartbeat);qa.ocrDurationMs=Math.round(performance.now()-started);qa.uiHeartbeats=ticks;}
        assert(recognition.moteur==='tesseract-embarque','L’analyse n’a pas utilisé le moteur embarqué.');
        for(const [key,value]of Object.entries({marque:'Hager',calibre:'16 A',courbe:'C',sensibilite:'30 mA'})){
          const field=recognition.champs?.[key];
          assert(field?.valeur===value,key+' : '+JSON.stringify(field)+' ; texte lu : '+recognition.texte);
          assert(field.confiance>=.8&&field.confiance<=1&&field.niveau!=='manuel',key+' : provenance ou score OCR invalide.');
        }
        assert(qa.ocrDurationMs<150||ticks>=2,'Le moteur a bloqué l’interface principale.');
        qa.texte=recognition.texte;
      });
      await check('Les propositions OCR ne deviennent pas des validations exportables',async()=>{
        assert(recognition,'L’OCR de recette n’a pas abouti.');
        assert(!recognition.validatedAt&&!recognition.validatedBy,'Le moteur a créé une validation humaine.');
        const labels={...createLabels(),...recognition.champs,modules:{valeur:1,confiance:0,niveau:'decoupage'}};
        const device={id:'ocr-sans-validation',blob,rect:{modules:1},labels,validatedAt:null,validatedBy:null};
        let rejected=false;
        try{await exportBatch({id:'qa-mobile',seance:'qa-mobile',devices:[device]});}
        catch(error){rejected=/valid/i.test(error.message);}
        assert(rejected,'Une proposition non validée a été exportée pour l’apprentissage.');
      });
      await check('Une image blanche laisse tous les marquages inconnus',async()=>{
        const blank=document.createElement('canvas');blank.width=300;blank.height=400;
        const ctx=blank.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,blank.width,blank.height);
        const result=await recognizeLocal(await pngBlob(blank));
        assert(result.champs&&Object.keys(result.champs).length>0,'Résultat vide sans valeurs inconnues explicites.');
        for(const [key,field]of Object.entries(result.champs))assert(field.valeur==='inconnu',key+' inventé sur une image blanche : '+JSON.stringify(field));
      });
      await check('Une demande annulée avant démarrage ne lance pas une lecture',async()=>{
        const controller=new AbortController();controller.abort();let rejected=false;
        try{await recognizeLocal(blob,{signal:controller.signal});}
        catch(error){rejected=error.name==='AbortError'||/annul|abort/i.test(error.message);}
        assert(rejected,'L’analyse a ignoré le signal d’annulation.');
      });
    }catch(error){qa.tests.push({nom:'Chargement des modules OCR hors ligne',succes:false,detail:error.message});}
    finally{
      try{await terminate?.();}catch(error){qa.tests.push({nom:'Arrêt du moteur OCR',succes:false,detail:error.message});}
      qa.status=qa.tests.length>0&&qa.tests.every(test=>test.succes)?'pass':'fail';
    }
  })();
  return true;
}
