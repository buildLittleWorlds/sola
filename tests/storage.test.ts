import 'fake-indexeddb/auto';
import { beforeEach, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { DATABASE, loadProgress, openDatabase, saveProgress } from '../src/storage';
import { initialProgress, setEndpoint } from '../src/model';
import type { Corpus } from '../src/types';
const corpus = JSON.parse(readFileSync('public/corpus/index.json', 'utf8')) as Corpus;
beforeEach(async () => {
  await new Promise<void>((resolve, reject) => { const req = indexedDB.deleteDatabase(DATABASE); req.onsuccess = () => resolve(); req.onerror = () => reject(req.error); });
});
it('saves atomically and reads the exact state from a new database connection', async () => {
  expect(await loadProgress()).toBeUndefined();
  const p = setEndpoint(initialProgress(corpus), corpus.chapters[0], 19);
  await saveProgress(p);
  expect(await loadProgress()).toEqual(p);
});
it('leaves previous progress intact when a write transaction aborts', async () => {
  const p = initialProgress(corpus); await saveProgress(p);
  const db = await openDatabase();
  const tx = db.transaction('state', 'readwrite');
  tx.objectStore('state').put({ corrupt: true }, 'progress');
  await new Promise<void>(resolve => { tx.onabort = () => resolve(); tx.abort(); });
  db.close();
  expect(await loadProgress()).toEqual(p);
});
