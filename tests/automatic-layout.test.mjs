import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {analyzeLayout,calibrateRow} from '../app/segmentation/automatic.js';
import {validateRow,deviceRects} from '../app/segmentation/rows.js';

const fixture=JSON.parse(await readFile(new URL('./photos/segmentation-autonome.annotations.json',import.meta.url),'utf8'));
const historicSVG=await readFile(new URL('./photos/tableau-synthetique.svg',import.meta.url),'utf8');
const historicAnnotations=JSON.parse(await readFile(new URL('./photos/tableau-synthetique.annotations.json',import.meta.url),'utf8'));
function raster(scene) {
  const {width,height,pitch,left}=scene,data=new Uint8ClampedArray(width*height*4);
  let seed=19;
  const fill=(x,y,w,h,color)=>{
    for(let v=Math.max(0,y);v<Math.min(height,y+h);v++)for(let u=Math.max(0,x);u<Math.min(width,x+w);u++){
      const p=(v*width+u)*4;data[p]=color;data[p+1]=color;data[p+2]=color;data[p+3]=255;
    }
  };
  fill(0,0,width,height,218);fill(25,20,width-50,height-40,195);
  for(const row of scene.rows) {
    const full=row.widths.reduce((sum,n)=>sum+n,0)*pitch;
    fill(left,row.top,full,row.bottom-row.top,242);
    let cursor=left;
    for(const modules of row.widths){
      fill(cursor,row.top,3,row.bottom-row.top,75);
      // Un levier limité au milieu de la façade ne doit pas devenir une coupe.
      fill(Math.round(cursor+modules*pitch*.3),row.top+58,Math.max(8,Math.round(modules*pitch*.35)),38,40);
      cursor+=modules*pitch;
    }
    fill(cursor-3,row.top,3,row.bottom-row.top,75);
    if(scene.reflection)fill(left+12,row.top+12,Math.round(full*.65),12,255);
  }
  if(scene.noise)for(let p=0;p<data.length;p+=4){seed=(Math.imul(seed,1664525)+1013904223)>>>0;const noise=(seed%9)-4;for(let channel=0;channel<3;channel++)data[p+channel]+=noise;}
  return {width,height,data};
}

for(const scene of fixture.scenes)test(`Segmentation autonome : ${scene.nom}`,()=>{
  const result=analyzeLayout(raster(scene));
  if(scene.ambiguous){assert.equal(result.rows.length,0);assert.match(result.warnings.join(' '),/pas de 18 mm/);return;}
  assert.equal(result.rows.length,scene.rows.length);
  result.rows.forEach((row,index)=>{
    const expected=scene.rows[index],modules=expected.widths.reduce((sum,n)=>sum+n,0);
    assert.equal(validateRow(row,scene.width,scene.height),true);
    assert.equal(row.modules,modules);
    assert.ok(Math.abs(row.scale.pixelsPerModule-scene.pitch)<1,JSON.stringify(row.scale));
    assert.ok(Math.abs(row.left-scene.left)<4);
    assert.ok(Math.abs(row.top-expected.top)<4);
    assert.ok(Math.abs(row.bottom-expected.bottom)<4);
    assert.deepEqual(deviceRects(row,scene.width).map(rect=>rect.modules),expected.widths);
    assert.ok(row.confidence>=.78&&row.confidence<1);
  });
});

test('Fond uniforme, image invalide et quelques rectangles ne fabriquent aucune échelle',()=>{
  const data=new Uint8ClampedArray(320*240*4).fill(255);
  assert.equal(analyzeLayout({width:320,height:240,data}).rows.length,0);
  assert.equal(analyzeLayout(null).rows.length,0);
  const image=raster({width:400,height:300,left:90,pitch:40,rows:[{top:70,bottom:245,widths:[4,4]}]});
  assert.equal(analyzeLayout(image).rows.length,0);
});

test('L’aperçu de calcul restitue les coordonnées de la photo pleine résolution',()=>{
  const original=fixture.scenes[1],factor=3;
  const scene={...original,width:original.width*factor,height:original.height*factor,pitch:original.pitch*factor,left:original.left*factor,rows:original.rows.map(row=>({...row,top:row.top*factor,bottom:row.bottom*factor}))};
  const result=analyzeLayout(raster(scene));
  assert.equal(result.rows.length,2);
  for(const row of result.rows){
    assert.equal(row.modules,13);
    assert.ok(Math.abs(row.left-scene.left)<6);
    assert.ok(Math.abs(row.scale.pixelsPerModule-scene.pitch)<2);
    assert.equal(validateRow(row,scene.width,scene.height),true);
  }
});

test('Le dessin historique donne deux rangées de treize modules sans nombre imposé',()=>{
  const {width,height}=historicAnnotations,data=new Uint8ClampedArray(width*height*4);
  // Ce SVG de référence ne contient que des rectangles entiers sans opacité.
  // Leur rasterisation directe évite une dépendance DOM pour la recette Node.
  for(const rectangle of historicSVG.matchAll(/<rect\b([^>]+)\/>/g)){
    const attributes=Object.fromEntries([...rectangle[1].matchAll(/([a-z]+)="([^"]+)"/g)].map(match=>[match[1],match[2]]));
    const color=attributes.fill.match(/^#([0-9a-f]{6})$/i);assert.ok(color);
    const rgb=[0,2,4].map(offset=>parseInt(color[1].slice(offset,offset+2),16));
    for(let y=+attributes.y;y<+attributes.y+(+attributes.height);y++)for(let x=+attributes.x;x<+attributes.x+(+attributes.width);x++){
      const p=(y*width+x)*4;data.set([...rgb,255],p);
    }
  }
  const result=analyzeLayout({width,height,data});
  assert.equal(result.rows.length,2);
  result.rows.forEach((row,index)=>{
    const expected=historicAnnotations.rows[index];
    assert.equal(row.modules,expected.modules);
    assert.deepEqual(row.cuts,expected.cuts);
    for(const bound of ['top','bottom','left','right'])assert.ok(Math.abs(row[bound]-expected[bound])<=historicAnnotations.tolerance_px,`${bound} : ${row[bound]} / ${expected[bound]}`);
  });
});

test('Une perspective marquée demande un redressement au lieu d’inventer une échelle',()=>{
  const scene=fixture.scenes[0],source=raster(scene),data=new Uint8ClampedArray(source.data.length).fill(255);
  // Les frontières se déplacent de 25 px entre haut et bas de façade.
  for(let y=0;y<source.height;y++){
    const shift=Math.round((y-scene.rows[0].top)*25/(scene.rows[0].bottom-scene.rows[0].top));
    for(let x=0;x<source.width;x++){
      const target=x+shift;if(target<0||target>=source.width)continue;
      const from=(y*source.width+x)*4,to=(y*source.width+target)*4;
      data.set(source.data.subarray(from,from+4),to);
    }
  }
  const result=analyzeLayout({width:source.width,height:source.height,data});
  assert.equal(result.rows.length,0);
  assert.ok(result.warnings.length>0);
});

test('Le fond noir et les bornes ne multiplient pas les coupes dans un appareil large',()=>{
  const scene=fixture.scenes[0],image=raster(scene),row=scene.rows[0];
  const set=(x,y,value)=>{const p=(y*image.width+x)*4;image.data[p]=value;image.data[p+1]=value;image.data[p+2]=value;};
  const right=scene.left+row.widths.reduce((sum,width)=>sum+width,0)*scene.pitch;
  // Goulotte sombre autour de la façade : son bord n'est pas aligné au pas.
  for(let y=row.top-12;y<row.bottom+12;y++)for(let x=scene.left-15;x<right+15;x++)if(y<row.top||y>=row.bottom||x<scene.left||x>=right)set(x,y,14);
  let cursor=scene.left;
  for(const modules of row.widths){
    // Plusieurs bornes sur une même façade de deux modules restent courtes.
    for(let terminal=0;terminal<modules;terminal++)for(const top of [row.top+8,row.bottom-21])for(let y=top;y<top+12;y++)for(let x=cursor+terminal*scene.pitch+12;x<cursor+terminal*scene.pitch+24;x++)set(x,y,20);
    cursor+=modules*scene.pitch;
  }
  const result=analyzeLayout(image);
  assert.equal(result.rows.length,1);
  assert.equal(result.rows[0].modules,8,JSON.stringify(result));
  assert.deepEqual(deviceRects(result.rows[0],image.width).map(rect=>rect.modules),row.widths);
});

test('Un repère explicite de 18 mm débloque une rangée de deux appareils larges',()=>{
  const scene={width:520,height:320,left:90,pitch:40,rows:[{top:75,bottom:245,widths:[4,4]}]},image=raster(scene);
  assert.equal(analyzeLayout(image).rows.length,0);
  const row=calibrateRow(image,{...scene.rows[0],left:90,right:410},40);
  assert.equal(validateRow(row,image.width,image.height),true);
  assert.equal(row.modules,8);
  assert.deepEqual(row.cuts,[0,4,8]);
  assert.equal(row.scale.source,'repere-18-mm');
  assert.equal(row.scale.confidence,1);
  assert.equal(row.scale.pixelsPerMillimeter,40/18);
  assert.ok(row.confidence<1);
});

test('Le repère de 18 mm conserve les demi-modules et ne crée aucune coupe invisible',()=>{
  const scene=fixture.scenes[2],image=raster(scene),source=scene.rows[0];
  const row=calibrateRow(image,{...source,left:scene.left,right:scene.left+scene.pitch*9},40);
  assert.deepEqual(deviceRects(row,image.width).map(rect=>rect.modules),source.widths);
  const blank={width:320,height:240,data:new Uint8ClampedArray(320*240*4).fill(255)};
  const plain=calibrateRow(blank,{top:20,bottom:220,left:40,right:280},40);
  assert.deepEqual(plain.cuts,[0,6]);
  assert.equal(plain.modules,6);
  assert.equal(plain.confidence,.45);
});

test('Une calibration hors image ou avec un repère incohérent est rejetée',()=>{
  const image=raster(fixture.scenes[0]),row={top:75,bottom:245,left:90,right:410};
  for(const invalid of [0,1,-4,NaN,Infinity,500])assert.throws(()=>calibrateRow(image,row,invalid),/repère|incohérent/);
  assert.throws(()=>calibrateRow(image,{...row,right:521},40),/limites|image/);
  assert.throws(()=>calibrateRow(image,{...row,top:245},40),/limites|image/);
  assert.throws(()=>calibrateRow(null,row,40),/Image invalide/);
});
