'use client';

/**
 * The root portal.
 *
 * An operator's window onto the deployment, not a product screen: it shows how
 * many accounts exist and nothing about any of them. There is deliberately no
 * list of users, no addresses and no way to act on one — this answers "how is
 * it going" without becoming a console that can read a customer's data.
 *
 * It has its own sign-in because it is not a product account. A signed-in
 * customer gets nothing here, and signing in here gets nothing in the product.
 * The whole portal is off unless ROOT_EMAIL and ROOT_PASSWORD are set, in which
 * case the API answers 404 and the form says so rather than pretending to work.
 */
import { useCallback, useEffect, useState } from 'react';
import { KeyRound, Loader2, LogOut, Mail, RefreshCw, ShieldCheck, UserCheck, UserRound, Users } from 'lucide-react';
import Logo from '../../components/shell/Logo';
import ThemeToggle from '../../components/shell/ThemeToggle';

export default function RootPortal() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [stats, setStats] = useState(null);
  const [status, setStatus] = useState('checking'); // checking | out | in | absent
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/root/stats');
    if (res.status === 404) {
      setStatus('absent');
      return false;
    }
    if (res.status === 401) {
      setStatus('out');
      return false;
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(body.error || 'Those numbers could not be read.');
      setStatus('in');
      return false;
    }
    setStats(body.users);
    setStatus('in');
    return true;
  }, []);

  // An existing session means the form never appears.
  useEffect(() => {
    load().catch(() => setStatus('out'));
  }, [load]);

  const signIn = useCallback(
    async (event) => {
      event.preventDefault();
      setBusy(true);
      setError(null);
      try {
        const res = await fetch('/api/root/session', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email, password }),
        });
        if (res.status === 404) {
          setStatus('absent');
          return;
        }
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || 'Those credentials were not accepted.');
        setPassword('');
        await load();
      } catch (e) {
        setError(e.message);
      } finally {
        setBusy(false);
      }
    },
    [email, password, load]
  );

  const signOut = useCallback(async () => {
    await fetch('/api/root/session', { method: 'DELETE' }).catch(() => {});
    setStats(null);
    setStatus('out');
  }, []);

  return (
    <main className="relative min-h-screen bg-canvas">
      <div className="ambient-wash" />

      <header className="relative z-10 flex items-center gap-3 px-6 py-5">
        <Logo size="md" />
        <span className="rounded-full border border-amber-500/25 bg-amber-500/8 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.2em] text-amber-300">
          Root
        </span>
        <div className="ml-auto flex items-center gap-2">
          {status === 'in' && (
            <button
              type="button"
              onClick={signOut}
              className="flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-white/45 transition-colors hover:bg-white/5 hover:text-white"
            >
              <LogOut size={13} /> Sign out
            </button>
          )}
          <ThemeToggle />
        </div>
      </header>

      <div className="relative z-10 mx-auto w-full max-w-3xl px-6 pb-20">
        {status === 'checking' && (
          <p className="flex items-center gap-2 py-10 text-sm text-white/35">
            <Loader2 size={14} className="animate-spin" /> Checking…
          </p>
        )}

        {status === 'absent' && <Absent />}
        {status === 'out' && (
          <SignIn
            email={email}
            password={password}
            busy={busy}
            error={error}
            onEmail={setEmail}
            onPassword={setPassword}
            onSubmit={signIn}
          />
        )}
        {status === 'in' && <Stats stats={stats} error={error} onRefresh={load} />}
      </div>
    </main>
  );
}

/** Shown when the deployment has no root credentials configured. */
function Absent() {
  return (
    <div className="card mt-6 flex max-w-lg flex-col gap-3 p-8">
      <span className="label">Not configured</span>
      <h1 className="text-lg font-black">There is no root portal on this deployment</h1>
      <p className="text-sm leading-relaxed text-white/50">
        Set <code className="rounded bg-white/5 px-1.5 py-0.5 text-[12px]">ROOT_EMAIL</code> and{' '}
        <code className="rounded bg-white/5 px-1.5 py-0.5 text-[12px]">ROOT_PASSWORD</code> in{' '}
        <code className="rounded bg-white/5 px-1.5 py-0.5 text-[12px]">.env.local</code> and restart. The
        password must be at least twelve characters — a short one is treated as unset, so a half-finished
        configuration never leaves this open.
      </p>
    </div>
  );
}

function SignIn({ email, password, busy, error, onEmail, onPassword, onSubmit }) {
  const [show, setShow] = useState(false);

  return (
    <form onSubmit={onSubmit} className="card mt-6 flex max-w-md flex-col gap-4 p-6">
      <div className="flex items-center gap-2">
        <ShieldCheck size={15} className="text-amber-400" />
        <h1 className="text-base font-black">Operator sign-in</h1>
      </div>
      <p className="text-[12px] leading-relaxed text-white/40">
        This is not a product account. It shows deployment totals and gives no access to anyone&rsquo;s data.
      </p>

      <label className="flex flex-col gap-2">
        <span className="label">Root email</span>
        <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 focus-within:border-accent-500/50">
          <Mail size={14} className="shrink-0 text-white/30" />
          <input
            type="email"
            required
            autoComplete="off"
            value={email}
            onChange={(e) => onEmail(e.target.value)}
            placeholder="root@yourcompany.com"
            className="w-full bg-transparent py-2.5 text-sm text-white/85 outline-none placeholder:text-white/25"
          />
        </div>
      </label>

      <label className="flex flex-col gap-2">
        <span className="label">Root password</span>
        <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 focus-within:border-accent-500/50">
          <KeyRound size={14} className="shrink-0 text-white/30" />
          <input
            type={show ? 'text' : 'password'}
            required
            autoComplete="off"
            value={password}
            onChange={(e) => onPassword(e.target.value)}
            placeholder="••••••••••••"
            className="w-full bg-transparent py-2.5 text-sm text-white/85 outline-none placeholder:text-white/25"
          />
          <button
            type="button"
            onClick={() => setShow((v) => !v)}
            aria-label={show ? 'Hide password' : 'Show password'}
            className="-mr-1 shrink-0 rounded-md p-1.5 text-white/30 transition-colors hover:bg-white/5 hover:text-white/70"
          >
            {show ? 'Hide' : 'Show'}
          </button>
        </div>
      </label>

      {error && (
        <p className="rounded-lg border border-rose-500/25 bg-rose-500/8 px-3 py-2 text-[13px] text-rose-300">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={busy}
        className="flex items-center justify-center gap-2 rounded-xl bg-accent-500 px-4 py-3 text-xs font-black uppercase tracking-[0.2em] text-on-accent transition-colors hover:bg-accent-400 disabled:opacity-50"
      >
        {busy && <Loader2 size={14} className="animate-spin" />} Continue
      </button>

      {/* The way back. These are two different credentials against two
          different doors, and someone who arrives here with the product's is
          otherwise stuck on a form that will never accept them. */}
      <a
        href="/sign-in"
        className="border-t border-white/6 pt-3 text-center text-[11px] text-white/30 transition-colors hover:text-white/60"
      >
        Looking for your Insight Executive account? Sign in here
      </a>
    </form>
  );
}

function Stats({ stats, error, onRefresh }) {
  const [refreshing, setRefreshing] = useState(false);

  const refresh = async () => {
    setRefreshing(true);
    await onRefresh().catch(() => {});
    setRefreshing(false);
  };

  return (
    <div className="mt-6 flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-black tracking-tight">Deployment</h1>
        <button
          type="button"
          onClick={refresh}
          disabled={refreshing}
          className="ml-auto flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-white/45 transition-colors hover:bg-white/5 hover:text-white disabled:opacity-50"
        >
          <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {error && (
        <p className="rounded-lg border border-rose-500/25 bg-rose-500/8 px-3 py-2 text-[13px] text-rose-300">
          {error}
        </p>
      )}

      {stats && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat icon={Users} label="Total users" value={stats.total} tone="accent" />
            <Stat icon={UserCheck} label="Confirmed" value={stats.confirmed} />
            <Stat icon={UserRound} label="Never confirmed" value={stats.pending} tone={stats.pending ? 'amber' : 'plain'} />
            <Stat icon={Users} label="New this week" value={stats.recent} />
          </div>

          <p className="text-[12px] leading-relaxed text-white/35">
            {stats.capped
              ? 'The count stopped at its page ceiling, so the total is a floor rather than an exact figure.'
              : 'Counted directly from the authentication service.'}{' '}
            {stats.newestAt
              ? `The most recent account was created ${new Date(stats.newestAt).toLocaleString()}.`
              : 'No accounts yet.'}
          </p>

          <p className="rounded-xl border border-white/8 bg-white/[0.02] p-4 text-[12px] leading-relaxed text-white/40">
            Totals only, by design. This portal cannot list accounts, read an address, open a saved analysis
            or reach a stored database credential — those stay behind each customer&rsquo;s own sign-in.
          </p>
        </>
      )}
    </div>
  );
}

function Stat({ icon: Icon, label, value, tone = 'plain' }) {
  const colour =
    tone === 'accent' ? 'text-accent-400' : tone === 'amber' ? 'text-amber-400' : 'text-white/85';
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2">
        <Icon size={13} className="text-white/30" />
        <span className="label truncate">{label}</span>
      </div>
      <div className={`mt-2 text-3xl font-black tracking-tight ${colour}`}>
        {Number(value ?? 0).toLocaleString()}
      </div>
    </div>
  );
}
