import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

// Recette du parcours photo → sélection → lecture. Le dessin est synthétique :
// ces contrôles ne mesurent aucune précision métier sur photographies réelles.
export async function runGuidedBrowserTests({evaluate,call,appBase='/app/',timeoutMs=120000}) {
  const [source,annotations]=await Promise.all([
    readFile(new URL('./photos/tableau-lecture-autonome.svg',import.meta.url),'utf8'),
    readFile(new URL('./photos/tableau-lecture-autonome.annotations.json',import.meta.url),'utf8')
  ]);
  const annotation=JSON.parse(annotations),tests=[];
  const deadline=Date.now()+timeoutMs;
  const pause=ms=>new Promise(done=>setTimeout(done,ms));
  const until=async(expression,message)=>{
    while(Date.now()<deadline){if(await evaluate(expression))return;await pause(75);}
    throw Error(message);
  };
  const idle=()=>until('document.querySelector("#workspace").getAttribute("aria-busy") !== "true"','La sélection ne libère pas l’interface.');
  const click=async selector=>{
    await evaluate(`(()=>{const node=document.querySelector(${JSON.stringify(selector)});if(!node||node.disabled)throw Error('Commande indisponible : '+${JSON.stringify(selector)});node.click();})()`);
    await idle();
  };
  const check=async(nom,expression)=>{
    const result=await evaluate(expression);
    if(result!==true)throw Error(nom+' : '+JSON.stringify(result));
    tests.push({nom,succes:true});
  };
  const captures=[];
  const captureMobile=async name=>{
    await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
    try{
      await evaluate(`(async()=>{scrollTo(0,0);await new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)));})()`);
      const shot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true}),path=resolve('.local/'+name+'.png');
      await mkdir(resolve('.local'),{recursive:true});await writeFile(path,Buffer.from(shot.data,'base64'));captures.push(path);
    }finally{await call('Emulation.clearDeviceMetricsOverride');}
  };
  // Les événements natifs produisent de vrais pointerdown/move/up et permettent
  // au canvas d’utiliser sa capture de pointeur comme sur le téléphone.
  const touch=async(points)=>{
    await call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...points[0],id:1,radiusX:2,radiusY:2}]});
    for(const point of points.slice(1))await call('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...point,id:1,radiusX:2,radiusY:2}]});
    await call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await idle();
  };
  const gesturePoints=async expression=>evaluate(`(async()=>{
    const canvas=document.querySelector('#photo-canvas');canvas.scrollIntoView({block:'center'});
    const bounds=canvas.getBoundingClientRect(),session=await window.__guided.load(),bitmap=await createImageBitmap(session.rectified||session.original);
    const view=JSON.parse(canvas.dataset.view||JSON.stringify({x:0,y:0,width:bitmap.width,height:bitmap.height}));
    try{return (${expression}).map(point=>({x:bounds.left+(point.x-view.x)/view.width*bounds.width,y:bounds.top+(point.y-view.y)/view.height*bounds.height}));}
    finally{bitmap.close();}
  })()`);
  const importFixture=async()=>{
    await evaluate(`(()=>{const transfer=new DataTransfer();transfer.items.add(new File([${JSON.stringify(source)}],'tableau-guidé.svg',{type:'image/svg+xml'}));const input=document.querySelector('#import-file');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await idle();
  };
  let currentTest='Chargement du parcours guidé';
  try{
    await evaluate(`(async()=>{
      const {loadSession}=await import(new URL(${JSON.stringify(appBase+'base/store.js')},location.href));
      const automatic=document.querySelector('#auto-after-photo');
      window.__guided={load:()=>loadSession(document.querySelector('#saved-photos').value),automatic:automatic.checked};
      automatic.checked=true;automatic.dispatchEvent(new Event('change',{bubbles:true}));
      if(!navigator.serviceWorker.controller)throw Error('La recette doit utiliser la PWA contrôlée par son service worker.');
    })()`);
    await call('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});

    currentTest='L’import cadre et propose des appareils sans lancer l’OCR';
    await importFixture();
    await check(currentTest,`(async()=>{const s=await window.__guided.load();return !!s?.rectified&&s.original instanceof Blob&&s.devices.length===0&&s.candidates.length>=6&&document.querySelectorAll('.thumbnail').length===0&&!!document.querySelector('[data-action="draw-selection"]');})()`);

    currentTest='Un geste encadre la rangée et demande sa largeur totale en modules';
    await click('[data-action="draw-selection"]');
    const points=await gesturePoints(`(()=>{const row=session.rows[0];return [{x:row.left,y:row.top},{x:(row.left+row.right)/2,y:(row.top+row.bottom)/2},{x:row.right,y:row.bottom}];})()`);
    await touch(points);
    await check(currentTest,`!!document.querySelector('#selection-modules')&&!!document.querySelector('#read-selection')&&!document.querySelector('#read-selection').disabled`);
    await until(`(async()=>!!(await window.__guided.load()).selection?.bounds)()`,'La zone choisie n’est pas sauvegardée.');
    await check('Le cadrage affiché rapproche la zone choisie et conserve ses coordonnées originales',`(async()=>{const s=await window.__guided.load(),canvas=document.querySelector('#photo-canvas'),view=JSON.parse(canvas.dataset.view),b=s.selection.bounds,bitmap=await createImageBitmap(s.rectified);try{return (view.width<bitmap.width||view.height<bitmap.height)&&view.x<=b.x&&view.y<=b.y&&view.x+view.width>=b.x+b.width&&view.y+view.height>=b.y+b.height;}finally{bitmap.close();}})()`);
    await evaluate(`(()=>{const input=document.querySelector('#selection-modules');input.value='8';input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await idle();
    await check('Confirmer huit modules ne lance pas de lecture',`(async()=>{const s=await window.__guided.load();return s.devices.length===0&&document.querySelector('#selection-modules').value==='8';})()`);
    await captureMobile('recette-guidage-selection-mobile');

    currentTest='Huit modules suivent les joints et donnent six appareils de largeurs variables';
    const started=Date.now();await click('#read-selection');
    const durationMs=Date.now()-started;
    await check(currentTest,`(async()=>{
      const s=await window.__guided.load(),expected=${JSON.stringify(annotation.rows[0].devices.map(device=>device.modules))};
      return s.devices.length===6&&JSON.stringify(s.devices.map(device=>device.rect.modules))===JSON.stringify(expected)&&document.querySelectorAll('.thumbnail').length===6;
    })()`);
    await check('Les PNG gardent la résolution de leurs rectangles et aucune validation automatique',`(async()=>{
      const s=await window.__guided.load();
      for(const device of s.devices){
        if(!(device.blob instanceof Blob)||device.blob.type!=='image/png'||device.validatedAt||device.validatedBy)return false;
        const bitmap=await createImageBitmap(device.blob),r=device.rect;
        try{if(bitmap.width!==Math.round(r.x+r.width)-Math.round(r.x)||bitmap.height!==Math.round(r.y+r.height)-Math.round(r.y)||bitmap.height<350)return false;}
        finally{bitmap.close();}
      }
      return true;
    })()`);

    currentTest='Tesseract local lit les appareils seulement après la sélection';
    await check(currentTest,`(async()=>{
      const s=await window.__guided.load(),expected=${JSON.stringify(annotation.rows[0].devices)};
      for(const [index,device]of s.devices.entries()){
        if(device.recognition?.moteur!=='tesseract-embarque')return {index,recognition:device.recognition};
        for(const [key,value]of Object.entries(expected[index])){
          const field=device.labels[key];
          if(field?.valeur!==value||(key!=='modules'&&(field.confiance<.8||field.niveau==='manuel')))return {index,key,expected:value,field,texte:device.recognition?.texte};
        }
      }
      return true;
    })()`);

    currentTest='Le formulaire du disjoncteur affiche seulement ses caractéristiques utiles';
    await click('[data-device="1"]');
    await check(currentTest,`!!document.querySelector('[data-label="calibre"]')&&!!document.querySelector('[data-label="courbe"]')&&!document.querySelector('[data-label="sensibilite"]')&&!document.querySelector('[data-label="classe"]')&&!document.querySelector('select[data-label="famille"]')&&!!document.querySelector('[data-action="edit-family"]')`);
    await captureMobile('recette-guidage-lecture-mobile');
    await check('Les vignettes restent disponibles dans un rail horizontal',`(()=>{const rail=document.querySelector('#thumbnails');return !rail.hidden&&/auto|scroll/.test(getComputedStyle(rail).overflowX)&&rail.querySelectorAll('button').length===6;})()`);

    currentTest='Une correction humaine de famille retire les valeurs différentielles incompatibles';
    await click('[data-device="0"]');await click('[data-action="edit-family"]');
    await evaluate(`(()=>{const input=document.querySelector('select[data-label="famille"]');if(!input)throw Error('La correction du type n’ouvre pas le choix de famille.');input.value='disjoncteur';input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await until(`(async()=>{const s=await window.__guided.load();return s.devices[0].labels.famille.valeur==='disjoncteur';})()`,'La famille corrigée n’est pas sauvegardée.');
    await check(currentTest,`(async()=>{const device=(await window.__guided.load()).devices[0];return device.labels.famille.niveau==='manuel'&&device.labels.sensibilite.valeur==='inconnu'&&device.labels.classe.valeur==='inconnu'&&!device.validatedAt&&!device.validatedBy&&!document.querySelector('[data-label="sensibilite"]')&&!document.querySelector('[data-label="classe"]');})()`);
    const savedId=await evaluate('document.querySelector("#saved-photos").value');
    await click('[data-action="back-selection"]');
    await evaluate(`document.querySelector('#saved-photos').value=${JSON.stringify(savedId)}`);await click('[data-action="open"]');
    await check('Rouvrir la photo conserve les pixels, six découpes et la correction de famille',`(async()=>{const s=await window.__guided.load();return s.devices.length===6&&s.devices[0].labels.famille.valeur==='disjoncteur'&&s.devices[0].labels.sensibilite.valeur==='inconnu'&&s.devices.every(d=>d.blob instanceof Blob&&!d.validatedAt&&!d.validatedBy);})()`);

    currentTest='Toucher seulement deux propositions limite les découpes et l’OCR à ces appareils';
    await importFixture();
    for(const index of [1,3]){
      const point=await gesturePoints(`(()=>{const c=session.candidates[${index}];return [{x:(c.left+c.right)/2,y:(c.top+c.bottom)/2}];})()`);
      await touch(point);
    }
    await check('Deux touches sélectionnent deux appareils sans les lire',`(async()=>{const s=await window.__guided.load();return s.devices.length===0&&document.querySelector('#selection-count').textContent.includes('2');})()`);
    await click('#read-selection');
    await check(currentTest,`(async()=>{const s=await window.__guided.load();return s.devices.length===2&&JSON.stringify(s.devices.map(d=>d.labels.calibre.valeur))===JSON.stringify(['16 A','20 A'])&&s.devices.every(d=>d.recognition?.moteur==='tesseract-embarque'&&!d.validatedAt&&!d.validatedBy);})()`);
    currentTest='La prise masque les champs de protection et un type inconnu propose son choix';
    await click('[data-action="edit-family"]');
    await evaluate(`(()=>{const input=document.querySelector('select[data-label="famille"]');input.value='prise modulaire';input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await check('Une prise ne présente aucun champ de courbe ou de différentiel',`!document.querySelector('[data-label="courbe"]')&&!document.querySelector('[data-label="sensibilite"]')&&!document.querySelector('[data-label="classe"]')`);
    await click('[data-action="edit-family"]');
    await evaluate(`(()=>{const input=document.querySelector('select[data-label="famille"]');input.value='inconnu';input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await check(currentTest,`document.querySelector('select[data-label="famille"]')?.value==='inconnu'`);
    await until(`(async()=>{const s=await window.__guided.load();return s.devices[0].labels.famille.valeur==='inconnu';})()`,'Le type inconnu corrigé n’est pas sauvegardé.');
    await evaluate(`(async()=>{const s=await window.__guided.load();window.__guided.previousDevices=await Promise.all(s.devices.map(async d=>({id:d.id,bytes:new Uint8Array(await d.blob.arrayBuffer()),family:d.labels.famille.valeur})));})()`);
    currentTest='Revenir à la photo permet d’ajouter deux appareils sans perdre les premières lectures';
    await click('[data-action="back-selection"]');
    await check('Le retour à la sélection présente de nouveau toute la photo',`(async()=>{const s=await window.__guided.load(),view=JSON.parse(document.querySelector('#photo-canvas').dataset.view),bitmap=await createImageBitmap(s.rectified);try{return view.x===0&&view.y===0&&view.width===bitmap.width&&view.height===bitmap.height&&s.devices.length===2;}finally{bitmap.close();}})()`);
    for(const index of [0,5])await touch(await gesturePoints(`(()=>{const c=session.candidates[${index}];return [{x:(c.left+c.right)/2,y:(c.top+c.bottom)/2}];})()`));
    await click('#read-selection');
    await check(currentTest,`(async()=>{const s=await window.__guided.load();if(s.devices.length!==4)return false;for(const previous of window.__guided.previousDevices){const d=s.devices.find(d=>d.id===previous.id);if(!d||d.labels.famille.valeur!==previous.family)return false;const bytes=new Uint8Array(await d.blob.arrayBuffer());if(bytes.length!==previous.bytes.length||!bytes.every((v,i)=>v===previous.bytes[i]))return false;}return s.devices.every(d=>!d.validatedAt&&!d.validatedBy)&&s.devices.slice(2).every(d=>d.recognition?.moteur==='tesseract-embarque');})()`);
    currentTest='Une validation humaine fournit une référence locale aux prochaines lectures';
    await evaluate(`document.querySelector('#saved-photos').value=${JSON.stringify(savedId)}`);await click('[data-action="open"]');await click('[data-device="1"]');
    await check('La source à valider contient les vrais marquages lus du disjoncteur',`(async()=>{const d=(await window.__guided.load()).devices[1];return d.labels.famille.valeur==='disjoncteur'&&d.labels.marque.valeur==='Hager'&&d.labels.reference.valeur==='MFS716'&&d.labels.calibre.valeur==='16 A'&&d.labels.courbe.valeur==='C'&&d.rect.modules===1&&!d.validatedAt;})()`);
    await evaluate(`(()=>{const input=document.querySelector('[data-validator]');input.value='Recette Chrome';input.dispatchEvent(new Event('input',{bubbles:true}));})()`);await click('[data-action="validate"]');
    const sourceId=await evaluate(`(async()=>{const d=(await window.__guided.load()).devices[1];if(!d.validatedAt||d.validatedBy!=='Recette Chrome')throw Error('La validation humaine de la référence source a échoué.');return d.id;})()`);
    await importFixture();
    await touch(await gesturePoints(`(()=>{const c=session.candidates[1];return [{x:(c.left+c.right)/2,y:(c.top+c.bottom)/2}];})()`));await click('#read-selection');
    await check(currentTest,`(async()=>{const s=await window.__guided.load(),d=s.devices[0],base=d?.recognition?.baseValidee;return s.devices.length===1&&base?.statut==='rapprochement'&&base.sources.some(source=>source.id===${JSON.stringify(sourceId)})&&d.labels.famille.valeur==='disjoncteur'&&d.labels.famille.niveau==='base_validee'&&!d.validatedAt&&!d.validatedBy;})()`);
    return {status:'pass',tests,durationMs,captures,limites:annotation.limites};
  }catch(error){
    const message=await evaluate('document.querySelector("#message")?.textContent').catch(()=>null);
    throw Error('Recette guidée : '+JSON.stringify({status:'fail',tests,currentTest,detail:error.message,message}));
  }finally{
    await call('Emulation.setTouchEmulationEnabled',{enabled:false}).catch(()=>{});
    await evaluate(`(()=>{const option=document.querySelector('#auto-after-photo');if(option&&window.__guided){option.checked=window.__guided.automatic;option.dispatchEvent(new Event('change',{bubbles:true}));}})()`).catch(()=>{});
  }
}
