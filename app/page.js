'use client';

import Link from 'next/link';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  UserRound,
  UploadCloud,
  FileSpreadsheet,
  ShieldCheck,
  Gauge,
  Sparkles,
  ArrowRight,
  AlertTriangle,
  Table2,
  Trash2,
  X,
} from 'lucide-react';
import { useActions, useDataset } from '../lib/store/DatasetProvider';
import ThemeToggle from '../components/shell/ThemeToggle';
import Logo from '../components/shell/Logo';
import { vaultAvailable } from '../lib/vault/supabase.client';
import ProgressPanel from '../components/panels/ProgressPanel';
import { SAMPLES } from '../lib/samples';
import { CONNECTORS } from '../lib/connectors/registry';
import ConnectSource from '../components/panels/ConnectSource';

const FEATURES = [
  {
    icon: ShieldCheck,
    title: 'Cleaned and checked first',
    body: 'Emails, phone numbers and card-shaped IDs are redacted in your browser. Types are coerced, blanks are counted, outliers flagged.',
  },
  {
    icon: Gauge,
    title: 'Every number is computed, not guessed',
    body: 'Statistics come from real SQL over your rows. The language model only phrases findings it has been handed — it never does the maths.',
  },
  {
    icon: Sparkles,
    title: 'Charts chosen by the data',
    body: 'A deterministic analyst playbook proposes the charts, then validates each type against the shape of its own results.',
  },
];

export default function LandingPage() {
  const router = useRouter();
  const { dataset, status, error } = useDataset();
  const { ingestFile, ingestText, analyze, setError, reset } = useActions();
  const [dragging, setDragging] = useState(false);
  // Two-step, because discarding a loaded dataset also discards any analysis of
  // it and there is no undo — but a modal for one button is heavier than this.
  const [confirmRemove, setConfirmRemove] = useState(false);
  // One dropdown for every source. 'file' is a spreadsheet; anything else is a
  // connector id from the registry.
  const [source, setSource] = useState('file');
  const [organization, setOrganization] = useState(null);
  const inputRef = useRef(null);

  const busy = status === 'ingesting' || status === 'analyzing';

  // Several files are one session, not one upload each: the engine relates them
  // to each other exactly as it relates the tabs of a single workbook.
  const handleFiles = useCallback(
    async (files) => {
      try {
        await ingestFile(files);
      } catch {
        /* surfaced through context error */
      }
    },
    [ingestFile]
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

  return (
    <div className="relative min-h-screen">
      <div className="ambient-wash" />
      <div className="grid-veil" />

      <div className="relative z-10 mx-auto flex min-h-screen max-w-6xl flex-col px-6 py-10 md:px-10">
        <header className="flex items-center gap-3">
          <Logo size="lg" />
          <div className="ml-auto flex items-center gap-2">
            {/* No Connections button: a connection is made in the dropdown
                below, at the moment you actually want data out of it. What was
                left on that screen — the credentials you already stored, and
                the account itself — is on the profile page. */}
            {vaultAvailable() && (
              <Link
                href="/profile"
                className="flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-white/45 transition-colors hover:bg-white/5 hover:text-white"
              >
                <UserRound size={13} /> Profile
              </Link>
            )}
            <ThemeToggle />
          </div>
        </header>

        <div className="grid items-start gap-10 py-12 lg:grid-cols-[1fr_minmax(0,470px)] lg:gap-14">
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
              * can afford 5xl. At `lg` the upload panel takes 470px and the
              * pitch column is left with about 450 — narrower than that
              * sentence at any size worth setting a headline in, so it wraps.
              * The default break stranded "defend." alone on a third line;
              * `text-balance` splits it evenly instead, which is the difference
              * between a two-line headline and a typo.
              */}
            <h1 className="text-4xl font-black leading-[1.04] tracking-tight md:text-5xl lg:text-[2.5rem]">
              <span className="block text-white/40">Upload a spreadsheet.</span>
              <span className="block text-balance">
                Get an analysis you can{' '}
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
            <p className="mt-5 max-w-[46ch] text-[15px] leading-relaxed text-white/55">
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
            <ol className="mt-8 max-w-md divide-y divide-white/6 border-y border-white/6">
              {[
                ['Cleaned', 'Types coerced, blanks counted, personal fields redacted — in your browser.'],
                ['Analysed', 'A dashboard of charts the data chose, under an executive summary.'],
                ['Presented', 'The findings as a slide deck, each one traceable to its query.'],
              ].map(([step, body], index) => (
                <li key={step} className="flex gap-4 py-3.5">
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
            <dl className="mt-7 max-w-md space-y-2 text-[12px]">
              {[
                ['Files', 'CSV, Excel'],
                ['Live sources', CONNECTORS.map((c) => c.label).join(' · ')],
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
                  <span className="ml-auto flex items-center gap-1.5 rounded-full border border-emerald-500/25 bg-emerald-500/8 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.15em] text-emerald-400">
                    <ShieldCheck size={10} /> Verified
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

                <button
                  onClick={runAnalysis}
                  className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-accent-500 px-4 py-3 text-sm font-black uppercase tracking-[0.15em] text-on-accent transition-transform hover:bg-accent-400 active:scale-[0.99]"
                >
                  Analyse dataset <ArrowRight size={16} />
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
                  accept=".csv,.tsv,.txt,.xlsx,.xlsm,.xlsb,.xls,text/csv"
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
                <div className="card p-5">
                  <label className="flex flex-col gap-2">
                    <span className="label">Data source</span>
                    <select
                      value={source}
                      onChange={(e) => setSource(e.target.value)}
                      className="rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm font-bold text-white/85 outline-none focus:border-accent-500/50"
                    >
                      <option value="file" className="bg-surface">
                        CSV or Excel file
                      </option>
                      {CONNECTORS.map((c) => (
                        <option key={c.id} value={c.id} className="bg-surface">
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </label>

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
                  className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-6 py-14 text-center transition-colors ${
                    dragging
                      ? 'border-accent-500 bg-accent-500/8'
                      : 'border-white/12 bg-white/[0.02] hover:border-accent-500/40 hover:bg-white/[0.035]'
                  }`}
                >
                  <UploadCloud size={30} className={dragging ? 'text-accent-400' : 'text-white/30'} />
                  <div className="text-sm font-bold text-white/80">Drop a CSV or Excel file here</div>
                  <div className="text-xs text-white/35">
                    several related files or sheets are welcome — nothing leaves your browser
                  </div>
                  <input
                    ref={inputRef}
                    type="file"
                    multiple
                    accept=".csv,.tsv,.txt,.xlsx,.xlsm,.xlsb,.xls,text/csv"
                    className="hidden"
                    onChange={(e) => {
                      const files = Array.from(e.target.files || []);
                      if (files.length) handleFiles(files);
                      e.target.value = '';
                    }}
                  />
                </div>

                <div className="card p-5">
                  <div className="label mb-3">Or try a sample</div>
                  <div className="flex flex-col gap-2">
                    {SAMPLES.map((s) => (
                      <button
                        key={s.key}
                        onClick={() => loadSample(s)}
                        className="group flex items-center justify-between gap-3 rounded-xl border border-white/7 bg-white/[0.02] px-4 py-3 text-left transition-colors hover:border-accent-500/30 hover:bg-white/[0.05]"
                      >
                        <div className="min-w-0">
                          <div className="text-sm font-bold text-white/85 group-hover:text-accent-300">{s.title}</div>
                          <div className="mt-0.5 truncate text-[11px] text-white/35">{s.description}</div>
                        </div>
                        <ArrowRight size={15} className="shrink-0 text-white/20 group-hover:text-accent-400" />
                      </button>
                    ))}
                  </div>
                </div>
              </>
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

        {/* What the product does, as three cards rather than a list. */}
        <section className="grid gap-4 border-t border-white/6 py-10 md:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="card p-5">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/8 bg-white/[0.04] text-accent-400">
                <f.icon size={16} />
              </div>
              <div className="mt-4 text-sm font-bold text-white/85">{f.title}</div>
              <p className="mt-1.5 text-[12px] leading-relaxed text-white/40">{f.body}</p>
            </div>
          ))}
        </section>

        <footer className="border-t border-white/6 pt-6 text-[11px] text-white/25">
          Files are parsed, cleaned and queried entirely in your browser. Only anonymous summary statistics
          are sent to a language model, and only to phrase them — never your rows.
        </footer>
      </div>
    </div>
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
