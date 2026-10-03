# Linked Memory — product spec (draft 2)

Working name. A private, static web app for memorizing original-language Scripture (Hebrew, Aramaic, Greek) five words at a time across a queue of passages the user builds by linking one passage to the next. Derived from Bible Memory and Heiser Memory; built and maintained entirely in the cloud (GitHub + Claude Code on the web + a static host).

## Decisions made

| Topic | Decision |
|---|---|
| Increment | **5 words** per addition, taken from one passage (passage tail rule below) |
| Daily target | **Scales with active passages**: `5 × active passages that still have unintroduced words`, capped at **250** (50 passages). 3 such passages = 15 words/day. A passage finished earlier today still counts for today, so finishing it never shrinks the target mid-day. |
| Queue building | User starts with one seed passage, then adds a **link** to a next passage with a **note** saying why they connect. Chain/graph grows from there. |
| Links | User-chosen, with a user-written note. Suggested links from cross-reference data are a later, optional feature (license must be verified first). |
| Review | Voluntary only. No schedule, due dates, grades, or spaced repetition. All passages stay in the library. |
| Confirmation | Words are introduced only when the user presses **Add 5 words**. Opening the app or passing midnight never adds words. |
| Sync | Manual JSON backup/import, as in the existing apps. No accounts, no server-side progress. |
| Text and aids | Reuse the Bible Memory corpus (UXLC 2.5, SBLGNT 1.2) and reading aids (gloss, transliteration, stress, grammar) unchanged. |

## Core concepts

- **Passage**: ordered token span(s) in the corpus, plus label, language, status. Immutable ID. A span is an inclusive run `{ from, to }` of corpus token IDs inside one chapter. A passage's spans are in corpus order, do not overlap, and are all Hebrew/Aramaic or all Greek. Language is derived from the text, never typed in.
- **Token ID**: `<chapterId>:<verse>:<sourceIndex>`, e.g. `MAT.13:44:0` (the corpus `tokenKeys` prefixed by the chapter). Never changes; the corpus is never edited.
- **Link**: directed edge `from -> to` with a required note. Every passage except the seed has at least one incoming link (the one that added it).
- **Queue**: passages added but not yet active. Order = order added (reordering is a later UI PR).
- **Active slots**: up to 50 passages hold a slot, status `active` or `held`. A passage keeps its slot until the user marks it Completed; being fully introduced does not free it. A fully introduced passage leaves the rotation (it has nothing left to add) but keeps the slot. Completing a passage promotes the first queued passage into the slot. A passage is queued only while all 50 slots are used.
- **Introduced coverage**: global set of token IDs ever introduced, so overlaps and re-reading never count as new words.
- **Daily ledger**: one event per addition (event ID, local date and time zone, timestamp, one segment per contributing passage with its token IDs, shortfall, cursor before). Idempotent on double-click/retry. Coverage always equals the union of the ledger's tokens.
- **Cursor**: the passage that supplied the last words. The next turn goes to the next eligible passage after it in slot order, wrapping around. Survives reloads and days.
- **Settings**: increment 5, daily cap 250, time zone (default America/Chicago).

## Behavior

1. **First run**: choose a seed passage (book/chapter/verse range picker against the corpus). Starts at zero introduced words.
2. **Today screen**: shows new words today, today's target, and the next active passage. Reveal shows the introduced prefix with aids; a clearly marked preview shows the next 5 words.
3. **Add 5 words**: atomic save of coverage, ledger, and cursor in one write. Preview, reveal, skip, and navigation never add words. It takes the first uncovered words of the passage whose turn it is, in span order. Event IDs are `e<seq>` from a monotonic counter; the UI sends the ID of the plan it showed. An ID already in the ledger changes nothing (double-click, retry, second tab); an ID that is neither already applied nor the next one (for example a retry after Undo) is refused. The count is capped at the day's remaining target.
4. **Rotation**: persistent round-robin cursor across active slots; survives reloads and days.
5. **Passage tail**: if fewer than 5 uncovered words remain in the passage, finish it and fill the rest of the 5 from the next eligible passage, shown as separately labeled references (the cursor then moves past the last contributor). A word already covered, or already taken earlier in the same addition, is never taken again, so overlapping passages cannot double count.
6. **Target reached**: stop offering additions for the day; browsing and review remain available.
7. **Fully introduced vs. completed**: separate states. The user marks **Completed** manually; completing a passage frees its slot for the next queued passage.
8. **Link flow**: from any passage, "Link a next passage" opens the picker, requires a note, and adds the new passage to the queue (or an active slot if one is free). A passage with no outgoing link is flagged "end of chain" so the user knows to extend it.
9. **Hold/Resume** a passage without penalty.
10. **Queue exhaustion**: if fewer than 5 eligible new words exist, add what exists, report the shortfall, and never invent words. With none left, the addition is refused with reason `no-new-words`; prompt the user to link another passage. (Example: a lone 31-word passage ends on a 1-word addition with shortfall 4.)
11. **Undo** last addition restores the whole event: its words leave coverage, its ledger event is removed, the cursor goes back. The event counter is not rewound. Undo is refused if a passage the event touched has since been Completed.
12. **Timezone**: stored preference, default America/Chicago. The day rolls over at local midnight in that zone; a new day starts at zero with the same target, so missed days create no catch-up debt. Each ledger event records its local date and zone when added and is never re-dated; changing the zone changes which events count as "today" from then on.
13. **Completing** requires the passage to be fully introduced. **Hold** keeps the slot but takes the passage out of the rotation and the target; **Resume** puts it back.

## Library and graph view

- Filters: All, Learning, Fully introduced, Completed, Queued, Held. Search by reference, note text.
- Chain view: passages as a list/tree showing each link and its note.
- Library review never moves the cursor or counts toward today's total.

## Data model (changes from Heiser Memory)

- Replace `catalog.json` (fixed catalog) with **user-owned passage and link records** stored in the notebook and included in backups.
- `Passage { id, label, spans, language, createdAt, status }`
- `Link { id, fromId, toId, note, createdAt }`
- Storage: its own IndexedDB database `sola-linked` (store `state`, key `linked-state`), separate from the circuit-era `sola` database, so existing circuit progress is never opened, migrated or cleared. The whole state is one record, so each change is one atomic write; updates are read-validate-modify-validate-write in one transaction.
- Backup format: `{ format: 'sola-linked-backup', version: 1, exportedAt, state }`. Bible Memory, Heiser Memory and circuit-era `sola-backup` files are rejected cleanly. Import validates app identity, corpus ID and hash, spans (real tokens, one chapter, ordered, one language), statuses and slot limits, link integrity (endpoints exist, note non-empty, no self or duplicate links, every passage reachable from the seed so each has an incoming link), and ledger integrity (event IDs, date matches instant and zone, tokens belong to their segment's passage and are introduced once, cursor chain, coverage equals the ledger's tokens, completed passages fully introduced). A bad file fails before storage is touched.
- Overlaps: partial overlaps contribute only uncovered words; older passage cards and endpoints are never silently merged.

## Out of scope for v1

Suggested links from cross-reference data, nonbiblical texts, multi-device sync, review scheduling, accounts.

## Build plan (small PRs, each tested)

1. Seed repo from Bible Memory data and tooling; `CLAUDE.md`; CI runs `npm test` and `npm run build`.
2. ~~Model: passages, links, coverage, ledger, scaling target (pure functions + vitest).~~ Done: `src/linked-model.ts`.
3. ~~Storage and backup/import with validation.~~ Done: `src/linked-storage.ts`, `src/linked-validate.ts`. The circuit UI still runs on the old model until a later PR replaces it.
4. Seed-passage picker and Today screen.
5. Link flow and queue; promotion on completion.
6. Library and chain view.
7. Offline cache, mobile polish, phone check on a real device.

## Open items

- Name of the app.
- Hosting choice (Cloudflare Pages / Netlify / GitHub Pages / keep ChatGPT Sites).
- Whether a passage may link to multiple next passages (branching) or strictly one next (a chain). The model allows branching (one link per ordered pair of passages); v1 UI can show a single "next".
- Maximum JSON size accepted on import is 25 MB; coverage and ledger both list token IDs, so revisit if a real backup nears it.
