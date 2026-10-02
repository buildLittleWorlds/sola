import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
async function walk(dir) { const entries = await readdir(dir, { withFileTypes: true }); return (await Promise.all(entries.map(e => e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]))).flat(); }
const base = process.env.BASE_PATH ?? '/sola/';
if (!base.startsWith('/') || !base.endsWith('/')) throw new Error('BASE_PATH must start and end with a slash.');
const files = (await walk('dist')).filter(f => !f.endsWith('/sw.js')).sort();
const digest = createHash('sha256');
for (const f of files) digest.update(await readFile(f));
const cache = `sola-${digest.digest('hex').slice(0,16)}`;
const priority = path => path.startsWith(base + 'aids/') ? 2 : path.startsWith(base + 'corpus/') ? 1 : 0;
const paths = [base, ...files.map(f => base + f.slice(5)).sort((a, b) => priority(a) - priority(b) || a.localeCompare(b))];
const aidManifest = JSON.parse(await readFile('dist/aids/manifest.json', 'utf8'));
if (aidManifest.assets.length !== 66) throw new Error('The offline build must include all 66 reading-aid books.');
const sourceVersion = /AIDS_RELEASE\s*=\s*['"]([^'"]+)['"]/.exec(await readFile('src/aids.ts', 'utf8'))?.[1];
if (sourceVersion !== aidManifest.version) throw new Error('The app and bundled reading aids have different versions. Rebuild from matching source/data before publishing.');
await writeFile('dist/sw.js', `// Generated from this build only. No external fetches or automatic corpus migration.
const CACHE = ${JSON.stringify(cache)};
const FILES = ${JSON.stringify(paths)};
const BASE = ${JSON.stringify(base)};
const AID_VERSION = ${JSON.stringify(aidManifest.version)};
const AID_HASH = ${JSON.stringify(aidManifest.aidHash)};
const bounded = (promise, ms) => {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Cache operation timed out')), ms); })]).finally(() => clearTimeout(timer));
};
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    try {
      const cache = await bounded(caches.open(CACHE), 5000);
      // Cache the scripture before the larger aid books; leave room for active review requests.
      for (let i = 0; i < FILES.length; i += 2) {
        const controller = new AbortController();
        try { await bounded(cache.addAll(FILES.slice(i, i + 2).map(path => new Request(path, { signal: controller.signal }))), 45000); }
        catch (error) { controller.abort(); throw error; }
      }
    } catch (error) {
      await bounded(caches.delete(CACHE), 5000).catch(() => {});
      for (const client of await self.clients.matchAll({ includeUncontrolled: true })) client.postMessage({ type: 'OFFLINE_ERROR' });
      throw error;
    }
  })());
});
self.addEventListener('activate', event => event.waitUntil((async () => {
  for (const key of await caches.keys()) if (key.startsWith('sola-') && key !== CACHE) await caches.delete(key);
  await self.clients.claim();
  for (const client of await self.clients.matchAll()) client.postMessage({ type: 'OFFLINE_READY', aidVersion: AID_VERSION, aidHash: AID_HASH });
})()));
self.addEventListener('message', event => {
  if (event.data?.type !== 'OFFLINE_STATUS') return;
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const manifest = await cache.match(BASE + 'aids/manifest.json');
    const keys = await cache.keys();
    if (manifest && keys.length >= FILES.length) event.source?.postMessage({ type: 'OFFLINE_READY', aidVersion: AID_VERSION, aidHash: AID_HASH });
  })());
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  const url = new URL(event.request.url);
  const fresh = url.searchParams.has('bm-retry');
  event.respondWith((async () => {
    if (!fresh) {
      try {
        const cached = await bounded(caches.open(CACHE).then(cache => cache.match(event.request)), 2000);
        if (cached) return cached;
      } catch { /* A stalled cache must not prevent an online book from opening. */ }
    }
    const response = await fetch(event.request, fresh ? { cache: 'reload' } : undefined);
    // A successful recovery also restores the canonical offline asset. Never cache a sign-in page as JSON.
    if (response.ok && !response.redirected && FILES.includes(url.pathname) && (!url.pathname.endsWith('.json') || response.headers.get('content-type')?.includes('json'))) {
      const copy = response.clone();
      event.waitUntil(bounded(caches.open(CACHE).then(cache => cache.put(url.pathname, copy)), 15000).catch(() => {}));
    }
    return response;
  })());
});
`);
console.log(`Offline bundle prepared: ${paths.length} files, cache ${cache}.`);
