import { createRoot } from 'react-dom/client';
import { App } from './App';
import { loadCorpus } from './corpus';
import { appPath } from './paths';
import { initialProgress, validateProgress } from './model';
import { loadProgress } from './storage';
import './styles.css';

const root = createRoot(document.getElementById('root')!);
root.render(<div className="boot"><img src={appPath('/icon.svg')} alt="" width="52"/><h1>Bible Memory</h1><p>Opening your place…</p></div>);
async function boot() {
  try {
    const [corpus, saved] = await Promise.all([loadCorpus(), loadProgress()]);
    const progress = saved === undefined ? initialProgress(corpus) : validateProgress(saved, corpus);
    root.render(<App corpus={corpus} initial={progress}/>);
  } catch (error) {
    root.render(<div className="boot"><h1>Your place is protected.</h1><p role="alert">{error instanceof Error ? error.message : 'Unable to open local progress.'}</p><p>Existing saved progress has not been replaced.</p><button onClick={() => location.reload()}>Retry</button></div>);
  }
}
// One writer prevents a second tab from overwriting newer progress.
if (navigator.locks) {
  void navigator.locks.request('bible-memory-writer', { ifAvailable: true }, async lock => {
    if (!lock) { root.render(<div className="boot"><h1>Already open elsewhere</h1><p>Close the other Bible Memory tab, then return to your place here.</p><button onClick={() => location.reload()}>Try again</button></div>); return; }
    await boot();
    await new Promise(() => {});
  });
} else { void boot(); }
