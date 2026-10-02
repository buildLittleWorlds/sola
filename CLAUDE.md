# CLAUDE.md — Linked Memory

Private static web app for memorizing Hebrew/Aramaic/Greek Scripture 5 words at a time across a user-built, linked queue of passages. Read `SPEC.md` before making changes.

## Stack
React 19, TypeScript, Vite, vitest, Playwright. Node 22.13+. No backend, no runtime AI, no analytics.

## Commands
- `npm ci` — install
- `npm test` — unit tests (must pass before every push)
- `npm run build` — typecheck, production build, offline cache manifest (must pass before every push)
- `npm run test:e2e` — browser tests

## Hard rules
- **Never modify the biblical corpus** (`public/corpus/`) or token IDs. Text changes need an explicit migration and a new corpus hash.
- Reading aids (`public/aids/`) are separate from progress. Pronunciation/gloss fixes go through `sources/aids/**/reviewed-overrides.json` and are logged in `PRONUNCIATION-CORRECTIONS.md` with evidence. Never hand-edit generated aid JSON.
- Words are introduced **only** on explicit user confirmation. Nothing happens on load, reload, or date change.
- Count new words by distinct token IDs, never by button presses. Re-reading or overlapping passages never count twice.
- Additions are atomic (endpoint + coverage + ledger + cursor in one transaction) and idempotent.
- Do not add review schedules, due dates, grades, or spaced repetition.
- Daily target = 5 × active passages, capped at 250.
- Do not clear IndexedDB to update a build. Backups must round-trip; bad imports must fail without changing existing data.
- Use this app's own DB name, cache prefix, manifest ID, and backup format identity. Never reuse Bible Memory or Heiser Memory identifiers.
- Do not commit `node_modules/`, `dist/`, secrets, or tokens.

## Working style
- Small PRs, one concern each, with tests. Describe what was verified and what was not (e.g., real-phone storage and offline behavior cannot be verified in the cloud sandbox).
- Report failing tests plainly; do not mark work done if checks fail.
- Aid-rebuild scripts need network access to upstream sources; only run them when intentionally fixing aids.
