'use client';

import Link from 'next/link';
import { ArrowRight, FileSpreadsheet } from 'lucide-react';
import Logo from '../components/shell/Logo';
import ThemeToggle from '../components/shell/ThemeToggle';
import ProductPreview from '../components/landing/ProductPreview';
import Reveal from '../components/motion/Reveal';
import { availableConnectors } from '../lib/connectors/registry';

/**
 * What this is, for somebody deciding whether to use it.
 *
 * The only page addressed to a stranger. It shows the product first (a live
 * preview drawn from the theme, never a stale screenshot), then what it does,
 * how, and what it reads.
 *
 * Positioned as help for analysts, never a replacement: it takes the
 * repetitive part of the work and leaves the judgement with people. Every claim here is something the app does today.
 * This page holds no data and reads none.
 */

// Where an analyst's week goes, and what happens to each part here. Every
// right-hand line is something the app does today.
const HOURS = [
  ['Fixing dates, currencies and misspelt categories', 'Done as the file loads, with a report of every change'],
  ['Building the first-pass dashboard', 'Drafted from the columns; you edit, move or delete any chart'],
  ['"Can you quickly pull revenue by region?"', 'They ask it in plain words and get the chart themselves'],
  ['Turning the dashboard into a deck', 'Exported to PDF, Word or PowerPoint, or presented as a slideshow'],
];

const CONTROL = [
  ['Every chart is a draft', 'Change the measure, the split or the chart type, or remove it. Nothing is locked.'],
  ['Every number is traceable', 'Captions carry the figures behind them. Differences that are noise are called noise.'],
  ['Nothing changes without you', 'The assistant proposes a change and waits. You click Apply, and can undo it.'],
];

const TEAMS = [
  ['Analysts', 'Spend the week on the questions that need a person, not on cleaning and first drafts.'],
  ['Managers and founders', 'Look at the numbers yourself between reports, without waiting in a queue.'],
  ['Finance, ops and marketing', 'Bring the export you already have. Get a readable picture of it the same day.'],
];

const FACTS = [
  ['Minutes', 'from raw export to a first dashboard'],
  ['Editable', 'every chart, caption and step'],
  ['In-browser', 'files are parsed and analysed on your machine'],
];

function liveSourceNames() {
  return availableConnectors().map((c) => c.label);
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
              <a href="#hours" className="transition-colors hover:text-white/90">What it does</a>
              <a href="#control" className="transition-colors hover:text-white/90">You stay in charge</a>
              <a href="#teams" className="transition-colors hover:text-white/90">Who uses it</a>
            </nav>
            <div className="ml-auto flex items-center gap-2">
              <Link href="/sign-in" className="hidden rounded-lg px-3 py-2 text-[13.5px] font-medium text-white/65 transition-colors hover:text-white/90 sm:block">
                Sign in
              </Link>
              <Link href="/home" className="group inline-flex items-center gap-1.5 rounded-lg bg-accent-500 px-3.5 py-2 text-[13px] font-semibold text-on-accent transition hover:bg-accent-400">
                Open the app <ArrowRight size={14} className="nudge" />
              </Link>
              <ThemeToggle compact />
            </div>
          </div>
        </header>

        <section className="mx-auto grid w-full max-w-6xl items-center gap-14 px-5 pb-20 pt-14 md:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.08fr)] lg:pt-20">
          <div className="stagger">
            <div>
              <span className="eyebrow">For analysts and the teams they work with</span>
            </div>
            <h1 className="display mt-6 text-balance text-[40px] leading-[1.04] text-white/95 md:text-[52px]">
              Skip the busywork. <span className="text-gradient anim-shimmer">Keep the judgement.</span>
            </h1>
            <p className="mt-6 max-w-[52ch] text-[17px] leading-relaxed text-white/60">
              Insight cleans the file, drafts the dashboard and writes the first read of it. You decide what matters,
              change what doesn&apos;t fit, and take it to the people who need it.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link href="/home" className="group inline-flex items-center gap-2 rounded-xl bg-accent-500 px-6 py-3.5 text-[15px] font-semibold text-on-accent shadow-[var(--glow)] transition hover:-translate-y-0.5 hover:bg-accent-400">
                Start with your data <ArrowRight size={16} className="nudge" />
              </Link>
              <Link href="/home" className="group inline-flex items-center gap-2 rounded-xl border border-white/12 bg-white/[0.03] px-5 py-3.5 text-[15px] font-medium text-white/80 transition hover:-translate-y-0.5 hover:bg-white/[0.07]">
                <FileSpreadsheet size={15} className="text-accent-400" /> Try a sample
              </Link>
            </div>
            <dl className="stagger mt-10 grid max-w-md grid-cols-3 gap-4 border-t border-white/8 pt-6">
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

        <section id="hours" className="scroll-mt-20 border-t border-white/6">
          <div className="mx-auto w-full max-w-6xl px-5 py-20 md:px-8">
            <Reveal className="max-w-2xl">
              <div className="label">Where the hours go</div>
              <h2 className="display mt-3 text-[32px] leading-tight text-white/95 md:text-[40px]">Most analysis time isn&apos;t analysis.</h2>
              <p className="mt-3 text-[16px] leading-relaxed text-white/55">
                It goes on cleaning files, rebuilding the same charts and answering one-off requests. Insight does that part, so the people
                who know the business can think about it.
              </p>
            </Reveal>
            <Reveal className="mt-10 border-t border-white/10" delay={80}>
              <div className="hidden grid-cols-2 gap-8 py-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/35 md:grid">
                <span>The work</span>
                <span>With Insight</span>
              </div>
              {HOURS.map(([task, now]) => (
                <div key={task} className="group grid gap-1 border-t border-white/8 py-5 transition-colors hover:bg-white/[0.02] md:grid-cols-2 md:gap-8">
                  <span className="text-[15px] text-white/55 transition-colors group-hover:text-white/70">{task}</span>
                  <span className="text-[15px] font-medium text-white/90 transition-transform duration-300 group-hover:translate-x-1">{now}</span>
                </div>
              ))}
            </Reveal>
          </div>
        </section>

        <section id="control" className="scroll-mt-20 border-t border-white/6">
          <div className="mx-auto grid w-full max-w-6xl gap-12 px-5 py-20 md:px-8 lg:grid-cols-[minmax(0,22rem)_1fr]">
            <Reveal>
              <div className="label">You stay in charge</div>
              <h2 className="display mt-3 text-[32px] leading-tight text-white/95">A first draft, not a final answer.</h2>
            </Reveal>
            <dl className="grid gap-8 sm:grid-cols-3">
              {CONTROL.map(([k, v], i) => (
                <Reveal key={k} delay={i * 120} className="border-l-2 border-accent-400/60 pl-4 transition-colors hover:border-accent-400">
                  <dt className="text-[15px] font-semibold text-white/90">{k}</dt>
                  <dd className="mt-2 text-[14px] leading-relaxed text-white/55">{v}</dd>
                </Reveal>
              ))}
            </dl>
          </div>
        </section>

        <section id="teams" className="scroll-mt-20 border-t border-white/6">
          <div className="mx-auto w-full max-w-6xl px-5 py-20 md:px-8">
            <Reveal className="label">Who uses it</Reveal>
            <div className="mt-8 grid gap-10 md:grid-cols-3">
              {TEAMS.map(([who, why], i) => (
                <Reveal key={who} delay={i * 120}>
                  <h3 className="display text-[22px] text-white/95">{who}</h3>
                  <p className="mt-2 text-[14.5px] leading-relaxed text-white/55">{why}</p>
                </Reveal>
              ))}
            </div>
            <p className="mt-12 text-[13px] text-white/40">
              Reads CSV, Excel, JSON, Parquet and {liveSourceNames().length} databases and apps, including PostgreSQL, Snowflake and SQL Server. Files are processed in your browser.
            </p>
          </div>
        </section>

        <section className="border-t border-white/6">
          <Reveal className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-6 px-5 py-16 md:px-8">
            <div className="mr-auto">
              <h2 className="display text-[26px] leading-tight text-white/95 md:text-[30px]">Try it on last month&apos;s export.</h2>
              <p className="mt-2 text-[15px] text-white/55">Or start from a sample dataset.</p>
            </div>
            <Link href="/home" className="group inline-flex items-center gap-2 rounded-xl bg-accent-500 px-6 py-3.5 text-[15px] font-semibold text-on-accent shadow-[var(--glow)] transition hover:-translate-y-0.5 hover:bg-accent-400">
              Open the app <ArrowRight size={16} className="nudge" />
            </Link>
          </Reveal>
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
