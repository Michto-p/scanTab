import {inflateRawSync} from 'node:zlib';
import {crc32} from '../app/exports/zip.js';

export const MAX_BATCH_BYTES = 128 * 1024 * 1024;
const MAX_FILE_BYTES = 32 * 1024 * 1024;
const decoder = new TextDecoder('utf-8', {fatal:true});

// Lecture en mémoire : aucun nom de l'archive n'est utilisé comme chemin disque.
export function readBatchZip(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length < 22 || bytes.length > MAX_BATCH_BYTES) throw Error('Archive vide ou supérieure à 128 Mo.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let pos = bytes.length - 22; pos >= Math.max(0, bytes.length - 65557); pos--) {
    if (view.getUint32(pos, true) === 0x06054b50 && pos + 22 + view.getUint16(pos + 20, true) === bytes.length) { end = pos; break; }
  }
  if (end < 0 || view.getUint16(end+4,true) || view.getUint16(end+6,true)) throw Error('ZIP invalide ou multi-volume non pris en charge.');
  const count = view.getUint16(end+10,true), centralSize = view.getUint32(end+12,true), start = view.getUint32(end+16,true);
  if (!count || count > 501 || count !== view.getUint16(end+8,true) || start + centralSize !== end) throw Error('Répertoire ZIP invalide ou plus de 500 vignettes.');
  const files = new Map(), names = new Set(), ranges = []; let pos = start, total = 0;
  for (let i=0; i<count; i++) {
    if (pos+46>end || view.getUint32(pos,true)!==0x02014b50) throw Error('Répertoire ZIP incomplet.');
    const flags=view.getUint16(pos+8,true), method=view.getUint16(pos+10,true), crc=view.getUint32(pos+16,true), compressed=view.getUint32(pos+20,true), size=view.getUint32(pos+24,true);
    const nameLength=view.getUint16(pos+28,true), extra=view.getUint16(pos+30,true), comment=view.getUint16(pos+32,true), offset=view.getUint32(pos+42,true);
    if (pos+46+nameLength+extra+comment>end || size>MAX_FILE_BYTES || total+size>MAX_BATCH_BYTES || ![0,8].includes(method) || (flags&~0x0808) || view.getUint16(pos+34,true)) throw Error('Fichier ZIP non pris en charge ou trop volumineux.');
    const rawName=bytes.slice(pos+46,pos+46+nameLength), name=decoder.decode(rawName);
    if (!(name==='labels.json' || /^vignettes\/[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.png$/.test(name)) || names.has(name.toLowerCase())) throw Error('Nom de fichier inattendu ou en double dans le ZIP.');
    names.add(name.toLowerCase());
    if (offset+30>start || view.getUint32(offset,true)!==0x04034b50 || view.getUint16(offset+8,true)!==method || view.getUint16(offset+6,true)!==flags) throw Error('En-tête ZIP incohérent.');
    if(!(flags&8)&&(view.getUint32(offset+14,true)!==crc||view.getUint32(offset+18,true)!==compressed||view.getUint32(offset+22,true)!==size))throw Error('Tailles ou CRC différents entre les deux en-têtes ZIP.');
    const localLength=view.getUint16(offset+26,true), localExtra=view.getUint16(offset+28,true), begin=offset+30+localLength+localExtra;
    if (begin+compressed>start || decoder.decode(bytes.slice(offset+30,offset+30+localLength))!==name) throw Error('Contenu ZIP hors limites.');
    const packed=bytes.subarray(begin,begin+compressed);
    const data=method===0?packed:inflateRawSync(packed,{maxOutputLength:Math.min(MAX_FILE_BYTES,size+1)});
    if (data.length!==size || crc32(data)!==crc) throw Error('Taille ou CRC incorrect dans le ZIP.');
    if (ranges.some(([a,b])=>offset<b&&begin+compressed>a)) throw Error('Fichiers ZIP superposés.');
    ranges.push([offset,begin+compressed]);files.set(name,data);total+=size;pos+=46+nameLength+extra+comment;
  }
  if(pos!==end||!files.has('labels.json')||files.get('labels.json').length>2*1024*1024)throw Error('labels.json absent ou invalide.');
  return files;
}
