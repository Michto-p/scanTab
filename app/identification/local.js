import Tesseract from '../vendor/ocr/tesseract.esm.min.js';
import {identifyMarkings,reconcileMarkingReadings} from './markings.js';
import {loadPhoto} from '../capture/photo.js';

let current=null,starting=null,active=false,progressListener=null,generation=0;
const abortError=()=>new DOMException('Analyse annulée. Les propositions déjà terminées sont conservées.','AbortError');
const base=new URL('../vendor/ocr/',import.meta.url);
const {createWorker}=Tesseract;
function progress(event){
  const labels={'loading tesseract core':'Ouverture du moteur embarqué','initializing tesseract':'Préparation de l’OCR','loading language traineddata':'Chargement des langues locales','initializing api':'Préparation de la lecture','recognizing text':'Lecture des marquages'};
  progressListener?.({status:labels[event.status]||'Préparation locale',progress:Number.isFinite(event.progress)?event.progress:0});
}
async function worker(){
  if(current)return current;
  if(!starting){const version=generation;const opening=createWorker('eng+fra',1,{
    workerPath:new URL('worker.min.js',base).href,corePath:new URL('core/',base).href,langPath:new URL('tessdata/',base).href,
    workerBlobURL:false,gzip:false,cacheMethod:'none',logger:event=>{if(version===generation)progress(event);},errorHandler:()=>{}
  }).then(async value=>{if(version!==generation){await value.terminate();throw abortError();}current=value;await value.setParameters({tessedit_pageseg_mode:'11',user_defined_dpi:'300'});return value;}).finally(()=>{if(starting===opening)starting=null;});starting=opening;}
  return starting;
}
async function prepareImage(blob,{enlarged=false}={}){
  const {canvas}=await loadPhoto(blob);
  if(canvas.width*canvas.height>40000000)throw Error('Vignette trop grande pour l’OCR embarqué.');
  const scale=Math.min(3,Math.max(1,720/canvas.height)*(enlarged?2:1),1800/Math.max(canvas.width,canvas.height));
  const sample=document.createElement('canvas'),padding=12;
  sample.width=Math.round(canvas.width*scale)+padding*2;sample.height=Math.round(canvas.height*scale)+padding*2;
  const context=sample.getContext('2d',{willReadFrequently:true});context.fillStyle='white';context.fillRect(0,0,sample.width,sample.height);context.drawImage(canvas,padding,padding,sample.width-padding*2,sample.height-padding*2);
  // Accentuation de contraste sur une copie de lecture ; le PNG original reste intact.
  const pixels=context.getImageData(0,0,sample.width,sample.height),histogram=new Uint32Array(256);let sum=0,squared=0,count=0;
  for(let y=padding;y<sample.height-padding;y++)for(let x=padding;x<sample.width-padding;x++){const p=(y*sample.width+x)*4,v=Math.round(.2126*pixels.data[p]+.7152*pixels.data[p+1]+.0722*pixels.data[p+2]);histogram[v]++;sum+=v;squared+=v*v;count++;}
  if(Math.sqrt(Math.max(0,squared/count-(sum/count)**2))<4){canvas.width=0;canvas.height=0;sample.width=0;sample.height=0;return null;}
  const percentile=f=>{let total=0;for(let i=0;i<256;i++){total+=histogram[i];if(total>=count*f)return i;}return 255;};
  const low=percentile(.02),high=percentile(.98),stretch=high-low>=40;
  for(let p=0;p<pixels.data.length;p+=4){let v=.2126*pixels.data[p]+.7152*pixels.data[p+1]+.0722*pixels.data[p+2];if(stretch)v=Math.max(0,Math.min(255,(v-low)*255/(high-low)));pixels.data[p]=pixels.data[p+1]=pixels.data[p+2]=v;}
  context.putImageData(pixels,0,0);canvas.width=0;canvas.height=0;return sample;
}

// Un seul worker pour limiter la mémoire sur téléphone ; les lots le réutilisent.
export async function recognizeLocal(blob,{onProgress=()=>{},signal}={}){
  if(signal?.aborted)throw abortError();
  if(active)throw Error('Une lecture locale est déjà en cours.');
  if(!(blob instanceof Blob)||!blob.size)throw Error('Une vignette non vide est nécessaire.');
  active=true;progressListener=onProgress;let rejectAbort,stopped=false;
  const interrupted=new Promise((_,reject)=>{rejectAbort=reject;});
  const cancel=()=>{stopped=true;rejectAbort(abortError());void terminateLocalOCR();};
  signal?.addEventListener('abort',cancel,{once:true});
  const timeout=setTimeout(()=>{stopped=true;rejectAbort(Error('Lecture trop longue sur cet appareil. Recadrez les marquages ou reprenez une photo plus nette.'));void terminateLocalOCR();},120000);
  try{
    const work=(async()=>{
      let first=null,firstSize=null;
      for(const enlarged of [false,true]){
        if(enlarged)onProgress({status:'Nouvelle lecture agrandie des marquages',progress:0});
        const image=await prepareImage(blob,{enlarged});
        if(!image)return {...identifyMarkings('',0),texte:'',confianceOCR:0,moteur:'tesseract-embarque',limites:['Peu de détails : marquages inconnus. Reprendre une photo nette.']};
        try{
          if(stopped||signal?.aborted)throw abortError();
          if(firstSize&&image.width===firstSize.width&&image.height===firstSize.height)return first;
          firstSize={width:image.width,height:image.height};
          const instance=await worker();if(stopped||signal?.aborted)throw abortError();
          const {data}=await instance.recognize(image,{},{text:true,tsv:true});if(stopped||signal?.aborted)throw abortError();
          const score=Number.isFinite(data.confidence)?Math.max(0,Math.min(100,data.confidence))/100:0;
          const result={...identifyMarkings(data.text||'',score,{tsv:data.tsv}),texte:data.text||'',confianceOCR:score,moteur:'tesseract-embarque'};
          if(first)return reconcileMarkingReadings(first,result);
          const reliable=key=>result.champs[key]?.valeur!=='inconnu'&&result.champs[key]?.confiance>=.8;
          // Un différentiel lisible peut encore perdre le seul mot de sa classe
          // après redressement : la seconde passe garde le même seuil strict.
          const missingDifferentialClass=['interrupteur différentiel','disjoncteur différentiel'].includes(result.champs.famille?.valeur)&&reliable('famille')&&reliable('sensibilite')&&!reliable('classe');
          if(!missingDifferentialClass&&['reference','calibre','famille'].some(reliable))return result;
          first=result;
        }finally{image.width=0;image.height=0;}
      }
      return first;
    })();
    return await Promise.race([work,interrupted]);
  }catch(error){
    await terminateLocalOCR();
    if(error instanceof Error||error instanceof DOMException)throw error;
    throw Error('Lecture locale indisponible. Vérifiez le chargement hors ligne et la netteté de la photo.');
  }finally{clearTimeout(timeout);signal?.removeEventListener('abort',cancel);progressListener=null;active=false;}
}
export async function terminateLocalOCR(){
  generation++;starting=null;
  const instance=current;current=null;
  if(instance)await instance.terminate();
}
