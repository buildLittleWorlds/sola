import type { Chapter, Corpus } from './types';
import { appPath } from './paths';
import { createJsonRequest, type JsonRequest } from './resources';
const loaded = new Map<string, JsonRequest<Chapter[]>>();
export async function loadCorpus(): Promise<Corpus> {
  const corpus = await createJsonRequest<Corpus>(appPath('/corpus/index.json')).promise;
  if (corpus.schemaVersion !== 1 || corpus.chapters.length !== 1189 || corpus.books.length !== 66) throw new Error('The bundled corpus is incomplete.');
  return corpus;
}
export async function loadChapter(id: string, forceRefresh = false): Promise<Chapter> {
  const bookId = id.split('.')[0];
  if (forceRefresh) { loaded.get(bookId)?.cancel(); loaded.delete(bookId); }
  if (!loaded.has(bookId)) {
    const request = createJsonRequest<Chapter[]>(appPath(`/corpus/${bookId}.json`), { refresh: forceRefresh });
    request.promise = request.promise.then(chapters => {
      if (!Array.isArray(chapters) || !chapters.every(c => c.bookId === bookId && Array.isArray(c.tokens) && c.tokens.length > 0)) throw new Error('This book’s download is incomplete. Retry to download a fresh copy.');
      return chapters;
    }).catch(error => { if (loaded.get(bookId) === request) loaded.delete(bookId); throw error; });
    loaded.set(bookId, request);
  }
  const request = loaded.get(bookId)!;
  const chapter = (await request.promise).find(c => c.id === id);
  if (!chapter) { if (loaded.get(bookId) === request) loaded.delete(bookId); throw new Error(`Chapter ${id} is missing from this download. Retry to download a fresh copy.`); }
  return chapter;
}
