'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  LayoutDashboard,
  Table2,
  MessageSquare,
  Sigma,
  ShieldCheck,
  Presentation,
  Zap,
  Download,
  RotateCcw,
  Menu,
  X,
  FileText,
  // CONNECTIONS DISABLED (temporary): Database,
  GitBranch,
} from 'lucide-react';
import { useActions, useAnalysis, useDataset } from '../../lib/store/DatasetProvider';
import ThemeToggle from './ThemeToggle';
// CONNECTIONS DISABLED (temporary): import { vaultAvailable } from '../../lib/vault/supabase.client';

const NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, hint: 'Charts and the executive summary' },
  { href: '/explore', label: 'Explore', icon: Table2, hint: 'Browse and filter the cleaned rows' },
  { href: '/ask', label: 'Ask', icon: MessageSquare, hint: 'Question your data in plain English' },
  { href: '/measures', label: 'Measures', icon: Sigma, hint: 'Name a calculation once, then reuse it' },
  { href: '/quality', label: 'Data Quality', icon: ShieldCheck, hint: 'Cleaning report and query audit' },
];

function NavLink({ item, active, onNavigate }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      title={item.hint}
      className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors ${
        active
          ? 'bg-accent-500/12 text-accent-300 ring-1 ring-accent-500/25'
          : 'text-white/55 hover:bg-white/5 hover:text-white'
      }`}
    >
      <Icon size={17} className={active ? 'text-accent-400' : 'text-white/35 group-hover:text-white/70'} />
      {item.label}
    </Link>
  );
}

export default function AppShell({ children }) {
  const { dataset, status } = useDataset();
  const { analysis } = useAnalysis();
  const { exportCsv, reset } = useActions();
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);

  // The whole app is client-side state; without a dataset these pages have
  // nothing to render, so send people back to the upload screen.
  useEffect(() => {
    if (status !== 'booting' && !dataset) router.replace('/');
  }, [status, dataset, router]);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  if (!dataset) {
    return (
      <div className="flex min-h-screen items-center justify-center text-white/30">
        <div className="animate-pulse text-xs font-bold uppercase tracking-[0.35em]">Loading session…</div>
      </div>
    );
  }

  const sidebar = (
    <div className="flex h-full flex-col gap-6 overflow-y-auto p-5">
      <Link href="/" className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-500 text-on-accent">
          <Zap size={18} fill="currentColor" />
        </div>
        <div className="flex flex-col leading-none">
          <span className="text-base font-black tracking-tight">Insight</span>
          <span className="text-[8px] font-black uppercase tracking-[0.35em] text-accent-500">Analytics</span>
        </div>
      </Link>

      <div className="rounded-xl border border-white/7 bg-white/[0.02] p-3">
        <div className="label mb-1">Dataset</div>
        <div className="truncate text-sm font-bold text-white/85" title={dataset.fileName}>
          {dataset.fileName}
        </div>
        <div className="mt-1 text-[11px] text-white/40">
          {dataset.rowCount.toLocaleString()} rows · {dataset.columns.length} columns
        </div>
      </div>

      <nav className="flex flex-col gap-1">
        {NAV.map((item) => (
          <NavLink
            key={item.href}
            item={item}
            active={pathname === item.href || pathname.startsWith(item.href + '/')}
            onNavigate={() => setMenuOpen(false)}
          />
        ))}
        {dataset?.multiTable && (
          <NavLink
            item={{
              href: '/model',
              label: 'Data Model',
              icon: GitBranch,
              hint: 'Review how your tables were joined',
            }}
            active={pathname === '/model'}
            onNavigate={() => setMenuOpen(false)}
          />
        )}
        {analysis?.storyboard?.length > 0 && (
          <NavLink
            item={{ href: '/present', label: 'Present', icon: Presentation, hint: 'Full-screen slide deck' }}
            active={pathname === '/present'}
            onNavigate={() => setMenuOpen(false)}
          />
        )}
      </nav>

      <div className="mt-auto flex flex-col gap-2 pt-4">
        {/* Hidden entirely when there is no vault, rather than offered and broken. */}
        {/* CONNECTIONS DISABLED (temporary)
        {vaultAvailable() && (
          <Link
            href="/connections"
            onClick={() => setMenuOpen(false)}
            className="flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-white/45 transition-colors hover:bg-white/5 hover:text-white"
          >
            <Database size={14} /> Connections
          </Link>
        )}
        */}
        <ThemeToggle />
        {analysis?.storyboard?.length > 0 && (
          <Link
            href="/report"
            className="flex items-center gap-2 rounded-lg border border-accent-500/25 bg-accent-500/8 px-3 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-accent-300 transition-colors hover:bg-accent-500/15"
          >
            <FileText size={14} /> Report
          </Link>
        )}
        <button
          onClick={exportCsv}
          className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-white/50 transition-colors hover:bg-white/8 hover:text-white"
        >
          <Download size={14} /> Cleaned CSV
        </button>
        <button
          onClick={async () => {
            await reset();
            router.push('/');
          }}
          className="flex items-center gap-2 rounded-lg border border-white/10 bg-transparent px-3 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-white/35 transition-colors hover:bg-white/5 hover:text-white/70"
        >
          <RotateCcw size={14} /> New dataset
        </button>
      </div>
    </div>
  );

  return (
    <div className="relative min-h-screen">
      <div className="ambient-wash" />
      <div className="grid-veil" />

      {/* Mobile top bar */}
      <div className="sticky top-0 z-40 flex items-center justify-between border-b border-white/7 bg-canvas-raised/95 px-4 py-3 backdrop-blur md:hidden print:hidden">
        <Link href="/" className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent-500 text-on-accent">
            <Zap size={14} fill="currentColor" />
          </div>
          <span className="text-sm font-black tracking-tight">Insight</span>
        </Link>
        <button
          onClick={() => setMenuOpen((o) => !o)}
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          className="rounded-lg border border-white/10 p-2 text-white/60"
        >
          {menuOpen ? <X size={16} /> : <Menu size={16} />}
        </button>
      </div>

      {menuOpen && (
        <div className="fixed inset-0 z-50 bg-canvas-raised md:hidden">
          <div className="flex justify-end p-3">
            <button onClick={() => setMenuOpen(false)} aria-label="Close menu" className="rounded-lg border border-white/10 p-2 text-white/60">
              <X size={16} />
            </button>
          </div>
          <div className="h-[calc(100vh-56px)]">{sidebar}</div>
        </div>
      )}

      <div className="relative z-10 flex">
        <aside className="sticky top-0 hidden h-screen w-64 shrink-0 border-r border-white/7 bg-canvas-raised/80 md:block print:hidden">
          {sidebar}
        </aside>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
