import type { Corpus } from './types';
import type { LinkedState } from './linked-types';
import { parseLinkedBackup, validateLinkedState } from './linked-validate';

/**
 * Linked Memory keeps its own database, separate from the circuit-era `sola` database, so the existing circuit
 * progress is never opened, migrated or cleared by this model. One record holds the whole state, so every change
 * (endpoint, coverage, ledger and cursor together) is a single atomic write.
 */
export const LINKED_DATABASE = 'sola-linked';
const STORE = 'state';
const KEY = 'linked-state';

export function openLinkedDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(LINKED_DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
    request.onerror = () => reject(request.error || new Error('Local storage is unavailable.'));
    request.onblocked = () => reject(new Error('Close other Sola tabs and retry.'));
  });
}

/** Runs `work` on the state store in one transaction. If `work` throws, the transaction aborts and nothing changes. */
async function transact<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore, done: (value: T) => void, fail: (error: Error) => void) => void): Promise<T> {
  const db = await openLinkedDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = mode === 'readwrite' ? db.transaction(STORE, mode, { durability: 'strict' }) : db.transaction(STORE, mode);
      let result: T, failure: Error | null = null;
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(failure || transaction.error || new Error('Storage failed.'));
      transaction.onabort = () => reject(failure || transaction.error || new Error('Storage was cancelled. Your saved data is unchanged.'));
      try {
        work(transaction.objectStore(STORE), value => { result = value; }, error => { failure = error; transaction.abort(); });
      } catch (error) { failure = error instanceof Error ? error : new Error('Storage failed.'); transaction.abort(); }
    });
  } finally { db.close(); }
}

/** The saved state, validated, or undefined if nothing has been saved. Corrupt data throws and is left untouched. */
export function loadLinkedState(corpus: Corpus): Promise<LinkedState | undefined> {
  return transact<LinkedState | undefined>('readonly', (store, done, fail) => {
    const request = store.get(KEY);
    request.onsuccess = () => {
      try { done(request.result === undefined ? undefined : validateLinkedState(request.result, corpus)); } catch (error) { fail(error as Error); }
    };
  });
}

/**
 * Read-modify-write in one transaction: validates the stored state (or starts from `initial`), applies the pure
 * `change`, validates the result, and writes it. If anything throws, nothing is written. Because the whole
 * read-modify-write is one transaction, two tabs or a double-click cannot interleave.
 */
export function updateLinkedState(corpus: Corpus, initial: () => LinkedState, change: (state: LinkedState) => LinkedState): Promise<LinkedState> {
  return transact<LinkedState>('readwrite', (store, done, fail) => {
    const request = store.get(KEY);
    request.onsuccess = () => {
      try {
        const current = request.result === undefined ? initial() : validateLinkedState(request.result, corpus);
        const next = validateLinkedState(change(current), corpus);
        store.put(next, KEY);
        done(next);
      } catch (error) { fail(error as Error); }
    };
  });
}

/** Replaces the saved state with a validated backup. A bad file throws before the database is touched. */
export async function importLinkedBackup(textContent: string, corpus: Corpus): Promise<LinkedState> {
  const { state } = parseLinkedBackup(textContent, corpus);
  await transact<void>('readwrite', (store, done) => { store.put(state, KEY); done(); });
  return state;
}
