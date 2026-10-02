import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, Bookmark, Check, ChevronRight, Download, Eye, EyeOff, Library, Plus, RotateCcw, Search, Settings2, ShieldCheck, Upload, X } from 'lucide-react';
import type { Backup, Book, Chapter, ChapterMeta, Corpus, Progress, ReadingAid } from './types';
import { advance, buildCircuit, displayHebrew, makeBackup, parseBackup, retreat, setEndpoint } from './model';
import { loadChapter } from './corpus';
import { appPath } from './paths';
import { saveProgress } from './storage';
import { aidKey, AIDS_RELEASE, loadChapterAids } from './aids';
import { WordDetails, WordGroups } from './ReadingAids';

type Panel = 'library' | 'settings' | 'sources' | 'word' | null;
const number = (n: number) => n.toLocaleString('en-US');

function Modal({ title, children, close }: { title: string; children: ReactNode; close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} onCancel={close} onClick={e => { if (e.target === ref.current) close(); }}>
    <div className="modal-heading"><h2>{title}</h2><button className="icon-button" onClick={close} aria-label="Close dialog"><X size={21}/></button></div>{children}
  </dialog>;
}

function Passage({ chapter, book, count, full, settings, newStart, choose, aids, showDetails }: {
  chapter: Chapter; book: Book; count: number; full: boolean; settings: Progress['settings']; newStart: number | null; choose: (n: number) => void;
  aids: Record<string, ReadingAid> | null; showDetails: (index: number) => void;
}) {
  const limit = full ? chapter.tokens.length : count;
  const tokens = chapter.tokens.slice(0, limit);
  const transform = (s: string) => book.language === 'he' ? displayHebrew(s, settings.cantillation) : s;
  const variants = chapter.variants.filter(v => full || v.at < count);
  return <>
    <div data-testid="passage" className={`passage ${full ? 'full-passage' : ''} ${book.language === 'he' ? 'hebrew' : 'greek'}`} dir={book.language === 'he' ? 'rtl' : 'ltr'} lang={book.language} style={{ fontSize: `${settings.fontSize}px` }}>
      {!full ? <WordGroups chapter={chapter} book={book} count={count} settings={settings} newStart={newStart} aids={aids} showDetails={showDetails}/> : chapter.verses.filter(v => tokens.some(t => t.verse === v)).map(verse => <span className="verse" key={verse}>
        <sup className="verse-number" dir="ltr" aria-label={`Verse ${verse}`}>{verse}</sup>
        {chapter.markers.filter(m => m.verse === verse && m.after === 0).map((m, i) => <span className="text-marker" key={`pre-${i}`}>{m.text} </span>)}
        {tokens.map((token, i) => token.verse !== verse ? null : <span key={`${verse}:${token.sourceIndex}`}>
          {full ? <button className={`word-select ${i < count ? 'in-target' : ''} ${i === count - 1 ? 'endpoint' : ''}`} aria-label={`Set endpoint to word ${i + 1}: ${transform(token.text)}`} title={`End here · word ${i + 1}`} onClick={() => choose(i + 1)}>{token.prefix}{transform(token.text)}{token.suffix}</button>
            : <span className={newStart !== null && i >= newStart ? 'new-word' : undefined}>{token.prefix}{transform(token.text)}{token.suffix}</span>}
          {chapter.markers.filter(m => m.verse === verse && m.after === i + 1).map((m, j) => <span className="text-marker" title={m.kind === 'pe' ? 'Open paragraph' : m.kind === 'samekh' ? 'Closed paragraph' : 'Inverted nun'} key={j}> {m.text}</span>)}
          {token.text.endsWith('־') ? '\u200B' : ' '}
        </span>)}
      </span>)}
    </div>
    {variants.length > 0 && <details className="text-notes"><summary>Reading & written forms <span>{variants.length}</span></summary>
      <p>The reading form (qere) is used above. Written forms (ketiv) remain here for reference.</p>
      {variants.map((v, i) => <div className="variant-row" key={i}><span>Verse {v.verse}</span><span>Read <b lang="he" dir="rtl">{v.read.join(' ') || '— not read —'}</b></span><span>Written <b lang="he" dir="rtl">{v.written.join(' ') || '— not written —'}</b></span></div>)}
    </details>}
    {full && chapter.notes.length > 0 && <details className="text-notes"><summary>Source annotations <span>{chapter.notes.length}</span></summary><p>Original transcription note codes and special-letter annotations, kept separate from recall text. The source archive retains their full context.</p>{chapter.notes.map((n, i) => <p key={i}>Verse {n.verse}: {n.code ? `note ${n.code}` : `special letter ${n.specialLetter} (${JSON.stringify(n.attributes)})`}</p>)}</details>}
  </>;
}

export function App({ corpus, initial }: { corpus: Corpus; initial: Progress }) {
  const [progress, setProgress] = useState(initial);
  const [browseId, setBrowseId] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [full, setFull] = useState(false);
  const [newStart, setNewStart] = useState<number | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [query, setQuery] = useState('');
  const [testament, setTestament] = useState<'all' | 'OT' | 'NT'>('all');
  const [chapter, setChapter] = useState<Chapter | null>(null);
  const [aids, setAids] = useState<Record<string, ReadingAid> | null>(null);
  const [aidsError, setAidsError] = useState('');
  const [aidsRetry, setAidsRetry] = useState(0);
  const [selectedWord, setSelectedWord] = useState<number | null>(null);
  const [textError, setTextError] = useState('');
  const [retryText, setRetryText] = useState(0);
  const [saveState, setSaveState] = useState<'saving' | 'saved' | 'error'>('saving');
  const [saveError, setSaveError] = useState('');
  const [retrySave, setRetrySave] = useState(0);
  const [offline, setOffline] = useState('Preparing offline access…');
  const [importPreview, setImportPreview] = useState<Backup | null>(null);
  const [importError, setImportError] = useState('');
  const [notice, setNotice] = useState('');
  const saveQueue = useRef(Promise.resolve());
  const revision = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const refreshChapter = useRef<string | null>(null);
  const refreshAids = useRef<string | null>(null);
  const circuit = useMemo(() => buildCircuit(corpus), [corpus]);
  const bookMap = useMemo(() => new Map(corpus.books.map(b => [b.id, b])), [corpus]);
  const chapterMap = useMemo(() => new Map(corpus.chapters.map(c => [c.id, c])), [corpus]);
  const id = browseId ?? circuit[progress.circuit.position];
  const meta = chapterMap.get(id)!;
  const book = bookMap.get(meta.bookId)!;
  const current = progress.chapters[id];
  const label = (chapterId: string) => { const c = chapterMap.get(chapterId)!; return `${bookMap.get(c.bookId)!.name} ${c.number}`; };
  const browseIndex = corpus.chapters.findIndex(c => c.id === id);
  const nextId = browseId ? corpus.chapters[(browseIndex + 1) % corpus.chapters.length].id : circuit[(progress.circuit.position + 1) % circuit.length];
  const visitedCount = Object.values(progress.chapters).filter(c => c.visits > 0).length;
  const extendedCount = corpus.chapters.filter(c => progress.chapters[c.id].wordCount > Math.min(3, c.wordCount)).length;
  const targetWords = Object.values(progress.chapters).reduce((sum, c) => sum + c.wordCount, 0);

  useLayoutEffect(() => {
    const rev = ++revision.current;
    setSaveState('saving');
    saveQueue.current = saveQueue.current.catch(() => {}).then(() => saveProgress(progress));
    void saveQueue.current.then(() => { if (revision.current === rev) { setSaveState('saved'); setSaveError(''); } }, error => {
      if (revision.current === rev) { setSaveState('error'); setSaveError(error instanceof Error ? error.message : 'Local storage is unavailable.'); }
    });
  }, [progress, retrySave]);

  useLayoutEffect(() => {
    if (saveState === 'saved') return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [saveState]);

  useLayoutEffect(() => {
    let cancelled = false;
    setChapter(null); setTextError(''); setRevealed(false); setFull(false); setNewStart(null); setSelectedWord(null);
    setPanel(p => p === 'word' ? null : p);
    const fresh = refreshChapter.current === id;
    refreshChapter.current = null;
    void loadChapter(id, fresh).then(ch => { if (!cancelled) setChapter(ch); }, error => { if (!cancelled) setTextError(error instanceof Error ? error.message : 'The book could not be loaded. Retry the download.'); });
    return () => { cancelled = true; };
  }, [id, retryText]);

  useLayoutEffect(() => {
    let cancelled = false;
    setAids(null); setAidsError('');
    const fresh = refreshAids.current === id;
    refreshAids.current = null;
    void loadChapterAids(id, corpus, fresh).then(data => { if (!cancelled) setAids(data); }, error => {
      if (!cancelled) { setAids({}); setAidsError(error instanceof Error ? error.message : 'Reading aids could not be loaded.'); }
    });
    return () => { cancelled = true; };
  }, [id, corpus, aidsRetry]);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) { setOffline('Local text · offline caching unavailable'); return; }
    if (import.meta.env.DEV) { setOffline('Local text · development mode'); return; }
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === 'OFFLINE_READY' && e.data.aidVersion === AIDS_RELEASE) setOffline('All 66 books available offline');
      if (e.data?.type === 'OFFLINE_ERROR') setOffline('Offline download incomplete · reconnect and reopen to retry');
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    void navigator.serviceWorker.register(appPath('/sw.js')).then(async registration => {
      const ask = () => { registration.active?.postMessage({ type: 'OFFLINE_STATUS' }); registration.waiting?.postMessage({ type: 'OFFLINE_STATUS' }); };
      const watch = () => {
        const installing = registration.installing;
        installing?.addEventListener('statechange', () => {
          if (installing.state === 'installed' || installing.state === 'activated') ask();
          if (installing.state === 'redundant') setOffline('Offline download incomplete · reconnect and reopen to retry');
        });
      };
      registration.addEventListener('updatefound', watch);
      watch(); ask();
      const ready = await navigator.serviceWorker.ready;
      ready.active?.postMessage({ type: 'OFFLINE_STATUS' });
    }).catch(() => setOffline('Offline cache unavailable · local server still works'));
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, []);

  function retryChapter() { refreshChapter.current = id; setRetryText(n => n + 1); }
  function retryAids() { refreshAids.current = id; setAidsRetry(n => n + 1); }

  function next() {
    if (!chapter) return;
    setProgress(p => advance(p, id, browseId === null));
    if (browseId) setBrowseId(nextId);
    setNotice('');
  }
  function previous() {
    if (browseId) setBrowseId(corpus.chapters[(browseIndex - 1 + corpus.chapters.length) % corpus.chapters.length].id);
    else setProgress(retreat);
    setNotice('');
  }
  function chooseEndpoint(requested: number, closeFull = false) {
    const clamped = Math.min(meta.wordCount, Math.max(1, requested));
    setNewStart(clamped > current.wordCount ? current.wordCount : null);
    setProgress(p => setEndpoint(p, meta, clamped)); setRevealed(true);
    if (closeFull) setFull(false);
    setNotice(`Target set to ${clamped} words.`);
  }
  function resume() { setBrowseId(null); setPanel(null); setNotice(''); }
  function download() {
    const blob = new Blob([JSON.stringify(makeBackup(progress), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `sola-${new Date().toISOString().slice(0, 10)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function readBackup(file: File | undefined) {
    setImportError(''); setImportPreview(null);
    if (!file) return;
    try {
      if (file.size > 5_000_000) throw new Error('This file is too large to be a Sola backup.');
      setImportPreview(parseBackup(await file.text(), corpus));
    } catch (error) { setImportError(error instanceof Error ? error.message : 'Could not read that backup.'); }
    if (fileInput.current) fileInput.current.value = '';
  }
  function applyImport() {
    if (!importPreview) return;
    setProgress(importPreview.progress); setBrowseId(null); setRevealed(false); setFull(false); setNewStart(null); setImportPreview(null); setPanel(null); setNotice('Backup restored.');
  }
  useLayoutEffect(() => {
    const handle = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (panel || e.ctrlKey || e.metaKey || e.altKey || e.repeat || target.closest('input, textarea, select, [contenteditable="true"], summary')) return;
      if (e.code === 'Space') { e.preventDefault(); if (chapter) { setRevealed(v => !v); setFull(false); } }
      else if (e.key.toLowerCase() === 'n') { e.preventDefault(); next(); }
      else if (e.key.toLowerCase() === 'p') { e.preventDefault(); previous(); }
    };
    window.addEventListener('keydown', handle); return () => window.removeEventListener('keydown', handle);
  });

  const filteredBooks = corpus.books.filter(b => {
    const normalized = query.toLowerCase().trim();
    return (testament === 'all' || b.testament === testament) && (!normalized || b.name.toLowerCase().includes(normalized.replace(/\s+\d+$/, '')) || b.id.toLowerCase() === normalized);
  });
  function bookChapters(b: Book): ChapterMeta[] {
    const match = query.trim().match(/\s+(\d+)$/);
    return corpus.chapters.filter(c => c.bookId === b.id && (!match || c.number === Number(match[1])));
  }

  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="#" onClick={e => { e.preventDefault(); resume(); }}><span className="brand-mark"><BookOpen size={22}/></span><span>Sola<small>WORD BY WORD</small></span></a>
      <div className="sidebar-section-label">YOUR PRACTICE</div>
      <nav aria-label="Main navigation">
        <button className={!browseId ? 'nav-item active' : 'nav-item'} onClick={resume}><BookOpen size={19}/>Review circuit<ChevronRight size={15}/></button>
        <button className={browseId ? 'nav-item active' : 'nav-item'} onClick={() => setPanel('library')}><Library size={19}/>Chapter library</button>
        <button className="nav-item" onClick={() => setPanel('settings')}><Settings2 size={19}/>Settings & backup</button>
      </nav>
      <div className="sidebar-cycle"><span className="overline">CIRCUIT {progress.circuit.round}</span><p>A little further,<br/>each time around.</p><div className="progress-track"><span style={{ width: `${progress.circuit.position / 1189 * 100}%` }}/></div><span className="small muted">Position {number(progress.circuit.position + 1)} of 1,189</span></div>
      <div className="sidebar-bottom"><span className={`save-indicator ${saveState === 'error' ? 'error' : ''}`} aria-live="polite">{saveState === 'saved' ? <Check size={14}/> : <span className="status-dot"/>}{saveState === 'saved' ? 'Progress saved on this device' : saveState === 'saving' ? 'Saving your place…' : 'Progress not saved'}</span><button className="text-link" onClick={() => setPanel('sources')}>Texts & sources <ArrowRight size={13}/></button></div>
    </aside>

    <main>
      <header className="topbar"><div><span className="breadcrumb">Your practice</span><ChevronRight size={14}/><span>{browseId ? 'Chapter library' : 'Review circuit'}</span></div><span className="local-badge"><ShieldCheck size={15}/> Personal & local</span></header>
      <div className="workspace">
        {saveState === 'error' && <div className="error-banner" role="alert"><strong>Your latest changes have not been saved.</strong><span>{saveError} Keep this tab open and export a backup.</span><div><button onClick={() => setRetrySave(n => n + 1)}>Retry save</button><button onClick={download}>Export current progress</button></div></div>}
        <div className="page-heading"><div><div className="overline">{browseId ? 'EXPLORE AT YOUR OWN PACE' : 'A GROWING PASSAGE IN EVERY CHAPTER'}</div><h1>{browseId ? 'Chapter practice' : 'Return to the words.'}</h1><p>{browseId ? 'Your circuit is waiting right where you left it.' : 'Recall what you know. Reveal to check. Add a little when you’re ready.'}</p></div><button className="outline-button browse-button" onClick={() => setPanel('library')}><Library size={17}/> Browse chapters</button></div>
        {browseId && <div className="browse-banner"><Bookmark size={17}/><span>Browsing independently · circuit paused at {label(circuit[progress.circuit.position])}</span><button onClick={resume}>Resume circuit <ArrowRight size={15}/></button></div>}
        <section className="review-card" aria-label="Chapter review">
          <div className="review-topline"><span className={`testament-tag ${book.testament === 'NT' ? 'nt' : ''}`}>{book.testament === 'OT' ? 'OLD TESTAMENT' : 'NEW TESTAMENT'}<span/> {book.language === 'he' ? 'HEBREW / ARAMAIC' : 'GREEK'}</span><span className="position-label">{browseId ? 'FREE PRACTICE' : `${number(progress.circuit.position + 1)} / 1,189`}</span></div>
          <div className="chapter-heading"><h2 data-testid="chapter-title">{label(id)}</h2><span className="edition-label">{book.edition} · source numbering</span></div>
          <div className="target-row"><span><Bookmark size={14}/> Your passage: first <strong>{current.wordCount} words</strong></span><span className="target-divider"/><span>{chapter ? `${meta.verseCount} verses in this chapter` : 'Loading text…'}</span></div>
          <div className={`reading-area ${full ? 'expanded' : ''}`}>
            {textError ? <div className="text-error" role="alert"><p>{textError}</p><button onClick={retryChapter}>Retry chapter</button></div> : !chapter ? <div className="chapter-loading" role="status"><p>Opening chapter…</p><button className="outline-button" onClick={retryChapter}>Retry chapter</button><p className="small muted">If the download stalls, retry here. Your place is saved.</p></div> : !revealed && !full ? <div className="recall-prompt"><div className="recall-icon"><BookOpen size={31} strokeWidth={1.25}/></div><h3>Take a moment to recall.</h3><p>Recite your passage, then reveal the words.</p><button aria-label="Reveal passage" aria-keyshortcuts="Space" className="primary-button reveal-large" onClick={() => setRevealed(true)}><Eye size={18}/> Reveal passage <kbd>Space</kbd></button></div> : <div className="visible-passage"><div className="passage-caption">{full ? 'CHOOSE A WORD TO SET YOUR STOPPING POINT' : newStart !== null ? 'YOUR PASSAGE · NEW WORDS HIGHLIGHTED' : 'YOUR PASSAGE'}</div><Passage chapter={chapter} book={book} count={current.wordCount} full={full} settings={progress.settings} newStart={newStart} choose={n => chooseEndpoint(n, true)} aids={aids} showDetails={index => { setSelectedWord(index); setPanel('word'); }}/>{!full && aidsError && <div className="aid-load-error" role="alert">{aidsError} <button onClick={retryAids}>Retry reading aids</button></div>}{!full && <button aria-label="Hide passage" aria-keyshortcuts="Space" className="text-link hide-button" onClick={() => setRevealed(false)}><EyeOff size={15}/> Hide passage <kbd>Space</kbd></button>}</div>}
          </div>
          <div className="growth-bar"><div><span className="growth-label">GROW YOUR PASSAGE</span><div className="step-controls"><button aria-label="Remove one word" disabled={!chapter || current.wordCount <= 1} onClick={() => chooseEndpoint(current.wordCount - 1)}>−</button><span>{current.wordCount} <span className="muted">words</span></span><button aria-label="Add one word" disabled={!chapter || current.wordCount >= meta.wordCount} onClick={() => chooseEndpoint(current.wordCount + 1)}>+</button></div></div><button className="add-button" disabled={!chapter || current.wordCount >= meta.wordCount} onClick={() => chooseEndpoint(current.wordCount + progress.settings.increment)}><Plus size={17}/>{current.wordCount >= meta.wordCount ? 'Whole chapter selected' : `Add ${Math.min(progress.settings.increment, meta.wordCount - current.wordCount)} words`}</button><button className="full-chapter-button" disabled={!chapter} onClick={() => { setFull(v => !v); setRevealed(true); }}>{full ? 'Back to my passage' : 'View full chapter'}<ChevronRight size={15}/></button></div>
        </section>
        <div className="navigation-row"><button aria-label="Previous" aria-keyshortcuts="P" className="previous-button" disabled={!browseId && progress.circuit.position === 0 && progress.circuit.round === 1} onClick={previous}><ArrowLeft size={17}/> Previous <kbd>P</kbd></button><span className="next-preview">UP NEXT <strong>{label(nextId)}</strong></span><button aria-label="Next chapter" aria-keyshortcuts="N" className="primary-button next-button" disabled={!chapter} onClick={next}>Next chapter <kbd>N</kbd><ArrowRight size={18}/></button></div>
        <div className="practice-footnote"><span><span className="tiny-dot"/> {offline}</span><span>{current.visits === 0 ? 'No visits recorded yet' : `${number(current.visits)} ${current.visits === 1 ? 'visit' : 'visits'} recorded`} · you decide when to grow</span></div>
        <div className="sr-only" aria-live="polite">{notice}</div>
      </div>
    </main>

    {panel === 'word' && selectedWord !== null && chapter?.tokens[selectedWord] && <Modal title="Word details" close={() => setPanel(null)}><WordDetails token={chapter.tokens[selectedWord]} book={book} aid={aids?.[aidKey(chapter.tokens[selectedWord].verse, chapter.tokens[selectedWord].sourceIndex)]} reference={`${label(id)}:${chapter.tokens[selectedWord].verse}`}/></Modal>}

    {panel === 'library' && <Modal title="Chapter library" close={() => setPanel(null)}><p className="modal-intro">Practice any chapter without moving your place in the circuit.</p><div className="library-stats"><div><strong>{number(visitedCount)}</strong><span>chapters visited</span></div><div><strong>{number(extendedCount)}</strong><span>targets extended</span></div><div><strong>{number(targetWords)}</strong><span>words in your targets</span></div></div><p className="small muted">Targets describe what you’re practicing, not a mastery score.</p><label className="search-field"><Search size={18}/><input autoFocus aria-label="Find a chapter" placeholder="Find a book or chapter, e.g. John 3" value={query} onChange={e => setQuery(e.target.value)}/></label><div className="filter-tabs">{(['all','OT','NT'] as const).map(t => <button key={t} aria-pressed={testament === t} onClick={() => setTestament(t)}>{t === 'all' ? 'All chapters' : t === 'OT' ? 'Old Testament' : 'New Testament'}</button>)}</div><div className="library-list">{filteredBooks.length === 0 && <p>No matching books. Try a book name, such as Genesis or John.</p>}{filteredBooks.map(b => <section key={b.id} className="book-section"><h3>{b.name}<span>{b.edition}</span></h3><div className="chapter-grid">{bookChapters(b).map(c => <button key={c.id} className={c.id === id ? 'selected' : ''} aria-label={`Practice ${b.name} ${c.number}`} title={`${progress.chapters[c.id].wordCount} words · ${progress.chapters[c.id].visits} visits`} onClick={() => { setBrowseId(c.id); setPanel(null); setRevealed(false); setFull(false); setNewStart(null); }}><strong>{c.number}</strong><span>{progress.chapters[c.id].wordCount}w</span>{progress.chapters[c.id].visits > 0 && <span className="visited-dot"/>}</button>)}</div>{bookChapters(b).length === 0 && <p className="muted small">No chapter with that number in this book’s source edition.</p>}</section>)}</div><div className="modal-footer"><button className="outline-button" onClick={resume}><RotateCcw size={16}/> Resume circuit at {label(circuit[progress.circuit.position])}</button></div></Modal>}

    {panel === 'settings' && <Modal title="Make room for your practice" close={() => { setPanel(null); setImportPreview(null); }}><p className="modal-intro">Small adjustments, saved with your place.</p><section className="settings-section"><h3>Reading & growth</h3><label className="setting-row"><span>Words to add at a time<small>Each chapter still grows only when you choose.</small></span><select aria-label="Words to add at a time" value={progress.settings.increment} onChange={e => setProgress(p => ({ ...p, settings: { ...p.settings, increment: Number(e.target.value) } }))}>{Array.from({ length: 50 }, (_, i) => i + 1).map(n => <option key={n} value={n}>{n} {n === 1 ? 'word' : 'words'}</option>)}</select></label><label className="setting-row"><span>Text size<small>{progress.settings.fontSize} pixels</small></span><input aria-label="Text size" type="range" min="24" max="72" step="1" value={progress.settings.fontSize} onChange={e => setProgress(p => ({ ...p, settings: { ...p.settings, fontSize: Number(e.target.value) } }))}/></label><label className="setting-row"><span>Hebrew cantillation<small>Vowels remain visible in either setting.</small></span><input type="checkbox" aria-label="Show Hebrew cantillation" checked={progress.settings.cantillation} onChange={e => setProgress(p => ({ ...p, settings: { ...p.settings, cantillation: e.target.checked } }))}/></label></section><section className="settings-section"><h3>Reading aids on Reveal</h3><p>Meanings follow the original word order. Tap a revealed word for its components, grammar, and source.</p>{([{ key: 'showGlosses', label: 'Show literal meanings' }, { key: 'showHebrewTransliteration', label: 'Show Hebrew transliteration' }, { key: 'showGreekTransliteration', label: 'Show Greek transliteration' }] as const).map(({ key, label }) => <label className="setting-row" key={key}><span>{label}</span><input type="checkbox" aria-label={label} checked={progress.settings[key]} onChange={e => setProgress(p => ({ ...p, settings: { ...p.settings, [key]: e.target.checked } }))}/></label>)}<details className="pronunciation-key"><summary>How to read the pronunciation guide</summary><p>Hyphens separate syllables. <strong>Bold</strong> marks a supported accented syllable. Hebrew uses classroom spellings: <b>sh</b> as in ship; <b>kh</b> as in Bach; <b>ts</b> as in cats; <b>q</b> has a k sound; a/e/i/o/u are roughly ah/eh/ee/oh/oo. A short e can represent a vocal sheva. This is a reading aid, not a reconstruction of ancient speech.</p><p><strong>YAH</strong>-weh is your chosen convention for יהוה; its vowels and stress are not inferred mechanically from the Hebrew pointing. A word joined by maqaf may share the following word’s accent.</p><p>Greek uses scholarly spellings, including ē for eta and ō for omega, and preserves the written accents rather than adding new ones. “Stress unconfirmed” and “Pronunciation unconfirmed” identify unresolved cases; those are not instructions to stress the last syllable.</p></details></section><section className="settings-section"><h3>Restart the chapter order</h3><p>Return to Genesis 1 while keeping your word targets, settings, and review history. Nothing resets until you confirm on the next screen.</p><button className="outline-button" disabled={saveState !== 'saved'} onClick={() => location.assign(appPath('/restart.html'))}><RotateCcw size={16}/> Restart at Genesis 1</button></section><section className="settings-section"><h3>Keep a copy of your progress</h3><p>Your place lives in this browser on this computer. Export a backup before clearing browser data or moving to another browser.</p><div className="backup-buttons"><button className="outline-button" onClick={download}><Download size={17}/> Export backup</button><button className="outline-button" onClick={() => fileInput.current?.click()}><Upload size={17}/> Import backup</button><input ref={fileInput} type="file" accept="application/json,.json" aria-label="Backup file" className="sr-only" onChange={e => void readBackup(e.target.files?.[0])}/></div>{importError && <p className="inline-error" role="alert">{importError}</p>}{importPreview && <div className="import-preview"><h4>Review this backup</h4><p>Exported {new Date(importPreview.exportedAt).toLocaleString()}.</p><p>Circuit {importPreview.progress.circuit.round}, position {number(importPreview.progress.circuit.position + 1)} · {label(circuit[importPreview.progress.circuit.position])}</p><p>{number(Object.values(importPreview.progress.chapters).filter(c => c.visits > 0).length)} chapters visited. All 1,189 chapter targets and the text version were validated.</p><strong>Restoring replaces this browser’s progress and settings.</strong><div className="backup-buttons"><button className="primary-button" onClick={applyImport}>Replace with this backup</button><button className="outline-button" onClick={() => setImportPreview(null)}>Cancel</button></div></div>}</section><section className="settings-section"><h3>At your fingertips</h3><div className="shortcut-list"><span><kbd>Space</kbd> Reveal / hide</span><span><kbd>N</kbd> Next chapter</span><span><kbd>P</kbd> Previous chapter</span></div><p className="small muted">Shortcuts pause while a dialog is open or you’re typing.</p></section></Modal>}

    {panel === 'sources' && <Modal title="The words you’re learning" close={() => setPanel(null)}><p className="modal-intro">Fixed editions, bundled on your computer. The app never silently updates your memorized text.</p><section className="settings-section"><h3>Hebrew & Aramaic · UXLC 2.5</h3><p>Unicode/XML Leningrad Codex, build 27.6, April 2026. Published by Tanach.us Inc.; derived from WLC 4.20, with subsequent corrections. This edition is UXLC, not WLC.</p><p>Uses the source’s chapter and verse divisions, including Joel 1–4 and Malachi 1–3. Original Aramaic passages are retained. Reading forms are used for recall; written variants are available alongside the text.</p><p><a href="https://www.tanach.us/" target="_blank" rel="noreferrer">Publisher & source</a> · <a href="/licenses/UXLC.txt" target="_blank">Bundled copying terms</a></p></section><section className="settings-section"><h3>Greek · SBLGNT 1.2</h3><p>Edited by Michael W. Holmes. Copyright 2010 Society of Biblical Literature and Logos Bible Software. Licensed under Creative Commons Attribution 4.0 International.</p><p>Greek punctuation and editorial marks are retained. Verse numbers follow the edition; gaps are not filled with text from another edition. Words and prefixes/suffixes have been reorganized for interactive display, without changing the source wording.</p><p><a href="https://github.com/Faithlife/SBLGNT" target="_blank" rel="noreferrer">Publisher’s source files</a> · <a href="/licenses/SBLGNT.txt" target="_blank">Bundled CC BY 4.0 license</a></p></section><section className="settings-section"><h3>Literal meanings & pronunciation</h3><p>The aids are prepared locally for these exact text editions. Hebrew and Aramaic glosses come from STEPBible TAHOT. Greek glosses use MACULA’s SBLGNT annotations, using public-domain Berean interlinear glosses, with checked alternatives from STEPBible TAGNT. Short glosses retain word components and grammatical markers; they are not a polished English translation.</p><p>Hebrew syllables are generated from the fully pointed selected reading and compared with TAHOT. Stress is supported by an unambiguous source accent or a documented correction; uncertain cases remain flagged. Greek syllables and accents come from the original Greek via greek-accentuation. Yahweh is the chosen reading convention.</p><p><a href={appPath('/aids/manifest.json')} target="_blank">Reading-aid versions and sources</a> · <a href={appPath('/aids/audit.json')} target="_blank">Coverage and unresolved cases</a> · <a href="/licenses/reading-aids.txt" target="_blank">Attribution and licenses</a></p><p className="small muted">Source alignment is not a claim that every pronunciation was human-reviewed. All aids are included in the offline cache; no external service is called when you reveal a passage.</p></section><section className="settings-section"><h3>Display & word boundaries</h3><p>Each source word is one step, including Hebrew words joined by a maqaf. Punctuation and paragraph markers do not add steps. Cantillation can be hidden for display; vowels, original wording, and the stored source remain intact.</p><p>Noto Serif Hebrew and Gentium Plus are bundled under the SIL Open Font License: <a href={appPath('/fonts/NotoSerifHebrew-OFL.txt')} target="_blank">Hebrew font license</a> · <a href={appPath('/fonts/GentiumPlus-OFL.txt')} target="_blank">Greek font license</a>.</p><p className="small muted">66 books · 1,189 chapters · {number(corpus.statistics.hebrewReadWords)} Hebrew/Aramaic reading words · {number(corpus.statistics.greekWords)} Greek words.</p><details><summary>Source identity</summary><p className="hash">{corpus.corpusId}<br/>SHA-256: {corpus.contentHash}<br/>Greek revision: {corpus.sources.greek.commit}</p><a href="/corpus/index.json" target="_blank">Corpus manifest</a></details></section></Modal>}
  </div>;
}
