import {mountWorkspace,createCurrentBatch,currentAnalysisTarget,applyPCAnalysis} from './interface/workspace.js';
import {mountPCPanel} from './interface/pc-panel.js';
await mountWorkspace();
mountPCPanel({createBatch:createCurrentBatch,analysisTarget:currentAnalysisTarget,applyAnalysis:applyPCAnalysis});
document.querySelector('.collection-options').append(document.querySelector('#pc-panel'));
const status = document.querySelector('#offline-status');
if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then(async registration => {
    const follow=worker=>worker?.addEventListener('statechange',()=>{
      if(worker.state==='redundant'&&!registration.active)status.textContent='Hors ligne incomplet : rechargez avec une connexion pour installer l’OCR';
      if(worker.state==='installed'&&navigator.serviceWorker.controller)status.textContent='Mise à jour prête : fermez puis rouvrez l’application';
    });
    follow(registration.installing);registration.addEventListener('updatefound',()=>follow(registration.installing));
    await navigator.serviceWorker.ready;
    status.textContent = 'Disponible hors ligne';
    if (registration.waiting) status.textContent = 'Mise à jour prête : fermez puis rouvrez l’application';
  }).catch(() => { status.textContent = 'Hors ligne non prêt : rechargez avec une connexion'; });
} else status.textContent = 'Mode hors ligne : ouvrez en HTTPS ou sur localhost';
