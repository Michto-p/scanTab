import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm,readFile,readdir} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {createPCServer} from '../training/server.mjs';
import {readBatchZip} from '../training/archive.mjs';
import {receiveBatch,prepareDataset,readManifests,partitionSamples} from '../training/corpus.mjs';
import {createZip} from '../app/exports/zip.js';
import {testBatch,testDevice,testPNG} from './pc-fixtures.mjs';
import {deflateRawSync} from 'node:zlib';
import {crc32} from '../app/exports/zip.js';
import {request as httpRequest} from 'node:http';

async function folder(t){const base=resolve('.local');await mkdir(base,{recursive:true});const path=await mkdtemp(resolve(base,'pc-test-'));t.after(async()=>{assert.ok(path.startsWith(base+sep));await rm(path,{recursive:true,force:true});});return path;}
test('Serveur PC : appairage requis, CORS restreint et moteur absent annoncé',async t=>{
  const directory=await folder(t),token='appairage-de-recette-sans-secret',origin='https://mon-compte.github.io';
  const server=createPCServer({dataDirectory:directory,token,origins:[origin]});
  await new Promise(done=>server.listen(0,'127.0.0.1',done));t.after(()=>{server.closeAllConnections();server.close();});
  const base='http://127.0.0.1:'+server.address().port,auth={Authorization:'Bearer '+token,Origin:origin};
  assert.equal((await fetch(base+'/api/status')).status,401);
  assert.equal((await fetch(base+'/api/status',{headers:{Authorization:'Bearer court'}})).status,401);
  assert.equal((await fetch(base+'/api/status',{headers:{...auth,Origin:'https://autre.example'}})).status,403);
  for(const bad of ['null',origin+'.attaquant.example'])assert.equal((await fetch(base+'/api/status',{headers:{...auth,Origin:bad}})).status,403);
  const rebound=await new Promise((done,fail)=>{const req=httpRequest(base+'/api/status',{headers:{...auth,Host:'intrus.example'}},res=>{res.resume();done(res.statusCode);});req.on('error',fail);req.end();});
  assert.equal(rebound,403);
  const preflight=await fetch(base+'/api/batches',{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization, content-type','Access-Control-Request-Private-Network':'true'}});
  assert.equal(preflight.status,204);assert.equal(preflight.headers.get('access-control-allow-origin'),origin);assert.equal(preflight.headers.get('access-control-allow-private-network'),'true');
  const info=await (await fetch(base+'/api/status',{headers:auth})).json();assert.equal(info.capabilities.analysis,false);assert.equal(info.capabilities.training,false);assert.equal(info.model,null);
  const analysis=await fetch(base+'/api/analyze',{method:'POST',headers:auth});assert.equal(analysis.status,503);assert.match((await analysis.json()).error,/Aucune analyse/);
  const bytes=await testBatch();const accepted=await fetch(base+'/api/batches',{method:'POST',headers:{...auth,'Content-Type':'application/zip'},body:bytes});assert.equal(accepted.status,201);assert.equal((await accepted.json()).received,1);
  const duplicate=await fetch(base+'/api/batches',{method:'POST',headers:{...auth,'Content-Type':'application/zip'},body:bytes});assert.equal((await duplicate.json()).repeated,true);
  const prepared=await (await fetch(base+'/api/dataset/prepare',{method:'POST',headers:auth})).json();assert.equal(prepared.readyForTraining,false);assert.equal(prepared.sessionGroups,1);
});
test('Réception atomique des seules validations humaines et dédoublonnage PNG',async t=>{
  const directory=await folder(t);const bytes=await testBatch('seance-a');
  await receiveBatch(directory,bytes);await receiveBatch(directory,await testBatch('seance-b',[testDevice('device-2')]));
  assert.equal((await readdir(resolve(directory,'images'))).length,1);
  const manifests=await readManifests(directory);assert.equal(manifests.length,2);
  const dataset=partitionSamples(manifests);assert.equal(dataset.sessionGroups,1);assert.equal([...dataset.train,...dataset.validation,...dataset.test].length,1);
  const result=await prepareDataset(directory);assert.equal(result.conflicts,0);assert.ok(JSON.parse(await readFile(resolve(directory,'dataset.json'),'utf8')).createdAt);
  const files=readBatchZip(bytes),labels=JSON.parse(new TextDecoder().decode(files.get('labels.json')));labels[0]['validé_par']='';
  const invalid=await createZip([{name:'labels.json',data:JSON.stringify(labels)},{name:'vignettes/device-1.png',data:testPNG()}]);
  await assert.rejects(receiveBatch(directory,new Uint8Array(await invalid.arrayBuffer())),/validation humaine/);assert.equal((await readManifests(directory)).length,2);
});
test('Analyse séparée du corpus et verrou des travaux d’entraînement',async t=>{
  const directory=await folder(t),token='appairage-recette-moteur',origin='https://mon-compte.github.io';let release,trained=0,analyzed=0;
  const pending=new Promise(done=>release=done);
  const engine={capabilities:{analysis:true,training:true},status:async()=>({model:null,message:'Moteur simulé de recette.'}),analyze:async bytes=>{analyzed++;assert.ok(bytes.length);return {champs:{}};},train:async()=>{trained++;await pending;return {ok:true};}};
  const server=createPCServer({dataDirectory:directory,token,origins:[origin],engine});
  await new Promise(done=>server.listen(0,'127.0.0.1',done));t.after(()=>{release();server.closeAllConnections();server.close();});
  const base='http://127.0.0.1:'+server.address().port,headers={Authorization:'Bearer '+token,Origin:origin};
  const result=await fetch(base+'/api/analyze',{method:'POST',headers:{...headers,'Content-Type':'image/png'},body:testPNG()});assert.equal(result.status,200);assert.equal(analyzed,1);assert.equal((await readManifests(directory)).length,0);
  const job=await(await fetch(base+'/api/train',{method:'POST',headers})).json();assert.equal(job.state,'running');
  assert.equal((await fetch(base+'/api/train',{method:'POST',headers})).status,409);
  assert.equal((await fetch(base+'/api/dataset/prepare',{method:'POST',headers})).status,409);
  release();let completed;
  for(let i=0;i<50;i++){completed=await(await fetch(base+'/api/jobs/'+job.id,{headers})).json();if(completed.state!=='running')break;await new Promise(done=>setTimeout(done,10));}
  assert.equal(completed.state,'completed');assert.equal(trained,1);
  assert.equal((await fetch(base+'/api/jobs/'+job.id)).status,401);
});
test('ZIP corrompu, chemin détourné et faux PNG refusés avant stockage',async t=>{
  const directory=await folder(t),bytes=await testBatch(),corrupt=bytes.slice();corrupt[70]^=1;assert.throws(()=>readBatchZip(corrupt));
  const zip=await createZip([{name:'vignettes/aaa.png',data:testPNG()}]),unsafe=Buffer.from(await zip.arrayBuffer()),name=Buffer.from('vignettes/aaa.png'),replacement=Buffer.from('../'+'x'.repeat(name.length-3));
  for(let at=unsafe.indexOf(name);at!==-1;at=unsafe.indexOf(name,at+name.length))replacement.copy(unsafe,at);
  assert.throws(()=>readBatchZip(unsafe),/Nom de fichier/);
  const d=testDevice();d.blob=new Blob([Uint8Array.of(137,80,78,71,13,10,26,10)]);await assert.rejects(receiveBatch(directory,await testBatch('seance-a',[d])),/PNG invalide/);
  assert.equal((await readManifests(directory)).length,0);
});
test('Conflits exclus et aucune séance répartie entre entraînement et test',()=>{
  const sample=(imageHash,id,seance,family='disjoncteur',date='2026-11-22T12:00:00.000Z')=>({imageHash,label:{id,'séance':seance,date,...Object.fromEntries(['famille','marque','référence','calibre','courbe','sensibilité','classe','pôles','modules'].map(key=>[key,{valeur:key==='famille'?family:key==='modules'?1:'inconnu'}]))}});
  const samples=[];
  for(let s=0;s<40;s++)for(let p=0;p<2;p++)samples.push(sample(`image-${s}-${p}`,`device-${p}`,`seance-${s}`));
  // Deux séances liées par une image identique doivent rester ensemble.
  samples.push(sample('doublon','da','seance-1'),sample('doublon','db','seance-2'));
  samples.push(sample('conflit','ca','seance-a'),sample('conflit','cb','seance-b','contacteur'));
  const dataset=partitionSamples([{samples}]);assert.equal(dataset.conflicts.length,1);
  const memberships=new Map();for(const key of ['train','validation','test'])for(const item of dataset[key])for(const seance of item.seances){if(memberships.has(seance))assert.equal(memberships.get(seance),key);memberships.set(seance,key);}
  assert.equal(memberships.get('seance-1'),memberships.get('seance-2'));assert.ok(dataset.train.length&&dataset.validation.length&&dataset.test.length);
  const newer=sample('corrige','meme','seance-c','contacteur','2026-11-22T13:00:00.000Z'),older=sample('corrige','meme','seance-c');
  const corrected=partitionSamples([{samples:[older,newer]}]);assert.equal(corrected.conflicts.length,0);assert.equal([...corrected.train,...corrected.validation,...corrected.test][0].label.famille.valeur,'contacteur');
});
test('Décompression bornée même si le ZIP annonce une taille mensongère',()=>{
  const data=Buffer.alloc(100000,65),packed=deflateRawSync(data),name=Buffer.from('labels.json');
  const local=Buffer.alloc(30),central=Buffer.alloc(46),end=Buffer.alloc(22),checksum=crc32(data);
  local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(8,8);local.writeUInt32LE(checksum,14);local.writeUInt32LE(packed.length,18);local.writeUInt32LE(data.length,22);local.writeUInt16LE(name.length,26);
  central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(8,10);central.writeUInt32LE(checksum,16);central.writeUInt32LE(packed.length,20);central.writeUInt32LE(data.length,24);central.writeUInt16LE(name.length,28);
  end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(46+name.length,12);end.writeUInt32LE(30+name.length+packed.length,16);
  assert.equal(readBatchZip(Buffer.concat([local,name,packed,central,name,end])).get('labels.json').length,data.length);
  local.writeUInt32LE(1,22);central.writeUInt32LE(1,24);
  assert.throws(()=>readBatchZip(Buffer.concat([local,name,packed,central,name,end])),/larger than|taille|size|buffer|length/i);
});
