import {validateQuad,rectifiedSize,homography} from './geometry.js';

export function warpPixels(source,points,onProgress=()=>{}){
  const {width:sw,height:sh,data:pixels}=source;
  if(!validateQuad(points,sw,sh))throw Error('Les quatre coins sont invalides ou se croisent.');
  const {width,height}=rectifiedSize(points),m=homography(points,width,height);
  if(width*height>40000000)throw Error('Le redressement dépasse 40 mégapixels. Resserrez le cadrage.');
  const data=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++){
    const cy=y+.5;
    for(let x=0;x<width;x++){
      const cx=x+.5,d=m[6]*cx+m[7]*cy+m[8];
      const sx=Math.min(sw-1,Math.max(0,(m[0]*cx+m[1]*cy+m[2])/d-.5)),sy=Math.min(sh-1,Math.max(0,(m[3]*cx+m[4]*cy+m[5])/d-.5));
      const x0=Math.floor(sx),y0=Math.floor(sy),dx=sx-x0,dy=sy-y0;
      const a=(y0*sw+x0)*4,b=(y0*sw+Math.min(sw-1,x0+1))*4,c=(Math.min(sh-1,y0+1)*sw+x0)*4,e=(Math.min(sh-1,y0+1)*sw+Math.min(sw-1,x0+1))*4;
      for(let channel=0;channel<4;channel++)data[(y*width+x)*4+channel]=(pixels[a+channel]*(1-dx)+pixels[b+channel]*dx)*(1-dy)+(pixels[c+channel]*(1-dx)+pixels[e+channel]*dx)*dy;
    }
    if(y%32===0)onProgress(y/height);
  }
  onProgress(1);return {width,height,data};
}
