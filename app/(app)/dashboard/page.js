'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';
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
  Bookmark,
  StickyNote,
  GitBranch,
  Pencil,
  Check,
  Info,
  HelpCircle,
  ChevronDown,
  SlidersHorizontal,
  LayoutGrid,
  Wand2,
} from 'lucide-react';
import { useActions, useAnalysis, useDataset, useMeasures } from '../../../lib/store/DatasetProvider';
import ProgressPanel from '../../../components/panels/ProgressPanel';
import { exclusionNotice } from '../../../lib/voidRows';
import { findingsOnly } from '../../../lib/storyboard';
import PageFrame from '../../../components/shell/PageFrame';
import FilterBar from '../../../components/panels/FilterBar';
import { applyClick, clearColumn, clickTarget, selectedValues } from '../../../lib/filters';
import Collapse from '../../../components/shell/Collapse';
import { usePlan } from '../../../lib/store/PlanProvider';
import LazyChart from '../../../components/charts/LazyChart';
import ChartBoundary from '../../../components/charts/ChartBoundary';
import EditableText from '../../../components/panels/EditableText';
import { cleanFloatingPoints } from '../../../lib/dataCleaner';
import { KPI_METRICS, metricNeedsColumn } from '../../../lib/kpiMetrics';
import NewChartDialog from '../../../components/panels/NewChartDialog';
import SaveAnalysisDialog from '../../../components/panels/SaveAnalysisDialog';
import DatasetNotices from '../../../components/panels/DatasetNotices';
import PreparationNotice from '../../../components/panels/PreparationNotice';
import NarrationNote from '../../../components/panels/NarrationNote';
import EvidenceBadge from '../../../components/panels/EvidenceBadge';
import { modelConcerns } from '../../../lib/dataModel';
import { chartTypeLabel } from '../../../lib/chartSpecs';
import { slideLayout, slideStyle } from '../../../lib/slideSize';
import CardResizer from '../../../components/panels/CardResizer';
import ResizeHandles from '../../../components/panels/ResizeHandles';
import { KPI_TILE } from '../../../lib/canvasLayout';

/** The least room a plot can be drawn in, whatever is above and below it. */
const MIN_PLOT_HEIGHT = 120;
import DashboardCanvas from '../../../components/panels/DashboardCanvas';

export default function DashboardPage() {
  const { dataset, status, preparation } = useDataset();
  const { analysis, narrating, filters, filtering } = useAnalysis();
  // Measures the user defined. Distinct from `measures` below, which is this
  // dataset's numeric columns — the profile has always called those measures.
  const customMeasures = useMeasures();
  const { analyze, startBlank, setVoidRowsIncluded, applyFilters, addSlide, deleteSlide, editSlide, editSummary, editKpi, deleteKpi, createKpi, computeKpi, analysisSnapshot } =
    useActions();

  /**
   * What a click on a chart is allowed to mean.
   *
   * The columns as they are now — a filter on a column a transform has since
   * removed is a filter the engine would refuse — and which of them are dates,
   * because a click on a bucketed month is a span of days rather than a value.
   */
  const filterContext = useMemo(
    () => ({ columns: dataset?.columns || [], temporal: dataset?.profile?.temporal || [] }),
    [dataset?.columns, dataset?.profile?.temporal]
  );
  const selectValue = useCallback(
    (target, value) => applyFilters(applyClick(filters || [], target, value)),
    [applyFilters, filters]
  );

  /**
   * Everything on the board, as one list.
   *
   * The cards and the findings are different things to render and the same
   * thing to place, so the canvas is handed one list and told how to size it.
   * A card carries `kpiIndex` because that is how it is edited — the KPI list
   * is an array and its entries have no ids of their own until one is composed
   * for them.
   */
  const tiles = useMemo(() => {
    const cards = (analysis?.kpis || []).map((kpi, i) => ({
      ...kpi,
      id: kpi.id || `kpi_${i + 1}`,
      kpiIndex: i,
      layout: kpi.layout || null,
    }));
    return [...cards, ...(analysis?.storyboard || [])];
  }, [analysis?.kpis, analysis?.storyboard]);

  /**
   * How many findings there are, and which number each one is.
   *
   * A slicer is a control, not a finding: it filters the board rather than
   * saying anything about the data. It was counted as one anyway, so a deck of
   * six charts and one filter announced "7 findings from 720 rows", the filter
   * card was headed "SLICER · 7 OF 7", and the numbering skipped whatever
   * position the slicer occupied. `/present` already numbered over the findings
   * alone, so the same chart read "3 of 9" on the board and "2 of 7" in the
   * deck — from one storyboard, counted two ways.
   */
  const findings = useMemo(() => findingsOnly(analysis?.storyboard || []), [analysis?.storyboard]);
  const findingIndex = useMemo(
    () => new Map(findings.map((slide, i) => [slide.id, i])),
    [findings]
  );

  /**
   * How big a tile wants to be before anybody has placed it.
   *
   * A finding answers in the pre-canvas language — a share of six columns and a
   * plot height. A card answers in a box, because a number and its name want a
   * corner rather than a share of a row: sized like a chart, a card somebody
   * added arrived as a 700x380 rectangle holding two lines of text.
   */
  const tileSize = useCallback(
    (tile) => (tile.kpiIndex === undefined ? slideLayout(tile.size) : KPI_TILE),
    []
  );

  const moveTile = useCallback(
    (id, box) => {
      const card = (analysis?.kpis || []).findIndex((kpi, i) => (kpi.id || `kpi_${i + 1}`) === id);
      if (card > -1) editKpi(card, { layout: box });
      else editSlide(id, { layout: box });
    },
    [analysis?.kpis, editKpi, editSlide]
  );
  const router = useRouter();
  const { can: planAllows } = usePlan();
  const [building, setBuilding] = useState(false);
  // Putting the void rows back is a full re-analysis, so the control has to say
  // it is working. Without it the button looks broken for the second or two the
  // engine takes, on the one notice a reader is most likely to press twice.
  const [rerunning, setRerunning] = useState(false);
  const [saving, setSaving] = useState(false);
  /**
   * The way out of the exclusion, attached to the sentence that announces it.
   *
   * A notice stating a decision with no way to reverse it is an apology rather
   * than a disclosure. The engine's default stands — a total that counts
   * cancellations is not the quantity its name says — but it is the reader's
   * table and their definition of revenue.
   */
  const excluded = analysis?.slideZero?.excluded || null;
  const voidAction = excluded
    ? {
        label: excluded.applied === false ? 'Leave them out' : 'Count them anyway',
        busy: rerunning,
        onClick: async () => {
          setRerunning(true);
          try {
            await setVoidRowsIncluded(excluded.applied !== false);
          } finally {
            setRerunning(false);
          }
        },
      }
    : null;
  const notices = [...(dataset?.notices || []), ...exclusionNotice(excluded, voidAction)];

  // One switch for the whole page. A pencil beside every field would put an
  // affordance next to every sentence on a dashboard whose job is to be read.
  const [editing, setEditing] = useState(false);
  /**
   * Which of the two the page is showing.
   *
   * The list, by default. The board is a fixed 16:9 rectangle, and a finding
   * given a third of one is a chart about 400 by 200 — which is the size at
   * which an axis stops having labels. That is the right shape for the thing
   * the deck projects and the wrong one for the page somebody reads their own
   * analysis on, so the page they read is a document again and the board is a
   * view you open when you want to arrange it.
   */
  const [boardView, setBoardView] = useState(false);
  // The two long sections fold away. A dashboard with nine findings is several
  // screens whatever else is done to it, and the summary and the grid are read
  // at different moments — collapsing the one you are not reading is the
  // difference between scrolling to find something and it being on screen.
  const [showFindings, setShowFindings] = useState(true);
  /**
   * The working notes: what the deck did not reach, and what was repaired
   * before anyone saw it.
   *
   * Closed. These are honest and they are ours — a reader opening a report
   * wants the findings, not four lines about a claim that was removed from a
   * slide they never saw. Kept on the page rather than deleted, because the
   * whole product rests on being able to see what was done; put behind one
   * line, because being able to see it is not the same as being shown it.
   */

  const run = useCallback(() => analyze().catch(() => {}), [analyze]);

  /**
   * The notes, each kind folded to one line per distinct thing said.
   *
   * The same repair applied to four slides produced four identical sentences,
   * which reads as a stutter rather than as four fixes. Folded to one line
   * with a count: same information, and it is legible.
   */

  const summary = analysis?.slideZero;
  // Only numeric columns can be summed or averaged. Count needs none of them,
  // which is why it stays available even when a dataset has no measures at all.
  const measures = dataset?.profile?.measures || [];

  // Bullets are edited as a list: rewriting one, dropping one and adding one are
  // all the same commit of a new array.



  // Relationship inference is a guess. Analysing on a wrong join produces
  // precise, confident, false numbers, so the guess is never applied silently.
  const joinNotice = dataset?.multiTable
    ? {
        tables: dataset.tables?.length || 0,
        joins: dataset.model?.relationships?.length || 0,
        concerns: modelConcerns({
          model: dataset.model,
          tables: dataset.tables,
          joins: dataset.view?.joins,
        }),
      }
    : null;

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
        <DatasetNotices notices={notices} />
        {joinNotice && <JoinNotice notice={joinNotice} />}
        <div className="card flex max-w-xl flex-col items-start gap-4 p-8">
          <BarChart3 size={28} className="text-accent-400" />
          <div>
            <h2 className="display text-[21px]">Nothing analysed yet</h2>
            <p className="mt-2 text-sm leading-relaxed text-white/45">
              {dataset?.rowCount.toLocaleString()} rows are loaded and cleaned.{' '}
              {planAllows('autoAnalysis')
                ? 'Run the analysis to plan the charts, execute the queries and compute the findings. The statistics are computed here; the AI reads your columns and their values to decide what is worth asking.'
                : 'Start an empty dashboard and add the charts you want, or upgrade to have the analyst build one for you.'}
            </p>
          </div>
          {planAllows('autoAnalysis') ? (
            <button
              onClick={run}
              className="rounded-xl bg-accent-500 px-5 py-2.5 text-xs font-black uppercase tracking-[0.2em] text-on-accent transition-colors hover:bg-accent-400"
            >
              Analyse dataset
            </button>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button
                onClick={startBlank}
                className="rounded-xl bg-accent-500 px-5 py-2.5 text-xs font-black uppercase tracking-[0.2em] text-on-accent transition-colors hover:bg-accent-400"
              >
                Build from scratch
              </button>
              <button
                onClick={() => router.push('/upgrade')}
                className="rounded-xl border border-white/10 px-5 py-2.5 text-xs font-black uppercase tracking-[0.2em] text-white/45 transition-colors hover:bg-white/5 hover:text-white"
              >
                See Pro
              </button>
            </div>
          )}
        </div>
      </PageFrame>
    );
  }

  const { storyboard, kpis } = analysis;
  // What the deck is a deck OF. A filtered dashboard that still says "from
  // 250,000 rows" is the one sentence on the page that would be false.
  const shownRows = analysis.filter ? analysis.filter.rowCount : dataset.rowCount;

  return (
    <PageFrame
      title="Dashboard"
      subtitle={`${findings.length} ${findings.length === 1 ? 'finding' : 'findings'} from ${(shownRows || 0).toLocaleString()} rows`}
      action={
        <div className="flex flex-wrap items-center gap-2">
          {narrating && (
            <span className="flex items-center gap-1.5 rounded-full border border-white/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-white/35">
              <Loader2 size={11} className="animate-spin" /> Writing narrative
            </span>
          )}
          <button
            onClick={() => setEditing((v) => !v)}
            aria-pressed={editing}
            className={`flex items-center gap-2 rounded-lg border min-h-11 px-3 py-2 text-[10px] font-black uppercase tracking-[0.2em] sm:min-h-0 transition-colors ${
              editing
                ? 'border-accent-500/40 bg-accent-500/10 text-accent-300'
                : 'border-white/10 text-white/45 hover:bg-white/5 hover:text-white'
            }`}
          >
            {editing ? <Check size={13} /> : <Pencil size={13} />} {editing ? 'Done' : 'Edit'}
          </button>
          {/* The arrangement editor, behind a door of its own. Opening it turns
              editing on, because arranging is the only thing it is for — a
              board you can look at but not move is the slide, and that is one
              click away under Present. */}
          <button
            onClick={() => {
              setBoardView((v) => {
                if (!v) setEditing(true);
                return !v;
              });
            }}
            aria-pressed={boardView}
            title="Arrange the board: drag each tile to move it, or any of its edges and corners to size it"
            className={`flex items-center gap-2 rounded-lg border min-h-11 px-3 py-2 text-[10px] font-black uppercase tracking-[0.2em] sm:min-h-0 transition-colors ${
              boardView
                ? 'border-accent-500/40 bg-accent-500/10 text-accent-300'
                : 'border-white/10 text-white/45 hover:bg-white/5 hover:text-white'
            }`}
          >
            <LayoutGrid size={13} /> Dashboard view
          </button>
          <button
            onClick={() => setBuilding(true)}
            className="flex items-center gap-2 rounded-lg border border-white/10 min-h-11 px-3 py-2 text-[10px] font-black uppercase tracking-[0.2em] sm:min-h-0 text-white/45 transition-colors hover:bg-white/5 hover:text-white"
          >
            <Plus size={13} /> New chart
          </button>
          {/* A card is a tile now, so it is added the way a chart is rather
              than from a slot at the end of a strip that no longer exists. */}
          <button
            onClick={() => {
              createKpi();
              // A new card is blank, and everything that makes it not blank —
              // its label, its metric, where it sits — lives in edit mode.
              // Adding one and being left on a read-only page with a card
              // reading "Label / Value" on it is the button not finishing its
              // job.
              setEditing(true);
            }}
            className="flex min-h-11 items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-white/45 transition-colors hover:bg-white/5 hover:text-white sm:min-h-0"
          >
            <Plus size={13} /> New card
          </button>
          <button
            onClick={() => setSaving(true)}
            className="flex items-center gap-2 rounded-lg border border-white/10 min-h-11 px-3 py-2 text-[10px] font-black uppercase tracking-[0.2em] sm:min-h-0 text-white/45 transition-colors hover:bg-white/5 hover:text-white"
          >
            <Bookmark size={13} /> Save
          </button>
          <button
            onClick={() => router.push('/present')}
            className="flex items-center gap-2 rounded-lg border border-accent-500/25 bg-accent-500/8 min-h-11 px-3 py-2 text-[10px] font-black uppercase tracking-[0.2em] sm:min-h-0 text-accent-300 transition-colors hover:bg-accent-500/15"
          >
            <Presentation size={13} /> Present
          </button>
          {planAllows('autoAnalysis') && (
            <button
              onClick={run}
              className="rounded-lg border border-white/10 min-h-11 px-3 py-2 text-[10px] font-black uppercase tracking-[0.2em] sm:min-h-0 text-white/45 transition-colors hover:bg-white/5 hover:text-white"
            >
              Re-run
            </button>
          )}
        </div>
      }
    >
      <DatasetNotices notices={notices} />
      <PreparationNotice preparation={preparation} />
      {joinNotice && <JoinNotice notice={joinNotice} />}

      {editing && (
        <div className="mb-6 flex flex-wrap items-center gap-3 rounded-2xl border border-accent-500/25 bg-accent-500/[0.06] p-4">
          <Pencil size={14} className="text-accent-400" />
          <div className="min-w-0 flex-1 text-[13px] leading-relaxed text-white/70">
            Editing. Every title, sentence and card on this page is yours to rewrite — click a field, then
            click away to keep it. Escape abandons an edit. Changes save as you make them, and they are what
            Present, the report and the PDF will show.
          </div>
        </div>
      )}

      {/* The slice, above the numbers that are numbers of it. `relative` so the
          picker it opens has something to hang from. */}
      <div className="relative">
        <FilterBar />
      </div>

      {analysis.filter?.empty && (
        <div className="mb-6 rounded-2xl border border-amber-500/25 bg-amber-500/[0.06] p-4 text-[13px] leading-relaxed text-amber-200/80">
          No rows match that filter, so there is nothing to compute. The charts below are the last ones that
          had rows behind them — clear a filter to bring the deck back.
        </div>
      )}


      {/*
        * The numbers, back in a strip of their own.
        *
        * They were tiles on the canvas, which is where they still are when the
        * board is open. In the list they are what they have always been: four
        * figures across the top, read before anything under them.
        */}
      {!boardView && (kpis?.length > 0 || editing) && (
        <div
          className={`mb-8 grid grid-cols-2 gap-3 transition-opacity duration-200 lg:grid-cols-4 ${
            filtering ? 'opacity-60' : 'opacity-100'
          }`}
          data-tutorial="dashboard-kpis"
        >
          {(kpis || []).map((card, i) => (
            <KpiTile
              key={card.id || `${card.origLabel || card.label}-${i}`}
              kpi={card}
              index={i}
              editing={editing}
              measures={measures}
              customMeasures={customMeasures}
              flow
              onEdit={(patch) => editKpi(i, patch)}
              onCompute={(source) => computeKpi(i, source)}
              onDelete={() => deleteKpi(i)}
            />
          ))}

          {/* Kept on screen while editing even when empty, so deleting the last
              card does not also remove the way to add one back. */}
          {editing && (
            <button
              type="button"
              aria-label="Add a card"
              title="Add a card"
              onClick={() => createKpi()}
              className="flex min-h-[92px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-white/15 p-4 text-white/35 transition-colors hover:border-accent-500/40 hover:bg-accent-500/[0.06] hover:text-accent-300"
            >
              <Plus size={16} />
              <span className="text-[10px] font-black uppercase tracking-[0.2em]">Add a card</span>
            </button>
          )}
        </div>
      )}

      {/* Chart grid */}
      <section data-tutorial="dashboard-findings">
        <div className="mb-3 flex items-center gap-3">
          <BarChart3 size={14} className="text-accent-400" />
          <h2 className="label">
            {/* Findings, not tiles: the board counts everything it places, and
                this counts what the page is about. They differ by the slicers
                and the KPI cards, which is why the two say different words. */}
            {boardView ? `The board (${tiles.length} tiles)` : `Findings (${findings.length})`}
          </h2>
          <div className="h-px flex-1 bg-gradient-to-r from-white/10 to-transparent" />
          <Collapse open={showFindings} onToggle={() => setShowFindings((v) => !v)} label="findings" />
        </div>

        {/*
          * Two ways to read the same deck, and they are different jobs.
          *
          * **The list** is the page as a document: every finding in order, each
          * one as wide as it asked to be, down a column that can be as long as
          * the analysis is. It is what a reader wants — a chart given a third of
          * a 16:9 page is a chart at 400x200, and the labels go before the
          * plot does.
          *
          * **The board** is the page as a page: one fixed rectangle, everything
          * placed on it, which is the thing the deck projects and the thing
          * worth arranging. It is an editor, so it is opened deliberately
          * rather than being the only way to look at your own findings.
          *
          * Both stay put while a filter is recomputing. Nothing is unmounted
          * and nothing is replaced by a spinner: the charts on screen are the
          * previous slice's and they are about to become this one's, and a
          * chart that vanishes and comes back has thrown away the one thing
          * that makes a filter readable — seeing the bars move.
          */}
        {showFindings && boardView && (
          <div className={`transition-opacity duration-200 ${filtering ? 'opacity-60' : 'opacity-100'}`}>
            <DashboardCanvas
              slides={tiles}
              sizeOf={tileSize}
              editing={editing}
              onMove={moveTile}
            >
              {({ slide: tile, index, box, dragging, stacked, onCardPointerDown, onResizePointerDown, onResizeKey }) =>
                tile.kpiIndex === undefined ? (
                  <FindingCard
                    key={tile.id || index}
                    slide={tile}
                    index={findingIndex.get(tile.id) ?? 0}
                    total={findings.length}
                    editing={editing}
                    filters={filters}
                    filterContext={filterContext}
                    box={box}
                    dragging={dragging}
                    stacked={stacked}
                    onCardPointerDown={onCardPointerDown}
                    onResizePointerDown={onResizePointerDown}
                    onResizeKey={onResizeKey}
                    onSelect={selectValue}
                    onClearFilter={(column) => applyFilters(clearColumn(filters || [], column))}
                    onDelete={() => deleteSlide(tile.id)}
                    onEdit={(patch) => editSlide(tile.id, patch)}
                  />
                ) : (
                  <KpiTile
                    key={tile.id || index}
                    kpi={tile}
                    index={tile.kpiIndex}
                    editing={editing}
                    measures={measures}
                    customMeasures={customMeasures}
                    box={box}
                    dragging={dragging}
                    stacked={stacked}
                    onCardPointerDown={onCardPointerDown}
                    onResizePointerDown={onResizePointerDown}
                    onResizeKey={onResizeKey}
                    onEdit={(patch) => editKpi(tile.kpiIndex, patch)}
                    onCompute={(source) => computeKpi(tile.kpiIndex, source)}
                    onDelete={() => deleteKpi(tile.kpiIndex)}
                  />
                )
              }
            </DashboardCanvas>
          </div>
        )}

        {/* Six columns on a desktop, and each card claims a share of them —
            see lib/slideSize.js. A deck that sets no size lays out two across,
            exactly as every deck did before the board existed. */}
        {showFindings && !boardView && (
          <div
            className={`grid grid-cols-1 gap-4 transition-opacity duration-200 md:grid-cols-2 xl:grid-cols-6 ${
              filtering ? 'opacity-60' : 'opacity-100'
            }`}
          >
            {storyboard.map((slide, i) => (
              <FindingCard
                key={slide.id || i}
                slide={slide}
                // Its place among the findings, not its place in the list. The
                // list also holds the slicers, and they sit at the top of it,
                // so counting positions here numbered the first finding "2 of 6".
                index={findingIndex.get(slide.id) ?? 0}
                total={findings.length}
                editing={editing}
                filters={filters}
                filterContext={filterContext}
                flow
                onSelect={selectValue}
                onClearFilter={(column) => applyFilters(clearColumn(filters || [], column))}
                onDelete={() => deleteSlide(slide.id)}
                onEdit={(patch) => editSlide(slide.id, patch)}
              />
            ))}
          </div>
        )}
      </section>

      <NarrationNote narrated={analysis.narrated} className="mt-8" />

      {saving && (
        <SaveAnalysisDialog
          snapshot={analysisSnapshot()}
          datasetName={dataset?.fileName}
          rowCount={dataset?.rowCount}
          onClose={() => setSaving(false)}
        />
      )}

      {building && (
        <NewChartDialog
          profile={dataset?.profile}
          columns={dataset?.columns}
          customMeasures={customMeasures}
          sample={dataset?.preview}
          onCreate={(spec) => addSlide(spec)}
          onClose={() => setBuilding(false)}
        />
      )}
    </PageFrame>
  );
}

/**
 * One card on the KPI strip.
 *
 * In edit mode the card offers a metric and a column as well as the two text
 * fields. Picking them runs a real aggregate over the loaded rows, so a card
 * someone adds carries a computed number like the four the planner generated,
 * rather than one typed in from a calculation done elsewhere. Typing over the
 * value is still allowed — it just drops the provenance, because at that point
 * the number is no longer the query's.
 */
/**
 * One edit, in the words a person would use for it.
 *
 * Named rather than rendered inline because the phrasing is the whole point:
 * "renamed" and "redrawn" are what happened, and a reader who sees a heading
 * they did not write needs to be told which of the two it was.
 */
/**
 * One number, as a tile on the board.
 *
 * It was a card in a strip above the canvas, which meant the one part of a
 * dashboard people arrange first — the row of numbers along the top — was the
 * one part that could not be arranged at all. It is placed, sized and dragged
 * like every other tile now; what is inside it has not changed.
 */
function KpiTile({
  kpi,
  index,
  editing,
  measures,
  customMeasures = [],
  box,
  dragging = false,
  stacked = false,
  flow = false,
  onCardPointerDown,
  onResizePointerDown,
  onResizeKey,
  onEdit,
  onCompute,
  onDelete,
}) {
  // One dropdown covers both kinds of source, so a measure is picked exactly
  // where a plain aggregate is. Measures are prefixed to keep the two apart.
  const [metric, setMetric] = useState(kpi.source?.measureId ? `measure:${kpi.source.measureId}` : kpi.source?.metric || '');
  const [column, setColumn] = useState(kpi.source?.column || measures[0] || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const compute = useCallback(
    async (nextMetric, nextColumn) => {
      if (!nextMetric) return;
      const measureId = nextMetric.startsWith('measure:') ? nextMetric.slice(8) : null;
      if (!measureId && metricNeedsColumn(nextMetric) && !nextColumn) return;
      setBusy(true);
      setError(null);
      try {
        await onCompute(measureId ? { measureId } : { metric: nextMetric, column: nextColumn });
      } catch (e) {
        setError(e.message || 'That metric could not be computed.');
      } finally {
        setBusy(false);
      }
    },
    [onCompute]
  );

  const pickMetric = (value) => {
    setMetric(value);
    compute(value, column);
  };
  const pickColumn = (value) => {
    setColumn(value);
    compute(metric, value);
  };

  /**
   * Where this card is.
   *
   * In the strip it is a cell in a grid and takes whatever height its contents
   * need — that is the shape the numbers have always had, and the one they go
   * back to when the board is closed. On the canvas it is an absolute box;
   * stacked on a narrow screen it keeps its height and takes the width.
   */
  const placed = !flow && !stacked;
  const placement = flow
    ? undefined
    : stacked
      ? { position: 'relative', height: box?.h }
      : { position: 'absolute', left: box?.x, top: box?.y, width: box?.w, height: box?.h };

  return (
    <div
      data-card
      style={placement}
      onPointerDown={editing && placed ? onCardPointerDown : undefined}
      // The editor hangs off the bottom of the card, so while it is open the
      // card must not clip its own children. `z-30` keeps it above the tiles it
      // hangs over — a panel drawn under the next card is a panel nobody can
      // use. Only on the board: in the strip the card grows instead.
      className={`card relative flex flex-col justify-center p-4 ${flow ? 'min-h-[92px]' : ''} ${
        editing && placed ? 'z-30 cursor-grab select-none overflow-visible hover:z-40' : 'overflow-hidden'
      } ${dragging ? 'z-20 cursor-grabbing shadow-2xl ring-1 ring-accent-500/40' : ''}`}
    >
      {editing && (
        <button
          type="button"
          data-no-drag
          aria-label={`Delete the ${kpi.label} card`}
          title="Delete this card"
          onClick={onDelete}
          className="absolute right-2 top-2 rounded-lg p-1 text-white/20 transition-colors hover:bg-rose-500/10 hover:text-rose-400"
        >
          <Trash2 size={12} />
        </button>
      )}
      <EditableText
        as="div"
        editing={editing}
        value={kpi.label}
        onCommit={(text) => onEdit({ label: text })}
        ariaLabel="Card label"
        placeholder="Label"
        className={editing ? 'label' : 'label truncate'}
      />
      <EditableText
        as="div"
        editing={editing}
        value={String(kpi.value ?? '')}
        // Typing a value by hand is an assertion, not a measurement, so the
        // metric behind it is cleared rather than left claiming credit.
        onCommit={(text) => onEdit({ value: text, source: null })}
        ariaLabel="Card value"
        placeholder="Value"
        className="display mt-2 text-[26px] leading-snug text-white"
      />

      {/*
        * What the card measures, in a panel that hangs below it.
        *
        * It used to be laid out inside the card, which is a box the reader
        * sized for a number and its name: the two dropdowns did not fit, the
        * card clipped them, and the control for choosing a metric was half a
        * select box hanging off the bottom edge. Out of flow it is always fully
        * visible, and the board does not jump about when edit mode is turned
        * on.
        */}
      {editing && (
        <div
          data-no-drag
          className={
            placed
              ? 'panel absolute left-0 right-0 top-full z-30 mt-1.5 flex flex-col gap-1.5 p-2'
              : // In the strip, and stacked on a phone, there is no fixed height
                // to escape, so the panel stays in the card where it reads
                // better.
                'mt-3 flex flex-col gap-1.5 border-t border-white/8 pt-3'
          }
        >
          <div className="flex items-center gap-1.5">
            <select
              value={metric}
              onChange={(e) => pickMetric(e.target.value)}
              aria-label="Metric"
              className="min-w-0 flex-1 rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-[11px] font-bold text-white/75 outline-none focus:border-accent-500/50"
            >
              <option value="" className="bg-surface">
                Typed by hand
              </option>
              {KPI_METRICS.map((m) => (
                <option
                  key={m.key}
                  value={m.key}
                  disabled={m.needsColumn && measures.length === 0}
                  className="bg-surface"
                >
                  {m.label}
                </option>
              ))}
              {customMeasures.length > 0 && (
                <optgroup label="Measures">
                  {customMeasures.map((m) => (
                    <option key={m.id} value={`measure:${m.id}`} className="bg-surface">
                      {m.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            {busy && <Loader2 size={12} className="shrink-0 animate-spin text-accent-400" />}
          </div>

          {!metric.startsWith('measure:') && metricNeedsColumn(metric) && (
            <select
              value={column}
              onChange={(e) => pickColumn(e.target.value)}
              aria-label="Column to measure"
              className="min-w-0 rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-[11px] font-bold text-white/75 outline-none focus:border-accent-500/50"
            >
              {measures.map((m) => (
                <option key={m} value={m} className="bg-surface">
                  {m.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          )}

          {error && <p className="text-[10px] leading-snug text-rose-400">{error}</p>}
        </div>
      )}

      {/* The same grips as every other tile — and only on the board, which is
          the only place a card has a box to drag. */}
      {editing && placed && (
        <ResizeHandles
          label={`the ${kpi.label} card`}
          box={box}
          onPointerDown={onResizePointerDown}
          onKeyResize={onResizeKey}
        />
      )}
    </div>
  );
}

/** A section's fold control: a chevron that turns, and says what it folds. */

/**
 * One finding on the grid.
 *
 * The card is a link to the full write-up, which is exactly wrong while editing:
 * the first click into a text field would navigate away from the page. In edit
 * mode the same markup is wrapped in a plain div instead.
 */
function FindingCard({
  slide,
  index,
  total,
  editing,
  filters,
  filterContext,
  box,
  dragging = false,
  stacked = false,
  flow = false,
  onCardPointerDown,
  onResizePointerDown,
  onResizeKey,
  onSelect,
  onClearFilter,
  onDelete,
  onEdit,
}) {
  /**
   * Can a click on this chart be turned into a filter?
   *
   * Only where the column behind the axis can be named — see `clickTarget`.
   * While editing, no: the card is a form then, and a click inside it is aimed
   * at a text field.
   */
  const target = editing ? null : clickTarget(slide.chart, filterContext);
  // A filter tile is a control, not a claim. It still runs a query and still
  // gets a finding written about it — "Month-to-month leads contract types on
  // record count" — and that sentence under a row of checkboxes is the app
  // reading its own furniture back to the reader.
  const isSlicer = slide.chart?.chart_type === 'slicer';
  // A slicer shows every value it is keeping; a bar chart shows the one that
  // was clicked, so the others can be dimmed rather than listed.
  const kept = target?.kind === 'values' ? selectedValues(filters || [], target.column) : [];
  const picked = target?.multi ? kept : kept[0] ?? null;
  /**
   * Where this card is.
   *
   * In the list it is a cell in a six-column grid: its share of the row travels
   * as two custom properties and `.slide-tile` in globals.css decides which one
   * this viewport can honour, because the cap at each breakpoint is a media
   * query and an inline style has no media queries. Its height is its own.
   *
   * On the board it is an absolute box in canvas units; stacked on a narrow
   * board it is a card in a column that keeps its height and takes whatever
   * width there is. The wrapper is a link to the write-up outside edit mode and
   * a plain div inside it, because a card full of text fields cannot also be a
   * link.
   */
  const layout = slideLayout(slide.size);
  const placed = !flow && !stacked;
  const placement = flow
    ? slideStyle(slide.size)
    : stacked
      ? { position: 'relative', height: box?.h }
      : { position: 'absolute', left: box?.x, top: box?.y, width: box?.w, height: box?.h };

  const Wrapper = editing ? 'div' : Link;
  const wrapperProps = {
    'data-card': true,
    style: placement,
    onPointerDown: editing && placed ? onCardPointerDown : undefined,
    className: [
      // A filter tile is a title and a control, and at that height `p-5` is
      // most of the card.
      `card relative flex flex-col overflow-hidden ${isSlicer ? 'p-3.5' : 'p-5'}`,
      flow ? 'slide-tile' : '',
      // Cards are allowed to overlap — dropping one on another is an
      // arrangement, not a mistake — and DOM order decides which of two
      // overlapping cards has its edges on top. With a single corner grip that
      // was a curiosity; with a grip on every side it is the difference between
      // a card you can resize and one you cannot, so the card under the pointer
      // comes forward.
      editing && placed ? 'cursor-grab select-none hover:z-40' : '',
      dragging ? 'z-20 cursor-grabbing shadow-2xl ring-1 ring-accent-500/40' : '',
      editing ? '' : 'group transition-colors hover:border-accent-500/30 hover:bg-white/[0.035]',
    ]
      .filter(Boolean)
      .join(' '),
  };
  if (!editing) wrapperProps.href = `/insight/${slide.id || `slide_${index + 1}`}`;

  return (
    <Wrapper {...wrapperProps}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="label flex flex-wrap items-center gap-2">
            {/* The reader gets the chart's name, not its internal id: the card
                used to read "hbar · 3 of 9". */}
            {/* A slicer has a type and no number: it is not one of the
                findings, so "of 7" would be counting it among them again. */}
            <span>
              {chartTypeLabel(slide.chart?.chart_type || 'bar')}
              {!isSlicer && ` · ${index + 1} of ${total}`}
            </span>
            {slide.custom && <span className="text-accent-400/70">· yours</span>}
            {!slide.custom && slide.edits?.length > 0 && <span className="text-accent-400/70">· edited</span>}
            {slide.analystNotes && <StickyNote size={10} className="text-amber-400/70" />}
            {!isSlicer && (
              <EvidenceBadge
                tier={slide.findings?.metrics?.evidence}
                notes={slide.findings?.metrics?.evidenceNotes}
              />
            )}
          </div>
          <EditableText
            as="h3"
            editing={editing}
            value={slide.pageTitle}
            onCommit={(text) => onEdit({ pageTitle: text })}
            ariaLabel="Finding title"
            placeholder="Title"
            className="display mt-1.5 text-[17px] leading-snug text-white group-hover:text-accent-300"
          />
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {/* In edit mode the card is a plain div so that clicking a text field
              does not navigate — which also removed the only route to the chart
              editor, where what a chart measures can be changed. This is that
              route, and it is a link rather than a second copy of the editor. */}
          {editing && (
            <Link
              href={`/insight/${slide.id || `slide_${index + 1}`}`}
              data-no-drag
              aria-label={`Edit the chart for ${slide.pageTitle}`}
              title="Change what this chart measures"
              className="flex h-11 w-11 items-center justify-center rounded-lg text-white/15 sm:h-auto sm:w-auto sm:p-1.5 transition-colors hover:bg-accent-500/10 hover:text-accent-300"
            >
              <SlidersHorizontal size={14} />
            </Link>
          )}
          {/* Deleting lives in edit mode, with every other change to the board.
              It used to sit on every card at all times, which put an
              irreversible one-click control on a page whose job is to be read —
              and made the board inconsistent with itself, since a card could
              only be deleted while editing and the chart beside it could be
              deleted whenever. Editing is where the board is changed. */}
          {editing && (
            <button
              type="button"
              data-no-drag
              aria-label={`Delete ${slide.pageTitle}`}
              title="Delete this finding"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onDelete();
              }}
              className="flex h-11 w-11 items-center justify-center rounded-lg text-white/15 sm:h-auto sm:w-auto sm:p-1.5 transition-colors hover:bg-rose-500/10 hover:text-rose-400"
            >
              <Trash2 size={14} />
            </button>
          )}
          {!editing && <ChevronRight size={16} className="text-white/20 group-hover:text-accent-400" />}
        </div>
      </div>

      {/*
        * Outside edit mode the whole card is a link to the write-up, and a
        * chart inside a link is a chart whose clicks navigate: the first bar
        * clicked opened the finding page instead of filtering. Where a mark can
        * be filtered on, the plot swallows the click; everywhere else on the
        * card — the title, the sentence, the chevron — still opens the
        * write-up, which is where that behaviour was worth keeping.
        */}
      {/* The plot takes whatever the card has left once the title and the
          sentence have had theirs, because on a canvas the card's height is the
          thing being dragged and the chart is what that height is for. */}
      <div
        /*
         * In the list the plot carries a dragged height and the card grows
         * around it — `flex-none`, because a flex item's height is a suggestion
         * until it is told not to grow or shrink, and without it a dragged
         * height was ignored in favour of whatever the row's tallest card had
         * settled on. On the board it is the other way round: the card's height
         * is the thing being dragged and the plot takes what is left.
         */
        className={`${flow ? 'flex-none' : 'min-h-0 flex-1'} ${isSlicer ? 'mt-2.5' : 'mt-4'}`}
        // A filter is a control, not a plot: a list of tick-boxes or one line
        // that opens them. Holding 120px of plot open underneath it pushed the
        // control itself past the bottom edge of a tile sized for a control,
        // and what a reader saw was a filter card with its filter cut off.
        style={
          isSlicer
            ? undefined
            : flow
              ? { height: layout.height, transition: 'height 120ms ease-out' }
              : { minHeight: MIN_PLOT_HEIGHT }
        }
        onClick={
          target
            ? (e) => {
                e.preventDefault();
                e.stopPropagation();
              }
            : undefined
        }
        title={target ? 'Click a bar to filter the dashboard to it' : undefined}
      >
        <ChartBoundary resetKey={`${slide.id}-${slide.chart?.chart_type}`}>
          <LazyChart
            data={slide.chart?.resultData}
            type={slide.chart?.chart_type}
            xKey={slide.chart?.xAxisKey}
            yKey={slide.chart?.yAxisKey}
            secondaryYKey={slide.chart?.secondaryYAxisKey}
            seriesKey={slide.chart?.seriesKey}
            seriesSort={slide.chart?.seriesSort}
            colors={slide.chart?.colors}
            labels={slide.chart?.labels}
            colorBy={slide.chart?.colorBy}
            xLabel={slide.chart?.xAxisLabel}
            yLabel={slide.chart?.yAxisLabel}
            compact
            eager={index < 2}
            onSelect={target ? (value) => onSelect(target, value) : null}
            selected={picked}
            onClearSelection={target?.multi ? () => onClearFilter(target.column) : null}
            slicerMode={slide.chart?.slicerMode}
          />
        </ChartBoundary>
      </div>

      {!isSlicer && (slide.insight_anchor || editing) && (
        <EditableText
          as="p"
          editing={editing}
          value={slide.insight_anchor}
          display={cleanFloatingPoints(slide.insight_anchor)}
          onCommit={(text) => onEdit({ insight_anchor: text })}
          ariaLabel="Key finding"
          placeholder="The finding in one sentence, with its number."
          multiline
          rows={2}
          className={`mt-4 text-[13px] leading-relaxed text-white/45 ${editing ? '' : 'line-clamp-2'}`}
        />
      )}

      {/* Sizing lives in edit mode with every other change to the deck. In the
          list the corner snaps the card's width to the grid's columns and takes
          the arrow keys — see CardResizer. On the board the canvas owns the
          gesture and this is only the grip it reads. */}
      {editing && flow && (
        <CardResizer
          layout={slide.size}
          label={slide.pageTitle || 'this finding'}
          onResize={(next) => onEdit({ size: next })}
        />
      )}
      {editing && placed && (
        <ResizeHandles
          label={slide.pageTitle || 'this finding'}
          box={box}
          onPointerDown={onResizePointerDown}
          onKeyResize={onResizeKey}
        />
      )}
    </Wrapper>
  );
}

/**
 * Says out loud that the numbers rest on inferred joins.
 *
 * Amber when something measurable looks wrong, neutral otherwise — a warning
 * that is always loud is one people learn to ignore.
 */
function JoinNotice({ notice }) {
  const worrying = notice.concerns.length > 0;
  return (
    <div
      className={`mb-6 flex flex-wrap items-center gap-3 rounded-2xl border p-4 ${
        worrying ? 'border-amber-500/25 bg-amber-500/[0.06]' : 'border-white/8 bg-white/[0.02]'
      }`}
    >
      <GitBranch size={15} className={worrying ? 'text-amber-400' : 'text-accent-400'} />
      <div className="min-w-0 flex-1">
        <div className="text-[13px] leading-relaxed text-white/70">
          {notice.joins > 0 ? (
            <>
              {notice.tables} tables were related automatically using {notice.joins} inferred{' '}
              {notice.joins === 1 ? 'join' : 'joins'}. Every number below depends on those being right.
            </>
          ) : (
            <>
              {notice.tables} tables were loaded but no relationships were found, so only one of them is
              being analysed.
            </>
          )}
        </div>
        {worrying && (
          <div className="mt-1 text-[12px] leading-relaxed text-amber-300">
            {notice.concerns[0]}
            {notice.concerns.length > 1 && ` (+${notice.concerns.length - 1} more)`}
          </div>
        )}
      </div>
      <Link
        href="/model"
        className="shrink-0 rounded-lg border border-white/10 min-h-11 px-3 py-2 text-[10px] font-black uppercase tracking-[0.2em] sm:min-h-0 text-white/55 transition-colors hover:bg-white/5 hover:text-white"
      >
        Review joins
      </Link>
    </div>
  );
}
