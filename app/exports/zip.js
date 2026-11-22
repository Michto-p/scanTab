import {FIELDS,validateLabels} from '../interface/labels.js';
const UTF8=new TextEncoder(),MAX=0xffffffff;
const TABLE=Uint32Array.from({length:256},(_,v)=>{let c=v;for(let i=0;i<8;i++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
export function crc32(bytes){let crc=MAX;for(const b of bytes)crc=TABLE[(crc^b)&255]^(crc>>>8);return (crc^MAX)>>>0;}
export async function createZip(entries){
  if(!Array.isArray(entries)||entries.length>65535)throw Error('Trop de fichiers pour ce ZIP.');
  const locals=[],centrals=[],names=new Set();let offset=0,centralSize=0;
  for(const e of entries){
    if(typeof e.name!=='string'||!e.name||/[\\:\u0000-\u001f]/u.test(e.name)||e.name.split('/').some(p=>!p||p==='.'||p==='..')||names.has(e.name))throw Error('Nom de fichier ZIP invalide ou en double.');
    names.add(e.name);const name=UTF8.encode(e.name);
    const data=typeof e.data==='string'?UTF8.encode(e.data):e.data instanceof Blob?new Uint8Array(await e.data.arrayBuffer()):e.data;
    if(!(data instanceof Uint8Array)||name.length>65535)throw Error('Contenu de fichier ZIP invalide.');
    if(offset+data.length+name.length+30+centralSize+46+name.length+22>=MAX)throw Error('Lot trop volumineux pour un ZIP standard.');
    const date=e.date?new Date(e.date):new Date();if(!Number.isFinite(date.getTime()))throw Error('Date ZIP invalide.');
    const year=Math.min(2107,Math.max(1980,date.getUTCFullYear())),time=(date.getUTCHours()<<11)|(date.getUTCMinutes()<<5)|Math.floor(date.getUTCSeconds()/2),day=((year-1980)<<9)|((date.getUTCMonth()+1)<<5)|date.getUTCDate();
    const crc=crc32(data),local=new Uint8Array(30),l=new DataView(local.buffer);
    l.setUint32(0,0x04034b50,true);l.setUint16(4,20,true);l.setUint16(6,0x0800,true);l.setUint16(10,time,true);l.setUint16(12,day,true);l.setUint32(14,crc,true);l.setUint32(18,data.length,true);l.setUint32(22,data.length,true);l.setUint16(26,name.length,true);
    const central=new Uint8Array(46),c=new DataView(central.buffer);
    c.setUint32(0,0x02014b50,true);c.setUint16(4,20,true);c.setUint16(6,20,true);c.setUint16(8,0x0800,true);c.setUint16(12,time,true);c.setUint16(14,day,true);c.setUint32(16,crc,true);c.setUint32(20,data.length,true);c.setUint32(24,data.length,true);c.setUint16(28,name.length,true);c.setUint32(42,offset,true);
    locals.push(local,name,data);centrals.push(central,name);offset+=30+name.length+data.length;centralSize+=46+name.length;
  }
  const end=new Uint8Array(22),v=new DataView(end.buffer);v.setUint32(0,0x06054b50,true);v.setUint16(8,entries.length,true);v.setUint16(10,entries.length,true);v.setUint32(12,centralSize,true);v.setUint32(16,offset,true);
  return new Blob([...locals,...centrals,end],{type:'application/zip'});
}
export async function isPngBlob(blob){if(!(blob instanceof Blob)||blob.size<8)return false;const bytes=new Uint8Array(await blob.slice(0,8).arrayBuffer());return [137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v);}
const KEYS={reference:'référence',sensibilite:'sensibilité',poles:'pôles'};
export async function exportBatch(session){
  if(!session?.id||!Array.isArray(session.devices))throw Error('Séance invalide.');
  if(session.geometryDirty||session.cutsDirty)throw Error('Le cadrage a changé. Appliquez le redressement et le découpage avant de valider et exporter.');
  const devices=session.devices.filter(d=>d.validatedAt&&typeof d.validatedBy==='string'&&d.validatedBy.trim());
  if(!devices.length)throw Error('Aucun appareil validé à exporter.');
  const entries=[],records=[],ids=new Set();
  for(const d of devices){
    if(typeof d.id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/u.test(d.id)||ids.has(d.id))throw Error('Identifiant de vignette invalide ou en double.');ids.add(d.id);
    const check=validateLabels(d.labels,{validator:d.validatedBy});if(!check.valid)throw Error(check.errors.join('\n'));
    if(!Number.isFinite(Date.parse(d.validatedAt)))throw Error('Date de validation invalide.');
    if(d.rect?.modules!==undefined&&d.labels.modules.valeur!==d.rect.modules)throw Error('Largeur modifiée après validation.');
    const record={id:d.id};
    for(const {key} of FIELDS){const r=d.labels[key];if(r.niveau!=='manuel'||r.confiance!==(r.valeur==='inconnu'?0:1))throw Error('Étiquettes non confirmées humainement.');record[KEYS[key]??key]={...r};}
    if(!await isPngBlob(d.blob))throw Error('La vignette exportée doit être un PNG.');
    const date=new Date(d.validatedAt).toISOString();Object.assign(record,{'séance':session.seance||session.id,date,'validé_par':d.validatedBy.trim()});records.push(record);entries.push({name:`vignettes/${d.id}.png`,data:d.blob,date});
  }
  entries.push({name:'labels.json',data:JSON.stringify(records,null,2)});return createZip(entries);
}
