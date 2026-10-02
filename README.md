# Sola

Private static web app for memorizing Hebrew/Aramaic/Greek Scripture five words at a time across a user-built, linked queue of passages.

- `SPEC.md` — what we are building
- `CLAUDE.md` — standing rules for Claude sessions
- `UPSTREAM-README.md` — documentation of the Bible Memory baseline this started from (corpus, aids, build, tests). Parts describe features that will be replaced.

Status: baseline imported from Bible Memory; identifiers renamed to Sola, behavior not yet adapted.

## Identity (kept separate from Bible Memory and Heiser Memory)

| What | Value |
|---|---|
| App name / manifest name | `Sola` / `Sola — Hebrew & Greek` |
| Manifest id, scope | `/sola/` |
| IndexedDB name | `sola` |
| Service-worker cache prefix | `sola-` (the worker deletes only caches with this prefix) |
| Cross-tab write lock | `sola-writer` |
| Backup format | `sola-backup` (Bible Memory and Heiser Memory backups are rejected) |

Progress saved by an earlier build under the old `bible-memory` database is not read or migrated.

