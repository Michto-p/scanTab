import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
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
