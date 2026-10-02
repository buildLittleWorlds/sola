import { loadCorpus } from './corpus';
import { loadProgress } from './storage';
import { buildCircuit, validateProgress } from './model';
import { restartStoredProgress } from './restart-progress';
import type { Corpus } from './types';
import './restart.css';

const button = document.getElementById('restart') as HTMLButtonElement;
const place = document.getElementById('place')!;
const message = document.getElementById('message')!;
const next = document.getElementById('continue')!;
let corpus: Corpus;
async function inspect() {
  try {
    const [text, saved] = await Promise.all([loadCorpus(), loadProgress()]);
    corpus = text;
    if (saved === undefined) {
      place.textContent = 'No saved progress was found in this browser.';
      message.textContent = 'Use the same browser or installed home-screen app where you practice. A new browser starts at Genesis 1 automatically.';
      return;
    }
    const progress = validateProgress(saved, corpus);
    const chapterId = buildCircuit(corpus)[progress.circuit.position];
    const chapter = corpus.chapters.find(c => c.id === chapterId)!;
    const book = corpus.books.find(b => b.id === chapter.bookId)!;
    place.textContent = `Saved place: ${book.name} ${chapter.number}. Your Genesis 1 target is ${progress.chapters['GEN.1'].wordCount} words.`;
    button.disabled = false;
  } catch (error) {
    place.textContent = 'Could not read your saved place.';
    message.textContent = error instanceof Error ? error.message : 'Reconnect and reload this page.';
  }
}
button.addEventListener('click', async () => {
  button.disabled = true; message.textContent = 'Saving your restart…';
  try {
    if (!navigator.locks) throw new Error('Please use a browser with Web Locks support to restart safely. No progress has been changed.');
    await navigator.locks.request('sola-writer', { ifAvailable: true }, async lock => {
      if (!lock) throw new Error('Close the other Sola tab or app window, then press Restart again. Your progress has not been changed.');
      const restarted = await restartStoredProgress(corpus);
      place.textContent = `Saved place: Genesis 1. Your ${restarted.chapters['GEN.1'].wordCount}-word target is unchanged.`;
    });
    message.textContent = 'Saved. Your next review starts at Genesis 1. All word targets and review history are preserved.';
    button.textContent = 'Restart saved';
    next.textContent = 'Continue at Genesis 1';
    next.classList.add('continue-ready');
    next.focus();
  } catch (error) {
    message.textContent = error instanceof Error ? error.message : 'The restart could not be saved. Please retry.';
    button.disabled = false;
  }
});
void inspect();
