'use client';

import Link from 'next/link';
import { ArrowRight, BarChart3, Calculator, Database, FileDown, Grid3x3, MessageCircle, Presentation, ShieldCheck, Sparkles, Upload, Wand2 } from 'lucide-react';
import Logo from '../components/shell/Logo';
import ThemeToggle from '../components/shell/ThemeToggle';
import ProductPreview from '../components/landing/ProductPreview';
import { availableConnectors } from '../lib/connectors/registry';
import { sourceGroups } from '../lib/sources';

/**
 * What this is, for somebody deciding whether to use it.
 *
 * The only page addressed to a stranger. It shows the product first (a live
 * preview drawn from the theme, never a stale screenshot), then what it does,
 * how, and what it reads. Every claim here is something the app does today.
 * This page holds no data and reads none.
 */

const FEATURES = [
  { icon: Wand2, title: 'A dashboard, planned for your data', body: 'KPIs, trends, drivers and breakdowns chosen from what the columns are and what the numbers show — not a fixed template.' },
  { icon: Calculator, title: 'Every number computed, every claim checked', body: 'Captions carry the figures behind them and the tests that back them. Gaps that are noise are called noise.' },
  { icon: MessageCircle, title: 'An assistant that can act', body: 'Ask about your data or the app, or say what to change. Each change is shown first and applied only when you click Apply.' },
  { icon: Grid3x3, title: 'Charts that fit the data', body: 'Lines, bars, spreads, heatmaps and tables — the editor only offers chart types your data can actually draw.' },
  { icon: FileDown, title: 'Report, PDF, Word, PowerPoint', body: 'The same charts and sentences, written out to read, print or send — or presented as a slideshow.' },
  { icon: ShieldCheck, title: 'Private by default', body: 'Files are parsed and analysed in your browser. Without a model key, no rows leave it.' },
];

const STEPS = [
  { icon: Upload, title: 'Load', body: 'A file, a link, a database, or a photo of a table. Cleaned and typed as it loads.' },
  { icon: BarChart3, title: 'Analyse', body: 'The engine reads each column, derives the measures an analyst would, and plans the dashboard.' },
  { icon: Presentation, title: 'Share', body: 'Edit anything, ask follow-ups, then export or present the findings.' },
];

const FACTS = [
  ['In-browser', 'parsing and analysis'],
  ['30+', 'files and live sources'],
  ['0 rows', 'sent anywhere without a key'],
];

function liveSourceNames() {
  return availableConnectors().map((c) => c.label);
}

function fileSourceNames() {
  const files = sourceGroups().find((g) => g.id === 'files');
  return (files?.items || []).filter((i) => i.kind === 'file').map((i) => i.label.replace(/ workbook| database| page| or photo of a table/, ''));
}

export default function LandingPage() {
  return (
    <div className="relative min-h-screen overflow-x-hidden">
      <div className="ambient-wash" />
      <div className="grid-veil" />

      <div className="relative z-10 flex min-h-screen flex-col">
        <header className="sticky top-0 z-30 border-b border-white/6 bg-[color-mix(in_oklab,var(--canvas)_78%,transparent)] backdrop-blur-xl">
          <div className="mx-auto flex w-full max-w-6xl items-center gap-3 px-5 py-3.5 md:px-8">
            <Logo size="lg" />
            <nav className="ml-8 hidden items-center gap-6 text-[13.5px] text-white/60 md:flex">
              <a href="#features" className="transition-colors hover:text-white/90">Features</a>
              <a href="#how" className="transition-colors hover:text-white/90">How it works</a>
              <a href="#sources" className="transition-colors hover:text-white/90">Sources</a>
            </nav>
            <div className="ml-auto flex items-center gap-2">
              <Link href="/sign-in" className="hidden rounded-lg px-3 py-2 text-[13.5px] font-medium text-white/65 transition-colors hover:text-white/90 sm:block">
                Sign in
              </Link>
              <Link href="/home" className="inline-flex items-center gap-1.5 rounded-lg bg-accent-500 px-3.5 py-2 text-[13px] font-semibold text-on-accent transition hover:bg-accent-400">
                Open the app <ArrowRight size={14} />
              </Link>
              <ThemeToggle compact />
            </div>
          </div>
        </header>

        <section className="mx-auto grid w-full max-w-6xl items-center gap-14 px-5 pb-20 pt-14 md:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.08fr)] lg:pt-20">
          <div className="ld-rise">
            <span className="eyebrow">Automated analytics · runs in your browser</span>
            <h1 className="display mt-6 text-balance text-[40px] leading-[1.04] text-white/95 md:text-[52px]">
              The dashboard a senior analyst would build. <span className="text-gradient">In seconds.</span>
            </h1>
            <p className="mt-6 max-w-[52ch] text-[17px] leading-relaxed text-white/60">
              Upload a dataset and Insight reads every column, derives the right measures, and builds the charts that
              explain it — with every number computed from your rows and every claim backed by the data.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link href="/home" className="inline-flex items-center gap-2 rounded-xl bg-accent-500 px-6 py-3.5 text-[15px] font-semibold text-on-accent shadow-[var(--glow)] transition hover:bg-accent-400">
                Analyse a dataset <ArrowRight size={16} />
              </Link>
              <Link href="/home" className="inline-flex items-center gap-2 rounded-xl border border-white/12 bg-white/[0.03] px-5 py-3.5 text-[15px] font-medium text-white/80 transition hover:bg-white/[0.07]">
                <Sparkles size={15} className="text-accent-400" /> Try a sample
              </Link>
            </div>
            <dl className="mt-10 grid max-w-md grid-cols-3 gap-4 border-t border-white/8 pt-6">
              {FACTS.map(([k, v]) => (
                <div key={k}>
                  <dt className="figure text-[20px] font-semibold text-white/90">{k}</dt>
                  <dd className="mt-0.5 text-[12px] leading-snug text-white/45">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="ld-rise" style={{ animationDelay: '120ms' }}>
            <ProductPreview />
          </div>
        </section>

        <section id="features" className="scroll-mt-20 border-t border-white/6">
          <div className="mx-auto w-full max-w-6xl px-5 py-20 md:px-8">
            <div className="max-w-2xl">
              <div className="label">What you get</div>
              <h2 className="display mt-3 text-[32px] leading-tight text-white/95 md:text-[40px]">An analyst&apos;s judgement, built in.</h2>
              <p className="mt-3 text-[16px] leading-relaxed text-white/55">
                Every dataset is different, so every dashboard is too. The engine decides what to show from the data itself.
              </p>
            </div>
            <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map(({ icon: Icon, title, body }) => (
                <div key={title} className="card group p-6 transition-colors duration-300 hover:border-accent-400/40">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-accent-400/25 bg-accent-400/10 text-accent-300 transition group-hover:shadow-[var(--glow)]">
                    <Icon size={18} />
                  </span>
                  <h3 className="mt-5 text-[16px] font-semibold text-white/90">{title}</h3>
                  <p className="mt-2 text-[14px] leading-relaxed text-white/55">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="how" className="scroll-mt-20 border-t border-white/6">
          <div className="mx-auto w-full max-w-6xl px-5 py-20 md:px-8">
            <div className="label">How it works</div>
            <h2 className="display mt-3 text-[32px] leading-tight text-white/95 md:text-[40px]">From file to findings.</h2>
            <ol className="relative mt-10 grid gap-6 md:grid-cols-3">
              <span aria-hidden="true" className="absolute left-[10%] right-[10%] top-6 hidden h-px bg-gradient-to-r from-transparent via-accent-400/40 to-transparent md:block" />
              {STEPS.map(({ icon: Icon, title, body }, i) => (
                <li key={title} className="relative">
                  <span className="relative z-10 flex h-12 w-12 items-center justify-center rounded-2xl border border-accent-400/30 bg-[var(--canvas)] text-accent-300 shadow-[var(--glow)]">
                    <Icon size={20} />
                  </span>
                  <div className="mt-5 flex items-baseline gap-2">
                    <span className="font-mono text-[12px] text-accent-400">0{i + 1}</span>
                    <h3 className="text-[18px] font-semibold text-white/90">{title}</h3>
                  </div>
                  <p className="mt-2 max-w-[34ch] text-[14px] leading-relaxed text-white/55">{body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="sources" className="scroll-mt-20 border-t border-white/6">
          <div className="mx-auto w-full max-w-6xl px-5 py-20 md:px-8">
            <div className="grid gap-10 lg:grid-cols-[minmax(0,22rem)_1fr]">
              <div>
                <div className="label">Sources</div>
                <h2 className="display mt-3 text-[32px] leading-tight text-white/95">Bring data from anywhere.</h2>
                <p className="mt-3 text-[15px] leading-relaxed text-white/55">Files are read in your browser. Links and databases are fetched and handed straight to it.</p>
                <div className="mt-6 flex items-center gap-2 text-[13px] text-white/50">
                  <Database size={15} className="text-accent-400" /> {fileSourceNames().length} file types · {liveSourceNames().length} live sources
                </div>
              </div>
              <div className="space-y-6">
                <div>
                  <div className="label">Files</div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {fileSourceNames().map((name) => (
                      <span key={name} className="chip bg-white/[0.02] text-white/70">{name}</span>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="label">Live sources</div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {liveSourceNames().map((name) => (
                      <span key={name} className="chip bg-white/[0.02] text-white/70">{name}</span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="px-5 pb-20 md:px-8">
          <div className="card card-glow relative mx-auto max-w-6xl overflow-hidden px-6 py-12 text-center md:px-12">
            <div aria-hidden="true" className="absolute inset-0 bg-[radial-gradient(50%_80%_at_50%_0%,var(--wash-a),transparent_70%)]" />
            <div className="relative">
              <h2 className="display text-[30px] leading-tight text-white/95 md:text-[38px]">See your data the way an analyst would.</h2>
              <p className="mx-auto mt-3 max-w-[52ch] text-[15px] text-white/55">Load a file or pick a sample. Your dashboard is ready before you finish reading this.</p>
              <Link href="/home" className="mt-7 inline-flex items-center gap-2 rounded-xl bg-accent-500 px-6 py-3.5 text-[15px] font-semibold text-on-accent shadow-[var(--glow)] transition hover:bg-accent-400">
                Open the app <ArrowRight size={16} />
              </Link>
            </div>
          </div>
        </section>

        <footer className="mt-auto border-t border-white/6">
          <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-5 py-6 text-[12.5px] text-white/45 md:px-8">
            <Logo size="sm" />
            <span className="max-w-[80ch]">
              Parsed, cleaned and queried in your browser. With no model in use, nothing leaves it; with your own key, column summaries
              and twenty sample rows go to your provider — and on Pro without a key of your own, to ours.
            </span>
            <Link href="/sign-in" className="ml-auto font-medium text-white/55 transition-colors hover:text-accent-400">
              Sign in
            </Link>
          </div>
        </footer>
      </div>
    </div>
  );
}
