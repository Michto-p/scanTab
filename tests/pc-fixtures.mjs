import {deflateSync} from 'node:zlib';
import {crc32,exportBatch} from '../app/exports/zip.js';
import {createLabels,validateDevice} from '../app/interface/labels.js';

// PNG synthétique minimal, uniquement destiné à la recette du transport.
export function testPNG(red=50) {
  const chunk=(name,data)=>{const type=Buffer.from(name),result=Buffer.alloc(data.length+12);result.writeUInt32BE(data.length);type.copy(result,4);data.copy(result,8);result.writeUInt32BE(crc32(Buffer.concat([type,data])),8+data.length);return result;};
  const header=Buffer.alloc(13);header.writeUInt32BE(1,0);header.writeUInt32BE(1,4);header[8]=8;header[9]=6;
  return new Blob([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.from([0,red,100,150,255]))),chunk('IEND',Buffer.alloc(0))],{type:'image/png'});
}
export function testDevice(id='device-1',red=50) {
  const labels=createLabels();labels.famille.valeur='disjoncteur';
  return validateDevice({id,labels,blob:testPNG(red),rect:{modules:1}},'Recette synthétique');
}
export async function testBatch(seance='seance-test',devices=[testDevice()]) {
  return new Uint8Array(await (await exportBatch({id:'photo-test',seance,devices})).arrayBuffer());
}
