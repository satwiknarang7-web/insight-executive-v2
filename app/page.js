'use client';

import Link from 'next/link';
import { ArrowRight, Calculator, FileDown, Grid3x3, MessageCircle, ShieldCheck, Sparkles, Wand2 } from 'lucide-react';
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

const SAMPLE = [
  ['2024-06-03', 'Kerala', '1,240'],
  ['03/06/2024', 'Punjab', '₹ 980'],
  ['2024-06-04', 'Orissa', '2,115'],
  ['4 Jun 2024', 'Goa', '640'],
];

const READS = [
  ['order_date', 'Dates in three formats, made one. Trend by month.'],
  ['state', 'Indian states, Orissa read as Odisha. Drawn as a map.'],
  ['amount', 'Money, with ₹ and commas stripped. Summed.'],
];

function Step({ n, title, children }) {
  return (
    <div className="bg-[var(--canvas)] p-6">
      <div className="mb-5 flex items-baseline gap-2.5">
        <span className="font-mono text-[12px] text-accent-400">{n}</span>
        <h3 className="text-[15px] font-semibold text-white/90">{title}</h3>
      </div>
      {children}
    </div>
  );
}

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
            <h2 className="display mt-3 max-w-2xl text-[32px] leading-tight text-white/95 md:text-[40px]">One messy file, followed through.</h2>
            <div className="mt-10 grid gap-px overflow-hidden rounded-2xl border border-white/8 bg-white/8 lg:grid-cols-3">
              <Step n="1" title="You load a file">
                <table className="w-full font-mono text-[11.5px]">
                  <thead>
                    <tr className="text-left text-white/40">
                      <th className="pb-2 font-normal">order_date</th>
                      <th className="pb-2 font-normal">state</th>
                      <th className="pb-2 text-right font-normal">amount</th>
                    </tr>
                  </thead>
                  <tbody className="text-white/70">
                    {SAMPLE.map(([d, st, a], i) => (
                      <tr key={i} className="border-t border-white/6">
                        <td className="py-1.5">{d}</td>
                        <td className="py-1.5">{st}</td>
                        <td className={`py-1.5 text-right ${a.startsWith('₹') ? 'text-amber-300/90' : ''}`}>{a}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Step>
              <Step n="2" title="It reads what each column is">
                <ul className="space-y-2.5 text-[12.5px]">
                  {READS.map(([col, what]) => (
                    <li key={col} className="grid grid-cols-[6.5rem_1fr] gap-3">
                      <span className="font-mono text-white/80">{col}</span>
                      <span className="text-white/50">{what}</span>
                    </li>
                  ))}
                </ul>
              </Step>
              <Step n="3" title="You get the finding, with the chart">
                <div className="flex h-16 items-end gap-1.5">
                  {[38, 44, 41, 52, 58, 71].map((h, i) => (
                    <span key={i} className={`flex-1 rounded-t-[3px] ${i === 5 ? 'bg-accent-400' : 'bg-white/15'}`} style={{ height: `${h}%` }} />
                  ))}
                </div>
                <p className="mt-4 text-[13.5px] leading-relaxed text-white/75">
                  Sales rose 23% in June, the best month so far. Kerala and Punjab account for most of the rise.
                </p>
              </Step>
            </div>
          </div>
        </section>

        <section id="sources" className="scroll-mt-20 border-t border-white/6">
          <div className="mx-auto grid w-full max-w-6xl gap-10 px-5 py-20 md:px-8 lg:grid-cols-[minmax(0,20rem)_1fr]">
            <div>
              <div className="label">Sources</div>
              <h2 className="display mt-3 text-[32px] leading-tight text-white/95">Where the data can come from.</h2>
              <p className="mt-3 text-[15px] leading-relaxed text-white/55">Files are read in your browser. Links and databases are fetched and handed straight to it.</p>
            </div>
            <dl className="divide-y divide-white/8 border-y border-white/8">
              {[['Files', fileSourceNames()], ['Databases and apps', liveSourceNames()]].map(([k, names]) => (
                <div key={k} className="grid gap-2 py-5 sm:grid-cols-[11rem_1fr]">
                  <dt className="text-[13px] font-semibold text-white/85">
                    {k} <span className="ml-1 font-mono text-[12px] font-normal text-white/35">{names.length}</span>
                  </dt>
                  <dd className="text-[13.5px] leading-7 text-white/55">{names.join(' · ')}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section className="border-t border-white/6">
          <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-6 px-5 py-16 md:px-8">
            <div className="mr-auto">
              <h2 className="display text-[26px] leading-tight text-white/95 md:text-[30px]">Try it on your own data.</h2>
              <p className="mt-2 text-[15px] text-white/55">Load a file, or start from one of the sample datasets.</p>
            </div>
            <Link href="/home" className="inline-flex items-center gap-2 rounded-xl bg-accent-500 px-6 py-3.5 text-[15px] font-semibold text-on-accent transition hover:bg-accent-400">
              Open the app <ArrowRight size={16} />
            </Link>
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
