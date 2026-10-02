import type { Corpus, Progress } from './types';
import { validateProgress } from './model';
import { openDatabase } from './storage';

export const LEGACY_RESTART_KEY = 'completed-action:owner-request-genesis-start-2026-09-27';

/** Explicit button action, never a startup or calendar-triggered rewind. */
export async function restartStoredProgress(corpus: Corpus): Promise<Progress> {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('state', 'readwrite', { durability: 'strict' });
      const state = tx.objectStore('state');
      const request = state.get('progress');
      let result: Progress;
      let failure: Error | null = null;
      request.onsuccess = () => {
        try {
          if (request.result === undefined) throw new Error('No saved progress was found in this browser. Open this page in the same browser or home-screen app where you practice.');
          const current = validateProgress(request.result, corpus);
          result = { ...current, circuit: { ...current.circuit, position: 0 } };
          state.put(result, 'progress');
          const record = { appliedAt: new Date().toISOString(), manual: true, previousCircuit: current.circuit };
          state.put(record, 'last-manual-restart');
          // A still-cached older app must not later repeat its retired startup reset.
          state.put(record, LEGACY_RESTART_KEY);
        } catch (error) { failure = error instanceof Error ? error : new Error('Could not validate the saved progress.'); tx.abort(); }
      };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error || new Error('Could not save the restart. Your existing progress is unchanged.'));
      tx.onabort = () => reject(failure || tx.error || new Error('Restart interrupted. Your existing progress is unchanged.'));
    });
  } finally { db.close(); }
}
