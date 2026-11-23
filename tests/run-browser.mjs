import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from '../scripts/serve.mjs';
import {createPCServer} from '../training/server.mjs';
import {readManifests} from '../training/corpus.mjs';
import {recognizeOCR,terminateOCR} from '../training/ocr.mjs';
import {runMobileOCRBrowserTests,runAutonomousUIBrowserTests,runCutoutBrowserTests,runCutoutUIBrowserTests} from './mobile-browser.mjs';
import {runCollectionBrowserTests} from './collection-browser.mjs';
import {runRealPhotoBrowserTests,runRealPhotoUIBrowserTests} from './real-photo-browser.mjs';

// Contrôle Chrome via son protocole natif, sans bibliothèque de test ajoutée.
const profile = resolve('.local/browser-' + Date.now());
await mkdir(profile, { recursive: true });
const server = createServer();
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://localhost:${server.address().port}`;
const pcToken='code-appairage-synthetique-recette';
const pcData=resolve('.local/pc-browser-'+Date.now());
// Le serveur simulé vérifie l'interface sans prétendre fournir un modèle électrique.
const pcServer=createPCServer({dataDirectory:pcData,token:pcToken,origins:[origin],engine:{
  capabilities:{analysis:true,training:false},status:async()=>({model:null,message:'Moteur simulé de recette interface.'}),
  analyze:async()=>({champs:{marque:{valeur:'Hager',confiance:.94,niveau:'ocr_caracteristiques'},calibre:{valeur:'32 A',confiance:.94,niveau:'ocr_caracteristiques'}},texte:'HAGER C32',limites:[]})
}});
await new Promise(done=>pcServer.listen(0,'127.0.0.1',done));
const pcAddress='http://127.0.0.1:'+pcServer.address().port;
let pcRequests=0;pcServer.on('request',req=>{if(req.url.startsWith('/api/'))pcRequests++;});
const chrome = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const processChrome = spawn(chrome, ['--headless=new', '--disable-gpu', '--disable-background-networking', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
let socket;
const sleep = ms => new Promise(done => setTimeout(done, ms));
async function until(fn) { const deadline=Date.now()+30000; while (Date.now() < deadline) { const result = await fn(); if (result) return result; await sleep(150); } throw Error('Délai de recette navigateur dépassé'); }
let processError;
processChrome.on('error', error => { processError = error; });
try {
  const port = await until(async () => { if (processError) throw processError; try { return (await readFile(resolve(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; } catch { return null; } });
  const pages = await (await fetch(`http://localhost:${port}/json/list`)).json();
  const page = pages.find(page => page.type === 'page');
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((done, fail) => { socket.addEventListener('open', done, {once:true}); socket.addEventListener('error', fail, {once:true}); });
  let id = 0;
  const pending = new Map();
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    const request = pending.get(message.id);
    if (!request) return;
    clearTimeout(request.timer);
    pending.delete(message.id);
    message.error ? request.reject(Error(JSON.stringify(message.error))) : request.resolve(message.result);
  });
  const call = (method, params = {}) => new Promise((resolve, reject) => { const key = ++id; const timer = setTimeout(() => { pending.delete(key); reject(Error('Délai CDP : ' + method)); }, 8000); pending.set(key, {resolve,reject,timer}); socket.send(JSON.stringify({id:key,method,params})); });
  const evaluate = async expression => { const data = await call('Runtime.evaluate', {expression,returnByValue:true,awaitPromise:true}); if (data.exceptionDetails) throw Error(data.exceptionDetails.text + ': ' + data.exceptionDetails.exception?.description); return data.result.value; };
  await call('Page.enable'); await call('Runtime.enable'); await call('Network.enable');
  if (process.argv.includes('--shell')) {
    await call('Page.navigate', { url: origin + '/app/' });
    await until(() => evaluate('document.querySelector("#offline-status")?.textContent === "Disponible hors ligne"'));
  } else {
    await call('Page.navigate', { url: origin + '/tests/browser.html' });
    const result = await until(async () => { const state = await evaluate('window.__qa || null'); return state && state.status !== 'pending' ? state : null; });
    console.log(JSON.stringify(result, null, 2));
    if (result.status !== 'pass') throw Error('Échec des tests navigateur');
    await call('Page.navigate', { url: origin + '/app/' });
    await until(() => evaluate('window.__scanTableauReady === true && document.querySelector("#offline-status")?.textContent === "Disponible hors ligne"'));
    if(pcRequests!==0)throw Error('Contact PC avant action explicite');
    // Parcours visible complet : correction manuelle, validation puis correction.
    const click=async selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
    const idle=()=>until(()=>evaluate('document.querySelector("#workspace").getAttribute("aria-busy") !== "true"'));
    await evaluate(`(()=>{const option=document.querySelector('#auto-after-photo');if(!option?.checked)throw Error('L’analyse après photo doit être activée par défaut.');option.checked=false;option.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await evaluate(`(async()=>{const blob=await (await fetch('/tests/photos/tableau-synthetique.svg')).blob();const dt=new DataTransfer();dt.items.add(new File([blob],'tableau.svg',{type:'image/svg+xml'}));const input=document.querySelector('#import-file');input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await idle();
    if(!await evaluate('document.querySelector("#photo-info").textContent.includes("720 × 520")'))throw Error('Import dans l’interface incomplet');
    if(!await evaluate(`(async()=>{const {loadSession}=await import('/app/base/store.js');const s=await loadSession(document.querySelector('#saved-photos').value);return !s.rectified&&s.devices.length===0&&document.querySelectorAll('.thumbnail').length===0;})()`))throw Error('L’analyse démarre malgré sa désactivation explicite');
    console.log('PASS : désactiver l’analyse après photo conserve le parcours manuel.');
    await click('[data-step="perspective"]');
    await click('[data-action="rectify"]');await idle();
    await click('[data-action="suggest"]');await idle();
    const rowCount=await evaluate('document.querySelectorAll(".row-editor").length');
    if(rowCount!==2)throw Error('Proposition des deux rangées perdue dans l’interface');
    await evaluate(`(()=>{const change=(selector,value,type='input')=>{const node=document.querySelector(selector);node.value=value;node.dispatchEvent(new Event(type,{bubbles:true}));};for(let i=0;i<2;i++){for(const [bound,value]of Object.entries({top:(i?300:70)/520*100,bottom:(i?450:220)/520*100,left:74/720*100,right:646/720*100}))change('[data-row="'+i+'"][data-bound="'+bound+'"]',value);}change('[data-row="0"][data-cuts]','0.5; 2; 4','change');})()`);
    await click('[data-action="crop"]');await idle();
    if(!await evaluate('document.querySelector("#summary").textContent.startsWith("17 vignettes proposées")'))throw Error('Séparations manuelles ignorées');
    console.log('Découpage synthétique :',await evaluate('document.querySelector("#message").textContent'));
    await evaluate(`(()=>{const family=document.querySelector('[data-label="famille"]');family.value='disjoncteur';family.dispatchEvent(new Event('input',{bubbles:true}));const validator=document.querySelector('[data-validator]');validator.value='Recette Chrome';validator.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await click('[data-action="validate"]');await idle();
    const firstPhotoId=await evaluate('document.querySelector("#saved-photos").value');
    // Une seconde photo prise dans la même séance doit rejoindre le même lot.
    await evaluate(`(async()=>{const blob=await (await fetch('/tests/photos/tableau-synthetique.svg')).blob();const dt=new DataTransfer();dt.items.add(new File([blob],'autre-photo.svg',{type:'image/svg+xml'}));const input=document.querySelector('#import-file');input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);await idle();
    await click('[data-step="perspective"]');await click('[data-action="rectify"]');await idle();
    await click('[data-action="add-row"]');await idle();
    await evaluate(`(()=>{const input=document.querySelector('[data-row="0"][data-modules]');input.value='1';input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await click('[data-action="crop"]');await idle();
    await evaluate(`(()=>{const input=document.querySelector('[data-label="famille"]');input.value='contacteur';input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await click('[data-action="validate"]');await idle();
    if(!await evaluate('document.querySelector(".badge").textContent === "Validé"'))throw Error('Validation humaine non conservée');
    await evaluate(`(()=>{const input=document.querySelector('[data-label="calibre"]');input.value='16';input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    if(!await evaluate('document.querySelector(".badge").textContent === "À vérifier" && document.querySelector("#summary").textContent.includes("0 validées")'))throw Error('Correction non invalidante');
    await click('[data-action="validate"]');await idle();
    const correctedPhotoId=await evaluate('document.querySelector("#saved-photos").value');
    const downloadPath=resolve('.local/qa-downloads-'+Date.now());await mkdir(downloadPath,{recursive:true});
    await call('Browser.setDownloadBehavior',{behavior:'allow',downloadPath});
    await click('#export');await idle();
    const archive=await until(async()=>{const files=await readdir(downloadPath);return files.find(file=>file.endsWith('.zip'));});
    await writeFile(resolve('.local/qa-export.zip'),await readFile(resolve(downloadPath,archive)));
    const zipBytes=new Uint8Array(await readFile(resolve(downloadPath,archive))),zipView=new DataView(zipBytes.buffer);let position=0,records;
    while(zipView.getUint32(position,true)===0x04034b50){const size=zipView.getUint32(position+18,true),length=zipView.getUint16(position+26,true),name=new TextDecoder().decode(zipBytes.slice(position+30,position+30+length)),start=position+30+length;if(name==='labels.json')records=JSON.parse(new TextDecoder().decode(zipBytes.slice(start,start+size)));position=start+size;}
    if(records?.length!==2||new Set(records.map(r=>r['séance'])).size!==1||!records.some(r=>r.calibre.valeur==='16'))throw Error('Regroupement de séance ou filtrage des validations incorrect');
    console.log('PASS : interface, demi-modules, invalidation après correction et ZIP de deux photos de la même séance.');
    await evaluate(`(()=>{document.querySelector('#pc-panel details').open=true;document.querySelector('#pc-address').value=${JSON.stringify(pcAddress)};document.querySelector('#pc-token').value=${JSON.stringify(pcToken)};})()`);
    await click('#pc-connect');
    await until(()=>evaluate('document.querySelector("#pc-status").textContent.startsWith("PC connecté")')).catch(async error=>{throw Error(error.message+' · '+await evaluate('document.querySelector("#pc-status").textContent')+' · requêtes PC : '+pcRequests);});
    await click('[data-action="invalidate"]');await idle();
    await click('#pc-analyze');
    await until(()=>evaluate('document.querySelector("#pc-status").textContent.startsWith("1 propositions")'));
    if(!await evaluate('document.querySelector("[data-label=marque]").value === "Hager" && document.querySelector("[data-label=calibre]").value === "16" && document.querySelector(".badge").textContent === "À vérifier"'))throw Error('Analyse : saisie humaine remplacée ou validation automatique');
    await evaluate(`(async()=>{const w=await import('/app/interface/workspace.js');const target=w.currentAnalysisTarget();document.querySelector('[data-label=marque]').dispatchEvent(new Event('input',{bubbles:true}));try{w.applyPCAnalysis(target,{champs:{}});throw Error('Résultat périmé accepté');}catch(error){if(!error.message.includes('ont changé'))throw error;}})()`);
    await click('[data-action="validate"]');await idle();
    console.log('PASS : propositions PC sans validation, saisies préservées et résultat périmé écarté.');
    await click('#pc-send');
    await until(()=>evaluate('document.querySelector("#pc-status").textContent.startsWith("Lot reçu")'));
    const batches=await readManifests(pcData);
    if(batches.length!==1||batches[0].samples.length!==2)throw Error('Le PC ne reçoit pas exactement les deux validations');
    await click('#pc-prepare');
    await until(()=>evaluate('document.querySelector("#pc-status").textContent.startsWith("Jeux préparés par séance")'));
    console.log('PASS : appairage, CORS réel, envoi explicite des validations au PC et préparation du corpus.');
    if(process.argv.includes('--ocr')){
      const png=await evaluate(`(async()=>{const img=new Image();img.src='/tests/photos/ocr-marquages.svg';await img.decode();const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;c.getContext('2d').drawImage(img,0,0);return c.toDataURL('image/png').split(',')[1];})()`);
      const recognized=await recognizeOCR(Buffer.from(png,'base64'));
      if(recognized.champs.marque.valeur!=='Hager'||recognized.champs.calibre.valeur!=='16 A'||recognized.champs.sensibilite.valeur!=='30 mA')throw Error('OCR réel sur marquages artificiels : '+JSON.stringify(recognized));
      console.log('PASS : OCR Tesseract local réel sur tests/photos/ocr-marquages.svg, sans modèle de familles.');
      await terminateOCR();
    }
    await call('Page.reload',{ignoreCache:true});
    await until(()=>evaluate('window.__scanTableauReady === true && document.querySelectorAll("#saved-photos option").length > 1'));
    await evaluate(`document.querySelector('#saved-photos').value=${JSON.stringify(firstPhotoId)}`);await click('[data-action="open"]');await idle();
    if(!await evaluate('document.querySelector(".badge").textContent === "Validé" && document.querySelector("[data-label=famille]").value === "disjoncteur"'))throw Error('Restauration de la première photo incomplète');
    await evaluate(`document.querySelector('#saved-photos').value=${JSON.stringify(correctedPhotoId)}`);await click('[data-action="open"]');await idle();
    if(!await evaluate('document.querySelector(".badge").textContent === "Validé" && document.querySelector("[data-label=calibre]").value === "16"'))throw Error('Restauration des corrections incomplète');
    console.log('PASS : photo, vignettes et validation restaurées après rechargement.');
    // Génération explicite des icônes seulement, jamais pendant une recette ordinaire.
    for(const size of process.argv.includes('--icons')?[192,512]:[]){
      const data=await evaluate(`(async()=>{const img=new Image();img.src='./icons/tableau.svg';await img.decode();const c=document.createElement('canvas');c.width=${size};c.height=${size};c.getContext('2d').drawImage(img,0,0,${size},${size});return c.toDataURL('image/png').split(',')[1];})()`);
      await writeFile(resolve('app/icons/tableau-'+size+'.png'),Buffer.from(data,'base64'));
    }
  }
  // Une navigation ordinaire reprend le contrôle après un éventuel rechargement forcé.
  await call('Page.navigate', {url:origin+'/app/'});
  await until(() => evaluate('!!navigator.serviceWorker.controller && window.__scanTableauReady === true'));
  await call('Network.setCacheDisabled', {cacheDisabled:true});
  const requestsBeforeOffline=pcRequests;
  await call('Network.emulateNetworkConditions', {offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
  // Ferme aussi les serveurs : un worker OCR ne peut pas contourner l'émulation CDP.
  server.closeAllConnections();await new Promise(done=>server.close(done));
  pcServer.closeAllConnections();await new Promise(done=>pcServer.close(done));
  await call('Page.reload');
  await until(() => evaluate(process.argv.includes('--shell') ? '!!document.querySelector("#workspace") && document.querySelector("#offline-status")?.textContent === "Disponible hors ligne"' : 'window.__scanTableauReady === true && !!document.querySelector("#workspace canvas")'));
  console.log('PASS : rechargement complet hors ligne, interface et modules disponibles.');
  if(process.argv.includes('--mobile-ocr')){
    console.log(JSON.stringify(await runMobileOCRBrowserTests({evaluate}),null,2));
    console.log(JSON.stringify(await runCutoutBrowserTests({evaluate}),null,2));
    console.log(JSON.stringify(await runAutonomousUIBrowserTests({evaluate}),null,2));
    console.log(JSON.stringify(await runCutoutUIBrowserTests({evaluate,call}),null,2));
    console.log(JSON.stringify(await runCollectionBrowserTests({evaluate,call}),null,2));
    console.log(JSON.stringify(await runRealPhotoBrowserTests({evaluate}),null,2));
    console.log(JSON.stringify(await runRealPhotoUIBrowserTests({evaluate}),null,2));
  }
  if(pcRequests!==requestsBeforeOffline)throw Error('Reconnexion automatique au PC après rechargement');
  if(!process.argv.includes('--shell')){
    await evaluate(`document.querySelector('#saved-photos').selectedIndex=1`);await evaluate(`document.querySelector('[data-action="open"]').click()`);
    await until(()=>evaluate('document.querySelector("#workspace").getAttribute("aria-busy") !== "true" && !!document.querySelector(".badge")'));
    const desktop=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});await writeFile(resolve('.local/recette-collecte.png'),Buffer.from(desktop.data,'base64'));
    console.log('PASS : restauration d’une collecte existante hors ligne.');
  }
  await call('Emulation.setDeviceMetricsOverride', { width:390, height:844, deviceScaleFactor:1, mobile:true });
  const overflow = await evaluate('document.documentElement.scrollWidth > innerWidth');
  if (overflow) throw Error('Débordement horizontal à 390 px');
  const shot = await call('Page.captureScreenshot', {format:'png',captureBeyondViewport:true});
  await writeFile(resolve('.local/recette-mobile.png'), Buffer.from(shot.data,'base64'));
  console.log('PASS : largeur mobile 390 px ; capture .local/recette-mobile.png');
} finally {
  await terminateOCR();
  socket?.close();
  processChrome.kill();
  if(server.listening){server.closeAllConnections();server.close();}
  if(pcServer.listening){pcServer.closeAllConnections();pcServer.close();}
}
