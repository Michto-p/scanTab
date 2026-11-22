import {createPCClient,localPCURL} from '../connexion/client.js';

export function mountPCPanel({createBatch,analysisTarget,applyAnalysis}) {
  const panel=document.querySelector('#pc-panel');
  panel.innerHTML=`<details><summary>Analyse et apprentissage sur le PC local</summary><p>Connectez le téléphone et le PC au même réseau Wi-Fi. Chaque bouton indique les données envoyées ; la collecte reste disponible sans PC.</p><div class="pc-form"><label>Adresse réseau du PC<input id="pc-address" type="url" placeholder="https://192.168.1.20:8787" autocomplete="off"></label><label>Code affiché sur le PC<input id="pc-token" type="password" autocomplete="off" spellcheck="false"></label><button id="pc-connect">Connecter le PC</button><button id="pc-forget">Oublier le PC</button></div><p class="hint">Recopiez l’adresse affichée dans le terminal du PC. « localhost » désigne l’appareil sur lequel ce navigateur est ouvert.</p><p id="pc-status" role="status" aria-live="polite">Aucun PC connecté. Aucun transfert automatique.</p><div class="pc-actions"><button id="pc-analyze" disabled>Envoyer cette vignette pour analyse</button><button id="pc-send" disabled>Envoyer la séance validée au PC</button><button id="pc-prepare" disabled>Préparer les données d’apprentissage</button><button id="pc-train" disabled>Entraîner le modèle sur le PC</button></div><p id="pc-engine" class="hint">GitHub Pages héberge l’application. L’OCR et l’apprentissage s’exécutent sur votre PC. Une analyse ne valide jamais un appareil.</p><pre id="pc-ocr" class="hint" hidden></pre></details>`;
  const get=id=>panel.querySelector('#pc-'+id),address=get('address'),token=get('token'),status=get('status');
  let client=null,working=false,capabilities={};
  try{address.value=localStorage.getItem('scan-tableau-pc-address')||'';token.value=sessionStorage.getItem('scan-tableau-pc-token')||'';}catch{}
  const setConnected=()=>{get('send').disabled=get('prepare').disabled=!client;get('analyze').disabled=!client||!capabilities.analysis;get('train').disabled=!client||!capabilities.training;};
  function disconnect(){client=null;capabilities={};setConnected();}
  for(const input of [address,token])input.addEventListener('input',()=>{disconnect();status.textContent='Configuration modifiée. Connectez à nouveau le PC.';});
  async function action(fn){
    if(working)return;working=true;
    const controls=[...panel.querySelectorAll('input,button')];controls.forEach(node=>node.disabled=true);
    try{await fn();}catch(error){status.textContent=error.message;}
    finally{working=false;controls.forEach(node=>node.disabled=false);setConnected();}
  }
  get('connect').addEventListener('click',()=>action(async()=>{
    disconnect();status.textContent='Connexion au PC…';const candidate=createPCClient(address.value,token.value),info=await candidate.status();
    client=candidate;capabilities=info.capabilities??{};
    try{localStorage.setItem('scan-tableau-pc-address',localPCURL(address.value));sessionStorage.setItem('scan-tableau-pc-token',token.value.trim());}catch{}
    status.textContent=`PC connecté : ${info.images} vignettes distinctes, ${info.batches} lots reçus.`;
    get('engine').textContent=info.message;
  }));
  get('forget').addEventListener('click',()=>{if(working)return;disconnect();address.value='';token.value='';try{localStorage.removeItem('scan-tableau-pc-address');sessionStorage.removeItem('scan-tableau-pc-token');}catch{}status.textContent='PC oublié. Les photos du téléphone sont conservées.';});
  get('analyze').addEventListener('click',()=>action(async()=>{
    const target=analysisTarget();status.textContent='Analyse de la vignette sélectionnée sur le PC…';
    const result=await client.analyze(target.blob);const count=applyAnalysis(target,result);
    get('ocr').hidden=!result.texte;get('ocr').textContent=result.texte?'Texte lu (à vérifier) :\n'+result.texte:'';
    status.textContent=`${count} propositions ajoutées, sans validation. ${(result.limites??[]).join(' ')}`;
  }));
  get('send').addEventListener('click',()=>action(async()=>{
    status.textContent='Préparation du lot validé…';const batch=await createBatch();status.textContent=`Envoi de ${batch.count} appareils validés au PC…`;
    const result=await client.sendBatch(batch.blob);status.textContent=result.repeated?'Ce lot était déjà reçu sur le PC.':`Lot reçu : ${result.received} validations, ${result.newImages} nouvelles images, ${result.duplicates} doublons d’image.`;
  }));
  get('prepare').addEventListener('click',()=>action(async()=>{
    status.textContent='Préparation des données sur le PC…';const data=await client.prepareDataset();
    status.textContent=`Jeux préparés par séance : ${data.train} entraînement, ${data.validation} validation, ${data.test} test. ${data.conflicts} images en conflit sont exclues. Aucun entraînement n’a encore été lancé.`;
  }));
  get('train').addEventListener('click',()=>action(async()=>{
    status.textContent='Préparation puis entraînement sur le PC…';let job=await client.train();
    while(job.state==='running'){
      await new Promise(resolve=>setTimeout(resolve,2000));job=await client.job(job.id);
      status.textContent='Entraînement CPU en cours. Le PC conserve les données ; gardez-le allumé.';
    }
    if(job.state==='failed')throw Error(job.error);
    const {candidate,reason,adopted}=job.result;
    status.textContent=`Modèle ${adopted?'adopté':'conservé comme candidat'} : précision ${(candidate.precision*100).toFixed(1)} % sur ${candidate.test} vignettes de séances réservées. ${reason}`;
    const info=await client.status();get('engine').textContent=info.message;
  }));
}
