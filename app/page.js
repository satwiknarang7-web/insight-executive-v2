'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { ArrowRight } from 'lucide-react';
import Logo from '../components/shell/Logo';
import ThemeToggle from '../components/shell/ThemeToggle';
import { availableConnectors } from '../lib/connectors/registry';
import { sourceGroups } from '../lib/sources';

/**
 * What this is, for somebody deciding whether to use it.
 *
 * The only page here addressed to a stranger, and for a while the only page
 * they could not reach: `/` was behind the middleware's auth check, so the
 * pitch was shown exclusively to people who had already signed up, while the
 * screen they actually landed on was the sign-in form. It is public now, and
 * it carries the argument — what the product does, in what order, and four
 * pictures of it doing so.
 *
 * Everything that *works* lives behind sign-in, in the app shell. This page
 * holds no data, reads none, and offers nothing but a way in.
 *
 * The order is the product first.
 *
 * It used to be an argument first: a two-column hero with the pitch on the left
 * and a panel of explanatory text on the right, and the dashboard — the one
 * asset that shows rather than claims — a full screen further down. At 1440x900
 * the right column ran out at 610px and the left at 790, so the fold ended on
 * two hundred and fifty pixels of nothing. A stranger's first screen was a
 * headline and an empty quadrant.
 *
 * So the hero is one column and says its piece, and the screenshot follows
 * immediately and wide enough to read. What is left of the argument — the three
 * things the pipeline does, and the thirty sources it reads — comes after the
 * proof rather than in place of it.
 */
/** The four screens an analysis produces, in the order they arrive. */
const SHOWCASE = [
  {
    title: 'Dashboard',
    desc: 'KPI cards, executive summary, and auto-generated charts — all computed from your data. Click any finding to deep-dive.',
    src: '/screenshots/dashboard.jpg',
  },
  {
    title: 'Data table',
    desc: 'Browse the cleaned rows in a filterable data grid. Column types are tagged, and every row is searchable.',
    src: '/screenshots/explore.jpg',
  },
  {
    title: 'Ask a question',
    desc: 'Type a question in plain English. Get a chart with the SQL that produced it, running in your browser.',
    src: '/screenshots/ask.jpg',
  },
  {
    title: 'Slideshow',
    desc: 'A full-screen slide deck with one finding per slide, keyboard navigation, and optional voice narration.',
    src: '/screenshots/present.jpg',
  },
];

/** What the pipeline does, in the order it does it. */
const STAGES = [
  ['Cleaned', 'Types coerced, blanks counted, personal fields redacted — in your browser.'],
  ['Analysed', 'A dashboard of charts the data chose, under an executive summary.'],
  ['Presented', 'The findings as a slide deck, each one traceable to its query.'],
];

/**
 * Every source, by name, read from the catalog rather than retyped.
 *
 * The hand-written list had already drifted — it omitted Supabase and renamed
 * three others — and the file line had been wrong since Parquet, SQLite, JSON,
 * XML and HTML arrived. Showing all of them rather than six and a count is the
 * point of the section: the breadth *is* the claim, and "and 19 more" asks the
 * reader to take it on trust while occupying the same space.
 */
function liveSourceNames() {
  return availableConnectors().map((c) => c.label);
}

/** The file kinds the catalog offers, each as its own name. */
function fileSourceNames() {
  const files = sourceGroups().find((g) => g.id === 'files');
  return (files?.items || [])
    .filter((i) => i.kind === 'file')
    .map((i) => i.label.replace(/ workbook| database| page| or photo of a table/, ''));
}

/** The framed screenshot, at whatever proportion the slot it sits in wants. */
function Screen({ title, src, aspect, priority = false, sizes }) {
  return (
    <div className="overflow-hidden rounded-xl border border-white/10 bg-white/[0.02] transition-colors duration-300 group-hover:border-accent-500/30">
      <div className="flex items-center gap-2 border-b border-white/6 px-3.5 py-2">
        <span className="label">{title}</span>
        <span className="ml-auto font-mono text-[10px] text-white/25">
          insight/{title.toLowerCase().replace(' ', '-')}
        </span>
      </div>
      <div className={`relative ${aspect}`}>
        <Image
          src={src}
          alt={`The ${title.toLowerCase()} screen`}
          fill
          priority={priority}
          className="object-cover object-top"
          sizes={sizes}
        />
      </div>
    </div>
  );
}

export default function LandingPage() {
  const revealRefs = useRef([]);
  const [hiddenCards, setHiddenCards] = useState(null);

  /**
   * The walkthrough fades in as it is scrolled to, one card after the next.
   *
   * The cards render visible and this hides them before revealing them, rather
   * than the other way round: a section that starts at opacity 0 in the
   * stylesheet and waits for JavaScript is a section that is silently missing
   * for anybody it never runs for.
   */
  useEffect(() => {
    const nodes = revealRefs.current.filter(Boolean);
    if (!nodes.length) return;
    if (typeof IntersectionObserver === 'undefined') return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

    setHiddenCards(new Set(nodes.map((_, i) => i)));

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const index = nodes.indexOf(entry.target);
          setHiddenCards((prev) => {
            if (!prev?.has(index)) return prev;
            const next = new Set(prev);
            next.delete(index);
            return next;
          });
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: '0px 0px -12% 0px' }
    );
    for (const node of nodes) observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="relative min-h-screen">
      <div className="ambient-wash" />
      <div className="grid-veil" />

      <div className="relative z-10 flex min-h-screen flex-col">
        <header className="mx-auto flex w-full max-w-6xl items-center gap-3 px-6 py-6 md:px-10">
          <Logo size="xl" />
          <div className="ml-auto flex items-center gap-1">
            <Link
              href="/sign-in"
              className="rounded-lg px-3 py-2 text-[14px] font-medium text-white/65 transition-colors hover:text-white/80"
            >
              Sign in
            </Link>
            <ThemeToggle compact />
          </div>
        </header>

        {/*
          * The hero says one thing, at a size that carries.
          *
          * The two lines used to be one headline of equal halves, and the
          * emphasis was on the wrong one: "Analyse your data." was the largest
          * text on the page and, at 35% white, also the faintest — a heading
          * competing with itself. It is the setup, so it is sized like one, and
          * the promise underneath gets the room.
          *
          * The size also used to step *down* at `lg` (54px to 46px) because the
          * headline had to share the row with a panel. Nothing shares the row
          * now, so it grows with the viewport the way a display size should.
          */}
        <section className="mx-auto w-full max-w-4xl px-6 pb-10 pt-12 text-center md:px-10">
          <p className="display text-[19px] text-white/45 md:text-[22px]">Analyse your data.</p>
          <h1
            className="display mt-1 text-balance text-[42px] leading-[1.03] text-white/90 md:text-[64px] lg:text-[74px]"
            style={{ fontVariationSettings: "'SOFT' 0, 'WONK' 0, 'opsz' 96, 'wght' 600" }}
          >
            Get insights you can{' '}
            {/*
              * Weight, not colour, and not a rule under the word.
              *
              * It was an underline in the accent — which reads as a hyperlink,
              * on the one word the sentence is built around. Colour had been
              * tried before that and could not work: light mode remaps the
              * whole accent ramp to navy, so the accent and the ink around it
              * came out as the same navy and the emphasis vanished.
              *
              * Fraunces is a variable face carrying 300 through 900, so the
              * emphasis can be the letterforms themselves. 900 against the
              * headline's 600 is unmistakable at this size, costs no colour,
              * and means the same thing in both themes.
              */}
            <span style={{ fontVariationSettings: "'SOFT' 0, 'WONK' 0, 'opsz' 96, 'wght' 900" }}>
              defend
            </span>
            .
          </h1>
          <p className="mx-auto mt-6 max-w-[54ch] text-[17px] leading-relaxed text-white/65 md:text-[18px]">
            Insight profiles your data, builds the charts an analyst would build, and computes every
            statistic itself — so each claim on screen traces back to a query you can read.
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-x-5 gap-y-3">
            <Link
              href="/home"
              className="inline-flex items-center gap-2 rounded-xl bg-accent-500 px-6 py-3 text-[15px] font-semibold text-on-accent transition-colors hover:bg-accent-400"
            >
              Open the app <ArrowRight size={16} />
            </Link>
            <Link
              href="/sign-in"
              className="text-[14px] text-white/45 transition-colors hover:text-white/70"
            >
              or sign in
            </Link>
          </div>

          <p className="mx-auto mt-6 max-w-[58ch] text-[14px] leading-relaxed text-white/45">
            <span className="label mr-1.5">Get started</span>
            Upload a spreadsheet, photograph a table, or connect a database. The analysis runs in
            your browser, and every figure keeps the query that produced it.
          </p>
        </section>

        {/* See it in action — the four screens the analysis produces.
          *
          * Not a 2x2 of equal tiles: the dashboard is the product and the other
          * three are what you do with it, so it takes the full width and they
          * share the row beneath. Equal tiles said they were equal things.
          *
          * It leads the page now rather than following the argument, so the
          * dashboard reaches the first screen instead of sitting a scroll below
          * it. The section heading had a right-aligned "How it works" beside it,
          * which read as a stray tag on a heading that needed no help; it has
          * gone to the band it actually describes.
          */}
        <section className="mx-auto w-full max-w-6xl px-6 pb-16 md:px-10">
          <div className="border-t border-white/6 pt-7">
            <div className="flex items-baseline gap-4">
              <h2 className="display text-[26px] leading-tight text-white/90 md:text-[30px]">
                See it in action
              </h2>
              <span className="label">How it works</span>
            </div>
            <p className="mt-2.5 max-w-[72ch] text-[15px] leading-relaxed text-white/65">
              Upload a file, and in seconds you have a full analytics dashboard, a data explorer, an
              AI question console, and a presentation deck — each one traceable and editable.
            </p>
          </div>

          <div className="mt-7 grid gap-7 md:grid-cols-3">
            {SHOWCASE.map((item, i) => (
              <div
                key={item.title}
                ref={(el) => {
                  revealRefs.current[i] = el;
                }}
                style={{ transitionDelay: `${i * 90}ms` }}
                className={`scroll-reveal group ${hiddenCards?.has(i) ? 'reveal-armed' : ''} ${
                  i === 0 ? 'md:col-span-3' : ''
                }`}
              >
                <Screen
                  title={item.title}
                  src={item.src}
                  priority={i === 0}
                  // The wide crop only works once there is width to spend on it:
                  // at 390px a 5:2 slot is 143px tall and the dashboard in it is
                  // a grey smudge. The phone gets a taller box and loses some
                  // width instead, which is the half of the screenshot worth
                  // keeping.
                  aspect={i === 0 ? 'aspect-video sm:aspect-[5/2]' : 'aspect-video'}
                  sizes={i === 0 ? '(max-width: 768px) 100vw, 1100px' : '(max-width: 768px) 100vw, 33vw'}
                />
                <div className="mt-4 flex gap-3">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-accent-500/25 bg-accent-500/8 text-[11px] font-bold tabular-nums text-accent-400">
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    <div className={`font-semibold text-white/90 ${i === 0 ? 'text-[19px]' : 'text-[16px]'}`}>
                      {item.title}
                    </div>
                    <p
                      className={`mt-1 leading-relaxed text-white/65 ${
                        i === 0 ? 'max-w-[62ch] text-[15px]' : 'text-[14px]'
                      }`}
                    >
                      {item.desc}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/*
          * What the output is, which the pictures above show and do not name.
          *
          * Three stages, across the page rather than stacked in a column beside
          * the hero — where they were 12px grey between hairlines and read as
          * the fine print of the panel next to them rather than as the three
          * things the product does.
          */}
        <section className="border-t border-white/6">
          <div className="mx-auto w-full max-w-6xl px-6 py-14 md:px-10">
            <ol className="grid gap-x-8 gap-y-8 sm:grid-cols-3">
              {STAGES.map(([step, body], index) => (
                <li key={step} className="border-t border-white/10 pt-4">
                  <div className="flex items-baseline gap-2.5">
                    <span className="text-[13px] font-bold tabular-nums text-accent-400">
                      {index + 1}
                    </span>
                    <div className="display text-[21px] text-white/90">{step}</div>
                  </div>
                  <p className="mt-2 text-[14px] leading-relaxed text-white/65">{body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/*
          * And what it reads — every name, rather than six and a promise.
          *
          * This was two runs of comma-separated grey at 12px, tucked under the
          * upload panel: thirty connectors and nine file kinds, rendered as the
          * least legible text on the page. It is the widest claim the product
          * makes and it was set as fine print, while the sign-in page showed the
          * same list as a grid of pills. One answer now, in the shared style.
          */}
        <section className="border-t border-white/6">
          <div className="mx-auto w-full max-w-6xl px-6 py-14 md:px-10">
            <div className="grid gap-10 lg:grid-cols-[minmax(0,20rem)_1fr]">
              <div>
                <div className="label">Files</div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {fileSourceNames().map((name) => (
                    <span key={name} className="chip text-white/65">
                      {name}
                    </span>
                  ))}
                </div>
              </div>
              <div>
                <div className="label">Live sources</div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {liveSourceNames().map((name) => (
                    <span key={name} className="chip text-white/65">
                      {name}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <footer className="mt-auto border-t border-white/6">
          <div className="mx-auto flex w-full max-w-6xl flex-wrap items-baseline gap-x-6 gap-y-2 px-6 py-6 text-[13px] text-white/45 md:px-10">
            <span>
              Parsed, cleaned and queried in your browser. With no model in use, nothing leaves it; with
              your own key, column summaries and twenty sample rows go to your provider — and on Pro
              without a key of your own, to ours.
            </span>
            <Link
              href="/sign-in"
              className="ml-auto font-semibold uppercase tracking-[0.12em] text-white/45 transition-colors hover:text-accent-400"
            >
              Sign in
            </Link>
          </div>
        </footer>
      </div>
    </div>
  );
}
