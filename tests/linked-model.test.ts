import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { Corpus } from '../src/types';
import type { LinkedState } from '../src/linked-types';
import {
  addLink, addPassage, addWords, completePassage, dailyTarget, holdPassage, initialLinkedState, LinkedModelError, nextEventId,
  passageProgress, passageTokenIds, planAddition, referenceLabel, resumePassage, setTimeZone, spanFromVerses, undoLastAddition, wordsAddedOn,
} from '../src/linked-model';

const corpus = JSON.parse(readFileSync('public/corpus/index.json', 'utf8')) as Corpus;

// Real fixtures: Matthew 13:44 (seed, 31 words) and Mark 7:1–13 (222 words), linked from the seed.
const MATTHEW = { id: 'p-mat', spans: [spanFromVerses(corpus, 'MAT.13', 44, 44)] };
const MARK = { id: 'p-mrk', spans: [spanFromVerses(corpus, 'MRK.7', 1, 13)] };
const NOTE = 'The hidden treasure and the tradition that hides the word.';
// Noon in Chicago on successive days (CDT = UTC−5 until Nov 1, 2026; 17:00Z stays on the same Chicago date after that too).
const day = (n: number, hourUtc = 17) => new Date(Date.UTC(2026, 9, 5 + n, hourUtc));

const seedOnly = () => addPassage(initialLinkedState(corpus), corpus, { ...MATTHEW, now: day(0) });
const withMark = (state = seedOnly()) => addPassage(state, corpus, { ...MARK, now: day(0), link: { id: 'l-1', fromId: 'p-mat', note: NOTE } });
const tokens = (state: LinkedState, id: string) => passageTokenIds(corpus, state.passages.find(p => p.id === id)!);

/** One confirmed addition, the way the UI will do it: plan, then add with the plan's event ID. */
function add(state: LinkedState, now: Date) {
  const result = addWords(state, corpus, planAddition(state, corpus, now).eventId, now);
  if (result.status !== 'added') throw new Error(`Expected an addition, got ${result.status}: ${'reason' in result ? result.reason : ''}`);
  return result;
}
/** Adds until the day's target is reached or no words remain. */
function fillDay(state: LinkedState, now: Date) {
  for (;;) {
    const plan = planAddition(state, corpus, now);
    if (!plan.canAdd) return state;
    state = add(state, now).state;
  }
}

describe('fixtures', () => {
  it('Matthew 13:44 has 31 words and Mark 7:1–13 has 222, with stable token IDs', () => {
    const state = withMark();
    expect(tokens(state, 'p-mat')).toHaveLength(31);
    expect(tokens(state, 'p-mrk')).toHaveLength(222);
    expect(tokens(state, 'p-mat')[0]).toBe('MAT.13:44:0');
    expect(state.passages.map(p => [p.label, p.language, p.status])).toEqual([['Matthew 13:44', 'grc', 'active'], ['Mark 7:1–13', 'grc', 'active']]);
    expect(referenceLabel(corpus, [spanFromVerses(corpus, 'MRK.7', 5, 5)])).toBe('Mark 7:5');
  });
});

describe('linking', () => {
  it('lets the first passage be the seed and requires a note-bearing link for every other', () => {
    const seed = seedOnly();
    expect(seed.links).toEqual([]);
    expect(() => addPassage(seed, corpus, { ...MARK })).toThrow(LinkedModelError);
    expect(() => addPassage(seed, corpus, { ...MARK, link: { id: 'l-1', fromId: 'p-mat', note: '' } })).toThrow('note');
    expect(() => addPassage(seed, corpus, { ...MARK, link: { id: 'l-1', fromId: 'p-mat', note: '   ' } })).toThrow('note');
    expect(() => addPassage(seed, corpus, { ...MARK, link: { id: 'l-1', fromId: 'nobody', note: NOTE } })).toThrow('existing passage');
    expect(() => addPassage(initialLinkedState(corpus), corpus, { ...MATTHEW, link: { id: 'l-0', fromId: 'x', note: NOTE } })).toThrow('seed');
    const linked = withMark(seed);
    expect(linked.links).toMatchObject([{ id: 'l-1', fromId: 'p-mat', toId: 'p-mrk', note: NOTE }]);
    expect(seed.passages).toHaveLength(1); // inputs are never mutated
  });
  it('rejects bad spans, repeated IDs, self links and duplicate links', () => {
    const seed = seedOnly();
    expect(() => addPassage(seed, corpus, { id: 'x', spans: [{ from: 'MAT.13:44:0', to: 'MAT.13:99:99' }], link: { id: 'l', fromId: 'p-mat', note: NOTE } })).toThrow('not in this corpus');
    expect(() => addPassage(seed, corpus, { id: 'x', spans: [{ from: 'MAT.13:44:5', to: 'MAT.13:44:2' }], link: { id: 'l', fromId: 'p-mat', note: NOTE } })).toThrow('before it starts');
    expect(() => addPassage(seed, corpus, { id: 'x', spans: [], link: { id: 'l', fromId: 'p-mat', note: NOTE } })).toThrow('span');
    expect(() => addPassage(seed, corpus, { id: 'p-mat', spans: MARK.spans, link: { id: 'l', fromId: 'p-mat', note: NOTE } })).toThrow('already in use');
    expect(() => addPassage(seed, corpus, { id: 'x', spans: [MATTHEW.spans[0], MATTHEW.spans[0]], link: { id: 'l', fromId: 'p-mat', note: NOTE } })).toThrow('overlap');
    const mixed = [spanFromVerses(corpus, 'GEN.1', 1, 1), spanFromVerses(corpus, 'MAT.1', 1, 1)];
    expect(() => addPassage(seed, corpus, { id: 'x', spans: mixed, link: { id: 'l', fromId: 'p-mat', note: NOTE } })).toThrow('mix');
    const two = withMark(seed);
    expect(() => addLink(two, { id: 'l-2', fromId: 'p-mat', toId: 'p-mat', note: NOTE })).toThrow('itself');
    expect(() => addLink(two, { id: 'l-2', fromId: 'p-mat', toId: 'p-mrk', note: NOTE })).toThrow('already linked');
    expect(addLink(two, { id: 'l-2', fromId: 'p-mrk', toId: 'p-mat', note: 'and back' }).links).toHaveLength(2);
  });
  it('gives Hebrew passages the Hebrew/Aramaic language', () => {
    const state = addPassage(initialLinkedState(corpus), corpus, { id: 'g', spans: [spanFromVerses(corpus, 'GEN.1', 1, 1)] });
    expect(state.passages[0]).toMatchObject({ label: 'Genesis 1:1', language: 'he' });
  });
});

describe('daily target', () => {
  it('is 5 with one passage and 10 with two on day 1', () => {
    expect(dailyTarget(seedOnly(), corpus, day(0))).toBe(5);
    expect(dailyTarget(withMark(), corpus, day(0))).toBe(10);
    expect(dailyTarget(initialLinkedState(corpus), corpus, day(0))).toBe(0);
  });
  it('stops offering additions once the day is full, without adding anything on its own', () => {
    let state = withMark();
    expect(state.ledger).toEqual([]); // nothing happens on load
    state = add(state, day(0)).state;
    state = add(state, day(0)).state;
    const plan = planAddition(state, corpus, day(0));
    expect(plan).toMatchObject({ canAdd: false, reason: 'target-reached', todayCount: 10, target: 10 });
    expect(addWords(state, corpus, plan.eventId, day(0))).toMatchObject({ status: 'refused', reason: 'target-reached' });
    expect(state.coverage).toHaveLength(10);
  });
  it('excludes held, queued and completed passages, and caps at 250 with 50 slots', () => {
    const chapters = corpus.chapters.filter(c => ['MAT', 'MRK', 'LUK', 'JHN'].includes(c.bookId)).slice(0, 51);
    let state = initialLinkedState(corpus);
    chapters.forEach((c, i) => {
      state = addPassage(state, corpus, { id: `p${i}`, spans: [spanFromVerses(corpus, c.id, 1, 1)], now: day(0), link: i ? { id: `l${i}`, fromId: `p${i - 1}`, note: 'next' } : undefined });
    });
    expect(state.passages.filter(p => p.status === 'active')).toHaveLength(50);
    expect(state.passages[50].status).toBe('queued');
    expect(dailyTarget(state, corpus, day(0))).toBe(250);
    expect(dailyTarget(holdPassage(state, 'p3'), corpus, day(0))).toBe(245);
    expect(() => completePassage(state, corpus, 'p0')).toThrow('every word');
    // Introduce the seed in full across several days; the queued passage never takes part until a slot frees.
    for (let d = 0; passageProgress(state, corpus, state.passages[0]).fullyIntroduced === false; d++) state = fillDay(state, day(d));
    expect(state.ledger.every(e => e.segments.every(s => s.passageId !== 'p50'))).toBe(true);
    const done = completePassage(state, corpus, 'p0');
    expect(done.passages[0].status).toBe('completed');
    expect(done.passages[50].status).toBe('active'); // promoted into the freed slot
  });
});

describe('adding words', () => {
  it('adds 5 distinct words from one passage at a time, in order, and rotates round-robin', () => {
    let state = withMark();
    const first = add(state, day(0)); state = first.state;
    expect(first.event.segments).toEqual([{ passageId: 'p-mat', tokenIds: tokens(state, 'p-mat').slice(0, 5) }]);
    const second = add(state, day(0)); state = second.state;
    expect(second.event.segments).toEqual([{ passageId: 'p-mrk', tokenIds: tokens(state, 'p-mrk').slice(0, 5) }]);
    expect(state.cursor.lastServedId).toBe('p-mrk');
    expect(planAddition(state, corpus, day(1)).segments[0].passageId).toBe('p-mat'); // cursor survives into the next day
    expect(state.coverage).toHaveLength(10);
  });

  it('ends a 31-word passage on a short final addition and reports the shortfall without inventing words', () => {
    let state = seedOnly();
    const sizes: number[] = [];
    for (let d = 0; d < 7; d++) { const r = add(state, day(d)); state = r.state; sizes.push(r.event.segments.reduce((n, s) => n + s.tokenIds.length, 0)); }
    expect(sizes).toEqual([5, 5, 5, 5, 5, 5, 1]);
    expect(state.ledger[6].shortfall).toBe(4);
    expect(state.coverage).toHaveLength(31);
    expect(passageProgress(state, corpus, state.passages[0])).toEqual({ total: 31, introduced: 31, fullyIntroduced: true });
    // Same day: the day's target is unchanged by finishing, but nothing is left to add.
    expect(planAddition(state, corpus, day(6))).toMatchObject({ target: 5, canAdd: false, reason: 'no-new-words' });
    // Next day: no active passage has unintroduced words.
    expect(planAddition(state, corpus, day(7))).toMatchObject({ target: 0, canAdd: false, reason: 'no-new-words', tokenIds: [] });
    expect(addWords(state, corpus, nextEventId(state), day(7)).status).toBe('refused');
  });

  it('fills the rest of the 5 from the next eligible passage at a passage tail, as separately labeled references', () => {
    let state = withMark();
    for (let d = 0; d < 6; d++) state = fillDay(state, day(d)); // both passages have 30 words introduced; Matthew has 1 left
    expect(state.coverage).toHaveLength(60);
    const plan = planAddition(state, corpus, day(6));
    expect(plan.segments.map(s => [s.label, s.tokenIds.length])).toEqual([['Matthew 13:44', 1], ['Mark 7:1–13', 4]]);
    expect(plan.segments[0].tokenIds).toEqual(['MAT.13:44:30']);
    expect(plan.shortfall).toBe(0);
    state = add(state, day(6)).state;
    expect(state.ledger.at(-1)!.segments).toHaveLength(2);
    expect(state.cursor.lastServedId).toBe('p-mrk');
    expect(state.passages[0] && passageProgress(state, corpus, state.passages[0]).fullyIntroduced).toBe(true);
    // Matthew left the rotation but kept its slot; today still counts it, so the target stays 10 for the rest of day 7.
    expect(state.passages[0].status).toBe('active');
    expect(planAddition(state, corpus, day(6))).toMatchObject({ target: 10, todayCount: 5 });
    state = add(state, day(6)).state;
    expect(state.ledger.at(-1)!.segments).toEqual([{ passageId: 'p-mrk', tokenIds: tokens(state, 'p-mrk').slice(34, 39) }]);
    expect(dailyTarget(state, corpus, day(7))).toBe(5);
  });

  it('counts a word once even when passages overlap', () => {
    // Mark 7:13 sits inside Mark 7:1–13. Whichever passage is served, a token is never introduced twice.
    let state = addPassage(initialLinkedState(corpus), corpus, { id: 'whole', spans: MARK.spans, now: day(0) });
    state = addPassage(state, corpus, { id: 'tail', spans: [spanFromVerses(corpus, 'MRK.7', 13, 13)], now: day(0), link: { id: 'l', fromId: 'whole', note: 'last verse alone' } });
    for (let d = 0; d < 60; d++) state = fillDay(state, day(d));
    const introduced = state.ledger.flatMap(e => e.segments.flatMap(s => s.tokenIds));
    expect(introduced).toHaveLength(222);
    expect(new Set(introduced).size).toBe(222);
    expect(state.coverage).toHaveLength(222);
    expect(state.passages.every(p => passageProgress(state, corpus, p).fullyIntroduced)).toBe(true);
    expect(state.ledger.at(-1)!.shortfall).toBeGreaterThan(0); // the last event came up short
  });

  it('takes only uncovered words from a passage added after overlapping words were already introduced', () => {
    let state = seedOnly();
    state = addPassage(state, corpus, { ...MARK, now: day(0), link: { id: 'l', fromId: 'p-mat', note: NOTE } });
    for (let d = 0; d < 20; d++) state = fillDay(state, day(d));
    const overlap = addPassage(state, corpus, { id: 'p-mrk5', spans: [spanFromVerses(corpus, 'MRK.7', 5, 13)], now: day(20), link: { id: 'l2', fromId: 'p-mrk', note: 'same scene, later verses' } });
    const covered = new Set(overlap.coverage);
    const progress = passageProgress(overlap, corpus, overlap.passages[2]);
    expect(progress.introduced).toBeGreaterThan(0);
    expect(progress.introduced).toBeLessThan(progress.total);
    const plan = planAddition(overlap, corpus, day(20));
    expect(plan.tokenIds.every(id => !covered.has(id))).toBe(true);
    expect(new Set(plan.tokenIds).size).toBe(plan.tokenIds.length);
  });

  it('is idempotent: a double-click or retry with the same event ID counts once', () => {
    const state = withMark();
    const eventId = planAddition(state, corpus, day(0)).eventId;
    const once = addWords(state, corpus, eventId, day(0));
    const twice = addWords(once.state, corpus, eventId, day(0));
    const thrice = addWords(twice.state, corpus, eventId, day(1));
    expect(once.status).toBe('added');
    expect(twice.status).toBe('duplicate');
    expect(thrice.status).toBe('duplicate');
    expect(thrice.state).toBe(once.state);
    expect(once.state.coverage).toHaveLength(5);
    expect(once.state.ledger).toHaveLength(1);
    expect(addWords(once.state, corpus, 'made-up', day(0))).toMatchObject({ status: 'refused', reason: 'stale-event' });
  });

  it('rolls the day over by the stored time zone, with no catch-up debt', () => {
    let state = seedOnly();
    const lateEvening = new Date('2026-10-04T04:30:00Z'); // 11:30 pm, Oct 3, Chicago (still Oct 4 in UTC)
    state = add(state, lateEvening).state;
    expect(state.ledger[0]).toMatchObject({ date: '2026-10-03', timeZone: 'America/Chicago' });
    expect(planAddition(state, corpus, new Date('2026-10-04T04:59:00Z'))).toMatchObject({ canAdd: false, reason: 'target-reached' }); // 11:59 pm
    const after = planAddition(state, corpus, new Date('2026-10-04T05:00:00Z')); // midnight in Chicago
    expect(after).toMatchObject({ canAdd: true, date: '2026-10-04', todayCount: 0, target: 5, wanted: 5 });
    expect(wordsAddedOn(state, '2026-10-03')).toBe(5);
    // Three days of silence do not become a debt: the target is still 5.
    expect(planAddition(state, corpus, new Date('2026-10-08T15:00:00Z'))).toMatchObject({ target: 5, wanted: 5, todayCount: 0 });
    // The time zone is a stored setting. The same instant is a different date elsewhere.
    expect(planAddition(setTimeZone(seedOnly(), 'Pacific/Auckland'), corpus, lateEvening).date).toBe('2026-10-04');
    expect(() => setTimeZone(state, 'Mars/Olympus')).toThrow('time zone');
    expect(state.settings.timeZone).toBe('America/Chicago');
  });
});

describe('undo', () => {
  it('restores the whole last event, including a two-passage tail fill and the cursor', () => {
    let state = withMark();
    for (let d = 0; d < 6; d++) state = fillDay(state, day(d));
    const before = structuredClone(state);
    const added = add(state, day(6));
    expect(added.event.segments).toHaveLength(2);
    const undone = undoLastAddition(added.state, added.event.id);
    expect(undone.status).toBe('undone');
    expect(undone.state.coverage).toEqual(before.coverage);
    expect(undone.state.ledger).toEqual(before.ledger);
    expect(undone.state.cursor).toEqual(before.cursor);
    expect(wordsAddedOn(undone.state, '2026-10-11')).toBe(0);
    expect(planAddition(undone.state, corpus, day(6)).segments).toEqual(planAddition(before, corpus, day(6)).segments);
  });
  it('undoes once on a double-click, refuses a stale retry of the undone event, and never reuses an event ID', () => {
    const added = add(withMark(), day(0));
    const undone = undoLastAddition(added.state, added.event.id);
    expect(undoLastAddition(undone.state, added.event.id).status).toBe('nothing');
    expect(undoLastAddition(added.state, 'e99').status).toBe('stale');
    expect(addWords(undone.state, corpus, added.event.id, day(0))).toMatchObject({ status: 'refused', reason: 'stale-event' });
    expect(add(undone.state, day(0)).event.id).toBe('e2');
    expect(undoLastAddition(withMark()).status).toBe('nothing');
  });
  it('refuses to undo into a completed passage', () => {
    let state = seedOnly();
    for (let d = 0; d < 7; d++) state = add(state, day(d)).state;
    state = completePassage(state, corpus, 'p-mat');
    expect(undoLastAddition(state).status).toBe('passage-completed');
    expect(state.coverage).toHaveLength(31);
  });
});

describe('hold, resume, complete', () => {
  it('keeps a held passage in its slot but out of the rotation and target', () => {
    let state = holdPassage(withMark(), 'p-mat');
    expect(dailyTarget(state, corpus, day(0))).toBe(5);
    expect(add(state, day(0)).event.segments[0].passageId).toBe('p-mrk');
    state = resumePassage(state, 'p-mat');
    expect(state.passages[0].status).toBe('active');
    expect(() => resumePassage(state, 'p-mat')).toThrow('held');
    expect(() => holdPassage(state, 'nobody')).toThrow('learning');
  });
});
