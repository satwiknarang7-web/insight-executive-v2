'use client';

import { useEffect } from 'react';

// After a new deploy, a tab opened on the old one asks for script files that
// no longer exist. One automatic reload fetches the new ones.
const STALE = /ChunkLoadError|Loading chunk|dynamically imported module|Failed to fetch|Importing a module script failed/i;
const RELOADED = 'insight.staleReload';

/**
 * A page that failed to render. Says what went wrong — the message and the
 * reference the server logs carry — so a report can name the fault.
 */
export default function PageError({ error, reset }) {
  useEffect(() => {
    if (!STALE.test(`${error?.name} ${error?.message}`)) return;
    try {
      const last = Number(sessionStorage.getItem(RELOADED) || 0);
      if (Date.now() - last < 60000) return;
      sessionStorage.setItem(RELOADED, String(Date.now()));
    } catch {
      return;
    }
    window.location.reload();
  }, [error]);
  return (
    <main className="mx-auto flex min-h-[70vh] max-w-lg flex-col justify-center gap-4 px-4">
      <h1 className="text-2xl font-semibold text-white/90">This page couldn&apos;t load</h1>
      <p className="text-[14px] text-white/60">Try again, or reload. If it keeps happening, send us the details below.</p>
      <pre className="whitespace-pre-wrap break-words rounded-lg border border-white/10 bg-white/[0.03] p-3 text-[12px] text-white/70">
        {error?.message || 'Unknown error'}
        {error?.digest ? `\nReference: ${error.digest}` : ''}
      </pre>
      <div className="flex gap-2">
        <button type="button" onClick={() => reset()} className="rounded-lg bg-accent-500 px-4 py-2 text-[13px] font-bold text-on-accent hover:bg-accent-400">
          Try again
        </button>
        <button type="button" onClick={() => window.location.reload()} className="rounded-lg border border-white/10 px-4 py-2 text-[13px] font-semibold text-white/70 hover:bg-white/5">
          Reload
        </button>
      </div>
    </main>
  );
}
