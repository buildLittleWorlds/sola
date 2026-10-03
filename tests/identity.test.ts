import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { DATABASE } from '../src/storage';
import { LINKED_DATABASE } from '../src/linked-storage';
import { BACKUP_FORMAT } from '../src/linked-validate';
import { initialProgress, makeBackup, parseBackup } from '../src/model';
import type { Corpus } from '../src/types';
const corpus = JSON.parse(readFileSync('public/corpus/index.json', 'utf8')) as Corpus;

it('uses this app’s own database name and backup identity', () => {
  expect(DATABASE).toBe('sola');
  expect(makeBackup(initialProgress(corpus)).format).toBe('sola-backup');
});

it('rejects backups from Bible Memory and Heiser Memory without reading their progress', () => {
  const progress = initialProgress(corpus);
  for (const format of ['bible-memory-backup', 'heiser-memory-backup']) {
    expect(() => parseBackup(JSON.stringify({ format, exportedAt: '2026-09-25T13:00:00Z', progress }), corpus)).toThrow('not a supported Sola backup');
  }
});

it('names the manifest and caches for Sola only, and the worker deletes only sola- caches', () => {
  const manifest = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8'));
  expect([manifest.name, manifest.short_name]).toEqual(['Sola — Hebrew & Greek', 'Sola']);
  expect(manifest.id).toBe('/sola/');
  const worker = readFileSync('scripts/build-sw.mjs', 'utf8');
  expect(worker).toContain("const cache = `sola-${");
  expect(worker).toContain("key.startsWith('sola-') && key !== CACHE");
  expect(worker).not.toMatch(/bible-memory|heiser/i);
});

it('gives the linked model its own database and backup format, distinct from the circuit-era ones and from other apps', () => {
  expect(LINKED_DATABASE).toBe('sola-linked');
  expect(LINKED_DATABASE).not.toBe(DATABASE);
  expect(BACKUP_FORMAT).toBe('sola-linked-backup');
  expect(`${LINKED_DATABASE} ${BACKUP_FORMAT}`).not.toMatch(/bible-memory|heiser/i);
});
