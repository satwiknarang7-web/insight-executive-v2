'use client';

/**
 * The dashboard: built by the engine (lib/engine) in the worker, edited here.
 *
 * Holds the dashboard spec (KPIs, sections of tiles, findings), the filters
 * over it, the reader's field corrections and measures, and whether a model
 * helped. Every change that affects numbers goes back to the worker, which
 * owns the rows; this file never computes a figure itself.
 *
 * Lives beside DatasetProvider in the root layout, so it survives navigation
 * for as long as the tab does (nothing is written to disk — see lib/store/idb).
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { call } from './engineClient';
import { useDataset } from './DatasetProvider';
import { modelHeaders } from '../geminiKey';
import { acceptReading, acceptWriting, readingBriefing, writingBriefing } from '../engine/ai';

const Ctx = createContext(null);
export const useDashboard = () => useContext(Ctx);

const UNDERSTAND_MS = 12000;
const WRITE_MS = 20000;

function withDeadline(promise, ms) {
  return Promise.race([Promise.resolve(promise).catch(() => null), new Promise((r) => setTimeout(() => r(null), ms))]);
}

const post = (url, body) =>
  fetch(url, { method: 'POST', headers: modelHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(body) })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);

let tileSeq = 0;
export const newTileId = () => `u${Date.now().toString(36)}${(++tileSeq).toString(36)}`;

/** A tile without its computed data, for sending back to the worker. */
const bare = ({ computed, error, ...t }) => t;

export function DashboardProvider({ children }) {
  const { dataset } = useDataset();
  const [board, setBoard] = useState(null);
  const [filters, setFiltersState] = useState([]);
  const [status, setStatus] = useState('idle'); // idle | building | ready | error
  const [stage, setStage] = useState('');
  const [error, setError] = useState(null);
  const [engine, setEngine] = useState(null); // { ds, measures }
  const [settings, setSettings] = useState({ overrides: {}, custom: [] });
  const [ai, setAi] = useState({ used: false, reading: null, written: null });
  const boardRef = useRef(null);
  const filtersRef = useRef([]);
  const settingsRef = useRef(settings);
  const runRef = useRef(0);
  boardRef.current = board;
  filtersRef.current = filters;
  settingsRef.current = settings;

  // A new dataset: the old dashboard is about something else.
  const datasetKey = dataset ? `${dataset.fileName}|${dataset.ingestedAt}|${dataset.rowCount}|${(dataset.columns || []).join(',')}` : null;
  const builtFor = useRef(null);
  useEffect(() => {
    if (!datasetKey) {
      setBoard(null);
      setEngine(null);
      setFiltersState([]);
      setSettings({ overrides: {}, custom: [] });
      setStatus('idle');
      builtFor.current = null;
    } else if (builtFor.current && builtFor.current !== datasetKey) {
      setBoard(null);
      setFiltersState([]);
      setSettings({ overrides: {}, custom: [] });
      setStatus('idle');
    }
  }, [datasetKey]);

  const describe = useCallback(async (s = settingsRef.current) => {
    const e = await call('describeEngine', s);
    setEngine(e);
    return e;
  }, []);

  /**
   * Build the dashboard. With a model: it reads the columns first (its
   * reading is checked before the planner sees it), and writes the words
   * after (every number checked). Without one, or if it is slow, the
   * engine's own dashboard stands.
   */
  const build = useCallback(
    async ({ useModel = false } = {}) => {
      const run = ++runRef.current;
      builtFor.current = datasetKey;
      setStatus('building');
      setError(null);
      setFiltersState([]);
      try {
        let s = settingsRef.current;
        let reading = null;
        setStage('Reading the columns');
        const described = await describe(s);
        if (useModel && described?.ds) {
          setStage('Asking the model what this table is');
          const res = await withDeadline(post('/api/understand', readingBriefing(described.ds, { fileName: dataset?.fileName })), UNDERSTAND_MS);
          if (res?.proposal) {
            reading = acceptReading(res.proposal, described.ds);
            s = {
              overrides: { ...reading.overrides, ...s.overrides },
              custom: [...s.custom, ...reading.custom.filter((m) => !s.custom.some((c) => c.id === m.id))],
            };
          }
        }
        setStage('Choosing the charts');
        const built = await call('buildDashboard', { ...s, hints: reading?.hints || null });
        if (run !== runRef.current) return null;
        const next = { ...built, subject: reading?.subject || null };
        setSettings(s);
        setBoard(next);
        setAi({ used: !!reading, reading, written: null });
        setStatus('ready');
        setStage('');
        describe(s).catch(() => {});

        if (useModel) {
          // The words, in the background: the dashboard is already on screen.
          const briefing = writingBriefing(next);
          withDeadline(post('/api/write', briefing), WRITE_MS).then((res) => {
            if (run !== runRef.current || !res?.written) return;
            const written = acceptWriting(res.written, briefing);
            setAi((a) => ({ ...a, used: true, written }));
            setBoard((b) =>
              b
                ? {
                    ...b,
                    headline: written.headline || b.headline,
                    aiSummary: written.summary.length ? written.summary : null,
                    sections: b.sections.map((sec) => ({
                      ...sec,
                      tiles: sec.tiles.map((t) => (written.captions[t.id] && !t.edited ? { ...t, draft: t.insight, insight: written.captions[t.id], aiCaption: true } : t)),
                    })),
                  }
                : b
            );
          });
        }
        return next;
      } catch (e) {
        if (run === runRef.current) {
          setError(e?.message || 'Could not build the dashboard.');
          setStatus('error');
        }
        return null;
      }
    },
    [datasetKey, dataset?.fileName, describe]
  );

  /** Recompute some tiles (after an edit or a filter). */
  const recompute = useCallback(async (tiles, f = filtersRef.current, s = settingsRef.current) => {
    if (!tiles.length) return [];
    const res = await call('computeTiles', { tiles: tiles.map(bare), filters: f, ...s });
    return res.tiles;
  }, []);

  const replaceTiles = useCallback((updated) => {
    const byId = new Map(updated.map((t) => [t.id, t]));
    setBoard((b) => (b ? { ...b, sections: b.sections.map((s) => ({ ...s, tiles: s.tiles.map((t) => byId.get(t.id) || t) })) } : b));
  }, []);

  const allTiles = useCallback(() => (boardRef.current?.sections || []).flatMap((s) => s.tiles), []);

  /** Filters apply to every tile and KPI. */
  const setFilters = useCallback(
    async (next) => {
      setFiltersState(next);
      const b = boardRef.current;
      if (!b) return;
      const [tiles, kpis] = await Promise.all([
        recompute(allTiles().map((t) => ({ ...t, recaption: true })), next),
        call('computeKpis', { kpis: b.kpis, filters: next, ...settingsRef.current }),
      ]);
      replaceTiles(tiles);
      setBoard((cur) => (cur ? { ...cur, kpis: kpis.kpis } : cur));
    },
    [recompute, allTiles, replaceTiles]
  );

  const toggleFilterValue = useCallback(
    (field, value) => {
      const cur = filtersRef.current;
      const f = cur.find((x) => x.field === field && Array.isArray(x.values));
      let next;
      if (!f) next = [...cur, { field, values: [String(value)] }];
      else {
        const has = f.values.includes(String(value));
        const values = has ? f.values.filter((v) => v !== String(value)) : [...f.values, String(value)];
        next = values.length ? cur.map((x) => (x === f ? { ...x, values } : x)) : cur.filter((x) => x !== f);
      }
      return setFilters(next);
    },
    [setFilters]
  );

  /** Change a tile's spec and recompute it; the caption is rewritten from its new data. */
  const updateTile = useCallback(
    async (id, patch) => {
      const t = allTiles().find((x) => x.id === id);
      if (!t) return null;
      const next = { ...bare(t), ...patch, edited: true, recaption: true, aiCaption: false };
      const [done] = await recompute([next]);
      replaceTiles([done]);
      return done;
    },
    [allTiles, recompute, replaceTiles]
  );

  /** Move or resize without recomputing. */
  const patchTileLayout = useCallback((id, patch) => {
    setBoard((b) => (b ? { ...b, sections: b.sections.map((s) => ({ ...s, tiles: s.tiles.map((t) => (t.id === id ? { ...t, ...patch } : t)) })) } : b));
  }, []);

  const removeTile = useCallback((id) => {
    setBoard((b) =>
      b ? { ...b, sections: b.sections.map((s) => ({ ...s, tiles: s.tiles.filter((t) => t.id !== id) })).filter((s) => s.tiles.length || s.id === 'custom') } : b
    );
  }, []);

  const moveTile = useCallback((id, dir) => {
    setBoard((b) => {
      if (!b) return b;
      const sections = b.sections.map((s) => ({ ...s, tiles: [...s.tiles] }));
      for (const s of sections) {
        const i = s.tiles.findIndex((t) => t.id === id);
        if (i < 0) continue;
        const j = i + dir;
        if (j < 0 || j >= s.tiles.length) return b;
        [s.tiles[i], s.tiles[j]] = [s.tiles[j], s.tiles[i]];
        return { ...b, sections };
      }
      return b;
    });
  }, []);

  const addTile = useCallback(
    async (spec, { section = 'custom' } = {}) => {
      const tile = { w: 6, h: 4, ...spec, id: spec.id || newTileId(), edited: true, recaption: true };
      const [done] = await recompute([tile]);
      setBoard((b) => {
        if (!b) return b;
        const sections = [...b.sections];
        const i = sections.findIndex((s) => s.id === section);
        if (i >= 0) sections[i] = { ...sections[i], tiles: [...sections[i].tiles, done] };
        else sections.push({ id: section, title: 'Added', tiles: [done] });
        return { ...b, sections };
      });
      return done;
    },
    [recompute]
  );

  const updateKpi = useCallback(async (id, patch) => {
    const b = boardRef.current;
    if (!b) return;
    const k = b.kpis.find((x) => x.id === id);
    if (!k) return;
    const next = { ...k, ...patch };
    const res = await call('computeKpis', { kpis: [next], filters: filtersRef.current, ...settingsRef.current });
    setBoard((cur) => (cur ? { ...cur, kpis: cur.kpis.map((x) => (x.id === id ? { ...res.kpis[0], spark: patch.measures ? null : x.spark, delta: patch.measures ? null : x.delta } : x)) } : cur));
  }, []);

  const removeKpi = useCallback((id) => setBoard((b) => (b ? { ...b, kpis: b.kpis.filter((k) => k.id !== id) } : b)), []);

  const addKpi = useCallback(async (measureId) => {
    const m = engine?.measures?.find((x) => x.id === measureId);
    if (!m) return;
    const k = { id: newTileId(), kind: 'kpi', viz: 'kpi', measures: [m.id], title: m.label };
    const res = await call('computeKpis', { kpis: [k], filters: filtersRef.current, ...settingsRef.current });
    setBoard((b) => (b ? { ...b, kpis: [...b.kpis, res.kpis[0]] } : b));
  }, [engine]);

  /**
   * A correction to how a column was read, or a new measure. The reading
   * changes, so every tile is recomputed; "rebuild" re-plans the dashboard
   * around it.
   */
  const updateSettings = useCallback(
    async (next, { rebuild = false } = {}) => {
      setSettings(next);
      settingsRef.current = next;
      await describe(next);
      if (rebuild) return build({ useModel: false });
      const tiles = await recompute(allTiles(), filtersRef.current, next);
      replaceTiles(tiles);
      const b = boardRef.current;
      if (b) {
        const kpis = await call('computeKpis', { kpis: b.kpis, filters: filtersRef.current, ...next });
        setBoard((cur) => (cur ? { ...cur, kpis: kpis.kpis } : cur));
      }
      return null;
    },
    [describe, build, recompute, allTiles, replaceTiles]
  );

  const setFieldOverride = useCallback(
    (field, patch) => {
      const s = settingsRef.current;
      const overrides = { ...s.overrides };
      if (patch === null) delete overrides[field];
      else overrides[field] = { ...(overrides[field] || {}), ...patch };
      return updateSettings({ ...s, overrides }, { rebuild: true });
    },
    [updateSettings]
  );

  const saveMeasure = useCallback(
    (measure) => {
      const s = settingsRef.current;
      const custom = [...s.custom.filter((m) => m.id !== measure.id), { ...measure, origin: 'custom' }];
      return updateSettings({ ...s, custom });
    },
    [updateSettings]
  );

  const deleteMeasure = useCallback(
    (id) => {
      const s = settingsRef.current;
      return updateSettings({ ...s, custom: s.custom.filter((m) => m.id !== id) });
    },
    [updateSettings]
  );

  const fieldValues = useCallback((field) => call('fieldValues', { field }), []);

  /** Load a saved dashboard: its spec, recomputed against the current rows. */
  const restore = useCallback(
    async (saved) => {
      if (!saved?.sections) return;
      const s = saved.settings || { overrides: {}, custom: [] };
      setSettings(s);
      settingsRef.current = s;
      builtFor.current = datasetKey;
      await describe(s);
      const tiles = await recompute(saved.sections.flatMap((x) => x.tiles), saved.filters || [], s);
      const byId = new Map(tiles.map((t) => [t.id, t]));
      const kpis = await call('computeKpis', { kpis: saved.kpis || [], filters: saved.filters || [], ...s });
      setBoard({ ...saved, kpis: kpis.kpis, sections: saved.sections.map((x) => ({ ...x, tiles: x.tiles.map((t) => byId.get(t.id) || t) })) });
      setFiltersState(saved.filters || []);
      setStatus('ready');
    },
    [datasetKey, describe, recompute]
  );

  /**
   * Open a saved dashboard. With a table of the same columns loaded, it is
   * recomputed against the rows (and can be edited); otherwise it opens as
   * saved, read-only, from the numbers stored with it.
   */
  const openSaved = useCallback(
    async (saved) => {
      const cols = new Set(dataset?.columns || []);
      const needed = (saved.ds?.fields || []).map((f) => f.name);
      if (dataset && needed.length && needed.every((c) => cols.has(c))) return restore(saved);
      runRef.current++;
      setEngine({ ds: saved.ds, measures: saved.measures || [] });
      setSettings(saved.settings || { overrides: {}, custom: [] });
      setFiltersState([]);
      setBoard({ ...saved, readOnly: true });
      setStatus('ready');
      return null;
    },
    [dataset, restore]
  );

  /** An empty dashboard, to fill by hand. */
  const startBlank = useCallback(async () => {
    runRef.current++;
    builtFor.current = datasetKey;
    const e = await describe(settingsRef.current);
    setFiltersState([]);
    setBoard({ version: 2, generatedAt: Date.now(), kpis: [], sections: [], findings: [], summary: '', ds: e?.ds, measures: e?.measures || [], filters: [] });
    setAi({ used: false, reading: null, written: null });
    setStatus('ready');
  }, [datasetKey, describe]);

  /** The dashboard as it can be saved or exported: specs and words, no rows. */
  const snapshot = useCallback(() => {
    const b = boardRef.current;
    if (!b) return null;
    return {
      ...b,
      settings: settingsRef.current,
      filters: filtersRef.current,
      sections: b.sections.map((s) => ({ ...s, tiles: s.tiles.map((t) => bare(t)) })),
    };
  }, []);

  /** The dashboard with its computed numbers, for the library and exports. */
  const snapshotWithData = useCallback(() => {
    const b = boardRef.current;
    if (!b) return null;
    return { ...b, settings: settingsRef.current, filters: filtersRef.current, measures: engine?.measures || b.measures, ds: engine?.ds || b.ds };
  }, [engine]);

  const value = useMemo(
    () => ({
      board,
      filters,
      status,
      stage,
      error,
      engine,
      settings,
      ai,
      datasetKey,
      build,
      setFilters,
      toggleFilterValue,
      updateTile,
      patchTileLayout,
      removeTile,
      moveTile,
      addTile,
      updateKpi,
      removeKpi,
      addKpi,
      setFieldOverride,
      saveMeasure,
      deleteMeasure,
      fieldValues,
      restore,
      openSaved,
      startBlank,
      snapshot,
      snapshotWithData,
      describe,
    }),
    [board, filters, status, stage, error, engine, settings, ai, datasetKey, build, setFilters, toggleFilterValue, updateTile, patchTileLayout, removeTile, moveTile, addTile, updateKpi, removeKpi, addKpi, setFieldOverride, saveMeasure, deleteMeasure, fieldValues, restore, openSaved, startBlank, snapshot, snapshotWithData, describe]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
