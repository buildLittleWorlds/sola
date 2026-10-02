/** Build Hebrew / Biblical Aramaic learning aids without changing the UXLC corpus.
 * Offline inputs: pinned TAHOT files and hebrew-transliteration 2.11.0 (havarotjs 0.25.4).
 * HEBREW_AIDS_DEPS_DIR may point to an isolated npm installation for this build.
 * The engine's default final stress is deliberately never used as evidence.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(ROOT, 'sources/aids/hebrew');
const OUT = path.join(ROOT, 'public/aids');
const EXPECTED_COMMIT = 'b99716b0cddb648ddb95cc786a197180f2f97d48';
const BOOK_MAP = Object.fromEntries([
  ['Gen','GEN'],['Exo','EXO'],['Lev','LEV'],['Num','NUM'],['Deu','DEU'],
  ['Jos','JOS'],['Jdg','JDG'],['Rut','RUT'],['1Sa','1SA'],['2Sa','2SA'],
  ['1Ki','1KI'],['2Ki','2KI'],['1Ch','1CH'],['2Ch','2CH'],['Ezr','EZR'],
  ['Neh','NEH'],['Est','EST'],['Job','JOB'],['Psa','PSA'],['Pro','PRO'],
  ['Ecc','ECC'],['Sng','SNG'],['Isa','ISA'],['Jer','JER'],['Lam','LAM'],
  ['Ezk','EZK'],['Dan','DAN'],['Hos','HOS'],['Jol','JOL'],['Amo','AMO'],
  ['Oba','OBA'],['Jon','JON'],['Mic','MIC'],['Nam','NAM'],['Hab','HAB'],
  ['Zep','ZEP'],['Hag','HAG'],['Zec','ZEC'],['Mal','MAL'],
]);
const HEBREW = /[\u05d0-\u05ea]/u;
const ACCENTS = /[\u0591-\u05ae]/gu;
// Only ordinary accents whose placement identifies the stressed syllable.
// Post/prepositive marks and poetic combinations are NOT inferred here.
export const SAFE_ACCENTS = new Set([
  0x591,0x593,0x594,0x595,0x596,0x597,0x59b,0x59c,0x59e,0x59f,
  0x5a1,0x5a3,0x5a4,0x5a5,0x5a6,0x5a7,0x5a8,0x5aa,
].map(c => String.fromCodePoint(c)));
const KNOWN_CONFLICTS = new Set(['DAN.2/4:10','DAN.2/41:5','DAN.2/41:10']);

export const sha256 = value => createHash('sha256').update(value).digest('hex');
/** Pointed matching: discard punctuation, formatting and cantillation, not vowels.
 * Holem-haser and ordinary holem name the same vowel and are normalized together.
 * Qamats qatan, sheva, dagesh and shin/sin points remain distinct.
 */
export function pointedKey(text) {
  return text.normalize('NFD').replaceAll('\u05ba','\u05b9')
    .replace(/[^\u05d0-\u05ea\u05b0-\u05bc\u05c1\u05c2\u05c7]/gu, '');
}
// The syllabifier may identify qamats qatan without altering the source text.
const generatedKey = text => pointedKey(text).replaceAll('\u05c7','\u05b8')
  // havarot attaches holam male to its preceding consonant before the mater vav.
  // This is only for matching engine output back to its own exact input, NEVER
  // for the independently stricter TAHOT-to-UXLC alignment above.
  .replace(/\u05d5\u05b9/gu,'\u05b9\u05d5');
const tokenKey = token => `${token.verse}:${token.sourceIndex}`;
const inc = (counter, key, n = 1) => { counter[key] = (counter[key] ?? 0) + n; };

export function parseSourceRow(line) {
  const columns = line.replace(/\r$/u, '').split('\t');
  const match = /^([123]?[A-Z][a-z]{1,2})\.(\d+)\.(\d+)(?:\((\d+)\.(\d+)\))?#([^=]+)=(.+)$/u.exec(columns[0]);
  if (!match) return null;
  const bookId = BOOK_MAP[match[1]];
  if (!bookId) throw new Error(`Unrecognized TAHOT book: ${match[1]}`);
  return {
    sourceRef: columns[0], bookId,
    chapter: Number(match[4] ?? match[2]), verse: Number(match[5] ?? match[3]),
    type: match[7], hebrew: columns[1], pronunciation: columns[2],
    translation: columns[3], grammar: columns[5], expanded: columns[11] ?? '',
    key: pointedKey(columns[1]),
  };
}

/** Conservative verse alignment, with no edit-distance or consonant-only guesses.
 * Exact blocks are accepted. Otherwise unique pointed anchors must be order-
 * compatible with ALL other unique anchors, then blocks between them recurse.
 * Repeated ambiguous words and 1:n divisions are left unmatched, never shifted.
 */
export function alignVerse(tokens, rows) {
  const tk = tokens.map(t => pointedKey(t.text));
  const rk = rows.map(r => r.key);
  const pairs = new Map();
  function walk(ta, tb, ra, rb) {
    if (ta === tb || ra === rb) return;
    if (tb-ta === rb-ra && tk.slice(ta,tb).every((key,i) => key && key === rk[ra+i])) {
      for (let i=ta; i<tb; i++) pairs.set(i,ra+i-ta);
      return;
    }
    const left = new Map(), right = new Map();
    for (let i=ta;i<tb;i++) left.set(tk[i], left.has(tk[i]) ? -1 : i);
    for (let i=ra;i<rb;i++) right.set(rk[i], right.has(rk[i]) ? -1 : i);
    const candidates = [...left].filter(([k,i]) => k && i>=0 && (right.get(k) ?? -1)>=0)
      .map(([k,i]) => [i,right.get(k)]).sort((a,b) => a[0]-b[0]);
    const anchors = candidates.filter(([i,j]) => candidates.every(([ii,jj]) => i===ii || (i<ii)===(j<jj)));
    if (!anchors.length) return;
    let ti=ta, ri=ra;
    for (const [i,j] of anchors) {
      walk(ti,i,ri,j); pairs.set(i,j); ti=i+1;ri=j+1;
    }
    walk(ti,tb,ri,rb);
  }
  walk(0,tokens.length,0,rows.length);
  return pairs;
}

function glossFields(row) {
  if (!row || !row.translation?.trim()) return {gloss:null,glossStatus:'unavailable'};
  const components = row.translation.split('/').map(s => s.trim()
    .replace(/<obj\.?>/gu,'[object marker]').replace(/<([^>]+)>/gu,'($1)')).filter(Boolean);
  const lemma = /\{[^={}]+=([^={}]+)=/u.exec(row.expanded)?.[1];
  return {
    gloss: components.join(' · '), glossStatus:'source-aligned',
    ...(lemma && HEBREW.test(lemma) ? {lemma} : {}),
    ...(row.grammar ? {grammar:explainGrammar(row.grammar)} : {}),
    ...(components.length>1 ? {components} : {}),
  };
}

export function explainGrammar(code) {
  const aramaic=code.startsWith('A');
  const gender={m:'masculine',f:'feminine',b:'common gender',c:'common gender'};
  const number={s:'singular',p:'plural',d:'dual'};
  const state={a:'absolute',c:'construct',d:'emphatic/definite'};
  const person={'1':'first person','2':'second person','3':'third person'};
  const particles={Td:'definite article',Ta:'emphatic article',To:'direct-object marker',Tm:'demonstrative',Tr:'relative particle',Tn:'negative particle',Ti:'interrogative particle',R:'preposition',Rd:'preposition + article',C:'conjunction',c:'sequential conjunction',D:'adverb',I:'interjection',Sd:'directional suffix (toward)',Sh:'paragogic he suffix',Sn:'paragogic nun suffix'};
  const stems=aramaic?{q:'peal',Q:'peil',p:'pael',P:'ithpaal',h:'haphel',a:'aphel',t:'ithpeel'}:{q:'qal',N:'niphal',p:'piel',P:'pual',h:'hiphil',H:'hophal',t:'hithpael'};
  const aspect={p:'perfect',q:'sequential perfect',i:'imperfect',w:'sequential imperfect',h:'cohortative',j:'jussive',v:'imperative',r:'active participle',s:'passive participle',a:'infinitive absolute',c:'infinitive construct'};
  const describe=part=>{
    if(particles[part])return particles[part];
    const first=part[0];
    if(first==='N'||first==='A') {
      const kind=first==='N'?(part[1]==='p'?'proper noun':part[1]==='g'?'gentilic noun':'noun'):({a:'adjective',c:'cardinal number',o:'ordinal number',g:'gentilic adjective'}[part[1]]??'adjective');
      return [kind,gender[part[2]],number[part[3]],state[part[4]]].filter(Boolean).join(', ');
    }
    if(first==='V') {
      const rest=part.slice(3);
      return ['verb',stems[part[1]],aspect[part[2]],...rest.split('').map(c=>person[c]??gender[c]??number[c])].filter(Boolean).join(', ');
    }
    if(first==='P'||first==='S')return [first==='S'?'pronominal suffix':'pronoun',...part.slice(2).split('').map(c=>person[c]??gender[c]??number[c])].filter(Boolean).join(', ');
    if(first==='T')return 'particle';
    if(first==='R')return 'preposition';
    return 'grammatical form';
  };
  return `${aramaic?'Aramaic: ':''}${code.slice(1).split('/').map(describe).join(' + ')}`;
}

/** Compare only spellings with known classroom equivalents.
 * TAHOT apostrophes represent alef/ayin, omitted by the requested SBLsimple.
 * q/k comparison changes spelling only; it never removes vowels or syllables.
 */
export function comparisonSyllables(transliteration) {
  return transliteration.replaceAll('/','').toLowerCase().split('.')
    .map(s => s.replace(/['’ʼ]/gu,'').replaceAll('ch','kh').replaceAll('tz','ts')
      .replaceAll('q','k').replace(/[-\s]+$/gu,''))
    .filter(Boolean);
}
export function pronunciationAgrees(row, generated) {
  if (!row || !row.pronunciation || /[\u0590-\u05ff]/u.test(row.pronunciation)) return false;
  const candidate = comparisonSyllables(row.pronunciation);
  const target = generated.map(s => s.toLowerCase().replaceAll('q','k').replace(/-$/u,''));
  const normalize=(syllables)=>syllables.map(s=>s.replaceAll('ai','ay').replaceAll('ei','e'));
  // STEP normally does not print the consonant gemination that SBLsimple prints
  // across syllable boundaries. Accept just this representational difference,
  // after the exact pointed Hebrew (including dagesh) already matched.
  const c=normalize(candidate),g=normalize(target);
  if(c.length!==g.length)return false;
  for(let i=0;i<g.length;i++) {
    if(c[i]===g[i])continue;
    const ending=g[i].slice(c[i].length);
    if(!g[i].startsWith(c[i]) || !/^(?:[bdgklmnpqrstvyz]|sh|kh|ts)$/u.test(ending) || !g[i+1]?.startsWith(ending))return false;
  }
  return true;
}

/** Select an anchor from actual UXLC marks, NEVER Syllable.isAccented defaults. */
export function sourceStress(text, hebrewSyllables) {
  const marks = [...text.matchAll(ACCENTS)].map(m=>m[0]);
  if (text.includes('־')) return !marks.length ? {status:'joined',stressed:[]} : {status:'stress-unconfirmed',stressed:[]};
  let anchor;
  if (marks.length===1 && SAFE_ACCENTS.has(marks[0])) anchor=marks[0];
  else if(marks.every(mark=>mark==='\u0599'||mark==='\u05a8')&&marks.includes('\u0599')) {
    // Pashta is postpositive. A doubled sign (or preceding qadma helper) marks
    // the actual stressed syllable; a single final sign marks final stress.
    // This separate rule is tested against UXLC's actual retained signs.
    const positions=hebrewSyllables.flatMap((s,i)=>(s.includes('\u0599')||s.includes('\u05a8'))?[i]:[]);
    const last=hebrewSyllables.length-1;
    if(marks.length<=2 && positions.includes(last) && positions.length<=2) {
      return {status:'accent-derived',stressed:[Math.min(...positions)]};
    }
  }
  else if (!marks.length && text.includes('׃') && (text.match(/\u05bd/gu) ?? []).length===1) anchor='\u05bd';
  if (!anchor) return {status:'stress-unconfirmed',stressed:[]};
  const matches=hebrewSyllables.flatMap((s,i)=>s.includes(anchor)?[i]:[]);
  return matches.length===1 ? {status:'accent-derived',stressed:matches} : {status:'stress-unconfirmed',stressed:[]};
}

export async function loadEngine() {
  const custom=process.env.HEBREW_AIDS_DEPS_DIR;
  const req=createRequire(path.join(custom ? path.resolve(custom) : ROOT,'package.json'));
  const manifest=req.resolve('hebrew-transliteration/package.json');
  const packageDir=path.dirname(manifest);
  assert.equal(JSON.parse(await readFile(manifest,'utf8')).version,'2.11.0','Pin hebrew-transliteration 2.11.0');
  const hManifest=req.resolve('havarotjs/package.json');
  assert.equal(JSON.parse(await readFile(hManifest,'utf8')).version,'0.25.4','Pin havarotjs 0.25.4');
  const {Text,transliterate}=await import(pathToFileURL(req.resolve('hebrew-transliteration')).href);
  const {sblSimple}=await import(pathToFileURL(path.join(packageDir,'dist/schemas/index.js')).href);
  const schema={...sblSimple,SYLLABLE_SEPARATOR:'|',STRESS_MARKER:undefined,allowNoNiqqud:false,strict:true};
  const opts=Object.fromEntries(Object.entries(schema).filter(([key])=>/^[a-z]/u.test(key)));
  function makeGenerated(text) {
    const parsed=new Text(text,opts);
    const words=parsed.words.filter(w=>HEBREW.test(w.text));
    const latin=transliterate(parsed,schema).trim().split(/\s+/u).filter(Boolean);
    if (words.length!==latin.length) throw new Error('Engine word boundaries did not match');
    return words.map((word,i)=>{
      const syllables=latin[i].replace(/[^\p{Script=Latin}\p{M}|'-]/gu,'').replace(/-$/u,'').split('|').filter(Boolean);
      if (!syllables.length || syllables.some(s=>!/[a-z]/iu.test(s))) throw new Error('Empty generated syllable');
      const hebrewSyllables=word.syllables.map(s=>s.text);
      return {key:generatedKey(word.text),syllables,hebrewSyllables,shapeMatches:syllables.length===hebrewSyllables.length};
    });
  }
  return {
    makeGenerated,
    schema,
    generateVerse(tokens) {
      try {
        const all=makeGenerated(tokens.map(t=>t.text).join(' '));
        if (all.length!==tokens.length || all.some((g,i)=>g.key!==generatedKey(tokens[i].text))) throw new Error('Engine changed token boundaries');
        return all.map(g=>({...g,context:'verse'}));
      } catch {
        return tokens.map(token=>{
          try {
            const one=makeGenerated(token.text);
            if(one.length!==1 || one[0].key!==generatedKey(token.text)) throw new Error('Ambiguous generated word');
            return {...one[0],context:'token'};
          } catch(error) { return {error:String(error.message)}; }
        });
      }
    },
  };
}

function divineName(token, engine) {
  // The requested reconstructed reading is an explicit convention, NOT the
  // pronunciation of YHWH's written qere-vowel combination.
  const clusters=token.text.normalize('NFD').match(/[\u05d0-\u05ea][^\u05d0-\u05ea]*/gu) ?? [];
  const letters=clusters.map(c=>c[0]).join('');
  const at=letters.indexOf('יהוה');
  if (at<0 || at+4!==letters.length || !/^[ובכלמשה]*$/u.test(letters.slice(0,at))) return null;
  let prefix=[];
  if(at>0) {
    try {
      const generated=engine.makeGenerated(clusters.slice(0,at).join(''));
      if(generated.length!==1) return null;
      prefix=generated[0].syllables;
    } catch { return null; }
  }
  return {syllables:[...prefix,'yah','weh'],stressed:[prefix.length],status:'convention',note:'Yahweh: chosen reading convention.'};
}

function makeAid(token, row, generated, engine, id, overrides) {
  const gloss=glossFields(row);
  let pronunciation;
  const convention=divineName(token,engine);
  let reason;
  if(convention) pronunciation=convention;
  else if(generated.error) {
    pronunciation={syllables:[],stressed:[],status:'unavailable',note:'Pronunciation needs review.'};
    reason='syllabification-failed';
  } else {
    const corroborated=pronunciationAgrees(row,generated.syllables) && !KNOWN_CONFLICTS.has(id);
    const accent=sourceStress(token.text,generated.hebrewSyllables);
    // Whole-verse analysis is attempted first. If a different word in the verse
    // makes that fail, a successfully corroborated token can still use its own
    // complete pointing, maqaf and verse-final marker. Its neighbor's parse
    // failure does not invalidate an independently located accent on this word.
    if(!corroborated || !generated.shapeMatches) {
      pronunciation={syllables:generated.syllables,stressed:[],status:'pronunciation-unconfirmed',note:'Generated reading; not yet corroborated.'};
      reason=KNOWN_CONFLICTS.has(id)?'known-source-reading-conflict':!row?'no-source-match':!generated.shapeMatches?'syllable-boundary-mismatch':'pronunciation-disagreement';
    } else {
      pronunciation={syllables:generated.syllables,...accent,
        ...(accent.status==='stress-unconfirmed'?{note:'Stress is not confirmed for this accent pattern.'}:{}),
        ...(accent.status==='joined'?{note:'Joined to the following word by maqaf.'}:{})};
      if(accent.status==='stress-unconfirmed') reason='unsupported-or-ambiguous-stress';
    }
  }
  const aid={...gloss,sources:[...(row?['step-tahot']:[]),'hebrew-transliteration'],pronunciation,...(row?{sourceRef:row.sourceRef}:{})};
  if(overrides[id]) {
    const override=overrides[id];
    assert.equal(override.text,token.text,`Outdated override ${id}`);
    assert.ok(override.reason && override.evidence,`Override needs provenance ${id}`);
    if(override.pronunciation) aid.pronunciation={...override.pronunciation,status:'reviewed'};
    if(override.gloss) {aid.gloss=override.gloss;aid.glossStatus='reviewed';}
    aid.sources.push('reviewed-override');
    aid.notes=[override.reason];
    reason=undefined;
  }
  // A vowel-free fragment such as the silent second shin in Issachar is not a
  // pronounceable classroom syllable. Do not offer visibly nonsensical output
  // merely with a provisional badge; leave it for a reviewed correction.
  if(aid.pronunciation.syllables.some(s=>!/[aeiou]/iu.test(s))) {
    aid.pronunciation={syllables:[],stressed:[],status:'unavailable',note:'Pronunciation needs review.'};
    reason='vowelless-generated-syllable';
  }
  return {aid,reason};
}

function assertAid(aid) {
  assert.ok(aid.gloss===null || typeof aid.gloss==='string');
  assert.ok(Array.isArray(aid.pronunciation.syllables));
  assert.ok(aid.pronunciation.stressed.every(i=>Number.isInteger(i)&&i>=0&&i<aid.pronunciation.syllables.length));
  if(['stress-unconfirmed','pronunciation-unconfirmed','joined','unavailable'].includes(aid.pronunciation.status)) assert.equal(aid.pronunciation.stressed.length,0);
  if(aid.pronunciation.status==='unavailable') assert.equal(aid.pronunciation.syllables.length,0);
}

export function selfTest() {
  assert.notEqual(pointedKey('הוֹן'),pointedKey('הֵין'),'Vowel differences may not align');
  assert.equal(pointedKey('בְּ/רֵאשִׁ֖ית'),pointedKey('בְּרֵאשִׁ֖ית'));
  assert.deepEqual(sourceStress('בָּרָ֣א',['בָּ','רָ֣א']),{status:'accent-derived',stressed:[1]});
  assert.deepEqual(sourceStress('לָ֭מָּה',['לָ֭','מָּה']),{status:'stress-unconfirmed',stressed:[]});
  assert.deepEqual(sourceStress('תֹ֙הוּ֙',['תֹ֙','הוּ֙']),{status:'accent-derived',stressed:[0]});
  assert.deepEqual(sourceStress('שְׁמוֹת֙',['שְׁ','מוֹת֙']),{status:'accent-derived',stressed:[1]});
  assert.deepEqual(sourceStress('הָאָֽרֶץ׃',['הָ','אָֽ','רֶץ׃']),{status:'accent-derived',stressed:[1]});
  assert.deepEqual(sourceStress('וַֽיְהִי־',['וַֽ','יְ','הִי־']),{status:'joined',stressed:[]});
  assert.deepEqual(sourceStress('דָּבָר',['דָּ','בָר']),{status:'stress-unconfirmed',stressed:[]});
  assert.equal(parseSourceRow('Neh.4.1(3.33)#01=L\tאָב\tav\tfather').chapter,3);
  const aligned=alignVerse([{text:'אָב'},{text:'בֵּן'},{text:'שֵׁם'}],[{key:pointedKey('אָב')},{key:pointedKey('הוֹן')},{key:pointedKey('שֵׁם')}]);
  assert.deepEqual([...aligned],[[0,0],[2,2]]);
  assert.equal(alignVerse([{text:'אָב'},{text:'אָב'}],[{key:pointedKey('אָב')}]).size,0,'Repeated ambiguous words stay unmatched');
  assert.equal(alignVerse([{text:'אָב'},{text:'בֵּן'}],[{key:pointedKey('בֵּן')},{key:pointedKey('אָב')}]).size,0,'Reordered words cannot cross-align');
}

export async function build() {
  selfTest();
  const corpus=JSON.parse(await readFile(path.join(ROOT,'public/corpus/index.json'),'utf8'));
  const sourceLock=JSON.parse(await readFile(path.join(SOURCE,'source-lock.json'),'utf8'));
  assert.equal(sourceLock.commit,EXPECTED_COMMIT);
  const engine=await loadEngine();
  let overrides={};
  try {overrides=JSON.parse(await readFile(path.join(SOURCE,'reviewed-overrides.json'),'utf8'));} catch(error) {if(error.code!=='ENOENT') throw error;}
  const allRows=new Map();const seen=new Set(); const excludedTypes={};
  let sourceRows=0;
  for(const file of sourceLock.files) {
    const bytes=await readFile(path.join(SOURCE,file.file));
    assert.equal(sha256(bytes),file.sha256,`Source changed ${file.file}`);
    for(const line of bytes.toString('utf8').split('\n')) {
      const row=parseSourceRow(line);if(!row)continue;
      sourceRows++;
      assert.ok(!seen.has(row.sourceRef),`Duplicate sourceRef ${row.sourceRef}`);seen.add(row.sourceRef);
      if(!/^[LQ]/u.test(row.type)) {inc(excludedTypes,row.type);continue;}
      const key=`${row.bookId}.${row.chapter}:${row.verse}`;
      if(!allRows.has(key))allRows.set(key,[]);
      allRows.get(key).push(row);
    }
  }
  await mkdir(OUT,{recursive:true});
  const audit={schemaVersion:1,corpusHash:corpus.contentHash,stepCommit:EXPECTED_COMMIT,sourceRows,excludedTypes,totals:{tokens:0,aligned:0,unmatched:0},glossStatus:{},pronunciationStatus:{},reasons:{},books:[],exceptions:[],regressions:{}};
  const regressionRefs=new Set(['GEN.1:1','GEN.1:2','GEN.1:7','GEN.2:4','GEN.14:17','GEN.27:3','PSA.1:1','PSA.2:1','DAN.2:4','DAN.2:41','EZR.4:8','JER.10:11']);
  for(const book of corpus.books.filter(b=>b.testament==='OT')) {
    const raw=await readFile(path.join(ROOT,`public/corpus/${book.id}.json`));
    const chapters=JSON.parse(raw.toString('utf8'));
    const result={schemaVersion:1,bookId:book.id,corpusHash:corpus.contentHash,chapters:{}};
    const bookStats={bookId:book.id,tokens:0,aligned:0,unmatched:0,glossStatus:{},pronunciationStatus:{}};
    for(const chapter of chapters) {
      const aids={}; result.chapters[chapter.id]=aids;
      for(const verse of chapter.verses) {
        const tokens=chapter.tokens.filter(t=>t.verse===verse);
        const rows=allRows.get(`${chapter.id}:${verse}`)??[];
        const pairs=alignVerse(tokens,rows);
        const generated=engine.generateVerse(tokens);
        for(let i=0;i<tokens.length;i++) {
          const token=tokens[i],id=`${chapter.id}/${tokenKey(token)}`;
          const sourceIndex=pairs.get(i),row=sourceIndex===undefined?null:rows[sourceIndex];
          const {aid,reason}=makeAid(token,row,generated[i],engine,id,overrides);
          assertAid(aid);assert.ok(!aids[tokenKey(token)],`Duplicate output token ${id}`);
          aids[tokenKey(token)]=aid;
          audit.totals.tokens++;bookStats.tokens++;
          inc(audit.totals,row?'aligned':'unmatched');inc(bookStats,row?'aligned':'unmatched');
          inc(audit.glossStatus,aid.glossStatus);inc(bookStats.glossStatus,aid.glossStatus);
          inc(audit.pronunciationStatus,aid.pronunciation.status);inc(bookStats.pronunciationStatus,aid.pronunciation.status);
          if(reason)inc(audit.reasons,reason);
          if(!row || reason) audit.exceptions.push({id,...(!row?{alignment:'unmatched'}:{}),...(reason?{reason}:{}),...(row?{sourceRef:row.sourceRef}:{})});
          if(regressionRefs.has(`${chapter.id}:${verse}`)) audit.regressions[id]={text:token.text,gloss:aid.gloss,syllables:aid.pronunciation.syllables,stressed:aid.pronunciation.stressed,status:aid.pronunciation.status};
        }
      }
      assert.equal(Object.keys(aids).length,chapter.tokens.length,`Missing aids ${chapter.id}`);
    }
    await writeFile(path.join(OUT,`${book.id}.json`),JSON.stringify(result)+'\n');
    assert.equal(sha256(await readFile(path.join(ROOT,`public/corpus/${book.id}.json`))),sha256(raw),'Corpus must remain unchanged');
    audit.books.push(bookStats);
    console.log(`${book.id}: ${bookStats.aligned}/${bookStats.tokens} glosses aligned; ${bookStats.pronunciationStatus['accent-derived']??0} accent-derived`);
  }
  assert.equal(audit.books.length,39);
  assert.equal(audit.totals.tokens,corpus.books.filter(b=>b.testament==='OT').reduce((s,b)=>s+b.words,0));
  await writeFile(path.join(ROOT,'sources/aids/hebrew-audit.json'),JSON.stringify(audit,null,2)+'\n');
  console.log(JSON.stringify({totals:audit.totals,glossStatus:audit.glossStatus,pronunciationStatus:audit.pronunciationStatus,reasons:audit.reasons},null,2));
  return audit;
}

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  if(process.argv.includes('--self-test')) {selfTest();console.log('Hebrew aid alignment/stress self-tests passed.');}
  else await build();
}
