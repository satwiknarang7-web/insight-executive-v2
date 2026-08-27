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
import { AtSign, Clock, Loader2, Mail, Share2, Trash2, UserPlus, Users } from 'lucide-react';

export default function ShareControls({ analysisId, compact = false }) {
  const [shares, setShares] = useState([]);
  const [recipient, setRecipient] = useState('');
  const [profile, setProfile] = useState(undefined); // undefined = still loading
  const [myHandle, setMyHandle] = useState('');
  const [busy, setBusy] = useState(null); // 'share' | 'handle'
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  // Who to offer: people already shared with, and usernames matching what has
  // been typed. Typing a username from memory is the step most likely to be
  // got wrong, and the one this removes.
  const [suggestions, setSuggestions] = useState({ recent: [], matches: [] });
  const [showSuggestions, setShowSuggestions] = useState(false);
  // Sharing is silent otherwise: the analysis appears in their library and
  // nothing tells them to look. When this is on they are sent the report
  // itself, as a PDF — not a link, which only works once they have signed in.
  // Off by default: the sharer knows whether this warrants an email.
  const [notify, setNotify] = useState(false);

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

  // Debounced, because this runs against the database on every keystroke
  // otherwise, and the answer for a half-typed name is not worth the round trip.
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      fetch(`/api/share-suggestions?q=${encodeURIComponent(recipient.trim())}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!cancelled && d) setSuggestions({ recent: d.recent || [], matches: d.matches || [] });
        })
        .catch(() => {});
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [recipient]);

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
        body: JSON.stringify({ recipient, notify }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Could not share.');
      setShares(body.shares || []);
      setRecipient('');
      setShowSuggestions(false);

      // The email is a separate step and reports separately: a share that
      // worked must not read as a failure because the notification bounced.
      const emailed = body.notified;
      setNotice(
        `Shared with ${nameOf(body.shared)}.` +
          (emailed?.sent ? ' The report is on its way to them as a PDF.' : '') +
          (emailed && !emailed.sent ? ` The report was not emailed — ${emailed.reason}` : '')
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }, [analysisId, recipient, notify]);

  /** Someone picked from the list rather than typing the whole thing. */
  const choose = useCallback((person) => {
    setRecipient(person.handle ? `@${person.handle}` : person.sharedAs || '');
    setShowSuggestions(false);
  }, []);

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

      <div className="relative flex gap-2">
        <div className="flex flex-1 items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3">
          <AtSign size={13} className="shrink-0 text-white/30" />
          <input
            value={recipient}
            onChange={(e) => {
              setRecipient(e.target.value);
              setShowSuggestions(true);
            }}
            onFocus={() => setShowSuggestions(true)}
            // A click on a suggestion has to land before the list closes.
            onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && recipient.trim()) share();
              if (e.key === 'Escape') setShowSuggestions(false);
            }}
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

        {showSuggestions && (suggestions.recent.length > 0 || suggestions.matches.length > 0) && (
          <div className="absolute left-0 right-0 top-full z-20 mt-1.5 overflow-hidden rounded-xl border border-white/10 bg-surface shadow-2xl">
            <SuggestionGroup
              icon={Clock}
              label="Shared with before"
              people={suggestions.recent.filter((p) => !shares.some((s) => s.userId === p.userId))}
              onPick={choose}
            />
            <SuggestionGroup
              icon={Users}
              label="Matching"
              people={suggestions.matches.filter((p) => !shares.some((s) => s.userId === p.userId))}
              onPick={choose}
            />
          </div>
        )}
      </div>

      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={notify}
          onChange={(e) => setNotify(e.target.checked)}
          className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-accent-500"
        />
        <span className="text-[12px] leading-relaxed text-white/55">
          <span className="flex items-center gap-1.5">
            <Mail size={12} className="shrink-0 text-white/30" />
            Email them the report as a PDF
          </span>
          <span className="mt-0.5 block text-[11px] text-white/30">
            The report itself, readable without signing in. Rendering it takes a few seconds.
          </span>
        </span>
      </label>

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
 * One labelled block of suggestions.
 *
 * Rendered as nothing when the group is empty, so the list never shows a
 * heading with nothing under it.
 */
function SuggestionGroup({ icon: Icon, label, people, onPick }) {
  if (!people.length) return null;
  return (
    <div className="border-b border-white/6 last:border-0">
      <div className="flex items-center gap-1.5 px-3 pb-1 pt-2">
        <Icon size={10} className="text-white/25" />
        <span className="text-[9px] font-black uppercase tracking-[0.2em] text-white/30">{label}</span>
      </div>
      {people.map((person) => (
        <button
          key={person.userId}
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onPick(person)}
          className="flex w-full items-baseline gap-2 px-3 py-2 text-left transition-colors hover:bg-white/5"
        >
          <span className="truncate text-[13px] font-bold text-white/80">{nameOf(person)}</span>
          {person.displayName && (
            <span className="truncate text-[11px] text-white/35">{person.displayName}</span>
          )}
        </button>
      ))}
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
