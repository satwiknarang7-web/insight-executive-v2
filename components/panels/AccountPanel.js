'use client';

/**
 * The account itself: who you are, how to leave, and how to erase it.
 *
 * Deletion asks the user to type their own address. That is not ceremony — the
 * button destroys every database credential stored under the account, and there
 * is no undo and no export. Making the confirmation *specific* means it cannot
 * be satisfied by muscle memory, the way "type DELETE" or a second click can.
 */
import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, LogOut, ShieldAlert, UserRound } from 'lucide-react';

export default function AccountPanel({ email, connectionCount = 0 }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(null); // 'sign-out' | 'delete'
  const [error, setError] = useState(null);

  const matches = typed.trim().toLowerCase() === String(email || '').trim().toLowerCase();

  const signOut = useCallback(async () => {
    setBusy('sign-out');
    await fetch('/api/auth/sign-out', { method: 'POST' }).catch(() => {});
    router.replace('/');
    router.refresh();
  }, [router]);

  const deleteAccount = useCallback(async () => {
    if (!matches) return;
    setBusy('delete');
    setError(null);
    try {
      const res = await fetch('/api/account', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirmEmail: typed.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'That account could not be deleted.');
      router.replace('/');
      router.refresh();
    } catch (e) {
      setError(e.message);
      setBusy(null);
    }
  }, [matches, typed, router]);

  return (
    <div className="flex flex-col gap-4">
      <div className="card flex flex-wrap items-center gap-3 p-5">
        <UserRound size={16} className="text-accent-400" />
        <div className="min-w-0 flex-1">
          <div className="label">Signed in as</div>
          <div className="truncate text-sm font-bold text-white/85">{email}</div>
        </div>
        <button
          type="button"
          onClick={signOut}
          disabled={!!busy}
          className="flex shrink-0 items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-white/45 transition-colors hover:bg-white/5 hover:text-white disabled:opacity-50"
        >
          {busy === 'sign-out' ? <Loader2 size={13} className="animate-spin" /> : <LogOut size={13} />} Sign out
        </button>
      </div>

      <div className="rounded-2xl border border-rose-500/20 bg-rose-500/[0.04] p-5">
        <div className="flex items-center gap-2">
          <ShieldAlert size={15} className="text-rose-400" />
          <span className="text-[10px] font-black uppercase tracking-[0.25em] text-rose-300">Delete account</span>
        </div>

        <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-white/55">
          Permanently deletes this account
          {connectionCount > 0 ? (
            <>
              , along with{' '}
              <span className="font-bold text-white/75">
                {connectionCount} saved {connectionCount === 1 ? 'connection' : 'connections'}
              </span>{' '}
              and their stored credentials
            </>
          ) : (
            ' and any stored credentials'
          )}
          . Your organisation is removed too, unless someone else belongs to it. This cannot be undone.
        </p>

        {!confirming ? (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="mt-4 rounded-lg border border-rose-500/30 px-3 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-rose-300 transition-colors hover:bg-rose-500/10"
          >
            Delete my account
          </button>
        ) : (
          <div className="mt-4 flex flex-col gap-3">
            <label className="flex flex-col gap-2">
              <span className="label">
                Type <span className="text-white/60">{email}</span> to confirm
              </span>
              <input
                type="text"
                autoComplete="off"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                className="rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white/85 outline-none focus:border-rose-500/50"
                placeholder={email}
              />
            </label>

            {error && (
              <p className="rounded-lg border border-rose-500/25 bg-rose-500/8 px-3 py-2 text-[13px] text-rose-300">
                {error}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={deleteAccount}
                disabled={!matches || !!busy}
                className="flex items-center gap-2 rounded-lg bg-rose-500/90 px-4 py-2.5 text-[10px] font-black uppercase tracking-[0.2em] text-white transition-colors hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy === 'delete' && <Loader2 size={13} className="animate-spin" />}
                Permanently delete
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirming(false);
                  setTyped('');
                  setError(null);
                }}
                disabled={!!busy}
                className="rounded-lg border border-white/10 px-3 py-2.5 text-[10px] font-black uppercase tracking-[0.2em] text-white/45 transition-colors hover:bg-white/5 hover:text-white disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
