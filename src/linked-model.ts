import type { Corpus, ChapterMeta } from './types';
import type { LedgerEvent, LedgerSegment, LinkedSettings, LinkedState, Link, Passage, PassageLanguage, Span, TokenId } from './linked-types';

export const MAX_SLOTS = 50;
export const MAX_NOTE_LENGTH = 2000;
export const MAX_LABEL_LENGTH = 200;
export const DEFAULT_SETTINGS: LinkedSettings = { increment: 5, dailyCap: 250, timeZone: 'America/Chicago' };

export class LinkedModelError extends Error {}
const fail = (message: string): never => { throw new LinkedModelError(message); };

// ---- Corpus token lookup ----------------------------------------------------------------------

interface ChapterIndex { meta: ChapterMeta; order: number; position: Map<string, number> }
const indexes = new WeakMap<Corpus, Map<string, ChapterIndex>>();
function chapterIndex(corpus: Corpus): Map<string, ChapterIndex> {
  let index = indexes.get(corpus);
  if (!index) {
    index = new Map(corpus.chapters.map((meta, order) => [meta.id, { meta, order, position: new Map(meta.tokenKeys.map((key, i) => [key, i])) }]));
    indexes.set(corpus, index);
  }
  return index;
}

export const tokenIdOf = (chapterId: string, key: string): TokenId => `${chapterId}:${key}`;

export interface ResolvedToken { chapter: ChapterIndex; position: number }
/** Resolves a token ID against the corpus, or undefined when it is not a real token. */
export function resolveToken(corpus: Corpus, id: unknown): ResolvedToken | undefined {
  if (typeof id !== 'string') return undefined;
  const parts = id.split(':');
  if (parts.length !== 3) return undefined;
  const chapter = chapterIndex(corpus).get(parts[0]);
  const position = chapter?.position.get(`${parts[1]}:${parts[2]}`);
  return chapter && position !== undefined ? { chapter, position } : undefined;
}

export function languageOfChapter(corpus: Corpus, chapterId: string): PassageLanguage {
  const chapter = chapterIndex(corpus).get(chapterId);
  const book = chapter && corpus.books.find(b => b.id === chapter.meta.bookId);
  if (!book) return fail(`Unknown chapter ${chapterId}.`);
  return book!.language;
}

export function spanTokenIds(corpus: Corpus, span: Span): TokenId[] {
  const from = resolveToken(corpus, span.from), to = resolveToken(corpus, span.to);
  if (!from || !to || from.chapter !== to.chapter || from.position > to.position) return fail('Invalid span.');
  const { meta } = from!.chapter;
  return meta.tokenKeys.slice(from!.position, to!.position + 1).map(key => tokenIdOf(meta.id, key));
}
export const passageTokenIds = (corpus: Corpus, passage: Pick<Passage, 'spans'>): TokenId[] => passage.spans.flatMap(span => spanTokenIds(corpus, span));

/** The span covering whole verses `startVerse`..`endVerse` of one chapter. Both verses must exist. */
export function spanFromVerses(corpus: Corpus, chapterId: string, startVerse: number, endVerse: number): Span {
  const chapter = chapterIndex(corpus).get(chapterId);
  if (!chapter) return fail(`Unknown chapter ${chapterId}.`);
  const keys = chapter!.meta.tokenKeys;
  const verseOf = (key: string) => Number(key.split(':')[0]);
  const first = keys.findIndex(key => verseOf(key) === startVerse);
  const last = keys.map(verseOf).lastIndexOf(endVerse);
  if (first < 0 || last < 0 || startVerse > endVerse) return fail(`${chapterId} has no verses ${startVerse}–${endVerse}.`);
  return { from: tokenIdOf(chapterId, keys[first]), to: tokenIdOf(chapterId, keys[last]) };
}

/** Validates spans (non-empty, real tokens, one chapter each, strictly ascending and non-overlapping, one language) and returns the passage language. */
export function checkSpans(corpus: Corpus, spans: unknown): PassageLanguage {
  if (!Array.isArray(spans) || spans.length === 0) return fail('A passage needs at least one span.');
  let language: PassageLanguage | undefined;
  let previous: { order: number; position: number } | undefined;
  for (const span of spans as Span[]) {
    const from = resolveToken(corpus, span?.from), to = resolveToken(corpus, span?.to);
    if (!from || !to) return fail('A span refers to a token that is not in this corpus.');
    if (from!.chapter !== to!.chapter) return fail('A span must stay within one chapter.');
    if (from!.position > to!.position) return fail('A span ends before it starts.');
    if (previous && (from!.chapter.order < previous.order || (from!.chapter.order === previous.order && from!.position <= previous.position))) return fail('Spans must be in corpus order and must not overlap.');
    previous = { order: to!.chapter.order, position: to!.position };
    const spanLanguage = languageOfChapter(corpus, from!.chapter.meta.id);
    if (language && language !== spanLanguage) return fail('A passage cannot mix Hebrew/Aramaic and Greek.');
    language = spanLanguage;
  }
  return language!;
}

/** "Matthew 13:44", "Mark 7:1–13"; spans joined with "; ". */
export function referenceLabel(corpus: Corpus, spans: Span[]): string {
  return spans.map(span => {
    const from = resolveToken(corpus, span.from)!, to = resolveToken(corpus, span.to)!;
    const book = corpus.books.find(b => b.id === from.chapter.meta.bookId)!;
    const a = from.chapter.meta.tokenKeys[from.position].split(':')[0], b = to.chapter.meta.tokenKeys[to.position].split(':')[0];
    return `${book.name} ${from.chapter.meta.number}:${a}${a === b ? '' : `–${b}`}`;
  }).join('; ');
}

// ---- Dates ------------------------------------------------------------------------------------

export function isTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || !value) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: value }); return true; } catch { return false; }
}
/** Local calendar date (YYYY-MM-DD) of an instant in an IANA time zone. */
export function localDate(at: Date, timeZone: string): string {
  const parts = new Map(new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at).map(p => [p.type, p.value]));
  return `${parts.get('year')}-${parts.get('month')}-${parts.get('day')}`;
}

// ---- State ------------------------------------------------------------------------------------

export function initialLinkedState(corpus: Corpus): LinkedState {
  return { schemaVersion: 1, corpusId: corpus.corpusId, contentHash: corpus.contentHash, passages: [], links: [], coverage: [], ledger: [], cursor: { lastServedId: null }, eventSeq: 1, settings: { ...DEFAULT_SETTINGS } };
}

export function setTimeZone(state: LinkedState, timeZone: string): LinkedState {
  if (!isTimeZone(timeZone)) return fail('That is not a recognized time zone.');
  return { ...state, settings: { ...state.settings, timeZone } };
}

const slotsInUse = (state: LinkedState) => state.passages.filter(p => p.status === 'active' || p.status === 'held').length;
const passageById = (state: LinkedState, id: string) => state.passages.find(p => p.id === id);
const cleanNote = (note: unknown): string => {
  const text = typeof note === 'string' ? note.trim() : '';
  if (!text) return fail('A link needs a note saying why the passages connect.');
  if (text.length > MAX_NOTE_LENGTH) return fail('That note is too long.');
  return text;
};

export interface NewLink { id: string; fromId: string; note: string }
export interface NewPassage { id: string; label?: string; spans: Span[]; now?: Date; link?: NewLink }

/**
 * Adds a passage. The first passage is the seed and takes no link; every later passage must be linked from an
 * existing passage with a non-empty note, in the same step. It takes a free slot, or queues when all 50 are used.
 */
export function addPassage(state: LinkedState, corpus: Corpus, input: NewPassage): LinkedState {
  const now = (input.now ?? new Date()).toISOString();
  if (!input.id || passageById(state, input.id)) return fail('That passage ID is already in use.');
  const language = checkSpans(corpus, input.spans);
  const label = (input.label ?? referenceLabel(corpus, input.spans)).trim();
  if (!label || label.length > MAX_LABEL_LENGTH) return fail('A passage needs a label of 1–200 characters.');
  const seed = state.passages.length === 0;
  if (seed && input.link) return fail('The first passage is the seed and cannot be linked from anything.');
  const links = [...state.links];
  if (!seed) {
    if (!input.link) return fail('Link this passage from an existing passage, with a note.');
    links.push(makeLink(state, input.link.id, input.link.fromId, input.id, input.link.note, now, links));
  }
  const status = slotsInUse(state) < MAX_SLOTS ? 'active' : 'queued';
  const passage: Passage = { id: input.id, label, spans: input.spans.map(s => ({ from: s.from, to: s.to })), language, createdAt: now, status };
  return { ...state, passages: [...state.passages, passage], links };
}

function makeLink(state: LinkedState, id: string, fromId: string, toId: string, note: string, createdAt: string, links: Link[]): Link {
  if (!id || links.some(l => l.id === id)) return fail('That link ID is already in use.');
  if (!passageById(state, fromId)) return fail('A link must start from an existing passage.');
  if (fromId === toId) return fail('A passage cannot link to itself.');
  if (links.some(l => l.fromId === fromId && l.toId === toId)) return fail('Those passages are already linked.');
  return { id, fromId, toId, note: cleanNote(note), createdAt };
}

/** Adds a further link between two existing passages (branching or cross-linking). */
export function addLink(state: LinkedState, input: { id: string; fromId: string; toId: string; note: string; now?: Date }): LinkedState {
  if (!passageById(state, input.toId)) return fail('A link must end at an existing passage.');
  return { ...state, links: [...state.links, makeLink(state, input.id, input.fromId, input.toId, input.note, (input.now ?? new Date()).toISOString(), state.links)] };
}

// ---- Passage status ---------------------------------------------------------------------------

function setStatus(state: LinkedState, id: string, status: Passage['status']): LinkedState {
  return { ...state, passages: state.passages.map(p => p.id === id ? { ...p, status } : p) };
}

export function holdPassage(state: LinkedState, id: string): LinkedState {
  if (passageById(state, id)?.status !== 'active') return fail('Only a learning passage can be put on hold.');
  return setStatus(state, id, 'held');
}
export function resumePassage(state: LinkedState, id: string): LinkedState {
  if (passageById(state, id)?.status !== 'held') return fail('Only a held passage can be resumed.');
  return setStatus(state, id, 'active');
}
/** Marks a fully introduced passage Completed, freeing its slot for the first queued passage (in the order queued). */
export function completePassage(state: LinkedState, corpus: Corpus, id: string): LinkedState {
  const passage = passageById(state, id);
  if (!passage || (passage.status !== 'active' && passage.status !== 'held')) return fail('Only a passage that is in a slot can be completed.');
  if (!passageProgress(state, corpus, passage!).fullyIntroduced) return fail('A passage can be completed once every word has been introduced.');
  let next = setStatus(state, id, 'completed');
  const queued = next.passages.find(p => p.status === 'queued');
  if (queued && slotsInUse(next) < MAX_SLOTS) next = setStatus(next, queued.id, 'active');
  return next;
}

// ---- Progress, target and rotation ------------------------------------------------------------

export function passageProgress(state: LinkedState, corpus: Corpus, passage: Passage) {
  const covered = new Set(state.coverage), tokens = passageTokenIds(corpus, passage);
  const introduced = tokens.filter(id => covered.has(id)).length;
  return { total: tokens.length, introduced, fullyIntroduced: introduced === tokens.length };
}

export const wordsAddedOn = (state: LinkedState, date: string) =>
  state.ledger.filter(e => e.date === date).reduce((sum, e) => sum + e.segments.reduce((n, s) => n + s.tokenIds.length, 0), 0);

/** Active passages, in slot order, that still have unintroduced words. */
function eligiblePassages(state: LinkedState, corpus: Corpus, covered: ReadonlySet<TokenId>): Passage[] {
  return state.passages.filter(p => p.status === 'active' && passageTokenIds(corpus, p).some(id => !covered.has(id)));
}

/**
 * Daily target = increment × active passages that still have unintroduced words, capped at the daily cap.
 * A passage that was finished earlier today still counts for today, so completing it does not shrink today's target.
 */
export function dailyTarget(state: LinkedState, corpus: Corpus, now = new Date()): number {
  const date = localDate(now, state.settings.timeZone);
  const servedToday = new Set(state.ledger.filter(e => e.date === date).flatMap(e => e.segments.map(s => s.passageId)));
  const covered = new Set(state.coverage);
  const counted = new Set(eligiblePassages(state, corpus, covered).map(p => p.id));
  for (const p of state.passages) if (p.status === 'active' && servedToday.has(p.id)) counted.add(p.id);
  return Math.min(state.settings.dailyCap, state.settings.increment * counted.size);
}

/** Eligible passages in turn order: the first one after the cursor (by slot order) first, wrapping around. */
function turnOrder(state: LinkedState, eligible: Passage[]): Passage[] {
  const last = state.cursor.lastServedId === null ? -1 : state.passages.findIndex(p => p.id === state.cursor.lastServedId);
  const after = eligible.filter(p => state.passages.indexOf(p) > last), before = eligible.filter(p => state.passages.indexOf(p) <= last);
  return [...after, ...before];
}

export const nextEventId = (state: LinkedState) => `e${state.eventSeq}`;

export type RefusalReason = 'no-passages' | 'no-new-words' | 'target-reached' | 'stale-event';
export interface AdditionSegment extends LedgerSegment { label: string }
export interface AdditionPlan {
  /** The ID `addWords` must be called with for this plan. Stable until the state changes. */
  eventId: string;
  date: string;
  target: number;
  todayCount: number;
  /** Words still allowed today under the target. */
  remaining: number;
  /** Words this addition tries to supply: min(increment, remaining). */
  wanted: number;
  /** Separately labeled references; more than one only when the first passage ran out (passage tail). */
  segments: AdditionSegment[];
  tokenIds: TokenId[];
  /** Words short of `wanted` because no more eligible new words exist anywhere. Never padded with invented words. */
  shortfall: number;
  canAdd: boolean;
  reason?: Exclude<RefusalReason, 'stale-event'>;
}

/** What "Add 5 words" would do right now. Pure: never changes anything. */
export function planAddition(state: LinkedState, corpus: Corpus, now = new Date()): AdditionPlan {
  const date = localDate(now, state.settings.timeZone);
  const target = dailyTarget(state, corpus, now), todayCount = wordsAddedOn(state, date);
  const remaining = Math.max(0, target - todayCount), wanted = Math.min(state.settings.increment, remaining);
  const covered = new Set(state.coverage), taken = new Set<TokenId>();
  const segments: AdditionSegment[] = [];
  let need = wanted;
  for (const passage of turnOrder(state, eligiblePassages(state, corpus, covered))) {
    if (need === 0) break;
    const tokenIds: TokenId[] = [];
    for (const id of passageTokenIds(corpus, passage)) {
      if (need === 0) break;
      // Covered tokens (including overlap with other passages, and tokens already taken in this addition) never count twice.
      if (covered.has(id) || taken.has(id)) continue;
      tokenIds.push(id); taken.add(id); need--;
    }
    if (tokenIds.length) segments.push({ passageId: passage.id, label: passage.label, tokenIds });
  }
  const tokenIds = segments.flatMap(s => s.tokenIds);
  let reason: AdditionPlan['reason'];
  if (tokenIds.length === 0) {
    reason = state.passages.length === 0 ? 'no-passages' : target > 0 && remaining === 0 ? 'target-reached' : 'no-new-words';
  }
  return { eventId: nextEventId(state), date, target, todayCount, remaining, wanted, segments, tokenIds, shortfall: need, canAdd: tokenIds.length > 0, reason };
}

export type AddResult =
  | { status: 'added'; state: LinkedState; event: LedgerEvent }
  | { status: 'duplicate'; state: LinkedState; event: LedgerEvent }
  | { status: 'refused'; state: LinkedState; reason: RefusalReason };

/**
 * "Add 5 words": one atomic, idempotent step that updates coverage, ledger and cursor together.
 * `eventId` must be `nextEventId(state)` as seen when the plan was shown. Repeating a call with an ID that is already
 * in the ledger (double-click, retry) changes nothing; an ID that is neither already applied nor the next one
 * (for instance a stale retry after an undo) is refused.
 */
export function addWords(state: LinkedState, corpus: Corpus, eventId: string, now = new Date()): AddResult {
  const existing = state.ledger.find(e => e.id === eventId);
  if (existing) return { status: 'duplicate', state, event: existing };
  if (eventId !== nextEventId(state)) return { status: 'refused', state, reason: 'stale-event' };
  const plan = planAddition(state, corpus, now);
  if (!plan.canAdd) return { status: 'refused', state, reason: plan.reason! };
  const event: LedgerEvent = {
    id: eventId, at: now.toISOString(), date: plan.date, timeZone: state.settings.timeZone,
    segments: plan.segments.map(({ passageId, tokenIds }) => ({ passageId, tokenIds })),
    shortfall: plan.shortfall, cursorBefore: state.cursor.lastServedId,
  };
  const next: LinkedState = {
    ...state, coverage: [...state.coverage, ...plan.tokenIds].sort(), ledger: [...state.ledger, event],
    cursor: { lastServedId: event.segments[event.segments.length - 1].passageId }, eventSeq: state.eventSeq + 1,
  };
  return { status: 'added', state: next, event };
}

export type UndoResult =
  | { status: 'undone'; state: LinkedState; event: LedgerEvent }
  | { status: 'nothing' | 'stale' | 'passage-completed'; state: LinkedState };

/**
 * Undoes the last addition as a whole: its words leave the coverage, its event leaves the ledger, the cursor goes
 * back. With `eventId`, only that event is undone and only if it is still the last one, so a double-click undoes once.
 * Refused if a passage it touched has since been Completed (a completed passage must stay fully introduced).
 */
export function undoLastAddition(state: LinkedState, eventId?: string): UndoResult {
  const last = state.ledger[state.ledger.length - 1];
  if (!last) return { status: 'nothing', state };
  if (eventId !== undefined && eventId !== last.id) return { status: 'stale', state };
  if (last.segments.some(s => passageById(state, s.passageId)?.status === 'completed')) return { status: 'passage-completed', state };
  const removed = new Set(last.segments.flatMap(s => s.tokenIds));
  return { status: 'undone', event: last, state: { ...state, coverage: state.coverage.filter(id => !removed.has(id)), ledger: state.ledger.slice(0, -1), cursor: { lastServedId: last.cursorBefore } } };
}
