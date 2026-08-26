'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Activity,
  HelpCircle,
  ShieldCheck,
  Code2,
  ArrowLeft,
  StickyNote,
} from 'lucide-react';
import { useActions, useAnalysis } from '../../../../lib/store/DatasetProvider';
import PageFrame from '../../../../components/shell/PageFrame';
import LazyChart from '../../../../components/charts/LazyChart';
import ChartBoundary from '../../../../components/charts/ChartBoundary';
import { cleanFloatingPoints } from '../../../../lib/dataCleaner';
import ChartStudio from '../../../../components/panels/ChartStudio';
import { formatSql } from '../../../../lib/sqlFormat';

export default function InsightPage() {
  const { id } = useParams();
  const router = useRouter();
  const { analysis } = useAnalysis();
  const { editSlide, deleteSlide } = useActions();
  // The studio's unsaved draft, so the chart shows a choice while it is being
  // made. Save is what commits it to the dashboard, the deck and the report.
  const [preview, setPreview] = useState(null);
  const onPreview = useCallback((next) => setPreview(next), []);

  const { slide, index, prev, next } = useMemo(() => {
    const board = analysis?.storyboard || [];
    const i = board.findIndex((s) => String(s.id) === String(id));
    return {
      slide: i >= 0 ? board[i] : null,
      index: i,
      prev: i > 0 ? board[i - 1] : null,
      next: i >= 0 && i < board.length - 1 ? board[i + 1] : null,
    };
  }, [analysis, id]);

  if (!analysis) {
    return (
      <PageFrame title="Finding">
        <EmptyState message="No analysis in this session yet." action="Go to the dashboard" onAction={() => router.push('/dashboard')} />
      </PageFrame>
    );
  }

  if (!slide) {
    return (
      <PageFrame title="Finding not found">
        <EmptyState message={`No finding with the id "${id}".`} action="Back to dashboard" onAction={() => router.push('/dashboard')} />
      </PageFrame>
    );
  }

  const chart = slide.chart || {};
  const facts = slide.findings?.verifiedFacts || [];
  // The draft wins while the studio is open, but only the draft for this slide:
  // a preview left over from the previous finding is ignored outright.
  const draft = preview?.id === slide.id ? preview : null;
  const shownType = draft?.chartType || chart.chart_type;
  const shownColors = draft ? draft.colors : chart.colors;
  const shownLabels = draft ? draft.labels : chart.labels;
  const shownColorBy = (draft ? draft.colorBy : chart.colorBy) || 'series';
  // Blank in the draft means "no override", which must fall through to the
  // column-derived name rather than render an empty title.
  const shownXLabel = (draft ? draft.xAxisLabel : chart.xAxisLabel) || null;
  const shownYLabel = (draft ? draft.yAxisLabel : chart.yAxisLabel) || null;

  return (
    <PageFrame
      title={slide.pageTitle}
      subtitle={`Finding ${index + 1} of ${analysis.storyboard.length}`}
      action={
        <div className="flex items-center gap-2">
          <Link
            href="/dashboard"
            className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-white/45 transition-colors hover:bg-white/5 hover:text-white"
          >
            <ArrowLeft size={13} /> All findings
          </Link>
          <NavButton slide={prev} dir="prev" />
          <NavButton slide={next} dir="next" />
        </div>
      }
    >
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* Chart */}
        <div className="card flex flex-col p-5">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-accent-500/10 px-3 py-1.5 text-[11px] font-bold text-accent-300">
              {chart.resultData?.length || 0} data points
            </span>
            {chart.healed && (
              <span
                className="rounded-full border border-amber-500/25 bg-amber-500/8 px-3 py-1.5 text-[11px] font-bold text-amber-300"
                title="The planned query was unusable, so a simpler one was substituted."
              >
                Fallback query
              </span>
            )}
            {slide.custom && (
              <span className="rounded-full border border-accent-500/25 bg-accent-500/8 px-3 py-1.5 text-[11px] font-bold text-accent-300">
                Built by you
              </span>
            )}
            {slide.edits?.length > 0 && (
              <span className="rounded-full border border-white/10 px-3 py-1.5 text-[11px] font-bold text-white/40">
                Edited
              </span>
            )}
          </div>

          {/* Sized to the chart, not to a round number. 520px was chosen when the
              axis gutter was double-counted and ~110px of it went unused; the
              chart now fills what it is given, so this is smaller and the page
              no longer opens with a band of empty space under the plot. */}
          <div className="h-[360px] w-full md:h-[440px]">
            <ChartBoundary resetKey={`${slide.id}-${shownType}-${shownColorBy}-${(shownColors || []).join()}`}>
              <LazyChart
                data={chart.resultData}
                type={shownType}
                xKey={chart.xAxisKey}
                yKey={chart.yAxisKey}
                secondaryYKey={chart.secondaryYAxisKey}
                colors={shownColors}
                labels={shownLabels}
                colorBy={shownColorBy}
                xLabel={shownXLabel}
                yLabel={shownYLabel}
                eager
              />
            </ChartBoundary>
          </div>
        </div>

        {/* Narrative */}
        <div className="flex flex-col gap-4">
          <ChartStudio
            slide={slide}
            onPreview={onPreview}
            onSave={(patch) => editSlide(slide.id, patch)}
            onDelete={() => {
              deleteSlide(slide.id);
              router.push('/dashboard');
            }}
          />

          {slide.analystNotes && (
            <div className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.05] p-5">
              <div className="mb-2 flex items-center gap-2">
                <StickyNote size={13} className="text-amber-400" />
                <span className="label !text-amber-400/80">Analyst notes</span>
              </div>
              <p className="whitespace-pre-wrap text-[14px] leading-[1.7] text-white/80">{slide.analystNotes}</p>
            </div>
          )}

          <Block icon={Sparkles} tone="accent" label="Key finding" text={slide.insight_anchor} />
          <Block icon={Activity} tone="plain" label="What it means" text={slide.insight_implication} />
          <Block icon={HelpCircle} tone="plain" label="What to ask next" text={slide.insight_question} />

          {facts.length > 0 && (
            <div className="card p-5">
              <div className="mb-3 flex items-center gap-2">
                <ShieldCheck size={13} className="text-emerald-400" />
                <span className="label !text-emerald-400/70">Verified metrics</span>
              </div>
              <ul className="flex flex-col gap-2">
                {facts.map((f, i) => (
                  <li key={i} className="rounded-lg bg-white/[0.03] px-3 py-2 font-mono text-[11px] text-white/60">
                    {f}
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-[11px] leading-relaxed text-white/30">
                Computed directly from this chart&apos;s query results, before any language model saw them.
              </p>
            </div>
          )}

          {chart.sql && (
            <details className="card group p-5">
              <summary className="flex cursor-pointer list-none items-center gap-2">
                <Code2 size={13} className="text-white/40" />
                <span className="label">Query</span>
                <ChevronRight size={14} className="ml-auto text-white/25 transition-transform group-open:rotate-90" />
              </summary>
              <pre className="mt-3 whitespace-pre-wrap break-words rounded-lg code-surface border border-white/10 p-3 font-mono text-[11px] leading-relaxed">
                {formatSql(chart.sql)}
              </pre>
            </details>
          )}
        </div>
      </div>

      {/* Prev / next footer */}
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <FooterLink slide={prev} dir="prev" />
        <FooterLink slide={next} dir="next" />
      </div>
    </PageFrame>
  );
}

function Block({ icon: Icon, tone, label, text }) {
  if (!text) return null;
  const accent = tone === 'accent';
  return (
    <div
      className={`rounded-2xl border p-5 ${
        accent ? 'border-accent-500/20 bg-accent-500/[0.06]' : 'border-white/8 bg-white/[0.02]'
      }`}
    >
      <div className="mb-2 flex items-center gap-2">
        <Icon size={13} className={accent ? 'text-accent-400' : 'text-white/40'} />
        <span className={`label ${accent ? '!text-accent-400/80' : ''}`}>{label}</span>
      </div>
      <p className="text-[14px] leading-[1.7] text-white/80">{cleanFloatingPoints(text)}</p>
    </div>
  );
}

function NavButton({ slide, dir }) {
  const Icon = dir === 'prev' ? ChevronLeft : ChevronRight;
  if (!slide) {
    return (
      <span className="cursor-not-allowed rounded-lg border border-white/6 p-2 text-white/12">
        <Icon size={15} />
      </span>
    );
  }
  return (
    <Link
      href={`/insight/${slide.id}`}
      aria-label={dir === 'prev' ? 'Previous finding' : 'Next finding'}
      className="rounded-lg border border-white/10 p-2 text-white/50 transition-colors hover:bg-white/5 hover:text-white"
    >
      <Icon size={15} />
    </Link>
  );
}

function FooterLink({ slide, dir }) {
  if (!slide) return <div className="hidden sm:block" />;
  const isPrev = dir === 'prev';
  return (
    <Link
      href={`/insight/${slide.id}`}
      className={`group card flex items-center gap-3 p-4 transition-colors hover:border-accent-500/30 hover:bg-white/[0.04] ${
        isPrev ? '' : 'sm:flex-row-reverse sm:text-right'
      }`}
    >
      {isPrev ? (
        <ChevronLeft size={16} className="shrink-0 text-white/25 group-hover:text-accent-400" />
      ) : (
        <ChevronRight size={16} className="shrink-0 text-white/25 group-hover:text-accent-400" />
      )}
      <div className="min-w-0">
        <div className="label">{isPrev ? 'Previous' : 'Next'}</div>
        <div className="mt-0.5 truncate text-sm font-bold text-white/80 group-hover:text-accent-300">
          {slide.pageTitle}
        </div>
      </div>
    </Link>
  );
}

function EmptyState({ message, action, onAction }) {
  return (
    <div className="card flex max-w-lg flex-col items-start gap-4 p-8">
      <p className="text-sm text-white/50">{message}</p>
      <button
        onClick={onAction}
        className="rounded-xl bg-accent-500 px-4 py-2.5 text-xs font-black uppercase tracking-[0.2em] text-on-accent hover:bg-accent-400"
      >
        {action}
      </button>
    </div>
  );
}
