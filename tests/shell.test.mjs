import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import {createHash} from 'node:crypto';
import { createServer } from '../scripts/serve.mjs';

test('Le service worker embarque réellement toutes les ressources du socle', async () => {
  const sw = await readFile(new URL('../app/sw.js', import.meta.url), 'utf8');
  const assets = [...sw.match(/const ASSETS = \[([^\]]+)\]/)[1].matchAll(/'([^']+)'/g)].map(match => match[1]);
  for (const path of assets) await access(new URL('../app/' + (path === './' ? 'index.html' : path), import.meta.url));
  const manifest = JSON.parse(await readFile(new URL('../app/manifest.webmanifest', import.meta.url), 'utf8'));
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.scope, './');
  assert.equal(manifest.start_url, './');
});

test('Les ressources OCR publiées correspondent aux empreintes et restent sous 30 Mo',async()=>{
  const manifest=JSON.parse(await readFile(new URL('../app/vendor/ocr/version.json',import.meta.url),'utf8'));
  let total=0;
  for(const file of manifest.files){const bytes=await readFile(new URL('../app/vendor/ocr/'+file.path,import.meta.url));assert.equal(bytes.length,file.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),file.sha256);total+=bytes.length;}
  assert.ok(total<30000000);assert.equal(manifest.version,'7.0.0');
  const wrapper=await readFile(new URL('../app/identification/local.js',import.meta.url),'utf8');
  for(const option of ['workerPath:','corePath:','langPath:','workerBlobURL:false',"cacheMethod:'none'",'gzip:false'])assert.ok(wrapper.includes(option),option);
});

test('Le serveur sert les modules sans exposer Git ni recevoir de photos', async t => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const origin = 'http://127.0.0.1:' + server.address().port;
  assert.equal((await fetch(origin + '/app/')).status, 200);
  assert.match((await fetch(origin + '/app/app.js')).headers.get('content-type'), /javascript/);
  assert.equal((await fetch(origin + '/.git/config')).status, 403);
  assert.equal((await fetch(origin + '/app/', {method:'POST', body:'photo'})).status, 405);
});
