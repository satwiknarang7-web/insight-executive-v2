'use client';


import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  UploadCloud,
  FileSpreadsheet,
  FileImage,
  ChevronDown,
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
import { acceptFor, sourceById } from '../../../lib/sources';
import ConnectSource from '../../../components/panels/ConnectSource';
import SourcePicker from '../../../components/panels/SourcePicker';
import DocumentImport from '../../../components/panels/DocumentImport';
import WebSource from '../../../components/panels/WebSource';
import GeminiKeyPanel from '../../../components/panels/GeminiKeyPanel';
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
  const { ingestFile, ingestText, analyze, startBlank, setError, reset } = useActions();
  const [dragging, setDragging] = useState(false);
  // Two-step, because discarding a loaded dataset also discards any analysis of
  // it and there is no undo — but a modal for one button is heavier than this.
  const [confirmRemove, setConfirmRemove] = useState(false);
  // One dropdown for every source. 'file' is a spreadsheet; anything else is a
  // connector id from the registry.
  // Which entry of the catalog is chosen. Everything below asks the entry
  // what kind of thing it is — a file, a link, a database, pasted text — and
  // renders the form for that kind.
  const [source, setSource] = useState('file');
  const chosen = sourceById(source) || sourceById('file');
  const [pasted, setPasted] = useState('');
  // Whether the document reader is open. Its own feature, its own screen.
  const [documents, setDocuments] = useState(false);
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
      // A photograph dropped on the file zone is almost always a mistake — the
      // reading of it needs checking, and this path loads straight through. It
      // is sent to the screen that can check it rather than quietly refused.
      if (list.some(isExtractable)) {
        setDocuments(true);
        setError('A photograph or a PDF is read below, where you can check what it says before it is loaded.');
        return;
      }
      try {
        await ingestFile(list);
      } catch {
        /* surfaced through context error */
      }
    },
    [ingestFile, setError]
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
    if (chosen.kind !== 'connector' || organization) return;
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
  }, [chosen.kind, organization]);

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


        <div className="w-full max-w-5xl py-2">
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
                  accept={acceptFor()}
                  className="hidden"
                  onChange={(e) => {
                    const files = Array.from(e.target.files || []);
                    if (files.length) handleFiles(files);
                    e.target.value = '';
                  }}
                />
              </div>
            )}

            {/*
              * The source comes first, because it decides what everything under
              * it is.
              *
              * The drop zone used to lead and the picker sat at the bottom, which
              * put the answer above the question: a zone that takes CSVs is the
              * *form* for having chosen CSV, and it is the wrong form entirely
              * once somebody picks Postgres. Choose the source, then fill in what
              * that source needs.
              */}
            {!busy && !dataset && (
              <div className="card p-4" data-tutorial="source-catalog">
                <div className="mb-3 flex items-center gap-2">
                  <span className="label">Get data</span>
                  <span className="text-[11px] text-white/30">Files stay in your browser. Links and databases are fetched by the server and handed straight to it.</span>
                </div>
                <SourcePicker value={source} onChange={setSource} allowsModel={planAllows('model')} />

                {chosen.kind === 'connector' && (
                  <div className="mt-4 border-t border-white/6 pt-4">
                    <p className="mb-3 text-xs leading-relaxed text-white/35">
                      Rows from a connected database are fetched by this app&apos;s server and passed
                      straight through to your browser, where they are cleaned and analysed. Unlike a file,
                      they do travel over the network.
                    </p>
                    <ConnectSource
                      source={chosen.connector}
                      organization={organization}
                      onNeedsAccount={() => router.push('/sign-in?next=/')}
                    />
                  </div>
                )}

                {chosen.kind === 'web' && (
                  <div className="mt-4 border-t border-white/6 pt-4">
                    <WebSource kind={chosen.web} />
                  </div>
                )}

                {chosen.kind === 'paste' && (
                  <div className="mt-4 flex flex-col gap-2 border-t border-white/6 pt-4">
                    <textarea
                      value={pasted}
                      onChange={(e) => setPasted(e.target.value)}
                      placeholder={'region,revenue,units\nNorth,1200,5\nSouth,850,3'}
                      spellCheck={false}
                      rows={6}
                      aria-label="Pasted rows"
                      className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 font-mono text-[11px] text-white/85 outline-none placeholder:text-white/20 focus:border-accent-500/50"
                    />
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        disabled={!pasted.trim()}
                        onClick={() => ingestText(pasted, /^\s*[[{]/.test(pasted) ? 'pasted.json' : 'pasted.csv').catch(() => {})}
                        className="rounded-lg bg-accent-500 px-4 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-on-accent transition-colors hover:bg-accent-400 disabled:opacity-40"
                      >
                        Load
                      </button>
                      <span className="text-[11px] text-white/30">Comma, tab or semicolon separated, with a header row. JSON works too.</span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* And the form for whichever kind was chosen. A file is dropped;
                everything else has its own panel inside the card above. */}
            {!busy && !dataset && chosen.kind === 'file' && (
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
                  <div className="text-sm font-bold text-white/80">
                    {chosen.id === 'file' ? 'Drop a file, or several' : `Drop a ${chosen.label.replace(/ workbook| database| page/, '').toLowerCase()} file`}
                  </div>
                  <div className="text-xs text-white/35">
                    {chosen.id === 'document'
                      ? 'A PDF or a photograph, read by a model on your own key'
                      : 'CSV, Excel, JSON, XML, Parquet, SQLite — nothing leaves your browser'}
                  </div>
                  <input
                    ref={inputRef}
                    type="file"
                    multiple
                    accept={acceptFor(chosen.id)}
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
                {/*
                  * Reading a table out of a photograph, on its own.
                  *
                  * It was one tile among nine in the source catalogue, which
                  * put it beside CSV as though the two were the same kind of
                  * act. They are not: one is parsed and the other is read by a
                  * model that is right most of the time, and the difference is
                  * a screen where you check it. Several pages at once, every
                  * cell editable.
                  */}
                <div className="card p-4">
                  <button
                    type="button"
                    onClick={() => setDocuments((v) => !v)}
                    aria-expanded={documents}
                    className="flex w-full items-center gap-2.5 text-left"
                  >
                    <FileImage size={15} className="shrink-0 text-accent-400" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-semibold text-white/85">
                        Photograph or PDF of a table
                      </span>
                      <span className="mt-0.5 block text-[11px] text-white/35">
                        Several pages at once, read by a model and checked by you before anything loads.
                      </span>
                    </span>
                    {!planAllows('model') && (
                      <span className="shrink-0 rounded-full border border-accent-500/30 bg-accent-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.15em] text-accent-400">
                        Pro
                      </span>
                    )}
                    <ChevronDown
                      size={15}
                      className={`shrink-0 text-white/30 transition-transform ${documents ? 'rotate-180' : ''}`}
                    />
                  </button>
                  {documents &&
                    (planAllows('model') ? (
                      <div className="mt-4 border-t border-white/6 pt-4">
                        <DocumentImport onLoaded={() => setDocuments(false)} />
                      </div>
                    ) : (
                      <p className="mt-4 border-t border-white/6 pt-4 text-[12px] leading-relaxed text-white/40">
                        Reading a document needs a model, which is on the Pro plan — every other source
                        here works without one.
                      </p>
                    ))}
                </div>

                <div className="card p-4" data-tutorial="sample-datasets">
                  <div className="label mb-2.5">Or try a sample</div>
                  <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                    {SAMPLES.map((s) => (
                      <button
                        key={s.key}
                        onClick={() => loadSample(s)}
                        className="group flex items-start justify-between gap-2 rounded-xl border border-white/7 bg-white/[0.02] px-3.5 py-3 text-left transition-colors hover:border-accent-500/30 hover:bg-white/[0.05]"
                      >
                        <div className="min-w-0">
                          <div className="text-[13px] font-bold text-white/85 group-hover:text-accent-300">{s.title}</div>
                          <div className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-white/35">{s.description}</div>
                        </div>
                        <ArrowRight size={14} className="mt-0.5 shrink-0 text-white/20 group-hover:text-accent-400" />
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
        </div>
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
