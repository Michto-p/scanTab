function canvasOf(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  if (!width || !height || !canvas.getContext('2d')) throw Error('Les dimensions de cette photo ne sont pas prises en charge.');
  return canvas;
}

async function decodeImage(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(Error('Photo illisible ou format non pris en charge. Essayez une photo JPEG ou PNG.')); image.src = url; });
    return { source:image, width:image.naturalWidth, height:image.naturalHeight, close() {} };
  } finally { URL.revokeObjectURL(url); }
}

export async function loadPhoto(file) {
  if (!(file instanceof Blob) || !file.size || (file.type && !file.type.startsWith('image/'))) throw Error('Sélectionnez une photo non vide.');
  let decoded;
  if (typeof createImageBitmap === 'function') {
    try { const bitmap = await createImageBitmap(file, { imageOrientation:'from-image' }); decoded = {source:bitmap,width:bitmap.width,height:bitmap.height,close:()=>bitmap.close()}; }
    catch { /* Le décodeur Image sert de secours natif, notamment sur Safari. */ }
  }
  decoded ??= await decodeImage(file);
  try {
    const canvas = canvasOf(decoded.width, decoded.height);
    canvas.getContext('2d').drawImage(decoded.source, 0, 0);
    // Vérifie aussi les échecs d'allocation des grandes surfaces sur mobile.
    canvas.getContext('2d').getImageData(0, 0, 1, 1);
    return { canvas, width:canvas.width, height:canvas.height, blob:file, mime:file.type };
  } finally { decoded.close(); }
}

export function clarity(canvas) {
  const scale = Math.min(1, 384 / Math.max(canvas.width, canvas.height));
  const sample = canvasOf(Math.max(3, Math.round(canvas.width * scale)), Math.max(3, Math.round(canvas.height * scale)));
  const context = sample.getContext('2d', {willReadFrequently:true});
  context.drawImage(canvas, 0, 0, sample.width, sample.height);
  const {data,width,height} = context.getImageData(0, 0, sample.width, sample.height);
  const grey = new Float32Array(width * height);
  let sum=0, squared=0;
  for (let i=0; i<grey.length; i++) { const p=i*4; const light=.2126*data[p]+.7152*data[p+1]+.0722*data[p+2]; grey[i]=light; sum+=light; squared+=light*light; }
  if (Math.sqrt(Math.max(0,squared/grey.length-(sum/grey.length)**2)) < 8) return { score:0, warning:'Peu de détails visibles : vérifiez les marquages, la netteté ne peut pas être estimée.' };
  let total=0, totalSquared=0, count=0;
  for (let y=1;y<height-1;y++) for (let x=1;x<width-1;x++) { const i=y*width+x; const v=4*grey[i]-grey[i-1]-grey[i+1]-grey[i-width]-grey[i+width]; total+=v; totalSquared+=v*v; count++; }
  const variance=Math.max(0,totalSquared/count-(total/count)**2);
  const score=variance/(variance+180);
  return {score,warning:score<.25?'Netteté estimée faible : vérifiez les marquages et reprenez la photo si nécessaire.':''};
}
