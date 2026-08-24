/**
 * The engine worker owns the dataset.
 *
 * Every expensive thing — file parsing, sanitisation, relationship inference,
 * SQL execution, statistics — happens in here, off the main thread. Crucially
 * the row arrays never leave this worker: the UI asks for a page of rows, a
 * chart's aggregated result, or a set of computed findings, and gets back
 * kilobytes instead of hundreds of megabytes.
 *
 * Since multi-sheet support the worker holds *several* tables plus a data model
 * describing how they relate, and derives one joined "analysis view" from them.
 * Everything downstream — the planner, the insight engine, saved analyses —
 * still sees a single flat table, which is what keeps that machinery simple.
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
  nullifyStrayValues,
} from '../../lib/dataCleaner.js';
import {
  runAnalysis,
  mountTables,
  unmountTables,
  runSql,
  executeCharts,
  TABLE,
} from '../../lib/pipeline.js';
import { planCharts } from '../../lib/analystPlanner.js';
import { profileColumns } from '../../lib/chartResolver.js';
import { analyzeStoryboard } from '../../lib/insightEngine.js';
import {
  buildDataModel,
  buildAnalysisView,
  normalizeTableName,
  describeModel,
} from '../../lib/dataModel.js';
import { readWorkbook, isWorkbookFile } from '../../lib/workbook.js';
import { idbGet, idbSet, idbDel, KEYS } from '../../lib/store/idb.js';

/**
 * @type {{
 *   tables: Record<string, any>,
 *   order: string[],
 *   model: any,
 *   view: {rows:any[], columns:string[], provenance:any, joins:any[], skipped:any[]},
 *   viewProfile: any,
 *   viewSchema: string,
 *   metrics: any,
 *   fileName: string,
 *   notices: any[],
 *   ingestedAt: number
 * }|null}
 */
let state = null;

const reply = (id, type, payload) => self.postMessage({ id, type, payload });
const progress = (id, stage, percent, log) =>
  self.postMessage({ id, type: 'progress', payload: { stage, percent, log } });

// ---------------------------------------------------------------------------
// Summaries
// ---------------------------------------------------------------------------

/**
 * A compact, structure-clone-cheap description of the loaded session.
 *
 * The top-level fields describe the analysis view, because that is what every
 * page and every query actually operates on. A single-sheet upload therefore
 * produces exactly the shape the app has always received, and the `tables` and
 * `model` fields simply have nothing interesting in them.
 */
function summary() {
  if (!state) return null;
  return {
    fileName: state.fileName,
    rowCount: state.view.rows.length,
    columns: state.view.columns,
    schema: state.viewSchema,
    metrics: state.metrics,
    profile: state.viewProfile,
    ingestedAt: state.ingestedAt,
    preview: state.view.rows.slice(0, 50),

    // Multi-sheet additions.
    multiTable: state.order.length > 1,
    tables: state.order.map((name) => {
      const t = state.tables[name];
      const modelled = state.model.tables.find((m) => m.name === name) || {};
      return {
        name,
        sheetName: t.sheetName,
        sourceFile: t.sourceFile,
        rowCount: t.rows.length,
        columns: t.columns,
        role: modelled.role || 'fact',
        metrics: t.metrics,
        profile: t.profile,
        preview: t.rows.slice(0, 20),
      };
    }),
    model: {
      factTable: state.model.factTable,
      relationships: state.model.relationships,
      alternatives: state.model.alternatives,
      warnings: state.model.warnings,
      description: describeModel(state.model, state.tables),
    },
    view: {
      joins: state.view.joins,
      skipped: state.view.skipped,
      addedColumns: state.view.joins.flatMap((j) => j.addedColumns),
      provenance: state.view.provenance,
    },
    notices: state.notices,
  };
}

/** Column profile with the extra display facts the Explore page needs. */
function buildProfile(rows, columns, metrics) {
  const p = profileColumns(rows.slice(0, Math.min(rows.length, 20000)));
  // Now that the measures are known, blank the odd non-numeric cell inside
  // them. This is the one place that both knows which columns are numeric and
  // holds the rows, and every ingest path comes through it, so nothing
  // downstream has to defend itself against an "unknown" in a height column.
  nullifyStrayValues(rows, p.measures);
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

/**
 * Sanitise one sheet's raw rows into a table.
 *
 * Workbook rows arrive already materialised rather than streamed, so this
 * batches them through `sanitizeChunk` to keep the same code path — and the
 * same PII redaction and type coercion — as the CSV route.
 */
function buildTable({ name, sheetName, sourceFile, columns, rows }) {
  const metrics = createMetrics(columns, rows.length);
  const cleaned = [];
  const BATCH = 5000;
  for (let i = 0; i < rows.length; i += BATCH) {
    sanitizeChunk(rows.slice(i, i + BATCH), columns, metrics, cleaned);
  }
  metrics.totalRows = rows.length;
  metrics.totalCells = rows.length * columns.length;
  finalizeMetrics(cleaned, columns, metrics);

  return {
    name,
    sheetName: sheetName ?? null,
    sourceFile: sourceFile ?? null,
    rows: cleaned,
    columns,
    metrics,
    profile: buildProfile(cleaned, columns, metrics),
    schema: describeSchema(cleaned, name),
  };
}

/** Stream one CSV/TSV file or text blob into a cleaned table. */
function parseDelimited(source, { fileName, totalBytes = 0, onProgress }) {
  return new Promise((resolve, reject) => {
    let columns = null;
    let metrics = null;
    const cleaned = [];
    let rawRows = 0;

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
            reject(new Error(`No column headers found in ${fileName}. Is this a valid CSV?`));
            return;
          }
          metrics = createMetrics(columns, 0);
        }
        rawRows += results.data.length;
        sanitizeChunk(results.data, columns, metrics, cleaned);
        onProgress?.(totalBytes ? Math.min(1, results.meta.cursor / totalBytes) : 0.5, rawRows);
      },
      complete: () => {
        if (!columns) {
          reject(new Error(`${fileName} appears to be empty.`));
          return;
        }
        metrics.totalRows = rawRows;
        metrics.totalCells = rawRows * columns.length;
        finalizeMetrics(cleaned, columns, metrics);
        resolve({ columns, rows: cleaned, metrics });
      },
      error: (err) => reject(new Error(err?.message || `Failed to parse ${fileName}`)),
    });
  });
}

/**
 * Ingest one or more files. Each CSV becomes one table; each usable sheet of a
 * workbook becomes one table. Relationships are inferred across all of them.
 */
async function ingest(id, { files, file, text, fileName, factTable = null }) {
  const inputs = files && files.length ? files : file ? [file] : [];
  const notices = [];
  const taken = new Set();
  const pending = [];

  const totalUnits = Math.max(inputs.length || 1, 1);
  let unit = 0;
  const unitProgress = (fraction, stage, log) =>
    progress(id, stage, Math.min(80, Math.round(((unit + fraction) / totalUnits) * 78) + 2), log);

  if (inputs.length === 0 && text) {
    progress(id, 'Reading data', 4, `Reading ${fileName || 'pasted data'}`);
    const name = fileName || 'dataset.csv';
    const { columns, rows, metrics } = await parseDelimited(text, {
      fileName: name,
      totalBytes: text.length,
      onProgress: (f, n) => unitProgress(f, 'Cleaning rows', `${n.toLocaleString()} rows read`),
    });
    const tableName = normalizeTableName(name, taken);
    taken.add(tableName);
    pending.push({ name: tableName, sheetName: null, sourceFile: name, columns, rows, metrics });
  }

  for (const f of inputs) {
    const name = f.name || 'dataset';

    if (isWorkbookFile(name)) {
      unitProgress(0.05, 'Reading workbook', `Opening ${name}`);
      const buffer = await f.arrayBuffer();
      const { sheets, skipped } = readWorkbook(buffer, { fileName: name });

      for (const s of skipped) {
        notices.push({
          kind: 'sheet-skipped',
          file: name,
          sheet: s.sheetName,
          message: `Sheet "${s.sheetName}" was skipped — ${s.reason}.`,
        });
      }
      if (sheets.length === 0) {
        throw new Error(`No table could be found on any sheet of ${name}.`);
      }

      sheets.forEach((s, i) => {
        unitProgress(
          0.1 + (0.85 * (i + 1)) / sheets.length,
          'Cleaning sheets',
          `${s.sheetName}: ${s.rows.length.toLocaleString()} rows`
        );
        const tableName = normalizeTableName(s.sheetName, taken);
        taken.add(tableName);
        pending.push({
          name: tableName,
          sheetName: s.sheetName,
          sourceFile: name,
          columns: s.columns,
          rows: s.rows,
          metrics: null,
        });
        if (s.totalsRowsRemoved) {
          notices.push({
            kind: 'totals-removed',
            file: name,
            sheet: s.sheetName,
            message: `Removed ${s.totalsRowsRemoved} totals row(s) from "${s.sheetName}" — a summary line is not a record.`,
          });
        }
      });
    } else {
      unitProgress(0.05, 'Reading file', `Reading ${name}`);
      const { columns, rows, metrics } = await parseDelimited(f, {
        fileName: name,
        totalBytes: f.size || 0,
        onProgress: (fr, n) => unitProgress(fr, 'Cleaning rows', `${n.toLocaleString()} rows read`),
      });
      const tableName = normalizeTableName(name, taken);
      taken.add(tableName);
      pending.push({ name: tableName, sheetName: null, sourceFile: name, columns, rows, metrics });
    }
    unit++;
  }

  if (pending.length === 0) throw new Error('No data was provided.');

  // Workbook sheets still need sanitising; CSVs were cleaned as they streamed
  // and already carry their metrics.
  progress(id, 'Profiling columns', 82, 'Inferring column types');
  const tables = {};
  const order = [];
  for (const p of pending) {
    const table = p.metrics
      ? {
          name: p.name,
          sheetName: p.sheetName,
          sourceFile: p.sourceFile,
          rows: p.rows,
          columns: p.columns,
          metrics: p.metrics,
          profile: buildProfile(p.rows, p.columns, p.metrics),
          schema: describeSchema(p.rows, p.name),
        }
      : buildTable(p);
    tables[table.name] = table;
    order.push(table.name);
  }

  progress(
    id,
    'Relating sheets',
    88,
    order.length > 1 ? `Looking for keys across ${order.length} tables` : 'Profiling keys'
  );
  const model = buildDataModel(
    order.map((n) => tables[n]),
    { factTable }
  );
  for (const w of model.warnings) notices.push({ kind: 'many-to-many', message: w.message });

  progress(
    id,
    'Joining sheets',
    94,
    model.relationships.length ? `${model.relationships.length} relationship(s) found` : 'Single table'
  );
  const view = buildAnalysisView(tables, model);
  const metrics = rollUpMetrics(tables, view);

  const sourceName =
    inputs.length === 1
      ? inputs[0].name
      : inputs.length > 1
        ? `${inputs.length} files`
        : fileName || 'dataset.csv';

  state = {
    tables,
    order,
    model,
    view,
    viewProfile: buildProfile(view.rows, view.columns, metrics),
    viewSchema: describeSchema(view.rows, TABLE),
    metrics,
    fileName: sourceName,
    notices,
    ingestedAt: Date.now(),
  };

  invalidateSearchIndex();

  progress(id, 'Ready', 100, `${view.rows.length.toLocaleString()} rows ready`);
  reply(id, 'ingested', summary());
  persist();
}

/**
 * Ingest tables fetched from a connected database.
 *
 * The rows arrive already materialised over the network rather than streamed
 * off disk, but from here on nothing is different: they go through the same
 * sanitisation, the same relationship inference and the same joined view as a
 * workbook's sheets. Pulling three related tables from Postgres therefore gets
 * join detection for free, because that work was already done for spreadsheets.
 */
async function ingestRemote(id, { tables, sourceLabel, factTable = null }) {
  if (!tables?.length) throw new Error('No tables were returned.');

  progress(id, 'Cleaning rows', 20, `${tables.length} table(s) received`);

  const taken = new Set();
  const built = {};
  const order = [];
  const notices = [];

  tables.forEach((t, i) => {
    const tableName = normalizeTableName(t.label || t.name || `Table_${i + 1}`, taken);
    taken.add(tableName);

    progress(
      id,
      'Cleaning rows',
      20 + Math.round(((i + 1) / tables.length) * 55),
      `${tableName}: ${(t.rows?.length || 0).toLocaleString()} rows`
    );

    const table = buildTable({
      name: tableName,
      sheetName: null,
      sourceFile: sourceLabel || 'Connected database',
      columns: t.columns?.length ? t.columns : Object.keys(t.rows?.[0] || {}),
      rows: t.rows || [],
    });
    built[tableName] = table;
    order.push(tableName);

    // A truncated result is the one thing that must never pass silently: every
    // total computed downstream would be a fraction of the real one.
    if (t.truncated) {
      notices.push({
        kind: 'truncated',
        message: `${tableName} was capped at ${(t.rowCount || t.rows.length).toLocaleString()} rows. Every total below covers only that sample, not the whole table.`,
      });
    }
  });

  progress(id, 'Relating tables', 82, order.length > 1 ? `Looking for keys across ${order.length} tables` : 'Profiling keys');
  const model = buildDataModel(order.map((n) => built[n]), { factTable });
  for (const w of model.warnings) notices.push({ kind: 'many-to-many', message: w.message });

  progress(id, 'Joining tables', 92, model.relationships.length ? `${model.relationships.length} relationship(s) found` : 'Single table');
  const view = buildAnalysisView(built, model);
  const metrics = rollUpMetrics(built, view);

  state = {
    tables: built,
    order,
    model,
    view,
    viewProfile: buildProfile(view.rows, view.columns, metrics),
    viewSchema: describeSchema(view.rows, TABLE),
    metrics,
    fileName: sourceLabel || 'Connected database',
    notices,
    ingestedAt: Date.now(),
  };

  invalidateSearchIndex();

  progress(id, 'Ready', 100, `${view.rows.length.toLocaleString()} rows ready`);
  reply(id, 'ingested', summary());
  persist();
}

/**
 * Workbook-wide cleaning totals, plus per-column stats keyed by the *view's*
 * column names so the Explore and Quality pages can look them up directly.
 */
function rollUpMetrics(tables, view) {
  const out = {
    totalRows: 0,
    droppedRows: 0,
    anomalies: 0,
    redactedPII: 0,
    nullsFound: 0,
    typesCoerced: 0,
    outliersCount: 0,
    totalAnomalies: 0,
    totalCells: 0,
    cleanRows: view.rows.length,
    columnStats: {},
  };
  for (const name of Object.keys(tables)) {
    const m = tables[name].metrics || {};
    out.totalRows += m.totalRows || 0;
    out.droppedRows += m.droppedRows || 0;
    out.anomalies += m.anomalies || 0;
    out.redactedPII += m.redactedPII || 0;
    out.nullsFound += m.nullsFound || 0;
    out.typesCoerced += m.typesCoerced || 0;
    out.outliersCount += m.outliersCount || 0;
    out.totalAnomalies += m.totalAnomalies || 0;
    out.totalCells += m.totalCells || 0;
  }
  for (const col of view.columns) {
    const p = view.provenance[col];
    const src = p && tables[p.table];
    if (src) out.columnStats[col] = src.metrics.columnStats[p.column] || {};
  }
  return out;
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/** Total rows across every table — the real cost of persisting a session. */
function totalRows() {
  return state ? state.order.reduce((n, t) => n + state.tables[t].rows.length, 0) : 0;
}

async function persist() {
  if (!state) return;
  // Very large sessions are not worth (or able to be) persisted; the session
  // still works, it just won't survive a refresh.
  if (totalRows() > 400000) return;
  await idbSet(KEYS.dataset, {
    tables: state.tables,
    order: state.order,
    model: state.model,
    fileName: state.fileName,
    notices: state.notices,
    ingestedAt: state.ingestedAt,
  });
}

async function restore(id) {
  if (state) {
    reply(id, 'restored', { dataset: summary(), analysis: await idbGet(KEYS.analysis) });
    return;
  }
  const saved = await idbGet(KEYS.dataset);
  const revived = saved ? reviveSession(saved) : null;
  if (!revived) {
    reply(id, 'restored', { dataset: null, analysis: null });
    return;
  }
  state = revived;
  invalidateSearchIndex();
  reply(id, 'restored', { dataset: summary(), analysis: await idbGet(KEYS.analysis) });
}

/**
 * Rebuild in-memory state from a stored session.
 *
 * Sessions saved before multi-sheet support are a single `{rows, columns, ...}`
 * blob; they are promoted to a one-table model rather than thrown away, so a
 * tab that refreshes after a deploy keeps its data.
 */
function reviveSession(saved) {
  if (saved.tables && saved.order?.length) {
    const model = saved.model || buildDataModel(saved.order.map((n) => saved.tables[n]));
    const view = buildAnalysisView(saved.tables, model);
    const metrics = rollUpMetrics(saved.tables, view);
    return {
      tables: saved.tables,
      order: saved.order,
      model,
      view,
      viewProfile: buildProfile(view.rows, view.columns, metrics),
      viewSchema: describeSchema(view.rows, TABLE),
      metrics,
      fileName: saved.fileName,
      notices: saved.notices || [],
      ingestedAt: saved.ingestedAt,
    };
  }

  if (!saved.rows?.length) return null;
  const name = normalizeTableName(saved.fileName || 'Dataset');
  const table = {
    name,
    sheetName: null,
    sourceFile: saved.fileName || null,
    rows: saved.rows,
    columns: saved.columns,
    metrics: saved.metrics,
    profile: saved.profile,
    schema: saved.schema,
  };
  const tables = { [name]: table };
  const model = buildDataModel([table]);
  const view = buildAnalysisView(tables, model);
  return {
    tables,
    order: [name],
    model,
    view,
    viewProfile: saved.profile,
    viewSchema: saved.schema,
    metrics: saved.metrics,
    fileName: saved.fileName,
    notices: [],
    ingestedAt: saved.ingestedAt,
  };
}

// ---------------------------------------------------------------------------
// Model editing
// ---------------------------------------------------------------------------

/**
 * Apply a user's corrections to the inferred model and rebuild the view.
 *
 * Inferred joins are wrong often enough that this has to exist: analysing on a
 * bad guess produces confident, precise, false numbers.
 */
function setModel(id, { factTable = null, relationships = null }) {
  if (!state) {
    reply(id, 'error', { message: 'No dataset loaded.' });
    return;
  }
  const tables = state.order.map((n) => state.tables[n]);
  const rebuilt = buildDataModel(tables, { factTable: factTable ?? state.model.factTable });
  if (relationships) rebuilt.relationships = relationships;

  const view = buildAnalysisView(state.tables, rebuilt);
  const metrics = rollUpMetrics(state.tables, view);
  state.model = rebuilt;
  state.view = view;
  state.metrics = metrics;
  state.viewProfile = buildProfile(view.rows, view.columns, metrics);
  state.viewSchema = describeSchema(view.rows, TABLE);
  invalidateSearchIndex();

  reply(id, 'model', summary());
  persist();
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

/** Every source table, by name, ready to mount alongside the view. */
function sourceRows() {
  const out = {};
  for (const n of state.order) out[n] = state.tables[n].rows;
  return out;
}

function analyze(id, { focus, maxCharts }) {
  if (!state) {
    reply(id, 'error', { message: 'No dataset loaded.' });
    return;
  }
  const result = runAnalysis(state.view.rows, {
    focus,
    maxCharts,
    tables: sourceRows(),
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
  const mounted = mountTables({ tables: sourceRows(), view: state.view.rows });
  try {
    const charts = executeCharts([{ ...spec, id: spec.id || 'ask_1' }], state.view.rows);
    // Compute the same verified findings a dashboard slide gets, so an ad-hoc
    // answer is grounded in real statistics rather than the model's guess.
    const { perChart } = analyzeStoryboard(charts, state.view.rows);
    reply(id, 'asked', { chart: charts[0] || null, finding: perChart[0] || null });
  } catch (e) {
    reply(id, 'error', { message: e.message });
  } finally {
    unmountTables(mounted);
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

  const candidates = planCharts(state.view.rows, { max: 12 });
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

/**
 * Raw SQL escape hatch, used by the SQL console.
 *
 * Every source table is mounted under its own name alongside the joined view,
 * so a user can write a genuine cross-sheet JOIN here.
 */
function sql(id, { query }) {
  if (!state) {
    reply(id, 'error', { message: 'No dataset loaded.' });
    return;
  }
  const mounted = mountTables({ tables: sourceRows(), view: state.view.rows });
  try {
    const rows = runSql(query);
    reply(id, 'sqlResult', { rows: rows.slice(0, 500), truncated: rows.length > 500, total: rows.length });
  } catch (e) {
    reply(id, 'error', { message: e.message });
  } finally {
    unmountTables(mounted);
  }
}

// ---------------------------------------------------------------------------
// Row access (paged, sorted, filtered — always a small slice)
// ---------------------------------------------------------------------------

/** The rows and columns a row-access command should operate on. */
function target(tableName) {
  if (tableName && state.tables[tableName]) {
    const t = state.tables[tableName];
    return { key: tableName, rows: t.rows, columns: t.columns };
  }
  return { key: TABLE, rows: state.view.rows, columns: state.view.columns };
}

/**
 * Lowercased "all columns joined" text per row, built once and reused.
 *
 * Searching without this re-stringified and re-lowercased every cell on every
 * keystroke — 1.8M string allocations per character on a 200k-row file. Built
 * lazily so a table that is never searched pays nothing for it, and keyed by
 * table so switching sheets rebuilds it rather than searching the wrong rows.
 */
let searchIdx = null;
let searchIdxTable = null;

function invalidateSearchIndex() {
  searchIdx = null;
  searchIdxTable = null;
}

function searchIndex({ key, rows, columns }) {
  if (searchIdx && searchIdxTable === key) return searchIdx;
  const idx = new Array(rows.length);
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    let s = '';
    for (let c = 0; c < columns.length; c++) {
      const v = r[columns[c]];
      if (v !== null && v !== undefined) s += v + '';
    }
    idx[i] = s.toLowerCase();
  }
  searchIdx = idx;
  searchIdxTable = key;
  return idx;
}

function page(
  id,
  { offset = 0, limit = 50, sortBy = null, sortDir = 'asc', filter = '', anomaliesOnly = false, table = null }
) {
  if (!state) {
    reply(id, 'page', { rows: [], total: 0, offset, limit });
    return;
  }
  const t = target(table);
  let rows = t.rows;

  if (anomaliesOnly) rows = rows.filter((r) => r.isAnomaly);

  if (filter) {
    const needle = filter.toLowerCase();
    if (rows === t.rows) {
      // Fast path: scan the prebuilt index positionally.
      const index = searchIndex(t);
      const out = [];
      for (let i = 0; i < index.length; i++) {
        if (index[i].includes(needle)) out.push(t.rows[i]);
      }
      rows = out;
    } else {
      // Already filtered (outliers only), so fall back to a direct scan over the
      // much smaller subset.
      const cols = t.columns;
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
    table: t.key,
  });
}

/** Serialise a cleaned table (the joined view by default) to CSV for download. */
function exportCsv(id, { table = null } = {}) {
  if (!state) {
    reply(id, 'error', { message: 'No dataset loaded.' });
    return;
  }
  const t = target(table);
  const csv = Papa.unparse(
    t.rows.map(({ isAnomaly, ...rest }) => rest),
    { columns: t.columns }
  );
  const base = String(state.fileName).replace(/\.(csv|tsv|txt|xlsx?|xlsm)$/i, '');
  const suffix = t.key === TABLE ? 'cleaned' : `${t.key}_cleaned`;
  reply(id, 'csv', { csv, fileName: `${base}_${suffix}.csv` });
}

async function reset(id) {
  state = null;
  invalidateSearchIndex();
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
        return await ingest(id, payload);
      case 'ingestRemote':
        return await ingestRemote(id, payload);
      case 'restore':
        return restore(id);
      case 'setModel':
        return setModel(id, payload);
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
        return exportCsv(id, payload);
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
