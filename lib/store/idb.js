/**
 * A tiny promise wrapper over IndexedDB.
 *
 * It used to hold the loaded dataset, so a refresh or a direct link to
 * /dashboard could rehydrate it. It no longer does: a session now lives only as
 * long as the tab, because a spreadsheet left in browser storage after the tab
 * closed outlived the reason it was opened and came back for whoever used the
 * machine next.
 *
 * What remains is the clearing. The keys are still named so that a browser
 * carrying a session written by an earlier build can be emptied on the next
 * visit rather than quietly keeping it forever.
 */
const DB_NAME = 'insight-analytics';
const DB_VERSION = 1;
const STORE = 'session';

let dbPromise = null;

function open() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    // Private-browsing modes and blocked storage should degrade to in-memory only.
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
  return dbPromise;
}

export async function idbGet(key) {
  const db = await open();
  if (!db) return null;
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => resolve(null);
  });
}

export async function idbSet(key, value) {
  const db = await open();
  if (!db) return false;
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve(true);
    // Quota exceeded on a very large dataset is survivable — the session just
    // won't persist across a refresh.
    tx.onerror = () => resolve(false);
    tx.onabort = () => resolve(false);
  });
}

export async function idbDel(key) {
  const db = await open();
  if (!db) return;
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

/** The keys an earlier build wrote, and that are now cleared on boot. */
export const KEYS = {
  dataset: 'dataset',
  analysis: 'analysis',
  measures: 'measures',
};
