/**
 * The connections screen.
 *
 * A Server Component so the auth check happens before anything renders — a
 * client-side redirect would flash the page at a signed-out visitor first. It
 * sits outside the (app) route group deliberately: that layout's shell assumes
 * a dataset is loaded, and managing connections has nothing to do with whatever
 * spreadsheet happens to be open.
 */
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft, Zap } from 'lucide-react';
import {
  currentUser,
  ensureOrganization,
  isSupabaseConfigured,
} from '../../lib/vault/supabase.server';
import ConnectionsPanel from '../../components/panels/ConnectionsPanel';
import ThemeToggle from '../../components/shell/ThemeToggle';

export const dynamic = 'force-dynamic';

export default async function ConnectionsPage() {
  if (!isSupabaseConfigured()) return <Unconfigured />;

  const user = await currentUser();
  if (!user) redirect('/sign-in');

  const organization = await ensureOrganization();
  if (!organization) redirect('/sign-in');

  return (
    <Shell>
      <ConnectionsPanel organization={organization} />
    </Shell>
  );
}

function Unconfigured() {
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
