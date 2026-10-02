import type { Progress } from './types';
export const DATABASE = 'sola';
export function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('state');
    request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
    request.onerror = () => reject(request.error || new Error('Local storage is unavailable.'));
    request.onblocked = () => reject(new Error('Close other Sola tabs and retry.'));
  });
}
export async function loadProgress(): Promise<unknown | undefined> {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction('state', 'readonly');
      const request = transaction.objectStore('state').get('progress');
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error('Read cancelled.'));
    });
  } finally { db.close(); }
}
export async function saveProgress(progress: Progress): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('state', 'readwrite', { durability: 'strict' });
      transaction.objectStore('state').put(progress, 'progress');
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error('Could not save progress.'));
      transaction.onabort = () => reject(transaction.error || new Error('Save cancelled.'));
    });
  } finally { db.close(); }
}
