/** Recheck existing OT bundles and refresh readable grammar without rerunning
 * the expensive phonology pass. Also emits a checksum inventory for packaging.
 * The same pronunciation invariant is enforced by build-hebrew-aids.mjs.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { explainGrammar, parseSourceRow, sha256, loadEngine, pronunciationAgrees, sourceStress } from '../build-hebrew-aids.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const source=path.join(ROOT,'sources/aids/hebrew');
const corpus=JSON.parse(await readFile(path.join(ROOT,'public/corpus/index.json'),'utf8'));
const lock=JSON.parse(await readFile(path.join(source,'source-lock.json'),'utf8'));
const auditPath=path.join(ROOT,'sources/aids/hebrew-audit.json');
const audit=JSON.parse(await readFile(auditPath,'utf8'));
assert.equal(audit.corpusHash,corpus.contentHash);
const rows=new Map();
for(const file of lock.files) {
  const bytes=await readFile(path.join(source,file.file));
  assert.equal(sha256(bytes),file.sha256);
  for(const line of bytes.toString('utf8').split('\n')) {
    const row=parseSourceRow(line);if(row)rows.set(row.sourceRef,row);
  }
}
const exceptions=new Map(audit.exceptions.map(e=>[e.id,e]));
const increment=(obj,key)=>{obj[key]=(obj[key]??0)+1;};
audit.glossStatus={};audit.pronunciationStatus={};audit.books=[];
let rejected=0;
let independentlyConfirmed=0;
const engine=await loadEngine();
const cache=new Map();
const files=[];
for(const book of corpus.books.filter(b=>b.testament==='OT')) {
  const filename=path.join(ROOT,`public/aids/${book.id}.json`);
  const data=JSON.parse(await readFile(filename,'utf8'));
  const original=JSON.parse(await readFile(path.join(ROOT,`public/corpus/${book.id}.json`),'utf8'));
  const tokens=new Map(original.flatMap(ch=>ch.tokens.map(t=>[`${ch.id}/${t.verse}:${t.sourceIndex}`,t])));
  assert.equal(data.corpusHash,corpus.contentHash);
  const stats={bookId:book.id,tokens:0,aligned:0,unmatched:0,glossStatus:{},pronunciationStatus:{}};
  for(const [chapter,words] of Object.entries(data.chapters)) {
    for(const [key,aid] of Object.entries(words)) {
      const id=`${chapter}/${key}`;
      const row=rows.get(aid.sourceRef);
      if(row)aid.grammar=explainGrammar(row.grammar);
      if(exceptions.get(id)?.reason==='token-only-analysis') {
        const token=tokens.get(id);
        let candidate=cache.get(token.text);
        if(candidate===undefined) {
          try {const result=engine.makeGenerated(token.text);candidate=result.length===1?result[0]:null;}catch{candidate=null;}
          cache.set(token.text,candidate);
        }
        if(candidate?.shapeMatches && pronunciationAgrees(row,candidate.syllables)
          && JSON.stringify(candidate.syllables)===JSON.stringify(aid.pronunciation.syllables)) {
          const accent=sourceStress(token.text,candidate.hebrewSyllables);
          aid.pronunciation={syllables:candidate.syllables,...accent,
            ...(accent.status==='stress-unconfirmed'?{note:'Stress is not confirmed for this accent pattern.'}:{}),
            ...(accent.status==='joined'?{note:'Joined to the following word by maqaf.'}:{})};
          if(accent.status==='stress-unconfirmed')exceptions.get(id).reason='unsupported-or-ambiguous-stress';
          else exceptions.delete(id);
          independentlyConfirmed++;
        } else exceptions.get(id).reason='pronunciation-disagreement';
      }
      if(aid.pronunciation.syllables.some(s=>!/[aeiou]/iu.test(s))) {
        aid.pronunciation={syllables:[],stressed:[],status:'unavailable',note:'Pronunciation needs review.'};
        exceptions.set(id,{...exceptions.get(id),id,reason:'vowelless-generated-syllable',...(aid.sourceRef?{sourceRef:aid.sourceRef}:{})});
        rejected++;
      }
      assert.ok(aid.pronunciation.stressed.every(i=>Number.isInteger(i)&&i>=0&&i<aid.pronunciation.syllables.length));
      if(['pronunciation-unconfirmed','stress-unconfirmed','joined','unavailable'].includes(aid.pronunciation.status))assert.equal(aid.pronunciation.stressed.length,0);
      stats.tokens++;increment(stats,aid.sourceRef?'aligned':'unmatched');
      increment(stats.glossStatus,aid.glossStatus);increment(audit.glossStatus,aid.glossStatus);
      increment(stats.pronunciationStatus,aid.pronunciation.status);increment(audit.pronunciationStatus,aid.pronunciation.status);
      if(audit.regressions[id])Object.assign(audit.regressions[id],{gloss:aid.gloss,syllables:aid.pronunciation.syllables,stressed:aid.pronunciation.stressed,status:aid.pronunciation.status});
    }
  }
  const bytes=JSON.stringify(data)+'\n';
  await writeFile(filename,bytes);
  files.push({bookId:book.id,file:`public/aids/${book.id}.json`,bytes:Buffer.byteLength(bytes),sha256:sha256(bytes)});
  audit.books.push(stats);
}
audit.exceptions=[...exceptions.values()];
audit.reasons={};for(const e of audit.exceptions)if(e.reason)increment(audit.reasons,e.reason);
audit.totals={tokens:0,aligned:0,unmatched:0};
for(const book of audit.books)for(const key of Object.keys(audit.totals))audit.totals[key]+=book[key];
audit.outputFiles=files;
await writeFile(auditPath,JSON.stringify(audit,null,2)+'\n');
await writeFile(path.join(source,'generated-files.json'),JSON.stringify({corpusHash:corpus.contentHash,files},null,2)+'\n');
console.log(JSON.stringify({books:files.length,bytes:files.reduce((s,f)=>s+f.bytes,0),rejectedVowellessSyllables:rejected,independentlyConfirmed,totals:audit.totals,glossStatus:audit.glossStatus,pronunciationStatus:audit.pronunciationStatus,reasons:audit.reasons},null,2));
