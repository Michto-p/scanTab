import {mountWorkspace,createCurrentBatch,currentAnalysisTarget,applyPCAnalysis} from './interface/workspace.js';
import {mountPCPanel} from './interface/pc-panel.js';
await mountWorkspace();
mountPCPanel({createBatch:createCurrentBatch,analysisTarget:currentAnalysisTarget,applyAnalysis:applyPCAnalysis});
const status = document.querySelector('#offline-status');
if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then(async registration => {
    await navigator.serviceWorker.ready;
    status.textContent = 'Disponible hors ligne';
    if (registration.waiting) status.textContent = 'Mise à jour prête : fermez puis rouvrez l’application';
  }).catch(() => { status.textContent = 'Hors ligne non prêt : rechargez avec une connexion'; });
} else status.textContent = 'Mode hors ligne : ouvrez en HTTPS ou sur localhost';
