import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { detectFacades } from '../app/segmentation/facades.js';
import { homography, mapPoint, validateQuad } from '../app/pretraitement/geometry.js';

const fixture = JSON.parse(await readFile(new URL('./photos/facades-2d.annotations.json', import.meta.url), 'utf8'));
function inverse(m) {
  const [a,b,c,d,e,f,g,h,i] = m, determinant = a*(e*i-f*h)-b*(d*i-f*g)+c*(d*h-e*g);
  return [e*i-f*h,c*h-b*i,b*f-c*e,f*g-d*i,a*i-c*g,c*d-a*f,d*h-e*g,b*g-a*h,a*e-b*d].map(value => value / determinant);
}
function faceRects(scene) {
  const row = fixture.row;
  let x = row.x;
  return row.widths.map(modules => {
    const rect = { x, y: row.y, width: modules * row.pitch, height: scene.height ?? row.height };
    x += rect.width;
    return rect;
  });
}
function color(x, y, scene) {
  if (x < 0 || y < 0 || x >= fixture.scene.width || y >= fixture.scene.height) return 105;
  let gray = 185;
  for (const rect of faceRects(scene)) {
    const rx = x - rect.x, ry = y - rect.y;
    if (rx < 0 || ry < 0 || rx >= rect.width || ry >= rect.height) continue;
    gray = Math.min(rx, ry, rect.width - rx, rect.height - ry) < 2.5 ? 35 : 236;
    if(scene.interrupted&&(rx<2.5||rx>rect.width-2.5)&&ry>rect.height*.42&&ry<rect.height*.55)gray=236;
    if(scene.internalLine&&Math.abs(rx-rect.width*.5)<1.5&&ry>rect.height*.18&&ry<rect.height*.94)gray=40;
    if (scene.labels && rx > rect.width * .15 && rx < rect.width * .85 && ry > rect.height * .20 && ry < rect.height * .39) {
      if (rx < rect.width * .15 + 2 || rx > rect.width * .85 - 2 || ry < rect.height * .20 + 2 || ry > rect.height * .39 - 2) gray = 45;
      else if (ry > rect.height * .26 && ry < rect.height * .29) gray = 60;
    }
    if (rx > rect.width * .28 && rx < rect.width * .65 && ry > rect.height * .56 && ry < rect.height * .72) gray = 28;
  }
  return gray;
}
function raster(scene, factor = 1) {
  const width = fixture.width * factor, height = fixture.height * factor, data = new Uint8ClampedArray(width * height * 4);
  const world = homography(scene.points, fixture.scene.width, fixture.scene.height), transform = inverse(world);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const from = mapPoint(transform, (x + .5) / factor, (y + .5) / factor), gray = color(from.x, from.y, scene);
    data.set([gray,gray,gray,255], (y * width + x) * 4);
  }
  const expected = faceRects(scene).map(rect => [[rect.x,rect.y],[rect.x+rect.width,rect.y],[rect.x+rect.width,rect.y+rect.height],[rect.x,rect.y+rect.height]].map(([x,y]) => {
    const point = mapPoint(world, x, y); return { x: point.x * factor, y: point.y * factor };
  }));
  return { image: { width, height, data }, expected };
}

for (const scene of fixture.scenarios) test(`Contours 2D : ${scene.nom}`, () => {
  const { image, expected } = raster(scene), result = detectFacades(image);
  assert.equal(result.candidates.length, expected.length, JSON.stringify(result));
  const candidates = [...result.candidates].sort((a,b) => a.left - b.left);
  for (let i = 0; i < expected.length; i++) {
    const candidate = candidates[i];
    assert.ok(validateQuad(candidate.points, image.width, image.height));
    assert.equal(candidate.modules, null);
    assert.equal(candidate.famille, 'inconnu');
    assert.ok(candidate.confiance >= .75 && candidate.confiance < 1);
    assert.ok(Object.values(candidate.edgeSupport).every(value => value >= .75));
    candidate.points.forEach((point,j) => assert.ok(Math.hypot(point.x-expected[i][j].x,point.y-expected[i][j].y) <= scene.tolerance, JSON.stringify({ expected:expected[i], candidate })));
  }
});

test('Contours 2D : des joints interrompus gardent la hauteur et des largeurs inconnues, avec fusion possible',()=>{
  const {image,expected}=raster({...fixture.scenarios[0],interrupted:true}),result=detectFacades(image);
  // La séparation de tous les appareils n'est pas prouvée : ce scénario vérifie
  // l'absence de fausses coupes et de hauteur ramenée au seul marquage.
  assert.ok(result.candidates.length>=2&&result.candidates.length<=expected.length,JSON.stringify(result));
  for(const candidate of result.candidates){assert.ok(candidate.top<116);assert.ok(candidate.bottom>284);assert.equal(candidate.modules,null);assert.equal(candidate.famille,'inconnu');}
});

test('Contours 2D : les lignes imprimées sous le bandeau ne coupent pas les appareils larges',()=>{
  const {image,expected}=raster({...fixture.scenarios[0],internalLine:true}),result=detectFacades(image);
  assert.equal(result.candidates.length,expected.length,JSON.stringify(result));
  const candidates=[...result.candidates].sort((a,b)=>a.left-b.left);
  assert.ok(candidates[2].right-candidates[2].left>90,JSON.stringify(result));
});

test('Contours 2D : ROI et aperçu reviennent aux coordonnées pleine résolution sans modifier la photo', () => {
  const scene = fixture.scenarios[0], { image, expected } = raster(scene, 3), before = image.data.slice();
  const bounds = { x: 300, y: 270, width: 900, height: 630 }, result = detectFacades(image, { bounds });
  assert.equal(result.candidates.length, 4, JSON.stringify(result));
  const candidates = [...result.candidates].sort((a,b) => a.left - b.left);
  candidates.forEach((candidate,i) => candidate.points.forEach((point,j) => assert.ok(Math.hypot(point.x-expected[i][j].x,point.y-expected[i][j].y) <= 12)));
  assert.deepEqual(image.data, before);
  assert.deepEqual(bounds, { x:300, y:270, width:900, height:630 });
});

test('Contours 2D : photo uniforme, bruit fin et côtés ouverts restent inconnus', () => {
  const width = 320, height = 240, data = new Uint8ClampedArray(width*height*4).fill(255);
  assert.equal(detectFacades({width,height,data}).candidates.length, 0);
  let seed=19;
  for(let p=0;p<data.length;p+=4){seed=(Math.imul(seed,1664525)+1013904223)>>>0;data[p]=data[p+1]=data[p+2]=128+seed%13;}
  assert.equal(detectFacades({width,height,data}).candidates.length,0);
  data.fill(255);
  // Deux joints et un bord inférieur ne prouvent pas où finit la façade en haut.
  for(let y=70;y<200;y++)for(let x=75;x<210;x++)if(x<78||x>206||y>196)data.set([25,25,25,255],(y*width+x)*4);
  const result=detectFacades({width,height,data});
  assert.equal(result.candidates.length,0,JSON.stringify(result));
  assert.match(result.reason,/quatre côtés/i);
});

test('Contours 2D : un rectangle isolé garde son type inconnu', () => {
  const width=320,height=240,data=new Uint8ClampedArray(width*height*4).fill(255);
  for(let y=50;y<200;y++)for(let x=85;x<215;x++)data.set([35,35,35,255],(y*width+x)*4);
  const result=detectFacades({width,height,data});
  assert.equal(result.candidates.length,1,JSON.stringify(result));
  assert.equal(result.candidates[0].famille,'inconnu');
  assert.equal(result.candidates[0].modules,null);
  assert.match(result.warnings.join(' '),/ne prouve pas/);
});

test('Contours 2D : entrées invalides expliquées sans proposition', () => {
  for(const image of [null,{width:40,height:40,data:new Uint8Array(2)},{width:10,height:10,data:new Uint8Array(400)}]) assert.equal(detectFacades(image).candidates.length,0);
  const {image}=raster(fixture.scenarios[0]);
  assert.equal(detectFacades(image,{bounds:{x:-1,y:0,width:80,height:80}}).candidates.length,0);
});

test('Contours 2D : les façades peu contrastées du guidage gardent leur hauteur entière', async () => {
  const svg=await readFile(new URL('./photos/tableau-lecture-autonome.svg',import.meta.url),'utf8');
  const width=1040,height=720,data=new Uint8ClampedArray(width*height*4),groups=['#000000'];
  for(const tag of svg.matchAll(/<(rect|g|\/g)\b([^>]*)>/g)){
    if(tag[1]==='/g'){groups.pop();continue;}
    const attributes=Object.fromEntries([...tag[2].matchAll(/([\w-]+)="([^"]+)"/g)].map(match=>[match[1],match[2]]));
    if(tag[1]==='g'){groups.push(attributes.fill??groups.at(-1));continue;}
    const hex=(attributes.fill??groups.at(-1)).replace('#',''),expanded=hex.length===3?[...hex].map(value=>value+value).join(''):hex,rgb=[0,2,4].map(index=>parseInt(expanded.slice(index,index+2),16));
    const left=+(attributes.x??0),top=+(attributes.y??0);
    for(let y=top;y<top+(+attributes.height);y++)for(let x=left;x<left+(+attributes.width);x++)data.set([...rgb,255],(y*width+x)*4);
  }
  const result=detectFacades({width,height,data});
  assert.equal(result.candidates.length,6,JSON.stringify(result));
  for(const candidate of result.candidates){assert.ok(Math.abs(candidate.top-150)<7);assert.ok(Math.abs(candidate.bottom-570)<7);}
});
