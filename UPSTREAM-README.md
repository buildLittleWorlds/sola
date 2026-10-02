# Bible Memory

A personal app for growing a memorized passage in every chapter of the Hebrew/Aramaic Old Testament and Greek New Testament. All 66 books, fonts, and licenses are bundled. Review does not call an external service.

## Open the app

The same app is published privately at **https://bible-memory-originals-dplate.profplate.chatgpt.site** from the deployment checkout in `bible-memory-originals/`. It includes all the Hebrew/Aramaic and Greek texts automatically; no copying, pasting, or passage API is involved. The original circuit and backup format are unchanged.

On iPhone, open the hosted address in Safari and choose **Share → Add to Home Screen**. On Android, use **Chrome → Install app / Add to Home screen**. Sign in to the private host if prompted, then wait for **All 66 books available offline**. Real-device installation and private-host session expiry are separate from the automated local offline tests.

To continue computer progress on your phone, export a backup from this local app, transfer the JSON file privately, and import it in the phone app after installing. The local address and hosted address have separate browser storage; they do not synchronize automatically. A home-screen installation may also have separate storage from its browser tab. Import into the context you intend to keep using, and retain your backup.

Double-click **Start Bible Memory.command**, or run:

```sh
cd '/Users/familyplate/Documents/ChatGPT/BIble MEM'
npm start
```

Open **http://127.0.0.1:4173**. Use this exact address and the same browser each time: `localhost`, a different port, and a different browser each have their own progress storage. If the server is already running, just open the address.

Dependencies and the production build are prepared on this computer. For a fresh checkout, use Node.js 22.13 or later, then run `npm ci` and `npm run build` before starting. macOS's launcher opens the browser after the server starts. Keep its terminal open while serving; Ctrl+C stops the server.

The first production visit caches all books. Wait for **All 66 books available offline**. Afterward this browser can reopen the app offline, including when the local server is stopped, provided its site cache has not been cleared. The local server is always a reliable way to reopen it. There is no account or cloud sync.

## Your review rhythm

Revealing now shows each original word with a syllabified reading guide and a short literal meaning. **Bold** syllables mark supported stress. Tap the original word to inspect its components, dictionary form, grammar, and sources. Full-chapter mode still uses tapping to set your stopping point.

Under **Settings & backup → Reading aids on Reveal**, you can independently hide meanings, Hebrew transliteration, or Greek transliteration. Older backups default these switches to on. The Hebrew guide uses classroom spellings and the selected **YAH-weh** reading convention. Explicit “Stress unconfirmed,” “Pronunciation unconfirmed,” and “Meaning needs review” notices distinguish unresolved cases. A source-aligned gloss is an imported scholarly annotation, not a claim that an individual human checked that word in this app.

All aids are included in the app's offline cache. They are not copied into your progress backups. The original corpus fingerprint, chapter order, token keys, and endpoint format have not changed.

1. The chapter reference appears with the passage hidden. Recite what you know.
2. Press **Space** to reveal the passage; press it again to hide it.
3. Press **N** for the next chapter, or **P** for the previous one.
4. Choose **Add 3 words** when ready. This changes only this chapter's endpoint and highlights the addition. Adjust the default increment in Settings & backup.
5. Use **− / +** for single-word adjustments, or **View full chapter** and click a word to set your endpoint. A target never extends into another chapter.

All chapters start with three words. Targets indicate what you are practicing, not a claim of mastery. Advancing records a visit even if you didn't reveal the text. Going backward does not undo visits. There is no compulsory grading.

The circuit visits 3–4 OT chapters, then 1 NT chapter, preserving each Testament's Protestant book order. A full circuit visits all 1,189 chapters once. Returning to the beginning increments the circuit number without extending any passages. Previous can move back across completed circuit boundaries; it is disabled at the very beginning.

**Chapter library** opens independent practice. Search `John 3`, `Genesis`, or a source book ID. Browsing and advancing there record visits but don't move the circuit. **Resume circuit** returns to the saved place. Browsing selection and reveal state are intentionally temporary; reopening returns to the circuit with text hidden.

## Saved progress and backups

To deliberately restart the review order, use **Settings & backup → Restart at Genesis 1**, or open the site's `/restart.html` page in the same browser where you practice. The page shows your saved place first. Press **Restart at Genesis 1**, wait for **Saved**, then choose **Continue at Genesis 1**. It keeps all targets, settings, and visit history. If another Bible Memory tab is open, close that other tab and retry so it cannot overwrite your new place. Opening the restart page alone makes no changes. The earlier calendar-triggered startup reset has been retired.

Progress is stored in IndexedDB, immediately after changes. Wait for **Progress saved on this device** before closing. One active tab holds a browser lock to prevent another tab from overwriting progress. If another tab is open, close it before taking over in the new tab.

Use **Settings & backup → Export backup** regularly and before clearing browser data, switching browsers, or moving computers. Backups include every chapter endpoint, visit history, circuit position, and display settings. They don't contain the Bible text. Import validates the exact corpus fingerprint and endpoint IDs, presents a preview, then replaces progress only when you select **Replace with this backup**. A mismatched edition, missing chapter, invalid endpoint, or malformed file is rejected without changing progress.

If storage fails, the app retains the latest changes in memory, shows an explicit unsaved warning, and provides **Retry save** and **Export current progress**. Export before closing. If existing stored data cannot be loaded or belongs to a different corpus, startup stops instead of overwriting it.

## Text editions and boundaries

- **UXLC 2.5, build 27.6 (April 2026):** Unicode/XML Leningrad Codex from [Tanach.us](https://www.tanach.us/). Its biblical Hebrew text may be viewed or copied without restriction. This is UXLC, not WLC. Source archive SHA-256: `1bc6e006f43d3b18f2f718cefa3aa4774cac2c54092c28d173dd61996c43a050`.
- **SBLGNT 1.2:** [Faithlife/SBLGNT](https://github.com/Faithlife/SBLGNT), fixed commit `c4d241a9c1c479a55b989ba35a4976c1d0b8052c`. Edited by Michael W. Holmes. Copyright 2010 Society of Biblical Literature and Logos Bible Software; Creative Commons Attribution 4.0 International. Biblical words, punctuation, and editorial marks are preserved; the app reorganizes the XML for interactive display.
- **Fonts:** Noto Serif Hebrew and Gentium Plus, locally bundled under the SIL Open Font License. License files are in `public/fonts/`; text terms are in `public/licenses/` and accessible in the app's **Texts & sources** dialog.

Source numbering is retained, including Hebrew Joel 1–4 and Malachi 1–3. Hebrew verse numbering can differ from English Bibles, notably in Psalms. The total remains 929 OT and 260 NT chapters. Greek verse gaps remain as they are in this edition; no words are added from another edition. The chosen Greek revision includes John 7:53–8:11 and Mark 16:9–20 with its editorial markings.

Each Hebrew `w` or `q` element and Greek `w` element counts as one recall word. Maqaf-linked Hebrew words remain separate steps according to those source boundaries. Combining marks never create extra words. Greek prefix/suffix punctuation, Hebrew paragraph markers and inverted nuns are retained without increasing word counts. Transcription note codes are separate from the Bible text. Special-letter annotations remain inspectable in full-chapter mode and in the original archive.

Qere (read) is the recall stream; ketiv (written) is retained for inspection. Groups can contain different numbers of read and written words. Words written but not read appear only in the variants section; words read but not written appear in recall with their empty written form identified. Original Aramaic passages are preserved. Cantillation hiding is a display option; the stored source is unchanged. Vowels, meteg/siluq, and punctuation remain visible.

## Development and verification

```sh
npm run import:corpus   # Offline rebuild and source coverage assertions
npm run aids:build      # Offline build from retained, pinned aid source files
npm test               # Corpus, circuit, backup and transaction tests
npm run build          # TypeScript, production app and full offline cache manifest
node scripts/prepare-phone-site.mjs # Verified static copy for private phone hosting
npx playwright install chromium  # One-time browser test setup
npm run test:e2e        # Browser acceptance tests; starts server if needed
```

`npm run dev` runs the development server at the same address; stop the production server first. Production service workers deliberately keep a coherent cached version. For development, use a separate browser profile with no existing service worker. After rebuilding production, close all app tabs and reopen twice if an older worker is still waiting to hand over. Never clear IndexedDB to update the app. Text source changes require an explicit migration, not an automatic replacement.

The Python importer uses only the standard library. It reads retained archives in `sources/`, validates the Hebrew archive hash, checks every source reading word against the imported sequence, preserves Greek punctuation, verifies chapter/verse inventory, and writes per-book JSON plus an index with stable token keys and a content hash. It does not access the network. Both raw archives and the generated corpus are included so future review is reproducible.

Reading-aid sources are separately retained under `sources/aids/`. `scripts/build-hebrew-aids.mjs` uses the pinned build-only hebrew-transliteration and havarotjs packages. `scripts/build-greek-aids.py` uses a vendored MIT-licensed greek-accentuation library. `scripts/package-aids.mjs` independently verifies every source token, packages applicable notices, and writes public provenance/coverage files. Run `python3 scripts/greek-aids/test_greek_aids.py` for the Greek engine's golden tests. Source file hashes and revisions prevent silent text or annotation upgrades.

Application code is in `src/`. `model.ts` owns pure circuit/endpoint/backup behavior, `storage.ts` owns atomic IndexedDB operations, and `App.tsx` owns the review and library interface. `scripts/build-sw.mjs` generates a versioned offline cache from the exact production build; it caches all files before activation and avoids switching an active tab to a new version.

The server binds only to `127.0.0.1:4173`. No hosting, analytics, AI, external fonts, translation service, or subscription is required. Outbound links in **Texts & sources** open the original publishers only when selected.
