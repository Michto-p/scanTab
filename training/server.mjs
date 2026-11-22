import http from 'node:http';
import https from 'node:https';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {networkInterfaces} from 'node:os';
import {randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {createServer as createStaticServer} from '../scripts/serve.mjs';
import {localPCURL} from '../app/connexion/client.js';
import {MAX_BATCH_BYTES} from './archive.mjs';
import {receiveBatch,readManifests,prepareDataset} from './corpus.mjs';
import {createLocalEngine} from './engine.mjs';

function allowedOrigin(value) {
  const url=new URL(value);
  if(url.origin!==value || !(url.protocol==='https:' || (url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname))))throw Error('Origine autorisée invalide : utilisez https://votre-compte.github.io, sans chemin ni barre finale.');
  return value;
}
function authorized(value,token) {
  const received=Buffer.from(value??''),expected=Buffer.from('Bearer '+token);
  return received.length===expected.length&&timingSafeEqual(received,expected);
}
async function bodyOf(request,maximum=MAX_BATCH_BYTES) {
  if(Number(request.headers['content-length'])>maximum)throw Object.assign(Error('Le fichier dépasse la taille autorisée.'),{status:413});
  const parts=[];let size=0;
  for await(const chunk of request){size+=chunk.length;if(size>maximum)throw Object.assign(Error('Le fichier dépasse la taille autorisée.'),{status:413});parts.push(chunk);}
  return Buffer.concat(parts);
}

export function createPCServer({dataDirectory,token,origins=[],tls=null,engine=null}={}) {
  if(typeof token!=='string'||token.length<16)throw Error('Code d’appairage absent ou trop court.');
  if(!dataDirectory)throw Error('Dossier de données du PC absent.');
  const allowed=new Set(origins.map(allowedOrigin)), staticServer=createStaticServer();let writes=Promise.resolve();
  const enqueue=fn=>{const job=writes.catch(()=>{}).then(fn);writes=job;return job;};
  const jobs=new Map();let training=false;
  const handler=async(request,response)=>{
    const pathname=new URL(request.url,'http://localhost').pathname;
    if(!pathname.startsWith('/api/')){staticServer.emit('request',request,response);return;}
    const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Vary':'Origin'};
    const send=(status,value)=>{if(!response.headersSent)response.writeHead(status,headers).end(JSON.stringify(value));};
    try {
      // Refuse les noms publics pointés vers le PC ; aucun proxy Internet n'est nécessaire.
      try{localPCURL('http://'+request.headers.host);}catch{send(403,{error:'Adresse locale du serveur invalide.'});return;}
      const origin=request.headers.origin;
      if(origin&&!allowed.has(origin)){send(403,{error:'Origine de l’application non autorisée sur ce PC.'});return;}
      if(origin)headers['Access-Control-Allow-Origin']=origin;
      if(request.method==='OPTIONS'){
        const wanted=(request.headers['access-control-request-headers']??'').toLowerCase().split(',').map(v=>v.trim()).filter(Boolean);
        if(!origin||!['GET','POST'].includes(request.headers['access-control-request-method'])||wanted.some(h=>!['authorization','content-type'].includes(h))){send(403,{error:'Requête de connexion non autorisée.'});return;}
        Object.assign(headers,{'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Max-Age':'600'});
        if(request.headers['access-control-request-private-network']==='true')headers['Access-Control-Allow-Private-Network']='true';
        response.writeHead(204,headers).end();return;
      }
      if(!authorized(request.headers.authorization,token)){send(401,{error:'Code d’appairage incorrect. Recopiez le code affiché sur le PC.'});return;}
      if(pathname==='/api/status'&&request.method==='GET'){
        await writes.catch(()=>{});const manifests=await readManifests(dataDirectory);
        const details=engine?await engine.status():{model:null,message:'Collecte PC disponible. Le moteur de reconnaissance et d’entraînement n’est pas installé.'};
        send(200,{application:'scan-tableau-pc',apiVersion:1,capabilities:{receiveBatches:true,prepareDataset:true,analysis:false,training:false,...engine?.capabilities},batches:manifests.length,images:new Set(manifests.flatMap(m=>m.samples.map(s=>s.imageHash))).size,...details});return;
      }
      if(pathname==='/api/batches'&&request.method==='POST'){
        if(request.headers['content-type']?.split(';')[0]!=='application/zip'){send(415,{error:'Un lot ZIP de Scan Tableau est attendu.'});return;}
        const bytes=await bodyOf(request),result=await enqueue(()=>receiveBatch(dataDirectory,bytes));send(201,result);return;
      }
      if(pathname==='/api/dataset/prepare'&&request.method==='POST'){if(training){send(409,{error:'Un entraînement utilise déjà les jeux préparés.'});return;}const result=await enqueue(()=>prepareDataset(dataDirectory));send(200,result);return;}
      if(pathname==='/api/analyze'&&request.method==='POST'&&engine?.capabilities.analysis){
        if(request.headers['content-type']?.split(';')[0]!=='image/png'){send(415,{error:'Une vignette PNG est attendue.'});return;}
        send(200,await engine.analyze(await bodyOf(request,32*1024*1024)));return;
      }
      if(pathname==='/api/train'&&request.method==='POST'&&engine?.capabilities.training){
        if(training){send(409,{error:'Un entraînement est déjà en cours.'});return;}
        training=true;const job={id:randomUUID(),state:'running',startedAt:new Date().toISOString()};jobs.set(job.id,job);
        if(jobs.size>20)jobs.delete(jobs.keys().next().value);
        // Le verrou est pris avant la première attente ; aucune préparation ne peut remplacer ce jeu.
        void enqueue(()=>prepareDataset(dataDirectory)).then(()=>engine.train()).then(result=>{job.state='completed';job.result=result;},error=>{job.state='failed';job.error=error.message;}).finally(()=>{training=false;job.finishedAt=new Date().toISOString();});
        send(202,job);return;
      }
      if(/^\/api\/jobs\/[a-f0-9-]{36}$/.test(pathname)&&request.method==='GET'){
        const job=jobs.get(pathname.split('/').pop());send(job?200:404,job??{error:'Travail inconnu ou serveur redémarré.'});return;
      }
      if(['/api/analyze','/api/train'].includes(pathname)&&request.method==='POST'){
        send(503,{error:'Moteur local non installé. Aucune analyse ni aucun entraînement n’a été exécuté.'});return;
      }
      send(404,{error:'Opération du serveur PC inconnue.'});
    } catch(error){send(error.status??(error.code&&!String(error.code).startsWith('Z_')?500:422),{error:error.code&&!String(error.code).startsWith('Z_')?'Le stockage du PC est indisponible.':error.message});}
  };
  const server=tls?https.createServer(tls,handler):http.createServer(handler);
  server.on('close',()=>{void engine?.close?.();});
  server.requestTimeout=120000;server.headersTimeout=15000;
  return server;
}

export async function launch() {
  const args=process.argv.slice(2),origins=[];let lan=false,port=8787,cert,key;
  for(let i=0;i<args.length;i++){
    if(args[i]==='--lan')lan=true;
    else if(args[i]==='--origin')origins.push(allowedOrigin(args[++i]));
    else if(args[i]==='--port')port=Number(args[++i]);
    else if(args[i]==='--cert')cert=args[++i];
    else if(args[i]==='--key')key=args[++i];
    else throw Error('Option inconnue : '+args[i]);
  }
  if(!Number.isInteger(port)||port<1||port>65535)throw Error('Port invalide.');
  if(lan&&!origins.length)throw Error('Indiquez --origin https://votre-compte.github.io pour ouvrir le serveur au réseau local.');
  if(Boolean(cert)!==Boolean(key))throw Error('Indiquez ensemble --cert et --key pour HTTPS.');
  const directory=resolve('.local/pc');await mkdir(directory,{recursive:true});
  const tokenFile=resolve(directory,'pairing-code');let token;
  try{token=(await readFile(tokenFile,'utf8')).trim();}catch(error){if(error.code!=='ENOENT')throw error;token=randomBytes(32).toString('base64url');await writeFile(tokenFile,token,{flag:'wx',mode:0o600});}
  const tls=cert?{cert:await readFile(cert),key:await readFile(key)}:null;
  const engine=await createLocalEngine(directory);
  const server=createPCServer({dataDirectory:directory,token,origins:[...origins,'http://localhost:8080','http://127.0.0.1:8080',`${tls?'https':'http'}://localhost:${port}`],tls,engine});
  server.on('error',error=>{console.error('Serveur PC indisponible : '+error.message);process.exitCode=1;});
  server.listen(port,lan?'0.0.0.0':'127.0.0.1',()=>{
    console.log(`Serveur PC : ${tls?'https':'http'}://localhost:${port}`);
    if(lan)for(const infos of Object.values(networkInterfaces()))for(const info of infos??[])if(info.family==='IPv4'&&!info.internal)console.log(`Adresse à saisir sur le téléphone : ${tls?'https':'http'}://${info.address}:${port}`);
    console.log('Code d’appairage (à recopier dans la PWA) : '+token);
    console.log('Données locales : .local/pc ; seules les données validées sont reçues.');
    if(lan&&!tls)console.log('HTTP local : autorisation réseau Chrome nécessaire. Pour Safari, prévoir HTTPS avec certificat reconnu par le téléphone.');
  });
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))launch().catch(error=>{console.error(error.message);process.exitCode=1;});
