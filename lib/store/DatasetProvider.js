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

const DatasetCtx = createContext(null);
const AnalysisCtx = createContext(null);
const ProgressCtx = createContext(null);
const ActionsCtx = createContext(null);

export const useDataset = () => useContext(DatasetCtx);
export const useAnalysis = () => useContext(AnalysisCtx);
export const useProgress = () => useContext(ProgressCtx);
export const useActions = () => useContext(ActionsCtx);

/** Convenience: is there enough loaded to show the app chrome? */
export function useHasData() {
  const ds = useDataset();
  return !!ds?.dataset;
}

const IDLE = { kind: null, stage: '', percent: 0, logs: [] };

export function DatasetProvider({ children }) {
  const [dataset, setDataset] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [status, setStatus] = useState('booting'); // booting | empty | ingesting | ready | analyzing | analyzed
  const [error, setError] = useState(null);
  const [job, setJob] = useState(IDLE);
  const [narrating, setNarrating] = useState(false);

  // Progress arrives faster than React can usefully paint. Buffer it and flush
  // on an animation frame so a 200k-row ingest doesn't queue 4,000 renders.
  const jobRef = useRef(IDLE);
  const rafRef = useRef(0);
  const flush = useCallback(() => {
    rafRef.current = 0;
    setJob(jobRef.current);
  }, []);
  const pushProgress = useCallback(
    (kind, { stage, percent, log }) => {
      const prev = jobRef.current;
      jobRef.current = {
        kind,
        stage: stage ?? prev.stage,
        percent: percent ?? prev.percent,
        logs: log ? [...prev.logs, log].slice(-60) : prev.logs,
      };
      if (!rafRef.current) rafRef.current = requestAnimationFrame(flush);
    },
    [flush]
  );
  const resetProgress = useCallback((kind) => {
    jobRef.current = { kind, stage: '', percent: 0, logs: [] };
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

  // ---- actions -----------------------------------------------------------

  const ingest = useCallback(
    async ({ file, text, fileName }) => {
      setError(null);
      setAnalysis(null);
      setStatus('ingesting');
      resetProgress('ingest');
      try {
        const summary = await call(
          'ingest',
          { file, text, fileName },
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

  const ingestFile = useCallback(
    (file) => {
      if (!file) return Promise.reject(new Error('No file provided.'));
      const isCsv = file.type === 'text/csv' || /\.(csv|tsv|txt)$/i.test(file.name);
      if (!isCsv) {
        const msg = 'That file type is not supported. Upload a .csv file.';
        setError(msg);
        return Promise.reject(new Error(msg));
      }
      return ingest({ file, fileName: file.name });
    },
    [ingest]
  );

  const ingestText = useCallback((text, fileName) => ingest({ text, fileName }), [ingest]);

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
        const local = {
          ...base,
          kpis: result.kpis,
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
            const next = { ...merged, kpis: result.kpis, generatedAt: Date.now(), focus, narrated: true };
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

  const fetchPage = useCallback((opts) => call('page', opts), []);
  const runSql = useCallback((query) => call('sql', { query }), []);
  const askEngine = useCallback((spec) => call('ask', { spec }), []);

  const exportCsv = useCallback(async () => {
    const { csv, fileName } = await call('exportCsv');
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
    setDataset(null);
    setAnalysis(null);
    setError(null);
    setStatus('empty');
    endProgress();
  }, [endProgress]);

  // ---- context values ----------------------------------------------------

  const datasetValue = useMemo(() => ({ dataset, status, error }), [dataset, status, error]);
  const analysisValue = useMemo(() => ({ analysis, narrating }), [analysis, narrating]);
  const actions = useMemo(
    () => ({ ingestFile, ingestText, analyze, fetchPage, runSql, askEngine, exportCsv, reset, setError }),
    [ingestFile, ingestText, analyze, fetchPage, runSql, askEngine, exportCsv, reset]
  );

  return (
    <DatasetCtx.Provider value={datasetValue}>
      <AnalysisCtx.Provider value={analysisValue}>
        <ActionsCtx.Provider value={actions}>
          <ProgressCtx.Provider value={job}>{children}</ProgressCtx.Provider>
        </ActionsCtx.Provider>
      </AnalysisCtx.Provider>
    </DatasetCtx.Provider>
  );
}
