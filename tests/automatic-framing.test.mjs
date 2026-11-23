import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { detectPanelQuad } from '../app/pretraitement/cadrage.js';
import { homography, mapPoint, rectifiedSize, validateQuad } from '../app/pretraitement/geometry.js';
import { analyzeLayout } from '../app/segmentation/automatic.js';

const fixture = JSON.parse(await readFile(new URL('./photos/cadrage-autonome.annotations.json', import.meta.url), 'utf8'));
function inverse(m) {
  const [a,b,c,d,e,f,g,h,i] = m;
  const determinant = a*(e*i-f*h)-b*(d*i-f*g)+c*(d*h-e*g);
  return [e*i-f*h,c*h-b*i,b*f-c*e,f*g-d*i,a*i-c*g,c*d-a*f,d*h-e*g,b*g-a*h,a*e-b*d].map(value => value/determinant);
}
function panelColor(x,y,scene) {
  const panel=fixture.panel;
  if(x<0||y<0||x>=panel.width||y>=panel.height)return 76;
  if(x<4||y<4||x>=panel.width-4||y>=panel.height-4)return 38;
  if(scene.empty)return 209;
  const {left,top,pitch,deviceHeight,widths}=panel, right=left+widths.reduce((sum,width)=>sum+width,0)*pitch;
  if(x<left||x>=right||y<top||y>=top+deviceHeight)return 209;
  let cursor=left;
  for(const modules of widths){
    if(x>=cursor&&x<cursor+3)return 55;
    if(x>=cursor+modules*pitch*.3&&x<cursor+modules*pitch*.65&&y>top+74&&y<top+116)return 34;
    cursor+=modules*pitch;
  }
  if(x>=right-3)return 55;
  if(scene.reflection&&y>top+12&&y<top+22&&x<left+(right-left)*.7)return 255;
  return 244;
}
function raster(scene,factor=1) {
  const width=fixture.width*factor,height=fixture.height*factor,data=new Uint8ClampedArray(width*height*4);
  const transform=inverse(homography(scene.points,fixture.panel.width,fixture.panel.height));
  let seed=271;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const source=mapPoint(transform,(x+.5)/factor,(y+.5)/factor);
    let gray=panelColor(source.x,source.y,scene);
    if(scene.noise){seed=(Math.imul(seed,1664525)+1013904223)>>>0;gray+=(seed%(scene.noise*2+1))-scene.noise;}
    const index=(y*width+x)*4;data[index]=gray;data[index+1]=gray;data[index+2]=gray;data[index+3]=255;
  }
  return {width,height,data};
}
function warp(source,points) {
  const size=rectifiedSize(points),transform=homography(points,size.width,size.height),data=new Uint8ClampedArray(size.width*size.height*4);
  for(let y=0;y<size.height;y++)for(let x=0;x<size.width;x++){
    const from=mapPoint(transform,x+.5,y+.5),sx=Math.max(0,Math.min(source.width-1,Math.round(from.x-.5))),sy=Math.max(0,Math.min(source.height-1,Math.round(from.y-.5)));
    data.set(source.data.subarray((sy*source.width+sx)*4,(sy*source.width+sx)*4+4),(y*size.width+x)*4);
  }
  return {...size,data};
}

for(const scene of fixture.scenes)test(`Cadrage autonome : ${scene.nom}`,()=>{
  const image=raster(scene),result=detectPanelQuad(image);
  if(scene.unknown){assert.equal(result.points,null);assert.equal(result.confiance,0);return;}
  assert.equal(result.niveau,'geometrie');
  assert.ok(result.confiance>=.8&&result.confiance<1,JSON.stringify(result));
  assert.equal(validateQuad(result.points,image.width,image.height),true);
  result.points.forEach((point,index)=>assert.ok(Math.hypot(point.x-scene.points[index].x,point.y-scene.points[index].y)<=scene.tolerance_px,JSON.stringify(result)));
  const layout=analyzeLayout(warp(image,result.points));
  assert.equal(layout.rows.length,1);
  assert.equal(layout.rows[0].modules,8);
  assert.deepEqual(layout.rows[0].cuts,[0,2,3,4,5,6,8]);
});

test('Cadrage : image uniforme, bruit et objets encombrés ne fabriquent aucun tableau',()=>{
  const width=320,height=240,data=new Uint8ClampedArray(width*height*4).fill(255);
  assert.equal(detectPanelQuad({width,height,data}).points,null);
  let seed=37;
  for(let p=0;p<data.length;p+=4){seed=(Math.imul(seed,1664525)+1013904223)>>>0;const gray=126+(seed%19);data[p]=gray;data[p+1]=gray;data[p+2]=gray;}
  assert.equal(detectPanelQuad({width,height,data}).points,null);
  data.fill(255);
  for(const rectangle of [{x:15,y:20,w:108,h:67},{x:160,y:15,w:137,h:73},{x:40,y:130,w:112,h:90},{x:190,y:120,w:65,h:103}])for(let y=rectangle.y;y<rectangle.y+rectangle.h;y++)for(let x=rectangle.x;x<rectangle.x+rectangle.w;x++){
    const index=(y*width+x)*4,gray=x<rectangle.x+3||x>=rectangle.x+rectangle.w-3||y<rectangle.y+3||y>=rectangle.y+rectangle.h-3?35:190;
    data[index]=gray;data[index+1]=gray;data[index+2]=gray;
  }
  assert.equal(detectPanelQuad({width,height,data}).points,null);
  assert.equal(detectPanelQuad(null).points,null);
  assert.equal(detectPanelQuad({width:32,height:32,data:new Uint8Array(32*32*4)}).points,null);
});

test('Cadrage : les coins reviennent à la résolution originale après aperçu borné',()=>{
  const scene=fixture.scenes[1],factor=3,image=raster(scene,factor),result=detectPanelQuad(image);
  assert.equal(validateQuad(result.points,image.width,image.height),true);
  // Le coffret possède un cadre de 4 px : son bord intérieur comme son bord
  // extérieur sont des cadrages recevables, avec tolérance ramenée au facteur.
  for(let i=0;i<4;i++)assert.ok(Math.hypot(result.points[i].x-scene.points[i].x*factor,result.points[i].y-scene.points[i].y*factor)<scene.tolerance_px*factor,JSON.stringify(result));
});

test('Cadrage : une rangée sans coffret conserve le champ et ses marges',async()=>{
  const svg=await readFile(new URL('./photos/tableau-lecture-autonome.svg',import.meta.url),'utf8');
  const width=1040,height=720,data=new Uint8ClampedArray(width*height*4),groups=['#000000'];
  // Les textes sont ignorés dans cette recette de contours ; la recette Chrome
  // utilise le SVG complet et son OCR. Seuls les rectangles sont rasterisés.
  for(const tag of svg.matchAll(/<(rect|g|\/g)\b([^>]*)>/g)){
    if(tag[1]==='/g'){groups.pop();continue;}
    const attributes=Object.fromEntries([...tag[2].matchAll(/([\w-]+)="([^"]+)"/g)].map(match=>[match[1],match[2]]));
    if(tag[1]==='g'){groups.push(attributes.fill??groups.at(-1));continue;}
    const fill=attributes.fill??groups.at(-1),hex=fill.replace('#',''),expanded=hex.length===3?[...hex].map(value=>value+value).join(''):hex;
    const rgb=[0,2,4].map(index=>parseInt(expanded.slice(index,index+2),16));
    const left=+(attributes.x??0),top=+(attributes.y??0);
    for(let y=top;y<top+(+attributes.height);y++)for(let x=left;x<left+(+attributes.width);x++)data.set([...rgb,255],(y*width+x)*4);
  }
  assert.equal(detectPanelQuad({width,height,data}).points,null);
  assert.equal(analyzeLayout({width,height,data}).rows[0].modules,8);
});
