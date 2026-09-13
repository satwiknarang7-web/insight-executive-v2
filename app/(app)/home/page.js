'use client';


import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  UploadCloud,
  FileSpreadsheet,
  ShieldCheck,
  ArrowRight,
  AlertTriangle,
  Table2,
  Trash2,
  X,
  LayoutDashboard,
  Compass,
  Sparkles,
  PencilRuler,
  Lock,
} from 'lucide-react';
import { useActions, useAnalysis, useDataset } from '../../../lib/store/DatasetProvider';
import { useTutorial } from '../../../lib/store/TutorialProvider';
import { usePlan } from '../../../lib/store/PlanProvider';
import { isExtractable } from '../../../lib/documentExtraction';
import ProgressPanel from '../../../components/panels/ProgressPanel';
import PageFrame from '../../../components/shell/PageFrame';
import { SAMPLES } from '../../../lib/samples';
import { availableConnectors } from '../../../lib/connectors/registry';
import ConnectSource from '../../../components/panels/ConnectSource';
import GeminiKeyPanel from '../../../components/panels/GeminiKeyPanel';
import TransformPanel from '../../../components/panels/TransformPanel';
import Image from 'next/image';

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
  const router = useRouter();
  const { dataset, status, error } = useDataset();
  const { analysis } = useAnalysis();
  const { ingestFile, ingestText, ingestDocument, analyze, startBlank, setError, reset } = useActions();
  const [dragging, setDragging] = useState(false);
  // Two-step, because discarding a loaded dataset also discards any analysis of
  // it and there is no undo — but a modal for one button is heavier than this.
  const [confirmRemove, setConfirmRemove] = useState(false);
  // One dropdown for every source. 'file' is a spreadsheet; anything else is a
  // connector id from the registry.
  const [source, setSource] = useState('file');
  const [organization, setOrganization] = useState(null);
  const inputRef = useRef(null);
  const { start: startTutorial } = useTutorial();
  const { can: planAllows, loading: planLoading } = usePlan();
  const revealRefs = useRef([]);

  /**
   * The walkthrough fades in as it is scrolled to, one card after the next.
   *
   * Two things are deliberate. The cards render *visible* and this hides them
   * before revealing them, rather than the other way round — a section that
   * starts at opacity 0 in the stylesheet and waits for JavaScript to turn it
   * on is a section that is silently missing whenever that JavaScript does not
   * run, and the markup being present makes it look fine. And the hiding is
   * React state rather than a class put on the node, because a class added
   * behind React's back is wiped by the next render of a `className` it owns.
   *
   * Every card is hidden and then observed; anything already on screen is
   * revealed by the observer's first callback. Measuring what is below the fold
   * at mount looked tidier and was wrong — layout is not settled that early.
   */
  const [hiddenCards, setHiddenCards] = useState(null);

  useEffect(() => {
    const cards = revealRefs.current.filter(Boolean);
    if (!cards.length) return;

    if (typeof IntersectionObserver === 'undefined') return;

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

    // The floor. An IntersectionObserver that never delivers — a browser that
    // is not painting, a bug here, anything — would otherwise leave the whole
    // section hidden with its markup sitting in the DOM looking healthy. After
    // this the cards are shown whether or not anyone was watching.
    const floor = setTimeout(() => setHiddenCards(null), 4000);

    return () => {
      clearTimeout(floor);
      observer.disconnect();
    };
  }, []);

  const busy = status === 'ingesting' || status === 'analyzing';
  // The logo in the app shell points here, so anyone who taps it lands back on
  // the upload screen with a finished analysis still in memory. Without a way
  // back, the only route in was to run the whole thing again.
  const hasAnalysis = analysis?.storyboard?.length > 0;

  // Several files are one session, not one upload each: the engine relates them
  // to each other exactly as it relates the tabs of a single workbook.
  const handleFiles = useCallback(
    async (files) => {
      const list = Array.from(files || []);
      /**
       * A photograph is not a spreadsheet, and the difference decides the path.
       *
       * Documents go one at a time through extraction: each is a separate
       * vision call on the reader's own key, and batching them would spend
       * several before anyone has seen whether the first came back sensibly.
       */
      const documents = list.filter(isExtractable);
      try {
        if (documents.length) {
          if (!planAllows('model')) {
            router.push('/upgrade');
            return;
          }
          await ingestDocument(documents[0]);
          return;
        }
        await ingestFile(list);
      } catch {
        /* surfaced through context error */
      }
    },
    [ingestFile, ingestDocument, planAllows, router]
  );

  const onDrop = useCallback(
    (e) => {
      e.preventDefault();
      setDragging(false);
      const files = Array.from(e.dataTransfer.files || []);
      if (files.length) handleFiles(files);
    },
    [handleFiles]
  );

  const loadSample = useCallback(
    async (sample) => {
      try {
        await ingestText(sample.csv, `${sample.key}_sample.csv`);
      } catch {
        /* surfaced through context error */
      }
    },
    [ingestText]
  );

  // The organisation a saved connection belongs to. Bootstrapped on demand,
  // and only once a database source is actually chosen — a visitor who only
  // ever uploads a file never pays for it.
  useEffect(() => {
    if (source === 'file' || organization) return;
    let cancelled = false;
    fetch('/api/auth/bootstrap', { method: 'POST' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d?.organization) setOrganization(d.organization);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [source, organization]);

  const removeDataset = useCallback(async () => {
    setConfirmRemove(false);
    await reset();
  }, [reset]);

  const runAnalysis = useCallback(async () => {
    try {
      await analyze();
      router.push('/dashboard');
    } catch {
      /* surfaced through context error */
    }
  }, [analyze, router]);

  /**
   * The other way in: an empty dashboard, filled by hand.
   *
   * Nothing is profiled and nothing is sent anywhere, which is why it is the
   * one both plans have. It is also instant, so there is no busy state to show.
   */
  const buildFromScratch = useCallback(() => {
    startBlank();
    router.push('/dashboard');
  }, [startBlank, router]);

  return (
    <PageFrame
      title="Home"
      subtitle={dataset ? `${dataset.fileName} · ${dataset.rowCount.toLocaleString()} rows` : 'Load a source to begin'}
    >
      <div className="relative">
        <div>


        {/*
          * The workbench leads, and the explanation follows it.
          *
          * This page used to be a landing page: a pitch on the left, the upload
          * panel on the right, sized for a browser with nothing else in it. Inside
          * the shell that arrangement stopped making sense twice over — the column
          * it was designed for is narrower now, and a pitch is an odd thing to
          * show someone who has already signed in and come here to work. So the
          * thing you came to do is first and full width, and what the product does
          * is underneath it for whoever is still deciding.
          */}
        <div className="flex flex-col gap-10 py-6">
          <div className="w-full max-w-2xl">
          {/*
            * Right: the actual workflow.
            *
            * `min-w-0` is load-bearing. The sample buttons truncate their
            * description with `white-space: nowrap`, and a nowrap string still
            * contributes its full width to min-content — which, as a grid
            * item's automatic minimum, propagated all the way out and made the
            * page 491px wide inside a 375px viewport. Every phone got a
            * horizontal scrollbar and a headline running off the edge. Letting
            * the track shrink below min-content is what lets `truncate` do the
            * job it was already asked to do.
            */}
          <div className="flex min-w-0 flex-col gap-4">
            {busy && <ProgressPanel />}

            {!busy && dataset && (
              <div className="card p-6">
                <div className="mb-4 flex items-center gap-2">
                  <span className="label">Data integrity report</span>
                  {/* "Verified" appeared the moment a file was parsed, before a
                      single query had run — a claim about an analysis that did
                      not exist yet. Cleaning is what has actually happened at
                      this point, so that is what the badge says. */}
                  <span className="ml-auto flex items-center gap-1.5 rounded-full border border-emerald-500/25 bg-emerald-500/8 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.15em] text-emerald-400">
                    <ShieldCheck size={10} /> Cleaned
                  </span>
                </div>
                <div className="flex items-start gap-3">
                  <FileSpreadsheet className="mt-0.5 shrink-0 text-accent-400" size={20} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-bold text-white/90">{dataset.fileName}</div>
                    <div className="mt-0.5 text-xs text-white/40">
                      {dataset.rowCount.toLocaleString()} rows · {dataset.columns.length} columns ·{' '}
                      {dataset.metrics.outliersCount.toLocaleString()} outliers flagged
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setConfirmRemove((v) => !v)}
                    aria-label={confirmRemove ? 'Keep this file' : 'Remove this file'}
                    title={confirmRemove ? 'Keep this file' : 'Remove this file'}
                    className="shrink-0 rounded-lg p-1.5 text-white/25 transition-colors hover:bg-rose-500/10 hover:text-rose-400"
                  >
                    {confirmRemove ? <X size={15} /> : <Trash2 size={15} />}
                  </button>
                </div>

                {confirmRemove && (
                  <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-rose-500/25 bg-rose-500/[0.06] p-3">
                    <div className="min-w-0 flex-1 text-[12px] leading-relaxed text-white/60">
                      Remove {dataset.fileName}? The cleaned rows and any analysis of them are discarded.
                    </div>
                    <button
                      type="button"
                      onClick={removeDataset}
                      className="shrink-0 rounded-lg bg-rose-500/90 px-3 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-white transition-colors hover:bg-rose-500"
                    >
                      Remove
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmRemove(false)}
                      className="shrink-0 rounded-lg border border-white/10 px-3 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-white/50 transition-colors hover:bg-white/5 hover:text-white"
                    >
                      Keep
                    </button>
                  </div>
                )}

                <div className="mt-5 grid grid-cols-2 gap-2">
                  <Stat label="Redacted PII" value={dataset.metrics.redactedPII} tone="accent" />
                  <Stat label="Blanks found" value={dataset.metrics.nullsFound} tone="amber" />
                  <Stat label="Types coerced" value={dataset.metrics.typesCoerced} tone="plain" />
                  <Stat label="Outliers flagged" value={dataset.metrics.outliersCount} tone="plain" />
                </div>

                {hasAnalysis && (
                  <button
                    onClick={() => router.push('/dashboard')}
                    className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-accent-500 px-4 py-3 text-sm font-black uppercase tracking-[0.15em] text-on-accent transition-transform hover:bg-accent-400 active:scale-[0.99]"
                  >
                    <LayoutDashboard size={16} /> Back to the dashboard
                  </button>
                )}
                {/*
                  * How this dataset gets its dashboard.
                  *
                  * Asked here rather than at sign-up, because the answer
                  * depends on the data in front of you: the same account may
                  * want the analyst for one export and a blank page for the
                  * next. On a free plan the assisted option is shown rather
                  * than hidden — a locked door you can see is information; a
                  * missing one is confusion.
                  */}
                {planAllows('autoAnalysis') ? (
                  <button
                    onClick={runAnalysis}
                    className={
                      hasAnalysis
                        ? 'mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 px-4 py-2.5 text-xs font-bold uppercase tracking-[0.15em] text-white/50 transition-colors hover:bg-white/5 hover:text-white'
                        : 'mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-accent-500 px-4 py-3 text-sm font-black uppercase tracking-[0.15em] text-on-accent transition-transform hover:bg-accent-400 active:scale-[0.99]'
                    }
                  >
                    <Sparkles size={hasAnalysis ? 14 : 16} />
                    {hasAnalysis ? 'Re-run the analysis' : 'AI-assisted dashboard'}
                  </button>
                ) : (
                  !planLoading && (
                    <button
                      onClick={() => router.push('/upgrade')}
                      className="mt-5 flex w-full items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3 text-left transition-colors hover:border-accent-500/30 hover:bg-white/[0.04]"
                    >
                      <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.15em] text-white/40">
                        <Lock size={14} /> AI-assisted dashboard
                      </span>
                      <span className="shrink-0 rounded-full border border-accent-500/30 bg-accent-500/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.15em] text-accent-400">
                        Pro
                      </span>
                    </button>
                  )
                )}

                <button
                  onClick={buildFromScratch}
                  className={
                    planAllows('autoAnalysis')
                      ? 'mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 px-4 py-2.5 text-xs font-bold uppercase tracking-[0.15em] text-white/50 transition-colors hover:bg-white/5 hover:text-white'
                      : 'mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-accent-500 px-4 py-3 text-sm font-black uppercase tracking-[0.15em] text-on-accent transition-transform hover:bg-accent-400 active:scale-[0.99]'
                  }
                >
                  <PencilRuler size={14} /> Build from scratch
                </button>
                <button
                  onClick={() => router.push('/explore')}
                  className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 px-4 py-2.5 text-xs font-bold uppercase tracking-[0.15em] text-white/50 transition-colors hover:bg-white/5 hover:text-white"
                >
                  <Table2 size={14} /> Browse the rows first
                </button>
                <button
                  onClick={() => inputRef.current?.click()}
                  className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 px-4 py-2.5 text-xs font-bold uppercase tracking-[0.15em] text-white/50 transition-colors hover:bg-white/5 hover:text-white"
                >
                  <UploadCloud size={14} /> Replace with another file
                </button>
                <input
                  ref={inputRef}
                  type="file"
                  multiple
                  accept=".csv,.tsv,.txt,.xlsx,.xlsm,.xlsb,.xls,text/csv,.png,.jpg,.jpeg,.webp,.pdf,image/*,application/pdf"
                  className="hidden"
                  onChange={(e) => {
                    const files = Array.from(e.target.files || []);
                    if (files.length) handleFiles(files);
                    e.target.value = '';
                  }}
                />
              </div>
            )}

            {!busy && !dataset && (
              <>
                <div className="card p-3">
                  <label className="flex items-center gap-3">
                    <span className="label shrink-0">Data source</span>
                    <select
                      value={source}
                      onChange={(e) => setSource(e.target.value)}
                      className="min-w-0 flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm font-bold text-white/85 outline-none focus:border-accent-500/50"
                    >
                      <option value="file" className="bg-surface">
                        CSV or Excel file
                      </option>
                      {availableConnectors().map((c) => (
                        <option key={c.id} value={c.id} className="bg-surface">
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  {/* The dropzone's "nothing leaves your browser" is true of a
                      file and false of a warehouse: a connector's rows are
                      fetched by the server by design. The claim is scoped to
                      the source that is actually selected. */}
                  {source !== 'file' && (
                    <p className="mt-3 text-xs leading-relaxed text-white/35">
                      Rows from a connected database are fetched by this app&apos;s server and passed
                      straight through to your browser, where they are cleaned and analysed. Unlike a file,
                      they do travel over the network.
                    </p>
                  )}

                  {source !== 'file' && (
                    <div className="mt-4">
                      <ConnectSource
                        source={source}
                        organization={organization}
                        onNeedsAccount={() => router.push('/sign-in?next=/')}
                      />
                    </div>
                  )}
                </div>
              </>
            )}

            {!busy && !dataset && source === 'file' && (
              <>
                <div
                  data-tutorial="upload-dropzone"
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragging(true);
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={onDrop}
                  onClick={() => inputRef.current?.click()}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
                  className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-colors ${
                    dragging
                      ? 'border-accent-500 bg-accent-500/8'
                      : 'border-white/12 bg-white/[0.02] hover:border-accent-500/40 hover:bg-white/[0.035]'
                  }`}
                >
                  <UploadCloud size={26} className={dragging ? 'text-accent-400' : 'text-white/30'} />
                  <div className="text-sm font-bold text-white/80">Drop a spreadsheet or a photo of a table</div>
                  <div className="text-xs text-white/35">
                    {planAllows('model')
                      ? 'CSV, Excel — or a PDF or photograph, read on your own key'
                      : 'CSV and Excel — nothing leaves your browser'}
                  </div>
                  <input
                    ref={inputRef}
                    type="file"
                    multiple
                    accept=".csv,.tsv,.txt,.xlsx,.xlsm,.xlsb,.xls,text/csv,.png,.jpg,.jpeg,.webp,.pdf,image/*,application/pdf"
                    className="hidden"
                    onChange={(e) => {
                      const files = Array.from(e.target.files || []);
                      if (files.length) handleFiles(files);
                      e.target.value = '';
                    }}
                  />
                </div>

                <div className="card p-4" data-tutorial="sample-datasets">
                  <div className="label mb-2">Or try a sample</div>
                  <div className="flex flex-col gap-2">
                    {SAMPLES.map((s) => (
                      <button
                        key={s.key}
                        onClick={() => loadSample(s)}
                        className="group flex items-center justify-between gap-3 rounded-xl border border-white/7 bg-white/[0.02] px-3.5 py-2.5 text-left transition-colors hover:border-accent-500/30 hover:bg-white/[0.05]"
                      >
                        <div className="min-w-0">
                          <div className="text-[13px] font-bold text-white/85 group-hover:text-accent-300">{s.title}</div>
                          <div className="truncate text-[11px] text-white/35">{s.description}</div>
                        </div>
                        <ArrowRight size={15} className="shrink-0 text-white/20 group-hover:text-accent-400" />
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/*
              * Outside the fragment above, so it is on the page in both states.
              *
              * That fragment is the empty state — drop zone and samples — and a
              * key is just as worth connecting once a file is loaded, which is
              * exactly when someone is about to press Analyse and find out what
              * the writing reads like. It sits below the upload rather than
              * above it because uploading is the task and this is a setting.
              */}
            {!busy && dataset && <TransformPanel />}

            {planAllows('model') && (
              <div data-tutorial="gemini-key-panel">
                <GeminiKeyPanel />
              </div>
            )}

            {error && (
              <div className="flex items-start gap-3 rounded-xl border border-rose-500/30 bg-rose-500/8 p-4">
                <AlertTriangle size={16} className="mt-0.5 shrink-0 text-rose-400" />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-bold uppercase tracking-[0.2em] text-rose-300">Could not load that</div>
                  <p className="mt-1 break-words text-[13px] text-rose-200/70">{error}</p>
                </div>
                <button onClick={() => setError(null)} className="text-xs text-rose-300/60 hover:text-rose-200">
                  Dismiss
                </button>
              </div>
            )}
          </div>
          </div>

          <div className="border-t border-white/6 pt-8">
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
          </div>
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

        <footer className="flex flex-wrap items-baseline gap-x-6 gap-y-1 border-t border-white/6 pt-4 text-[11px] text-white/25">
          <span>Parsed, cleaned and queried in your browser. Only summary statistics reach a model — never your rows.</span>
          <button
            onClick={() => startTutorial()}
            className="ml-auto flex items-center gap-1.5 font-bold uppercase tracking-[0.15em] text-white/35 transition-colors hover:text-accent-400"
          >
            <Compass size={12} /> Guided tour
          </button>
        </footer>
      </div>
    </PageFrame>
  );
}

function Stat({ label, value, tone }) {
  const color = tone === 'accent' ? 'text-accent-400' : tone === 'amber' ? 'text-amber-400' : 'text-white/80';
  return (
    <div className="rounded-xl border border-white/6 bg-white/[0.02] px-3 py-3">
      <div className={`text-2xl font-black tracking-tight ${color}`}>{(value || 0).toLocaleString()}</div>
      <div className="mt-1 text-[9px] font-black uppercase tracking-[0.2em] text-white/30">{label}</div>
    </div>
  );
}
