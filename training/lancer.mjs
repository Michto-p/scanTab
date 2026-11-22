import {readFile} from 'node:fs/promises';
import {networkInterfaces} from 'node:os';
import {launch} from './server.mjs';

// Un second double-clic affiche la connexion sans démarrer un serveur concurrent.
let existing=null,token;
try{
  token=(await readFile('.local/pc/pairing-code','utf8')).trim();
  const response=await fetch('http://127.0.0.1:8787/api/status',{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(3000)});
  if(response.ok){const info=await response.json();if(info.application==='scan-tableau-pc'&&info.apiVersion===1)existing=info;}
}catch{/* Premier lancement ou serveur arrêté. */}
if(existing){
  console.log('Le serveur Scan Tableau fonctionne déjà sur ce PC.');
  for(const infos of Object.values(networkInterfaces()))for(const info of infos??[])if(info.family==='IPv4'&&!info.internal)console.log('Adresse à saisir sur le téléphone : http://'+info.address+':8787');
  console.log('Code d’appairage à recopier dans la PWA : '+token);
  console.log(existing.message);
  console.log('Application : https://michto-p.github.io/scanTab/');
}else await launch().catch(error=>{console.error(error.message);process.exitCode=1;});
