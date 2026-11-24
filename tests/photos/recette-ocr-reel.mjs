import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createServer} from '../../scripts/serve.mjs';

// Diagnostic reproductible des pixels réels, sans réseau externe ni validation.
// Le moteur est celui de la PWA ; l'observateur conserve son résultat inchangé.
const cases=[
  {fichier:'tableau-abb-plastron-commons.simple-b16.png',plastron:true,visible:{marque:'ABB',calibre:'16 A',courbe:'B'}},
  {fichier:'tableau-hager-gros-plan-commons.simple-c16.png',plastron:false,visible:{marque:'Hager',calibre:'16 A',courbe:'C'}},
  {fichier:'tableau-hager-gros-plan-commons.triple-b16.png',plastron:false,visible:{marque:'Hager',calibre:'16 A',courbe:'B'}}
];
const pause=ms=>new Promise(done=>setTimeout(done,ms));
const profile=resolve('.local/ocr-photo-'+Date.now());await mkdir(profile,{recursive:true});
const server=createServer();await new Promise(done=>server.listen(0,'127.0.0.1',done));
const origin='http://localhost:'+server.address().port;
const browser=spawn(process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',[
  '--headless=new','--disable-gpu','--disable-background-networking','--no-first-run','--no-default-browser-check',
  '--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'
],{stdio:'ignore',windowsHide:true});
let socket,call,exited=false,browserError;
const closed=new Promise(done=>{browser.once('exit',()=>{exited=true;done();});browser.once('error',error=>{browserError=error;exited=true;done();});});
try{
  let port;const startup=Date.now()+30000;
  while(!port&&Date.now()<startup){
    if(browserError)throw browserError;
    try{port=(await readFile(resolve(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];}catch{await pause(100);}
  }
  if(!port)throw Error('Chrome n’a pas ouvert son port de recette.');
  const page=(await(await fetch('http://localhost:'+port+'/json/list')).json()).find(page=>page.type==='page');
  socket=new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((done,fail)=>{socket.addEventListener('open',done,{once:true});socket.addEventListener('error',fail,{once:true});});
  const pending=new Map();let id=0;
  socket.addEventListener('message',event=>{
    const response=JSON.parse(event.data),request=pending.get(response.id);if(!request)return;
    clearTimeout(request.timer);pending.delete(response.id);
    response.error?request.reject(Error(JSON.stringify(response.error))):request.resolve(response.result);
  });
  call=(method,params={},timeout=15000)=>new Promise((resolve,reject)=>{
    const key=++id,timer=setTimeout(()=>{pending.delete(key);reject(Error('Délai CDP : '+method));},timeout);
    pending.set(key,{resolve,reject,timer});socket.send(JSON.stringify({id:key,method,params}));
  });
  const evaluate=async expression=>{
    const result=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
    if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);
    return result.result.value;
  };
  await call('Page.enable');await call('Runtime.enable');
  // Cette page de même origine n'importe aucun module de l'application :
  // l'observateur est installé avant l'ouverture de son vrai worker Tesseract.
  await call('Page.navigate',{url:origin+'/tests/photos/recette-ocr-reel.html'});
  const navigationDeadline=Date.now()+30000;
  while(!await evaluate(`location.origin===${JSON.stringify(origin)}&&document.readyState === "complete"`)){
    if(Date.now()>navigationDeadline)throw Error('La page locale de recette ne se charge pas.');
    await pause(50);
  }
  await evaluate(`(${startRecognition.toString()})(${JSON.stringify(cases)})`);
  let state;const deadline=Date.now()+180000;
  while(Date.now()<deadline){state=await evaluate('window.__realPhotoOCR');if(state?.statut!=='en_cours')break;await pause(100);}
  if(state?.statut!=='termine')throw Error('Lecture réelle interrompue : '+JSON.stringify(state));
  const record={date:new Date().toISOString(),moteur:'recognizeLocal de la PWA, prétraitement canvas et Tesseract eng+fra embarqués',
    usage:'Photographies publiques de recette ; aucune validation humaine, aucun apprentissage, aucun appel extérieur.',
    precision:'Le statut termine indique seulement que les moteurs ont fini. Les inconnus et les erreurs restent conservés.',...state};
  const destination=new URL('./ocr-reel-pwa-observe.json',import.meta.url);
  await writeFile(destination,JSON.stringify(record,null,2)+'\n');
  console.log(JSON.stringify(record,null,2));
  if(state.results.some(result=>result.erreursDeValeur.length))process.exitCode=1;
}finally{
  if(socket?.readyState===WebSocket.OPEN&&call)await call('Browser.close',{},1500).catch(()=>{});
  await Promise.race([closed,pause(1500)]);if(!exited){browser.kill();await Promise.race([closed,pause(1000)]);}
  socket?.close();server.closeAllConnections();await new Promise(done=>server.close(done));
}

function startRecognition(cases){
  const qa=window.__realPhotoOCR={statut:'en_cours',results:[]};
  void(async()=>{
    let terminate,restore;
    try{
      const {default:Tesseract}=await import('/app/vendor/ocr/tesseract.esm.min.js');
      const createWorker=Tesseract.createWorker;
      let raw=[];
      Tesseract.createWorker=async(...args)=>{
        const worker=await createWorker(...args),recognize=worker.recognize.bind(worker);
        worker.recognize=async(...args)=>{
          const result=await recognize(...args);
          raw.push({texte:result.data.text,confiance:result.data.confidence,tsv:result.data.tsv});
          return result;
        };
        return worker;
      };
      restore=()=>{Tesseract.createWorker=createWorker;};
      const {recognizeLocal,terminateLocalOCR}=await import('/app/identification/local.js');terminate=terminateLocalOCR;
      for(const item of cases){
        raw=[];const blob=await(await fetch('/tests/photos/'+item.fichier)).blob(),started=performance.now();
        const result=await recognizeLocal(blob),erreursDeValeur=[],attributsReconnus=[],inconnus=[];
        for(const [key,expected]of Object.entries(item.visible)){
          const actual=result.champs[key]?.valeur;
          if(!actual||actual==='inconnu')inconnus.push(key);
          else if(actual!==expected)erreursDeValeur.push({champ:key,visible:expected,lu:actual});
          else attributsReconnus.push(key);
        }
        qa.results.push({...item,...result,dureeMs:Math.round(performance.now()-started),attributsReconnus,inconnus,erreursDeValeur,
          champsNonVerifies:Object.keys(result.champs).filter(key=>!Object.hasOwn(item.visible,key)),passagesTesseract:raw});
      }
      qa.statut='termine';
    }catch(error){qa.statut='erreur';qa.erreur=error.message;}
    finally{await terminate?.();restore?.();}
  })();
  return true;
}
