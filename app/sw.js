const CACHE = 'scan-tableau-v10';
const ASSETS = [
  './', './index.html', './app.js', './manifest.webmanifest', './interface/style.css', './icons/tableau.svg', './icons/tableau-192.png', './icons/tableau-512.png', './interface/workspace.js', './interface/pc-panel.js', './connexion/client.js', './interface/labels.js', './capture/photo.js',
  './pretraitement/geometry.js', './pretraitement/image.js', './pretraitement/calcul.js', './pretraitement/calcul-worker.js', './pretraitement/pixels.js', './pretraitement/cadrage.js', './segmentation/rows.js', './segmentation/automatic.js', './segmentation/detourage.js',
  './identification/markings.js', './identification/results.js', './identification/local.js', './identification/formats.js', './identification/catalogue.js', './base/store.js', './exports/zip.js',
  './vendor/ocr/tesseract.esm.min.js', './vendor/ocr/worker.min.js', './vendor/ocr/core/tesseract-core-lstm.wasm.js', './vendor/ocr/core/tesseract-core-simd-lstm.wasm.js', './vendor/ocr/core/tesseract-core-relaxedsimd-lstm.wasm.js', './vendor/ocr/tessdata/eng.traineddata', './vendor/ocr/tessdata/fra.traineddata', './vendor/ocr/version.json'
];
// Une nouvelle version recharge ses fichiers pour éviter un mélange de versions
// venant du cache HTTP. Les utilisations suivantes restent servies hors ligne.
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS.map(path=>new Request(path,{cache:'reload'}))))));
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
