'use client';

/**
 * Sign in, or create an account, in two steps.
 *
 * Everything the app already does — uploading a spreadsheet, analysing it,
 * presenting it — still works signed out, entirely in the browser. An account
 * exists only to hold database connection credentials, and the page says so,
 * because a login wall in front of a tool that never needed one is the fastest
 * way to lose someone.
 *
 * Step one takes the password; step two takes a code emailed to the address.
 * The step is driven by what the server returns, not by local optimism: the
 * client never decides that a credential was good.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, KeyRound, Loader2, Mail, ShieldCheck, Zap } from 'lucide-react';
import { supabaseBrowser, vaultAvailable } from '../../lib/vault/supabase.client';
import ThemeToggle from '../../components/shell/ThemeToggle';

export default function SignInPage() {
  const router = useRouter();
  const [mode, setMode] = useState('sign-in'); // sign-in | sign-up
  const [step, setStep] = useState('credentials'); // credentials | code
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [remember, setRemember] = useState(true);
  const [challengeId, setChallengeId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [cooldown, setCooldown] = useState(0);
  const codeRef = useRef(null);

  const available = vaultAvailable();

  // Already signed in? Nothing to do here.
  useEffect(() => {
    const supabase = supabaseBrowser();
    if (!supabase) return;
    supabase.auth.getUser().then(({ data }) => {
      if (data?.user) router.replace('/connections');
    });
  }, [router]);

  // The resend cooldown, counted down so the button can say when it wakes up.
  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const timer = setTimeout(() => setCooldown((n) => n - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  useEffect(() => {
    if (step === 'code') codeRef.current?.focus();
  }, [step]);

  const post = useCallback(async (path, payload) => {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || 'That did not work.');
      err.restart = data.restart;
      throw err;
    }
    return data;
  }, []);

  /** Signed in for real: give the user an organisation, then get out of the way. */
  const finish = useCallback(async () => {
    await fetch('/api/auth/bootstrap', { method: 'POST' }).catch(() => {});
    router.replace('/connections');
    router.refresh();
  }, [router]);

  const submitCredentials = useCallback(
    async (e) => {
      e.preventDefault();
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        const path = mode === 'sign-up' ? '/api/auth/sign-up' : '/api/auth/sign-in';
        const data = await post(path, { email, password });

        if (data.verified) {
          await finish();
          return;
        }
        // An address that is already fully registered gets the same response as
        // a new one, so this page cannot be used to test who has an account.
        if (data.alreadyRegistered) {
          setMode('sign-in');
          setNotice('If that address needs an account, check your email. Otherwise, sign in below.');
          return;
        }
        setChallengeId(data.challengeId);
        setStep('code');
        setCooldown(60);
        setNotice(`Code sent to ${data.email}. It expires in 10 minutes.`);
      } catch (err) {
        setError(err.message);
      } finally {
        setBusy(false);
      }
    },
    [mode, email, password, post, finish]
  );

  const submitCode = useCallback(
    async (e) => {
      e.preventDefault();
      setBusy(true);
      setError(null);
      try {
        await post('/api/auth/verify', { challengeId, code, remember });
        await finish();
      } catch (err) {
        setError(err.message);
        setCode('');
        // The challenge is finished, not just wrong — send them back to step one
        // rather than leaving them typing into a dead form.
        if (err.restart) {
          setStep('credentials');
          setChallengeId(null);
        }
      } finally {
        setBusy(false);
      }
    },
    [challengeId, code, remember, post, finish]
  );

  const resend = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await post('/api/auth/resend', { challengeId });
      setCooldown(60);
      setNotice('A new code is on its way. The previous one no longer works.');
    } catch (err) {
      setError(err.message);
      if (err.restart) {
        setStep('credentials');
        setChallengeId(null);
      }
    } finally {
      setBusy(false);
    }
  }, [challengeId, post]);

  const startOver = useCallback(() => {
    setStep('credentials');
    setChallengeId(null);
    setCode('');
    setError(null);
    setNotice(null);
  }, []);

  return (
    <main className="relative min-h-screen bg-canvas">
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
        <div className="ml-auto flex items-center gap-2">
          <Link
            href="/"
            className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-white/45 transition-colors hover:bg-white/5 hover:text-white"
          >
            <ArrowLeft size={13} /> Back
          </Link>
          <ThemeToggle />
        </div>
      </header>

      <div className="relative z-10 mx-auto w-full max-w-lg px-6 pb-20 pt-6">
        <span className="label">{mode === 'sign-up' ? 'Create an account' : 'Sign in'}</span>
        <h1 className="mt-2 text-2xl font-black tracking-tight">
          {step === 'code' ? 'Check your email' : 'An account only holds your connections'}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-white/50">
          {step === 'code' ? (
            <>We sent a six-digit code to <span className="font-bold text-white/75">{email}</span>.</>
          ) : (
            <>
              Uploading a spreadsheet and analysing it needs no account and sends nothing anywhere. Sign in
              only to save database connections —{' '}
              <Link href="/" className="text-accent-400 underline decoration-accent-500/30 hover:text-accent-300">
                carry on without one
              </Link>
              .
            </>
          )}
        </p>

        {!available ? (
          <div className="card mt-6 flex flex-col gap-2 p-5">
            <span className="label">Not configured</span>
            <p className="text-sm leading-relaxed text-white/55">
              This deployment has no connection vault set up, so there is nothing to sign in to. Copy{' '}
              <code className="rounded bg-white/5 px-1.5 py-0.5 text-[12px]">.env.example</code> to{' '}
              <code className="rounded bg-white/5 px-1.5 py-0.5 text-[12px]">.env.local</code> and fill in the
              Supabase values to enable it.
            </p>
          </div>
        ) : step === 'credentials' ? (
          <form onSubmit={submitCredentials} className="card mt-6 flex flex-col gap-4 p-5">
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
                  className="w-full bg-transparent py-2.5 text-sm text-white/85 outline-none placeholder:text-white/25"
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
                  autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-transparent py-2.5 text-sm text-white/85 outline-none placeholder:text-white/25"
                  placeholder={mode === 'sign-up' ? 'At least 10 characters' : '••••••••••'}
                />
              </div>
            </label>

            <Feedback error={error} notice={notice} />

            <button
              type="submit"
              disabled={busy}
              className="flex items-center justify-center gap-2 rounded-xl bg-accent-500 px-4 py-3 text-xs font-black uppercase tracking-[0.2em] text-on-accent transition-colors hover:bg-accent-400 disabled:opacity-50"
            >
              {busy && <Loader2 size={14} className="animate-spin" />}
              {mode === 'sign-up' ? 'Create account' : 'Continue'}
            </button>

            <button
              type="button"
              onClick={() => {
                setMode((m) => (m === 'sign-up' ? 'sign-in' : 'sign-up'));
                setError(null);
                setNotice(null);
              }}
              className="text-center text-[12px] text-white/40 transition-colors hover:text-white/70"
            >
              {mode === 'sign-up' ? 'I already have an account' : 'Create an account instead'}
            </button>
          </form>
        ) : (
          <form onSubmit={submitCode} className="card mt-6 flex flex-col gap-4 p-5">
            <label className="flex flex-col gap-2">
              <span className="label">Six-digit code</span>
              <input
                ref={codeRef}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                required
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                className="rounded-lg border border-white/10 bg-white/5 px-3 py-3 text-center font-mono text-2xl tracking-[0.5em] text-white/85 outline-none focus:border-accent-500/50"
                placeholder="000000"
              />
            </label>

            <label className="flex cursor-pointer items-start gap-2.5">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-accent-500"
              />
              <span className="text-[12px] leading-relaxed text-white/50">
                Trust this browser for 30 days. We will still ask for your password, just not a code.
              </span>
            </label>

            <Feedback error={error} notice={notice} />

            <button
              type="submit"
              disabled={busy || code.length !== 6}
              className="flex items-center justify-center gap-2 rounded-xl bg-accent-500 px-4 py-3 text-xs font-black uppercase tracking-[0.2em] text-on-accent transition-colors hover:bg-accent-400 disabled:opacity-50"
            >
              {busy && <Loader2 size={14} className="animate-spin" />}
              Verify and continue
            </button>

            <div className="flex items-center justify-between gap-3 text-[12px]">
              <button
                type="button"
                onClick={resend}
                disabled={busy || cooldown > 0}
                className="text-white/40 transition-colors hover:text-white/70 disabled:opacity-40"
              >
                {cooldown > 0 ? `Send another code in ${cooldown}s` : 'Send another code'}
              </button>
              <button type="button" onClick={startOver} className="text-white/40 transition-colors hover:text-white/70">
                Use a different email
              </button>
            </div>
          </form>
        )}

        <p className="mt-5 flex items-start gap-2 text-[12px] leading-relaxed text-white/35">
          <ShieldCheck size={14} className="mt-0.5 shrink-0 text-accent-400/70" />
          Your spreadsheet never leaves your browser. Database credentials you save are encrypted on the
          server and are never sent back to it.
        </p>
      </div>
    </main>
  );
}

function Feedback({ error, notice }) {
  if (error) {
    return (
      <p className="rounded-lg border border-rose-500/25 bg-rose-500/8 px-3 py-2 text-[13px] text-rose-300">
        {error}
      </p>
    );
  }
  if (notice) {
    return (
      <p className="rounded-lg border border-accent-500/25 bg-accent-500/8 px-3 py-2 text-[13px] text-accent-200">
        {notice}
      </p>
    );
  }
  return null;
}
