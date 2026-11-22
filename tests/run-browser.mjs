import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from '../scripts/serve.mjs';

// Contrôle Chrome via son protocole natif, sans bibliothèque de test ajoutée.
const profile = resolve('.local/browser-' + Date.now());
await mkdir(profile, { recursive: true });
const server = createServer();
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://localhost:${server.address().port}`;
const chrome = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const processChrome = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
let socket;
const sleep = ms => new Promise(done => setTimeout(done, ms));
const deadline = Date.now() + 45000;
async function until(fn) { while (Date.now() < deadline) { const result = await fn(); if (result) return result; await sleep(150); } throw Error('Délai de recette navigateur dépassé'); }
let processError;
processChrome.on('error', error => { processError = error; });
try {
  const port = await until(async () => { if (processError) throw processError; try { return (await readFile(resolve(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; } catch { return null; } });
  const pages = await (await fetch(`http://localhost:${port}/json/list`)).json();
  const page = pages.find(page => page.type === 'page');
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((done, fail) => { socket.addEventListener('open', done, {once:true}); socket.addEventListener('error', fail, {once:true}); });
  let id = 0;
  const pending = new Map();
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    const request = pending.get(message.id);
    if (!request) return;
    clearTimeout(request.timer);
    pending.delete(message.id);
    message.error ? request.reject(Error(JSON.stringify(message.error))) : request.resolve(message.result);
  });
  const call = (method, params = {}) => new Promise((resolve, reject) => { const key = ++id; const timer = setTimeout(() => { pending.delete(key); reject(Error('Délai CDP : ' + method)); }, 8000); pending.set(key, {resolve,reject,timer}); socket.send(JSON.stringify({id:key,method,params})); });
  const evaluate = async expression => { const data = await call('Runtime.evaluate', {expression,returnByValue:true,awaitPromise:true}); if (data.exceptionDetails) throw Error(data.exceptionDetails.text + ': ' + data.exceptionDetails.exception?.description); return data.result.value; };
  await call('Page.enable'); await call('Runtime.enable'); await call('Network.enable');
  if (process.argv.includes('--shell')) {
    await call('Page.navigate', { url: origin + '/app/' });
    await until(() => evaluate('document.querySelector("#offline-status")?.textContent === "Disponible hors ligne"'));
  } else {
    await call('Page.navigate', { url: origin + '/tests/browser.html' });
    const result = await until(async () => { const state = await evaluate('window.__qa || null'); return state && state.status !== 'pending' ? state : null; });
    console.log(JSON.stringify(result, null, 2));
    if (result.status !== 'pass') throw Error('Échec des tests navigateur');
    await call('Page.navigate', { url: origin + '/app/' });
    await until(() => evaluate('window.__scanTableauReady === true && document.querySelector("#offline-status")?.textContent === "Disponible hors ligne"'));
  }
  await until(() => evaluate('!!navigator.serviceWorker.controller'));
  await call('Network.emulateNetworkConditions', {offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
  await call('Page.reload', {ignoreCache:true});
  await until(() => evaluate(process.argv.includes('--shell') ? '!!document.querySelector("#workspace") && document.querySelector("#offline-status")?.textContent === "Disponible hors ligne"' : 'window.__scanTableauReady === true && !!document.querySelector("#workspace canvas")'));
  console.log('PASS : rechargement complet hors ligne, interface et modules disponibles.');
  await call('Emulation.setDeviceMetricsOverride', { width:390, height:844, deviceScaleFactor:1, mobile:true });
  const overflow = await evaluate('document.documentElement.scrollWidth > innerWidth');
  if (overflow) throw Error('Débordement horizontal à 390 px');
  const shot = await call('Page.captureScreenshot', {format:'png',captureBeyondViewport:true});
  await writeFile(resolve('.local/recette-mobile.png'), Buffer.from(shot.data,'base64'));
  console.log('PASS : largeur mobile 390 px ; capture .local/recette-mobile.png');
} finally {
  socket?.close();
  processChrome.kill();
  server.closeAllConnections();
  server.close();
}
