import type { AidBook, Corpus, ReadingAid } from './types';
import { appPath } from './paths';
import { createJsonRequest, type JsonRequest } from './resources';

const books = new Map<string, JsonRequest<AidBook>>();
export const AIDS_RELEASE = '2026-09-26.2';
export const aidKey = (verse: number, sourceIndex: number) => `${verse}:${sourceIndex}`;

export async function loadChapterAids(id: string, corpus: Corpus, forceRefresh = false): Promise<Record<string, ReadingAid>> {
  const bookId = id.split('.')[0];
  if (forceRefresh) { books.get(bookId)?.cancel(); books.delete(bookId); }
  if (!books.has(bookId)) {
    const request = createJsonRequest<AidBook>(appPath(`/aids/${bookId}.json`), { timeoutMs: 30_000, refresh: forceRefresh });
    request.promise = request.promise.then(data => {
      if (data.schemaVersion !== 1 || data.bookId !== bookId || data.corpusHash !== corpus.contentHash) throw new Error('These reading aids do not match this edition of the text.');
      const metas = corpus.chapters.filter(c => c.bookId === bookId);
      if (!data.chapters || Object.keys(data.chapters).length !== metas.length) throw new Error('This book’s reading aids are incomplete.');
      for (const chapter of metas) {
        const entries = data.chapters[chapter.id];
        if (!entries || Object.keys(entries).length !== chapter.tokenKeys.length || chapter.tokenKeys.some(key => {
          const entry = entries[key], p = entry?.pronunciation;
          return !entry || (entry.gloss !== null && typeof entry.gloss !== 'string') || !Array.isArray(entry.sources) || !entry.sources.every(s => typeof s === 'string')
            || !['source-aligned', 'reviewed', 'unavailable'].includes(entry.glossStatus)
            || (entry.components !== undefined && (!Array.isArray(entry.components) || !entry.components.every(s => typeof s === 'string')))
            || (entry.notes !== undefined && (!Array.isArray(entry.notes) || !entry.notes.every(s => typeof s === 'string')))
            || !p || !Array.isArray(p.syllables) || !p.syllables.every(s => typeof s === 'string')
            || !['accent-derived', 'written-accent', 'reviewed', 'stress-unconfirmed', 'pronunciation-unconfirmed', 'joined', 'unavailable', 'convention'].includes(p.status)
            || !Array.isArray(p.stressed) || !p.stressed.every(i => Number.isInteger(i) && i >= 0 && i < p.syllables.length)
            || (['stress-unconfirmed', 'pronunciation-unconfirmed', 'joined', 'unavailable'].includes(p.status) && p.stressed.length > 0);
        })) throw new Error('This chapter’s reading aids are incomplete. Your original text is unchanged.');
      }
      return data;
    }).catch(error => { if (books.get(bookId) === request) books.delete(bookId); throw error; });
    books.set(bookId, request);
    // The service worker keeps all books offline; memory holds a small working set.
    if (books.size > 3) books.delete(books.keys().next().value!);
  }
  const result = (await books.get(bookId)!.promise).chapters[id];
  return result;
}

export const aidSources: Record<string, { title: string; href: string }> = {
  'step-tahot': { title: 'STEPBible TAHOT', href: 'https://github.com/STEPBible/STEPBible-Data/tree/b99716b0cddb648ddb95cc786a197180f2f97d48' },
  'step-tagnt': { title: 'STEPBible TAGNT', href: 'https://github.com/STEPBible/STEPBible-Data/tree/b99716b0cddb648ddb95cc786a197180f2f97d48' },
  'macula-sblgnt': { title: 'MACULA SBLGNT', href: 'https://github.com/Clear-Bible/macula-greek/tree/8423afe47b9e8f24b7772e808af45c7159a6fe7e/SBLGNT' },
  'hebrew-transliteration': { title: 'Hebrew transliteration & havarotjs', href: 'https://github.com/charlesLoder/hebrew-transliteration' },
  'greek-accentuation': { title: 'Greek accentuation', href: 'https://github.com/jtauber/greek-accentuation' },
  'reviewed-override': { title: 'Documented reading-aid corrections', href: appPath('/aids/corrections.json') },
};
