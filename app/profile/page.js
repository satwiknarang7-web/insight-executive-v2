/**
 * The account hub: who you are, what you have saved, and how to leave.
 *
 * A Server Component so the auth check happens before anything renders — a
 * client-side redirect would flash the page at a signed-out visitor first.
 *
 * It sits outside the (app) route group deliberately, for the same reason the
 * connections screen used to: that layout assumes a dataset is loaded, and none
 * of this has anything to do with whichever spreadsheet happens to be open. It
 * matters most for the library — being shown findings without the file behind
 * them is the entire point of sharing, and until now reaching your own library
 * meant opening an unrelated file first.
 *
 * Stored connections live here too. There is no separate connections screen any
 * more: a connection is made from the source dropdown on the home page, at the
 * moment you actually want data out of it. What was left over was managing the
 * credentials you already stored, and that is an account matter.
 */

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft, Zap } from 'lucide-react';
import {
  currentUser,
  ensureOrganization,
  isSupabaseConfigured,
  userClient,
  VaultConfigError,
} from '../../lib/vault/supabase.server';
import AnalysisLibrary from '../../components/panels/AnalysisLibrary';
import ConnectionsPanel from '../../components/panels/ConnectionsPanel';
import AccountPanel from '../../components/panels/AccountPanel';
import ProfilePanel from '../../components/panels/ProfilePanel';
import ThemeToggle from '../../components/shell/ThemeToggle';

export const dynamic = 'force-dynamic';

export default async function ProfilePage() {
  if (!isSupabaseConfigured()) return <Unconfigured />;

  const user = await currentUser();
  if (!user) redirect('/sign-in?next=/profile');

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
  if (!organization) redirect('/sign-in?next=/profile');

  // How much the delete button is about to destroy, counted here rather than
  // guessed at in the warning copy.
  const connectionCount = await countConnections(organization.id);

  return (
    <Shell>
      <ProfilePanel email={user.email} />

      <Block title="Library" blurb="Analyses you saved, and analyses shared with you.">
        <AnalysisLibrary />
      </Block>

      <Block
        title="Saved connections"
        blurb="Credentials you have stored. New connections are made from the data-source dropdown on the home page."
      >
        <ConnectionsPanel organization={organization} />
      </Block>

      <AccountPanel email={user.email} connectionCount={connectionCount} />
    </Shell>
  );
}

function Block({ title, blurb, children }) {
  return (
    <section className="flex flex-col gap-4">
      <div>
        <div className="flex items-center gap-3">
          <h2 className="text-xs font-black uppercase tracking-[0.28em] text-white/45">{title}</h2>
          <div className="h-px flex-1 bg-gradient-to-r from-white/10 to-transparent" />
        </div>
        <p className="mt-1.5 max-w-2xl text-[12px] leading-relaxed text-white/35">{blurb}</p>
      </div>
      {children}
    </section>
  );
}

function Unconfigured({ detail = null }) {
  return (
    <Shell>
      <div className="card flex max-w-lg flex-col gap-3 p-8">
        <span className="label">Not configured</span>
        <h1 className="text-lg font-black">Accounts are not set up on this deployment</h1>
        <p className="text-sm leading-relaxed text-white/50">
          There is no Supabase project configured, so there is nowhere to keep a profile, a saved analysis
          or a stored credential. Copy <code className="rounded bg-white/5 px-1.5 py-0.5 text-[12px]">.env.example</code>{' '}
          to <code className="rounded bg-white/5 px-1.5 py-0.5 text-[12px]">.env.local</code>, fill in the
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

      <div className="relative z-10 mx-auto flex w-full max-w-4xl flex-col gap-10 px-6 pb-20">{children}</div>
    </main>
  );
}

/** Live connections in this organisation. Revoked ones no longer count. */
async function countConnections(orgId) {
  try {
    const supabase = await userClient();
    const { count } = await supabase
      .from('connections')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .is('revoked_at', null);
    return count ?? 0;
  } catch {
    return 0;
  }
}
