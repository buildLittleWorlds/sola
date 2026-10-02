// Copy only the verified production bundle into the separate hosting checkout.
// Personal progress, backups, the ESV notebook, and source credentials are not inputs.
import { cp, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const from = new URL('../dist/', import.meta.url);
const site = new URL('../bible-memory-originals/', import.meta.url);
const hosting = JSON.parse(await readFile(new URL('.openai/hosting.json', site), 'utf8'));
if (hosting.static?.directory !== 'dist') throw new Error('Unexpected phone hosting configuration.');
await readFile(new URL('index.html', from));
await readFile(new URL('sw.js', from));
// Only this generated deployment copy is replaced; never touch hosting identity or Git.
await rm(new URL('dist/', site), { recursive: true, force: true });
await cp(from, new URL('dist/', site), { recursive: true });
async function inventory(base, prefix = '') {
  const list = [];
  for (const entry of await readdir(new URL(prefix, base), { withFileTypes: true })) {
    const path = prefix + entry.name;
    if (entry.isDirectory()) list.push(...await inventory(base, path + '/'));
    else list.push({ path, sha256: createHash('sha256').update(await readFile(new URL(path, base))).digest('hex') });
  }
  return list.sort((a, b) => a.path.localeCompare(b.path));
}
const original = await inventory(from);
const copied = await inventory(new URL('dist/', site));
if (JSON.stringify(original) !== JSON.stringify(copied)) throw new Error('Deployment copy differs from the tested local build.');
await writeFile(new URL('bundle-sha256.json', site), JSON.stringify(original, null, 2) + '\n');
console.log(`Phone deployment copy verified: ${copied.length} identical files.`);
