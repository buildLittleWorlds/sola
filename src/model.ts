import type { Backup, ChapterMeta, Corpus, Progress } from './types';

export function buildCircuit(corpus: Corpus): string[] {
  const otBooks = new Set(corpus.books.filter(b => b.testament === 'OT').map(b => b.id));
  const ot = corpus.chapters.filter(c => otBooks.has(c.bookId));
  const nt = corpus.chapters.filter(c => !otBooks.has(c.bookId));
  if (ot.length !== 929 || nt.length !== 260) throw new Error('The corpus must contain 929 OT and 260 NT chapters.');
  const result: string[] = [];
  nt.forEach((chapter, i) => {
    result.push(...ot.slice(Math.floor(i * 929 / 260), Math.floor((i + 1) * 929 / 260)).map(c => c.id), chapter.id);
  });
  return result;
}

export function endpointId(chapter: ChapterMeta, count: number) { return `${chapter.id}:${chapter.tokenKeys[count - 1]}`; }

export function initialProgress(corpus: Corpus): Progress {
  return {
    schemaVersion: 1, corpusId: corpus.corpusId, contentHash: corpus.contentHash,
    circuit: { position: 0, round: 1 }, settings: { increment: 3, fontSize: 44, cantillation: false, showGlosses: true, showHebrewTransliteration: true, showGreekTransliteration: true },
    chapters: Object.fromEntries(corpus.chapters.map(c => {
      const count = Math.min(3, c.wordCount);
      return [c.id, { wordCount: count, endpoint: endpointId(c, count), visits: 0, lastVisited: null }];
    })),
  };
}

export function setEndpoint(progress: Progress, chapter: ChapterMeta, requested: number): Progress {
  const wordCount = Math.min(chapter.wordCount, Math.max(1, Math.trunc(requested)));
  if (!Number.isFinite(wordCount)) return progress;
  return { ...progress, chapters: { ...progress.chapters, [chapter.id]: { ...progress.chapters[chapter.id], wordCount, endpoint: endpointId(chapter, wordCount) } } };
}

export function advance(progress: Progress, chapterId: string, inCircuit: boolean, now = new Date().toISOString()): Progress {
  const current = progress.chapters[chapterId];
  const position = inCircuit ? (progress.circuit.position + 1) % 1189 : progress.circuit.position;
  const round = progress.circuit.round + (inCircuit && position === 0 ? 1 : 0);
  return { ...progress, circuit: { position, round }, chapters: { ...progress.chapters, [chapterId]: { ...current, visits: current.visits + 1, lastVisited: now } } };
}

export function retreat(progress: Progress): Progress {
  const { position, round } = progress.circuit;
  if (position === 0 && round === 1) return progress;
  return { ...progress, circuit: position === 0 ? { position: 1188, round: round - 1 } : { position: position - 1, round } };
}

export function displayHebrew(text: string, cantillation: boolean): string {
  // Keep vowels, meteg/siluq, shin/sin dots, dagesh, maqaf and punctuation.
  return cantillation ? text : text.replace(/[\u0591-\u05AF]/g, '');
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid backup structure.');
  return value as Record<string, unknown>;
}
function integer(value: unknown, min: number, max: number): value is number { return Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max; }
function date(value: unknown): value is string { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)); }

export function validateProgress(value: unknown, corpus: Corpus): Progress {
  const p = object(value);
  if (p.schemaVersion !== 1 || p.corpusId !== corpus.corpusId || p.contentHash !== corpus.contentHash) throw new Error('This progress belongs to a different corpus or app format. Nothing has been replaced.');
  const settings = object(p.settings), circuit = object(p.circuit), chapters = object(p.chapters);
  if (!integer(settings.increment, 1, 50) || !integer(settings.fontSize, 24, 72) || typeof settings.cantillation !== 'boolean') throw new Error('Invalid display or word increment settings.');
  for (const key of ['showGlosses', 'showHebrewTransliteration', 'showGreekTransliteration']) {
    if (settings[key] !== undefined && typeof settings[key] !== 'boolean') throw new Error('Invalid reading-aid settings.');
  }
  if (!integer(circuit.position, 0, 1188) || !integer(circuit.round, 1, 1_000_000)) throw new Error('Invalid circuit position.');
  if (Object.keys(chapters).length !== corpus.chapters.length) throw new Error('The backup must include all 1,189 chapters.');
  const clean: Progress['chapters'] = {};
  for (const ch of corpus.chapters) {
    const item = object(chapters[ch.id]);
    if (!integer(item.wordCount, 1, ch.wordCount) || item.endpoint !== endpointId(ch, item.wordCount as number)) throw new Error(`The saved endpoint for ${ch.id} does not match this text.`);
    if (!integer(item.visits, 0, Number.MAX_SAFE_INTEGER) || (item.lastVisited !== null && !date(item.lastVisited))) throw new Error(`Invalid review history for ${ch.id}.`);
    clean[ch.id] = { wordCount: item.wordCount as number, endpoint: item.endpoint as string, visits: item.visits as number, lastVisited: item.lastVisited as string | null };
  }
  return { schemaVersion: 1, corpusId: corpus.corpusId, contentHash: corpus.contentHash, chapters: clean,
    settings: { increment: settings.increment as number, fontSize: settings.fontSize as number, cantillation: settings.cantillation,
      showGlosses: settings.showGlosses === undefined ? true : settings.showGlosses as boolean,
      showHebrewTransliteration: settings.showHebrewTransliteration === undefined ? true : settings.showHebrewTransliteration as boolean,
      showGreekTransliteration: settings.showGreekTransliteration === undefined ? true : settings.showGreekTransliteration as boolean },
    circuit: { position: circuit.position as number, round: circuit.round as number } };
}
export function makeBackup(progress: Progress): Backup { return { format: 'sola-backup', exportedAt: new Date().toISOString(), progress }; }
export function parseBackup(text: string, corpus: Corpus): Backup {
  if (text.length > 5_000_000) throw new Error('This file is too large to be a Sola backup.');
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new Error('This file is not valid JSON. Nothing has been replaced.'); }
  const b = object(parsed);
  if (b.format !== 'sola-backup' || !date(b.exportedAt)) throw new Error('This is not a supported Sola backup.');
  return { format: 'sola-backup', exportedAt: b.exportedAt, progress: validateProgress(b.progress, corpus) };
}
