import {validateQuad,rectifiedSize,homography} from './geometry.js';
export function pngBlob(canvas) { return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('Image trop grande ou mémoire insuffisante pour créer le PNG.')),'image/png')); }
export async function rectify(canvas,points) {
  if(!validateQuad(points,canvas.width,canvas.height)) throw Error('Les quatre coins sont invalides ou se croisent.');
  const {width,height}=rectifiedSize(points), m=homography(points,width,height);
  const result=document.createElement('canvas');result.width=width;result.height=height;
  const context=result.getContext('2d');
  if(!context)throw Error('Mémoire insuffisante pour redresser cette photo.');
  const source=canvas.getContext('2d',{willReadFrequently:true}).getImageData(0,0,canvas.width,canvas.height);
  const pixels=source.data, sw=source.width, sh=source.height;
  // Calcul par bandes dans l'image pleine résolution, avec interpolation bilinéaire.
  for(let top=0;top<height;top+=32){
    const count=Math.min(32,height-top), band=context.createImageData(width,count), out=band.data;
    for(let localY=0;localY<count;localY++){
      const y=top+localY+.5;
      for(let x=0;x<width;x++){
        const cx=x+.5,d=m[6]*cx+m[7]*y+m[8];
        const sx=Math.min(sw-1,Math.max(0,(m[0]*cx+m[1]*y+m[2])/d-.5));
        const sy=Math.min(sh-1,Math.max(0,(m[3]*cx+m[4]*y+m[5])/d-.5));
        const x0=Math.floor(sx),y0=Math.floor(sy),dx=sx-x0,dy=sy-y0;
        const a=(y0*sw+x0)*4,b=(y0*sw+Math.min(sw-1,x0+1))*4,c=(Math.min(sh-1,y0+1)*sw+x0)*4,e=(Math.min(sh-1,y0+1)*sw+Math.min(sw-1,x0+1))*4;
        const dest=(localY*width+x)*4;
        for(let channel=0;channel<4;channel++)out[dest+channel]=(pixels[a+channel]*(1-dx)+pixels[b+channel]*dx)*(1-dy)+(pixels[c+channel]*(1-dx)+pixels[e+channel]*dx)*dy;
      }
    }
    context.putImageData(band,0,top);
    await new Promise(resolve=>setTimeout(resolve,0));
  }
  return result;
}
export async function cropDevice(canvas,rect) {
  const {x,y,width,height}=rect;
  if(![x,y,width,height].every(Number.isFinite)||width<=0||height<=0)throw Error('Rectangle de découpage invalide.');
  // Les bords partagés sont arrondis de façon identique, sans recouvrement entre voisins.
  const left=Math.max(0,Math.round(x)),top=Math.max(0,Math.round(y)),right=Math.min(canvas.width,Math.round(x+width)),bottom=Math.min(canvas.height,Math.round(y+height));
  if(right<=left||bottom<=top)throw Error('Découpe vide ou hors de la photo.');
  const result=document.createElement('canvas');result.width=right-left;result.height=bottom-top;
  result.getContext('2d').drawImage(canvas,left,top,right-left,bottom-top,0,0,result.width,result.height);
  return pngBlob(result);
}
