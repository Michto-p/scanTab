import {validateQuad} from './geometry.js';
import {calculateImage} from './calcul.js';
import {loadPhoto} from '../capture/photo.js';
export function pngBlob(canvas) { return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('Image trop grande ou mémoire insuffisante pour créer le PNG.')),'image/png')); }
function checkSignal(signal){if(signal?.aborted)throw new DOMException('Analyse annulée. Les originaux sont conservés.','AbortError');}
export async function rectify(canvas,points,{signal,onProgress}={}) {
  checkSignal(signal);
  if(!validateQuad(points,canvas.width,canvas.height))throw Error('Les quatre coins sont invalides ou se croisent.');
  if(canvas.width*canvas.height>40000000)throw Error('Cette photo dépasse 40 mégapixels. Importez une photo moins grande pour le redressement local.');
  const image=canvas.getContext('2d',{willReadFrequently:true}).getImageData(0,0,canvas.width,canvas.height);
  const result=await calculateImage('redressement',image,{points,signal,onProgress});
  checkSignal(signal);
  const output=document.createElement('canvas');output.width=result.width;output.height=result.height;
  const context=output.getContext('2d');if(!context)throw Error('Mémoire insuffisante pour redresser cette photo.');
  context.putImageData(new ImageData(result.data,result.width,result.height),0,0);return output;
}
export async function cutoutDevice(blob,{signal}={}) {
  checkSignal(signal);
  const {canvas}=await loadPhoto(blob);
  let output;
  try{
    checkSignal(signal);
    if(canvas.width*canvas.height>40000000)return {blob:null,details:{applied:false,confidence:0,niveau:'geometrie',reason:'Image trop grande pour ce détourage local ; la vignette originale est conservée.'}};
    const image=canvas.getContext('2d',{willReadFrequently:true}).getImageData(0,0,canvas.width,canvas.height);
    // Le tampon RGBA suffit au worker ; le bitmap temporaire peut être libéré.
    canvas.width=0;canvas.height=0;
    const {imageData,...details}=await calculateImage('détourage',image,{signal});checkSignal(signal);
    if(!details.applied||details.confidence<.8)return {blob:null,details};
    output=document.createElement('canvas');output.width=imageData.width;output.height=imageData.height;
    const context=output.getContext('2d');if(!context)throw Error('Mémoire insuffisante pour détourer cette vignette.');
    context.putImageData(new ImageData(imageData.data,imageData.width,imageData.height),0,0);
    const result=await pngBlob(output);checkSignal(signal);return {blob:result,details};
  }finally{canvas.width=0;canvas.height=0;if(output){output.width=0;output.height=0;}}
}
export async function cropDevice(canvas,rect) {
  const {x,y,width,height}=rect;
  if(![x,y,width,height].every(Number.isFinite)||width<=0||height<=0)throw Error('Rectangle de découpage invalide.');
  // Les bords partagés sont arrondis de façon identique, sans recouvrement entre voisins.
  const left=Math.max(0,Math.round(x)),top=Math.max(0,Math.round(y)),right=Math.min(canvas.width,Math.round(x+width)),bottom=Math.min(canvas.height,Math.round(y+height));
  if(right<=left||bottom<=top)throw Error('Découpe vide ou hors de la photo.');
  const result=document.createElement('canvas');result.width=right-left;result.height=bottom-top;
  try{
    result.getContext('2d').drawImage(canvas,left,top,right-left,bottom-top,0,0,result.width,result.height);
    return await pngBlob(result);
  }finally{result.width=0;result.height=0;}
}

/** Redresse une façade depuis ses pixels source, sans réduire sa définition. */
export async function rectifyDevice(canvas,points,{signal}={}) {
  checkSignal(signal);
  if(!validateQuad(points,canvas.width,canvas.height))throw Error('Contour de façade invalide pour le redressement.');
  // Extraire seulement l'enveloppe avant le transfert au worker évite de
  // recopier les mégapixels de toute la photo pour chaque petit appareil.
  const left=Math.max(0,Math.floor(Math.min(...points.map(p=>p.x)))),top=Math.max(0,Math.floor(Math.min(...points.map(p=>p.y))));
  const right=Math.min(canvas.width,Math.ceil(Math.max(...points.map(p=>p.x)))),bottom=Math.min(canvas.height,Math.ceil(Math.max(...points.map(p=>p.y))));
  const source=document.createElement('canvas');source.width=right-left;source.height=bottom-top;
  let output;
  try{
    const context=source.getContext('2d');if(!context)throw Error('Mémoire insuffisante pour extraire cette façade.');
    context.drawImage(canvas,left,top,source.width,source.height,0,0,source.width,source.height);
    output=await rectify(source,points.map(p=>({x:p.x-left,y:p.y-top})),{signal});checkSignal(signal);
    const blob=await pngBlob(output);checkSignal(signal);
    return {blob,width:output.width,height:output.height,points:points.map(p=>({...p}))};
  }finally{source.width=0;source.height=0;if(output){output.width=0;output.height=0;}}
}
