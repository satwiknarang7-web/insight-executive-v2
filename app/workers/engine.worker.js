/**
 * The engine worker owns the dataset.
 *
 * Every expensive thing — CSV parsing, sanitisation, SQL execution, statistics —
 * happens in here, off the main thread. Crucially the row array itself never
 * leaves this worker: the UI asks for a page of rows, a chart's aggregated
 * result, or a set of computed findings, and gets back kilobytes instead of
 * hundreds of megabytes.
 *
 * The old design did the opposite — it JSON.stringify'd the whole cleaned
 * dataset and POSTed it to /api/query on every analysis, which is what made the
 * app hang on anything bigger than a toy CSV.
 *
 * Protocol: { id, type, payload } in, { id, type, payload } out. `progress`
 * messages may be emitted any number of times before the terminal reply.
 */
import Papa from 'papaparse';
import {
  createMetrics,
  sanitizeChunk,
  finalizeMetrics,
  describeSchema,
} from '../../lib/dataCleaner.js';
import { runAnalysis, mountTable, unmountTable, runSql, executeCharts } from '../../lib/pipeline.js';
import { planCharts } from '../../lib/analystPlanner.js';
import { profileColumns } from '../../lib/chartResolver.js';
import { analyzeStoryboard } from '../../lib/insightEngine.js';
import { idbGet, idbSet, idbDel, KEYS } from '../../lib/store/idb.js';

/** @type {{rows: any[], columns: string[], schema: string, metrics: any, fileName: string, ingestedAt: number}|null} */
let state = null;

const reply = (id, type, payload) => self.postMessage({ id, type, payload });
const progress = (id, stage, percent, log) =>
  self.postMessage({ id, type: 'progress', payload: { stage, percent, log } });

/** A compact, structure-clone-cheap description of the loaded dataset. */
function summary() {
  if (!state) return null;
  return {
    fileName: state.fileName,
    rowCount: state.rows.length,
    columns: state.columns,
    schema: state.schema,
    metrics: state.metrics,
    profile: state.profile,
    ingestedAt: state.ingestedAt,
    preview: state.rows.slice(0, 50),
  };
}

/** Column profile with the extra display facts the Explore page needs. */
function buildProfile(rows, columns, metrics) {
  const p = profileColumns(rows.slice(0, Math.min(rows.length, 20000)));
  const byName = {};
  for (const col of columns) {
    const stat = metrics.columnStats[col] || {};
    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    let count = 0;
    if (stat.type === 'number') {
      for (let i = 0; i < rows.length; i++) {
        const v = rows[i][col];
        if (typeof v === 'number') {
          if (v < min) min = v;
          if (v > max) max = v;
          sum += v;
          count++;
        }
      }
    }
    byName[col] = {
      name: col,
      type: stat.type || 'unknown',
      role: p.measures.includes(col)
        ? 'measure'
        : p.temporal.includes(col)
          ? 'time'
          : p.dimensions.includes(col)
            ? 'dimension'
            : 'identifier',
      nullCount: stat.nullCount || 0,
      distinctCount: stat.distinctCount || 0,
      distinctCapped: !!stat.distinctCapped,
      min: count ? min : null,
      max: count ? max : null,
      mean: count ? sum / count : null,
    };
  }
  return { columns: byName, measures: p.measures, dimensions: p.dimensions, temporal: p.temporal };
}

// ---------------------------------------------------------------------------
// Ingestion
// ---------------------------------------------------------------------------

function ingest(id, { file, text, fileName }) {
  const name = fileName || file?.name || 'dataset.csv';
  const source = file || text;
  const totalBytes = file?.size || (text ? text.length : 0);

  let columns = null;
  let metrics = null;
  const cleaned = [];
  let rawRows = 0;

  progress(id, 'Reading file', 2, `Reading ${name}`);

  Papa.parse(source, {
    header: true,
    skipEmptyLines: 'greedy',
    dynamicTyping: false,
    chunkSize: 1024 * 512,
    chunk: (results, parser) => {
      if (!columns) {
        columns = (results.meta.fields || []).filter((f) => f && f.trim() !== '');
        if (columns.length === 0) {
          parser.abort();
          reply(id, 'error', { message: 'No column headers found. Is this a valid CSV?' });
          return;
        }
        metrics = createMetrics(columns, 0);
        progress(id, 'Reading file', 8, `Detected ${columns.length} columns`);
      }
      rawRows += results.data.length;
      sanitizeChunk(results.data, columns, metrics, cleaned);

      const pct = totalBytes ? Math.min(78, 8 + Math.round((results.meta.cursor / totalBytes) * 70)) : 45;
      progress(id, 'Cleaning rows', pct, rawRows % 20000 < results.data.length ? `${rawRows.toLocaleString()} rows read` : undefined);
    },
    complete: () => {
      if (!columns) {
        reply(id, 'error', { message: 'The file appears to be empty.' });
        return;
      }
      metrics.totalRows = rawRows;
      metrics.totalCells = rawRows * columns.length;

      progress(id, 'Profiling columns', 84, 'Inferring column types');
      finalizeMetrics(cleaned, columns, metrics);

      progress(id, 'Detecting outliers', 92, `Flagged ${metrics.outliersCount.toLocaleString()} outliers`);
      const schema = describeSchema(cleaned);
      const profile = buildProfile(cleaned, columns, metrics);

      searchIdx = null;
      state = {
        rows: cleaned,
        columns,
        schema,
        metrics,
        profile,
        fileName: name,
        ingestedAt: Date.now(),
      };

      progress(id, 'Ready', 100, `${cleaned.length.toLocaleString()} rows ready`);
      reply(id, 'ingested', summary());
      persist();
    },
    error: (err) => reply(id, 'error', { message: err?.message || 'CSV parse failed' }),
  });
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

async function persist() {
  if (!state) return;
  // Very large datasets are not worth (or able to be) persisted; the session
  // still works, it just won't survive a refresh.
  if (state.rows.length > 400000) return;
  await idbSet(KEYS.dataset, {
    rows: state.rows,
    columns: state.columns,
    schema: state.schema,
    metrics: state.metrics,
    profile: state.profile,
    fileName: state.fileName,
    ingestedAt: state.ingestedAt,
  });
}

async function restore(id) {
  if (state) {
    reply(id, 'restored', { dataset: summary(), analysis: await idbGet(KEYS.analysis) });
    return;
  }
  const saved = await idbGet(KEYS.dataset);
  if (!saved || !saved.rows?.length) {
    reply(id, 'restored', { dataset: null, analysis: null });
    return;
  }
  state = saved;
  searchIdx = null;
  reply(id, 'restored', { dataset: summary(), analysis: await idbGet(KEYS.analysis) });
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

function analyze(id, { focus, maxCharts }) {
  if (!state) {
    reply(id, 'error', { message: 'No dataset loaded.' });
    return;
  }
  const result = runAnalysis(state.rows, {
    focus,
    maxCharts,
    onProgress: ({ stage, percent }) => progress(id, stage, percent),
  });
  reply(id, 'analyzed', result);
}

/** Execute an ad-hoc chart spec (from the Ask page) against the dataset. */
function askExecute(id, { spec }) {
  if (!state) {
    reply(id, 'error', { message: 'No dataset loaded.' });
    return;
  }
  mountTable(state.rows);
  try {
    const charts = executeCharts([{ ...spec, id: spec.id || 'ask_1' }], state.rows);
    // Compute the same verified findings a dashboard slide gets, so an ad-hoc
    // answer is grounded in real statistics rather than the model's guess.
    const { perChart } = analyzeStoryboard(charts, state.rows);
    reply(id, 'asked', { chart: charts[0] || null, finding: perChart[0] || null });
  } catch (e) {
    reply(id, 'error', { message: e.message });
  } finally {
    unmountTable();
  }
}

/**
 * Offline fallback for the Ask page: score the deterministic planner's own
 * candidates against the words in the question and run the best one. Keeps
 * natural-language questions working with no API key configured at all.
 */
function suggest(id, { question }) {
  if (!state) {
    reply(id, 'error', { message: 'No dataset loaded.' });
    return;
  }
  const words = String(question || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));

  const candidates = planCharts(state.rows, { max: 12 });
  let best = candidates[0] || null;
  let bestScore = -1;

  for (const c of candidates) {
    const haystack = `${c.title} ${c.xAxisKey} ${c.yAxisKey} ${c.dimension || ''}`.toLowerCase();
    let score = 0;
    for (const w of words) if (haystack.includes(w)) score += 1;
    // Nudge toward the chart shape the question implies.
    if (/trend|over time|growth|month|year/.test(question) && /line|area/.test(c.chart_type)) score += 1.5;
    if (/share|proportion|percent|split|composition/.test(question) && /donut|treemap/.test(c.chart_type)) score += 1.5;
    if (/compare|top|highest|lowest|rank|best|worst/.test(question) && c.chart_type === 'bar') score += 1;
    if (/correlat|relationship|versus|vs\b/.test(question) && c.chart_type === 'scatter') score += 1.5;
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }

  if (!best) {
    reply(id, 'suggested', { spec: null });
    return;
  }
  reply(id, 'suggested', {
    spec: { ...best, id: 'ask_1' },
    matched: bestScore > 0,
  });
}

const STOPWORDS = new Set([
  'the', 'and', 'for', 'what', 'which', 'how', 'many', 'much', 'show', 'give',
  'tell', 'about', 'with', 'from', 'that', 'this', 'are', 'was', 'were', 'does',
  'did', 'our', 'their', 'have', 'has', 'per', 'all', 'any', 'across', 'into',
]);

/** Raw SQL escape hatch, used by the SQL console. */
function sql(id, { query }) {
  if (!state) {
    reply(id, 'error', { message: 'No dataset loaded.' });
    return;
  }
  mountTable(state.rows);
  try {
    const rows = runSql(query);
    reply(id, 'sqlResult', { rows: rows.slice(0, 500), truncated: rows.length > 500, total: rows.length });
  } catch (e) {
    reply(id, 'error', { message: e.message });
  } finally {
    unmountTable();
  }
}

// ---------------------------------------------------------------------------
// Row access (paged, sorted, filtered — always a small slice)
// ---------------------------------------------------------------------------

/**
 * Lowercased "all columns joined" text per row, built once and reused.
 *
 * Searching without this re-stringified and re-lowercased every cell on every
 * keystroke — 1.8M string allocations per character on a 200k-row file. Built
 * lazily so datasets that are never searched pay nothing for it.
 */
let searchIdx = null;
function searchIndex() {
  if (searchIdx) return searchIdx;
  const cols = state.columns;
  const rows = state.rows;
  const idx = new Array(rows.length);
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    let s = '';
    for (let c = 0; c < cols.length; c++) {
      const v = r[cols[c]];
      if (v !== null && v !== undefined) s += v + '';
    }
    idx[i] = s.toLowerCase();
  }
  searchIdx = idx;
  return idx;
}

function page(id, { offset = 0, limit = 50, sortBy = null, sortDir = 'asc', filter = '', anomaliesOnly = false }) {
  if (!state) {
    reply(id, 'page', { rows: [], total: 0, offset, limit });
    return;
  }
  let rows = state.rows;

  if (anomaliesOnly) rows = rows.filter((r) => r.isAnomaly);

  if (filter) {
    const needle = filter.toLowerCase();
    const index = searchIndex();
    if (rows === state.rows) {
      // Fast path: scan the prebuilt index positionally.
      const out = [];
      for (let i = 0; i < index.length; i++) {
        if (index[i].includes(needle)) out.push(state.rows[i]);
      }
      rows = out;
    } else {
      // Already filtered (outliers only), so fall back to a direct scan over the
      // much smaller subset.
      const cols = state.columns;
      rows = rows.filter((r) => {
        for (let c = 0; c < cols.length; c++) {
          const v = r[cols[c]];
          if (v !== null && v !== undefined && String(v).toLowerCase().includes(needle)) return true;
        }
        return false;
      });
    }
  }

  if (sortBy) {
    const dir = sortDir === 'desc' ? -1 : 1;
    rows = [...rows].sort((a, b) => {
      const av = a[sortBy];
      const bv = b[sortBy];
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }

  reply(id, 'page', {
    rows: rows.slice(offset, offset + limit),
    total: rows.length,
    offset,
    limit,
  });
}

/** Serialise the cleaned dataset to CSV text for download. */
function exportCsv(id) {
  if (!state) {
    reply(id, 'error', { message: 'No dataset loaded.' });
    return;
  }
  const csv = Papa.unparse(
    state.rows.map(({ isAnomaly, ...rest }) => rest),
    { columns: state.columns }
  );
  reply(id, 'csv', { csv, fileName: state.fileName.replace(/\.csv$/i, '') + '_cleaned.csv' });
}

async function reset(id) {
  state = null;
  searchIdx = null;
  await idbDel(KEYS.dataset);
  await idbDel(KEYS.analysis);
  reply(id, 'reset', {});
}

// ---------------------------------------------------------------------------

self.onmessage = async (e) => {
  const { id, type, payload = {} } = e.data || {};
  try {
    switch (type) {
      case 'ingest':
        return ingest(id, payload);
      case 'restore':
        return restore(id);
      case 'analyze':
        return analyze(id, payload);
      case 'ask':
        return askExecute(id, payload);
      case 'suggest':
        return suggest(id, payload);
      case 'sql':
        return sql(id, payload);
      case 'page':
        return page(id, payload);
      case 'exportCsv':
        return exportCsv(id);
      case 'saveAnalysis':
        await idbSet(KEYS.analysis, payload);
        return reply(id, 'saved', {});
      case 'reset':
        return reset(id);
      default:
        return reply(id, 'error', { message: `Unknown command: ${type}` });
    }
  } catch (err) {
    reply(id, 'error', { message: err?.message || String(err) });
  }
};
