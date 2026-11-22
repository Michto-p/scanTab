import {access,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseOCR} from '../app/identification/markings.js';
export {parseOCR} from '../app/identification/markings.js';

const require=createRequire(import.meta.url),root=fileURLToPath(new URL('../',import.meta.url));
const installation=resolve(root,'.local/ocr'),tessdata=resolve(installation,'tessdata');
let workerPromise=null,queue=Promise.resolve();
export async function ocrAvailable(){
  try{await Promise.all(['eng','fra'].map(lang=>access(resolve(tessdata,lang+'.traineddata'))));require.resolve(resolve(installation,'node_modules/tesseract.js'));return true;}catch{return false;}
}
async function worker(){
  if(!workerPromise)workerPromise=(async()=>{
    if(!await ocrAvailable())throw Error('OCR local non installé. Exécutez training/installer-ocr.ps1.');
    const {createWorker}=require(resolve(installation,'node_modules/tesseract.js'));
    const cache=resolve(installation,'cache');await mkdir(cache,{recursive:true});
    return createWorker('eng+fra',1,{langPath:tessdata.replaceAll('\\','/'),cachePath:cache,gzip:false,logger:()=>{}});
  })().catch(error=>{workerPromise=null;throw error;});
  return workerPromise;
}
export function recognizeOCR(bytes){
  const result=queue.then(async()=>{const current=await worker();try{const {data}=await current.recognize(Buffer.from(bytes),{},{text:true});const score=Number.isFinite(data.confidence)?Math.max(0,Math.min(100,data.confidence))/100:0;return {texte:data.text||'',confiance:score,champs:parseOCR(data.text,score),moteur:'tesseract-local'};}catch(error){workerPromise=null;await current.terminate().catch(()=>{});throw error;}});
  queue=result.catch(()=>{});return result;
}
export async function terminateOCR(){await queue;const promise=workerPromise;workerPromise=null;if(promise)await(await promise).terminate();}
