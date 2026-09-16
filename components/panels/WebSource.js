'use client';

import { useState } from 'react';
import { Link2, Loader2, ShieldCheck } from 'lucide-react';
import { useActions } from '../../lib/store/DatasetProvider';
import { authHeaders, normalizeSourceUrl, webSource } from '../../lib/webSources';

/**
 * A link, and optionally something to authenticate with.
 *
 * The link is rewritten in the browser before it is sent — a sheet's editing
 * page becomes its CSV export — so the person can see what will actually be
 * fetched. The bytes come back through the server, because a browser cannot
 * read another origin's file, and are then parsed here like a dropped one.
 */
export default function WebSource({ kind, onLoaded }) {
  const { ingestUrl } = useActions();
  const source = webSource(kind);
  const [url, setUrl] = useState('');
  const [scheme, setScheme] = useState('none');
  const [token, setToken] = useState('');
  const [headerName, setHeaderName] = useState('X-API-Key');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  if (!source) return null;

  let preview = null;
  try {
    preview = url.trim() ? normalizeSourceUrl(url, { kind }) : null;
  } catch (e) {
    preview = { error: e.message };
  }

  const load = async () => {
    if (!url.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await ingestUrl({ url: url.trim(), kind, headers: authHeaders({ scheme, token, headerName }) });
      onLoaded?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const field =
    'min-w-0 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-white/85 outline-none placeholder:text-white/25 focus:border-accent-500/50';

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[12px] leading-relaxed text-white/45">{source.blurb}</p>
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Link2 size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/25" />
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && load()}
            placeholder={source.placeholder}
            aria-label="Link to the data"
            spellCheck={false}
            className={`${field} w-full pl-9`}
          />
        </div>
        <button
          type="button"
          onClick={load}
          disabled={busy || !url.trim() || !!preview?.error}
          className="flex items-center gap-2 rounded-lg bg-accent-500 px-4 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-on-accent transition-colors hover:bg-accent-400 disabled:opacity-40"
        >
          {busy ? <Loader2 size={12} className="animate-spin" /> : null} Load
        </button>
      </div>

      {preview?.error && <p className="text-[11px] text-rose-300">{preview.error}</p>}
      {preview && !preview.error && preview.url !== url.trim() && (
        <p className="truncate font-mono text-[10px] text-white/35" title={preview.url}>
          {preview.hint ? `${preview.hint} ` : ''}→ {preview.url}
        </p>
      )}

      {source.auth === 'optional' && (
        <div className="flex flex-wrap items-center gap-2">
          <select value={scheme} onChange={(e) => setScheme(e.target.value)} aria-label="Authentication" className={field}>
            <option value="none" className="bg-surface">
              No authentication
            </option>
            <option value="bearer" className="bg-surface">
              Bearer token
            </option>
            <option value="basic" className="bg-surface">
              Basic (user:password)
            </option>
            <option value="header" className="bg-surface">
              API key header
            </option>
          </select>
          {scheme === 'header' && (
            <input value={headerName} onChange={(e) => setHeaderName(e.target.value)} aria-label="Header name" className={`${field} w-36`} />
          )}
          {scheme !== 'none' && (
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={scheme === 'basic' ? 'user:password' : 'token'}
              aria-label="Credential"
              className={`${field} flex-1`}
            />
          )}
        </div>
      )}

      <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-white/30">
        <ShieldCheck size={12} className="mt-0.5 shrink-0" />
        The file is fetched by this app&apos;s server and handed straight to your browser, where it is parsed and
        cleaned. Nothing is stored on the server, and a credential is used for that one request only.
      </p>

      {error && (
        <p className="rounded-lg border border-rose-500/25 bg-rose-500/8 px-3 py-2 text-[12px] leading-relaxed text-rose-200">{error}</p>
      )}
    </div>
  );
}
