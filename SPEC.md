# Linked Memory — product spec (draft 1)

Working name. A private, static web app for memorizing original-language Scripture (Hebrew, Aramaic, Greek) five words at a time across a queue of passages the user builds by linking one passage to the next. Derived from Bible Memory and Heiser Memory; built and maintained entirely in the cloud (GitHub + Claude Code on the web + a static host).

## Decisions made

| Topic | Decision |
|---|---|
| Increment | **5 words** per addition, taken from one passage (passage tail rule below) |
| Daily target | **Scales with active passages**: `5 × active passages`, capped at **250** (50 passages). 3 passages = 15 words/day. |
| Queue building | User starts with one seed passage, then adds a **link** to a next passage with a **note** saying why they connect. Chain/graph grows from there. |
| Links | User-chosen, with a user-written note. Suggested links from cross-reference data are a later, optional feature (license must be verified first). |
| Review | Voluntary only. No schedule, due dates, grades, or spaced repetition. All passages stay in the library. |
| Confirmation | Words are introduced only when the user presses **Add 5 words**. Opening the app or passing midnight never adds words. |
| Sync | Manual JSON backup/import, as in the existing apps. No accounts, no server-side progress. |
| Text and aids | Reuse the Bible Memory corpus (UXLC 2.5, SBLGNT 1.2) and reading aids (gloss, transliteration, stress, grammar) unchanged. |

## Core concepts

- **Passage**: ordered token span(s) in the corpus, plus label, language, optional note. Immutable ID.
- **Link**: directed edge `from -> to` with a required note. Every passage except the seed has at least one incoming link (the one that added it).
- **Queue**: passages added but not yet active. Order = order added (user can reorder).
- **Active slots**: up to 50 passages being learned. When fewer than 50 passages exist, all are active.
- **Introduced coverage**: global set of token IDs ever introduced, so overlaps and re-reading never count as new words.
- **Daily ledger**: one event per addition (event ID, date, passage, token IDs, timestamp). Idempotent on double-click/retry.

## Behavior

1. **First run**: choose a seed passage (book/chapter/verse range picker against the corpus). Starts at zero introduced words.
2. **Today screen**: shows new words today, today's target, and the next active passage. Reveal shows the introduced prefix with aids; a clearly marked preview shows the next 5 words.
3. **Add 5 words**: atomic save of endpoint, coverage, ledger, and cursor. Preview, reveal, skip, and navigation never add words.
4. **Rotation**: persistent round-robin cursor across active slots; survives reloads and days.
5. **Passage tail**: if fewer than 5 words remain, finish the passage and fill the rest of the 5 from the next eligible passage, shown as two separately labeled references.
6. **Target reached**: stop offering additions for the day; browsing and review remain available.
7. **Fully introduced vs. completed**: separate states. The user marks **Completed** manually; completing a passage frees its slot for the next queued passage.
8. **Link flow**: from any passage, "Link a next passage" opens the picker, requires a note, and adds the new passage to the queue (or an active slot if one is free). A passage with no outgoing link is flagged "end of chain" so the user knows to extend it.
9. **Hold/Resume** a passage without penalty.
10. **Queue exhaustion**: if fewer than 5 eligible new words exist, report the shortfall; never invent words. Prompt the user to link another passage.
11. **Undo** last addition restores the whole event.
12. **Timezone**: stored preference, default America/Chicago. No catch-up debt after missed days.

## Library and graph view

- Filters: All, Learning, Fully introduced, Completed, Queued, Held. Search by reference, note text.
- Chain view: passages as a list/tree showing each link and its note.
- Library review never moves the cursor or counts toward today's total.

## Data model (changes from Heiser Memory)

- Replace `catalog.json` (fixed catalog) with **user-owned passage and link records** stored in the notebook and included in backups.
- `Passage { id, label, spans, language, createdAt, status }`
- `Link { id, fromId, toId, note, createdAt }`
- Backup format: new app identity string, new DB name, cache prefix, manifest ID, so old backups are rejected cleanly.
- Overlaps: partial overlaps contribute only uncovered words; older passage cards and endpoints are never silently merged.

## Out of scope for v1

Suggested links from cross-reference data, nonbiblical texts, multi-device sync, review scheduling, accounts.

## Build plan (small PRs, each tested)

1. Seed repo from Bible Memory data and tooling; `CLAUDE.md`; CI runs `npm test` and `npm run build`.
2. Model: passages, links, coverage, ledger, scaling target (pure functions + vitest).
3. Storage and backup/import with validation.
4. Seed-passage picker and Today screen.
5. Link flow and queue; promotion on completion.
6. Library and chain view.
7. Offline cache, mobile polish, phone check on a real device.

## Open items

- Name of the app.
- Hosting choice (Cloudflare Pages / Netlify / GitHub Pages / keep ChatGPT Sites).
- Whether a passage may link to multiple next passages (branching) or strictly one next (a chain). Spec above allows branching; v1 UI can show a single "next".
