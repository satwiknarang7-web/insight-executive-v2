'use client';

/**
 * Session state for the whole app.
 *
 * Deliberately split into four contexts. Progress ticks fire many times a
 * second during ingestion; if they shared a context with the dataset and the
 * analysis, every tick would re-render every chart on screen. Separating them
 * means a progress bar update touches the progress bar and nothing else.
 *
 * The provider lives in the root layout, so client-side navigation between
 * /dashboard, /explore, /ask and /present keeps the whole session alive without
 * refetching or recomputing anything.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { modelHeaders } from '../geminiKey';
import { modelBriefing } from '../critic';
import { scepticBriefing } from '../validitySceptic';
import { argumentBriefing } from '../synthesiser';
import { claimsBriefing } from '../semanticClaims';
import { valuesBriefing } from '../valueBriefing';
import { editBriefing, acceptEdits, applyEdits, reorderStoryboard } from '../analystEdits';
import {
  reviewDeck,
  applyRepairs,
  rewriteTargets,
  fallbackRewrites,
  openQuestions,
  reviewClaims,
  applySceptic,
  scepticOpenQuestions,
} from '../deckRepair';
import { call } from './engineClient';
import { buildStoryboard } from '../storyboard';
import {
  updateSlide,
  removeSlide,
  createSlide,
  insertSlide,
  reapplyEdits,
  updateSummary,
  reapplySummaryEdits,
  updateKpi,
  removeKpi,
  addKpi,
  reapplyKpiEdits,
} from '../storyboardEdits';
import {
  buildKpiSql,
  readKpiValue,
  formatKpiValue,
  defaultKpiLabel,
  metricNeedsColumn,
} from '../kpiMetrics';
import { compileMeasure, measureSql, measureByDimensionSql, readMeasureValue, formatMeasureValue } from '../measures';
import { parseMeasurePhrase, uniqueMeasureName } from '../measureLanguage';
import { parseTransformPhrase } from '../transformLanguage';
import { formatOf } from '../ingest/formats';
import { acceptPreparation, acceptSteps, preparationBriefing, preparationFor, splitProposals } from '../preparation';
import { clearColumn, describeFilters, filterSql, filterWhere, toggleValue, validFilters } from '../filters';
import { applyFiltered, clearFiltered, specsFor } from '../filteredView';
import { deriveSteps } from '../derivedSteps';
import { idbDel, KEYS } from './idb';

const DatasetCtx = createContext(null);
const AnalysisCtx = createContext(null);
const ProgressCtx = createContext(null);
const ActionsCtx = createContext(null);
const MeasuresCtx = createContext(null);

export const useDataset = () => useContext(DatasetCtx);
export const useAnalysis = () => useContext(AnalysisCtx);
export const useProgress = () => useContext(ProgressCtx);
export const useActions = () => useContext(ActionsCtx);
/** The measures the user has defined, in definition order. */
export const useMeasures = () => useContext(MeasuresCtx);

/** Convenience: is there enough loaded to show the app chrome? */
export function useHasData() {
  const ds = useDataset();
  return !!ds?.dataset;
}

/**
 * How long the analysis will wait on a model before starting without it.
 *
 * Short on purpose. This is the only agent between the upload and the first
 * chart, and a reader watching the progress panel has no way to tell a slow
 * provider from a stuck engine.
 */
/**
 * Keep the argument A7 wrote when the narration pass rebuilds the summary.
 *
 * Both of them write `macroInsights`, and until this existed whichever landed
 * second won. They are not doing the same job: A7 builds a cited argument from
 * the findings as a set, and the narrator rephrases findings one at a time. A
 * rephrasing must not overwrite a case. Left unwritten, the summary is whatever
 * it already was.
 */
function withArgument(slideZero, bullets) {
  if (!slideZero || !bullets?.length) return slideZero;
  return { ...slideZero, macroInsights: bullets };
}

const SEMANTICS_DEADLINE_MS = 6000;

/**
 * How long the editing pass may hold the loading screen.
 *
 * Longer than the semantic one, because this runs at the end and its failure is
 * cheaper: no answer means the deck the deterministic audit already repaired,
 * which is a complete report. Nothing waits on this except the last two ticks
 * of the progress bar, and a provider that has gone slow must not be able to
 * hold a finished analysis hostage.
 */
const EDIT_DEADLINE_MS = 12000;

/**
 * How long the preparation pass may hold the loading screen.
 *
 * The longest of the three, because it is the one whose answer changes the
 * most: a margin column the charts can then use, a month the trend is drawn
 * over. It runs once per dataset, never on a re-run, and a provider that does
 * not answer in time means the table is analysed as it arrived — which is what
 * every analysis did until now.
 */
const PREPARE_DEADLINE_MS = 20000;

/** How many of the analyst's measures become cards, and charts, unasked. */
const PREPARED_CARDS = 3;
const PREPARED_CHARTS = 2;

/** Resolve to null rather than hang, whatever the promise does. */
function withDeadline(promise, ms) {
  return Promise.race([
    Promise.resolve(promise).catch(() => null),
    new Promise((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

const IDLE = { kind: null, stage: '', percent: 0, logs: [], steps: [] };

export function DatasetProvider({ children }) {
  const [dataset, setDataset] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  // The slice being looked at. Held beside the analysis rather than inside it
  // because it survives an edit to the deck and is what every filtered pass is
  // recomputed from.
  const [filters, setFilters] = useState([]);
  const [filtering, setFiltering] = useState(false);
  const [status, setStatus] = useState('booting'); // booting | empty | ingesting | ready | analyzing | analyzed
  const [error, setError] = useState(null);
  const [job, setJob] = useState(IDLE);
  const [narrating, setNarrating] = useState(false);
  const [measures, setMeasures] = useState([]);
  // What the analyst did to the table before analysing it, for this dataset.
  const [preparation, setPreparation] = useState(null);

  // Progress arrives faster than React can usefully paint. Buffer it and flush
  // on an animation frame so a 200k-row ingest doesn't queue 4,000 renders.
  const jobRef = useRef(IDLE);
  const rafRef = useRef(0);
  // Mirrors of state, so the edit callbacks below can stay referentially stable.
  const analysisRef = useRef(null);
  const filtersRef = useRef([]);
  const previousBoardRef = useRef(null);
  const previousSummaryRef = useRef(null);
  const previousKpisRef = useRef(null);
  // The order the editing agent put the deck in, if it ran. Held separately
  // because the narration pass rebuilds every slide from the planner's original
  // order: `reapplyEdits` carries a slide's own fields across that rebuild, but
  // a reordering is a property of the deck rather than of any slide in it, and
  // without this it would be undone a second or two after it happened.
  const analystOrderRef = useRef(null);
  // The argument as A7 wrote it. Held because the narration pass rebuilds the
  // summary from scratch and would otherwise overwrite it — two agents were
  // writing the same field, and the one that landed second won by accident.
  // Settled deliberately instead: A7 owns the executive summary, the narrator
  // owns the per-slide wording.
  const argumentRef = useRef(null);
  // Whether the reader asked for the rows the data marks void to be counted
  // anyway. False by default, because a total that includes cancellations is
  // not the quantity its name says it is — but it is their table and their
  // definition of revenue, and a decision stated without a way to change it is
  // just a decision made for somebody.
  const includeVoidRef = useRef(false);
  // Which dataset has had its preparation pass. Keyed on the ingest time, so a
  // re-run does not prepare twice and a new file is prepared afresh.
  const preparedForRef = useRef(null);
  /**
   * Which analysis the background passes are still allowed to write to.
   *
   * An analysis finishes in two stages: the deck is on screen, and then the
   * narrator, the critic, the sceptic and the synthesiser land a second or
   * two later. Each of those held a closure over the run that started it and
   * wrote straight into state, which is correct exactly while that run is
   * still the one being looked at.
   *
   * It often was not. Clicking a bar to filter within a second of the deck
   * appearing put a filtered analysis on screen; the narration then landed,
   * rebuilt every slide from its own unfiltered `result`, and dropped the
   * `filter` field — leaving the filter chip above unfiltered numbers. Re-run
   * during narration had the older run overwrite the newer deck.
   *
   * So anything that supersedes the analysis on screen bumps this, and every
   * background pass checks that the number it captured is still current before
   * writing. A superseded pass discards its work, which is the right outcome:
   * it is prose for a deck nobody is looking at any more.
   */
  const runRef = useRef(0);
  const datasetRef = useRef(null);
  const measuresRef = useRef([]);
  analysisRef.current = analysis;
  filtersRef.current = filters;
  datasetRef.current = dataset;
  measuresRef.current = measures;
  /** Retire whatever the background passes are still holding. */
  const supersede = useCallback(() => ++runRef.current, []);
  const flush = useCallback(() => {
    rafRef.current = 0;
    setJob(jobRef.current);
  }, []);
  const pushProgress = useCallback(
    (kind, { stage, percent, log, steps }) => {
      const prev = jobRef.current;
      jobRef.current = {
        kind,
        stage: stage ?? prev.stage,
        percent: percent ?? prev.percent,
        logs: log ? [...prev.logs, log].slice(-60) : prev.logs,
        // The plan arrives once, in its own message, before the first stage.
        steps: steps ?? prev.steps,
      };
      if (!rafRef.current) rafRef.current = requestAnimationFrame(flush);
    },
    [flush]
  );
  const resetProgress = useCallback((kind) => {
    jobRef.current = { kind, stage: '', percent: 0, logs: [], steps: [] };
    setJob(jobRef.current);
  }, []);
  const endProgress = useCallback(() => {
    jobRef.current = IDLE;
    setJob(IDLE);
  }, []);

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  // Rehydrate a previous session from IndexedDB on first mount.
  useEffect(() => {
    let cancelled = false;
    call('restore')
      .then((res) => {
        if (cancelled) return;
        if (res?.dataset) {
          setDataset(res.dataset);
          if (res.analysis?.storyboard?.length) {
            setAnalysis(res.analysis);
            setStatus('analyzed');
          } else {
            setStatus('ready');
          }
        } else {
          setStatus('empty');
        }
      })
      .catch(() => !cancelled && setStatus('empty'));
    return () => {
      cancelled = true;
    };
  }, []);

  // Measures live for as long as the session does.
  //
  // They are held apart from the analysis so that re-running the dashboard —
  // which replaces every slide — leaves the calculations the user defined by
  // hand untouched. They are not held across a reload, because a measure is
  // written against the columns of one dataset and that dataset is gone: a
  // formula referring to columns nothing has loaded is not a saved calculation,
  // it is a broken one.
  useEffect(() => {
    idbDel(KEYS.measures).catch(() => {});
  }, []);

  // ---- actions -----------------------------------------------------------

  const ingest = useCallback(
    async ({ files, file, text, fileName }) => {
      setError(null);
      supersede();
      setAnalysis(null);
      setStatus('ingesting');
      resetProgress('ingest');
      try {
        const summary = await call(
          'ingest',
          { files, file, text, fileName },
          { onProgress: (p) => pushProgress('ingest', p) }
        );
        setDataset(summary);
        setStatus('ready');
        endProgress();
        return summary;
      } catch (e) {
        setError(e.message);
        setStatus('empty');
        endProgress();
        throw e;
      }
    },
    [pushProgress, resetProgress, endProgress, supersede]
  );

  /**
   * Accepts a single file or several at once. Several files are ingested as one
   * session — each becomes a table and the engine looks for keys between them,
   * exactly as it does for the tabs of one workbook.
   */
  const ingestFile = useCallback(
    (input) => {
      const files = input ? (input.length !== undefined && !input.name ? Array.from(input) : [input]) : [];
      if (files.length === 0) return Promise.reject(new Error('No file provided.'));

      // A photo or a PDF has its own path (ingestDocument); everything else the
      // worker reads. The list is the catalog's, so a format added there is
      // accepted here.
      const unsupported = files.filter((f) => formatOf(f.name || '', f.type) === 'document');
      if (unsupported.length) {
        const msg = `${unsupported.map((f) => f.name).join(', ')} — a document is read through the PDF or photo source, on a model key.`;
        setError(msg);
        return Promise.reject(new Error(msg));
      }
      return ingest({ files, fileName: files[0].name });
    },
    [ingest]
  );

  const ingestText = useCallback((text, fileName) => ingest({ text, fileName }), [ingest]);

  /**
   * Load a file from a link.
   *
   * The server fetches the bytes — a browser cannot read another origin's
   * CSV — and hands them back untouched; from there it is a dropped file.
   * The name comes back in a header, because the name is what tells the
   * parser what the bytes are.
   */
  const ingestUrl = useCallback(
    async ({ url, kind = 'url', headers = {} }) => {
      setError(null);
      const res = await fetch('/api/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, kind, headers }),
      });
      if (!res.ok) {
        let message = 'That link could not be read.';
        try {
          message = (await res.json()).error || message;
        } catch {
          /* not JSON */
        }
        setError(message);
        throw new Error(message);
      }
      const name = decodeURIComponent(res.headers.get('x-insight-file-name') || 'download.csv');
      const blob = await res.blob();
      const file = new File([blob], name, { type: blob.type });
      return ingestFile([file]);
    },
    [ingestFile]
  );

  /**
   * Replace the list of transforms and rebuild the view on top of it.
   *
   * The whole list every time. Transforms refer to each other — a derive
   * written against a renamed column, a filter over a derived one — so there is
   * no applying one in isolation, and the engine says the same thing from the
   * other side.
   *
   * Any analysis on screen is dropped. It was computed over the old shape, and
   * a deck describing columns that no longer exist is worse than no deck.
   */
  /**
   * Apply shaping steps to the table.
   *
   * `supersedesAnalysis` is the difference between somebody changing the shape
   * of the data and an analysis changing it on its own way past. A step added
   * in Explore retires whatever is on screen, because it was computed against
   * columns that no longer describe the table. The preparation pass inside
   * `analyze` is the same call for the opposite reason: that run applied these
   * steps itself and is still going, so retiring it there means the analysis
   * cancels itself half way through and the dashboard keeps saying nothing has
   * been analysed.
   */
  const setTransforms = useCallback(
    async (transforms, { supersedesAnalysis = true } = {}) => {
      setError(null);
      try {
        const summary = await call('setTransforms', { transforms });
        setDataset(summary);
        // The ref follows at once rather than at the next render: the analysis
        // that applied these steps carries on in the same tick and has to see
        // the columns they made.
        datasetRef.current = summary;
        if (supersedesAnalysis) supersede();
        setAnalysis(null);
        setStatus('ingested');
        return summary;
      } catch (e) {
        setError(e.message);
        throw e;
      }
    },
    [supersede]
  );

  /**
   * Read a table out of a photograph or a PDF, then load it like any other.
   *
   * The extraction is the only step that is different. What comes back is rows
   * and a list of cells the model was unsure of, and both go down the same path
   * a connected database takes — cleaned, profiled, joined and analysed by code
   * that has no idea the numbers were once handwriting.
   */
  /**
   * Read tables out of photographs and PDFs — several at once — without
   * loading anything.
   *
   * Extraction and ingestion were one movement: a document went in and a
   * dataset came out, and the one thing a reader needed to do in between was
   * check it. A model reading a photograph of a table is right most of the
   * time, and "most of the time" is not a basis for a total, so the two are
   * separate now. This returns what was read; `ingestExtracted` below loads
   * what the reader has since corrected.
   *
   * One request per document rather than one for all of them. Each is a vision
   * call billed to the reader's own key, and a batch would spend four before
   * anyone has seen whether the first came back sensibly — so a failure part
   * way through keeps what already worked and says which one did not.
   */
  const extractDocuments = useCallback(async (files, onEach) => {
    const list = Array.from(files || []);
    if (!list.length) throw new Error('No document provided.');

    const tables = [];
    const failed = [];
    for (const [index, file] of list.entries()) {
      onEach?.({ at: index, of: list.length, fileName: file.name, stage: 'reading' });
      try {
        const form = new FormData();
        form.append('file', file);
        const response = await fetch('/api/extract', { method: 'POST', headers: modelHeaders(), body: form });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body?.error || 'That document could not be read.');
        const table = body.table;
        if (!table?.rows?.length) throw new Error('No table could be read in it.');
        tables.push({
          id: `doc_${index}_${Date.now().toString(36)}`,
          fileName: file.name || `Document ${index + 1}`,
          label: table.label || file.name || `Document ${index + 1}`,
          columns: table.columns,
          rows: table.rows,
          // Which cells the model said it was unsure of, as a set of
          // "row:column" keys — the shape the review grid highlights by, and
          // the shape a corrected cell is removed from.
          uncertain: new Set((table.uncertain || []).map((c) => `${c.row}:${c.column}`)),
        });
      } catch (e) {
        failed.push({ fileName: file.name, reason: e.message });
      }
    }

    if (!tables.length) {
      throw new Error(failed[0]?.reason || 'Nothing could be read from those documents.');
    }
    return { tables, failed };
  }, []);

  /**
   * Load what the reader corrected.
   *
   * Each document is a table, related to the others exactly as the sheets of
   * one workbook are — so four photographed pages of the same report arrive as
   * four tables with the keys between them already found.
   */
  const ingestExtracted = useCallback(
    async (tables, { sourceLabel = 'Documents' } = {}) => {
      setError(null);
      supersede();
      setAnalysis(null);
      setStatus('ingesting');
      resetProgress('ingest');
      try {
        const summary = await call(
          'ingestRemote',
          {
            tables: tables.map((t) => ({
              label: t.label,
              columns: t.columns,
              rows: t.rows,
              // Only the cells still marked unsure. A cell the reader typed
              // over is a cell they have vouched for, and carrying the doubt
              // forward would cap a finding on evidence that no longer exists.
              uncertain: [...(t.uncertain || [])].map((key) => {
                const at = String(key).indexOf(':');
                return { row: Number(String(key).slice(0, at)), column: String(key).slice(at + 1) };
              }),
            })),
            sourceLabel: tables.length === 1 ? tables[0].label : sourceLabel,
          },
          { onProgress: (p) => pushProgress('ingest', p) }
        );
        setDataset(summary);
        datasetRef.current = summary;
        setStatus('ingested');
        endProgress();
        return summary;
      } catch (e) {
        setError(e.message);
        setStatus('idle');
        endProgress();
        throw e;
      }
    },
    [pushProgress, resetProgress, endProgress, supersede]
  );

  /**
   * Load tables pulled from a connected database.
   *
   * The rows have already crossed the network by the time they get here; from
   * this point they follow exactly the same path as a workbook's sheets, so
   * relationship inference and the joined view apply unchanged.
   */
  const ingestRemote = useCallback(
    async ({ tables, sourceLabel, factTable = null }) => {
      setError(null);
      supersede();
      setAnalysis(null);
      setStatus('ingesting');
      resetProgress('ingest');
      try {
        const summary = await call(
          'ingestRemote',
          { tables, sourceLabel, factTable },
          { onProgress: (p) => pushProgress('ingest', p) }
        );
        setDataset(summary);
        setStatus('ready');
        endProgress();
        return summary;
      } catch (e) {
        setError(e.message);
        setStatus('empty');
        endProgress();
        throw e;
      }
    },
    [pushProgress, resetProgress, endProgress, supersede]
  );

  /**
   * Run the analysis. Charts and verified numbers are computed locally and shown
   * immediately; the LLM narrative is fetched afterwards and merged in when it
   * lands, so the dashboard is never blocked on a network round trip.
   */
  /**
   * Start an empty dashboard and let the person fill it.
   *
   * The other half of the choice a dataset offers: the analyst builds it, or
   * you do. Nothing is profiled, nothing is scored, and no request leaves the
   * browser — the dashboard renders its own add-a-chart and add-a-KPI controls
   * over an empty storyboard, which is a state it already had to handle for
   * anyone who deleted every finding.
   */
  const startBlank = useCallback(() => {
    setError(null);
    supersede();
    setAnalysis({
      storyboard: [],
      kpis: [],
      // A whole summary, empty rather than absent. The dashboard's invariant is
      // that an analysis has one — a dozen places read `slideZero.title` and
      // `slideZero.strategicScorecard.focus` straight through — and a blank
      // dashboard that quietly broke that invariant would be handing every one
      // of those readers a null. Empty strings render as nothing and are
      // writable the moment someone edits the summary.
      slideZero: {
        title: 'Executive Summary',
        headline: '',
        connections: [],
        caveats: [],
        macroInsights: [],
        strategicScorecard: { focus: '', risk: '', opportunity: '' },
      },
      critique: [],
      analystEdits: [],
    });
    setStatus('analyzed');
  }, [supersede]);

  /**
   * Save measures the analyst wrote, without a form.
   *
   * The same validation `saveMeasure` does, against the columns loaded right
   * now — a measure the model wrote over a column its own step created only
   * compiles once that step has run. Defined here rather than reusing
   * `saveMeasure` because `analyze` below needs it and is declared first.
   */
  const adoptMeasures = useCallback((list) => {
    const saved = [];
    let known = measuresRef.current;
    for (const draft of list || []) {
      const measure = {
        ...draft,
        id: `ms_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        createdAt: Date.now(),
        editedAt: Date.now(),
      };
      const compiled = compileMeasure(measure, {
        columns: datasetRef.current?.columns || [],
        profile: datasetRef.current?.profile || null,
        measures: known,
      });
      if (!compiled.ok) continue;
      known = [...known, measure];
      saved.push(measure);
    }
    if (saved.length) {
      measuresRef.current = known;
      setMeasures(known);
    }
    return saved;
  }, []);

  /**
   * Ask the analyst what it would do to this table before charting it.
   *
   * Returns the proposal, checked: steps that plan against the real columns in
   * the order given, measures that compile over the columns those steps leave.
   * Nothing is applied here — the panel shows a proposal and lets a person
   * accept it, and `analyze` applies the safe part of one on its own.
   */
  const suggestPreparation = useCallback(async ({ focus = null } = {}) => {
    const current = datasetRef.current;
    if (!current?.columns?.length) throw new Error('Load some data first.');
    const briefing = preparationBriefing({
      vocabulary: current.vocabulary || null,
      profile: current.profile || null,
      columns: current.columns,
      transforms: current.transforms || [],
      measures: measuresRef.current,
      fileName: current.fileName,
      rowCount: current.rowCount,
    });
    const res = await fetch('/api/prepare', {
      method: 'POST',
      headers: modelHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ ...briefing, columnNames: current.columns, focus }),
    });
    const body = res.ok ? await res.json() : null;
    if (!body || body.unavailable) return null;
    // Checked again here, against the columns actually loaded. The route is the
    // gatekeeper; this is the point of application.
    return acceptPreparation(body, { columns: current.columns, measures: measuresRef.current, prefix: 'ai' });
  }, []);

  /**
   * Put a proposal into effect: the steps that only add a column, and the
   * measures. The rest is kept as a suggestion for Explore to show.
   *
   * A step that planned but would not execute leaves nothing applied and the
   * whole list suggested, with the engine's reason attached — the analysis
   * then runs over the table as it was, which is never wrong, only less.
   */
  const applyPreparation = useCallback(
    async (proposal, { supersedesAnalysis = true } = {}) => {
      const { automatic, suggested } = splitProposals(proposal?.steps || []);
      let applied = [];
      let leftover = suggested;
      let failure = null;
      // Steps the worker refused once it could see the rows. A ratio between
      // two columns that have nothing to do with each other is well-formed and
      // meaningless, and only the rows can tell the difference.
      let refused = [];
      if (automatic.length) {
        try {
          const summary = await setTransforms([...(datasetRef.current?.transforms || []), ...automatic], {
            supersedesAnalysis,
          });
          refused = summary?.unsupported || [];
          // What was actually applied, not what was sent. Reporting the
          // proposal as applied would put a column in the cleaning report that
          // is not in the table.
          const dropped = new Set(refused.map((r) => r.proposal?.id).filter(Boolean));
          applied = dropped.size ? automatic.filter((step) => !dropped.has(step.id)) : automatic;
        } catch (e) {
          failure = e.message;
          leftover = [...automatic, ...suggested];
        }
      }
      const saved = adoptMeasures(proposal?.measures || []);
      const record = {
        at: datasetRef.current?.ingestedAt,
        summary: proposal?.summary || '',
        applied,
        suggested: leftover,
        measures: saved,
        // Everything that was proposed and not done, whether the column list
        // refused it or the rows did, in one list because a reader does not
        // care which check caught it.
        skipped: [...(proposal?.skipped || []), ...refused],
        failure,
      };
      setPreparation(record);
      return record;
    },
    [setTransforms, adoptMeasures]
  );

  /**
   * The analyst's measures, on the dashboard from the first paint.
   *
   * A card each, computed by the same query a pinned measure runs; and for the
   * ones the analyst said which column to break out by, a chart through the
   * same path the measures panel uses — so the finding under it is verified
   * like any other slide's. Capped, because a deck is read and not scrolled.
   */
  const preparedExtras = useCallback(async (list, storyboard) => {
    const context = {
      columns: datasetRef.current?.columns || [],
      profile: datasetRef.current?.profile || null,
      measures: measuresRef.current,
    };
    const kpis = [];
    for (const measure of list.slice(0, PREPARED_CARDS)) {
      try {
        const { sql } = measureSql(measure, context);
        if (!sql) continue;
        const { rows } = await call('sql', { query: sql });
        const value = readMeasureValue(rows);
        if (value === null) continue;
        kpis.push({
          label: measure.name,
          value: formatMeasureValue(value, measure.format),
          custom: true,
          source: { measureId: measure.id },
          autoLabel: true,
          prepared: true,
        });
      } catch {
        /* a card that cannot be computed is a card that is not shown */
      }
    }
    let board = storyboard;
    for (const measure of list.filter((m) => m.by).slice(0, PREPARED_CHARTS)) {
      try {
        const built = measureByDimensionSql(measure, { dimension: measure.by, limit: 10 }, context);
        if (built.error) continue;
        const spec = {
          sql: built.sql,
          chart_type: 'bar',
          xAxisKey: built.xAxisKey,
          yAxisKey: built.yAxisKey,
          title: `${measure.name} by ${String(measure.by).replace(/_/g, ' ')}`,
        };
        const { chart, finding } = await call('ask', { spec });
        if (!chart?.resultData?.length || chart.resultData.length < 2) continue;
        const slide = createSlide({ storyboard: board, chart, finding, title: spec.title, notes: measure.explanation || '' });
        board = insertSlide(board, { ...slide, prepared: true });
      } catch {
        /* likewise */
      }
    }
    return { kpis, storyboard: board };
  }, []);

  const analyze = useCallback(
    async ({ focus = null, maxCharts = null, includeVoid = includeVoidRef.current, prepare = true } = {}) => {
      includeVoidRef.current = includeVoid;
      // This run owns the analysis from here on, and the passes of any earlier
      // one stop being allowed to write.
      const run = supersede();
      const current = () => runRef.current === run;
      setError(null);
      setStatus('analyzing');
      resetProgress('analyze');
      previousBoardRef.current = analysisRef.current?.storyboard || null;
      previousSummaryRef.current = analysisRef.current?.slideZero || null;
      previousKpisRef.current = analysisRef.current?.kpis || null;
      // A re-run gets a fresh opinion, not the last one's.
      analystOrderRef.current = null;
      argumentRef.current = null;
      try {
        /**
         * First, the ten minutes an analyst spends before opening the chart
         * menu.
         *
         * Once per dataset, and only on a table nobody has shaped yet: a list
         * of steps somebody wrote is their decision about the data, and the
         * app's should not be appended to it unasked. The part that only ADDS
         * columns goes into effect now, so the planner below sees the margin
         * and the month; the part that would remove or change anything is
         * offered in Explore with its reason. The measures are saved and go on
         * the dashboard as cards.
         *
         * Two sources, one path. `deriveSteps` reads the vocabulary the worker
         * already computed and proposes what the values justify — a month out
         * of a daily date, a compound field split, a continuous number banded —
         * and needs no provider, which matters because this deployment holds no
         * key of its own: without it a report on a browser with no key saved
         * got measures and never a single step, which looks like an opinion
         * rather than an absence. The model, when there is one, reads the same
         * vocabulary and adds what a rule cannot see.
         *
         * On the critical path, because a column added afterwards is a column
         * no chart used. Deadlined, because a slow provider must not hold a
         * finished analysis hostage, and the table as it arrived is a fine
         * thing to analyse.
         */
        let prepared = null;
        const loaded = datasetRef.current;
        const unshaped = !(loaded?.transforms || []).length;
        if (prepare && loaded && unshaped && preparedForRef.current !== loaded.ingestedAt) {
          preparedForRef.current = loaded.ingestedAt;
          pushProgress('analyze', { stage: 'Preparing the data', percent: 2 });
          const fromModel = await withDeadline(suggestPreparation({ focus }), PREPARE_DEADLINE_MS);
          const proposal = preparationFor(fromModel, {
            columns: loaded.columns || [],
            measures: measuresRef.current,
            derived: deriveSteps({
              columns: loaded.columns || [],
              profile: loaded.profile || null,
              vocabulary: loaded.vocabulary || null,
            }),
          });
          if (proposal.steps.length || proposal.measures.length) {
            // This run's own doing, so it does not count as something newer
            // taking the analysis over.
            prepared = await applyPreparation(proposal, { supersedesAnalysis: false });
          }
        }

        /**
         * The one model call that has to happen BEFORE the charts.
         *
         * It decides which columns may be summed, so it cannot be a background
         * pass like the critic and the narrator — by the time they run, the
         * sums have been done. That puts it on the critical path, so it gets a
         * deadline and nothing more: no answer inside it, or no provider at
         * all, and the analysis proceeds on the unit lexicon alone, which is
         * what every analysis ran on until now.
         */
        const profile = datasetRef.current?.profile || null;
        // What each column actually holds, not just what it is called. A model
        // shown only names can guess that `Order_Status` is a status; it cannot
        // know that `Bestellstatus` holds `Storniert` and `Retoure`, and no
        // lexicon written here ever will. The values are the evidence.
        const values = datasetRef.current?.vocabulary
          ? valuesBriefing({ vocabulary: datasetRef.current.vocabulary, profile })
          : claimsBriefing({ profile });

        const semantics = await withDeadline(
          fetch('/api/semantics', {
            method: 'POST',
            headers: modelHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ ...values, detected: {} }),
          })
            .then((r) => (r.ok ? r.json() : null))
            .then((body) => body || null),
          SEMANTICS_DEADLINE_MS
        );
        const claims = semantics?.claims || null;
        // Which values mean the row did not stand. On the critical path for the
        // same reason as the unit claims and with more at stake: it decides
        // which ROWS are summed, and every figure in the deck inherits it.
        const voidClaim = semantics?.voidClaim || null;

        /**
         * And what the dataset is ABOUT, checked against the rows before it can
         * steer anything.
         *
         * The route asked; it could not verify, because the rows are here and
         * not there. `acceptBrief` is the gate: it drops a claim naming a column
         * that does not exist, one whose values are not the shape the model
         * said, an outcome another column determines, and a "driver" that does
         * not move the outcome in these rows. What survives is a set of facts
         * about this table.
         *
         * Done in the worker rather than here, because the gate needs the rows
         * and the rows are the one thing this component does not hold — the
         * engine worker owns the dataset. `analyze` runs it before planning.
         */
        const briefProposal = semantics?.brief || null;

        const result = await call(
          'analyze',
          { focus, maxCharts, claims, voidClaim, includeVoid, briefProposal },
          { onProgress: (p) => pushProgress('analyze', p) }
        );

        const base = buildStoryboard({
          charts: result.charts,
          perChart: result.perChart,
          synthesis: result.synthesis,
          narrative: null,
        });
        // A re-run rebuilds every slide from scratch. Carrying the user's saved
        // edits across is what stops Re-run from quietly undoing their work.
        const local = {
          ...base,
          storyboard: reapplyEdits(base.storyboard, previousBoardRef.current),
          slideZero: reapplySummaryEdits(base.slideZero, previousSummaryRef.current),
          kpis: reapplyKpiEdits(result.kpis, previousKpisRef.current),
          generatedAt: Date.now(),
          focus,
          narrated: false,
          // Questions about the deck, not findings in it. Carried alongside so
          // the dashboard can show what the analysis did not reach.
          critique: result.critique || [],
          // Filled in by the editing pass below, if a provider answers.
          analystEdits: [],
        };
        /**
         * Read the deck back before anybody sees it.
         *
         * This used to run after first paint, which meant the customer met the
         * report and its defects at the same moment and was invited to hold
         * both in mind. A donut of two slices, a heading clipped mid-word, the
         * same figure on two cards: none of those make a number wrong and all
         * of them are what a report is judged on in its first ten seconds.
         *
         * The deterministic audit goes first and needs no provider — it finds
         * what is measurable and fixes what is mechanical, through the same
         * whitelist a person edits through. Then A2 is asked for the half a
         * rule cannot do: a shorter heading that means the same thing, a chart
         * type better suited to the shape, an order that leads with the
         * broadest finding. It is handed the audit's targets so it repairs the
         * defects rather than roaming a report that was largely fine.
         *
         * With no provider the fallback rewrite runs instead, which only ever
         * removes words that carry nothing. Either way the deck that paints is
         * the repaired one.
         */
        pushProgress('analyze', { stage: 'Checking how it reads', percent: 92 });
        const audit = reviewDeck({
          storyboard: local.storyboard,
          kpis: local.kpis,
          profile: datasetRef.current?.profile || null,
        });
        const repaired = applyRepairs({ storyboard: local.storyboard, kpis: local.kpis, audit });

        /**
         * And read what it SAYS against what it computed.
         *
         * The audit above asks whether the deck is legible. This asks whether
         * it is honest: a sentence that names a cause nothing here measured, a
         * share of the shown rows quoted as a share of the business, a
         * recommendation pointing work away from the outlier its own metrics
         * found. What it can fix, it clears — never rewrites, because writing a
         * better sentence would mean knowing what is true. The rest becomes a
         * question.
         *
         * It runs again after the narrator lands, because prose is exactly
         * where a claim grows.
         */
        const doubts = [
          ...reviewClaims({
            findings: result.perChart,
            storyboard: repaired.storyboard,
            slideZero: local.slideZero,
            rowCount: datasetRef.current?.profile?.rowCount || datasetRef.current?.rowCount || 0,
          }),
          // A7's half of the same job: a finding that says what another finding
          // already said, and an instruction printed twice. Both are cleared
          // through the same path, because both are removals.
          ...(result.duplicates || []),
        ];
        const cleaned = applySceptic({ storyboard: repaired.storyboard, items: doubts });

        pushProgress('analyze', { stage: 'Applying the fixes', percent: 96 });
        const briefing = editBriefing({
          storyboard: cleaned.storyboard,
          profile: datasetRef.current?.profile || null,
          targets: rewriteTargets(audit),
        });
        const proposed = await withDeadline(
          fetch('/api/analyst', {
            method: 'POST',
            headers: modelHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ ...briefing, profile: datasetRef.current?.profile || null }),
          })
            .then((r) => (r.ok ? r.json() : null))
            .then((body) => body?.edits || null),
          EDIT_DEADLINE_MS
        );

        // Checked again here, against the same briefing, even though the route
        // already checked. The route is the gatekeeper; this is the point of
        // application, and an operation that edits the customer's deck should
        // not be one component's correctness away from landing.
        const ops = acceptEdits(proposed, {
          slides: briefing.slides,
          profile: datasetRef.current?.profile || null,
        });
        // The model's rewrite is better than the mechanical one, so the floor
        // only covers the headings it did not reach.
        const rewritten = new Set(ops.filter((o) => o.op === 'retitle').map((o) => o.id));
        const floor = fallbackRewrites(audit, cleaned.storyboard).filter((o) => !rewritten.has(o.id));
        const allOps = [...repaired.applied, ...cleaned.applied, ...ops, ...floor];
        analystOrderRef.current = ops.find((o) => o.op === 'reorder')?.order || null;

        const finished = {
          ...local,
          storyboard: applyEdits(cleaned.storyboard, [...ops, ...floor]),
          kpis: repaired.kpis,
          // What could not be fixed joins the critic's list rather than forming
          // one of its own: a reader should not have to learn which internal
          // pass noticed a thing.
          critique: [...(local.critique || []), ...openQuestions(audit), ...scepticOpenQuestions(doubts)],
          analystEdits: allOps,
        };

        // The analyst's own numbers join the deck before anyone sees it, so
        // the first paint is the finished one rather than one that fills in.
        if (prepared?.measures?.length) {
          const extras = await preparedExtras(prepared.measures, finished.storyboard);
          finished.kpis = [...(finished.kpis || []), ...extras.kpis];
          finished.storyboard = extras.storyboard;
        }

        pushProgress('analyze', { stage: 'Ready', percent: 100 });
        // Superseded while this run was in the model calls above — a filter, or
        // a newer run. The deck is stale, so it is not painted and not saved;
        // the status and the progress panel are cleared either way, because
        // this run is what put them up and nothing else will take them down.
        const own = current();
        if (own) {
          setAnalysis(finished);
          call('saveAnalysis', finished).catch(() => {});
        }
        setStatus('analyzed');
        endProgress();
        // Nothing below would be allowed to write its result, so it is four
        // model calls nobody will read. They are not started.
        if (!own) return finished;

        /**
         * Background review pass: what else an analyst would ask.
         *
         * Unlike the repair above, this one stays off the critical path. It
         * adds questions to a report that is already complete and correct, and
         * a question arriving a second late costs nothing — where a defect
         * arriving a second late has already been seen.
         */
        fetch('/api/critique', {
          method: 'POST',
          headers: modelHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(
            modelBriefing({
              profile: datasetRef.current?.profile || null,
              findings: result.perChart,
              questions: finished.critique || [],
            })
          ),
        })
          .then((r) => (r.ok ? r.json() : null))
          .then((body) => {
            if (!current()) return;
            const extra = Array.isArray(body?.questions) ? body.questions : [];
            if (!extra.length) return;
            setAnalysis((prev) =>
              prev ? { ...prev, critique: [...(prev.critique || []), ...extra] } : prev
            );
          })
          .catch(() => {});

        /**
         * Background doubt pass: what a statistician would question.
         *
         * Off the critical path like the critic, and for the same reason: it
         * widens a list of open questions on a report that is already complete.
         * The overclaims a rule can catch have already been cleared or
         * disclosed; this is for the ones about shape — a rate compared across
         * groups of wildly different sizes, an average standing in for a skewed
         * distribution — which is judgement rather than pattern matching.
         *
         * Shown the shape of each claim and none of its numbers, so it has no
         * figure it could quote back.
         */
        fetch('/api/sceptic', {
          method: 'POST',
          headers: modelHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            ...scepticBriefing({
              findings: result.perChart,
              profile: datasetRef.current?.profile || null,
            }),
            alreadyAsked: (finished.critique || []).map((q) => q.question),
          }),
        })
          .then((r) => (r.ok ? r.json() : null))
          .then((body) => {
            if (!current()) return;
            const extra = Array.isArray(body?.questions) ? body.questions : [];
            if (!extra.length) return;
            setAnalysis((prev) =>
              prev ? { ...prev, critique: [...(prev.critique || []), ...extra] } : prev
            );
          })
          .catch(() => {});

        /**
         * Background write-up of the argument.
         *
         * The spine is already on screen — deterministic, cited, and a complete
         * case on its own. This asks a model to write it as prose a senior
         * reader would take seriously, and it is the one call in this codebase
         * that is shown figures. So the check inverts: every number it writes
         * must already appear in the facts of the step it cited, which the
         * route enforces before anything comes back.
         *
         * Sharing the background slot with the narration rather than taking a
         * round trip of its own, because the loading screen already carries the
         * audit, the sceptic and the editing pass, and a deterministic argument
         * that is right is worth more than a well-written one that is late.
         */
        if (result.synthesis?.argument?.length) {
          fetch('/api/synthesise', {
            method: 'POST',
            headers: modelHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify(
              argumentBriefing({ steps: result.synthesis.argument, findings: result.perChart })
            ),
          })
            .then((r) => (r.ok ? r.json() : null))
            .then((body) => {
              if (!current()) return;
              const lines = Array.isArray(body?.lines) ? body.lines : [];
              if (!lines.length) return;
              setAnalysis((prev) => {
                if (!prev?.slideZero) return prev;
                // The written argument replaces the bullets, in step order. A
                // step the model skipped keeps the spine's own sentence, so the
                // case never loses a link it was built with.
                const written = new Map(lines.map((l) => [l.step, l.text]));
                const bullets = result.synthesis.argument.map((s, i) => written.get(i + 1) || s.text);
                argumentRef.current = bullets;
                return { ...prev, slideZero: { ...prev.slideZero, macroInsights: bullets } };
              });
            })
            .catch(() => {});
        }

        // Background narrative pass.
        setNarrating(true);
        fetch('/api/narrate', {
          method: 'POST',
          headers: modelHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(result.narrationRequest),
        })
          .then((r) => (r.ok ? r.json() : null))
          .then((narrative) => {
            // This pass rebuilds every slide from its own run's `result`, so
            // landing late would not merely add a stale sentence — it would
            // replace the deck on screen, filter and all.
            if (!current()) return;
            if (!narrative || narrative.unavailable) return;
            const merged = buildStoryboard({
              charts: result.charts,
              perChart: result.perChart,
              synthesis: result.synthesis,
              narrative,
            });
            const live = analysisRef.current;
            const board = reorderStoryboard(
              reapplyEdits(merged.storyboard, live?.storyboard || previousBoardRef.current),
              analystOrderRef.current || []
            );

            /**
             * The sceptic runs again, on the narrator's words.
             *
             * This is the pass that matters most, and the one the first version
             * of the loop did not have. The engine's prose is written from the
             * statistics and stays inside them; the narrator's is written to
             * read well, and a claim grows in exactly that step. A flat line
             * became "current efforts are not moving the needle" — a statement
             * about effort, from a table with no column about effort, in a
             * sentence nothing had checked because the checking had already
             * happened.
             */
            const narratedDoubts = reviewClaims({
              findings: result.perChart,
              storyboard: board,
              slideZero: withArgument(merged.slideZero, argumentRef.current),
              rowCount: datasetRef.current?.profile?.rowCount || datasetRef.current?.rowCount || 0,
            });
            const settled = applySceptic({ storyboard: board, items: narratedDoubts });
            const asked = new Set((live?.critique || []).map((q) => String(q?.question)));

            const next = {
              ...merged,
              storyboard: settled.storyboard,
              slideZero: withArgument(
                reapplySummaryEdits(merged.slideZero, live?.slideZero || previousSummaryRef.current),
                argumentRef.current
              ),
              kpis: reapplyKpiEdits(result.kpis, live?.kpis || previousKpisRef.current),
              generatedAt: Date.now(),
              focus,
              // Carried across the narration pass. The model rephrases findings;
              // it does not re-examine the deck, so the questions the critic
              // raised about it are just as true afterwards — and rebuilding
              // the analysis without them silently dropped the panel a second
              // or two after it appeared.
              // The live list, not the engine's: the audit's disclosures and
              // anything the background critic added were merged onto it after
              // the deck was built, and rebuilding from `result` alone drops
              // both a second or two after they appeared.
              critique: [
                ...(live?.critique || result.critique || []),
                ...scepticOpenQuestions(narratedDoubts).filter((q) => !asked.has(String(q.question))),
              ],
              // Same reason: the narration rephrases findings, it does not
              // re-edit the deck, so what the editing pass changed stands —
              // plus whatever the sceptic had to clear out of the new wording.
              analystEdits: [...(live?.analystEdits || []), ...settled.applied],
              narrated: true,
            };
            setAnalysis(next);
            call('saveAnalysis', next).catch(() => {});
          })
          .catch(() => {})
          .finally(() => setNarrating(false));

        return finished;
      } catch (e) {
        setError(e.message);
        setStatus('ready');
        endProgress();
        throw e;
      }
    },
    [pushProgress, resetProgress, endProgress, suggestPreparation, applyPreparation, preparedExtras, supersede]
  );

  /**
   * Turn a sentence into one or more shaping steps, without applying them.
   *
   * The deterministic parser first — instant, no key, exactly right when it
   * recognises the phrase. Only when it does not does this reach for the model,
   * and whatever comes back is planned here against the columns the caller is
   * writing against (the staged list, not the applied one) before it is handed
   * back as something that could be added.
   */
  const draftTransform = useCallback(async (phrase, { columns = null } = {}) => {
    const against = columns || datasetRef.current?.columns || [];
    if (!against.length) throw new Error('Load some data first.');

    const local = parseTransformPhrase(phrase, { columns: against });
    if (local.ok) return local.steps.map((s) => ({ ...s, source: 'phrase' }));

    let json = null;
    try {
      const res = await fetch('/api/transform', {
        method: 'POST',
        headers: modelHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          phrase,
          columns: against,
          sample: (datasetRef.current?.preview || []).slice(0, 5),
          existingSteps: (datasetRef.current?.transformSteps || []).map((s) => s.describe),
        }),
      });
      json = await res.json();
    } catch {
      /* offline, or no provider — the parser's own reason is the better one */
    }
    if (!json || json.unavailable || !Array.isArray(json.steps)) throw new Error(local.error);

    const accepted = acceptSteps(json.steps, { columns: against, prefix: 'nl' });
    if (!accepted.steps.length) throw new Error(accepted.skipped[0]?.reason || local.error);
    return accepted.steps.map((s) => ({ ...s, text: phrase }));
  }, []);

  /**
   * Edits to the storyboard.
   *
   * Every one of these persists immediately: a chart type, palette, title or
   * note the user chose is written to IndexedDB and read back by /present,
   * /report and the PDF export, so the deck they present is the deck they
   * edited. `analysisRef` mirrors the state so these callbacks stay stable and
   * don't re-render every chart on the page when one slide changes.
   */
  const commitBoard = useCallback((storyboard) => {
    const current = analysisRef.current;
    if (!current) return null;
    const next = { ...current, storyboard, editedAt: Date.now() };
    setAnalysis(next);
    call('saveAnalysis', next).catch(() => {});
    return next;
  }, []);

  /**
   * Show the deck for a slice of the rows.
   *
   * The whole board is re-run, not patched: a filter changes what every number
   * on the page is a number of, and the findings under the charts are readings
   * of the result sets rather than captions on them. `lib/filters.js` says more
   * about why that rules out the cheaper version.
   *
   * Always recomputed from the unfiltered deck, never from the filtered one on
   * screen — filtering a filtered board would compound the slices, and clearing
   * back through them would need a history nobody asked for.
   */
  const applyFilters = useCallback(async (next) => {
    const columns = datasetRef.current?.columns || [];
    const list = validFilters(next, columns);
    const where = filterWhere(list);
    const current = analysisRef.current;

    // Nothing to filter yet: remember the choice so a dashboard built later
    // opens on it rather than silently dropping it.
    if (!current) {
      setFilters(list);
      return null;
    }

    // A filtered deck is the one being looked at, so the narration of the
    // unfiltered run that may still be in flight no longer has a claim on it.
    supersede();

    const whole = current.filter ? clearFiltered(current) : current;
    if (!where) {
      setFilters([]);
      setAnalysis(whole);
      return whole;
    }

    setFiltering(true);
    try {
      const result = await call('filter', { specs: specsFor(whole), filters: list });
      const filtered = applyFiltered(whole, result, {
        filters: list,
        where,
        sql: filterSql(list),
        description: describeFilters(list),
      });
      setFilters(list);
      setAnalysis(filtered);
      return filtered;
    } catch (e) {
      setError(e.message);
      return null;
    } finally {
      setFiltering(false);
    }
  }, [supersede]);

  /** One click on a chart: filter to that value, or clear it if it is the filter. */
  const toggleFilter = useCallback(
    (column, value) => applyFilters(toggleValue(filtersRef.current, column, value)),
    [applyFilters]
  );

  /** Take one column's filter off, or all of them. */
  const removeFilter = useCallback(
    (column) => applyFilters(clearColumn(filtersRef.current, column)),
    [applyFilters]
  );
  const clearFilters = useCallback(() => applyFilters([]), [applyFilters]);

  /**
   * Edits to anything on the dashboard that is not a slide: the summary text and
   * the KPI cards. Persisted the same way, through the same IndexedDB write, so
   * /present, /report and the PDF show the edited version too.
   */
  const commitAnalysis = useCallback((fields) => {
    const current = analysisRef.current;
    if (!current) return null;
    const next = { ...current, ...fields, editedAt: Date.now() };
    setAnalysis(next);
    call('saveAnalysis', next).catch(() => {});
    return next;
  }, []);

  const editSummary = useCallback(
    (patch) => commitAnalysis({ slideZero: updateSummary(analysisRef.current?.slideZero, patch) }),
    [commitAnalysis]
  );

  const editKpi = useCallback(
    (index, patch) => commitAnalysis({ kpis: updateKpi(analysisRef.current?.kpis, index, patch) }),
    [commitAnalysis]
  );

  const deleteKpi = useCallback(
    (index) => commitAnalysis({ kpis: removeKpi(analysisRef.current?.kpis, index) }),
    [commitAnalysis]
  );

  const createKpi = useCallback(
    (card) => commitAnalysis({ kpis: addKpi(analysisRef.current?.kpis, card) }),
    [commitAnalysis]
  );

  /**
   * Fill a card from the data instead of from the keyboard.
   *
   * Runs the aggregate through the same SQL path the charts use, so the number
   * on the card is computed from the loaded rows rather than asserted. The
   * metric and column are kept on the card as its provenance.
   */
  const computeKpi = useCallback(
    async (index, { metric, column, measureId } = {}) => {
      // A card can be backed by a measure the user defined, in which case the
      // measure owns both the formula and how the number is written — a card
      // showing 38.0 where the measure says 38.0% is the same card lying.
      const measure = measureId ? measuresRef.current.find((m) => m.id === measureId) : null;
      if (measureId && !measure) throw new Error('That measure no longer exists.');

      const query = measure
        ? measureSql(measure, {
            columns: datasetRef.current?.columns || [],
            profile: datasetRef.current?.profile || null,
            measures: measuresRef.current,
          }).sql
        : buildKpiSql({ metric, column });
      if (!query) throw new Error('Choose a metric, and the column to measure.');

      const { rows } = await call('sql', { query });
      const value = readKpiValue(rows);
      if (value === null) throw new Error('That metric returned no value for this data.');

      const current = analysisRef.current?.kpis?.[index];
      const patch = measure
        ? { value: formatMeasureValue(value, measure.format), source: { measureId: measure.id } }
        : {
            value: formatKpiValue(value),
            source: { metric, column: metricNeedsColumn(metric) ? column : null },
          };
      // Name it for them while the name is still ours to give: an unnamed card,
      // or one still carrying the label a previous metric generated.
      if (!String(current?.label || '').trim() || current?.autoLabel) {
        patch.label = measure ? measure.name : defaultKpiLabel({ metric, column });
        patch.autoLabel = true;
      }

      return commitAnalysis({ kpis: updateKpi(analysisRef.current?.kpis, index, patch) });
    },
    [commitAnalysis]
  );

  // ---- measures ----------------------------------------------------------

  /**
   * What a measure is allowed to refer to: this dataset's columns, its column
   * profile (which decides whether an unqualified column means SUM or COUNT),
   * and every measure already defined.
   */
  const measureContext = useCallback(
    () => ({
      columns: datasetRef.current?.columns || [],
      profile: datasetRef.current?.profile || null,
      measures: measuresRef.current,
    }),
    []
  );

  const commitMeasures = useCallback((next) => {
    setMeasures(next);
    measuresRef.current = next;
    return next;
  }, []);

  /**
   * Turn a sentence into a measure definition, without saving it.
   *
   * The deterministic parser goes first: it is instant, it works with no API
   * key, and when it recognises a phrase it is exactly right. Only when it does
   * not recognise the phrasing does this reach for the model — and whatever
   * comes back is compiled and validated here before it is handed to the caller
   * as something that could be saved.
   */
  const draftMeasure = useCallback(
    async (phrase) => {
      const ctx = measureContext();
      if (!ctx.columns.length) throw new Error('Load some data first.');

      const local = parseMeasurePhrase(phrase, ctx);
      if (local.ok) return local.measure;

      let json = null;
      try {
        const res = await fetch('/api/measure', {
          method: 'POST',
          headers: modelHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            question: phrase,
            schema: datasetRef.current?.schema,
            columns: ctx.columns,
            measures: ctx.measures.map((m) => ({ name: m.name, expr: m.expr })),
          }),
        });
        json = await res.json();
      } catch {
        /* offline, or no provider — the parser's own reason is the better one */
      }

      // Both paths failed. The parser's message names the word it could not
      // place, which is more use than "the model was unavailable".
      if (!json || json.unavailable || !json.expr) throw new Error(local.error);

      const candidate = {
        name: uniqueMeasureName(json.name, ctx.measures),
        text: phrase,
        expr: json.expr,
        filter: json.filter || null,
        format: json.format || 'number',
        source: 'model',
        explanation: json.explanation || '',
      };

      const compiled = compileMeasure(candidate, ctx);
      if (!compiled.ok) throw new Error(compiled.error);
      return candidate;
    },
    [measureContext]
  );

  /**
   * Save a measure — new, or an edit to one that exists.
   *
   * Validated once more on the way in, because the formula box lets a measure
   * be edited by hand after it was generated.
   */
  const saveMeasure = useCallback(
    (draft) => {
      const ctx = measureContext();
      const existing = draft.id ? ctx.measures.find((m) => m.id === draft.id) : null;
      const measure = {
        ...existing,
        ...draft,
        id: draft.id || `ms_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        name: String(draft.name || '').trim() || 'New measure',
        createdAt: existing?.createdAt || Date.now(),
        editedAt: Date.now(),
      };

      const compiled = compileMeasure(measure, ctx);
      if (!compiled.ok) throw new Error(compiled.error);

      const list = ctx.measures;
      const next = existing ? list.map((m) => (m.id === measure.id ? measure : m)) : [...list, measure];
      commitMeasures(next);
      return measure;
    },
    [commitMeasures, measureContext]
  );

  /**
   * Delete a measure, unless something is built on top of it.
   *
   * Removing a measure another one references would leave that second measure
   * pointing at a name nothing defines, which fails later and somewhere else.
   */
  const deleteMeasure = useCallback(
    (id) => {
      const list = measuresRef.current;
      const target = list.find((m) => m.id === id);
      if (!target) return list;

      const dependents = list.filter(
        (m) => m.id !== id && compileMeasure(m, { ...measureContext(), measures: list })?.dependsOn?.includes(target.name)
      );
      if (dependents.length) {
        throw new Error(`${dependents.map((m) => m.name).join(' and ')} still uses ${target.name}.`);
      }
      return commitMeasures(list.filter((m) => m.id !== id));
    },
    [commitMeasures, measureContext]
  );

  /**
   * Compute a measure's value over the loaded rows.
   *
   * The same SQL path every chart and KPI card uses, so a measure's number is
   * as verifiable as the rest of the dashboard: the query is the provenance.
   */
  const evaluateMeasure = useCallback(
    async (measure) => {
      const ctx = measureContext();
      const { sql, error } = measureSql(measure, ctx);
      if (error) throw new Error(error);
      const { rows } = await call('sql', { query: sql });
      return { value: readMeasureValue(rows), sql };
    },
    [measureContext]
  );

  /**
   * Every measure, computed over the rows a filter selects.
   *
   * Compiling happens here, on the main thread, because that is where the
   * expression validator lives — the worker is only trusted to choose rows and
   * run finished SQL. A measure that fails to compile is reported against its
   * own id rather than throwing, so one broken formula does not blank the rest.
   */
  const evaluateMeasuresOverView = useCallback(
    async ({ filter = '', anomaliesOnly = false, table = null } = {}) => {
      const list = measuresRef.current;
      if (!list.length) return [];

      const ctx = measureContext();
      const items = [];
      const failed = [];
      for (const measure of list) {
        const { sql, error } = measureSql(measure, ctx);
        if (error) failed.push({ id: measure.id, error });
        else items.push({ id: measure.id, sql });
      }
      if (!items.length) return failed;

      const { values } = await call('measureValues', { items, filter, anomaliesOnly, table });
      const computed = (values || []).map((v) =>
        v.error ? { id: v.id, error: v.error } : { id: v.id, value: readMeasureValue(v.rows) }
      );
      return [...computed, ...failed];
    },
    [measureContext]
  );

  /**
   * What a saved analysis is made of.
   *
   * The findings, not the data. Chart result sets are already aggregated to the
   * handful of rows a chart draws, so this is small and shareable; the cleaned
   * dataset stays in the browser and is never uploaded.
   */
  const analysisSnapshot = useCallback(() => {
    const current = analysisRef.current;
    if (!current) return null;
    return {
      version: 1,
      slideZero: current.slideZero,
      storyboard: current.storyboard,
      kpis: current.kpis || [],
      measures: measuresRef.current,
      generatedAt: current.generatedAt,
      narrated: current.narrated,
      // The slice the deck was saved on. Every figure in the storyboard above
      // was computed over these rows, so saving the numbers without the
      // condition that produced them would save a report nobody could account
      // for — and reopening it would silently relabel a slice as the whole.
      filter: current.filter || null,
    };
  }, []);

  /**
   * Open a saved analysis.
   *
   * Restores the storyboard and the measures, but not a dataset — there is none
   * to restore, by design. The deck, the report and the presentation all read
   * from the storyboard, so they work; Explore and Ask need rows and will say
   * the session is empty, which is the truth.
   */
  const restoreAnalysis = useCallback(async (payload) => {
    if (!payload?.storyboard) throw new Error('That saved analysis is empty.');
    const restored = {
      slideZero: payload.slideZero,
      storyboard: payload.storyboard,
      kpis: payload.kpis || [],
      generatedAt: payload.generatedAt || Date.now(),
      narrated: !!payload.narrated,
      filter: payload.filter || null,
      restored: true,
    };
    supersede();
    setAnalysis(restored);
    setFilters(payload.filter?.filters || []);
    setStatus((prev) => (prev === 'booting' || prev === 'empty' ? 'analyzed' : prev));
    call('saveAnalysis', restored).catch(() => {});

    if (Array.isArray(payload.measures)) {
      measuresRef.current = payload.measures;
      setMeasures(payload.measures);
    }
    return restored;
  }, [supersede]);

  const editSlide = useCallback(
    (id, patch) => commitBoard(updateSlide(analysisRef.current?.storyboard || [], id, patch)),
    [commitBoard]
  );

  const deleteSlide = useCallback(
    (id) => commitBoard(removeSlide(analysisRef.current?.storyboard || [], id)),
    [commitBoard]
  );

  /**
   * Build a chart from a spec, run it through the engine so it carries the same
   * verified statistics a generated slide does, and append it to the board.
   */
  const addSlide = useCallback(
    async (spec, { title, notes, index = null } = {}) => {
      const { chart, finding } = await call('ask', { spec });
      if (!chart) throw new Error('That chart returned no rows.');
      const board = analysisRef.current?.storyboard || [];
      const slide = createSlide({ storyboard: board, chart, finding, title, notes });
      commitBoard(insertSlide(board, slide, index));
      return slide;
    },
    [commitBoard]
  );

  /** Put a previous board back, whole. The counterpart to `replanWithModel`. */
  const restoreBoard = useCallback((storyboard) => commitBoard(storyboard || []), [commitBoard]);

  /**
   * Let a model choose what the dashboard is about, and rebuild it.
   *
   * The deck the engine plans is chosen by a rule list — spreads, cardinalities,
   * score constants — which has no way to know what a table means. On a
   * comparison of subscriptions it led with how many plan tiers each vendor
   * sells, because counting rows is the fallback when nothing is summable.
   *
   * This asks a model the one question the rule list cannot answer: given these
   * columns, and what the reader said they are deciding, which queries should
   * this dashboard run? Every query that comes back is checked against the
   * columns the model was shown, checked again by the engine's SQL guard, and
   * then executed here through the same path a hand-built chart takes — so each
   * chart carries the same verified statistics, computed locally, from real
   * rows. The model never sees a number and never reports one.
   *
   * The existing deck is replaced, not merged: two planners' worth of charts is
   * a longer deck, not a better one. It stays in `replaced` so the reader can
   * put it back and compare, which is the whole point of offering both.
   */
  const replanWithModel = useCallback(
    async ({ intent = '' } = {}) => {
      const data = datasetRef.current;
      const current = analysisRef.current;
      if (!data?.schema || !current) throw new Error('There is no analysis to re-plan.');

      const res = await fetch('/api/dashboard-plan', {
        method: 'POST',
        headers: modelHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          schema: data.schema,
          intent,
          rowCount: data.rowCount || 0,
        }),
      });
      const body = res.ok ? await res.json() : null;
      if (!body || body.unavailable || !Array.isArray(body.charts) || body.charts.length === 0) {
        const reason = body?.reason === 'no_provider'
          ? 'No model is configured, so the deck the engine planned is the one you have.'
          : 'The model could not plan a dashboard for this table.';
        return { planned: 0, reason, rejected: body?.rejected || [] };
      }

      // Each one through the engine, exactly as a chart somebody built by hand.
      // A query that returns nothing is dropped rather than shown empty.
      const slides = [];
      const failed = [];
      for (const spec of body.charts) {
        try {
          const { chart, finding } = await call('ask', { spec: { ...spec, id: `plan_${slides.length + 1}` } });
          if (!chart || !(chart.resultData || []).length) {
            failed.push(`${spec.title}: the query returned no rows`);
            continue;
          }
          slides.push(
            createSlide({
              storyboard: slides,
              chart,
              finding,
              title: spec.title,
              notes: spec.why ? `Planned by the model: ${spec.why}` : '',
            })
          );
        } catch (e) {
          failed.push(`${spec.title}: ${e.message}`);
        }
      }

      if (slides.length === 0) {
        return { planned: 0, reason: 'None of the planned queries returned anything.', rejected: [...(body.rejected || []), ...failed] };
      }

      commitBoard(slides);
      return {
        planned: slides.length,
        replaced: current.storyboard || [],
        rejected: [...(body.rejected || []), ...failed],
      };
    },
    [commitBoard]
  );

  /**
   * Re-run one slide against a new specification.
   *
   * Changing what a chart measures is not an edit to its appearance: the rows
   * have to be fetched again and the finding recomputed, or the sentence under
   * the chart would go on describing the previous numbers. `editSlide` cannot
   * do it — the patch whitelist deliberately excludes `sql` and `resultData`,
   * which come from the engine and not from a form — so until now the only way
   * to change a chart's metric was to delete it and build a new one, losing its
   * title, notes and colours with it.
   *
   * What the user chose about *appearance* is carried across. Category renames
   * are the exception: they are keyed by the values of the old dimension, so
   * they are kept only when the dimension has not changed.
   */
  const rebuildSlide = useCallback(
    async (id, spec) => {
      const { chart, finding } = await call('ask', { spec: { ...spec, id } });
      if (!chart || !chart.resultData?.length) {
        throw new Error('That combination returned no rows.');
      }

      const board = analysisRef.current?.storyboard || [];
      const next = board.map((slide) => {
        if (String(slide.id) !== String(id)) return slide;
        const previous = slide.chart || {};

        // Category renames are keyed by the values of the dimension, so a new
        // dimension makes most of them meaningless — but not all: a rename of
        // "US" to "United States" still applies if the new breakdown also has a
        // "US". Keeping the ones that still match beats dropping the lot, which
        // silently undid renaming work on every re-point.
        const values = new Set(
          (chart.resultData || []).map((row) => String(row?.[chart.xAxisKey] ?? ''))
        );
        const carried = Object.fromEntries(
          Object.entries(previous.labels || {}).filter(([key]) => values.has(String(key)))
        );
        // A generated heading has to follow the chart it heads. Left alone, a
        // slide re-pointed from a monthly trend to a breakdown by category went
        // on being titled "Total Amount Trend Over Month" — the same failure as
        // a KPI card keeping its old label over a new measure. A title somebody
        // typed is never overwritten.
        const titleIsMine = (slide.edits || []).includes('pageTitle');
        return {
          ...slide,
          pageTitle: titleIsMine ? slide.pageTitle : chart.title || slide.pageTitle,
          chart: {
            ...chart,
            colors: previous.colors ?? null,
            colorBy: previous.colorBy ?? 'series',
            labels: Object.keys(carried).length ? carried : null,
            xAxisLabel: previous.xAxisLabel ?? null,
            yAxisLabel: previous.yAxisLabel ?? null,
          },
          finding,
          edits: [...new Set([...(slide.edits || []), 'chart.data'])],
        };
      });

      commitBoard(next);
      return next;
    },
    [commitBoard]
  );

  const fetchPage = useCallback((opts) => call('page', opts), []);
  const runSql = useCallback((query) => call('sql', { query }), []);
  const askEngine = useCallback((spec) => call('ask', { spec }), []);

  /**
   * Correct the inferred data model (which sheet is the fact table, which joins
   * are real) and rebuild the joined view. Any existing analysis is dropped —
   * it was computed against the old join and is no longer trustworthy.
   */
  const setModel = useCallback(async ({ factTable, relationships } = {}) => {
    const summary = await call('setModel', { factTable, relationships });
    setDataset(summary);
    supersede();
    setAnalysis(null);
    setStatus('ready');
    return summary;
  }, [supersede]);

  /**
   * Measure a relationship the user is proposing, without applying it. Nothing
   * changes until they add it — this only answers "would this join work".
   */
  const testRelationship = useCallback(
    ({ from, to }) => call('testRelationship', { from, to }),
    []
  );

  const exportCsv = useCallback(async (table = null) => {
    // The rows behind what is on screen, filter and all — see the worker.
    const { csv, fileName } = await call('exportCsv', {
      table,
      where: table ? '' : filterWhere(filtersRef.current),
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, []);

  const reset = useCallback(async () => {
    await call('reset').catch(() => {});
    await idbDel(KEYS.measures).catch(() => {});
    setMeasures([]);
    measuresRef.current = [];
    setDataset(null);
    supersede();
    setAnalysis(null);
    setError(null);
    setStatus('empty');
    endProgress();
  }, [endProgress, supersede]);

  // ---- context values ----------------------------------------------------

  // A new file has no preparation. The record carries the ingest time of the
  // dataset it was made for, and is shown only beside that one.
  const datasetValue = useMemo(
    () => ({
      dataset,
      status,
      error,
      preparation: preparation && preparation.at === dataset?.ingestedAt ? preparation : null,
    }),
    [dataset, status, error, preparation]
  );
  const analysisValue = useMemo(
    () => ({ analysis, narrating, filters, filtering }),
    [analysis, narrating, filters, filtering]
  );
  const measuresValue = useMemo(() => measures, [measures]);
  /**
   * Put the void rows back, or take them out again.
   *
   * A full re-analysis, because the exclusion happens before a chart is
   * planned — every figure in the deck is downstream of it, so there is nothing
   * to patch. The user's edits survive it the same way they survive Re-run.
   */
  const setVoidRowsIncluded = useCallback(
    (include) => analyze({ includeVoid: !!include }),
    [analyze]
  );

  const actions = useMemo(
    () => ({
      ingestFile,
      ingestText,
      ingestUrl,
      extractDocuments,
      ingestExtracted,
      setTransforms,
      suggestPreparation,
      applyPreparation,
      draftTransform,
      ingestRemote,
      analyze,
      startBlank,
      setVoidRowsIncluded,
      applyFilters,
      toggleFilter,
      removeFilter,
      clearFilters,
      setModel,
      testRelationship,
      editSlide,
      deleteSlide,
      addSlide,
      replanWithModel,
      restoreBoard,
      rebuildSlide,
      editSummary,
      editKpi,
      deleteKpi,
      createKpi,
      computeKpi,
      draftMeasure,
      saveMeasure,
      deleteMeasure,
      evaluateMeasure,
      evaluateMeasuresOverView,
      analysisSnapshot,
      restoreAnalysis,
      fetchPage,
      runSql,
      askEngine,
      exportCsv,
      reset,
      setError,
    }),
    [
      ingestFile,
      ingestText,
      ingestUrl,
      extractDocuments,
      ingestExtracted,
      setTransforms,
      suggestPreparation,
      applyPreparation,
      draftTransform,
      ingestRemote,
      analyze,
      startBlank,
      setVoidRowsIncluded,
      applyFilters,
      toggleFilter,
      removeFilter,
      clearFilters,
      setModel,
      testRelationship,
      editSlide,
      deleteSlide,
      addSlide,
      replanWithModel,
      restoreBoard,
      rebuildSlide,
      editSummary,
      editKpi,
      deleteKpi,
      createKpi,
      computeKpi,
      draftMeasure,
      saveMeasure,
      deleteMeasure,
      evaluateMeasure,
      evaluateMeasuresOverView,
      analysisSnapshot,
      restoreAnalysis,
      fetchPage,
      runSql,
      askEngine,
      exportCsv,
      reset,
    ]
  );

  return (
    <DatasetCtx.Provider value={datasetValue}>
      <AnalysisCtx.Provider value={analysisValue}>
        <ActionsCtx.Provider value={actions}>
          <MeasuresCtx.Provider value={measuresValue}>
            <ProgressCtx.Provider value={job}>{children}</ProgressCtx.Provider>
          </MeasuresCtx.Provider>
        </ActionsCtx.Provider>
      </AnalysisCtx.Provider>
    </DatasetCtx.Provider>
  );
}
