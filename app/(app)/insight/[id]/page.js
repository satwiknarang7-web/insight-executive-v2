'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  SlidersHorizontal,
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
  const { editSlide, deleteSlide, rebuildSlide } = useActions();
  // The studio's unsaved draft, so the chart shows a choice while it is being
  // made. Save is what commits it to the dashboard, the deck and the report.
  const [preview, setPreview] = useState(null);
  const onPreview = useCallback((next) => setPreview(next), []);
  // The editing drawer, and which of the panes under the chart is open. The
  // key finding opens by default because it is the one sentence the page
  // exists to deliver; everything else is a click away.
  const [editing, setEditing] = useState(false);
  const [openPane, setOpenPane] = useState('finding');

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

  /**
   * Everything the page says about the chart, as one strip of panes.
   *
   * A pane that has nothing to show is not offered, so the strip never has a
   * heading that opens onto an empty box.
   */
  const panes = [
    slide.insight_anchor && {
      key: 'finding',
      label: 'Key finding',
      icon: Sparkles,
      render: () => <Prose text={slide.insight_anchor} accent />,
    },
    slide.insight_implication && {
      key: 'means',
      label: 'What it means',
      icon: Activity,
      render: () => <Prose text={slide.insight_implication} />,
    },
    slide.insight_question && {
      key: 'next',
      label: 'What to ask next',
      icon: HelpCircle,
      render: () => <Prose text={slide.insight_question} />,
    },
    slide.analystNotes && {
      key: 'notes',
      label: 'Your notes',
      icon: StickyNote,
      render: () => (
        <p className="whitespace-pre-wrap text-[13px] leading-[1.7] text-white/80">{slide.analystNotes}</p>
      ),
    },
    facts.length > 0 && {
      key: 'metrics',
      label: `Metrics (${facts.length})`,
      icon: ShieldCheck,
      render: () => (
        <>
          <ul className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
            {facts.map((f, i) => (
              <li key={i} className="rounded-lg bg-white/[0.03] px-3 py-1.5 font-mono text-[11px] text-white/60">
                {f}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] leading-relaxed text-white/30">
            Computed directly from this chart&apos;s query results, before any language model saw them.
          </p>
        </>
      ),
    },
    chart.sql && {
      key: 'query',
      label: 'Query',
      icon: Code2,
      render: () => (
        <pre className="code-surface whitespace-pre-wrap break-words rounded-lg border border-white/10 p-3 font-mono text-[11px] leading-relaxed">
          {formatSql(chart.sql)}
        </pre>
      ),
    },
  ].filter(Boolean);

  return (
    /*
      One screen, and nothing that scrolls unless it is asked to.

      The previous version put the chart, three narrative columns, a metrics
      list, a query block and the whole editing panel on the page at once. That
      is three scrollbars — the window, the sticky rail, and the label list
      inside it — and a reader who has to hunt for the sentence they wanted.

      So the page owns the viewport instead: a compact header, the chart taking
      whatever height is left, and everything written about the chart folded
      into one strip of tabs beneath it. The editing panel is a drawer that is
      shut until it is wanted, because it is a tool and not part of the finding.
      Below the large breakpoint this relaxes back into ordinary page flow —
      a fixed-height layout on a phone is a worse answer than scrolling.
    */
    <div className="flex h-auto flex-col px-4 py-4 md:px-6 lg:h-[100dvh] lg:overflow-hidden">
      {/* Header: title, position, navigation, and the drawer switch. */}
      <header className="mb-3 flex shrink-0 flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1 basis-full lg:basis-auto">
          <h1 className="truncate text-xl font-black tracking-tight md:text-2xl">{slide.pageTitle}</h1>
          <p className="mt-0.5 text-[12px] text-white/40">
            Finding {index + 1} of {analysis.storyboard.length}
            {chart.resultData?.length ? ` · ${chart.resultData.length} data points` : ''}
            {chart.healed ? ' · fallback query' : ''}
            {slide.custom ? ' · built by you' : ''}
            {slide.edits?.length > 0 ? ' · edited' : ''}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Link
            href="/dashboard"
            className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-white/45 transition-colors hover:bg-white/5 hover:text-white"
          >
            <ArrowLeft size={13} /> All findings
          </Link>
          <NavButton slide={prev} dir="prev" />
          <NavButton slide={next} dir="next" />
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            aria-expanded={editing}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[10px] font-black uppercase tracking-[0.2em] transition-colors ${
              editing
                ? 'border-accent-500/40 bg-accent-500/10 text-accent-300'
                : 'border-white/10 text-white/45 hover:bg-white/5 hover:text-white'
            }`}
          >
            <SlidersHorizontal size={13} /> Edit
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
        {/* The chart, and one strip of tabs for everything said about it. */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
          <div className="card flex flex-col p-4 lg:min-h-[320px] lg:flex-1">
            {/* Two different jobs. On a viewport-height page `min-h-0` is what
                lets the chart give height back — without it a flex child
                refuses to shrink below its content, so opening a taller pane
                below shrank the card and left the chart drawing over the top of
                it. Below that breakpoint the page is ordinary flow, nothing
                hands the card a height, and a flex child of nothing is nothing:
                the chart measured zero and drew a blank box. So it takes a real
                height there and only flexes where flexing means something. */}
            <div className="flex h-[340px] flex-col md:h-[420px] lg:h-auto lg:min-h-0 lg:flex-1">
              <ChartBoundary resetKey={`${slide.id}-${shownType}-${shownColorBy}-${(shownColors || []).join()}`}>
              <LazyChart
                data={chart.resultData}
                type={shownType}
                xKey={chart.xAxisKey}
                yKey={chart.yAxisKey}
                secondaryYKey={chart.secondaryYAxisKey}
                seriesKey={chart?.seriesKey}
                seriesSort={chart?.seriesSort}
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

          <Panes
            panes={panes}
            open={openPane}
            onToggle={(key) => setOpenPane((cur) => (cur === key ? null : key))}
          />
        </div>

        {/* The editing drawer. Shut by default; it is a tool, not a finding. */}
        {editing && (
          <div className="flex min-h-0 shrink-0 flex-col lg:w-[380px]">
            <div className="min-h-0 flex-1 overflow-y-auto pr-1">
              <ChartStudio
                slide={slide}
                onPreview={onPreview}
                onSave={(patch) => editSlide(slide.id, patch)}
                onRebuild={(spec) => rebuildSlide(slide.id, spec)}
                onDelete={() => {
                  deleteSlide(slide.id);
                  router.push('/dashboard');
                }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The strip under the chart: one row of headings, one of them open.
 *
 * Everything here used to be on screen at once, stacked, which is what made the
 * page three screens tall. Only one of these is ever being read, so only one is
 * ever shown — and clicking the open one closes it, which gives the chart the
 * whole height back when the reader wants to look at it rather than read about
 * it.
 */
function Panes({ panes, open, onToggle }) {
  const shown = panes.find((p) => p.key === open);

  return (
    <div className="flex shrink-0 flex-col overflow-hidden rounded-2xl border border-white/8 bg-white/[0.02]">
      <div className="flex flex-wrap items-center gap-1 p-1.5">
        {panes.map((pane) => {
          const isOpen = pane.key === open;
          return (
            <button
              key={pane.key}
              type="button"
              onClick={() => onToggle(pane.key)}
              aria-expanded={isOpen}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] transition-colors ${
                isOpen ? 'bg-white/[0.07] text-white' : 'text-white/40 hover:bg-white/[0.04] hover:text-white/70'
              }`}
            >
              <pane.icon size={12} className={isOpen ? 'text-accent-400' : ''} />
              {pane.label}
            </button>
          );
        })}
        {shown && (
          <button
            type="button"
            onClick={() => onToggle(shown.key)}
            aria-label="Collapse"
            className="ml-auto rounded-lg p-2 text-white/30 transition-colors hover:bg-white/5 hover:text-white/70"
          >
            <ChevronDown size={14} />
          </button>
        )}
      </div>

      {shown && (
        <div className="max-h-[34vh] overflow-y-auto border-t border-white/8 px-4 py-3 lg:h-[22vh] lg:max-h-none">
          {shown.render()}
        </div>
      )}
    </div>
  );
}

/** One pane's text. The heading is the tab above it, so this is only prose. */
function Prose({ text, accent = false }) {
  if (!text) return null;
  return (
    <p className={`text-[13px] leading-[1.75] ${accent ? 'text-white/90' : 'text-white/75'}`}>
      {cleanFloatingPoints(text)}
    </p>
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
