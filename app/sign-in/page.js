'use client';

/**
 * Sign in to reach stored database connections.
 *
 * Everything the app already does — uploading a spreadsheet, analysing it,
 * presenting it — still works signed out, entirely in the browser. An account
 * exists only to hold connection credentials, and the page says so, because a
 * login wall appearing in front of a tool that never needed one is the fastest
 * way to lose someone.
 */
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { KeyRound, Loader2, Mail, ShieldCheck, Zap } from 'lucide-react';
import { supabaseBrowser, vaultAvailable } from '../../lib/vault/supabase.client';
import ThemeToggle from '../../components/shell/ThemeToggle';

export default function SignInPage() {
  const router = useRouter();
  const [mode, setMode] = useState('sign-in'); // sign-in | sign-up
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const available = vaultAvailable();

  // Already signed in? Nothing to do here.
  useEffect(() => {
    const supabase = supabaseBrowser();
    if (!supabase) return;
    supabase.auth.getUser().then(({ data }) => {
      if (data?.user) router.replace('/connections');
    });
  }, [router]);

  const submit = useCallback(
    async (e) => {
      e.preventDefault();
      const supabase = supabaseBrowser();
      if (!supabase) return;

      setBusy(true);
      setError(null);
      setNotice(null);

      try {
        const fn = mode === 'sign-up' ? 'signUp' : 'signInWithPassword';
        const { data, error: authError } = await supabase.auth[fn]({ email, password });
        if (authError) throw authError;

        // Sign-up with email confirmation on returns a user but no session.
        if (!data.session) {
          setNotice('Check your email to confirm the address, then sign in.');
          return;
        }

        // Give a brand-new user an organisation to own.
        await fetch('/api/auth/bootstrap', { method: 'POST' });
        router.replace('/connections');
      } catch (err) {
        setError(err?.message || 'That did not work. Check the address and password.');
      } finally {
        setBusy(false);
      }
    },
    [email, password, mode, router]
  );

  return (
    <main className="relative flex min-h-screen flex-col bg-canvas">
      <div className="ambient-wash" />

      <header className="relative z-10 flex items-center gap-3 px-6 py-5">
        <Link href="/" className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-500 text-on-accent">
            <Zap size={18} fill="currentColor" />
          </span>
          <span className="flex flex-col leading-none">
            <span className="text-base font-black tracking-tight">Insight</span>
            <span className="text-[8px] font-black uppercase tracking-[0.35em] text-accent-500">Analytics</span>
          </span>
        </Link>
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </header>

      <div className="relative z-10 flex flex-1 items-center justify-center px-5 pb-16">
        <div className="w-full max-w-md">
          <h1 className="text-2xl font-black tracking-tight">
            {mode === 'sign-up' ? 'Create an account' : 'Sign in'}
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-white/45">
            An account is only needed to save database connections. Uploading a spreadsheet and analysing it
            needs no sign-in and never sends your data anywhere —{' '}
            <Link href="/" className="text-accent-400 underline underline-offset-2">
              carry on without one
            </Link>
            .
          </p>

          {!available ? (
            <div className="card mt-6 flex flex-col gap-2 p-5">
              <span className="label">Not configured</span>
              <p className="text-sm leading-relaxed text-white/55">
                This deployment has no connection vault set up, so there is nothing to sign in to. Copy{' '}
                <code className="rounded bg-white/5 px-1.5 py-0.5 text-[12px]">.env.example</code> to{' '}
                <code className="rounded bg-white/5 px-1.5 py-0.5 text-[12px]">.env.local</code> and fill in
                the Supabase values to enable it.
              </p>
            </div>
          ) : (
            <form onSubmit={submit} className="card mt-6 flex flex-col gap-4 p-5">
              <label className="flex flex-col gap-2">
                <span className="label">Email</span>
                <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 focus-within:border-accent-500/50">
                  <Mail size={14} className="shrink-0 text-white/30" />
                  <input
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full bg-transparent py-2.5 text-sm text-white/85 outline-none placeholder:text-white/20"
                    placeholder="you@company.com"
                  />
                </div>
              </label>

              <label className="flex flex-col gap-2">
                <span className="label">Password</span>
                <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 focus-within:border-accent-500/50">
                  <KeyRound size={14} className="shrink-0 text-white/30" />
                  <input
                    type="password"
                    required
                    minLength={8}
                    autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full bg-transparent py-2.5 text-sm text-white/85 outline-none placeholder:text-white/20"
                    placeholder={mode === 'sign-up' ? 'At least 8 characters' : '••••••••'}
                  />
                </div>
              </label>

              {error && (
                <p className="rounded-lg border border-rose-500/25 bg-rose-500/8 px-3 py-2 text-[13px] text-rose-300">
                  {error}
                </p>
              )}
              {notice && (
                <p className="rounded-lg border border-accent-500/25 bg-accent-500/8 px-3 py-2 text-[13px] text-accent-200">
                  {notice}
                </p>
              )}

              <button
                type="submit"
                disabled={busy}
                className="flex items-center justify-center gap-2 rounded-lg bg-accent-500 px-4 py-2.5 text-[10px] font-black uppercase tracking-[0.2em] text-on-accent transition-colors hover:bg-accent-400 disabled:bg-white/10 disabled:text-white/30"
              >
                {busy && <Loader2 size={13} className="animate-spin" />}
                {mode === 'sign-up' ? 'Create account' : 'Sign in'}
              </button>

              <button
                type="button"
                onClick={() => {
                  setMode((m) => (m === 'sign-up' ? 'sign-in' : 'sign-up'));
                  setError(null);
                  setNotice(null);
                }}
                className="text-[12px] text-white/40 transition-colors hover:text-white/70"
              >
                {mode === 'sign-up' ? 'I already have an account' : 'I need an account'}
              </button>
            </form>
          )}

          <div className="mt-5 flex items-start gap-2.5 text-[12px] leading-relaxed text-white/35">
            <ShieldCheck size={14} className="mt-0.5 shrink-0 text-emerald-400/70" />
            <p>
              Database credentials you save are encrypted before they are stored, and are only ever decrypted
              on the server to run a query. They are never sent back to your browser.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
