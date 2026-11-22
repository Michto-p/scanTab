import test from 'node:test';
import assert from 'node:assert/strict';
import {crc32,createZip,exportBatch} from '../app/exports/zip.js';
import {createLabels,validateDevice,invalidateDevice} from '../app/interface/labels.js';
const utf8=new TextEncoder(),decoder=new TextDecoder();
const png=new Blob([Uint8Array.of(137,80,78,71,13,10,26,10,0)],{type:'image/png'});
function device(){const labels=createLabels();labels.famille.valeur='disjoncteur';labels.reference.valeur='REF-É-01';return validateDevice({id:'appareil-1',labels,blob:png,rect:{modules:1}},'AA');}
// Lecture indépendante des en-têtes locaux et du répertoire central.
async function unzip(blob){
  const bytes=new Uint8Array(await blob.arrayBuffer()),view=new DataView(bytes.buffer),files=new Map();let pos=0;
  while(view.getUint32(pos,true)===0x04034b50){assert.equal(view.getUint16(pos+8,true),0);assert.equal(view.getUint16(pos+6,true),0x0800);const size=view.getUint32(pos+18,true),nameLength=view.getUint16(pos+26,true),extra=view.getUint16(pos+28,true),name=decoder.decode(bytes.slice(pos+30,pos+30+nameLength)),start=pos+30+nameLength+extra,data=bytes.slice(start,start+size);assert.equal(crc32(data),view.getUint32(pos+14,true));files.set(name,{offset:pos,data});pos=start+size;}
  const centralStart=pos;
  for(const [name,file]of files){assert.equal(view.getUint32(pos,true),0x02014b50);assert.equal(view.getUint32(pos+42,true),file.offset);const length=view.getUint16(pos+28,true);assert.equal(decoder.decode(bytes.slice(pos+46,pos+46+length)),name);pos+=46+length;}
  assert.equal(view.getUint32(pos,true),0x06054b50);assert.equal(view.getUint16(pos+10,true),files.size);assert.equal(view.getUint32(pos+16,true),centralStart);assert.equal(pos+22,bytes.length);return files;
}
test('CRC standard, noms UTF-8 et ZIP lisible par ses deux répertoires',async()=>{
  assert.equal(crc32(utf8.encode('123456789')),0xcbf43926);
  const files=await unzip(await createZip([{name:'étiquettes.json',data:'électricité'},{name:'vignettes/a.png',data:png}]));
  assert.equal(decoder.decode(files.get('étiquettes.json').data),'électricité');assert.equal(files.size,2);
  for(const name of ['../photo.png','/photo.png','a\\photo.png','a/../photo.png'])await assert.rejects(createZip([{name,data:'x'}]));
  await assert.rejects(createZip([{name:'x',data:'1'},{name:'x',data:'2'}]));
});
test('Export : seulement le PNG validé, tous les champs et la séance de prise de vue',async()=>{
  const d=device(),unvalidated={...invalidateDevice(d),id:'appareil-2'};
  const files=await unzip(await exportBatch({id:'photo-1',seance:'meme-prise-de-vue',devices:[d,unvalidated]}));
  assert.equal(files.size,2);assert.ok(files.has('vignettes/appareil-1.png'));assert.ok(!files.has('vignettes/appareil-2.png'));
  const [label]=JSON.parse(decoder.decode(files.get('labels.json').data));
  assert.deepEqual(Object.keys(label),['id','famille','marque','référence','calibre','courbe','sensibilité','classe','pôles','modules','séance','date','validé_par']);
  assert.equal(label['séance'],'meme-prise-de-vue');assert.equal(label['référence'].valeur,'REF-É-01');assert.equal(label['validé_par'],'AA');assert.equal(label.marque.valeur,'inconnu');
});
test('Export vide, faux PNG, provenance machine et géométrie périmée refusés',async()=>{
  await assert.rejects(exportBatch({id:'x',devices:[invalidateDevice(device())]}),/Aucun appareil/);
  await assert.rejects(exportBatch({id:'x',devices:[{...device(),blob:new Blob(['faux'])}]}),/PNG/);
  const d=device();d.labels.famille.niveau='classifieur';await assert.rejects(exportBatch({id:'x',devices:[d]}),/humainement/);
  await assert.rejects(exportBatch({id:'x',cutsDirty:true,devices:[device()]}),/cadrage a changé/);
});
