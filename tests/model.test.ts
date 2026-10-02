import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { Chapter, Corpus } from '../src/types';
import { advance, buildCircuit, displayHebrew, initialProgress, makeBackup, parseBackup, retreat, setEndpoint, validateProgress } from '../src/model';
const corpus = JSON.parse(readFileSync('public/corpus/index.json', 'utf8')) as Corpus;
const chapter = (id: string) => (JSON.parse(readFileSync(`public/corpus/${id.split('.')[0]}.json`, 'utf8')) as Chapter[]).find(c => c.id === id)!;

describe('complete fixed corpus and review circuit', () => {
  it('visits every chapter once in the specified balanced order', () => {
    const circuit = buildCircuit(corpus);
    expect(circuit.slice(0,9)).toEqual(['GEN.1','GEN.2','GEN.3','MAT.1','GEN.4','GEN.5','GEN.6','GEN.7','MAT.2']);
    expect(circuit).toHaveLength(1189);
    expect(new Set(circuit).size).toBe(1189);
    const ot = new Set(corpus.books.filter(b => b.testament === 'OT').map(b => b.id));
    expect(circuit.filter(c => ot.has(c.split('.')[0]))).toHaveLength(929);
    const groupLengths: number[] = []; let length = 0;
    for (const id of circuit) { if (ot.has(id.split('.')[0])) length++; else { groupLengths.push(length); length = 0; } }
    expect(groupLengths.filter(n => n === 3)).toHaveLength(111);
    expect(groupLengths.filter(n => n === 4)).toHaveLength(149);
    expect(circuit.at(-1)).toBe('REV.22');
  });
  it('retains source chapter numbering, Unicode, punctuation, qere and ketiv', () => {
    expect(corpus.books.find(b => b.id === 'JOL')?.chapters).toBe(4);
    expect(corpus.books.find(b => b.id === 'MAL')?.chapters).toBe(3);
    const gen = chapter('GEN.1');
    expect(gen.tokens.slice(0,3).map(t => displayHebrew(t.text, false))).toEqual(['בְּרֵאשִׁית','בָּרָא','אֱלֹהִים']);
    expect(gen.tokens[6].text.endsWith('׃')).toBe(true);
    expect(chapter('GEN.30').variants.find(v => v.verse === 11)?.read).toHaveLength(2);
    expect(chapter('GEN.30').variants.find(v => v.verse === 11)?.written).toEqual(['בגד']);
    expect(chapter('2SA.13').variants.some(v => v.read.length === 0 && v.written.length > 0)).toBe(true);
    expect(chapter('JDG.20').variants.some(v => v.written.length === 0 && v.read.length > 0)).toBe(true);
    expect(chapter('MAT.1').tokens[0].text).toBe('Βίβλος');
    expect(chapter('MAT.1').tokens.some(t => t.suffix)).toBe(true);
    expect(chapter('PSA.119').verses).toHaveLength(176);
    expect(displayHebrew('בְּרֵאשִׁ֖ית הָאָֽרֶץ׃', true)).toBe('בְּרֵאשִׁ֖ית הָאָֽרֶץ׃');
    expect(displayHebrew('בְּרֵאשִׁ֖ית הָאָֽרֶץ׃', false)).toBe('בְּרֵאשִׁית הָאָֽרֶץ׃');
  });
  it('validates all bundled chapter and token identities', () => {
    let total = 0;
    for (const book of corpus.books) {
      const chapters = JSON.parse(readFileSync(`public/corpus/${book.id}.json`, 'utf8')) as Chapter[];
      expect(chapters.length).toBe(book.chapters);
      for (const ch of chapters) {
        const meta = corpus.chapters.find(c => c.id === ch.id)!;
        expect(ch.tokens.length).toBe(meta.wordCount);
        expect(ch.tokens.map(t => `${t.verse}:${t.sourceIndex}`)).toEqual(meta.tokenKeys);
        expect(new Set(meta.tokenKeys).size).toBe(meta.wordCount);
        expect(ch.tokens.every(t => /\p{L}/u.test(t.text))).toBe(true);
        total += ch.tokens.length;
      }
    }
    expect(total).toBe(corpus.statistics.hebrewReadWords + corpus.statistics.greekWords);
  });
});
describe('progress behavior', () => {
  it('grows manually, clamps to chapter bounds and does not change other targets', () => {
    const initial = initialProgress(corpus); const first = corpus.chapters[0];
    const changed = setEndpoint(initial, first, 6);
    expect(changed.chapters[first.id].wordCount).toBe(6);
    expect(initial.chapters[first.id].wordCount).toBe(3);
    expect(changed.chapters['MAT.1'].wordCount).toBe(3);
    expect(setEndpoint(changed, first, 99999).chapters[first.id].wordCount).toBe(first.wordCount);
    expect(setEndpoint(changed, first, -5).chapters[first.id].wordCount).toBe(1);
  });
  it('wraps the circuit and records visits without growing passages', () => {
    const p = initialProgress(corpus); p.circuit.position = 1188;
    const next = advance(p, 'REV.22', true, '2026-09-25T00:00:00Z');
    expect(next.circuit).toEqual({ position: 0, round: 2 });
    expect(next.chapters['REV.22']).toMatchObject({ visits: 1, wordCount: 3, lastVisited: '2026-09-25T00:00:00Z' });
    expect(retreat(next).circuit).toEqual({ position: 1188, round: 1 });
    expect(retreat(initialProgress(corpus)).circuit).toEqual({ position: 0, round: 1 });
  });
  it('keeps free-practice visits independent of the circuit', () => {
    const p = initialProgress(corpus); p.circuit.position = 39;
    const next = advance(p, 'JHN.3', false);
    expect(next.circuit).toEqual(p.circuit);
    expect(next.chapters['JHN.3'].visits).toBe(1);
  });
});
describe('backups', () => {
  it('round trips settings, circuit, history and exact endpoints', () => {
    let p = setEndpoint(initialProgress(corpus), corpus.chapters[0], 48);
    p = advance(p, 'GEN.1', true); p.settings.cantillation = true;
    expect(parseBackup(JSON.stringify(makeBackup(p)), corpus).progress).toEqual(p);
  });
  it.each(['corpus', 'endpoint', 'missing', 'bounds', 'settings', 'history'])('rejects invalid %s data without modifying the current state', kind => {
    const p = initialProgress(corpus); const bad = structuredClone(p);
    if (kind === 'corpus') bad.contentHash = 'changed';
    if (kind === 'endpoint') bad.chapters['GEN.1'].endpoint = 'GEN.1:1:99999';
    if (kind === 'missing') delete bad.chapters['GEN.1'];
    if (kind === 'bounds') bad.circuit.position = 1189;
    if (kind === 'settings') bad.settings.increment = 0;
    if (kind === 'history') bad.chapters['GEN.1'].visits = -1;
    expect(() => validateProgress(bad, corpus)).toThrow();
    expect(p).toEqual(initialProgress(corpus));
  });
  it('rejects malformed JSON and unknown backup envelopes', () => {
    expect(() => parseBackup('{', corpus)).toThrow('valid JSON');
    expect(() => parseBackup('{}', corpus)).toThrow('supported');
  });
});
