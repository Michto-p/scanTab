import {access,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const require=createRequire(import.meta.url),root=fileURLToPath(new URL('../',import.meta.url));
const installation=resolve(root,'.local/ocr'),tessdata=resolve(installation,'tessdata');
let workerPromise=null,queue=Promise.resolve();
const unknown=()=>({valeur:'inconnu',confiance:0,niveau:'ocr_caracteristiques'});
const confidence=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=100?(value>1?value/100:value):0;

// Seuls les marquages explicites sont extraits. Le score OCR global n'est pas calibré.
export function parseOCR(text,score=0){
  const trust=confidence(score),sets=Object.fromEntries(['marque','reference','calibre','courbe','sensibilite','classe','poles'].map(k=>[k,new Set()]));
  const finish=()=>Object.fromEntries(Object.entries(sets).map(([k,s])=>[k,trust>=.8&&s.size===1?{valeur:[...s][0],confiance:trust,niveau:k==='reference'?'ocr_reference':'ocr_caracteristiques'}:unknown()]));
  if(typeof text!=='string'||trust<.8)return finish();
  const source=text.normalize('NFKC'),number=s=>Number(s.replace(',','.'));
  for(const [brand,re]of [['ABB',/\bABB\b/i],['Hager',/\bHAGER\b/i],['Legrand',/\bLEGRAND\b/i],['Schneider Electric',/\bSCHNEIDER(?:\s+ELECTRIC)?\b/i],['Siemens',/\bSIEMENS\b/i],['Eaton',/\bEATON\b/i],['Gewiss',/\bGEWISS\b/i],['Chint',/\bCHINT\b/i],['Merlin Gerin',/\bMERLIN\s+GERIN\b/i],['Moeller',/\bMOELLER\b/i]])if(re.test(source))sets.marque.add(brand);
  for(const m of source.matchAll(/\br[ée]f(?:[ée]rence)?\.?\s*[:#=]?\s*([A-Z0-9][A-Z0-9._/-]{1,39})(?=$|[\s;,:()])/giu))if(/\d/.test(m[1]))sets.reference.add(m[1].replace(/[.]+$/,'').toUpperCase());
  // Masque les références étiquetées pour ne pas lire C16 à l'intérieur de « Réf. C16 ».
  const markings=source.replace(/\br[ée]f(?:[ée]rence)?\.?\s*[:#=]?\s*[A-Z0-9][A-Z0-9._/-]{1,39}/giu,'');
  for(const m of markings.matchAll(/(?<![\p{L}\p{N}.,])(\d+(?:[.,]\d+)?)\s*mA\b/giu)){const n=number(m[1]);if(n>0&&n<=3000)sets.sensibilite.add(n+' mA');}
  const zones=[];
  for(const m of markings.matchAll(/\bI\s*[Δ∆δ]\s*n\s*[:=]?\s*(\d+(?:[.,]\d+)?)\s*(mA|A)\b/giu)){zones.push([m.index,m.index+m[0].length]);const n=number(m[1])*(m[2].toLowerCase()==='ma'?1:1000);if(n>0&&n<=3000)sets.sensibilite.add(Number(n.toFixed(6))+' mA');}
  for(const m of markings.matchAll(/\b([BCD])(\d{1,3}(?:[.,]\d+)?)\b/giu)){const n=number(m[2]);if(n>=.5&&n<=1000){sets.courbe.add(m[1].toUpperCase());sets.calibre.add(n+' A');}}
  for(const m of markings.matchAll(/\bcourbe\s*[:=]?\s*([BCD])\b/giu))sets.courbe.add(m[1].toUpperCase());
  for(const m of markings.matchAll(/(?<![\p{L}\p{N}.,])(\d+(?:[.,]\d+)?)\s*A\b/giu)){const n=number(m[1]);if(n>=.5&&n<=1000&&!zones.some(([a,b])=>m.index<b&&m.index+m[0].length>a))sets.calibre.add(n+' A');}
  for(const m of markings.matchAll(/\b(?:classe(?:\s+diff[ée]rentielle)?|type)\s*[:=]?\s*(AC|A|F|B)\b/giu))sets.classe.add(m[1].toUpperCase());
  for(const m of markings.matchAll(/\b([1-4])\s*P\s*\+\s*N\b|\b([1-4])\s*P\b/giu))sets.poles.add(m[1]?m[1]+'P+N':m[2]+'P');
  return finish();
}
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
