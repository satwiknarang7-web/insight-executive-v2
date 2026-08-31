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
  Download,
  RotateCcw,
  Menu,
  X,
  PanelLeftClose,
  PanelLeftOpen,
  FileText,
  UserRound,
  GitBranch,
} from 'lucide-react';
import { useActions, useAnalysis, useDataset } from '../../lib/store/DatasetProvider';
import ThemeToggle from './ThemeToggle';
import Logo, { PRODUCT_NAME } from './Logo';

const NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, hint: 'Charts and the executive summary' },
  { href: '/explore', label: 'Explore', icon: Table2, hint: 'Browse and filter the cleaned rows' },
  { href: '/ask', label: 'Ask', icon: MessageSquare, hint: 'Question your data in plain English' },
  { href: '/measures', label: 'Measures', icon: Sigma, hint: 'Name a calculation once, then reuse it' },
  { href: '/quality', label: 'Data Quality', icon: ShieldCheck, hint: 'Cleaning report and query audit' },
  {
    href: '/profile',
    label: 'Profile',
    icon: UserRound,
    hint: 'Your username, your library, saved connections and your account',
  },
];

function NavLink({ item, active, onNavigate, collapsed = false }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      // Collapsed, the tooltip has to carry the name — the hint alone leaves a
      // row of unlabelled icons.
      title={collapsed ? `${item.label} — ${item.hint}` : item.hint}
      aria-label={item.label}
      className={`group flex items-center rounded-xl text-sm font-semibold transition-colors ${
        collapsed ? 'justify-center px-0 py-2.5' : 'gap-3 px-3 py-2.5'
      } ${
        active
          ? 'bg-accent-500/12 text-accent-300 ring-1 ring-accent-500/25'
          : 'text-white/55 hover:bg-white/5 hover:text-white'
      }`}
    >
      <Icon
        size={17}
        className={`shrink-0 ${active ? 'text-accent-400' : 'text-white/35 group-hover:text-white/70'}`}
      />
      {!collapsed && item.label}
    </Link>
  );
}

/** Sidebar widths, in px. Applied inline — see the aside below. */
const FULL_W = 256;
const RAIL_W = 68;

/** localStorage key for the rail preference. */
const COLLAPSE_KEY = 'insight.sidebar.collapsed';

/**
 * The footer buttons, in both widths.
 *
 * One helper rather than two class strings per button: they were already
 * near-identical, and a rail variant written out four more times is four more
 * places for the two to drift apart.
 */
const actionClass = (rail) =>
  `flex items-center rounded-lg border text-[10px] font-black uppercase tracking-[0.2em] transition-colors ${
    rail ? 'justify-center px-0 py-2.5' : 'gap-2 px-3 py-2'
  }`;

export default function AppShell({ children }) {
  const { dataset, status } = useDataset();
  const { analysis } = useAnalysis();
  const { exportCsv, reset } = useActions();
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  // Read after mount rather than during render: touching localStorage while
  // rendering makes the server and client disagree and React throws.
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSE_KEY) === '1');
    } catch {
      /* private mode, or storage disabled — the default stands */
    }
  }, []);

  const toggleCollapsed = () =>
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
      } catch {
        /* not worth failing a click over */
      }
      return next;
    });

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

  const renderSidebar = (rail = false) => (
    <div className={`flex h-full flex-col gap-6 overflow-y-auto overflow-x-hidden ${rail ? 'p-3' : 'p-5'}`}>
      <div className={`flex items-center ${rail ? 'flex-col gap-3' : 'gap-3'}`}>
        {/* The rail has no room for the wordmark, so it gets the mark alone. */}
        <Link href="/" className="flex items-center gap-3" title={PRODUCT_NAME}>
          <Logo variant={rail ? 'mark' : 'lockup'} size="md" />
        </Link>

        {/* Desktop only: the drawer is dismissed, not collapsed. */}
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label={rail ? 'Expand the sidebar' : 'Collapse the sidebar'}
          aria-expanded={!rail}
          title={rail ? 'Expand the sidebar' : 'Collapse the sidebar'}
          className={`hidden shrink-0 rounded-lg border border-white/10 p-1.5 text-white/40 transition-colors hover:bg-white/5 hover:text-white md:block ${
            rail ? '' : 'ml-auto'
          }`}
        >
          {rail ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
        </button>
      </div>

      {/* The dataset card is all text; as a rail it becomes one icon with the
          same information in its tooltip. */}
      {rail ? (
        <div
          className="flex h-9 items-center justify-center rounded-lg border border-white/7 bg-white/[0.02] text-white/40"
          title={`${dataset.fileName} — ${dataset.rowCount.toLocaleString()} rows · ${dataset.columns.length} columns`}
        >
          <FileText size={15} />
        </div>
      ) : (
        <div className="rounded-xl border border-white/7 bg-white/[0.02] p-3">
          <div className="label mb-1">Dataset</div>
          <div className="truncate text-sm font-bold text-white/85" title={dataset.fileName}>
            {dataset.fileName}
          </div>
          <div className="mt-1 text-[11px] text-white/40">
            {dataset.rowCount.toLocaleString()} rows · {dataset.columns.length} columns
          </div>
        </div>
      )}

      <nav className="flex flex-col gap-1">
        {NAV.map((item) => (
          <NavLink
            key={item.href}
            item={item}
            active={pathname === item.href || pathname.startsWith(item.href + '/')}
            onNavigate={() => setMenuOpen(false)}
            collapsed={rail}
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
            collapsed={rail}
          />
        )}
        {analysis?.storyboard?.length > 0 && (
          <NavLink
            item={{ href: '/present', label: 'Present', icon: Presentation, hint: 'Full-screen slide deck' }}
            active={pathname === '/present'}
            onNavigate={() => setMenuOpen(false)}
            collapsed={rail}
          />
        )}
      </nav>

      <div className="mt-auto flex flex-col gap-2 pt-4">
        <ThemeToggle compact={rail} />
        {analysis?.storyboard?.length > 0 && (
          <Link
            href="/report"
            title="Report"
            className={`${actionClass(rail)} border-accent-500/25 bg-accent-500/8 text-accent-300 hover:bg-accent-500/15`}
          >
            <FileText size={14} /> {!rail && 'Report'}
          </Link>
        )}
        <button
          onClick={exportCsv}
          title="Download the cleaned CSV"
          className={`${actionClass(rail)} border-white/10 bg-white/[0.03] text-white/50 hover:bg-white/8 hover:text-white`}
        >
          <Download size={14} /> {!rail && 'Cleaned CSV'}
        </button>
        <button
          onClick={async () => {
            await reset();
            router.push('/');
          }}
          title="Start over with a new dataset"
          className={`${actionClass(rail)} border-white/10 bg-transparent text-white/35 hover:bg-white/5 hover:text-white/70`}
        >
          <RotateCcw size={14} /> {!rail && 'New dataset'}
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
          <Logo size="sm" />
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
          <div className="h-[calc(100vh-56px)]">{renderSidebar(false)}</div>
        </div>
      )}

      <div className="relative z-10 flex">
        <aside
          // The width is an inline style, not a utility class, on purpose: it is
          // a piece of state, and relying on the JIT to have generated an
          // arbitrary `w-[68px]` proved unreliable in dev — the class landed on
          // the element with no rule behind it, so the rail silently stayed
          // full width. A style attribute cannot be tree-shaken away.
          style={{ width: collapsed ? RAIL_W : FULL_W }}
          className="sticky top-0 hidden h-screen shrink-0 border-r border-white/7 bg-canvas-raised/80 transition-[width] duration-200 md:block print:hidden"
        >
          {renderSidebar(collapsed)}
        </aside>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
