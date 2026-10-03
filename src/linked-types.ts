/** Passage/link/ledger model for Linked Memory. See SPEC.md "Data model". */

/** A corpus token ID: `${chapterId}:${verse}:${sourceIndex}`, e.g. `MAT.13:44:0`. Same keys as ChapterMeta.tokenKeys. */
export type TokenId = string;

/** Inclusive run of tokens inside one chapter, from `from` to `to` in corpus order. */
export interface Span { from: TokenId; to: TokenId }

export type PassageLanguage = 'he' | 'grc';
/** `active` and `held` occupy one of the 50 slots; `queued` waits for a slot; `completed` has released its slot. */
export type PassageStatus = 'active' | 'queued' | 'held' | 'completed';

export interface Passage { id: string; label: string; spans: Span[]; language: PassageLanguage; createdAt: string; status: PassageStatus }
export interface Link { id: string; fromId: string; toId: string; note: string; createdAt: string }

export interface LedgerSegment { passageId: string; tokenIds: TokenId[] }
export interface LedgerEvent {
  /** `e<seq>`; seq never repeats, even after an undo. */
  id: string;
  /** ISO instant of the addition. */
  at: string;
  /** Local calendar date (YYYY-MM-DD) in `timeZone` at the moment of the addition. History is never re-dated. */
  date: string;
  timeZone: string;
  /** One segment per passage that contributed; a second segment is the passage-tail fill. */
  segments: LedgerSegment[];
  /** Words the event could not supply because no more eligible new words existed. */
  shortfall: number;
  /** Cursor before the event, so undo restores it. */
  cursorBefore: string | null;
}

export interface LinkedSettings { increment: number; dailyCap: number; timeZone: string }

export interface LinkedState {
  schemaVersion: 1;
  corpusId: string;
  contentHash: string;
  /** Order added. The first passage is the seed. */
  passages: Passage[];
  links: Link[];
  /** Every token ever introduced, sorted. Always equals the union of the ledger's tokens. */
  coverage: TokenId[];
  ledger: LedgerEvent[];
  /** Persistent round-robin cursor: the passage that supplied the last words. The next turn goes to the next eligible passage after it. */
  cursor: { lastServedId: string | null };
  /** Next ledger sequence number. Monotonic. */
  eventSeq: number;
  settings: LinkedSettings;
}

export interface LinkedBackup { format: 'sola-linked-backup'; version: 1; exportedAt: string; state: LinkedState }
