import {mkdir,readFile,writeFile,readdir,rename} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {readBatchZip} from './archive.mjs';
import {FIELDS,FAMILIES,validateLabels} from '../app/interface/labels.js';
import {crc32} from '../app/exports/zip.js';

const hash = value => createHash('sha256').update(value).digest('hex');
const EXPORT_KEYS = {reference:'référence',sensibilite:'sensibilité',poles:'pôles'};
export const sha256 = hash;

function checkedRecord(record) {
  if(!record || typeof record.id!=='string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(record.id) ||
    typeof record['séance']!=='string' || !record['séance'].trim() || record['séance'].length>200 ||
    typeof record['validé_par']!=='string' || !record['validé_par'].trim() || record['validé_par'].length>200 ||
    typeof record.date!=='string' || !Number.isFinite(Date.parse(record.date))) throw Error('Étiquette sans séance, date ou validation humaine valide.');
  const labels={}, clean={id:record.id};
  for(const {key} of FIELDS){
    const exported=EXPORT_KEYS[key]??key, r=record[exported];
    if(!r || !['string','number'].includes(typeof r.valeur) || String(r.valeur).length>300 || (typeof r.valeur==='string'&&(!r.valeur.trim()||r.valeur!==r.valeur.trim())) || r.niveau!=='manuel' || r.confiance!==(r.valeur==='inconnu'?0:1)) throw Error('Le lot doit contenir uniquement des étiquettes confirmées humainement.');
    labels[key]=r;clean[exported]={valeur:r.valeur,confiance:r.confiance,niveau:'manuel'};
  }
  if(!validateLabels(labels,{validator:record['validé_par']}).valid || !FAMILIES.includes(labels.famille.valeur) || typeof labels.modules.valeur!=='number')throw Error('Famille ou largeur d’appareil invalide.');
  return {...clean,'séance':record['séance'].trim(),date:new Date(record.date).toISOString(),'validé_par':record['validé_par'].trim()};
}
export function checkPNG(data) {
  if(data.length<33 || ![137,80,78,71,13,10,26,10].every((v,i)=>data[i]===v))throw Error('Vignette PNG invalide.');
  const view=new DataView(data.buffer,data.byteOffset,data.byteLength),width=view.getUint32(16),height=view.getUint32(20);
  if(view.getUint32(8)!==13 || String.fromCharCode(...data.subarray(12,16))!=='IHDR' || !width || !height || width*height>40000000)throw Error('Dimensions de vignette PNG invalides ou supérieures à 40 mégapixels.');
  let pos=8,hasData=false,ended=false;
  while(pos+12<=data.length){const length=view.getUint32(pos),end=pos+12+length;if(end>data.length)throw Error('PNG tronqué.');const type=String.fromCharCode(...data.subarray(pos+4,pos+8));if(crc32(data.subarray(pos+4,pos+8+length))!==view.getUint32(pos+8+length))throw Error('CRC de vignette PNG incorrect.');if(type==='IDAT')hasData=true;if(type==='IEND'){if(length!==0||end!==data.length)throw Error('Fin de PNG incorrecte.');ended=true;break;}pos=end;}
  if(!hasData||!ended)throw Error('Vignette PNG incomplète.');
}
export async function readManifests(directory) {
  const folder=resolve(directory,'batches');await mkdir(folder,{recursive:true});
  const files=(await readdir(folder)).filter(name=>/^[a-f0-9]{64}\.json$/.test(name)).sort();
  return Promise.all(files.map(async name=>JSON.parse(await readFile(resolve(folder,name),'utf8'))));
}
export async function receiveBatch(directory,bytes) {
  const files=readBatchZip(bytes);let labels;
  try { labels=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(files.get('labels.json'))); } catch { throw Error('labels.json illisible.'); }
  if(!Array.isArray(labels)||!labels.length||labels.length>500)throw Error('Le lot doit contenir de 1 à 500 appareils validés.');
  const ids=new Set(),samples=[];
  for(const record of labels){
    const label=checkedRecord(record);
    if(ids.has(label.id))throw Error('Identifiant d’appareil en double.');ids.add(label.id);
    const png=files.get(`vignettes/${label.id}.png`);if(!png)throw Error('Vignette absente pour une étiquette.');checkPNG(png);
    samples.push({imageHash:hash(png),label,png});
  }
  if(files.size!==samples.length+1)throw Error('Le ZIP contient des fichiers sans étiquette humaine.');
  const batchHash=hash(bytes), manifests=await readManifests(directory);
  if(manifests.some(m=>m.id===batchHash))return {id:batchHash,received:0,duplicates:samples.length,repeated:true};
  const previous=new Set(manifests.flatMap(m=>m.samples.map(s=>s.imageHash)));
  const imageDir=resolve(directory,'images');await mkdir(imageDir,{recursive:true});
  let added=0;
  for(const sample of samples){
    if(!previous.has(sample.imageHash)){previous.add(sample.imageHash);added++;}
    const target=resolve(imageDir,sample.imageHash+'.png');
    try{if(hash(await readFile(target))!==sample.imageHash)throw Error('Une image du corpus PC est corrompue. Corrigez-la avant de réimporter le lot.');}
    catch(error){if(error.code!=='ENOENT')throw error;const temporary=resolve(imageDir,randomUUID()+'.tmp');await writeFile(temporary,sample.png);await rename(temporary,target);}
  }
  const manifest={version:1,id:batchHash,receivedAt:new Date().toISOString(),samples:samples.map(({png,...sample})=>sample)};
  const temporary=resolve(directory,'batches',randomUUID()+'.tmp');
  await writeFile(temporary,JSON.stringify(manifest,null,2));await rename(temporary,resolve(directory,'batches',batchHash+'.json'));
  return {id:batchHash,received:samples.length,newImages:added,duplicates:samples.length-added,repeated:false};
}

export function partitionSamples(manifests) {
  const images=new Map(), parent=new Map();
  const find=x=>{if(!parent.has(x))parent.set(x,x);if(parent.get(x)!==x)parent.set(x,find(parent.get(x)));return parent.get(x);};
  const union=(a,b)=>{a=find(a);b=find(b);if(a!==b)parent.set(a<b?b:a,a<b?a:b);};
  for(const m of manifests)for(const sample of m.samples){
    const seance=sample.label['séance'];find(seance);
    if(!images.has(sample.imageHash))images.set(sample.imageHash,[]);
    images.get(sample.imageHash).push(sample);
  }
  // Une image dupliquée relie ses séances : elles restent dans le même lot d'évaluation.
  for(const sources of images.values())for(const source of sources.slice(1))union(sources[0].label['séance'],source.label['séance']);
  const train=[],validation=[],test=[],conflicts=[];
  for(const [imageHash,sources]of images){
    // Une correction plus récente de la même vignette remplace sa version précédente.
    const latest=new Map(),ambiguous=new Set();
    for(const source of sources){const key=JSON.stringify([source.label['séance'],source.label.id]),old=latest.get(key);if(!old||source.label.date>old.label.date){latest.set(key,source);ambiguous.delete(key);}else if(source.label.date===old.label.date&&JSON.stringify(source.label)!==JSON.stringify(old.label))ambiguous.add(key);}
    const chosen=[...latest.values()], signatures=new Set(chosen.map(s=>JSON.stringify(FIELDS.map(({key})=>s.label[EXPORT_KEYS[key]??key].valeur))));
    if(ambiguous.size||signatures.size!==1){conflicts.push({imageHash,seances:[...new Set(sources.map(s=>s.label['séance']))]});continue;}
    const root=find(sources[0].label['séance']),bucket=parseInt(hash(root).slice(0,8),16)%10;
    const split=bucket===0?test:bucket===1?validation:train;
    split.push({imageHash,path:'images/'+imageHash+'.png',label:chosen[0].label,seances:[...new Set(sources.map(s=>s.label['séance']))].sort()});
  }
  return {version:1,createdAt:new Date().toISOString(),train,validation,test,conflicts,sessionGroups:new Set([...parent.keys()].map(find)).size};
}
export async function prepareDataset(directory) {
  const dataset=partitionSamples(await readManifests(directory));
  const temporary=resolve(directory,randomUUID()+'.tmp');await writeFile(temporary,JSON.stringify(dataset,null,2));await rename(temporary,resolve(directory,'dataset.json'));
  const families=new Set(dataset.train.map(s=>s.label.famille.valeur));
  return {train:dataset.train.length,validation:dataset.validation.length,test:dataset.test.length,conflicts:dataset.conflicts.length,sessionGroups:dataset.sessionGroups,families:families.size,readyForTraining:families.size>=2&&dataset.train.length>0&&dataset.validation.length>0&&dataset.test.length>0};
}
