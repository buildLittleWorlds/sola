import type { Book, Chapter, Progress, ReadingAid, Token } from './types';
import { aidKey, aidSources } from './aids';
import { displayHebrew } from './model';

export function Pronunciation({ aid }: { aid: ReadingAid }) {
  const p = aid.pronunciation;
  if (!p.syllables.length || p.status === 'unavailable') return <span className="aid-uncertain">Pronunciation needs review</span>;
  return <>
    <span className="aid-pronunciation" dir="ltr" lang="en">{p.syllables.map((syllable, i) => <span key={i}>{i > 0 ? '-' : ''}{p.stressed.includes(i) ? <strong>{p.status === 'convention' ? syllable.toUpperCase() : syllable}</strong> : syllable}</span>)}</span>
    {p.status === 'stress-unconfirmed' && <span className="aid-uncertain">Stress unconfirmed</span>}
    {p.status === 'pronunciation-unconfirmed' && <span className="aid-uncertain">Pronunciation unconfirmed</span>}
    {p.status === 'joined' && <span className="aid-joined">Joined to next word</span>}
  </>;
}

export function WordGroups({ chapter, book, count, settings, newStart, aids, showDetails }: {
  chapter: Chapter; book: Book; count: number; settings: Progress['settings']; newStart: number | null;
  aids: Record<string, ReadingAid> | null; showDetails: (index: number) => void;
}) {
  const transliteration = book.language === 'he' ? settings.showHebrewTransliteration : settings.showGreekTransliteration;
  const words = chapter.tokens.slice(0, count);
  return <div className={`word-groups ${book.language === 'he' ? 'hebrew-groups' : 'greek-groups'}`} dir={book.language === 'he' ? 'rtl' : 'ltr'}>
    {words.map((token, i) => {
      const aid = aids?.[aidKey(token.verse, token.sourceIndex)];
      const original = book.language === 'he' ? displayHebrew(token.text, settings.cantillation) : token.text;
      const first = i === 0 || words[i - 1].verse !== token.verse;
      const markers = chapter.markers.filter(m => m.after === i + 1 && m.verse === token.verse);
      return <div className={`word-aid ${newStart !== null && i >= newStart ? 'new-word-aid' : ''}`} key={`${token.verse}:${token.sourceIndex}`} data-token={`${chapter.id}:${token.verse}:${token.sourceIndex}`}>
        <div className="aid-original-line" lang={book.language}>
          {first && <sup className="verse-number" dir="ltr" aria-label={`Verse ${token.verse}`}>{token.verse}</sup>}
          <button className={`aid-original ${newStart !== null && i >= newStart ? 'new-word' : ''}`} aria-label={`Word details: ${original}`} onClick={() => showDetails(i)}>{token.prefix}{original}{token.suffix}</button>
          {markers.map((m, j) => <span className="text-marker" key={j}> {m.text}</span>)}
        </div>
        {transliteration && aid && <Pronunciation aid={aid}/>}
        {settings.showGlosses && <span className={`aid-gloss ${aid?.gloss ? '' : 'aid-uncertain'}`} dir="ltr" lang="en">{aid ? aid.gloss || 'Meaning needs review' : aids === null ? 'Loading aid…' : 'Aid unavailable'}</span>}
      </div>;
    })}
  </div>;
}

const statusLabels: Record<ReadingAid['pronunciation']['status'], string> = {
  'accent-derived': 'Stress derived from the Hebrew accent',
  'written-accent': 'Accent retained from the Greek text',
  reviewed: 'Documented correction',
  'stress-unconfirmed': 'Syllables available; stress unconfirmed',
  'pronunciation-unconfirmed': 'Generated pronunciation; not corroborated',
  joined: 'Part of a maqaf-linked pronunciation group',
  unavailable: 'Pronunciation needs review',
  convention: 'Your chosen reading convention',
};

export function WordDetails({ token, book, aid, reference }: { token: Token; book: Book; aid: ReadingAid | undefined; reference: string }) {
  return <div className="word-details">
    <p className="modal-intro">{reference} · word in the original text</p>
    <div className={`detail-original ${book.language === 'he' ? 'hebrew' : 'greek'}`} dir={book.language === 'he' ? 'rtl' : 'ltr'} lang={book.language}>{token.prefix}{token.text}{token.suffix}</div>
    {!aid ? <p className="inline-error">Reading aids are unavailable for this word. The original text is still available.</p> : <>
      <div className="detail-pronunciation"><Pronunciation aid={aid}/></div>
      <dl className="aid-facts">
        <dt>Literal meaning</dt><dd>{aid.gloss || 'Meaning needs review'}</dd>
        {aid.components?.length ? <><dt>Word components</dt><dd>{aid.components.join(' / ')}</dd></> : null}
        {aid.lemma && <><dt>Dictionary form</dt><dd dir="auto">{aid.lemma}</dd></>}
        {aid.grammar && <><dt>Grammar</dt><dd>{aid.grammar}</dd></>}
        <dt>Reading guide</dt><dd>{statusLabels[aid.pronunciation.status]}{aid.pronunciation.note && <p>{aid.pronunciation.note}</p>}</dd>
        <dt>Meaning source</dt><dd>{aid.glossStatus === 'reviewed' ? 'Documented correction or reviewed alternative' : aid.glossStatus === 'source-aligned' ? 'Source gloss aligned to this word' : 'Unresolved'}</dd>
        <dt>Sources</dt><dd>{aid.sources.map((id, i) => <span key={id}>{i > 0 ? ' · ' : ''}{aidSources[id] ? <a href={aidSources[id].href} target="_blank" rel="noreferrer">{aidSources[id].title}</a> : id}</span>)}{aid.sourceRef && <p className="small muted">Source reference: {aid.sourceRef}</p>}</dd>
      </dl>
      {aid.notes?.map((note, i) => <p className="aid-note" key={i}>{note}</p>)}
    </>}
    <p className="small muted">A short gloss describes this word in context; it is not a polished English translation. Bold syllables mark supported stress or the selected Yahweh reading convention.</p>
  </div>;
}
