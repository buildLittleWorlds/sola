// Assemble the generated annotation data with an independent token/coverage audit.
// No Bible text, token keys, or progress data are modified by this script.
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const root = new URL('../', import.meta.url);
const get = async path => JSON.parse(await readFile(new URL(path, root), 'utf8'));
const put = async (path, value) => writeFile(new URL(path, root), JSON.stringify(value, null, 2) + '\n');
// Detailed exception lists remain in sources/aids; don't make phones cache them
// in addition to the same per-word statuses already present in the aid books.
const summarize = value => Array.isArray(value)
  ? value.length > 100 ? { count: value.length, sample: value.slice(0, 50).map(summarize) } : value.map(summarize)
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, summarize(item)])) : value;
const corpus = await get('public/corpus/index.json');
const expected = 'c81a17500cfab313737bc0ffe3c4338f03cd947a9c2961fe33927ab944d43f37';
assert.equal(corpus.contentHash, expected, 'The existing corpus fingerprint must stay unchanged.');
const digest = createHash('sha256');
const totals = {}, byBook = {}, assets = [];
const bump = (obj, key) => { obj[key] = (obj[key] || 0) + 1; };
let count = 0;
for (const book of corpus.books) {
  const filename = `public/aids/${book.id}.json`;
  const bytes = await readFile(new URL(filename, root));
  const data = JSON.parse(bytes.toString('utf8'));
  assert.equal(data.schemaVersion, 1);
  assert.equal(data.corpusHash, corpus.contentHash);
  assert.equal(data.bookId, book.id);
  const chapters = corpus.chapters.filter(c => c.bookId === book.id);
  assert.deepEqual(Object.keys(data.chapters).sort(), chapters.map(c => c.id).sort());
  const counts = {};
  for (const chapter of chapters) {
    const entries = data.chapters[chapter.id];
    assert.deepEqual(Object.keys(entries).sort(), [...chapter.tokenKeys].sort(), chapter.id);
    for (const [key, aid] of Object.entries(entries)) {
      count++;
      assert.ok(['source-aligned', 'reviewed', 'unavailable'].includes(aid.glossStatus), `${chapter.id}:${key}`);
      assert.ok(aid.glossStatus === 'unavailable' ? aid.gloss === null : typeof aid.gloss === 'string' && aid.gloss.trim());
      assert.ok(Array.isArray(aid.sources));
      const p = aid.pronunciation;
      assert.ok(p && Array.isArray(p.syllables) && Array.isArray(p.stressed));
      assert.ok(p.stressed.every(i => Number.isInteger(i) && i >= 0 && i < p.syllables.length));
      for (const label of [`gloss:${aid.glossStatus}`, `pronunciation:${p.status}`]) { bump(totals, label); bump(counts, label); }
    }
  }
  const hash = createHash('sha256').update(bytes).digest('hex');
  digest.update(hash);
  assets.push({ bookId: book.id, path: `/aids/${book.id}.json`, bytes: bytes.length, sha256: hash });
  byBook[book.id] = { name: book.name, words: book.words, ...counts };
}
assert.equal(count, corpus.statistics.hebrewReadWords + corpus.statistics.greekWords);
const sourceRefs = {
  step: { commit: 'b99716b0cddb648ddb95cc786a197180f2f97d48', url: 'https://github.com/STEPBible/STEPBible-Data/tree/b99716b0cddb648ddb95cc786a197180f2f97d48', license: 'CC BY 4.0; selected TAHOT/TAGNT fields only' },
  macula: { commit: '8423afe47b9e8f24b7772e808af45c7159a6fe7e', url: 'https://github.com/Clear-Bible/macula-greek/tree/8423afe47b9e8f24b7772e808af45c7159a6fe7e', license: 'CC BY 4.0 morphology; public-domain Berean glosses; no UBS semantic-domain data' },
  hebrewTransliteration: { version: '2.11.0', dependency: 'havarotjs 0.25.4', license: 'MIT' },
  greekAccentuation: { version: '1.2.0', commit: '15ac5fd1cc82c8f9b91a4041f9b64399c9552097', license: 'MIT' },
};
await put('public/aids/manifest.json', { schemaVersion: 1, version: '2026-09-26.2', corpusHash: corpus.contentHash, aidHash: digest.digest('hex'), sources: sourceRefs, assets });
await put('public/aids/audit.json', { schemaVersion: 1, corpusHash: corpus.contentHash, words: count, totals, byBook,
  interpretation: 'Source-aligned glosses are imported scholarly annotations, not individual human verification. Pronunciation and stress are assessed separately. Unresolved cases are displayed explicitly.',
  hebrew: summarize(await get('sources/aids/hebrew-audit.json')), greek: summarize(await get('sources/aids/greek-audit.json')) });
const corrections = {};
for (const language of ['hebrew', 'greek']) {
  for (const file of await readdir(new URL(`sources/aids/${language}/`, root))) {
    if (/reviewed.*\.json$|corrections.*\.json$/i.test(file)) corrections[`${language}/${file}`] = await get(`sources/aids/${language}/${file}`);
  }
}
await put('public/aids/corrections.json', { corpusHash: corpus.contentHash, corrections });
await mkdir(new URL('public/licenses/reading-aids/', root), { recursive: true });
const licenses = [
  ['sources/aids/greek/MACULA-LICENSE.md', 'MACULA-Greek.txt'],
  ['sources/aids/greek/STEP-README.md', 'STEPBible.txt'],
  ['sources/aids/greek/greek-accentuation-LICENSE', 'greek-accentuation-MIT.txt'],
  ['node_modules/hebrew-transliteration/LICENSE.md', 'hebrew-transliteration-MIT.txt'],
  ['node_modules/havarotjs/LICENSE', 'havarotjs-MIT.txt'],
];
for (const [source, destination] of licenses) await writeFile(new URL(`public/licenses/reading-aids/${destination}`, root), await readFile(new URL(source, root)));
await writeFile(new URL('public/licenses/reading-aids.txt', root), `BIBLE MEMORY READING AIDS\n\nHebrew and Biblical Aramaic literal glosses, lemma tags and morphology: STEP Bible, https://www.STEPBible.org, from STEPBible-Data at the pinned revision in /aids/manifest.json. TAHOT and selected TAGNT data are used under CC BY 4.0. Derived changes: source-to-UXLC alignment, reference conversion, literal gloss formatting, classroom pronunciation corroboration, and explicit exceptions.\n\nGreek annotations: MACULA Greek Linguistic Datasets, available at https://github.com/Clear-Bible/macula-greek/. Morphology is CC BY 4.0. Selected glosses derive from the Berean Interlinear Bible, placed in the public domain April 30, 2023. Any selected Cherith gloss must retain its source attribution (Andi Wu / Cherith Analytics, CC BY 4.0). This release does not use permission-only UBS semantic domains or restricted Hebrew lexicon definitions.\n\nHebrew transliteration: Charles Loder, hebrew-transliteration 2.11.0 and havarotjs 0.25.4, MIT. Output is adapted to the chosen classroom convention, with independently constrained stress, uncertainty labels, and the chosen YAH-weh reading. Greek syllabification: James Tauber, greek-accentuation 1.2.0, MIT. Accents and spelling always come from the app's original Greek text.\n\nSource-aligned is not a claim of individual human review. Source and pronunciation corrections are documented in /aids/corrections.json and the generation audit. No endorsement by source publishers is implied.\n\nComplete applicable notices:\n/licenses/reading-aids/STEPBible.txt\n/licenses/reading-aids/MACULA-Greek.txt\n/licenses/reading-aids/greek-accentuation-MIT.txt\n/licenses/reading-aids/hebrew-transliteration-MIT.txt\n/licenses/reading-aids/havarotjs-MIT.txt\n\nCreative Commons Attribution 4.0: https://creativecommons.org/licenses/by/4.0/\n`);
console.log(JSON.stringify({ words: count, books: assets.length, totals, bytes: assets.reduce((sum, asset) => sum + asset.bytes, 0) }, null, 2));
