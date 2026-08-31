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
import { compileMeasure, measureSql, readMeasureValue, formatMeasureValue } from '../measures';
import { parseMeasurePhrase, uniqueMeasureName } from '../measureLanguage';
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

const IDLE = { kind: null, stage: '', percent: 0, logs: [], steps: [] };

export function DatasetProvider({ children }) {
  const [dataset, setDataset] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [status, setStatus] = useState('booting'); // booting | empty | ingesting | ready | analyzing | analyzed
  const [error, setError] = useState(null);
  const [job, setJob] = useState(IDLE);
  const [narrating, setNarrating] = useState(false);
  const [measures, setMeasures] = useState([]);

  // Progress arrives faster than React can usefully paint. Buffer it and flush
  // on an animation frame so a 200k-row ingest doesn't queue 4,000 renders.
  const jobRef = useRef(IDLE);
  const rafRef = useRef(0);
  // Mirrors of state, so the edit callbacks below can stay referentially stable.
  const analysisRef = useRef(null);
  const previousBoardRef = useRef(null);
  const previousSummaryRef = useRef(null);
  const previousKpisRef = useRef(null);
  const datasetRef = useRef(null);
  const measuresRef = useRef([]);
  analysisRef.current = analysis;
  datasetRef.current = dataset;
  measuresRef.current = measures;
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
    [pushProgress, resetProgress, endProgress]
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

      const unsupported = files.filter(
        (f) => !(f.type === 'text/csv' || /\.(csv|tsv|txt|xlsx|xlsm|xlsb|xls)$/i.test(f.name || ''))
      );
      if (unsupported.length) {
        const msg = `${unsupported.map((f) => f.name).join(', ')} — unsupported file type. Upload .csv or .xlsx files.`;
        setError(msg);
        return Promise.reject(new Error(msg));
      }
      return ingest({ files, fileName: files[0].name });
    },
    [ingest]
  );

  const ingestText = useCallback((text, fileName) => ingest({ text, fileName }), [ingest]);

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
    [pushProgress, resetProgress, endProgress]
  );

  /**
   * Run the analysis. Charts and verified numbers are computed locally and shown
   * immediately; the LLM narrative is fetched afterwards and merged in when it
   * lands, so the dashboard is never blocked on a network round trip.
   */
  const analyze = useCallback(
    async ({ focus = null, maxCharts = null } = {}) => {
      setError(null);
      setStatus('analyzing');
      resetProgress('analyze');
      previousBoardRef.current = analysisRef.current?.storyboard || null;
      previousSummaryRef.current = analysisRef.current?.slideZero || null;
      previousKpisRef.current = analysisRef.current?.kpis || null;
      try {
        const result = await call(
          'analyze',
          { focus, maxCharts },
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
        };
        setAnalysis(local);
        setStatus('analyzed');
        endProgress();
        call('saveAnalysis', local).catch(() => {});

        // Background narrative pass.
        setNarrating(true);
        fetch('/api/narrate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(result.narrationRequest),
        })
          .then((r) => (r.ok ? r.json() : null))
          .then((narrative) => {
            if (!narrative || narrative.unavailable) return;
            const merged = buildStoryboard({
              charts: result.charts,
              perChart: result.perChart,
              synthesis: result.synthesis,
              narrative,
            });
            const live = analysisRef.current;
            const next = {
              ...merged,
              storyboard: reapplyEdits(merged.storyboard, live?.storyboard || previousBoardRef.current),
              slideZero: reapplySummaryEdits(merged.slideZero, live?.slideZero || previousSummaryRef.current),
              kpis: reapplyKpiEdits(result.kpis, live?.kpis || previousKpisRef.current),
              generatedAt: Date.now(),
              focus,
              narrated: true,
            };
            setAnalysis(next);
            call('saveAnalysis', next).catch(() => {});
          })
          .catch(() => {})
          .finally(() => setNarrating(false));

        return local;
      } catch (e) {
        setError(e.message);
        setStatus('ready');
        endProgress();
        throw e;
      }
    },
    [pushProgress, resetProgress, endProgress]
  );

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
          headers: { 'Content-Type': 'application/json' },
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
      restored: true,
    };
    setAnalysis(restored);
    setStatus((prev) => (prev === 'booting' || prev === 'empty' ? 'analyzed' : prev));
    call('saveAnalysis', restored).catch(() => {});

    if (Array.isArray(payload.measures)) {
      measuresRef.current = payload.measures;
      setMeasures(payload.measures);
    }
    return restored;
  }, []);

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
    setAnalysis(null);
    setStatus('ready');
    return summary;
  }, []);

  /**
   * Measure a relationship the user is proposing, without applying it. Nothing
   * changes until they add it — this only answers "would this join work".
   */
  const testRelationship = useCallback(
    ({ from, to }) => call('testRelationship', { from, to }),
    []
  );

  const exportCsv = useCallback(async (table = null) => {
    const { csv, fileName } = await call('exportCsv', { table });
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
    setAnalysis(null);
    setError(null);
    setStatus('empty');
    endProgress();
  }, [endProgress]);

  // ---- context values ----------------------------------------------------

  const datasetValue = useMemo(() => ({ dataset, status, error }), [dataset, status, error]);
  const analysisValue = useMemo(() => ({ analysis, narrating }), [analysis, narrating]);
  const measuresValue = useMemo(() => measures, [measures]);
  const actions = useMemo(
    () => ({
      ingestFile,
      ingestText,
      ingestRemote,
      analyze,
      setModel,
      testRelationship,
      editSlide,
      deleteSlide,
      addSlide,
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
      ingestRemote,
      analyze,
      setModel,
      testRelationship,
      editSlide,
      deleteSlide,
      addSlide,
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
