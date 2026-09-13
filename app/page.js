'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { ArrowRight, Compass } from 'lucide-react';
import Logo from '../components/shell/Logo';
import ThemeToggle from '../components/shell/ThemeToggle';
import { availableConnectors } from '../lib/connectors/registry';

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
 */
/** The four screens an analysis produces, in the order they arrive. */
const SHOWCASE = [
  {
    title: 'Dashboard',
    desc: 'KPI cards, executive summary, and auto-generated charts — all computed from your data. Click any finding to deep-dive.',
    src: '/screenshots/dashboard.jpg',
  },
  {
    title: 'Explore',
    desc: 'Browse the cleaned rows in a filterable data grid. Column types are tagged, and every row is searchable.',
    src: '/screenshots/explore.jpg',
  },
  {
    title: 'Ask AI',
    desc: 'Type a question in plain English. Get a chart with the SQL that produced it, running in your browser.',
    src: '/screenshots/ask.jpg',
  },
  {
    title: 'Present',
    desc: 'A full-screen slide deck with one finding per slide, keyboard navigation, and optional voice narration.',
    src: '/screenshots/present.jpg',
  },
];

export default function LandingPage() {
  const revealRefs = useRef([]);
  const [hiddenCards, setHiddenCards] = useState(null);

  /**
   * The walkthrough fades in as it is scrolled to, one card after the next.
   *
   * The cards render visible and this hides them before revealing them, rather
   * than the other way round: a section that starts at opacity 0 in the
   * stylesheet and waits for JavaScript is a section that is silently missing
   * whenever that JavaScript does not run. The floor below does the same job
   * for an observer that never delivers.
   */
  useEffect(() => {
    const cards = revealRefs.current.filter(Boolean);
    if (!cards.length || typeof IntersectionObserver === 'undefined') return;

    setHiddenCards(new Set(cards.map((_, i) => i)));
    const observer = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          observer.unobserve(e.target);
          const i = cards.indexOf(e.target);
          setHiddenCards((prev) => {
            if (!prev?.has(i)) return prev;
            const next = new Set(prev);
            next.delete(i);
            return next;
          });
        }),
      { threshold: 0.15 }
    );
    cards.forEach((el) => observer.observe(el));
    const floor = setTimeout(() => setHiddenCards(null), 4000);
    return () => {
      clearTimeout(floor);
      observer.disconnect();
    };
  }, []);

  return (
    <div className="relative min-h-screen">
      <div className="ambient-wash" />
      <div className="grid-veil" />

      <div className="relative z-10 mx-auto flex min-h-screen max-w-6xl flex-col px-6 py-7 md:px-10">
        <header className="flex items-center gap-3">
          <Logo size="xl" />
          <div className="ml-auto flex items-center gap-2">
            <Link
              href="/home"
              className="flex items-center gap-2 rounded-lg bg-accent-500 px-4 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-on-accent transition-colors hover:bg-accent-400"
            >
              Open the app <ArrowRight size={13} />
            </Link>
            <ThemeToggle />
          </div>
        </header>

        <div className="grid flex-1 content-center items-start gap-8 py-10 lg:grid-cols-[1fr_minmax(0,420px)] lg:gap-14">
          {/* Left: pitch */}
          <div className="flex flex-col lg:pt-4">
            {/*
              * The promise carries the emphasis, not the setup.
              *
              * Both halves were the same size and the second one was the greyer
              * of the two, which put the least contrast on the only sentence
              * that says what the product is for. Recessing the mundane half
              * keeps the two-beat rhythm and lets the payoff land.
              */}
            {/*
              * The size steps down when the grid splits, and the wrap is balanced.
              *
              * `md` is still one column, so the headline has the full width and
              * can afford 5xl. At `lg` the upload panel takes 470px and leaves
              * the pitch column about 450, where 5xl wrapped badly — so it
              * steps down and `text-balance` splits whatever still has to wrap
              * evenly, rather than leaving "defend." stranded on a line of its
              * own. On a wide screen the second line now fits whole.
              */}
            <h1 className="text-4xl font-black leading-[1.04] tracking-tight md:text-5xl lg:text-[2.5rem]">
              <span className="block text-white/40">Analyse your data.</span>
              <span className="block text-balance">
                Get insights you can{' '}
                {/*
                  * Underlined rather than coloured.
                  *
                  * `text-accent-400` looked right in the dark and vanished in
                  * the light: light mode deliberately remaps the whole accent
                  * ramp to navy, so the accent and the ink around it came out
                  * #123a63 against #0b2545 — the same word, no emphasis. A rule
                  * under the word is drawn in the accent of whichever theme is
                  * on and reads in both.
                  */}
                <span className="underline decoration-accent-400 decoration-[3px] underline-offset-[7px]">
                  defend
                </span>
                .
              </span>
            </h1>
            <p className="mt-4 max-w-[46ch] text-[15px] leading-relaxed text-white/55">
              Insight profiles your data, builds the charts an analyst would build, and computes every
              statistic itself — so each claim on screen traces back to a query you can read.
            </p>

            {/*
              * What you get, which the page never actually said.
              *
              * The three cards further down argue that the output can be
              * trusted; none of them says what the output *is*. These are the
              * three surfaces the app really has — the cleaning report, the
              * dashboard, the deck — in the order they arrive.
              */}
            <ol className="mt-6 max-w-md divide-y divide-white/6 border-y border-white/6">
              {[
                ['Cleaned', 'Types coerced, blanks counted, personal fields redacted — in your browser.'],
                ['Analysed', 'A dashboard of charts the data chose, under an executive summary.'],
                ['Presented', 'The findings as a slide deck, each one traceable to its query.'],
              ].map(([step, body], index) => (
                <li key={step} className="flex gap-4 py-3">
                  <span className="mt-px w-4 shrink-0 text-[11px] font-black tabular-nums text-accent-400/70">
                    {index + 1}
                  </span>
                  <div className="min-w-0">
                    <div className="text-[13px] font-bold text-white/85">{step}</div>
                    <p className="mt-0.5 text-[12px] leading-relaxed text-white/40">{body}</p>
                  </div>
                </li>
              ))}
            </ol>

            {/*
              * Read from the registry rather than retyped.
              *
              * The hand-written list here had already drifted: it omitted
              * Supabase entirely and renamed three of the others, so the page
              * was advertising something different from what the dropdown on
              * the right offers. Nine equal-weight pills also wrapped 7-and-2
              * and made a file look like the same kind of thing as a warehouse.
              */}
            <dl className="mt-6 max-w-md space-y-1.5 text-[12px]">
              {[
                ['Files', 'CSV, Excel'],
                ['Live sources', availableConnectors().map((c) => c.label).join(' · ')],
              ].map(([term, list]) => (
                <div key={term} className="flex gap-4">
                  <dt className="w-24 shrink-0 pt-px text-[9px] font-black uppercase tracking-[0.18em] text-white/30">
                    {term}
                  </dt>
                  <dd className="leading-relaxed text-white/45">{list}</dd>
                </div>
              ))}
            </dl>
          </div>

          {/* The invitation, opposite the argument. Anyone reading this far has
              read enough. */}
          <div className="flex flex-col gap-3 rounded-2xl border border-white/8 bg-white/[0.02] p-6">
            <div className="label">Get started</div>
            <p className="text-[13px] leading-relaxed text-white/50">
              Upload a spreadsheet, photograph a table, or connect a database. The analysis runs in
              your browser and every figure keeps the query that produced it.
            </p>
            <Link
              href="/home"
              className="mt-1 flex items-center justify-center gap-2 rounded-xl bg-accent-500 px-4 py-3 text-xs font-black uppercase tracking-[0.2em] text-on-accent transition-colors hover:bg-accent-400"
            >
              Open the app <ArrowRight size={14} />
            </Link>
            <Link
              href="/sign-in"
              className="text-center text-[12px] text-white/40 transition-colors hover:text-white/70"
            >
              Sign in, or create an account
            </Link>
          </div>
        </div>

        {/* See it in action — the four screens the analysis produces.
          *
          * Not a 2x2 of equal tiles: the dashboard is the product and the other
          * three are what you do with it, so it takes the full width and they
          * share the row beneath. Equal tiles said they were equal things.
          */}
        <section className="border-t border-white/6 py-14">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-lg font-black tracking-tight text-white/85">See it in action</h2>
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/25">
              how it works
            </span>
          </div>
          <p className="mt-2 max-w-2xl text-[12px] leading-relaxed text-white/40">
            Upload a file, and in seconds you have a full analytics dashboard, a data explorer, an
            AI question console, and a presentation deck — each one traceable and editable.
          </p>

          <div className="mt-8 grid gap-6 md:grid-cols-3">
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
                <div className="overflow-hidden rounded-xl border border-white/10 bg-white/[0.02] transition-colors duration-300 group-hover:border-accent-500/30">
                  <div className="flex items-center gap-2 border-b border-white/6 px-3 py-2">
                    <div className="flex gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-full bg-white/10" />
                      <span className="h-2.5 w-2.5 rounded-full bg-white/10" />
                      <span className="h-2.5 w-2.5 rounded-full bg-white/10" />
                    </div>
                    <span className="ml-2 text-[9px] font-bold uppercase tracking-[0.2em] text-white/25">
                      {item.title}
                    </span>
                  </div>
                  <div className={`relative ${i === 0 ? 'aspect-[21/8]' : 'aspect-video'}`}>
                    <Image
                      src={item.src}
                      alt={`The ${item.title.toLowerCase()} screen`}
                      fill
                      priority={i === 0}
                      className="object-cover object-top"
                      sizes={i === 0 ? '(max-width: 768px) 100vw, 1100px' : '(max-width: 768px) 100vw, 33vw'}
                    />
                  </div>
                </div>
                <div className="mt-3 flex gap-3">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-accent-500/25 bg-accent-500/8 text-[10px] font-black tabular-nums text-accent-400">
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-white/85">{item.title}</div>
                    <p className="mt-0.5 text-[12px] leading-relaxed text-white/40">{item.desc}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <footer className="mt-auto flex flex-wrap items-baseline gap-x-6 gap-y-1 border-t border-white/6 pt-4 text-[11px] text-white/25">
          <span>
            Parsed, cleaned and queried in your browser. Only summary statistics reach a model —
            never your rows.
          </span>
          <Link href="/sign-in" className="ml-auto font-bold uppercase tracking-[0.15em] text-white/35 transition-colors hover:text-accent-400">
            Sign in
          </Link>
        </footer>
      </div>
    </div>
  );
}
