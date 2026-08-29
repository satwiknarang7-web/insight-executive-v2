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
  Bookmark,
  StickyNote,
  GitBranch,
  Pencil,
  Check,
  Info,
  SlidersHorizontal,
} from 'lucide-react';
import { useActions, useAnalysis, useDataset, useMeasures } from '../../../lib/store/DatasetProvider';
import ProgressPanel from '../../../components/panels/ProgressPanel';
import PageFrame from '../../../components/shell/PageFrame';
import LazyChart from '../../../components/charts/LazyChart';
import ChartBoundary from '../../../components/charts/ChartBoundary';
import EditableText from '../../../components/panels/EditableText';
import { cleanFloatingPoints } from '../../../lib/dataCleaner';
import { KPI_METRICS, metricNeedsColumn } from '../../../lib/kpiMetrics';
import NewChartDialog from '../../../components/panels/NewChartDialog';
import SaveAnalysisDialog from '../../../components/panels/SaveAnalysisDialog';
import { modelConcerns } from '../../../lib/dataModel';

export default function DashboardPage() {
  const { dataset, status } = useDataset();
  const { analysis, narrating } = useAnalysis();
  // Measures the user defined. Distinct from `measures` below, which is this
  // dataset's numeric columns — the profile has always called those measures.
  const customMeasures = useMeasures();
  const { analyze, addSlide, deleteSlide, editSlide, editSummary, editKpi, deleteKpi, createKpi, computeKpi, analysisSnapshot } =
    useActions();
  const router = useRouter();
  const [building, setBuilding] = useState(false);
  const [saving, setSaving] = useState(false);
  // One switch for the whole page. A pencil beside every field would put an
  // affordance next to every sentence on a dashboard whose job is to be read.
  const [editing, setEditing] = useState(false);

  const run = useCallback(() => analyze().catch(() => {}), [analyze]);

  const summary = analysis?.slideZero;
  // Only numeric columns can be summed or averaged. Count needs none of them,
  // which is why it stays available even when a dataset has no measures at all.
  const measures = dataset?.profile?.measures || [];

  // Bullets are edited as a list: rewriting one, dropping one and adding one are
  // all the same commit of a new array.
  const setInsight = useCallback(
    (index, text) => {
      const list = [...(summary?.macroInsights || [])];
      list[index] = text;
      editSummary({ macroInsights: list });
    },
    [editSummary, summary]
  );

  const removeInsight = useCallback(
    (index) => {
      editSummary({ macroInsights: (summary?.macroInsights || []).filter((_, i) => i !== index) });
    },
    [editSummary, summary]
  );

  const addInsight = useCallback(() => {
    editSummary({ macroInsights: [...(summary?.macroInsights || []), ''] });
  }, [editSummary, summary]);

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
        {joinNotice && <JoinNotice notice={joinNotice} />}
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

  const { storyboard, kpis } = analysis;

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
            onClick={() => setEditing((v) => !v)}
            aria-pressed={editing}
            className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-[10px] font-black uppercase tracking-[0.2em] transition-colors ${
              editing
                ? 'border-accent-500/40 bg-accent-500/10 text-accent-300'
                : 'border-white/10 text-white/45 hover:bg-white/5 hover:text-white'
            }`}
          >
            {editing ? <Check size={13} /> : <Pencil size={13} />} {editing ? 'Done' : 'Edit'}
          </button>
          <button
            onClick={() => setBuilding(true)}
            className="flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-white/45 transition-colors hover:bg-white/5 hover:text-white"
          >
            <Plus size={13} /> New chart
          </button>
          <button
            onClick={() => setSaving(true)}
            className="flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-white/45 transition-colors hover:bg-white/5 hover:text-white"
          >
            <Bookmark size={13} /> Save
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

      {/* KPI strip. Kept on screen while editing even when empty, so deleting
          the last card does not also remove the way to add one back. */}
      {(kpis?.length > 0 || editing) && (
        <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {(kpis || []).map((k, i) => (
            <KpiCard
              key={`${k.origLabel || k.label}-${i}`}
              kpi={k}
              index={i}
              editing={editing}
              measures={measures}
              customMeasures={customMeasures}
              onEdit={(patch) => editKpi(i, patch)}
              onCompute={(source) => computeKpi(i, source)}
              onDelete={() => deleteKpi(i)}
            />
          ))}

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

      {/* Executive summary */}
      <section className="mb-8">
        <div className="mb-3 flex items-center gap-3">
          <Sparkles size={14} className="text-accent-400" />
          <EditableText
            as="h2"
            editing={editing}
            value={summary.title}
            onCommit={(text) => editSummary({ title: text })}
            ariaLabel="Summary title"
            placeholder="Executive summary"
            className="text-xs font-black uppercase tracking-[0.28em] text-white/45"
          />
          <div className="h-px flex-1 bg-gradient-to-r from-white/10 to-transparent" />
        </div>

        {/* The opening line — what an analyst says before the bullets. */}
        {(summary.headline || editing) && (
          <EditableText
            as="p"
            editing={editing}
            value={summary.headline}
            display={cleanFloatingPoints(summary.headline)}
            onCommit={(text) => editSummary({ headline: text })}
            ariaLabel="Opening line"
            placeholder="One sentence: the thing you would say first."
            multiline
            rows={2}
            className="mb-4 max-w-4xl text-[17px] font-medium leading-relaxed text-white/85"
          />
        )}

        <div className="grid gap-4 lg:grid-cols-3">
          <div className="card p-6 lg:col-span-2">
            <ul className="flex flex-col gap-4">
              {summary.macroInsights.map((line, i) => (
                <li key={i} className="flex gap-3">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-500" />
                  <EditableText
                    as="p"
                    editing={editing}
                    value={line}
                    display={cleanFloatingPoints(line)}
                    onCommit={(text) => setInsight(i, text)}
                    ariaLabel={`Takeaway ${i + 1}`}
                    placeholder="What is true, and what follows from it."
                    multiline
                    rows={2}
                    className="text-[15px] leading-relaxed text-white/75"
                  />
                  {editing && (
                    <button
                      type="button"
                      aria-label={`Delete takeaway ${i + 1}`}
                      title="Delete this takeaway"
                      onClick={() => removeInsight(i)}
                      className="mt-0.5 shrink-0 rounded-lg p-1.5 text-white/20 transition-colors hover:bg-rose-500/10 hover:text-rose-400"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </li>
              ))}
            </ul>

            {editing && (
              <button
                type="button"
                onClick={addInsight}
                className="mt-4 flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-white/45 transition-colors hover:bg-white/5 hover:text-white"
              >
                <Plus size={13} /> Add a takeaway
              </button>
            )}

            {/* How to read the numbers above. Computed from what the queries
                actually did, not written by anyone, and deliberately not
                editable: a share of the top ten rows does not become a share of
                the business because the wording was tidied up. */}
            {summary.caveats?.length > 0 && (
              <ul className="mt-5 flex flex-col gap-1.5 border-t border-white/8 pt-4">
                {summary.caveats.map((line, i) => (
                  <li key={i} className="flex gap-2 text-[12px] leading-relaxed text-white/40">
                    <Info size={12} className="mt-0.5 shrink-0 text-amber-400/70" />
                    {line}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex flex-col gap-3">
            <Scorecard
              icon={Target}
              tone="accent"
              label="Focus"
              text={summary.strategicScorecard.focus}
              editing={editing}
              onCommit={(text) => editSummary({ strategicScorecard: { focus: text } })}
            />
            <Scorecard
              icon={AlertTriangle}
              tone="rose"
              label="Risk"
              text={summary.strategicScorecard.risk}
              editing={editing}
              onCommit={(text) => editSummary({ strategicScorecard: { risk: text } })}
            />
            <Scorecard
              icon={TrendingUp}
              tone="emerald"
              label="Opportunity"
              text={summary.strategicScorecard.opportunity}
              editing={editing}
              onCommit={(text) => editSummary({ strategicScorecard: { opportunity: text } })}
            />
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
            <FindingCard
              key={slide.id || i}
              slide={slide}
              index={i}
              total={storyboard.length}
              editing={editing}
              onDelete={() => deleteSlide(slide.id)}
              onEdit={(patch) => editSlide(slide.id, patch)}
            />
          ))}
        </div>
      </section>

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
function KpiCard({ kpi, index, editing, measures, customMeasures = [], onEdit, onCompute, onDelete }) {
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

  return (
    <div className="card relative p-4">
      {editing && (
        <button
          type="button"
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
        className="mt-2 text-2xl font-black tracking-tight text-white"
      />

      {editing && (
        <div className="mt-3 flex flex-col gap-1.5 border-t border-white/8 pt-3">
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
    </div>
  );
}

/**
 * One finding on the grid.
 *
 * The card is a link to the full write-up, which is exactly wrong while editing:
 * the first click into a text field would navigate away from the page. In edit
 * mode the same markup is wrapped in a plain div instead.
 */
function FindingCard({ slide, index, total, editing, onDelete, onEdit }) {
  const Wrapper = editing ? 'div' : Link;
  const wrapperProps = editing
    ? { className: 'card relative flex flex-col overflow-hidden p-5' }
    : {
        href: `/insight/${slide.id || `slide_${index + 1}`}`,
        className:
          'group card relative flex flex-col overflow-hidden p-5 transition-colors hover:border-accent-500/30 hover:bg-white/[0.035]',
      };

  return (
    <Wrapper {...wrapperProps}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="label flex items-center gap-2">
            <span>
              {String(slide.chart?.chart_type || 'chart')} · {index + 1} of {total}
            </span>
            {slide.custom && <span className="text-accent-400/70">· yours</span>}
            {!slide.custom && slide.edits?.length > 0 && <span className="text-accent-400/70">· edited</span>}
            {slide.analystNotes && <StickyNote size={10} className="text-amber-400/70" />}
          </div>
          <EditableText
            as="h3"
            editing={editing}
            value={slide.pageTitle}
            onCommit={(text) => onEdit({ pageTitle: text })}
            ariaLabel="Finding title"
            placeholder="Title"
            className="mt-1.5 text-base font-black leading-tight text-white group-hover:text-accent-300"
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
              aria-label={`Edit the chart for ${slide.pageTitle}`}
              title="Change what this chart measures"
              className="rounded-lg p-1.5 text-white/15 transition-colors hover:bg-accent-500/10 hover:text-accent-300"
            >
              <SlidersHorizontal size={14} />
            </Link>
          )}
          <button
            type="button"
            aria-label={`Delete ${slide.pageTitle}`}
            title="Delete this finding"
            onClick={(e) => {
              // Outside edit mode the whole card is a link; deleting must not navigate.
              e.preventDefault();
              e.stopPropagation();
              onDelete();
            }}
            className="rounded-lg p-1.5 text-white/15 transition-colors hover:bg-rose-500/10 hover:text-rose-400"
          >
            <Trash2 size={14} />
          </button>
          {!editing && <ChevronRight size={16} className="text-white/20 group-hover:text-accent-400" />}
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
            seriesKey={slide.chart?.seriesKey}
            seriesSort={slide.chart?.seriesSort}
            colors={slide.chart?.colors}
            labels={slide.chart?.labels}
            colorBy={slide.chart?.colorBy}
            xLabel={slide.chart?.xAxisLabel}
            yLabel={slide.chart?.yAxisLabel}
            compact
            eager={index < 2}
          />
        </ChartBoundary>
      </div>

      {(slide.insight_anchor || editing) && (
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
          <div className="mt-1 text-[12px] leading-relaxed text-amber-300/80">
            {notice.concerns[0]}
            {notice.concerns.length > 1 && ` (+${notice.concerns.length - 1} more)`}
          </div>
        )}
      </div>
      <Link
        href="/model"
        className="shrink-0 rounded-lg border border-white/10 px-3 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-white/55 transition-colors hover:bg-white/5 hover:text-white"
      >
        Review joins
      </Link>
    </div>
  );
}

function Scorecard({ icon: Icon, tone, label, text, editing, onCommit }) {
  // The engine leaves a card empty when the data gives it nothing to say. An
  // empty card is dropped rather than shown as a dash — except while editing,
  // where it is the only way to write one yourself.
  if (!editing && !String(text || '').trim()) return null;

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
      <EditableText
        as="p"
        editing={editing}
        value={text}
        display={cleanFloatingPoints(text) || '—'}
        onCommit={onCommit}
        ariaLabel={label}
        placeholder={`What would you put under ${label.toLowerCase()}?`}
        multiline
        rows={3}
        className="mt-2 text-[13px] font-medium leading-relaxed text-white/80"
      />
    </div>
  );
}
