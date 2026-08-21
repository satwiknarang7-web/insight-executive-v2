'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import {
  Target,
  AlertTriangle,
  TrendingUp,
  ChevronRight,
  Sparkles,
  BarChart3,
  Loader2,
  Presentation,
  Plus,
  Trash2,
  StickyNote,
} from 'lucide-react';
import { useActions, useAnalysis, useDataset } from '../../../lib/store/DatasetProvider';
import ProgressPanel from '../../../components/panels/ProgressPanel';
import PageFrame from '../../../components/shell/PageFrame';
import LazyChart from '../../../components/charts/LazyChart';
import ChartBoundary from '../../../components/charts/ChartBoundary';
import { cleanFloatingPoints } from '../../../lib/dataCleaner';
import NewChartDialog from '../../../components/panels/NewChartDialog';

export default function DashboardPage() {
  const { dataset, status } = useDataset();
  const { analysis, narrating } = useAnalysis();
  const { analyze, addSlide, deleteSlide } = useActions();
  const router = useRouter();
  const [building, setBuilding] = useState(false);

  const run = useCallback(() => analyze().catch(() => {}), [analyze]);

  if (status === 'analyzing') {
    return (
      <PageFrame title="Dashboard" subtitle="Building the analysis">
        <div className="max-w-xl">
          <ProgressPanel title="Analysing" />
        </div>
      </PageFrame>
    );
  }

  if (!analysis) {
    return (
      <PageFrame title="Dashboard" subtitle={dataset?.fileName}>
        <div className="card flex max-w-xl flex-col items-start gap-4 p-8">
          <BarChart3 size={28} className="text-accent-400" />
          <div>
            <h2 className="text-lg font-black">Nothing analysed yet</h2>
            <p className="mt-2 text-sm leading-relaxed text-white/45">
              {dataset?.rowCount.toLocaleString()} rows are loaded and cleaned. Run the analysis to plan the
              charts, execute the queries and compute the findings — all in your browser.
            </p>
          </div>
          <button
            onClick={run}
            className="rounded-xl bg-accent-500 px-5 py-2.5 text-xs font-black uppercase tracking-[0.2em] text-on-accent transition-colors hover:bg-accent-400"
          >
            Analyse dataset
          </button>
        </div>
      </PageFrame>
    );
  }

  const { slideZero, storyboard, kpis } = analysis;

  return (
    <PageFrame
      title="Dashboard"
      subtitle={`${storyboard.length} findings from ${dataset.rowCount.toLocaleString()} rows`}
      action={
        <div className="flex items-center gap-2">
          {narrating && (
            <span className="flex items-center gap-1.5 rounded-full border border-white/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-white/35">
              <Loader2 size={11} className="animate-spin" /> Writing narrative
            </span>
          )}
          <button
            onClick={() => setBuilding(true)}
            className="flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-white/45 transition-colors hover:bg-white/5 hover:text-white"
          >
            <Plus size={13} /> New chart
          </button>
          <button
            onClick={() => router.push('/present')}
            className="flex items-center gap-2 rounded-lg border border-accent-500/25 bg-accent-500/8 px-3 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-accent-300 transition-colors hover:bg-accent-500/15"
          >
            <Presentation size={13} /> Present
          </button>
          <button
            onClick={run}
            className="rounded-lg border border-white/10 px-3 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-white/45 transition-colors hover:bg-white/5 hover:text-white"
          >
            Re-run
          </button>
        </div>
      }
    >
      {/* KPI strip */}
      {kpis?.length > 0 && (
        <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {kpis.map((k) => (
            <div key={k.label} className="card p-4">
              <div className="label truncate" title={k.label}>
                {k.label}
              </div>
              <div className="mt-2 text-2xl font-black tracking-tight text-white">{k.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Executive summary */}
      <section className="mb-8">
        <div className="mb-3 flex items-center gap-3">
          <Sparkles size={14} className="text-accent-400" />
          <h2 className="text-xs font-black uppercase tracking-[0.28em] text-white/45">{slideZero.title}</h2>
          <div className="h-px flex-1 bg-gradient-to-r from-white/10 to-transparent" />
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <div className="card p-6 lg:col-span-2">
            <ul className="flex flex-col gap-4">
              {slideZero.macroInsights.map((line, i) => (
                <li key={i} className="flex gap-3">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-500" />
                  <p className="text-[15px] leading-relaxed text-white/75">{cleanFloatingPoints(line)}</p>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex flex-col gap-3">
            <Scorecard icon={Target} tone="accent" label="Focus" text={slideZero.strategicScorecard.focus} />
            <Scorecard icon={AlertTriangle} tone="rose" label="Risk" text={slideZero.strategicScorecard.risk} />
            <Scorecard icon={TrendingUp} tone="emerald" label="Opportunity" text={slideZero.strategicScorecard.opportunity} />
          </div>
        </div>
      </section>

      {/* Chart grid */}
      <section>
        <div className="mb-3 flex items-center gap-3">
          <BarChart3 size={14} className="text-accent-400" />
          <h2 className="text-xs font-black uppercase tracking-[0.28em] text-white/45">Findings</h2>
          <div className="h-px flex-1 bg-gradient-to-r from-white/10 to-transparent" />
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          {storyboard.map((slide, i) => (
            <Link
              key={slide.id || i}
              href={`/insight/${slide.id || `slide_${i + 1}`}`}
              className="group card relative flex flex-col overflow-hidden p-5 transition-colors hover:border-accent-500/30 hover:bg-white/[0.035]"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="label flex items-center gap-2">
                    <span>
                      {String(slide.chart?.chart_type || 'chart')} · {i + 1} of {storyboard.length}
                    </span>
                    {slide.custom && <span className="text-accent-400/70">· yours</span>}
                    {slide.analystNotes && <StickyNote size={10} className="text-amber-400/70" />}
                  </div>
                  <h3 className="mt-1.5 text-base font-black leading-tight text-white group-hover:text-accent-300">
                    {slide.pageTitle}
                  </h3>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    aria-label={`Delete ${slide.pageTitle}`}
                    title="Delete this finding"
                    onClick={(e) => {
                      // The whole card is a link; deleting must not navigate.
                      e.preventDefault();
                      e.stopPropagation();
                      deleteSlide(slide.id);
                    }}
                    className="rounded-lg p-1.5 text-white/15 transition-colors hover:bg-rose-500/10 hover:text-rose-400"
                  >
                    <Trash2 size={14} />
                  </button>
                  <ChevronRight size={16} className="text-white/20 group-hover:text-accent-400" />
                </div>
              </div>

              <div className="mt-4 h-56">
                <ChartBoundary resetKey={`${slide.id}-${slide.chart?.chart_type}`}>
                  <LazyChart
                    data={slide.chart?.resultData}
                    type={slide.chart?.chart_type}
                    xKey={slide.chart?.xAxisKey}
                    yKey={slide.chart?.yAxisKey}
                    secondaryYKey={slide.chart?.secondaryYAxisKey}
                    colors={slide.chart?.colors}
                    eager={i < 2}
                  />
                </ChartBoundary>
              </div>

              {slide.insight_anchor && (
                <p className="mt-4 line-clamp-2 text-[13px] leading-relaxed text-white/45">
                  {cleanFloatingPoints(slide.insight_anchor)}
                </p>
              )}
            </Link>
          ))}
        </div>
      </section>

      {building && (
        <NewChartDialog
          profile={dataset?.profile}
          onCreate={(spec) => addSlide(spec)}
          onClose={() => setBuilding(false)}
        />
      )}
    </PageFrame>
  );
}

function Scorecard({ icon: Icon, tone, label, text }) {
  const tones = {
    accent: 'border-accent-500/20 bg-accent-500/6 text-accent-400',
    rose: 'border-rose-500/20 bg-rose-500/6 text-rose-400',
    emerald: 'border-emerald-500/20 bg-emerald-500/6 text-emerald-400',
  };
  return (
    <div className={`rounded-2xl border p-4 ${tones[tone]}`}>
      <div className="flex items-center gap-2">
        <Icon size={14} />
        <span className="text-[9px] font-black uppercase tracking-[0.25em]">{label}</span>
      </div>
      <p className="mt-2 text-[13px] font-medium leading-relaxed text-white/80">{cleanFloatingPoints(text) || '—'}</p>
    </div>
  );
}
