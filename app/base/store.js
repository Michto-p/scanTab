let databasePromise;
export function openDatabase() {
  if(databasePromise)return databasePromise;
  if(!globalThis.indexedDB)return Promise.reject(Error('Le stockage local est indisponible dans ce navigateur.'));
  databasePromise=new Promise((resolve,reject)=>{
    const request=indexedDB.open('scan-tableau',1);let settled=false;
    request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains('sessions')){const store=db.createObjectStore('sessions',{keyPath:'id'});store.createIndex('updatedAt','updatedAt');}};
    request.onblocked=()=>{settled=true;reject(Error('Fermez les autres fenêtres de Scan Tableau pour ouvrir le stockage.'));};
    request.onerror=()=>{settled=true;reject(request.error);};
    request.onsuccess=()=>{const db=request.result;if(settled){db.close();return;}settled=true;db.onversionchange=()=>{db.close();databasePromise=null;};db.onclose=()=>{databasePromise=null;};resolve(db);};
  }).catch(error=>{databasePromise=null;throw error;});
  return databasePromise;
}
function done(tx){return new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=tx.onabort=()=>reject(tx.error??Error('Échec de l’enregistrement sur cet appareil.'));});}
export async function closeDatabase(){if(databasePromise){const db=await databasePromise;databasePromise=null;db.close();}}
function result(req){return new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
async function request(mode,operation){const db=await openDatabase(),tx=db.transaction('sessions',mode),finished=done(tx);let req;try{req=operation(tx.objectStore('sessions'));}catch(error){tx.abort();await finished.catch(()=>{});throw error;}const [value]=await Promise.all([result(req),finished]);return value;}
const validId = id => typeof id==='string'&&id.trim()===id&&id.length>0&&id.length<=200;
export async function saveSession(session){
  if(!validId(session?.id)||!(session.original instanceof Blob)||!Array.isArray(session.devices)||(session.rectified!=null&&!(session.rectified instanceof Blob)))throw Error('Séance photo incomplète.');
  const ids=new Set();
  for(const d of session.devices){if(!validId(d.id)||ids.has(d.id)||!(d.blob instanceof Blob))throw Error('Vignette absente ou identifiant en double.');ids.add(d.id);if(Boolean(d.validatedAt)!==Boolean(d.validatedBy?.trim())||(d.validatedAt&&!Number.isFinite(Date.parse(d.validatedAt))))throw Error('Validation humaine incomplète.');}
  const now=new Date().toISOString();
  if(session.createdAt&&!Number.isFinite(Date.parse(session.createdAt)))throw Error('Date de séance invalide.');
  const saved={...session,name:session.name?.trim()||'Séance photo',createdAt:session.createdAt||now,updatedAt:now,rectified:session.rectified??null};
  // Aucun await externe entre l'ouverture et les écritures d'une transaction.
  await request('readwrite',store=>store.put(saved));return saved;
}
export async function loadSession(id){if(!validId(id))throw Error('Identifiant de séance invalide.');return (await request('readonly',store=>store.get(id)))??null;}
export async function deleteSession(id){if(!validId(id))throw Error('Identifiant de séance invalide.');await request('readwrite',store=>store.delete(id));}
export async function listSessions(){
  const db=await openDatabase(),tx=db.transaction('sessions','readonly'),finished=done(tx),sessions=[];
  const scanned=new Promise((resolve,reject)=>{const req=tx.objectStore('sessions').openCursor();req.onerror=()=>reject(req.error);req.onsuccess=()=>{const c=req.result;if(!c){resolve();return;}const s=c.value;sessions.push({id:s.id,seance:s.seance||s.id,name:s.name,sourceName:s.sourceName,createdAt:s.createdAt,updatedAt:s.updatedAt,width:s.width,height:s.height,deviceCount:s.devices.length,validatedCount:s.devices.filter(d=>d.validatedAt&&d.validatedBy).length});c.continue();};});
  await Promise.all([scanned,finished]);return sessions.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
}
export async function listValidatedDevices(){
  const db=await openDatabase(),tx=db.transaction('sessions','readonly'),finished=done(tx),devices=[];
  // Une seule lecture séquentielle. Les Blobs restent hors du résultat et les
  // étiquettes conservent leur provenance : le rapprochement les vérifiera.
  const scanned=new Promise((resolve,reject)=>{
    const req=tx.objectStore('sessions').openCursor();req.onerror=()=>reject(req.error);
    req.onsuccess=()=>{
      const cursor=req.result;if(!cursor){resolve();return;}
      for(const device of Array.isArray(cursor.value.devices)?cursor.value.devices:[]){
        if(!device?.validatedAt||!Number.isFinite(Date.parse(device.validatedAt))||typeof device.validatedBy!=='string'||!device.validatedBy.trim())continue;
        devices.push({id:device.id,labels:device.labels,validatedAt:device.validatedAt,validatedBy:device.validatedBy});
      }
      cursor.continue();
    };
  });
  await Promise.all([scanned,finished]);return devices;
}
