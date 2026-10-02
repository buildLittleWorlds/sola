import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Chapter, Corpus } from '../src/types';
import { advance, initialProgress, makeBackup, parseBackup, setEndpoint, validateProgress } from '../src/model';

// This fingerprint predates reading aids. An aid release must never retokenize the
// scripture or invalidate a user's endpoint or transferred backup.
const originalFingerprint = 'c81a17500cfab313737bc0ffe3c4338f03cd947a9c2961fe33927ab944d43f37';
const corpus = JSON.parse(readFileSync('public/corpus/index.json', 'utf8')) as Corpus;
type Aid = {
  gloss: string | null;
  glossStatus: 'source-aligned' | 'reviewed' | 'unavailable';
  sources: string[];
  pronunciation: { syllables: string[]; stressed: number[]; status: string; note?: string };
  notes?: string[];
};
type AidBook = { schemaVersion: number; bookId: string; corpusHash: string; chapters: Record<string, Record<string, Aid>> };
const aids = new Map<string, AidBook>();
function aidBook(book: string) {
  if (!aids.has(book)) aids.set(book, JSON.parse(readFileSync(`public/aids/${book}.json`, 'utf8')) as AidBook);
  return aids.get(book)!;
}
function aid(chapter: string, token: string) { return aidBook(chapter.split('.')[0]).chapters[chapter][token]; }
const latin = (syllables: string[]) => syllables.map(s => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase());
const confirmed = new Set(['accent-derived', 'written-accent', 'reviewed', 'convention']);
const uncertain = new Set(['stress-unconfirmed', 'pronunciation-unconfirmed', 'unavailable']);
const statuses = new Set([...confirmed, ...uncertain, 'joined']);

describe('reading aids preserve the fixed original text', () => {
  it('keeps the original complete corpus bytes and fingerprint', () => {
    const hashes = corpus.books.map(book => createHash('sha256').update(readFileSync(`public/corpus/${book.id}.json`)).digest('hex')).join('');
    expect(createHash('sha256').update(hashes).digest('hex')).toBe(originalFingerprint);
    expect(corpus.contentHash).toBe(originalFingerprint);
  });

  it('has exactly one aid for every original token, with valid provenance and separate pronunciation status', () => {
    const problems: string[] = [];
    let chapters = 0, tokens = 0, availableGlosses = 0, availablePronunciations = 0;
    const check = (ok: boolean, message: string) => { if (!ok && problems.length < 40) problems.push(message); };
    for (const book of corpus.books) {
      const data = aidBook(book.id);
      expect(data.schemaVersion).toBe(1);
      expect(data.bookId).toBe(book.id);
      expect(data.corpusHash).toBe(originalFingerprint);
      const metas = corpus.chapters.filter(ch => ch.bookId === book.id);
      expect(Object.keys(data.chapters).sort()).toEqual(metas.map(ch => ch.id).sort());
      for (const chapter of metas) {
        chapters++;
        const entries = data.chapters[chapter.id];
        expect(Object.keys(entries).sort()).toEqual([...chapter.tokenKeys].sort());
        for (const [key, entry] of Object.entries(entries)) {
          tokens++;
          const ref = `${chapter.id}:${key}`;
          check(['source-aligned', 'reviewed', 'unavailable'].includes(entry.glossStatus), `${ref}: unknown gloss status`);
          check(Array.isArray(entry.sources) && entry.sources.every(s => typeof s === 'string' && s.length > 0), `${ref}: invalid sources`);
          if (entry.glossStatus === 'unavailable') check(entry.gloss === null, `${ref}: unavailable gloss is presented as translated`);
          else {
            availableGlosses++;
            check(typeof entry.gloss === 'string' && entry.gloss.trim().length > 0, `${ref}: missing gloss`);
            check(!/^(?:\?|—|-|null|undefined|n\/a)$/i.test(entry.gloss ?? ''), `${ref}: placeholder gloss`);
            check(entry.sources.length > 0, `${ref}: translated gloss has no source`);
          }
          const p = entry.pronunciation;
          check(statuses.has(p.status), `${ref}: unknown pronunciation status ${p.status}`);
          check(Array.isArray(p.syllables) && p.syllables.every(s => typeof s === 'string' && s.trim().length > 0), `${ref}: invalid syllables`);
          check(Array.isArray(p.stressed) && p.stressed.every(s => Number.isInteger(s) && s >= 0 && s < p.syllables.length), `${ref}: stress outside syllables`);
          check(new Set(p.stressed).size === p.stressed.length, `${ref}: repeated stress index`);
          if (confirmed.has(p.status)) {
            availablePronunciations++;
            check(p.syllables.length > 0, `${ref}: confirmed empty pronunciation`);
            if (p.status !== 'written-accent') check(p.stressed.length > 0, `${ref}: confirmed stress missing`);
          }
          if (uncertain.has(p.status) || p.status === 'joined') check(p.stressed.length === 0, `${ref}: unconfirmed or joined word has confident stress`);
          if (p.status === 'unavailable') check(p.syllables.length === 0, `${ref}: unavailable pronunciation is exposed`);
          if (uncertain.has(p.status)) check(Boolean(p.note || entry.notes?.length), `${ref}: uncertainty has no explanation`);
        }
      }
    }
    expect(problems).toEqual([]);
    expect(chapters).toBe(1189);
    expect(tokens).toBe(corpus.statistics.hebrewReadWords + corpus.statistics.greekWords);
    // Guard against an apparently complete release consisting only of empty
    // annotations; these are coverage checks, not a claim of linguistic accuracy.
    expect(availableGlosses / tokens).toBeGreaterThan(0.9);
    expect(availablePronunciations / tokens).toBeGreaterThan(0.5);
  }, 30000);
});

describe('independently specified reading examples', () => {
  it('reads Genesis 38:1 feminine qere as ha-HI while preserving its written waw (HEB-003)', () => {
    const chapters = JSON.parse(readFileSync('public/corpus/GEN.json', 'utf8')) as Chapter[];
    const token = chapters.find(c => c.id === 'GEN.38')!.tokens.find(t => t.verse === 1 && t.sourceIndex === 2)!;
    expect(token.text).toBe('הַהִ֔וא');
    const corrected = aid('GEN.38', '1:2');
    expect(corrected.pronunciation).toMatchObject({ syllables: ['ha', 'hi'], stressed: [1], status: 'reviewed' });
    expect(corrected.sources).toContain('reviewed-override');
    const published = JSON.parse(readFileSync('public/aids/corrections.json', 'utf8'));
    expect(published.corrections['hebrew/reviewed-overrides.json']['GEN.38/1:2'].issueId).toBe('HEB-003');
  });

  it('renders familiar Genesis words with the stress on the correct syllable', () => {
    const examples = [
      { key: '1:0', syllables: ['be', 're', 'shit'], stressed: [2], gloss: /beginning/i },
      { key: '1:1', syllables: ['ba', 'ra'], stressed: [1], gloss: /creat/i },
      { key: '1:2', syllables: ['e', 'lo', 'him'], stressed: [2], gloss: /god/i },
    ];
    for (const example of examples) {
      const entry = aid('GEN.1', example.key);
      expect(latin(entry.pronunciation.syllables)).toEqual(example.syllables);
      expect(entry.pronunciation.stressed).toEqual(example.stressed);
      expect(entry.gloss).toMatch(example.gloss);
    }
  });

  it('keeps the direct-object marker visible as grammar and maqaf words free of invented independent stress', () => {
    expect(aid('GEN.1', '1:3').gloss).toMatch(/object|marker/i);
    expect(aid('GEN.1', '2:5').pronunciation.status).toBe('joined');
    expect(aid('GEN.1', '2:5').pronunciation.stressed).toEqual([]);
  });

  it('marks Yahweh as an explicit reading convention', () => {
    const genesis2 = JSON.parse(readFileSync('public/corpus/GEN.json', 'utf8')) as Chapter[];
    const token = genesis2.find(ch => ch.id === 'GEN.2')!.tokens.find(t => t.text.replace(/[^א-ת]/g, '') === 'יהוה')!;
    const p = aid('GEN.2', `${token.verse}:${token.sourceIndex}`).pronunciation;
    expect(latin(p.syllables)).toEqual(['yah', 'weh']);
    expect(p.stressed).toEqual([0]);
    expect(p.status).toBe('convention');
  });

  it('does not turn disputed Aramaic readings or unsupported Hebrew accent patterns into confident pronunciation', () => {
    for (const { key, allowed } of [
      { key: '4:10', allowed: ['le', 'av', 'dakh'] },
      { key: '41:10', allowed: ['u', 'min', 'ne', 'hen'] },
    ]) {
      const p = aid('DAN.2', key).pronunciation;
      if (p.status === 'reviewed') {
        // Future independently reviewed corrections may resolve the current
        // source conflict, but must carry the review explanation with them.
        expect(p.note).toBeTruthy();
      } else {
        expect(p.status).toBe('pronunciation-unconfirmed');
        expect(p.stressed).toEqual([]);
        expect(p.note).toBeTruthy();
        // The provisional output may be the actual UXLC qere, never STEP's
        // incompatible le-av-da-yikh / u-mi-ne-hon reading.
        if (p.syllables.length) expect(latin(p.syllables)).toEqual(allowed);
      }
    }
    // The poetic prepositive accent in לָ֭מָּה is not evidence for the
    // syllabifier's default final stress; the word is LA-mah.
    const lama = aid('PSA.2', '1:0').pronunciation;
    if (confirmed.has(lama.status)) expect(lama.stressed).toEqual([0]);
    else expect(lama.stressed).toEqual([]);
    // תֹ֙הוּ֙ has repeated pashta markings; whichever confirmed rule is
    // used must retain TO-hu instead of guessing the final syllable.
    const tohu = aid('GEN.1', '2:2').pronunciation;
    if (confirmed.has(tohu.status)) expect(tohu.stressed).toEqual([0]);
    else expect(tohu.stressed).toEqual([]);
  });

  it('uses Greek syllables and accents from our actual SBL text', () => {
    const examples = [
      { chapter: 'MAT.1', key: '1:0', syllables: ['bi', 'blos'], stressed: [0] },
      { chapter: 'MAT.1', key: '1:1', syllables: ['ge', 'ne', 'se', 'os'], stressed: [1] },
      { chapter: 'MAT.1', key: '1:2', syllables: ['i', 'e', 'sou'], stressed: [2] },
      // The base text reads Μωσῆς, not the annotation source's Μωϋσῆς.
      { chapter: 'JHN.8', key: '5:4', syllables: ['mo', 'ses'], stressed: [1] },
      { chapter: 'PHM.1', key: '2:12', syllables: ['oi', 'kon'], stressed: [0, 1] },
      { chapter: 'PHM.1', key: '6:4', syllables: ['pi', 'ste', 'os'], stressed: [0, 2] },
    ];
    for (const example of examples) {
      const p = aid(example.chapter, example.key).pronunciation;
      expect(latin(p.syllables), `${example.chapter}:${example.key}`).toEqual(example.syllables);
      expect(p.stressed, `${example.chapter}:${example.key}`).toEqual(example.stressed);
      expect(p.status).toBe('written-accent');
    }
    expect(latin(aid('PHM.1', '1:9').pronunciation.syllables)).toEqual(['toi']);
    expect(latin(aid('PHM.1', '3:1').pronunciation.syllables).join('')).toMatch(/^hy/);
    expect(latin(aid('1TH.1', '7:13').pronunciation.syllables)).toEqual(['a', 'cha', 'i', 'ai']);
  });
});

describe('manual backups remain compatible after adding aids', () => {
  it('loads a pre-aids backup with unchanged history and endpoints and default-on reading preferences', () => {
    let progress = setEndpoint(initialProgress(corpus), corpus.chapters[0], 48);
    progress = advance(progress, 'GEN.1', true, '2026-09-25T12:00:00Z');
    const legacy = { ...progress, settings: { increment: 5, fontSize: 52, cantillation: true } };
    const parsed = parseBackup(JSON.stringify({ format: 'sola-backup', exportedAt: '2026-09-25T13:00:00Z', progress: legacy }), corpus).progress;
    expect(parsed.chapters).toEqual(progress.chapters);
    expect(parsed.circuit).toEqual(progress.circuit);
    expect(parsed.contentHash).toBe(originalFingerprint);
    expect(parsed.settings).toMatchObject({ increment: 5, fontSize: 52, cantillation: true, showGlosses: true, showHebrewTransliteration: true, showGreekTransliteration: true });
  });

  it('round trips preference switches without storing the aid datasets in backups', () => {
    const progress = initialProgress(corpus);
    Object.assign(progress.settings, { showGlosses: false, showHebrewTransliteration: false, showGreekTransliteration: true });
    const backup = makeBackup(progress);
    expect(parseBackup(JSON.stringify(backup), corpus).progress).toEqual(progress);
    expect(Object.keys(backup.progress).sort()).toEqual(['chapters', 'circuit', 'contentHash', 'corpusId', 'schemaVersion', 'settings']);
    expect(JSON.stringify(backup)).not.toContain('syllables');
    const invalid = { ...progress, settings: { ...progress.settings, showGlosses: 'yes' } };
    expect(() => validateProgress(invalid, corpus)).toThrow();
  });
});
