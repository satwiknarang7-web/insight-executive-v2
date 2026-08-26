'use client';

/**
 * Who you are to other people here.
 *
 * The username is the only thing about an account that is public, and it exists
 * for one reason: so an analysis can be shared with a person by name instead of
 * by email address. Changing it is allowed and immediate — nothing is keyed on
 * it, shares are keyed on the account — but it does change what colleagues have
 * to type, so the panel says so rather than treating it as a cosmetic setting.
 */
import { useCallback, useEffect, useState } from 'react';
import { AtSign, Check, IdCard, Loader2 } from 'lucide-react';

export default function ProfilePanel({ email }) {
  const [profile, setProfile] = useState(undefined); // undefined = still loading
  const [handle, setHandle] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/profile')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled) return;
        setProfile(d?.profile || null);
        setHandle(d?.profile?.handle || d?.suggestion || '');
        setDisplayName(d?.profile?.display_name || '');
      })
      .catch(() => !cancelled && setProfile(null));
    return () => {
      cancelled = true;
    };
  }, []);

  const save = useCallback(async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/profile', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ handle, displayName }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Could not save that.');
      setProfile(body.profile);
      setNotice(`Saved. Other people share with you as @${body.profile.handle}.`);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }, [handle, displayName]);

  const clean = handle.trim().replace(/^@/, '').toLowerCase();
  const changed = clean !== (profile?.handle || '') || displayName.trim() !== (profile?.display_name || '');
  const valid = /^[a-z0-9_]{3,24}$/.test(clean);

  return (
    <section className="card flex flex-col gap-4 p-5">
      <div className="flex items-center gap-2">
        <IdCard size={15} className="text-accent-400" />
        <span className="label">Your profile</span>
        {profile === undefined && <Loader2 size={12} className="animate-spin text-white/30" />}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-2">
          <span className="label">Username</span>
          <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 focus-within:border-accent-500/50">
            <AtSign size={13} className="shrink-0 text-white/30" />
            <input
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              placeholder="3–24 letters, numbers or _"
              autoComplete="off"
              className="w-full bg-transparent py-2.5 text-sm text-white/85 outline-none placeholder:text-white/25"
            />
          </div>
          <span className="text-[11px] leading-relaxed text-white/30">
            Public. It is what colleagues type to share an analysis with you.
          </span>
        </label>

        <label className="flex flex-col gap-2">
          <span className="label">Display name</span>
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Optional"
            autoComplete="off"
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white/85 outline-none placeholder:text-white/25 focus:border-accent-500/50"
          />
          <span className="text-[11px] leading-relaxed text-white/30">
            Shown beside your username so people know which @{clean || 'name'} you are.
          </span>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={!valid || !changed || busy}
          className="flex items-center gap-2 rounded-lg bg-accent-500 px-4 py-2.5 text-[10px] font-black uppercase tracking-[0.2em] text-on-accent transition-colors hover:bg-accent-400 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/30"
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
          {profile ? 'Save changes' : 'Claim username'}
        </button>
        {handle.trim() && !valid && (
          <span className="text-[12px] text-amber-300/80">
            A username is 3–24 characters: lower-case letters, numbers or underscores.
          </span>
        )}
        <span className="ml-auto truncate text-[11px] text-white/25" title={email}>
          {email}
        </span>
      </div>

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
    </section>
  );
}
