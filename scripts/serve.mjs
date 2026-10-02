import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
const root = fileURLToPath(new URL('../dist/', import.meta.url));
try { await stat(resolve(root, 'index.html')); } catch { console.error('Build the app first: npm run build'); process.exit(1); }
const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png', '.ttf':'font/ttf', '.txt':'text/plain; charset=utf-8', '.webmanifest':'application/manifest+json' };
createServer(async (req, res) => {
  try {
    if (!['GET','HEAD'].includes(req.method)) { res.writeHead(405).end(); return; }
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const path = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!path.startsWith(root.endsWith(sep) ? root : root + sep)) { res.writeHead(403).end(); return; }
    const bytes = await readFile(path);
    res.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream', 'Cache-Control':'no-cache', 'X-Content-Type-Options':'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : bytes);
  } catch { res.writeHead(404, { 'Content-Type':'text/plain' }).end('Not found'); }
}).on('error', error => { console.error(error.code === 'EADDRINUSE' ? 'Port 4173 is already in use. If Bible Memory is already running, open http://127.0.0.1:4173. The fixed port keeps your progress in one place.' : error); process.exit(1); }).listen(4173, '127.0.0.1', () => {
  console.log('Bible Memory is ready at http://127.0.0.1:4173 · Ctrl+C to stop.');
  if (process.argv.includes('--open') && process.platform === 'darwin') execFile('open', ['http://127.0.0.1:4173']);
});
