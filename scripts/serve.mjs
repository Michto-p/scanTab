import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, relative, extname, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };

// Serveur de développement local ; les photos restent dans le navigateur.
export function createServer() {
  return http.createServer(async (req, res) => {
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405).end(); return; }
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (pathname === '/') { res.writeHead(302, { Location: '/app/' }).end(); return; }
      const file = resolve(root, '.' + pathname + (pathname.endsWith('/') ? 'index.html' : ''));
      const rel = relative(root, file);
      if (rel.startsWith('..' + sep) || rel === '..' || rel.split(sep).some(part => part.startsWith('.')) || !['app', 'tests', 'models', 'shared'].includes(rel.split(sep)[0])) {
        res.writeHead(403).end('Accès refusé'); return;
      }
      if (!(await stat(file)).isFile()) { res.writeHead(404).end(); return; }
      const data = await readFile(file);
      res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch { res.writeHead(404).end('Fichier introuvable'); }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 8080);
  const server = createServer();
  server.on('error', error => { console.error('Serveur indisponible :', error.message); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log(`Scan Tableau : http://localhost:${port}/app/`));
}
