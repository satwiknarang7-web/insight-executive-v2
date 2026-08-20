'use client';

import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Zap,
  UploadCloud,
  FileSpreadsheet,
  ShieldCheck,
  Gauge,
  Sparkles,
  ArrowRight,
  AlertTriangle,
  Table2,
} from 'lucide-react';
import { useActions, useDataset } from '../lib/store/DatasetProvider';
import ProgressPanel from '../components/panels/ProgressPanel';
import { SAMPLES } from '../lib/samples';

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
  const { ingestFile, ingestText, analyze, setError } = useActions();
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef(null);

  const busy = status === 'ingesting' || status === 'analyzing';

  const handleFile = useCallback(
    async (file) => {
      try {
        await ingestFile(file);
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
      const file = e.dataTransfer.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile]
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
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-500 text-black">
            <Zap size={20} fill="currentColor" />
          </div>
          <div className="flex flex-col leading-none">
            <span className="text-lg font-black tracking-tight">Insight</span>
            <span className="text-[8px] font-black uppercase tracking-[0.35em] text-accent-500">Analytics</span>
          </div>
        </header>

        <div className="grid flex-1 items-center gap-12 py-12 lg:grid-cols-2 lg:gap-16">
          {/* Left: pitch */}
          <div className="flex flex-col">
            <h1 className="text-4xl font-black leading-[1.05] tracking-tight md:text-6xl">
              Upload a spreadsheet.
              <br />
              <span className="text-accent-400">Get an analysis you can defend.</span>
            </h1>
            <p className="mt-6 max-w-lg text-base leading-relaxed text-white/50 md:text-lg">
              Insight profiles your CSV, builds the charts an analyst would build, and computes every
              statistic itself — so each claim on screen traces back to a query you can read.
            </p>

            <div className="mt-10 flex flex-col gap-5">
              {FEATURES.map((f) => (
                <div key={f.title} className="flex gap-4">
                  <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-500/10 text-accent-400">
                    <f.icon size={16} />
                  </div>
                  <div>
                    <div className="text-sm font-bold text-white/85">{f.title}</div>
                    <p className="mt-1 text-[13px] leading-relaxed text-white/40">{f.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Right: the actual workflow */}
          <div className="flex flex-col gap-4">
            {busy && <ProgressPanel />}

            {!busy && dataset && (
              <div className="card p-6">
                <div className="flex items-start gap-3">
                  <FileSpreadsheet className="mt-0.5 shrink-0 text-accent-400" size={20} />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-bold text-white/90">{dataset.fileName}</div>
                    <div className="mt-0.5 text-xs text-white/40">
                      {dataset.rowCount.toLocaleString()} rows · {dataset.columns.length} columns ·{' '}
                      {dataset.metrics.outliersCount.toLocaleString()} outliers flagged
                    </div>
                  </div>
                </div>

                <div className="mt-5 grid grid-cols-3 gap-2 text-center">
                  <Stat label="Redacted" value={dataset.metrics.redactedPII} tone="accent" />
                  <Stat label="Blanks" value={dataset.metrics.nullsFound} tone="amber" />
                  <Stat label="Coerced" value={dataset.metrics.typesCoerced} tone="plain" />
                </div>

                <button
                  onClick={runAnalysis}
                  className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-accent-500 px-4 py-3 text-sm font-black uppercase tracking-[0.15em] text-black transition-transform hover:bg-accent-400 active:scale-[0.99]"
                >
                  Analyse dataset <ArrowRight size={16} />
                </button>
                <button
                  onClick={() => router.push('/explore')}
                  className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 px-4 py-2.5 text-xs font-bold uppercase tracking-[0.15em] text-white/50 transition-colors hover:bg-white/5 hover:text-white"
                >
                  <Table2 size={14} /> Browse the rows first
                </button>
              </div>
            )}

            {!busy && !dataset && (
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
                  <div className="text-sm font-bold text-white/80">Drop a CSV here</div>
                  <div className="text-xs text-white/35">or click to choose a file — it never leaves your browser</div>
                  <input
                    ref={inputRef}
                    type="file"
                    accept=".csv,text/csv"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleFile(file);
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

        <footer className="border-t border-white/6 pt-6 text-[11px] text-white/25">
          Files are parsed, cleaned and queried entirely in your browser. Only anonymous summary statistics
          are sent to a language model, and only to phrase them — never your rows.
        </footer>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }) {
  const color = tone === 'accent' ? 'text-accent-400' : tone === 'amber' ? 'text-amber-400' : 'text-white/70';
  return (
    <div className="rounded-lg border border-white/6 bg-white/[0.02] px-2 py-2.5">
      <div className={`text-base font-black ${color}`}>{(value || 0).toLocaleString()}</div>
      <div className="mt-0.5 text-[8px] font-black uppercase tracking-[0.2em] text-white/25">{label}</div>
    </div>
  );
}
