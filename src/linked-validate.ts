import type { Corpus } from './types';
import type { LedgerEvent, Link, LinkedBackup, LinkedState, Passage, TokenId } from './linked-types';
import { MAX_LABEL_LENGTH, MAX_NOTE_LENGTH, MAX_SLOTS, checkSpans, isTimeZone, localDate, passageTokenIds } from './linked-model';

export const BACKUP_FORMAT = 'sola-linked-backup';
const MAX_BACKUP_CHARS = 25_000_000;
const STATUSES = ['active', 'queued', 'held', 'completed'];

const bad = (what: string): never => { throw new Error(`${what} Nothing has been replaced.`); };
function object(value: unknown, what = 'The backup is malformed.'): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return bad(what);
  return value as Record<string, unknown>;
}
function array(value: unknown, what: string): unknown[] { return Array.isArray(value) ? value : bad(what); }
function integer(value: unknown, min: number, max: number): value is number { return Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max; }
function instant(value: unknown): value is string { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)); }
function text(value: unknown, max: number): value is string { return typeof value === 'string' && value.trim() === value && value.length >= 1 && value.length <= max; }

/** Validates a stored or imported state completely and returns a clean copy. Throws without side effects. */
export function validateLinkedState(value: unknown, corpus: Corpus): LinkedState {
  const s = object(value, 'The saved state is malformed.');
  if (s.schemaVersion !== 1 || s.corpusId !== corpus.corpusId || s.contentHash !== corpus.contentHash) return bad('This data belongs to a different corpus or app format.');

  const settings = object(s.settings, 'Invalid settings.');
  if (!integer(settings.increment, 1, 50) || !integer(settings.dailyCap, 1, 250) || !isTimeZone(settings.timeZone)) return bad('Invalid settings.');

  // Passages
  const passages: Passage[] = [];
  const ids = new Set<string>();
  for (const raw of array(s.passages, 'Invalid passage list.')) {
    const p = object(raw, 'Invalid passage.');
    if (!text(p.id, 100) || ids.has(p.id)) return bad('A passage has a missing or repeated ID.');
    if (!text(p.label, MAX_LABEL_LENGTH)) return bad(`Passage ${p.id} has an invalid label.`);
    if (!STATUSES.includes(p.status as string)) return bad(`Passage ${p.id} has an invalid status.`);
    if (!instant(p.createdAt)) return bad(`Passage ${p.id} has an invalid date.`);
    let language;
    try { language = checkSpans(corpus, p.spans); } catch (error) { return bad(`Passage ${p.id}: ${error instanceof Error ? error.message : 'invalid spans.'}`); }
    if (p.language !== language) return bad(`Passage ${p.id} has the wrong language for its text.`);
    ids.add(p.id);
    passages.push({ id: p.id, label: p.label, language, createdAt: p.createdAt, status: p.status as Passage['status'], spans: (p.spans as { from: string; to: string }[]).map(sp => ({ from: sp.from, to: sp.to })) });
  }
  const slots = passages.filter(p => p.status === 'active' || p.status === 'held').length;
  if (slots > MAX_SLOTS) return bad(`More than ${MAX_SLOTS} passages hold a slot.`);
  if (passages.some(p => p.status === 'queued') && slots < MAX_SLOTS) return bad('A passage is queued while a slot is free.');

  // Links
  const links: Link[] = [];
  const linkIds = new Set<string>(), pairs = new Set<string>();
  for (const raw of array(s.links, 'Invalid link list.')) {
    const l = object(raw, 'Invalid link.');
    if (!text(l.id, 100) || linkIds.has(l.id)) return bad('A link has a missing or repeated ID.');
    if (typeof l.fromId !== 'string' || typeof l.toId !== 'string' || !ids.has(l.fromId) || !ids.has(l.toId)) return bad(`Link ${l.id} points at a passage that does not exist.`);
    if (l.fromId === l.toId) return bad(`Link ${l.id} links a passage to itself.`);
    if (pairs.has(`${l.fromId}>${l.toId}`)) return bad(`Link ${l.id} repeats an existing link.`);
    if (!text(l.note, MAX_NOTE_LENGTH)) return bad(`Link ${l.id} needs a non-empty note.`);
    if (!instant(l.createdAt)) return bad(`Link ${l.id} has an invalid date.`);
    linkIds.add(l.id); pairs.add(`${l.fromId}>${l.toId}`);
    links.push({ id: l.id, fromId: l.fromId, toId: l.toId, note: l.note, createdAt: l.createdAt });
  }
  // Every passage but the seed (the first) is reachable from the seed along links, so each has an incoming link.
  if (passages.length > 0) {
    const reached = new Set([passages[0].id]), todo = [passages[0].id];
    while (todo.length) { const from = todo.pop()!; for (const l of links) if (l.fromId === from && !reached.has(l.toId)) { reached.add(l.toId); todo.push(l.toId); } }
    const orphan = passages.find(p => !reached.has(p.id));
    if (orphan) return bad(`Passage ${orphan.id} is not linked from the seed passage.`);
  }

  // Ledger
  const byId = new Map(passages.map(p => [p.id, p]));
  const owned = new Map(passages.map(p => [p.id, new Set(passageTokenIds(corpus, p))]));
  const seen = new Set<TokenId>();
  const ledger: LedgerEvent[] = [];
  let lastSeq = 0, previousCursor: string | null = null;
  if (!integer(s.eventSeq, 1, Number.MAX_SAFE_INTEGER)) return bad('Invalid event counter.');
  for (const raw of array(s.ledger, 'Invalid ledger.')) {
    const e = object(raw, 'Invalid ledger event.');
    const match = typeof e.id === 'string' ? /^e([1-9]\d*)$/.exec(e.id) : null;
    const seq = match ? Number(match[1]) : 0;
    if (!match || !Number.isSafeInteger(seq) || seq <= lastSeq || seq >= (s.eventSeq as number)) return bad('The ledger has a repeated, out-of-order or unknown event ID.');
    lastSeq = seq;
    if (!instant(e.at) || !isTimeZone(e.timeZone) || e.date !== localDate(new Date(e.at), e.timeZone)) return bad(`Ledger event ${e.id} has an inconsistent date or time zone.`);
    if (!integer(e.shortfall, 0, 50)) return bad(`Ledger event ${e.id} has an invalid shortfall.`);
    if (e.cursorBefore !== previousCursor) return bad(`Ledger event ${e.id} does not continue from the previous cursor.`);
    const segments = array(e.segments, `Ledger event ${e.id} has no segments.`);
    if (segments.length === 0) return bad(`Ledger event ${e.id} has no segments.`);
    const clean: LedgerEvent['segments'] = [];
    let words = 0;
    for (const rawSegment of segments) {
      const g = object(rawSegment, `Ledger event ${e.id} has an invalid segment.`);
      const passage = typeof g.passageId === 'string' ? byId.get(g.passageId) : undefined;
      if (!passage) return bad(`Ledger event ${e.id} refers to a passage that does not exist.`);
      if (passage!.status === 'queued') return bad(`Ledger event ${e.id} adds words from a queued passage.`);
      const tokenIds = array(g.tokenIds, `Ledger event ${e.id} has invalid tokens.`);
      if (tokenIds.length === 0) return bad(`Ledger event ${e.id} has an empty segment.`);
      for (const id of tokenIds) {
        if (typeof id !== 'string' || !owned.get(passage!.id)!.has(id)) return bad(`Ledger event ${e.id} introduces a word outside passage ${passage!.id}.`);
        if (seen.has(id)) return bad(`The ledger introduces ${id} more than once.`);
        seen.add(id);
      }
      words += tokenIds.length;
      clean.push({ passageId: passage!.id, tokenIds: tokenIds as string[] });
    }
    if (words > 50) return bad(`Ledger event ${e.id} adds too many words.`);
    previousCursor = clean[clean.length - 1].passageId;
    ledger.push({ id: e.id as string, at: e.at, date: e.date, timeZone: e.timeZone, segments: clean, shortfall: e.shortfall, cursorBefore: e.cursorBefore as string | null });
  }

  // Cursor and coverage must agree with the ledger.
  const cursor = object(s.cursor, 'Invalid cursor.');
  if (cursor.lastServedId !== previousCursor) return bad('The cursor does not match the ledger.');
  const coverage = array(s.coverage, 'Invalid coverage.');
  if (new Set(coverage).size !== seen.size || coverage.length !== seen.size || coverage.some(id => typeof id !== 'string' || !seen.has(id))) return bad('The introduced-word coverage does not match the ledger.');
  // A completed passage must be fully introduced.
  for (const p of passages) if (p.status === 'completed' && passageTokenIds(corpus, p).some(id => !seen.has(id))) return bad(`Passage ${p.id} is completed but not fully introduced.`);

  return {
    schemaVersion: 1, corpusId: corpus.corpusId, contentHash: corpus.contentHash, passages, links, ledger,
    coverage: [...seen].sort(), cursor: { lastServedId: previousCursor }, eventSeq: s.eventSeq as number,
    settings: { increment: settings.increment as number, dailyCap: settings.dailyCap as number, timeZone: settings.timeZone as string },
  };
}

export function makeLinkedBackup(state: LinkedState, exportedAt = new Date()): LinkedBackup {
  return { format: BACKUP_FORMAT, version: 1, exportedAt: exportedAt.toISOString(), state };
}

/** Parses and fully validates a backup file. Throws, changing nothing, on any problem. */
export function parseLinkedBackup(textContent: string, corpus: Corpus): LinkedBackup {
  if (textContent.length > MAX_BACKUP_CHARS) return bad('This file is too large to be a Linked Memory backup.');
  let parsed: unknown;
  try { parsed = JSON.parse(textContent); } catch { return bad('This file is not valid JSON.'); }
  const b = object(parsed, 'This is not a supported Linked Memory backup.');
  if (b.format !== BACKUP_FORMAT || b.version !== 1 || !instant(b.exportedAt)) return bad('This is not a supported Linked Memory backup.');
  return { format: BACKUP_FORMAT, version: 1, exportedAt: b.exportedAt, state: validateLinkedState(b.state, corpus) };
}
