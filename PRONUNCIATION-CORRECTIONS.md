# Pronunciation correction log

Started September 26, 2026. Collect discoveries during practice and implement evidence-supported corrections in a weekly batch. This log concerns the original-language Bible Memory app, not the ESV app.

## Workflow

Record the reference, exact pointed word, current aid, proposed correction, evidence, and status. Separate genuine reading errors from choices among pronunciation traditions. Use statuses: collecting, ready, needs convention decision, implemented locally, verified published.

At each weekly review:

1. Reopen current source and generated aids; verify each reported issue still exists.
2. Check the evidence and the app's documented classroom pronunciation convention. Do not infer a global historical or modern pronunciation policy from one example.
3. Implement ready corrections in the generator or a documented override mechanism that survives regeneration. Check equivalent grammatical forms, with counterexamples; do not blindly replace letter sequences across the corpus.
4. Run focused regression checks, the existing aid packaging/alignment checks, and the production build as appropriate. Preserve the biblical corpus, token IDs, and stored practice progress.
5. Record exactly what changed and what passed. Keep local implementation and verified hosted publication separate. Prepare a release summary; publish only within explicit release authorization.

If no items are ready, leave the queue intact. Questions about reading tradition remain questions rather than automatic substitutions.

## HEB-001 — Silent yod in the third-person masculine singular suffix

- Found: September 26, 2026, while practicing Genesis 29:1.
- Word: רַגְלָ֑יו, “his feet.”
- Exact aid key: `GEN.29/1:2` (zero-based sourceIndex 2).
- Current local artifact: `public/aids/GEN.json` → `chapters["GEN.29"]["1:2"]`.
- Observed aid: syllables `["rag", "layw"]`; no marked stress; `pronunciation-unconfirmed`; note “Generated reading; not yet corroborated.”
- Correction: the י in this suffix is not a separate pronounced /y/. Remove the spurious y; stress belongs on the final syllable (the source has atnah under לָ).
- Simplified reading: `rag-LAW` if retaining w; `rag-LAV` if the chosen classroom convention uses v. These are classroom approximations, not full Tiberian phonetic transcriptions.
- Status: **ready** for the silent-yod and stress correction; determine the suffix's w/v rendering consistently with HEB-002 before finalizing the displayed aid.
- Scope to investigate: equivalent ־ָיו possessive endings, including prefixed forms. Do not delete yod generally or change actual /ay/ sequences.
- Implementation starting point: `scripts/build-hebrew-aids.mjs`, its `sblSimple` schema and generated syllable/source-agreement processing. Check `scripts/hebrew-aids/finalize.mjs` and packaging so a correction survives a full rebuild.
- Evidence: [Genesis 29:1 text and raḡ-lāw transliteration](https://biblehub.com/text/genesis/29-1.htm); [medieval descriptions and analogous אֵלָיו ending](https://www.tiberianhebrew.com/vav).
- Validation/publication: not implemented; hosted state not rechecked for this log.

## HEB-002 — Clarify the w/v pronunciation convention

- Found: same discussion as HEB-001.
- Observation: Genesis 29:1's local aids have final w in `rag-layw` but v in the following `vay-ye-lekh`. This warrants checking the engine's suffix handling; it does not establish that every w in the app is wrong.
- Current UI describes classroom spellings and explicitly says the guide is not a reconstruction of ancient speech.
- Evidence distinction: ancient Hebrew consonantal ו is reconstructed as /w/; medieval Tiberian sources explicitly describe /v/, including consonantal word-final ו. Modern Israeli classroom pronunciation also uses v. Transliteration letters need not be phonetic instructions.
- Status: **needs convention decision**. Preserve the existing intended convention unless project evidence or Daniel's preference resolves the choice. Do not impose a global w-to-v replacement.
- Sources: [Khan and Kantor, Waw to Vav](https://cambridge.academia.edu/BenjaminKantor/Journal%20Articles); [Tiberian evidence with primary-source translations](https://www.tiberianhebrew.com/vav).
- Validation/publication: not implemented.

## HEB-003 — Genesis 38:1 feminine pronoun: ha-HI, not ha-HIV

- Found: September 26, 2026, during practice and source tracing.
- Word: הַהִ֔וא, “that” in “at that time.”
- Exact aid key: `GEN.38/1:2`; source reference `Gen.38.1#03=L`.
- Before: `public/aids/GEN.json` had `["ha", "hiv"]`, stress `[1]`, status `accent-derived`.
- Root cause: pinned hebrew-transliteration 2.11.0 with the app's SBLsimple configuration generates `ha|hiv`; the retained STEP TAHOT row also has `ha./Hiv'`. Their agreement passed the app's corroboration check. The generator did not resolve this qere perpetuum. No runtime AI produces this aid.
- Correct reading: `ha-HI` (approximately “ha-HEE”), stress on the second syllable. No final v or w. Preserve the original Hebrew spelling.
- Evidence: [Gesenius §32l](https://en.wikisource.org/wiki/Gesenius%27_Hebrew_Grammar/32._The_Personal_Pronoun._The_Separate_Pronoun#GHGpar-32-l) explains הִוא as the standing qere הִיא; UXLC's zaqef qaton locates stress on הִ.
- Implementation: exact-token, exact-text-guarded entry in `sources/aids/hebrew/reviewed-overrides.json`, linked by `issueId: HEB-003`. Applied after automatic generation/corroboration; output gets `reviewed-override` provenance. No upstream source file or biblical token is altered.
- Regression: `tests/aids.test.ts` independently expects ha/hi, second-syllable stress, preserved Hebrew, correction provenance, and packaged evidence.
- Status: **implemented locally**.
- Validation: rebuilt Genesis through the normal Hebrew generator and verified ha/hi survives generation; stopped the all-book phonology run after Deuteronomy rather than recomputing the remaining unchanged books. Finalized all 39 Hebrew/Aramaic bundles, packaged all 66 books / 443,243 tokens, passed all 26 tests (including the new regression and unchanged corpus fingerprint/progress tests), and completed the production/offline build. Local reading-aid release: `2026-09-26.2`.
- Publication: not published or verified on the hosted app.

## HEB-004 — Audit equivalent feminine הִוא forms

- Found: follow-up to HEB-003.
- Status: **collecting**.
- Scope: inventory feminine pronouns spelled הִוא, including article/prefix forms, and compare their current aids against the standing reading הִיא. Check morphology and exact pointing; do not match every word containing הוא or change masculine הוּא.
- Evidence starting point: Gesenius §32l and HEB-003's reproduced generator/source failure.
- Preliminary inventory: 193 candidate tokens across the local corpus contain הִוא after removing cantillation and meteg. This is a spelling-match count, not a completed morphology/pronunciation audit or a count of confirmed errors.
- Next action: record affected token keys and independent reading evidence, then choose reviewed entries or a narrowly tested grammatical rule if the inventory supports one. Include masculine הוּא as a counterexample.
- Implementation/publication: none. HEB-003 corrects only the verified Genesis 38:1 token.

## GRK-001 — Matthew 6:1 compound boundary in Προσέχετε

- Found: September 27, 2026; Daniel reported that the initial `pros` should stay together.
- Reference and word: Matthew 6:1, first word, Προσέχετε, “Beware.” Lemma: προσέχω.
- Exact aid key: `MAT.6/1:0`; source reference `MAT 6:1!1`.
- Verified local aid: `public/aids/MAT.json` → `chapters["MAT.6"]["1:0"]` has syllables `["Pro", "se", "che", "te"]`, stress `[1]`, status `written-accent`; displayed as `Pro-SE-che-te`. The user's phone display was reported, not independently inspected.
- Proposed classroom division: `pros-E-che-te` (προσ-έ-χε-τε), retaining προσ- as one syllable and emphasizing the accented έ. Both divisions have four syllables; the issue is the placement of sigma across the compound boundary, not an extra vowel or incorrect stress-bearing vowel.
- Evidence: [Smyth, Greek Grammar §140d](https://grammars.alpheios.net/smyth/xhtml/body.1_div1.1_div2.6.html) divides compounds at their point of union, including προσ-φέρω and συν-έχω. Applied to προσ- + ἔχω, this supports προσ-έ-χε-τε. Distinguish this traditional classroom compound division from phonetic resyllabification; do not describe every `pro-se` rendering as an unequivocal sound error across all Greek pronunciation traditions.
- Root cause to investigate: `scripts/build-greek-aids.py` calls the generic `greek_accentuation.syllabify` function without supplying the lexical compound boundary. Current output is verified; a full generator diagnosis is pending.
- Status: **ready** for the specific classroom boundary correction; broader compound handling remains **collecting**.
- Scope: this token and other verified forms of προσέχω. Check related prefixed verbs with independent morphological evidence and counterexamples; do not replace every `pro-se` sequence globally.
- Durable correction location: a documented Greek pronunciation override or narrowly tested generator rule linked to `GRK-001`; do not permanently hand-edit generated JSON.
- Validation/publication: logged only. No generated aids, app behavior, or hosted release changed.

## Recording the next error

A report can begin with just the reference, the word or its position, and what the app shows. Missing evidence should never prevent recording it. Assign the next HEB or GRK ID and mark it **collecting**; observation is not yet an approved correction.

Copy this template:

- ID and title:
- Found/date:
- Reference, exact pointed word, and token key (resolve locally if unknown):
- Observed aid and whether observed locally or on the hosted app:
- Proposed reading/meaning (or “unknown”):
- Independent evidence and relevant reading convention:
- Root cause: source text / annotation / generator / corroboration / display / unresolved:
- Scope: this token; related forms to investigate; counterexamples:
- Status: collecting / ready / needs convention decision / implemented locally / verified published:
- Durable correction location and issueId:
- Regression and checks actually completed:
- Publication status and verification date:

Before marking **ready**, check the actual Hebrew/Greek reading against linguistic evidence, not just two matching transliterations. Distinguish a pronunciation error from a choice of reading tradition. A supported individual correction belongs in the reviewed override registry, with exact text, evidence, reason, and this log's issue ID. Broader rules need verified examples and counterexamples. Do not hand-edit generated JSON as the permanent fix.

After implementation, rebuild the affected aids, finalize/package them, run the regression and corpus/progress checks, and build the app. Record actual results below the issue. Local success does not mean the hosted app is updated; mark **verified published** only after the exact hosted word is checked.

## Batch history

- September 26, 2026: Created the queue and verified the first reported aid in the local generated bundle. No app code, generated aids, or hosted release changed.

- September 26, 2026: HEB-003 implemented and locally validated; added the reporting template and HEB-004 follow-up inventory. Hosted release remains unchanged.
