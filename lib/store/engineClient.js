/**
 * Promise-based RPC bridge to the engine worker.
 *
 * One worker instance is shared by the whole app (it holds the dataset), so it
 * is created lazily and kept alive across client-side navigation.
 */

let worker = null;
let seq = 0;
const pending = new Map();

function ensureWorker() {
  if (worker) return worker;
  if (typeof window === 'undefined') return null;

  worker = new Worker(new URL('../../app/workers/engine.worker.js', import.meta.url), {
    type: 'module',
  });

  worker.onmessage = (e) => {
    const { id, type, payload } = e.data || {};
    const entry = pending.get(id);
    if (!entry) return;

    if (type === 'progress') {
      entry.onProgress?.(payload);
      return;
    }
    pending.delete(id);
    if (type === 'error') entry.reject(new Error(payload?.message || 'Engine error'));
    else entry.resolve(payload);
  };

  worker.onerror = (e) => {
    const message = e.message || 'The analysis engine crashed.';
    for (const [, entry] of pending) entry.reject(new Error(message));
    pending.clear();
  };

  return worker;
}

export function call(type, payload = {}, { onProgress, transfer } = {}) {
  const w = ensureWorker();
  if (!w) return Promise.reject(new Error('Engine unavailable on the server.'));

  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress });
    w.postMessage({ id, type, payload }, transfer || []);
  });
}

export function terminateEngine() {
  if (worker) {
    worker.terminate();
    worker = null;
    pending.clear();
  }
}
