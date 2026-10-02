import 'fake-indexeddb/auto';
import { beforeEach, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { Corpus } from '../src/types';
import { initialProgress, setEndpoint } from '../src/model';
import { restartStoredProgress, LEGACY_RESTART_KEY } from '../src/restart-progress';
import { DATABASE, loadProgress, saveProgress, openDatabase } from '../src/storage';
const corpus = JSON.parse(readFileSync('public/corpus/index.json', 'utf8')) as Corpus;
beforeEach(async () => { await new Promise<void>((resolve, reject) => { const req = indexedDB.deleteDatabase(DATABASE); req.onsuccess = () => resolve(); req.onerror = () => reject(req.error); }); });

it('restarts the actual saved cursor while preserving targets, settings, visits and circuit count', async () => {
  const p = setEndpoint(initialProgress(corpus), corpus.chapters[0], 18);
  p.circuit = { position: 5, round: 2 }; p.chapters['GEN.1'].visits = 7; p.settings.increment = 5;
  await saveProgress(p);
  const result = await restartStoredProgress(corpus);
  expect(result.circuit).toEqual({ position: 0, round: 2 });
  expect(result.chapters).toEqual(p.chapters); expect(result.settings).toEqual(p.settings);
  expect(await loadProgress()).toEqual(result);
});

it('works even if the old one-time reset was already marked handled', async () => {
  const p = initialProgress(corpus); p.circuit.position = 5; await saveProgress(p);
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('state', 'readwrite'); tx.objectStore('state').put({ appliedAt: '2026-09-26T23:00:00Z' }, LEGACY_RESTART_KEY);
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
  }); db.close();
  expect((await restartStoredProgress(corpus)).circuit.position).toBe(0);
});

it('does not invent or overwrite progress in the wrong or incompatible browser', async () => {
  await expect(restartStoredProgress(corpus)).rejects.toThrow('No saved progress');
  expect(await loadProgress()).toBeUndefined();
  const p = initialProgress(corpus); p.corpusId = 'different-edition'; p.circuit.position = 5;
  await saveProgress(p);
  await expect(restartStoredProgress(corpus)).rejects.toThrow('different corpus');
  expect(await loadProgress()).toEqual(p);
});
