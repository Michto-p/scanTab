// Copie reproductible des distributions déjà compilées ; aucune compilation de l'application.
import {mkdir,readFile,copyFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
const installation=resolve('.local/ocr'),destination=resolve('app/vendor/ocr');
const hashes={eng:'7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2',fra:'ced037562e8c80c13122dece28dd477d399af80911a28791a66a63ac1e3445ca'};
const files=[
  ['node_modules/tesseract.js/dist/tesseract.esm.min.js','tesseract.esm.min.js'],
  ['node_modules/tesseract.js/dist/worker.min.js','worker.min.js'],
  ['node_modules/tesseract.js/LICENSE.md','LICENSE-tesseract.txt'],
  ['node_modules/tesseract.js/dist/tesseract.min.js.LICENSE.txt','LICENSE-bundle.txt'],
  ['node_modules/tesseract.js/dist/worker.min.js.LICENSE.txt','LICENSE-worker.txt'],
  ['node_modules/tesseract.js-core/LICENSE','LICENSE-core.txt'],
  ['node_modules/regenerator-runtime/LICENSE','LICENSE-regenerator.txt'],
  ...['','-simd','-relaxedsimd'].map(variant=>['node_modules/tesseract.js-core/tesseract-core'+variant+'-lstm.wasm.js','core/tesseract-core'+variant+'-lstm.wasm.js']),
  ...Object.keys(hashes).map(lang=>['tessdata/'+lang+'.traineddata','tessdata/'+lang+'.traineddata'])
];
for(const name of ['tesseract.js','tesseract.js-core'])if(JSON.parse(await readFile(resolve(installation,'node_modules',name,'package.json'),'utf8')).version!=='7.0.0')throw Error('Version OCR inattendue : '+name);
const manifest={version:'7.0.0',description:'OCR embarqué, LSTM uniquement, français et anglais, variantes WASM intégrées non-SIMD/SIMD/relaxed-SIMD.',sources:['https://github.com/naptha/tesseract.js','https://github.com/naptha/tesseract.js-core','https://github.com/tesseract-ocr/tessdata_fast'],files:[]};
for(const [source,target]of files){
  const from=resolve(installation,source),to=resolve(destination,target),bytes=await readFile(from),sha256=createHash('sha256').update(bytes).digest('hex');
  const lang=Object.keys(hashes).find(lang=>source==='tessdata/'+lang+'.traineddata');if(lang&&sha256!==hashes[lang])throw Error('Langue OCR différente de la version vérifiée : '+lang);
  await mkdir(resolve(to,'..'),{recursive:true});await copyFile(from,to);manifest.files.push({path:target,bytes:bytes.length,sha256});
}
await writeFile(resolve(destination,'version.json'),JSON.stringify(manifest,null,2)+'\n');
console.log('OCR embarqué : '+(manifest.files.reduce((n,f)=>n+f.bytes,0)/1e6).toFixed(2)+' Mo, toutes les ressources sont locales.');
