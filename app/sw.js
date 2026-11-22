const CACHE = 'scan-tableau-v3';
const ASSETS = ['./', './index.html', './app.js', './manifest.webmanifest', './interface/style.css', './icons/tableau.svg', './icons/tableau-192.png', './icons/tableau-512.png', './interface/workspace.js', './interface/labels.js', './capture/photo.js', './pretraitement/geometry.js', './pretraitement/image.js', './segmentation/rows.js', './base/store.js', './exports/zip.js'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS))));
self.addEventListener('activate', event => event.waitUntil((async () => {
  for (const key of await caches.keys()) if (key.startsWith('scan-tableau-') && key !== CACHE) await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(event.request);
    if (cached) return cached;
    try { return await fetch(event.request); }
    catch { return event.request.mode === 'navigate' ? (await cache.match('./index.html')) : Response.error(); }
  })());
});
