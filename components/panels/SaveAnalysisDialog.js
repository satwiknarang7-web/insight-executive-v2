'use client';

/**
 * Keep this analysis, and decide who else may open it.
 *
 * Saving is deliberately an action rather than a side effect. The product's
 * whole posture is that a file you open stays in your browser; an archive that
 * filled itself would quietly undo that. So nothing reaches the server until
 * someone presses the button here.
 *
 * Sharing needs a name to share *with*, which is what the handle is for — an
 * email address would publish one user's address to another. A user who has not
 * chosen a handle is asked for one here rather than being sent to a settings
 * page and losing the analysis they were trying to share.
 */
import { useCallback, useEffect, useState } from 'react';
import { AtSign, Check, Loader2, Lock, Share2, Trash2, X } from 'lucide-react';

export default function SaveAnalysisDialog({ snapshot, datasetName, rowCount, existing = null, onClose, onSaved }) {
  const [title, setTitle] = useState(existing?.title || defaultTitle(datasetName));
  const [savedId, setSavedId] = useState(existing?.id || null);
  const [shares, setShares] = useState([]);
  const [handle, setHandle] = useState('');
  const [profile, setProfile] = useState(undefined); // undefined = still loading
  const [myHandle, setMyHandle] = useState('');
  const [busy, setBusy] = useState(null); // 'save' | 'share' | 'handle'
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    fetch('/api/profile')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        setProfile(d?.profile || null);
        if (!d?.profile && d?.suggestion) setMyHandle(d.suggestion);
      })
      .catch(() => setProfile(null));
  }, []);

  useEffect(() => {
    if (!savedId) return;
    fetch(`/api/analyses/${savedId}/share`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setShares(d?.shares || []))
      .catch(() => {});
  }, [savedId]);

  const save = useCallback(async () => {
    setBusy('save');
    setError(null);
    try {
      const res = await fetch('/api/analyses', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: savedId, title, datasetName, rowCount, payload: snapshot }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Could not save.');
      setSavedId(body.analysis.id);
      setNotice('Saved to your library.');
      onSaved?.(body.analysis);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }, [savedId, title, datasetName, rowCount, snapshot, onSaved]);

  const claimHandle = useCallback(async () => {
    setBusy('handle');
    setError(null);
    try {
      const res = await fetch('/api/profile', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ handle: myHandle }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Could not save that handle.');
      setProfile(body.profile);
      setNotice(`You are @${body.profile.handle}. Other people can share with you using that.`);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }, [myHandle]);

  const share = useCallback(async () => {
    setBusy('share');
    setError(null);
    try {
      const res = await fetch(`/api/analyses/${savedId}/share`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ handle }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Could not share.');
      setShares(body.shares || []);
      setHandle('');
      setNotice(`Shared with @${body.shared.handle}.`);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }, [savedId, handle]);

  const unshare = useCallback(
    async (userId) => {
      const res = await fetch(`/api/analyses/${savedId}/share?user=${encodeURIComponent(userId)}`, {
        method: 'DELETE',
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) setShares(body.shares || []);
    },
    [savedId]
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm sm:p-8"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="panel slide-in my-auto w-full max-w-xl p-6"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Save this analysis"
      >
        <div className="mb-5 flex items-center gap-3">
          <Lock size={16} className="text-accent-400" />
          <h2 className="text-base font-black text-white">Save this analysis</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="ml-auto rounded-lg border border-white/10 p-1.5 text-white/40 transition-colors hover:bg-white/5 hover:text-white"
          >
            <X size={14} />
          </button>
        </div>

        <label className="flex flex-col gap-2">
          <span className="label">Title</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white/85 outline-none focus:border-accent-500/50"
          />
        </label>

        <p className="mt-3 text-[12px] leading-relaxed text-white/40">
          The findings are saved — charts, summary, KPIs and measures. The underlying rows are not
          uploaded, so a saved analysis can be presented and shared but not re-queried.
        </p>

        <button
          type="button"
          onClick={save}
          disabled={!title.trim() || busy === 'save'}
          className="mt-4 flex items-center gap-2 rounded-xl bg-accent-500 px-4 py-2.5 text-[10px] font-black uppercase tracking-[0.2em] text-on-accent transition-colors hover:bg-accent-400 disabled:opacity-50"
        >
          {busy === 'save' ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
          {savedId ? 'Update' : 'Save to my library'}
        </button>

        {/* Sharing only makes sense once there is something to share. */}
        {savedId && (
          <div className="mt-6 border-t border-white/8 pt-5">
            <div className="mb-3 flex items-center gap-2">
              <Share2 size={14} className="text-accent-400" />
              <span className="label">Share with someone</span>
            </div>

            {profile === undefined ? (
              <p className="text-[12px] text-white/30">Checking your handle…</p>
            ) : profile ? (
              <>
                <div className="flex gap-2">
                  <div className="flex flex-1 items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3">
                    <AtSign size={13} className="shrink-0 text-white/30" />
                    <input
                      value={handle}
                      onChange={(e) => setHandle(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handle.trim() && share()}
                      placeholder="their handle"
                      className="w-full bg-transparent py-2.5 text-sm text-white/85 outline-none placeholder:text-white/25"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={share}
                    disabled={!handle.trim() || busy === 'share'}
                    className="rounded-lg border border-accent-500/25 bg-accent-500/8 px-3 py-2.5 text-[10px] font-black uppercase tracking-[0.2em] text-accent-300 transition-colors hover:bg-accent-500/15 disabled:opacity-40"
                  >
                    {busy === 'share' ? <Loader2 size={13} className="animate-spin" /> : 'Share'}
                  </button>
                </div>
                <p className="mt-2 text-[11px] text-white/30">
                  You are <span className="font-bold text-white/50">@{profile.handle}</span> — that is what
                  others use to share with you.
                </p>
              </>
            ) : (
              <div className="rounded-xl border border-white/8 bg-white/[0.02] p-4">
                <p className="text-[12px] leading-relaxed text-white/50">
                  Choose a handle first. It is how other people refer to you when sharing, so it is public —
                  unlike your email address.
                </p>
                <div className="mt-3 flex gap-2">
                  <div className="flex flex-1 items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3">
                    <AtSign size={13} className="shrink-0 text-white/30" />
                    <input
                      value={myHandle}
                      onChange={(e) => setMyHandle(e.target.value)}
                      placeholder="3–24 letters, numbers or _"
                      className="w-full bg-transparent py-2.5 text-sm text-white/85 outline-none placeholder:text-white/25"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={claimHandle}
                    disabled={!myHandle.trim() || busy === 'handle'}
                    className="rounded-lg bg-accent-500 px-3 py-2.5 text-[10px] font-black uppercase tracking-[0.2em] text-on-accent disabled:opacity-40"
                  >
                    {busy === 'handle' ? <Loader2 size={13} className="animate-spin" /> : 'Claim'}
                  </button>
                </div>
              </div>
            )}

            {shares.length > 0 && (
              <ul className="mt-4 flex flex-col gap-1.5">
                {shares.map((s) => (
                  <li
                    key={s.userId}
                    className="flex items-center justify-between gap-3 rounded-lg border border-white/6 bg-white/[0.02] px-3 py-2"
                  >
                    <span className="truncate text-[12px] font-bold text-white/70">
                      @{s.handle}
                      {s.displayName ? <span className="ml-2 text-white/35">{s.displayName}</span> : null}
                    </span>
                    <button
                      type="button"
                      onClick={() => unshare(s.userId)}
                      aria-label={`Stop sharing with ${s.handle}`}
                      className="rounded p-1 text-white/25 transition-colors hover:bg-rose-500/10 hover:text-rose-400"
                    >
                      <Trash2 size={13} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {(error || notice) && (
          <p
            className={`mt-4 rounded-lg border px-3 py-2 text-[13px] ${
              error
                ? 'border-rose-500/25 bg-rose-500/8 text-rose-300'
                : 'border-accent-500/25 bg-accent-500/8 text-accent-200'
            }`}
          >
            {error || notice}
          </p>
        )}
      </div>
    </div>
  );
}

function defaultTitle(datasetName) {
  const base = String(datasetName || 'Analysis').replace(/\.(csv|tsv|txt|xlsx?|xlsm)$/i, '');
  const when = new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  return `${base} — ${when}`;
}
