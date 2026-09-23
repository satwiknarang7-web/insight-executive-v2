/**
 * A question, compiled into the charts that answer it — and into nothing that
 * breaks a rule.
 *
 * Phase 2 of docs/design/question-first-reports.md. The old planner built every
 * chart the column types allowed and then filtered out the ones a module had
 * learned to recognise as wrong. Here there is nothing to filter: each intent
 * has one compiler, and each compiler reads `lib/tableModel.js` before it writes
 * a line of SQL, so the rules in `eval/audit.mjs` hold because the query was
 * never able to break them:
 *
 *   I1  the axis is named after the expression it groups by, and a composed
 *       label gets an alias no column has
 *   I2  slices only ever show a sum or a count
 *   I3  a measure is filtered to one level of each column it is scoped by
 *   I4  a long table's value is split by the column naming its quantities
 *   I5  no row counts by category on a table of entities
 *   I6  a median wherever one row would decide the average
 *   I7  bands are cut only on a column other than the one measured
 *   I8  every "average across" sentence is the figure over the same rows the
 *       KPI is taken from (`baselineSql`, read in lib/insightEngine.js)
 *   I9  a time axis is cut as finely as it needs to have points on it, and a
 *       level is never bucketed coarser than the period it was recorded at
 *
 * I10 — what leads — is ordering, and happens in lib/pipeline.js once each
 * chart's evidence is known.
 *
 * Every spec carries `question`: the question it answers, shown above it.
 */

import { prettyColumn } from './aggregateNames.js';
import { outcomeAggregate } from './measureSemantics.js';
import { outlierInfluence } from './tableModel.js';

const TABLE = 'SalesData';
const br = (c) => `[${c}]`;
const lit = (v) => (typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const present = (v) => v !== null && v !== undefined && v !== '';
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const name = prettyColumn;

const TIME_GRAINS = [
  { prefix: 4, alias: 'Year' },
  { prefix: 7, alias: 'Month' },
  { prefix: 10, alias: 'Day' },
  { prefix: 13, alias: 'Hour' },
];
const MIN_POINTS = 4;
// A split shows every group it has: the catalogue never splits by more than
// twenty levels, and the top twelve of twenty is a ranking graded as measured
// "against the rows the query returned, not the whole dataset".
const ALL_LEVELS = 20;

/* ── Pieces every compiler uses ────────────────────────────────────────── */

/**
 * How to put a time column on an axis. Coarsest grain with enough points; a
 * level is never bucketed coarser than it was recorded, because a month of
 * weekly stock summed is four weeks of the same units.
 */
export function timeAxis(rows, col, { level = false } = {}) {
  const values = rows.map((r) => r?.[col]).filter(present);
  if (values.every(isNum)) return { expr: br(col), alias: name(col), points: new Set(values).size };
  const iso = values.map(String).filter((v) => /^\d{4}-\d{2}/.test(v));
  const raw = new Set(iso).size;
  for (const g of TIME_GRAINS) {
    const cut = new Set(iso.map((v) => v.slice(0, g.prefix))).size;
    if (level && cut !== raw) continue;
    if (cut >= MIN_POINTS || (level && cut === raw)) return { expr: `SUBSTRING(${br(col)}, 1, ${g.prefix})`, alias: g.alias, points: cut };
  }
  return { expr: br(col), alias: name(col), points: raw };
}

/**
 * The filter that makes a measure like-for-like: one level of every column it
 * is scoped by, the most common level among the rows that have it.
 */
function scopeFilter(rows, model, measures) {
  const where = [];
  const notes = [];
  const long = model.long;
  for (const m of measures.filter(Boolean)) {
    for (const s of model.measures[m]?.scope || []) {
      if (long && s === long.by && m === long.value) continue;
      if (where.some((w) => w.col === s)) continue;
      const counts = new Map();
      for (const r of rows) if (present(r?.[m]) && present(r?.[s])) counts.set(r[s], (counts.get(r[s]) || 0) + 1);
      if (counts.size <= 1) continue;
      const level = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
      where.push({ col: s, value: level });
      notes.push(`${name(s)}: ${level}`);
    }
  }
  return {
    sql: where.map((w) => `${br(w.col)} = ${lit(w.value)}`),
    // A dash, not brackets: the presentation audit trims a trailing
    // parenthetical from a long heading as carrying nothing, and which plans a
    // price was compared across is the one thing the heading must carry.
    title: notes.length ? ` — ${notes.join(', ')}` : '',
    keep: (r) => where.every((w) => String(r?.[w.col]) === String(w.value)),
  };
}

const whereClause = (parts) => (parts.length ? ` WHERE ${parts.join(' AND ')}` : '');

/**
 * SUM for a total, AVG for anything else — or MEDIAN when, inside any group
 * the chart will draw, one row would move the average by a quarter of its
 * median. The word comes back with it, so a sentence never calls a median an
 * average.
 */
function aggregateFor(rows, model, m, by = null, keep = () => true, { mean = false } = {}) {
  const info = model.measures[m];
  if (info?.sum && !mean) return { fn: 'SUM', word: 'total' };
  const groups = new Map();
  for (const r of rows) {
    if (!keep(r) || !isNum(r?.[m])) continue;
    const k = by ? String(r?.[by]) : '';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r[m]);
  }
  const decided = [...groups.values()].some((xs) => outlierInfluence(xs).influence > 0.25);
  return decided ? { fn: 'MEDIAN', word: 'median' } : { fn: 'AVG', word: 'average' };
}

// A column already called "Average Salary" is not averaged into "Average Average Salary".
const labelFor = (fn, m) => {
  const word = fn === 'SUM' ? 'Total' : fn === 'MEDIAN' ? 'Median' : 'Average';
  const n = name(m);
  return n.toLowerCase().startsWith(`${word.toLowerCase()} `) ? n : `${word} ${n}`;
};

/**
 * The row label of a table of entities: its key, or both halves of a pair in
 * file order — "OpenAI · Pro", general to specific, the way whoever built the
 * table named the thing.
 */
function entityLabel(model) {
  const key = [model.grain.key].flat().filter(Boolean);
  if (key.length === 1) return { expr: br(key[0]), alias: key[0], cols: key };
  if (key.length === 2) {
    const order = Object.keys(model.columns);
    const [a, b] = [...key].sort((x, y) => order.indexOf(x) - order.indexOf(y));
    return { expr: `CONCAT(${br(a)}, ' · ', ${br(b)})`, alias: `${name(a)} · ${name(b)}`, cols: key };
  }
  return null;
}

/** Quartile bands of a numeric driver, as a CASE and its labels in order. */
function bands(rows, col) {
  const values = rows.map((r) => r?.[col]).filter(isNum).sort((a, b) => a - b);
  const edges = [...new Set([0.25, 0.5, 0.75].map((q) => values[Math.floor(q * (values.length - 1))]))];
  const fmt = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
  const labels = [];
  let lo = values[0];
  const cases = edges.map((e) => {
    const label = `${fmt(lo)}–${fmt(e)}`;
    labels.push(label);
    lo = e;
    return `WHEN ${br(col)} <= ${e} THEN ${lit(label)}`;
  });
  const last = `${fmt(lo)}+`;
  labels.push(last);
  return { expr: `CASE ${cases.join(' ')} ELSE ${lit(last)} END`, labels };
}

/**
 * A split whose levels are numbers — support calls, a job level — keeps their
 * order. Ranked by the measure, "8 has the highest churn rate of any support
 * calls" reads as a league table of counts; in order, it reads as what it is,
 * a rate that climbs with the calls.
 */
function numericOrder(rows, col) {
  const values = [...new Set(rows.map((r) => r?.[col]).filter(present))];
  if (!values.length || !values.every(isNum)) return null;
  return values.sort((a, b) => a - b).map(String);
}

/** For a long table: its quantities, and whether they share one scale. */
function longLevels(rows, model) {
  const { value, by } = model.long;
  const groups = new Map();
  for (const r of rows) {
    if (!isNum(r?.[value]) || !present(r?.[by])) continue;
    if (!groups.has(r[by])) groups.set(r[by], []);
    groups.get(r[by]).push(Math.abs(r[value]));
  }
  const med = (xs) => [...xs].sort((a, b) => a - b)[xs.length >> 1];
  const levels = [...groups.entries()].sort((a, b) => b[1].length - a[1].length).map(([l]) => l);
  const sizes = [...groups.values()].map(med).filter((x) => x > 0);
  return { levels, shared: sizes.length >= 2 && Math.max(...sizes) / Math.min(...sizes) < 10 };
}

/* ── One compiler per intent ───────────────────────────────────────────── */

function trend(q, rows, model) {
  const m = q.measure;
  const level = !!(m && model.measures[m]?.noSumAcross?.includes(q.over));
  const axis = timeAxis(rows, q.over, { level });
  const long = model.long && m === model.long.value ? longLevels(rows, model) : null;

  const rate = q.outcome ? outcomeAggregate(q.outcome) : null;
  const one = (extraWhere, titleSuffix, seriesCol = null) => {
    const scope = scopeFilter(rows, model, [m]);
    const keep = (r) => scope.keep(r);
    const agg = m ? aggregateFor(rows, model, m, null, keep) : null;
    const y = rate ? rate.name : m ? labelFor(agg.fn, m) : 'Records';
    const yExpr = rate ? rate.expr : m ? `${agg.fn}(${br(m)})` : 'COUNT(*)';
    const where = whereClause([...scope.sql, ...extraWhere]);
    const series = seriesCol ? `, ${br(seriesCol)}` : '';
    return {
      title: `${y} over ${axis.alias.toLowerCase()}${titleSuffix}${scope.title}`,
      chart_type: m && model.measures[m]?.sum && !seriesCol ? 'area' : 'line',
      dimension: q.over,
      sql: `SELECT ${axis.expr} AS ${br(axis.alias)}${series}, ${yExpr} AS ${br(y)} FROM ${TABLE}${where} GROUP BY ${axis.expr}${series} ORDER BY ${br(axis.alias)} ASC`,
      xAxisKey: axis.alias,
      yAxisKey: y,
      ...(seriesCol ? { seriesKey: seriesCol } : {}),
    };
  };

  if (!long) return [one([], '')];
  const by = model.long.by;
  if (long.shared) return [one([], ` by ${name(by).toLowerCase()}`, by)];
  return long.levels.slice(0, 3).map((l) => one([`${br(by)} = ${lit(l)}`], ` — ${l}`));
}

function composition(q, rows, model) {
  const d = q.by;
  if (!q.measure) {
    // Row counts by category say something about events, not about entities.
    if (model.grain.kind === 'entity') return [];
    return [{
      title: `Records by ${name(d)}`,
      chart_type: 'hbar',
      dimension: d,
      sql: `SELECT ${br(d)}, COUNT(*) AS [Records] FROM ${TABLE} GROUP BY ${br(d)} ORDER BY [Records] DESC LIMIT 12`,
      xAxisKey: d,
      yAxisKey: 'Records',
    }];
  }
  const m = q.measure;
  const scope = scopeFilter(rows, model, [m]);
  // A level adds up across things within one period, never across periods:
  // the split is taken at the latest one.
  for (const t of model.measures[m]?.noSumAcross || []) {
    const latest = rows.map((r) => r?.[t]).filter(present).map(String).sort().pop();
    if (latest === undefined) continue;
    scope.sql.push(`${br(t)} = ${lit(latest)}`);
    scope.title += ` (latest ${name(t).toLowerCase()}: ${latest.slice(0, 10)})`;
    const prev = scope.keep;
    scope.keep = (r) => prev(r) && String(r?.[t]) === latest;
  }
  const y = `Total ${name(m)}`;
  const levels = new Set(rows.filter(scope.keep).map((r) => r?.[d]).filter(present)).size;
  if (levels < 2) return [];
  const negatives = rows.some((r) => isNum(r?.[m]) && r[m] < 0);
  return [{
    title: `${y} by ${name(d)}${scope.title}`,
    // Slices only for a whole that is a sum of positive parts.
    chart_type: levels <= 6 && !negatives ? 'donut' : 'hbar',
    dimension: d,
    sql: `SELECT ${br(d)}, SUM(${br(m)}) AS ${br(y)} FROM ${TABLE}${whereClause(scope.sql)} GROUP BY ${br(d)} ORDER BY ${br(y)} DESC LIMIT 12`,
    xAxisKey: d,
    yAxisKey: y,
  }];
}

function compare(q, rows, model) {
  const { measure: m, by: d } = q;
  const long = model.long && m === model.long.value ? longLevels(rows, model) : null;

  const one = (extraWhere, extraKeep, titleSuffix, seriesCol = null) => {
    const scope = scopeFilter(rows, model, [m]);
    const keep = (r) => scope.keep(r) && extraKeep(r);
    // Things are compared by their average; a total across entities is the
    // size of the group, not a property of its members.
    // A split the scope leaves with one group compares nothing: price by
    // audience, within per-user plans, is one audience.
    if (new Set(rows.filter(keep).map((r) => r?.[d]).filter(present)).size < 2) return null;
    const agg = aggregateFor(rows, model, m, d, keep, { mean: !!q.mean });
    const y = labelFor(agg.fn, m);
    const where = whereClause([...scope.sql, ...extraWhere]);
    const series = seriesCol ? `, ${br(seriesCol)}` : '';
    const order = numericOrder(rows, d);
    return {
      title: `${y} by ${name(d)}${titleSuffix}${scope.title}`,
      chart_type: seriesCol || order ? 'bar' : 'hbar',
      dimension: d,
      sql: `SELECT ${br(d)}${series}, ${agg.fn}(${br(m)}) AS ${br(y)} FROM ${TABLE}${where} GROUP BY ${br(d)}${series} HAVING COUNT(*) >= 2 ORDER BY ${order ? `${br(d)} ASC` : `${br(y)} DESC`} LIMIT ${ALL_LEVELS}`,
      ...(order ? { ordered: true, sortLabels: order } : {}),
      baselineSql: seriesCol || agg.fn === 'SUM' ? undefined : `SELECT ${agg.fn}(${br(m)}) AS [v] FROM ${TABLE}${where}`,
      baselineWord: agg.word,
      xAxisKey: d,
      yAxisKey: y,
      ...(seriesCol ? { seriesKey: seriesCol } : {}),
    };
  };

  if (!long) return [one([], () => true, '')].filter(Boolean);
  const by = model.long.by;
  if (long.shared) return [one([], () => true, ` and ${name(by).toLowerCase()}`, by)].filter(Boolean);
  return long.levels.slice(0, 3).map((l) => one([`${br(by)} = ${lit(l)}`], (r) => String(r?.[by]) === String(l), ` — ${l}`)).filter(Boolean);
}

function outcomeRate(q, rows) {
  const agg = outcomeAggregate(q.outcome);
  if (!agg) return [];
  if (!q.by) return []; // the headline rate is a KPI, not a chart
  const band = q.band ? bands(rows, q.by) : null;
  const order = band ? band.labels : numericOrder(rows, q.by);
  const x = band ? `${name(q.by)} Band` : q.by;
  const xExpr = band ? band.expr : br(q.by);
  return [{
    title: `${agg.name} by ${name(q.by)}`,
    chart_type: order ? 'bar' : 'hbar',
    dimension: x,
    sql: `SELECT ${xExpr} AS ${br(x)}, ${agg.expr} AS ${br(agg.name)} FROM ${TABLE} WHERE ${br(q.by)} IS NOT NULL GROUP BY ${xExpr} HAVING COUNT(*) >= 5 ORDER BY ${order ? `${br(x)} ASC` : `${br(agg.name)} DESC`} LIMIT ${ALL_LEVELS}`,
    baselineSql: `SELECT ${agg.expr} AS [v] FROM ${TABLE}`,
    baselineWord: 'average',
    xAxisKey: x,
    yAxisKey: agg.name,
    outcomeRate: { column: q.outcome.column, event: q.outcome.event, highIsGood: !!q.outcome.highIsGood, kind: q.outcome.kind || 'binary', format: agg.format },
    ...(order ? { ordered: true, sortLabels: order } : {}),
  }];
}

/**
 * One count as a share of another, by a split: conversions per session. The
 * ratio of the sums, never the mean of per-row ratios, so a day with ten
 * sessions does not count as much as a day with ten thousand.
 */
function ratio(q, rows, model) {
  const { measure: a, other: b, by: d } = q;
  const scope = scopeFilter(rows, model, [a, b]);
  if (new Set(rows.filter(scope.keep).map((r) => r?.[d]).filter(present)).size < 2) return [];
  const y = `${name(a)} per ${name(b)} (%)`;
  const where = whereClause(scope.sql);
  return [{
    title: `${name(a)} per ${name(b)} by ${name(d)}${scope.title}`,
    chart_type: 'hbar',
    dimension: d,
    sql: `SELECT ${br(d)}, SUM(${br(a)}) * 100.0 / SUM(${br(b)}) AS ${br(y)} FROM ${TABLE}${where} GROUP BY ${br(d)} HAVING SUM(${br(b)}) > 0 ORDER BY ${br(y)} DESC LIMIT ${ALL_LEVELS}`,
    baselineSql: `SELECT SUM(${br(a)}) * 100.0 / SUM(${br(b)}) AS [v] FROM ${TABLE}${where}`,
    baselineWord: 'average',
    xAxisKey: d,
    yAxisKey: y,
  }];
}

function rank(q, rows, model) {
  const label = entityLabel(model);
  if (!label) return [];
  const m = q.measure;
  const scope = scopeFilter(rows, model, [m]);
  // The top twelve are compared with every row, not with each other: the mean
  // of a top twelve is a number nobody else on the page has (rule I8).
  const agg = aggregateFor(rows, model, m, null, scope.keep, { mean: true });
  return [{
    title: `Top ${name(label.alias)} by ${name(m)}${scope.title}`,
    chart_type: 'hbar',
    dimension: label.alias,
    rowLevel: true,
    sql: `SELECT ${label.expr} AS ${br(label.alias)}, ${br(m)} FROM ${TABLE}${whereClause([`${br(m)} IS NOT NULL`, ...scope.sql])} ORDER BY ${br(m)} DESC LIMIT 12`,
    baselineSql: `SELECT ${agg.fn}(${br(m)}) AS [v] FROM ${TABLE}${whereClause(scope.sql)}`,
    baselineWord: agg.word,
    xAxisKey: label.alias,
    yAxisKey: m,
  }];
}

function tradeoff(q, rows, model) {
  const label = entityLabel(model);
  if (!label) return [];
  const { measure: benefit, cost } = q;
  const scope = scopeFilter(rows, model, [cost, benefit]);
  const y = `${name(benefit)} per ${name(cost)}`;
  const where = whereClause([`${br(cost)} > 0`, `${br(benefit)} IS NOT NULL`, ...scope.sql]);
  return [{
    title: `${y}, by ${name(label.alias).toLowerCase()}${scope.title}`,
    chart_type: 'hbar',
    dimension: label.alias,
    rowLevel: true,
    sql:
      `SELECT ${label.expr} AS ${br(label.alias)}, ${br(benefit)} * 1.0 / ${br(cost)} AS ${br(y)}, ${br(benefit)}, ${br(cost)} ` +
      `FROM ${TABLE}${where} ORDER BY ${br(y)} DESC LIMIT 12`,
    // Against the median plan, not the mean of the top twelve: a ratio of a
    // price has a long tail, and a few near-free plans pull a mean with them.
    baselineSql: `SELECT MEDIAN(${br(benefit)} * 1.0 / ${br(cost)}) AS [v] FROM ${TABLE}${where}`,
    baselineWord: 'median',
    xAxisKey: label.alias,
    yAxisKey: y,
  }];
}

function items(q) {
  const y = 'Average Score';
  const parts = q.items.map((c) => `SELECT ${lit(name(c))} AS [Question], AVG(${br(c)}) AS ${br(y)} FROM ${TABLE}`);
  return [{
    title: 'Average score by question',
    chart_type: 'hbar',
    dimension: 'Question',
    sql: parts.join(' UNION ALL '),
    xAxisKey: 'Question',
    yAxisKey: y,
  }];
}

function relationship(q, rows, model) {
  const { measure: b, other: a } = q;
  const scope = scopeFilter(rows, model, [a, b]);
  // Each point is named — by what the row is, or failing that by its first
  // category. Without a text column the series reader takes the x measure for
  // the label and reads the scatter as a ranking of it.
  const label =
    entityLabel(model) ||
    (() => {
      const c = Object.keys(model.columns).find((k) => ['category', 'flag'].includes(model.columns[k].type));
      return c ? { expr: br(c), alias: c } : null;
    })();
  const lead = label ? `${label.expr} AS ${br(label.alias)}, ` : '';
  return [{
    title: `${name(a)} against ${name(b)}${scope.title}`,
    chart_type: 'scatter',
    dimension: label ? label.alias : a,
    rowLevel: true,
    sql: `SELECT ${lead}${br(a)}, ${br(b)} FROM ${TABLE}${whereClause([`${br(a)} IS NOT NULL`, `${br(b)} IS NOT NULL`, ...scope.sql])} LIMIT 500`,
    xAxisKey: a,
    yAxisKey: b,
  }];
}

/**
 * A question the reader typed, already read into a chart by the Ask page's
 * offline planner (lib/questionPlanner.js) when it was asked. It is theirs, and
 * drawn as they asked it — which is also why the rules above are not promised
 * for it: they are about what the engine chooses, not what a person asks for.
 */
function custom(q) {
  return q.spec?.sql ? [{ ...q.spec, title: q.spec.title || q.text }] : [];
}

const COMPILERS = {
  custom,
  trend,
  composition,
  compare,
  'outcome-rate': outcomeRate,
  ratio,
  rank,
  tradeoff,
  items,
  relationship,
};

/** The chart specs that answer one question. Empty when it cannot be answered. */
export function compileQuestion(question, rows, model) {
  const compile = COMPILERS[question.intent];
  if (!compile) return [];
  return compile(question, rows, model).map((spec) => ({ ...spec, question: { id: question.id, text: question.text, intent: question.intent } }));
}

/* ── Headline figures ──────────────────────────────────────────────────── */

function compact(val) {
  if (typeof val !== 'number' || !isFinite(val)) return String(val);
  const abs = Math.abs(val);
  if (abs >= 1_000_000) return (val / 1_000_000).toFixed(1) + 'M';
  if (abs >= 1_000) return (val / 1_000).toFixed(1) + 'K';
  return Number.isInteger(val) ? String(val) : val.toFixed(1);
}

/**
 * The KPI strip: the headline answer to each question that has one, computed
 * over the same rows as the charts under it — so the figure in the strip and
 * the "average across all records" in a sentence are one number.
 */
export function headlineFigures(questions, rows, model) {
  const out = [];
  const seen = new Set();
  const add = (label, value) => {
    if (seen.has(label) || out.length >= 4) return;
    seen.add(label);
    out.push({ label, value });
  };
  for (const q of questions) {
    if (q.intent === 'outcome-rate' && q.outcome) {
      const agg = outcomeAggregate(q.outcome);
      const col = q.outcome.column;
      const known = rows.filter((r) => present(r?.[col]));
      if (agg && known.length && (q.outcome.kind || 'binary') === 'binary') {
        const events = known.filter((r) => String(r[col]) === String(q.outcome.event)).length;
        add(agg.name, `${((100 * events) / rows.length).toFixed(1)}%`);
      }
      continue;
    }
    const m = q.measure;
    const info = m && model.measures[m];
    // A measure only comparable within a scope has no single headline, and a
    // long table's value is several quantities.
    if (!info || info.scope.length || (model.long && m === model.long.value)) continue;
    const values = rows.map((r) => r?.[m]).filter(isNum);
    if (!values.length) continue;
    if (info.sum && !info.noSumAcross.length && ['trend', 'composition', 'rank'].includes(q.intent)) {
      add(`Total ${name(m)}`, compact(values.reduce((s, v) => s + v, 0)));
    } else if ((!info.sum || q.mean) && q.intent === 'compare') {
      if (info.robust) add(`Average ${name(m)}`, compact(values.reduce((s, v) => s + v, 0) / values.length));
      else add(`Median ${name(m)}`, compact([...values].sort((a, b) => a - b)[values.length >> 1]));
    }
  }
  add('Records Analyzed', compact(rows.length));
  return out;
}
