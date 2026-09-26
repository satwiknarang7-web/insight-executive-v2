'use client';

/**
 * Session state for the loaded data: the dataset summary, the progress of an
 * ingest, and the actions that load, shape and query it. The dashboard built
 * on top of it lives in ./DashboardProvider.js.
 *
 * Split into contexts because progress ticks fire many times a second during
 * ingestion; sharing a context with the dataset would re-render every chart on
 * screen on each tick.
 *
 * The provider lives in the root layout, so client-side navigation keeps the
 * session alive without refetching or recomputing anything.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { modelHeaders } from '../geminiKey';
import { call } from './engineClient';
import { parseTransformPhrase } from '../transformLanguage';
import { formatOf } from '../ingest/formats';
import { acceptPreparation, acceptSteps, preparationBriefing, splitProposals } from '../preparation';
import { idbDel, KEYS } from './idb';

const DatasetCtx = createContext(null);
const ProgressCtx = createContext(null);
const ActionsCtx = createContext(null);

export const useDataset = () => useContext(DatasetCtx);
export const useProgress = () => useContext(ProgressCtx);
export const useActions = () => useContext(ActionsCtx);

/** Whether a dataset is loaded (and the app is past booting). */
export function useHasData() {
  const ds = useDataset();
  return !!ds?.dataset;
}

const IDLE = { kind: null, stage: '', percent: 0, logs: [], steps: [] };

export function DatasetProvider({ children }) {
  const [dataset, setDataset] = useState(null);
  const [status, setStatus] = useState('booting'); // booting | empty | ingesting | ready
  const [error, setError] = useState(null);
  const [job, setJob] = useState(IDLE);
  // What the analyst did to the table before analysing it, for this dataset.
  const [preparation, setPreparation] = useState(null);

  // Progress arrives faster than React can usefully paint. Buffer it and flush
  // on an animation frame so a 200k-row ingest doesn't queue 4,000 renders.
  const jobRef = useRef(IDLE);
  const rafRef = useRef(0);
  const runRef = useRef(0);
  const datasetRef = useRef(null);
  useEffect(() => {
    datasetRef.current = dataset;
  }, [dataset]);

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
          setStatus('ready');
        } else {
          setStatus('empty');
        }
      })
      .catch(() => !cancelled && setStatus('empty'));
    return () => {
      cancelled = true;
    };
  }, []);

  // Clear measures an earlier build kept in browser storage; nothing is kept now.
  useEffect(() => {
    idbDel(KEYS.measures).catch(() => {});
  }, []);

  // ---- actions -----------------------------------------------------------

  const ingest = useCallback(
    async ({ files, file, text, fileName }) => {
      setError(null);
      supersede();
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
      measures: [],
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
    return acceptPreparation(body, { columns: current.columns, measures: [], prefix: 'ai' });
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
      const record = {
        at: datasetRef.current?.ingestedAt,
        summary: proposal?.summary || '',
        applied,
        suggested: leftover,
        // Everything that was proposed and not done, whether the column list
        // refused it or the rows did, in one list because a reader does not
        // care which check caught it.
        skipped: [...(proposal?.skipped || []), ...refused],
        failure,
      };
      setPreparation(record);
      return record;
    },
    [setTransforms]
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

  // ---- measures ----------------------------------------------------------

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
      where: '',
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
    setDataset(null);
    supersede();
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
  const actions = useMemo(
    () => ({
      ingestFile,
      ingestText,
      ingestUrl,
      setTransforms,
      suggestPreparation,
      applyPreparation,
      draftTransform,
      ingestRemote,
      setModel,
      testRelationship,
      fetchPage,
      runSql,
      askEngine,
      exportCsv,
      reset,
      setError,
    }),
    [ingestFile, ingestText, ingestUrl, setTransforms, suggestPreparation, applyPreparation, draftTransform, ingestRemote, setModel, testRelationship, fetchPage, runSql, askEngine, exportCsv, reset]
  );

  return (
    <DatasetCtx.Provider value={datasetValue}>
      <ActionsCtx.Provider value={actions}>
        <ProgressCtx.Provider value={job}>{children}</ProgressCtx.Provider>
      </ActionsCtx.Provider>
    </DatasetCtx.Provider>
  );
}
