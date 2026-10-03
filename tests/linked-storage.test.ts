import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { Corpus } from '../src/types';
import type { LinkedState } from '../src/linked-types';
import { addLink, addPassage, addWords, completePassage, holdPassage, initialLinkedState, nextEventId, planAddition, spanFromVerses, undoLastAddition } from '../src/linked-model';
import { makeLinkedBackup, parseLinkedBackup, validateLinkedState } from '../src/linked-validate';
import { LINKED_DATABASE, importLinkedBackup, loadLinkedState, updateLinkedState } from '../src/linked-storage';

const corpus = JSON.parse(readFileSync('public/corpus/index.json', 'utf8')) as Corpus;
const day = (n: number) => new Date(Date.UTC(2026, 9, 5 + n, 17));
const fresh = () => initialLinkedState(corpus);

/** A history with two linked passages, a tail fill, an undo, a hold and a completion. */
function richState(): LinkedState {
  let s = addPassage(fresh(), corpus, { id: 'p-mat', spans: [spanFromVerses(corpus, 'MAT.13', 44, 44)], now: day(0) });
  s = addPassage(s, corpus, { id: 'p-mrk', spans: [spanFromVerses(corpus, 'MRK.7', 1, 13)], now: day(0), link: { id: 'l-1', fromId: 'p-mat', note: 'Treasure and tradition' } });
  s = addLink(s, { id: 'l-2', fromId: 'p-mrk', toId: 'p-mat', note: 'and back again', now: day(0) });
  for (let d = 0; d < 7; d++) for (let i = 0; i < 2; i++) { const r = addWords(s, corpus, nextEventId(s), day(d)); if (r.status === 'added') s = r.state; }
  const extra = addWords(s, corpus, nextEventId(s), day(8)); if (extra.status === 'added') s = extra.state;
  s = undoLastAddition(s).state;
  s = completePassage(s, corpus, 'p-mat');
  return holdPassage(s, 'p-mrk');
}

beforeEach(async () => {
  await new Promise<void>((resolve, reject) => { const req = indexedDB.deleteDatabase(LINKED_DATABASE); req.onsuccess = () => resolve(); req.onerror = () => reject(req.error); });
});

describe('identity', () => {
  it('uses its own database and backup identity, and rejects other apps’ and circuit-era backups', () => {
    expect(LINKED_DATABASE).toBe('sola-linked');
    const backup = makeLinkedBackup(richState(), day(9));
    expect(backup).toMatchObject({ format: 'sola-linked-backup', version: 1 });
    for (const format of ['sola-backup', 'bible-memory-backup', 'heiser-memory-backup']) {
      expect(() => parseLinkedBackup(JSON.stringify({ ...backup, format }), corpus)).toThrow('not a supported Linked Memory backup');
    }
  });
});

describe('backup round trip', () => {
  it('restores every passage, link, ledger event, coverage word, cursor and setting exactly', () => {
    const state = richState();
    expect(state.passages.map(p => p.status)).toEqual(['completed', 'held']);
    expect(state.ledger.length).toBeGreaterThan(10);
    const text = JSON.stringify(makeLinkedBackup(state, day(9)));
    expect(parseLinkedBackup(text, corpus).state).toEqual(state);
    expect(parseLinkedBackup(JSON.stringify(makeLinkedBackup(fresh())), corpus).state).toEqual(fresh());
  });
  it('round trips through IndexedDB: save, reload from a new connection, export, import', async () => {
    expect(await loadLinkedState(corpus)).toBeUndefined();
    const state = richState();
    await updateLinkedState(corpus, fresh, () => state);
    expect(await loadLinkedState(corpus)).toEqual(state);
    const text = JSON.stringify(makeLinkedBackup((await loadLinkedState(corpus))!));
    await updateLinkedState(corpus, fresh, () => fresh());
    expect(await loadLinkedState(corpus)).toEqual(fresh());
    expect(await importLinkedBackup(text, corpus)).toEqual(state);
    expect(await loadLinkedState(corpus)).toEqual(state);
  });
});

describe('atomic additions in storage', () => {
  const seeded = () => addPassage(fresh(), corpus, { id: 'p-mat', spans: [spanFromVerses(corpus, 'MAT.13', 44, 44)], now: day(0) });
  const addOnce = (eventId: string) => updateLinkedState(corpus, fresh, s => { const r = addWords(s, corpus, eventId, day(0)); return r.state; });

  it('counts a double-click or two racing tabs once', async () => {
    await updateLinkedState(corpus, fresh, seeded);
    const eventId = planAddition((await loadLinkedState(corpus))!, corpus, day(0)).eventId;
    await Promise.all([addOnce(eventId), addOnce(eventId), addOnce(eventId)]);
    const saved = (await loadLinkedState(corpus))!;
    expect(saved.ledger).toHaveLength(1);
    expect(saved.coverage).toHaveLength(5);
  });
  it('writes nothing when the change throws or produces invalid state', async () => {
    await updateLinkedState(corpus, fresh, seeded);
    const before = await loadLinkedState(corpus);
    await expect(updateLinkedState(corpus, fresh, () => { throw new Error('nope'); })).rejects.toThrow('nope');
    await expect(updateLinkedState(corpus, fresh, s => ({ ...s, coverage: ['MAT.13:44:0'] }))).rejects.toThrow('coverage');
    expect(await loadLinkedState(corpus)).toEqual(before);
  });
});

describe('rejected corrupt imports', () => {
  const corruptions: [string, (b: any) => void][] = [
    ['corpus hash', b => { b.state.contentHash = 'changed'; }],
    ['corpus id', b => { b.state.corpusId = 'other'; }],
    ['span token', b => { b.state.passages[0].spans[0].to = 'MAT.13:44:999'; }],
    ['span order', b => { const sp = b.state.passages[0].spans[0]; [sp.from, sp.to] = [sp.to, sp.from]; }],
    ['span overlap', b => { b.state.passages[1].spans.push(b.state.passages[1].spans[0]); }],
    ['language', b => { b.state.passages[0].language = 'he'; }],
    ['status', b => { b.state.passages[0].status = 'archived'; }],
    ['repeated passage id', b => { b.state.passages[1].id = b.state.passages[0].id; }],
    ['empty link note', b => { b.state.links[0].note = '  '; }],
    ['link to missing passage', b => { b.state.links[0].toId = 'ghost'; }],
    ['self link', b => { b.state.links[1].toId = b.state.links[1].fromId; }],
    ['unlinked passage', b => { b.state.links = []; }],
    ['coverage word not in ledger', b => { b.state.coverage.push('MRK.7:1:0'); b.state.coverage.sort(); }],
    ['coverage missing a ledger word', b => { b.state.coverage.pop(); }],
    ['duplicated coverage word', b => { b.state.coverage[b.state.coverage.length - 1] = b.state.coverage[0]; }],
    ['ledger word outside its passage', b => { b.state.ledger[0].segments[0].tokenIds[0] = 'MRK.7:1:0'; }],
    ['ledger word introduced twice', b => { b.state.ledger[1].segments[0].tokenIds[0] = b.state.ledger[0].segments[0].tokenIds[0]; }],
    ['ledger date', b => { b.state.ledger[0].date = '2001-01-01'; }],
    ['ledger time zone', b => { b.state.ledger[0].timeZone = 'Mars/Olympus'; }],
    ['ledger event id order', b => { b.state.ledger[1].id = b.state.ledger[0].id; }],
    ['event counter', b => { b.state.eventSeq = 1; }],
    ['cursor', b => { b.state.cursor.lastServedId = 'ghost'; }],
    ['cursor chain', b => { b.state.ledger[1].cursorBefore = null; }],
    ['settings cap', b => { b.state.settings.dailyCap = 251; }],
    ['settings time zone', b => { b.state.settings.timeZone = 'nowhere'; }],
    ['completed but not fully introduced', b => { b.state.passages[1].status = 'completed'; }],
  ];

  it.each(corruptions)('rejects %s without changing existing data', async (_name, corrupt) => {
    const good = richState();
    await updateLinkedState(corpus, fresh, () => good);
    const backup = JSON.parse(JSON.stringify(makeLinkedBackup(good)));
    corrupt(backup);
    expect(() => parseLinkedBackup(JSON.stringify(backup), corpus)).toThrow('Nothing has been replaced');
    await expect(importLinkedBackup(JSON.stringify(backup), corpus)).rejects.toThrow('Nothing has been replaced');
    expect(await loadLinkedState(corpus)).toEqual(good);
  });

  it('rejects malformed JSON, non-objects and oversized files without changing existing data', async () => {
    const good = richState();
    await updateLinkedState(corpus, fresh, () => good);
    for (const text of ['{', '[]', 'null', '{}', '"x"', ' '.repeat(26_000_000)]) await expect(importLinkedBackup(text, corpus)).rejects.toThrow();
    expect(await loadLinkedState(corpus)).toEqual(good);
  });

  it('refuses to load corrupt stored data and leaves it untouched', async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open(LINKED_DATABASE, 1); r.onupgradeneeded = () => r.result.createObjectStore('state'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    await new Promise<void>(resolve => { const tx = db.transaction('state', 'readwrite'); tx.objectStore('state').put({ corrupt: true }, 'linked-state'); tx.oncomplete = () => resolve(); });
    db.close();
    await expect(loadLinkedState(corpus)).rejects.toThrow();
    await expect(updateLinkedState(corpus, fresh, s => s)).rejects.toThrow();
    await expect(loadLinkedState(corpus)).rejects.toThrow();
  });

  it('still accepts the uncorrupted state', () => {
    expect(() => validateLinkedState(richState(), corpus)).not.toThrow();
  });
});
