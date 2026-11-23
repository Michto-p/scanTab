// Les calculs de pixels restent sur l'appareil et hors du fil de l'interface.
let worker=null,sequence=0;
const pending=new Map();
const aborted=()=>new DOMException('Analyse annulée. La photo et les résultats terminés sont conservés.','AbortError');
function stop(error){
  worker?.terminate();worker=null;
  for(const job of pending.values()){job.cleanup();job.reject(error);}pending.clear();
}
function instance(){
  if(!worker){
    if(typeof Worker!=='function')throw Error('Ce navigateur ne permet pas les calculs locaux en arrière-plan.');
    worker=new Worker(new URL('./calcul-worker.js',import.meta.url),{type:'module'});
    worker.onmessage=({data})=>{
      const job=pending.get(data.id);if(!job)return;
      if(data.progress!==undefined){job.onProgress?.(data.progress);return;}
      pending.delete(data.id);job.cleanup();
      if(data.error)job.reject(Error(data.error));else job.resolve(data.result);
    };
    worker.onerror=()=>stop(Error('Le calcul local a échoué. Reprenez une photo moins grande ou plus nette.'));
  }
  return worker;
}
export function calculateImage(operation,image,{signal,onProgress,...parameters}={}){
  if(signal?.aborted)return Promise.reject(aborted());
  return new Promise((resolve,reject)=>{
    let current;try{current=instance();}catch(error){reject(error);return;}
    const id=++sequence,cancel=()=>stop(aborted());
    const timer=setTimeout(()=>stop(Error('Calcul trop long sur cet appareil. Reprenez une photo ou réduisez le cadrage.')),120000);
    const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',cancel);};
    pending.set(id,{resolve,reject,cleanup,onProgress});signal?.addEventListener('abort',cancel,{once:true});
    try{current.postMessage({id,operation,image,parameters},[image.data.buffer]);}catch(error){pending.delete(id);cleanup();reject(error);}
  });
}
export function terminateImageCalculations(){stop(aborted());}
