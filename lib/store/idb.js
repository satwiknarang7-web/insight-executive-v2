/**
 * A tiny promise wrapper over IndexedDB.
 *
 * The dataset lives in the browser, not on a server, so a hard refresh or a
 * direct link to /dashboard has to be able to rehydrate it. localStorage tops
 * out around 5 MB and stringifies on the main thread; IndexedDB stores the row
 * array via structured clone, which is both larger and cheaper.
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

export const KEYS = {
  dataset: 'dataset',
  analysis: 'analysis',
  // Measures outlive an analysis: re-running the dashboard replaces every
  // slide, and the calculations the user defined by hand should survive that.
  measures: 'measures',
};
