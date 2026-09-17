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
  Wand2,
} from 'lucide-react';
import { useActions, useAnalysis, useDataset, useMeasures } from '../../../lib/store/DatasetProvider';
import ProgressPanel from '../../../components/panels/ProgressPanel';
import { exclusionNotice } from '../../../lib/voidRows';
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
  // The two long sections fold away. A dashboard with nine findings is several
  // screens whatever else is done to it, and the summary and the grid are read
  // at different moments — collapsing the one you are not reading is the
  // difference between scrolling to find something and it being on screen.
  const [showSummary, setShowSummary] = useState(true);
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
  const [showNotes, setShowNotes] = useState(false);

  const run = useCallback(() => analyze().catch(() => {}), [analyze]);

  /**
   * The notes, each kind folded to one line per distinct thing said.
   *
   * The same repair applied to four slides produced four identical sentences,
   * which reads as a stutter rather than as four fixes. Folded to one line
   * with a count: same information, and it is legible.
   */
  const notes = useMemo(() => {
    const fold = (items, key) => {
      const seen = new Map();
      for (const item of items || []) {
        const text = key(item);
        if (!text) continue;
        const at = seen.get(text);
        if (at) at.count += 1;
        else seen.set(text, { ...item, text, count: 1 });
      }
      return [...seen.values()];
    };
    const questions = fold(analysis?.critique, (q) => q?.question);
    const edits = fold(analysis?.analystEdits, (e) => {
      const what = describeEdit(e);
      return e?.why ? `${what} — ${e.why}` : what;
    });
    return { questions, edits, total: questions.length + edits.length };
  }, [analysis?.critique, analysis?.analystEdits]);

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
      subtitle={`${storyboard.length} findings from ${(shownRows || 0).toLocaleString()} rows`}
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
          <button
            onClick={() => setBuilding(true)}
            className="flex items-center gap-2 rounded-lg border border-white/10 min-h-11 px-3 py-2 text-[10px] font-black uppercase tracking-[0.2em] sm:min-h-0 text-white/45 transition-colors hover:bg-white/5 hover:text-white"
          >
            <Plus size={13} /> New chart
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

      {/* KPI strip. Kept on screen while editing even when empty, so deleting
          the last card does not also remove the way to add one back. */}
      {(kpis?.length > 0 || editing) && (
        <div
          className={`mb-8 grid grid-cols-2 gap-3 transition-opacity duration-200 lg:grid-cols-4 ${
            filtering ? 'opacity-60' : 'opacity-100'
          }`}
          data-tutorial="dashboard-kpis"
        >
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

      {/* Executive summary.
          Dimmed while a filter is on, and labelled. Every sentence in it was
          written about the whole table: the figures under the charts are
          recomputed on a filter because they are readings of a result set, and
          these are not — they are prose, and prose cannot be recomputed. Saying
          so is the only honest thing left to do with it. */}
      <section
        className={`mb-8 transition-opacity ${analysis.filter ? 'opacity-45' : ''}`}
        data-tutorial="dashboard-summary"
      >
        <div className="mb-3 flex items-center gap-3">
          <Sparkles size={14} className="text-accent-400" />
          <EditableText
            as="h2"
            editing={editing}
            value={summary.title}
            onCommit={(text) => editSummary({ title: text })}
            ariaLabel="Summary title"
            placeholder="Executive summary"
            className="label"
          />
          {analysis.filter && (
            <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.15em] text-amber-300/80">
              Written for all {(dataset.rowCount || 0).toLocaleString()} rows
            </span>
          )}
          <div className="h-px flex-1 bg-gradient-to-r from-white/10 to-transparent" />
          <Collapse open={showSummary} onToggle={() => setShowSummary((v) => !v)} label="executive summary" />
        </div>

        {showSummary && (
        <>

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
                className="mt-4 flex items-center gap-2 rounded-lg border border-white/10 min-h-11 px-3 py-2 text-[10px] font-black uppercase tracking-[0.2em] sm:min-h-0 text-white/45 transition-colors hover:bg-white/5 hover:text-white"
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

            {/*
              * What the deck does not say, and what was repaired before anyone
              * saw it — behind one line.
              *
              * Both lists are worth keeping and neither is a finding. They used
              * to sit open at the foot of the executive summary, so the last
              * thing a reader saw was four questions the analysis could not
              * answer and four notes about slides it had edited. That is our
              * working, and a reader is owed the ability to see it rather than
              * the obligation to read it.
              */}
            {notes.total > 0 && (
              <div className="mt-5 border-t border-white/8 pt-4">
                <button
                  type="button"
                  onClick={() => setShowNotes((v) => !v)}
                  aria-expanded={showNotes}
                  className="flex w-full items-center gap-2 text-left text-[11px] text-white/30 transition-colors hover:text-white/55"
                >
                  <HelpCircle size={12} className="shrink-0" />
                  <span className="font-semibold">How this deck was checked</span>
                  <span className="text-white/25">
                    {notes.questions.length > 0 &&
                      `${notes.questions.length} open question${notes.questions.length === 1 ? '' : 's'}`}
                    {notes.questions.length > 0 && notes.edits.length > 0 && ' · '}
                    {notes.edits.length > 0 && `${notes.edits.length} edit${notes.edits.length === 1 ? '' : 's'}`}
                  </span>
                  <ChevronDown
                    size={13}
                    className={`ml-auto shrink-0 transition-transform ${showNotes ? 'rotate-180' : ''}`}
                  />
                </button>

                {showNotes && (
                  <div className="mt-4 flex flex-col gap-5">
                    {notes.questions.length > 0 && (
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="label">Open questions</span>
                          <span className="text-[10px] text-white/20">nothing here is a finding</span>
                        </div>
                        <ul className="mt-2.5 flex flex-col gap-2">
                          {notes.questions.map((q) => (
                            <li key={q.text} className="flex gap-2 text-[12px] leading-relaxed text-white/40">
                              {/* Which questions were found in the data and which
                                  were thought up about it. Both are questions and
                                  neither is a finding, but a reader is owed the
                                  difference: one was measured, the other was
                                  imagined by a model shown no numbers. */}
                              {q.source === 'model' && (
                                <span
                                  title="Suggested by a language model, which was shown the column names and no values"
                                  className="mt-[3px] shrink-0 rounded border border-white/10 px-1 text-[8px] font-bold uppercase tracking-[0.15em] text-white/25"
                                >
                                  AI
                                </span>
                              )}
                              <span>{q.text}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {notes.edits.length > 0 && (
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="label">Edits made</span>
                          <span className="text-[10px] text-white/20">before you saw it — no number changed</span>
                        </div>
                        <ul className="mt-2.5 flex flex-col gap-2">
                          {notes.edits.map((e) => (
                            <li key={e.text} className="flex gap-2 text-[12px] leading-relaxed text-white/40">
                              {/* Which fixes were measured and which were written.
                                  A donut of two slices is arithmetic; a shorter
                                  heading is a judgement, and a reader deciding how
                                  much to trust a change is owed the difference. */}
                              <span
                                title={
                                  e.source === 'audit'
                                    ? 'Found and fixed by a deterministic check — no model involved'
                                    : "Made by a language model, which was shown the deck's structure and no values"
                                }
                                className="mt-[3px] shrink-0 rounded border border-white/10 px-1 text-[8px] font-bold uppercase tracking-[0.15em] text-white/25"
                              >
                                {e.source === 'audit' ? 'CHECK' : 'AI'}
                              </span>
                              <span className="text-white/45">
                                {e.text}
                                {e.count > 1 && (
                                  <span className="ml-1.5 text-white/25">×{e.count}</span>
                                )}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </div>
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
        </>
        )}
      </section>

      {/* Chart grid */}
      <section data-tutorial="dashboard-findings">
        <div className="mb-3 flex items-center gap-3">
          <BarChart3 size={14} className="text-accent-400" />
          <h2 className="label">
            Findings ({storyboard.length})
          </h2>
          <div className="h-px flex-1 bg-gradient-to-r from-white/10 to-transparent" />
          <Collapse open={showFindings} onToggle={() => setShowFindings((v) => !v)} label="findings" />
        </div>

        {/* Six columns on a desktop, and each card claims a share of them —
            see `lib/slideSize.js`. A deck that sets no size lays out two
            across, exactly as every deck did before sizing existed. */}
        {/*
          * The deck stays put while a filter is recomputing.
          *
          * Nothing is unmounted and nothing is replaced by a spinner: the charts
          * on screen are the previous slice's, they are about to become this
          * one's, and a chart that vanishes and comes back has thrown away the
          * one thing that makes a filter readable — seeing the bars move. The
          * whole grid just loses a little contrast while the numbers are in
          * flight, which is the only honest signal that they are.
          */}
        {showFindings && (
        <div
          className={`grid grid-cols-1 gap-4 transition-opacity duration-200 md:grid-cols-2 xl:grid-cols-6 ${
            filtering ? 'opacity-60' : 'opacity-100'
          }`}
        >
          {storyboard.map((slide, i) => (
            <FindingCard
              key={slide.id || i}
              slide={slide}
              index={i}
              total={storyboard.length}
              editing={editing}
              filters={filters}
              filterContext={filterContext}
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
function describeEdit(edit) {
  if (edit.op === 'retitle') return `Renamed a chart to "${edit.title}"`;
  if (edit.op === 'chart_type') return `Redrawn as a ${edit.chart_type} chart`;
  if (edit.op === 'colorBy') return 'Dropped one colour per bar';
  if (edit.op === 'remove_kpi') return 'Removed a repeated card';
  if (edit.op === 'set_text') return 'Replaced a repeated recommendation with a pointer';
  if (edit.op === 'clear_text') return 'Removed a claim its own numbers did not support';
  if (edit.op === 'reorder') return 'Reordered the deck';
  return 'Edited';
}

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
        className="display mt-2 text-[26px] leading-snug text-white"
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

/** A section's fold control: a chevron that turns, and says what it folds. */

/**
 * One finding on the grid.
 *
 * The card is a link to the full write-up, which is exactly wrong while editing:
 * the first click into a text field would navigate away from the page. In edit
 * mode the same markup is wrapped in a plain div instead.
 */
function FindingCard({ slide, index, total, editing, filters, filterContext, onSelect, onClearFilter, onDelete, onEdit }) {
  /**
   * Can a click on this chart be turned into a filter?
   *
   * Only where the column behind the axis can be named — see `clickTarget`.
   * While editing, no: the card is a form then, and a click inside it is aimed
   * at a text field.
   */
  const target = editing ? null : clickTarget(slide.chart, filterContext);
  const layout = slideLayout(slide.size);
  // A filter tile is a control, not a claim. It still runs a query and still
  // gets a finding written about it — "Month-to-month leads contract types on
  // record count" — and that sentence under a row of checkboxes is the app
  // reading its own furniture back to the reader.
  const isSlicer = slide.chart?.chart_type === 'slicer';
  // A slicer shows every value it is keeping; a bar chart shows the one that
  // was clicked, so the others can be dimmed rather than listed.
  const kept = target?.kind === 'values' ? selectedValues(filters || [], target.column) : [];
  const picked = target?.multi ? kept : kept[0] ?? null;
  // The tile's share of the row travels as two custom properties; the class
  // decides which one this viewport can honour. See globals.css.
  const Wrapper = editing ? 'div' : Link;
  const wrapperProps = editing
    ? {
        'data-card': true,
        style: slideStyle(layout),
        className: 'card slide-tile relative flex flex-col overflow-hidden p-5',
      }
    : {
        'data-card': true,
        style: slideStyle(layout),
        href: `/insight/${slide.id || `slide_${index + 1}`}`,
        className:
          'group card slide-tile relative flex flex-col overflow-hidden p-5 transition-colors hover:border-accent-500/30 hover:bg-white/[0.035]',
      };

  return (
    <Wrapper {...wrapperProps}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="label flex flex-wrap items-center gap-2">
            {/* The reader gets the chart's name, not its internal id: the card
                used to read "hbar · 3 of 9". */}
            <span>
              {chartTypeLabel(slide.chart?.chart_type || 'bar')} · {index + 1} of {total}
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
              aria-label={`Edit the chart for ${slide.pageTitle}`}
              title="Change what this chart measures"
              className="flex h-11 w-11 items-center justify-center rounded-lg text-white/15 sm:h-auto sm:w-auto sm:p-1.5 transition-colors hover:bg-accent-500/10 hover:text-accent-300"
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
            className="flex h-11 w-11 items-center justify-center rounded-lg text-white/15 sm:h-auto sm:w-auto sm:p-1.5 transition-colors hover:bg-rose-500/10 hover:text-rose-400"
          >
            <Trash2 size={14} />
          </button>
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
      <div
        // `flex-none`: the card is a flex column, and a flex item's height is a
        // suggestion until it is told not to grow or shrink. Without it a
        // dragged height was ignored in favour of whatever the row's tallest
        // card had settled on.
        className="mt-4 flex-none"
        // A dragged height, so it is a number rather than a class. The
        // transition is what makes a drag feel like it is moving the edge
        // rather than redrawing the card at each step.
        style={{ height: layout.height, transition: 'height 120ms ease-out' }}
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

      {/* Sizing lives in edit mode with every other change to the deck. */}
      {editing && (
        <CardResizer
          layout={layout}
          label={slide.pageTitle || 'this finding'}
          onResize={(next) => onEdit({ size: next })}
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
