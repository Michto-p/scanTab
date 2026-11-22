import {spawn} from 'node:child_process';
import {mkdir,writeFile,unlink} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {ocrAvailable,recognizeOCR,terminateOCR} from './ocr.mjs';
import {checkPNG} from './corpus.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
export function pythonCall(directory,args,{timeout=120000,onProcess=()=>{}}={}){
  return new Promise((accept,reject)=>{
    const child=spawn(resolve(root,'.local/python/python.exe'),['-I','-X','utf8',resolve(root,'training/engine.py'),'--data-dir',resolve(directory),...args],{shell:false,windowsHide:true,env:{...process.env,PYTHONIOENCODING:'utf-8',TORCH_HOME:resolve(directory,'torch-cache')},stdio:['ignore','pipe','pipe']});
    onProcess(child);let out='',err='',failure=null;
    const timer=setTimeout(()=>{failure=Error('Le travail Python a dépassé son délai maximal.');child.kill();},timeout);
    child.stdout.on('data',chunk=>{out+=chunk.toString('utf8');if(out.length>1024*1024){failure=Error('Réponse du moteur trop volumineuse.');child.kill();}});
    child.stderr.on('data',chunk=>{err=(err+chunk.toString('utf8')).slice(-8000);});
    child.on('error',error=>{failure=Error('Python local indisponible : '+error.message);});
    child.on('close',code=>{clearTimeout(timer);if(failure){reject(failure);return;}try{const result=JSON.parse(out);if(code!==0||!result.ok)throw Error(result.error||'Le moteur Python a échoué.');accept(result);}catch(error){reject(Error(out.trim().startsWith('{')?error.message:'Le moteur Python a échoué : '+err.slice(-1000)));}});
  });
}

export async function createLocalEngine(directory){
  let info=null;try{info=await pythonCall(directory,['status'],{timeout:30000});}catch{/* Collecte et OCR restent disponibles sans Python. */}
  const ocr=await ocrAvailable(),children=new Set();let analyzing=false,closed=false;
  const run=(args,options={})=>pythonCall(directory,args,{...options,onProcess:child=>{children.add(child);child.once('close',()=>children.delete(child));}});
  return {
    capabilities:{analysis:ocr||Boolean(info?.model),training:Boolean(info?.backbone)},
    status:async()=>{
      if(info)info=await run(['status'],{timeout:30000});
      return {model:info?.model??null,message:`OCR local ${ocr?'disponible':'absent'}. ${info?.model?'Modèle de familles évalué disponible.':'Aucun modèle de familles entraîné : famille inconnue.'} ${info?.backbone?'Entraînement CPU disponible après collecte suffisante.':'Extracteur visuel non préparé.'}`};
    },
    analyze:async bytes=>{
      if(closed||analyzing)throw Object.assign(Error('Une analyse est déjà en cours sur ce PC.'),{status:409});
      checkPNG(bytes);analyzing=true;let temporary;
      try{
        const result={champs:{famille:{valeur:'inconnu',confiance:0,niveau:'classifieur'}},texte:'',limites:['Les scores OCR et classifieur ne sont pas des probabilités calibrées.']};
        if(ocr){const recognized=await recognizeOCR(bytes);Object.assign(result.champs,recognized.champs);result.texte=recognized.texte;result.confianceOCR=recognized.confiance;}
        if(info?.model){
          const relative='inference/'+randomUUID()+'.png';temporary=resolve(directory,relative);await mkdir(resolve(directory,'inference'),{recursive:true});await writeFile(temporary,bytes);
          const prediction=await run(['analyze','--image',relative]);Object.assign(result.champs,prediction.results[0]?.champs??{});result.modelVersion=prediction.modelVersion;
        }else result.limites.push('Aucun modèle électrique entraîné : la famille reste inconnue.');
        return result;
      }finally{if(temporary)await unlink(temporary).catch(()=>{});analyzing=false;}
    },
    train:async()=>{if(closed)throw Error('Moteur arrêté.');const result=await run(['train'],{timeout:60*60*1000});info=await run(['status']);return result;},
    close:async()=>{closed=true;for(const child of children)child.kill();await terminateOCR();}
  };
}
