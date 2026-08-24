/**
 * The connections screen.
 *
 * A Server Component so the auth check happens before anything renders — a
 * client-side redirect would flash the page at a signed-out visitor first. It
 * sits outside the (app) route group deliberately: that layout's shell assumes
 * a dataset is loaded, and managing connections has nothing to do with whatever
 * spreadsheet happens to be open.
 */

// CONNECTIONS DISABLED (temporary)
// The screen renders a notice instead of reaching the vault.
// To restore: delete the stub below and uncomment the original code.

import Link from 'next/link';

export const dynamic = 'force-static';

export default function ConnectionsPage() {
  return (
    <main className="relative min-h-screen bg-canvas">
      <div className="ambient-wash" />
      <div className="relative z-10 mx-auto w-full max-w-4xl px-6 py-20">
        <div className="card flex max-w-lg flex-col gap-3 p-8">
          <span className="label">Temporarily off</span>
          <h1 className="text-lg font-black">Database connections are disabled</h1>
          <p className="text-sm leading-relaxed text-white/50">
            This deployment is running without the connection vault for now. Uploading a spreadsheet and
            analysing it works exactly as before, and needs no account.
          </p>
          <Link href="/" className="text-sm font-black text-accent-400 hover:underline">
            Back to Insight Analytics
          </Link>
        </div>
      </div>
    </main>
  );
}

/* ---- original implementation, commented out ----

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft, Zap } from 'lucide-react';
import {
  currentUser,
  ensureOrganization,
  isSupabaseConfigured,
  VaultConfigError,
} from '../../lib/vault/supabase.server';
import ConnectionsPanel from '../../components/panels/ConnectionsPanel';
import ThemeToggle from '../../components/shell/ThemeToggle';

export const dynamic = 'force-dynamic';

export default async function ConnectionsPage() {
  if (!isSupabaseConfigured()) return <Unconfigured />;

  const user = await currentUser();
  if (!user) redirect('/sign-in');

  // Credentials that are present but wrong only reveal themselves here, on the
  // first call that actually reaches Supabase. That is a configuration problem,
  // not a runtime one, so it gets the same screen as no configuration at all.
  let organization;
  try {
    organization = await ensureOrganization();
  } catch (error) {
    if (error instanceof VaultConfigError) return <Unconfigured detail={error.message} />;
    throw error;
  }
  if (!organization) redirect('/sign-in');

  return (
    <Shell>
      <ConnectionsPanel organization={organization} />
    </Shell>
  );
}

function Unconfigured({ detail = null }) {
  return (
    <Shell>
      <div className="card flex max-w-lg flex-col gap-3 p-8">
        <span className="label">Not configured</span>
        <h1 className="text-lg font-black">The connection vault is not set up</h1>
        <p className="text-sm leading-relaxed text-white/50">
          This deployment has no Supabase project configured, so there is nowhere to store credentials.
          Copy <code className="rounded bg-white/5 px-1.5 py-0.5 text-[12px]">.env.example</code> to{' '}
          <code className="rounded bg-white/5 px-1.5 py-0.5 text-[12px]">.env.local</code>, fill in the
          Supabase values and <code className="rounded bg-white/5 px-1.5 py-0.5 text-[12px]">VAULT_MASTER_KEY</code>,
          then restart.
        </p>
        {detail ? (
          <p className="rounded-lg border border-white/10 bg-white/5 p-3 text-[12px] leading-relaxed text-white/40">
            {detail}
          </p>
        ) : null}
        <p className="text-sm leading-relaxed text-white/50">
          Everything else works without it — uploading a spreadsheet and analysing it needs no account and
          sends nothing anywhere.
        </p>
      </div>
    </Shell>
  );
}

function Shell({ children }) {
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

      <div className="relative z-10 mx-auto w-full max-w-4xl px-6 pb-20">{children}</div>
    </main>
  );
}

---- end original ---- */
