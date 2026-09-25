'use client';

/**
 * Sign in, or create an account, in two steps.
 *
 * This is the front door. `middleware.js` sends every signed-out visitor here,
 * so uploading, analysing and presenting all sit behind it — the account came
 * first and the data source second. The one exception is a deployment with no
 * Supabase keys, where the middleware stands down and the whole app is open;
 * that is why nothing here may assume a session exists.
 *
 * Step one takes the password; step two takes a code emailed to the address.
 * The step is driven by what the server returns, not by local optimism: the
 * client never decides that a credential was good.
 */
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Eye, EyeOff, Gauge, KeyRound, Loader2, Mail, Presentation, ShieldCheck } from 'lucide-react';
import { availableConnectors } from '../../lib/connectors/registry';
import { googleSignInEnabled, supabaseBrowser, vaultAvailable } from '../../lib/vault/supabase.client';
import { emailProblem, suggestEmail } from '../../lib/auth/emailAddress';
import { MIN_PASSWORD } from '../../lib/auth/otp';
import { safeNext } from '../../lib/auth/redirectTarget';
import ThemeToggle from '../../components/shell/ThemeToggle';
import Logo, { PRODUCT_NAME } from '../../components/shell/Logo';
import PlanChoice from '../../components/panels/PlanChoice';
import { usePlan } from '../../lib/store/PlanProvider';
import { FREE } from '../../lib/plans.js';

const SOURCES = [...availableConnectors().map((c) => c.label), 'CSV & Excel'];

const HIGHLIGHTS = [
  {
    icon: Gauge,
    title: 'Computed, not guessed',
    body: 'Every statistic is computed directly from your rows. A model, if you use one, only words findings it was handed — it never does the maths.',
  },
  {
    icon: ShieldCheck,
    title: 'Your data stays yours',
    body: 'Spreadsheets are parsed and queried in your browser; their columns and values are sent to your AI provider on your own key. Saved credentials are encrypted server-side and never sent back.',
  },
  {
    icon: Presentation,
    title: 'Ready to present',
    body: 'A narrated deck, an executive summary and an exportable report, from the same verified findings — shareable with your team.',
  },
];

function SignInForm() {
  const router = useRouter();
  const { refresh: refreshPlan } = usePlan();
  const params = useSearchParams();
  // Where the middleware turned them away from, so they land where they meant
  // to go. Relative paths only — an absolute URL here is an open redirect.
  // `/` is the landing page now, and somebody who has just signed in has read
  // the pitch. The app is where they were going. Shared with the OAuth
  // callback, which hands out a session around the same parameter.
  const nextPath = safeNext(params.get('next'));
  const [mode, setMode] = useState('sign-in'); // sign-in | sign-up | recover
  // The password being SET during a reset, as opposed to the one being checked
  // at sign-in. Kept apart so a half-typed reset cannot be submitted as a
  // sign-in attempt, or the reverse.
  const [newPassword, setNewPassword] = useState('');
  const [step, setStep] = useState('credentials'); // plan | credentials | code
  // Chosen before an address is typed, and sent with the sign-up so the account
  // is created already on a plan rather than being assigned one afterwards.
  const [plan, setPlan] = useState(FREE);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [remember, setRemember] = useState(true);
  const [challengeId, setChallengeId] = useState(null);
  const [busy, setBusy] = useState(false);
  /**
   * Opens carrying whatever the OAuth callback sent back.
   *
   * A failed round trip used to land here as a bare sign-in form, which reads
   * as "nothing happened" to somebody who just approved a consent screen. The
   * reasons are a fixed set written by our own callback, so they are mapped to
   * sentences here rather than printed: the provider's own text can name the
   * project and the grant type.
   */
  const [error, setError] = useState(() => {
    switch (params.get('error')) {
      case 'provider':
        return 'Google did not complete the sign-in. You can try again, or use your email address.';
      case 'exchange':
      case 'no-code':
        return 'That sign-in link could not be completed. Try again, or use your email address.';
      case 'not-configured':
        return 'This deployment has no account system configured, so there is nothing to sign in to.';
      default:
        return null;
    }
  });
  const [notice, setNotice] = useState(null);
  const [cooldown, setCooldown] = useState(0);
  // A correction the user can accept with one click, from either side: the
  // typo checker here, or the server's answer when DNS says the domain does
  // not take mail.
  const [suggestion, setSuggestion] = useState(null);
  const [touchedEmail, setTouchedEmail] = useState(false);
  // Revealing the password is a deliberate, momentary act, so it resets
  // whenever the form changes purpose rather than staying on across modes.
  const [showPassword, setShowPassword] = useState(false);
  // Whether this deployment has an operator portal, so the way in can be shown
  // to the person who has its credentials. Without this the portal existed at a
  // URL nothing linked to: someone holding the root email and password put them
  // into *this* form instead, and either landed in the product or was refused,
  // with nothing anywhere saying there was another door.
  //
  // Asking discloses nothing new — the portal's own routes already answer 404
  // when it is not configured and 401 when it is, so its existence is visible
  // to anyone who looks. This only makes it visible to the right person.
  const [rootPortal, setRootPortal] = useState(false);
  const codeRef = useRef(null);

  const available = vaultAvailable();
  const googleOffered = googleSignInEnabled();

  useEffect(() => {
    let cancelled = false;
    fetch('/api/root/session')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => !cancelled && setRootPortal(!!d?.configured))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Already signed in? Nothing to do here.
  useEffect(() => {
    const supabase = supabaseBrowser();
    if (!supabase) return;
    supabase.auth.getUser().then(({ data }) => {
      if (data?.user) router.replace(nextPath);
    });
  }, [router, nextPath]);

  // The resend cooldown, counted down so the button can say when it wakes up.
  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const timer = setTimeout(() => setCooldown((n) => n - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  useEffect(() => {
    if (step === 'code') codeRef.current?.focus();
  }, [step]);

  /**
   * What is wrong with the address, shown only once they have moved on from it.
   *
   * Validating as they type would tell someone their address is invalid before
   * they have finished writing it, which is a form arguing with you. Only the
   * server's answer is authoritative — this exists so the common mistakes are
   * caught without a round trip.
   */
  const emailIssue = touchedEmail && email ? emailProblem(email) : null;

  // A near-miss on a well-known provider. Offered whether or not the address is
  // otherwise valid: "sam@gmial.com" is perfectly well formed.
  useEffect(() => {
    if (!touchedEmail) {
      setSuggestion(null);
      return;
    }
    setSuggestion(emailProblem(email) ? null : suggestEmail(email));
  }, [email, touchedEmail]);

  // Switching between signing in and signing up starts the password over.
  useEffect(() => {
    setShowPassword(false);
  }, [mode]);

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
      err.suggestion = data.suggestion;
      throw err;
    }
    return data;
  }, []);

  /** Signed in for real: give the user an organisation, then get out of the way. */
  const finish = useCallback(async () => {
    await fetch('/api/auth/bootstrap', { method: 'POST' }).catch(() => {});
    // The plan was read before this session existed, and the layout holding it
    // does not remount on a client navigation — so without this the account
    // that just signed in keeps whatever was true for a signed-out visitor.
    await refreshPlan().catch(() => {});
    // Straight to the data-source page: signing in is the first step, choosing
    // a source is the second.
    router.replace(nextPath);
    router.refresh();
  }, [router, nextPath, refreshPlan]);

  /**
   * Hand the browser to Google, and ask for it back at our callback.
   *
   * `redirectTo` is an absolute URL because it is sent to Google, which has no
   * idea what this origin is. It is built from `window.location.origin` rather
   * than an environment variable so a preview deployment returns to itself, and
   * `next` rides along so somebody the middleware turned away from `/explore`
   * lands there rather than on the home page.
   *
   * There is no `await` worth having after this: on success the browser leaves
   * for Google's consent screen and this page is gone. Only the failure path
   * stays, which is why `busy` is cleared there and nowhere else.
   */
  const signInWithGoogle = useCallback(async () => {
    const supabase = supabaseBrowser();
    if (!supabase) return;
    setError(null);
    setNotice(null);
    setBusy(true);
    const callback = new URL('/api/auth/callback', window.location.origin);
    callback.searchParams.set('next', nextPath);
    const { error: failed } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: callback.toString() },
    });
    if (failed) {
      setBusy(false);
      setError('Google sign-in could not be started. Try your email address instead.');
    }
  }, [nextPath]);

  const submitCredentials = useCallback(
    async (e) => {
      e.preventDefault();
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        if (mode === 'recover') {
          const started = await post('/api/auth/recover', { email });
          setChallengeId(started.challengeId || null);
          setStep('code');
          setCooldown(60);
          // Said the same way whether or not that address has an account, which
          // is the only way this form cannot be used to find out.
          setNotice(`If ${email} has an account, a reset code is on its way. It expires in 10 minutes.`);
          return;
        }

        const path = mode === 'sign-up' ? '/api/auth/sign-up' : '/api/auth/sign-in';
        const data = await post(path, mode === 'sign-up' ? { email, password, plan } : { email, password });

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
        // The server can see things this page cannot — whether the domain has a
        // mail server at all — so its correction wins over the local guess.
        if (err.suggestion) setSuggestion(err.suggestion);
      } finally {
        setBusy(false);
      }
    },
    [mode, email, password, plan, post, finish]
  );

  const submitCode = useCallback(
    async (e) => {
      e.preventDefault();
      setBusy(true);
      setError(null);
      try {
        await post(
          '/api/auth/verify',
          mode === 'recover'
            ? { challengeId, code, remember, purpose: 'recover', password: newPassword }
            : { challengeId, code, remember }
        );
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
    [challengeId, code, remember, mode, newPassword, post, finish]
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
    <main className="relative min-h-screen bg-canvas lg:grid lg:grid-cols-[1.1fr_1fr]">
      {/* Left: the pitch, on its own raised panel.
        *
        * The panel needs an edge. `bg-canvas-raised` is #050607 against the
        * page's #030303 — a two-value difference nobody can see as a change of
        * surface, so the boundary read as a hard seam down the middle of the
        * screen rather than as the side of anything. A hairline makes it the
        * edge it was always meant to be. */}
      <section className="relative flex flex-col overflow-hidden border-white/6 bg-canvas-raised px-7 py-8 lg:border-r lg:px-12 lg:py-12">
        <div className="ambient-wash" />
        <Link href="/sign-in" className="relative z-10 flex w-fit items-center gap-3">
          <Logo size="md" />
        </Link>
        <Pitch />
      </section>

      {/* Right: the form, centred, on the plain page. */}
      <section className="relative flex flex-col items-center justify-center px-6 py-10 lg:px-10">
        {/*
          * In the corner of the page on a wide screen, and above the form on a
          * narrow one.
          *
          * It was absolutely positioned at all widths. Below `lg` this column
          * starts underneath the pitch rather than beside it, so "top right of
          * the column" is the middle of the page — and the button was drawn on
          * top of the corner of the card it sits above.
          */}
        <div className="z-20 mb-4 self-end lg:absolute lg:right-5 lg:top-5 lg:mb-0">
          <ThemeToggle />
        </div>

        <div className="panel relative z-10 w-full max-w-md p-7">
          <h1 className="text-xl font-black tracking-tight">
            {step === 'code'
              ? 'Check your email'
              : mode === 'recover'
              ? 'Reset your password'
              : step === 'plan'
              ? 'Choose your plan'
              : mode === 'sign-up'
              ? 'Create your account'
              : `Sign in to ${PRODUCT_NAME}`}
          </h1>
          {step === 'code' ? (
            <p className="mt-2 text-[13px] leading-relaxed text-white/50">
              We sent a six-digit code to <span className="font-bold text-white/75">{email}</span>.
            </p>
          ) : mode === 'recover' ? (
            <p className="mt-2 text-[13px] leading-relaxed text-white/45">
              We will email you a code. Your current password keeps working until you set a new one.
            </p>
          ) : step === 'plan' ? (
            <p className="mt-2 text-[13px] leading-relaxed text-white/45">
              Both plans clean your data and let you build a dashboard. Pro adds the analyst that
              builds it for you. You can change this later.
            </p>
          ) : (
            <p className="mt-2 text-[13px] leading-relaxed text-white/45">
              Your account is the first step; choosing a data source is the second.
            </p>
          )}

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
        ) : step === 'plan' ? (
          <>
            <PlanChoice
              value={plan}
              onChange={setPlan}
              onContinue={() => setStep('credentials')}
              ctaLabel="Continue"
            />
            <button
              type="button"
              onClick={() => {
                setMode('sign-in');
                setStep('credentials');
              }}
              className="mt-3 w-full text-center text-[12px] text-white/40 transition-colors hover:text-white/70"
            >
              I already have an account
            </button>
          </>
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
                  onBlur={() => setTouchedEmail(true)}
                  aria-invalid={!!emailIssue}
                  aria-describedby={emailIssue ? 'email-problem' : undefined}
                  className="w-full bg-transparent py-2.5 text-sm text-white/85 outline-none placeholder:text-white/25"
                  placeholder="you@company.com"
                />
              </div>

              {emailIssue && (
                <span id="email-problem" className="text-[12px] leading-relaxed text-amber-300/85">
                  {emailIssue}
                </span>
              )}

              {suggestion && (
                <button
                  type="button"
                  onClick={() => {
                    setEmail(suggestion);
                    setSuggestion(null);
                    setError(null);
                  }}
                  className="self-start text-[12px] leading-relaxed text-accent-300 underline decoration-dotted underline-offset-2 hover:text-accent-200"
                >
                  Did you mean <span className="font-bold">{suggestion}</span>?
                </button>
              )}

              {mode === 'sign-up' && !emailIssue && (
                <span className="text-[11px] leading-relaxed text-white/30">
                  A code goes to this address, so it has to be one you can open.
                </span>
              )}
            </label>

            {mode !== 'recover' && (
            <label className="flex flex-col gap-2">
              <span className="label">Password</span>
              <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 focus-within:border-accent-500/50">
                <KeyRound size={14} className="shrink-0 text-white/30" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-transparent py-2.5 text-sm text-white/85 outline-none placeholder:text-white/25"
                  placeholder={mode === 'sign-up' ? `At least ${MIN_PASSWORD} characters` : '••••••••••'}
                />
                {/* Typing a password you cannot see is how people end up locked
                    out of an account they created correctly. */}
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                  title={showPassword ? 'Hide password' : 'Show password'}
                  className="-mr-1 shrink-0 rounded-md p-1.5 text-white/30 transition-colors hover:bg-white/5 hover:text-white/70"
                >
                  {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </label>
            )}

            <Feedback error={error} notice={notice} />

            <button
              type="submit"
              disabled={busy}
              className="flex items-center justify-center gap-2 rounded-xl bg-accent-500 px-4 py-3 text-xs font-black uppercase tracking-[0.2em] text-on-accent transition-colors hover:bg-accent-400 disabled:opacity-50"
            >
              {busy && <Loader2 size={14} className="animate-spin" />}
              {mode === 'sign-up' ? 'Create account' : mode === 'recover' ? 'Send reset code' : 'Continue'}
            </button>

            {mode === 'sign-in' && (
              <button
                type="button"
                onClick={() => {
                  setMode('recover');
                  setStep('credentials');
                  setPassword('');
                  setError(null);
                  setNotice(null);
                }}
                className="text-center text-[12px] text-white/40 transition-colors hover:text-white/70"
              >
                Forgot your password?
              </button>
            )}

            {mode === 'recover' && (
              <button
                type="button"
                onClick={() => {
                  setMode('sign-in');
                  setStep('credentials');
                  setNewPassword('');
                  setError(null);
                  setNotice(null);
                }}
                className="text-center text-[12px] text-white/40 transition-colors hover:text-white/70"
              >
                Back to signing in
              </button>
            )}

            {mode !== 'recover' && (
            <button
              type="button"
              onClick={() => {
                // Creating an account starts at the plan, not at the address:
                // what you are signing up *for* is the first question.
                setMode((m) => {
                  const next = m === 'sign-up' ? 'sign-in' : 'sign-up';
                  setStep(next === 'sign-up' ? 'plan' : 'credentials');
                  return next;
                });
                setError(null);
                setNotice(null);
              }}
              className="text-center text-[12px] text-white/40 transition-colors hover:text-white/70"
            >
              {mode === 'sign-up' ? 'I already have an account' : 'Create an account instead'}
            </button>
            )}

            {/*
              * Google, for people who would rather not have another password.
              *
              * Offered only when the provider is actually reachable, which
              * takes two separate facts. `available` says this deployment has
              * Supabase keys at all; `googleSignInEnabled` says somebody has
              * registered an OAuth client with Google and switched the
              * provider on in the dashboard. Neither implies the other, and
              * the keys cannot tell you the second — so it is declared, with
              * `NEXT_PUBLIC_GOOGLE_SIGN_IN`, and off until it is.
              *
              * Without that, the button is live against a provider that is not
              * configured and sends the reader to a consent screen belonging
              * to no project: a dead end with the word Google on it, which is
              * worse than no button.
              *
              * Below the form rather than above it, because the account this
              * product is built around is the one with the six-digit code —
              * this is the shortcut, not the front door.
              */}
            {available && googleOffered && mode !== 'recover' && (
              <div className="flex flex-col gap-3 border-t border-white/6 pt-4">
                <span className="text-center text-[11px] text-white/30">or</span>
                <button
                  type="button"
                  onClick={signInWithGoogle}
                  disabled={busy}
                  className="flex items-center justify-center gap-2.5 rounded-xl border border-white/12 bg-white/[0.04] px-4 py-3 text-[13px] font-semibold text-white/85 transition-colors hover:bg-white/[0.08] disabled:opacity-50"
                >
                  <GoogleMark />
                  Continue with Google
                </button>
              </div>
            )}

            {/* The operator door, named as one. It is a different credential
                and a different portal, and the whole reason it is here is that
                a person holding those credentials was otherwise left typing
                them into the form above. */}
            {rootPortal && (
              <a
                href="/root"
                className="flex items-center justify-center gap-1.5 border-t border-white/6 pt-3 text-center text-[11px] text-white/30 transition-colors hover:text-white/60"
              >
                <ShieldCheck size={11} />
                Operator sign-in
              </a>
            )}
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

            {mode === 'recover' && (
              <label className="flex flex-col gap-2">
                <span className="label">New password</span>
                <input
                  type="password"
                  required
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white/85 outline-none placeholder:text-white/25 focus:border-accent-500/50"
                  placeholder="At least 8 characters"
                />
                {/* Asked for on the same screen as the code, so the reset is one
                    step rather than a sign-in that silently leaves the old
                    password in place. */}
                <span className="text-[11px] leading-relaxed text-white/30">
                  Setting this signs you in and replaces your old password everywhere.
                </span>
              </label>
            )}

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
              disabled={busy || code.length !== 6 || (mode === 'recover' && !newPassword)}
              className="flex items-center justify-center gap-2 rounded-xl bg-accent-500 px-4 py-3 text-xs font-black uppercase tracking-[0.2em] text-on-accent transition-colors hover:bg-accent-400 disabled:opacity-50"
            >
              {busy && <Loader2 size={14} className="animate-spin" />}
              {mode === 'recover' ? 'Set password and sign in' : 'Verify and continue'}
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

          <p className="mt-5 flex items-start gap-2 text-[11px] leading-relaxed text-white/30">
            <ShieldCheck size={13} className="mt-0.5 shrink-0 text-accent-400/70" />
            Your spreadsheet is parsed and queried in your browser; its columns and their values are sent to your AI provider on your own key. Database credentials you save are encrypted on the
            server and are never sent back to it.
          </p>
        </div>
      </section>
    </main>
  );
}

/**
 * The left half of the landing page.
 *
 * Says what the product does and why its numbers can be trusted, because the
 * sign-in form on its own gives someone arriving for the first time no reason
 * to fill it in. Every claim here is one the app actually keeps — the
 * statistics really are computed locally, and the model really is only allowed
 * to phrase findings it was handed.
 */
function Pitch() {
  /*
   * Enough of the list to prove the point, and not the whole catalogue.
   *
   * All thirty-odd names filled six ragged rows and became the largest object
   * on a page whose only job is a sign-in form. The landing page is where the
   * breadth belongs and it now shows every one of them; here the list is
   * supporting evidence, so it stops at a dozen and says how many follow.
   */
  const shown = SOURCES.slice(0, 12);
  const rest = SOURCES.length - shown.length;

  return (
    /*
     * Flows down from the logo rather than centring against it.
     *
     * This was `flex-1 justify-center`, and the column's content is taller than
     * the viewport at every width below a very tall one. Centring overflowing
     * flex content overflows it in *both* directions, so the top of the
     * headline was drawn over the logo above it — a collision that got worse
     * the more sources the registry gained.
     */
    <div className="relative z-10 mt-10 flex flex-col lg:mt-14">
      <h2 className="display max-w-[22ch] text-[2rem] leading-[1.06] text-white/90 lg:text-[2.6rem]">
        Every number on the dashboard traces back to a{' '}
        {/*
          * Weight, as on the landing page, rather than a rule under the words.
          *
          * Colour was tried first and cannot work: light mode remaps the accent
          * ramp to navy, so the emphasis came out #123a63 against #0b2545 ink —
          * the same word twice. The underline that replaced it reads as a
          * hyperlink, and here it was worse than on the landing page, because
          * the emphasised phrase wraps: three separate teal rules stacked down
          * the headline, which reads as a spellchecker rather than as stress.
          * Fraunces carries 300 to 900, so the stress can be the letterforms.
          */}
        <span style={{ fontVariationSettings: "'SOFT' 0, 'WONK' 0, 'opsz' 40, 'wght' 900" }}>
          query you can read
        </span>
        .
      </h2>

      <p className="mt-4 text-[15px] text-white/65">Analysis you can defend.</p>

      <div className="mt-8 flex max-w-lg flex-col gap-5">
        {HIGHLIGHTS.map((h) => (
          <div key={h.title} className="flex gap-3.5">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-accent-400">
              <h.icon size={14} />
            </div>
            <div className="min-w-0">
              <div className="text-[15px] font-semibold text-white/90">{h.title}</div>
              <p className="mt-1 text-[13.5px] leading-relaxed text-white/65">{h.body}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-9 max-w-lg border-t border-white/6 pt-6">
        <span className="label">Supported integrations</span>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {shown.map((name) => (
            <span key={name} className="chip text-white/65">
              {name}
            </span>
          ))}
          {rest > 0 && <span className="text-[13px] text-white/45">and {rest} more</span>}
        </div>
      </div>
    </div>
  );
}

/**
 * Read from the registry, filtered to what has actually shipped.
 *
 * This was typed out by hand, on the reasoning that a claim about what the
 * product supports should not change silently because a driver appeared behind
 * a feature flag. The concern was right and the remedy was not: the list
 * drifted anyway — it had lost Supabase entirely and renamed three of the
 * others — so this page named a different set of databases from the one the
 * connection form offers. `availableConnectors` keeps the guarantee, since a
 * connector at an unshipped phase is excluded there rather than here.
 *
 * Files come last and are named separately: they are the one source that needs
 * no connection at all.
 */




/**
 * Google's mark, inline.
 *
 * Their brand guidelines require the four-colour G rather than a recolourable
 * glyph, so it carries its own hex values and is the one thing on this page
 * that does not follow the theme — a two-tone Google mark is a modified Google
 * mark. Small enough to inline; a network request for 24 pixels of logo on the
 * sign-in path is a request that can fail.
 */
function GoogleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.91c1.7-1.57 2.69-3.88 2.69-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.81.54-1.84.86-3.05.86-2.34 0-4.32-1.58-5.03-3.71H.96v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.71a5.41 5.41 0 0 1 0-3.42V4.96H.96a9 9 0 0 0 0 8.08l3.01-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.96l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
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

export default function SignInPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-canvas" />}>
      <SignInForm />
    </Suspense>
  );
}
