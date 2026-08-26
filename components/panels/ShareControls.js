'use client';

/**
 * Decide who else may open one saved analysis.
 *
 * One component rather than two, because sharing is offered from two places —
 * the Save dialog, at the moment you keep an analysis, and the library, later,
 * when you remember you meant to. Those were never going to stay in step as
 * separate copies, and the half that lived in the Save dialog was the only one
 * that existed at all.
 *
 * A recipient can be named by username or by email address. The username is the
 * public name they chose and reveals nothing they did not publish; the address
 * is what you already have for a colleague who has not chosen one yet. Both are
 * resolved on the server — the browser never sends a user id — so this box
 * cannot be used to share with an account you merely guessed at.
 */
import { useCallback, useEffect, useState } from 'react';
import { AtSign, Loader2, Share2, Trash2, UserPlus } from 'lucide-react';

export default function ShareControls({ analysisId, compact = false }) {
  const [shares, setShares] = useState([]);
  const [recipient, setRecipient] = useState('');
  const [profile, setProfile] = useState(undefined); // undefined = still loading
  const [myHandle, setMyHandle] = useState('');
  const [busy, setBusy] = useState(null); // 'share' | 'handle'
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/profile')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled) return;
        setProfile(d?.profile || null);
        if (!d?.profile && d?.suggestion) setMyHandle(d.suggestion);
      })
      .catch(() => !cancelled && setProfile(null));
    return () => {
      cancelled = true;
    };
  }, []);

  const load = useCallback(async () => {
    if (!analysisId) return;
    try {
      const res = await fetch(`/api/analyses/${analysisId}/share`);
      const body = await res.json().catch(() => ({}));
      if (res.ok) setShares(body.shares || []);
      else setError(body.error || 'Could not read who this is shared with.');
    } catch (e) {
      setError(e.message);
    }
  }, [analysisId]);

  useEffect(() => {
    load();
  }, [load]);

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
      if (!res.ok) throw new Error(body.error || 'Could not save that username.');
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
    setNotice(null);
    try {
      const res = await fetch(`/api/analyses/${analysisId}/share`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ recipient }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Could not share.');
      setShares(body.shares || []);
      setRecipient('');
      setNotice(`Shared with ${nameOf(body.shared)}.`);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }, [analysisId, recipient]);

  const unshare = useCallback(
    async (userId) => {
      setError(null);
      const res = await fetch(`/api/analyses/${analysisId}/share?user=${encodeURIComponent(userId)}`, {
        method: 'DELETE',
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) setShares(body.shares || []);
      else setError(body.error || 'Could not stop sharing.');
    },
    [analysisId]
  );

  return (
    <div className="flex flex-col gap-3">
      {!compact && (
        <div className="flex items-center gap-2">
          <Share2 size={14} className="text-accent-400" />
          <span className="label">Share with someone</span>
        </div>
      )}

      <div className="flex gap-2">
        <div className="flex flex-1 items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3">
          <AtSign size={13} className="shrink-0 text-white/30" />
          <input
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && recipient.trim() && share()}
            placeholder="username or email address"
            aria-label="Username or email address to share with"
            className="w-full bg-transparent py-2.5 text-sm text-white/85 outline-none placeholder:text-white/25"
          />
        </div>
        <button
          type="button"
          onClick={share}
          disabled={!recipient.trim() || busy === 'share'}
          className="flex items-center gap-1.5 rounded-lg border border-accent-500/25 bg-accent-500/8 px-3 py-2.5 text-[10px] font-black uppercase tracking-[0.2em] text-accent-300 transition-colors hover:bg-accent-500/15 disabled:opacity-40"
        >
          {busy === 'share' ? <Loader2 size={13} className="animate-spin" /> : <UserPlus size={13} />}
          Share
        </button>
      </div>

      {/* Your own username. Not required to share with someone else — it is how
          they share back with you — so this asks rather than blocks. */}
      {profile === undefined ? (
        <p className="text-[11px] text-white/30">Checking your username…</p>
      ) : profile ? (
        <p className="text-[11px] text-white/30">
          You are <span className="font-bold text-white/50">@{profile.handle}</span> — that is what others
          use to share with you.
        </p>
      ) : (
        <div className="rounded-xl border border-white/8 bg-white/[0.02] p-3">
          <p className="text-[12px] leading-relaxed text-white/50">
            You have not chosen a username. You can still share; other people just have nothing short to
            share back with, and would have to use your email address.
          </p>
          <div className="mt-2.5 flex gap-2">
            <div className="flex flex-1 items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3">
              <AtSign size={13} className="shrink-0 text-white/30" />
              <input
                value={myHandle}
                onChange={(e) => setMyHandle(e.target.value)}
                placeholder="3–24 letters, numbers or _"
                aria-label="Choose your username"
                className="w-full bg-transparent py-2 text-sm text-white/85 outline-none placeholder:text-white/25"
              />
            </div>
            <button
              type="button"
              onClick={claimHandle}
              disabled={!myHandle.trim() || busy === 'handle'}
              className="rounded-lg bg-accent-500 px-3 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-on-accent disabled:opacity-40"
            >
              {busy === 'handle' ? <Loader2 size={13} className="animate-spin" /> : 'Claim'}
            </button>
          </div>
        </div>
      )}

      {shares.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {shares.map((s) => (
            <li
              key={s.userId}
              className="flex items-center justify-between gap-3 rounded-lg border border-white/6 bg-white/[0.02] px-3 py-2"
            >
              <span className="min-w-0 truncate text-[12px] font-bold text-white/70">
                {nameOf(s)}
                {s.displayName ? <span className="ml-2 text-white/35">{s.displayName}</span> : null}
              </span>
              <button
                type="button"
                onClick={() => unshare(s.userId)}
                aria-label={`Stop sharing with ${nameOf(s)}`}
                title="Stop sharing"
                className="shrink-0 rounded p-1 text-white/25 transition-colors hover:bg-rose-500/10 hover:text-rose-400"
              >
                <Trash2 size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {(error || notice) && (
        <p
          className={`rounded-lg border px-3 py-2 text-[13px] ${
            error
              ? 'border-rose-500/25 bg-rose-500/8 text-rose-300'
              : 'border-accent-500/25 bg-accent-500/8 text-accent-200'
          }`}
        >
          {error || notice}
        </p>
      )}
    </div>
  );
}

/**
 * What to call a recipient.
 *
 * Their username when they have one, and otherwise the address the owner typed
 * — which the owner already knew. A row that says neither is a person the owner
 * cannot recognise in a list they are supposed to be managing.
 */
function nameOf(share) {
  if (!share) return 'them';
  if (share.handle) return `@${share.handle}`;
  if (share.label) return share.label;
  if (share.sharedAs) return share.sharedAs;
  return 'someone without a username';
}
