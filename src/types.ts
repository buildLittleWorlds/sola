export interface Token { text: string; verse: number; sourceIndex: number; prefix?: string; suffix?: string }
export interface Variant { verse: number; at: number; written: string[]; read: string[] }
export interface Chapter {
  id: string; bookId: string; number: number; tokens: Token[]; verses: number[]; variants: Variant[];
  markers: { verse: number; after: number; text: string; kind: string }[];
  notes: { verse: number; sourceIndex?: number; after?: number; code?: string; specialLetter?: string; attributes?: Record<string, string> }[];
}
export interface ChapterMeta { id: string; bookId: string; number: number; wordCount: number; verseCount: number; tokenKeys: string[] }
export interface Book { id: string; name: string; nativeName: string; testament: 'OT' | 'NT'; language: 'he' | 'grc'; edition: string; chapters: number; words: number }
export interface Corpus {
  schemaVersion: number; corpusId: string; contentHash: string; books: Book[]; chapters: ChapterMeta[];
  sources: { hebrew: { version: string; archiveSha256: string; url: string }; greek: { version: string; commit: string; url: string } };
  statistics: Record<string, number>;
}
export interface ChapterProgress { wordCount: number; endpoint: string; visits: number; lastVisited: string | null }
export interface Progress {
  schemaVersion: 1; corpusId: string; contentHash: string;
  chapters: Record<string, ChapterProgress>;
  circuit: { position: number; round: number };
  settings: { increment: number; fontSize: number; cantillation: boolean; showGlosses: boolean; showHebrewTransliteration: boolean; showGreekTransliteration: boolean };
}
export interface Backup { format: 'sola-backup'; exportedAt: string; progress: Progress }
export type PronunciationStatus = 'accent-derived' | 'written-accent' | 'reviewed' | 'stress-unconfirmed' | 'pronunciation-unconfirmed' | 'joined' | 'unavailable' | 'convention';
export interface ReadingAid {
  gloss: string | null;
  glossStatus: 'source-aligned' | 'reviewed' | 'unavailable';
  lemma?: string;
  grammar?: string;
  components?: string[];
  sources: string[];
  sourceRef?: string;
  pronunciation: { syllables: string[]; stressed: number[]; status: PronunciationStatus; note?: string };
  notes?: string[];
}
export interface AidBook { schemaVersion: 1; bookId: string; corpusHash: string; chapters: Record<string, Record<string, ReadingAid>> }
