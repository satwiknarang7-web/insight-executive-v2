/**
 * Does a finished report break a rule that holds for every dataset?
 *
 * The rules are I1–I10 in docs/design/question-first-reports.md. Each is about
 * TYPES — what a measure may be aggregated with, what a chart may be drawn as —
 * and never about a particular file, which is what lets the fuzz generator
 * check them on tables nobody wrote by hand.
 *
 * The auditor deliberately does not use the engine's own idea of the table.
 * It reads the ground truth the corpus declares (`report` in each
 * `.expect.json`, or the truth a fuzz case was generated with) plus the rows,
 * and judges the output against that. An engine that misreads a table must not
 * also be the one deciding whether it misread it.
 *
 * Truth shape:
 *
 *   {
 *     grain: 'entity' | 'event' | 'entityPeriod' | 'long' | 'response' | 'observation',
 *     time: 'order_date',                         // optional
 *     measures: {
 *       '<column>': {
 *         scope: ['Buyer Unit'],                  // only comparable within these
 *         noSum: true,                            // a rate or level: never summed
 *         noSumAcross: ['week_start'],            // a level: never summed over these
 *       },
 *     },
 *     long: { value: 'amount', by: 'scenario' },  // one value column, several quantities
 *     outcomes: ['churned'],                      // what the table exists to explain
 *   }
 */

const PART_OF_WHOLE = new Set(['donut', 'pie', 'treemap', 'radial']);
const SUMMABLE = new Set(['SUM', 'COUNT']);
const IGNORED_LABELS = new Set(['', 'other', 'others', '(not stated)', 'null', 'undefined']);

export const RULES = {
  I1: 'label axis names a column the chart did not group by',
  I2: 'part-of-whole chart over an aggregate that is not a sum or count',
  I3: 'measure aggregated outside the scope it is comparable in',
  I4: 'value column of a long table aggregated across the quantities it holds',
  I5: 'row count charted as a finding on a table of entities',
  I6: 'one row moves an average by more than a quarter of its median',
  I7: 'measure aggregated over bands of itself',
  I8: 'the same measure given different averages in one report',
  I9: 'time series drawn with three points or fewer from a week or more of data',
  I10: 'the lead finding has too little evidence to lead',
};

/* ── Reading SQL ───────────────────────────────────────────────────────── */

const norm = (s) => String(s ?? '').toLowerCase().replace(/[_\s]+/g, ' ').trim();

/** Every aggregate call in a query: `{ fn, inner, cols, alias }`. */
export function aggregates(sql) {
  const out = [];
  const text = String(sql || '');
  const re = /\b(SUM|AVG|MEDIAN|MIN|MAX|COUNT|STDEV|STDDEV)\s*\(/gi;
  let m;
  while ((m = re.exec(text))) {
    let depth = 1;
    let i = re.lastIndex;
    for (; i < text.length && depth; i++) {
      if (text[i] === '(') depth++;
      else if (text[i] === ')') depth--;
    }
    const inner = text.slice(re.lastIndex, i - 1);
    const alias = /^\s+AS\s+\[([^\]]+)\]/i.exec(text.slice(i))?.[1] || null;
    out.push({ fn: m[1].toUpperCase(), inner, cols: bracketed(inner), alias });
  }
  return out;
}

/**
 * The whole SELECT expression aliased as `alias`, and the aggregate it is when
 * it is exactly one call. `SUM(x) * 100.0 / COUNT(*) AS [Rate]` is a ratio, not
 * a count, even though the call nearest the alias is COUNT.
 */
export function selected(sql, alias) {
  const text = String(sql || '');
  const at = text.indexOf(`AS [${alias}]`);
  if (at < 0) return null;
  let depth = 0;
  let i = at - 1;
  for (; i >= 0; i--) {
    const ch = text[i];
    if (ch === ')') depth++;
    else if (ch === '(') depth--;
    else if (depth === 0 && ch === ',') break;
    else if (depth === 0 && /\bSELECT$/i.test(text.slice(Math.max(0, i - 6), i + 1))) break;
  }
  const expr = text.slice(i + 1, at).replace(/^SELECT\b/i, '').trim();
  const only = /^(SUM|AVG|MEDIAN|MIN|MAX|COUNT)\s*\(([\s\S]*)\)$/i.exec(expr);
  const single = only && aggregates(expr).length === 1 ? only[1].toUpperCase() : null;
  return { expr, fn: single, inner: single ? only[2].trim() : null };
}

const bracketed = (text) => [...String(text).matchAll(/\[([^\]]+)\]/g)].map((m) => m[1]);

/** Columns a query reads, aliases excluded. */
export function referenced(sql) {
  return new Set(bracketed(String(sql || '').replace(/\bAS\s+\[[^\]]+\]/gi, '')));
}

/**
 * Columns a query uses to divide or restrict the rows: grouped by, used as a
 * label, or filtered on. `[x] IS NOT NULL` does not count — it removes blanks,
 * it does not choose a like-for-like subset.
 */
export function partitioning(sql) {
  let text = String(sql || '')
    .replace(/\[[^\]]+\]\s+IS\s+NOT\s+NULL/gi, '')
    .replace(/\bAS\s+\[[^\]]+\]/gi, '');
  // A pivot splits too: `SUM(CASE WHEN [status] = 'Open' …)` beside the same
  // for 'Closed' divides the rows by status. One level alone is a filter on
  // one slice, not a split, so it takes two.
  const literals = new Map();
  for (const m of text.matchAll(/\[([^\]]+)\]\s*=\s*'([^']*)'/g)) {
    if (!literals.has(m[1])) literals.set(m[1], new Set());
    literals.get(m[1]).add(m[2]);
  }
  for (const agg of aggregates(text)) text = text.replace(`${agg.inner}`, '');
  const out = new Set(bracketed(text));
  for (const [col, levels] of literals) if (levels.size >= 2) out.add(col);
  return out;
}

/**
 * Whether a query keeps every value of `col` in its own group. Grouping by
 * the bare column does; grouping by a truncation of it does only when no two
 * values share a truncated prefix — a weekly snapshot bucketed to the month
 * adds four weeks of the same stock together.
 */
function keepsApart(sql, col, rows) {
  // Filtered to one value, nothing is summed across it.
  if (new Set(filteredRows(sql, rows).map((r) => String(r?.[col] ?? ''))).size <= 1) return true;
  const grouped = /\bGROUP\s+BY\s+([\s\S]*?)(?:\bHAVING\b|\bORDER\s+BY\b|\bLIMIT\b|$)/i.exec(String(sql || ''))?.[1] || '';
  const name = `[${col}]`;
  if (!grouped.includes(name)) return false;
  const cut = new RegExp(`SUBSTRING\\(\\s*\\[${col.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]\\s*,\\s*1\\s*,\\s*(\\d+)\\s*\\)`, 'i').exec(grouped);
  if (!cut) return true;
  const values = rows.map((r) => r?.[col]).filter((v) => v !== null && v !== undefined && v !== '').map(String);
  return new Set(values).size === new Set(values.map((v) => v.slice(0, Number(cut[1])))).size;
}

/** The rows a query keeps, as far as its plain `[col] = value` filters say. */
function filteredRows(sql, rows) {
  const where = /\bWHERE\s+([\s\S]*?)(?:\bGROUP\s+BY\b|\bORDER\s+BY\b|\bLIMIT\b|$)/i.exec(String(sql || ''))?.[1] || '';
  const tests = [...where.matchAll(/\[([^\]]+)\]\s*=\s*(?:'((?:[^']|'')*)'|(-?[\d.]+))/g)].map((m) => [m[1], m[2] !== undefined ? m[2].replace(/''/g, "'") : m[3]]);
  return tests.length ? rows.filter((r) => tests.every(([c, v]) => String(r?.[c]) === String(v))) : rows;
}

function groupByColumns(sql) {
  const m = /\bGROUP\s+BY\s+([\s\S]*?)(?:\bHAVING\b|\bORDER\s+BY\b|\bLIMIT\b|$)/i.exec(String(sql || ''));
  return m ? bracketed(m[1]) : [];
}

const hasFilter = (sql) =>
  /\bWHERE\b/i.test(String(sql || '').replace(/\[[^\]]+\]\s+IS\s+NOT\s+NULL(\s+AND)?/gi, '').replace(/\bWHERE\s*(GROUP|ORDER|LIMIT|$)/i, '$1'));

/* ── Reading a report ──────────────────────────────────────────────────── */

export const findingCharts = (result) => (result.charts || []).filter((c) => c && c.chart_type !== 'slicer');

const evidenceOf = (result, chart) => (result.perChart || []).find((p) => p.id === chart.id)?.metrics?.evidence || null;

/** A KPI read back into the aggregate it states, when its label says. */
function kpiAggregate(kpi, measure) {
  const label = norm(kpi.label);
  const m = norm(measure);
  if (!label.includes(m)) return null;
  if (/^(average|avg|mean)\b/.test(label)) return 'AVG';
  if (/^(total|sum)\b/.test(label)) return 'SUM';
  if (/^median\b/.test(label)) return 'MEDIAN';
  return null;
}

/** "75.8K" → { value: 75800, step: 100 }; "23.9%" → { value: 23.9, step: 0.1, pct: true }. */
export function readFigure(text) {
  const m = /(-?[\d,]*\.?\d+)\s*([KMB])?\s*(%)?/i.exec(String(text ?? ''));
  if (!m) return null;
  const digits = m[1].replace(/,/g, '');
  const decimals = digits.includes('.') ? digits.split('.')[1].length : 0;
  const scale = { K: 1e3, M: 1e6, B: 1e9 }[String(m[2] || '').toUpperCase()] || 1;
  return { value: Number(digits) * scale, step: 10 ** -decimals * scale, pct: !!m[3] };
}

/* ── Statistics the rules need ─────────────────────────────────────────── */

const numbers = (rows, col) => rows.map((r) => r?.[col]).filter((v) => typeof v === 'number' && Number.isFinite(v));
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : NaN;
};
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * How far the single most extreme row moves the mean, as a share of the
 * median. Past a quarter, the average is describing that row.
 *
 * Only when that row is an outlier in the first place — more than eight
 * median absolute deviations out, and three times further than any other row.
 * In a group of six ordinary values one of them always moves the mean a lot;
 * that is a small sample, not a distortion.
 */
export function outlierInfluence(values) {
  if (values.length < 5) return 0;
  const med = median(values);
  let worst = 0;
  for (let i = 1; i < values.length; i++) if (Math.abs(values[i] - med) > Math.abs(values[worst] - med)) worst = i;
  const devs = values.map((v) => Math.abs(v - med));
  const mad = median(devs);
  if (devs[worst] <= 8 * (mad || Math.abs(med) * 0.01 || 1)) return 0;
  // One row, not a long tail: the worst is well clear of the next worst.
  const second = Math.max(...devs.filter((_, i) => i !== worst));
  if (devs[worst] < 3 * second) return 0;
  const without = values.filter((_, i) => i !== worst);
  const shift = Math.abs(mean(values) - mean(without));
  const base = Math.abs(med) || Math.abs(mean(without)) || 1;
  return shift / base;
}

function daySpan(rows, col) {
  const days = new Set();
  for (const r of rows) {
    const v = r?.[col];
    if (v === null || v === undefined || v === '') continue;
    const d = new Date(typeof v === 'number' && v < 3000 ? `${v}-01-01` : v);
    if (!Number.isNaN(d.getTime())) days.add(d.toISOString().slice(0, 10));
    if (days.size >= 7) return 7;
  }
  return days.size;
}

/* ── The rules ─────────────────────────────────────────────────────────── */

/**
 * Every rule broken by this report, as `{ rule, chart, detail }`. `chart` is
 * the chart's id, or `kpi:<label>` for a KPI.
 */
export function audit(result, rows, truth = {}) {
  const out = [];
  const charts = findingCharts(result);
  const kpis = result.kpis || [];
  const columns = new Set(Object.keys(rows[0] || {}));
  const measures = truth.measures || {};
  const add = (rule, chart, detail) => out.push({ rule, chart, detail });
  const temporal = new Set([truth.time].filter(Boolean));

  for (const chart of charts) {
    const sql = chart.sql || '';
    const aggs = aggregates(sql);
    const parts = partitioning(sql);
    const reads = referenced(sql);
    const x = chart.xAxisKey;
    const y = chart.yAxisKey ? selected(sql, chart.yAxisKey) : null;
    const yAgg = y && y.expr ? { fn: y.fn || 'EXPR', inner: y.inner || y.expr } : null;

    // I1 — every label drawn is a value of the column the axis is named after.
    if (x && columns.has(x) && !temporal.has(x)) {
      const known = new Set(rows.map((r) => String(r?.[x] ?? '')));
      const stray = (chart.resultData || [])
        .map((d) => d?.[x])
        .filter((v) => !IGNORED_LABELS.has(norm(v)))
        .find((v) => !known.has(String(v)));
      if (stray !== undefined) add('I1', chart.id, `"${stray}" is not a value of ${x}`);
    }

    // I2 — slices are parts of a whole only when the whole is a sum.
    if (PART_OF_WHOLE.has(chart.chart_type) && yAgg && !SUMMABLE.has(yAgg.fn)) {
      add('I2', chart.id, `${chart.chart_type} of ${yAgg.fn}`);
    }

    for (const [col, rule] of Object.entries(measures)) {
      if (!reads.has(col)) continue;
      const summed = aggs.some((a) => a.fn === 'SUM' && a.cols.includes(col));
      // I3 — scope: compared only within the columns that make it comparable.
      for (const scope of rule.scope || []) {
        if (parts.has(scope)) continue;
        const levels = new Set(rows.filter((r) => r?.[col] !== null && r?.[col] !== undefined).map((r) => r?.[scope]));
        if (levels.size > 1) add('I3', chart.id, `${col} compared across ${levels.size} values of ${scope}`);
      }
      if (rule.noSum && summed) add('I3', chart.id, `${col} summed; it is a rate or a level`);
      for (const across of rule.noSumAcross || []) {
        if (summed && !keepsApart(sql, across, rows)) add('I3', chart.id, `${col} summed across ${across}`);
      }
    }

    // I4 — a long table's value column is one quantity per `by` level.
    if (truth.long && aggs.some((a) => a.cols.includes(truth.long.value)) && !parts.has(truth.long.by)) {
      add('I4', chart.id, `${truth.long.value} aggregated across ${truth.long.by}`);
    }

    // I5 — on a table of entities, how many rows fall in a group is inventory.
    // Counting by the outcome itself is its distribution, and that is a finding.
    if (
      truth.grain === 'entity' &&
      !groupByColumns(sql).some((g) => (truth.outcomes || []).includes(g)) &&
      yAgg?.fn === 'COUNT' &&
      yAgg.inner.trim() === '*' &&
      !/^distribution of/i.test(chart.title || '')
    ) {
      add('I5', chart.id, `${chart.title}`);
    }

    // I6 — an average that one row decides.
    for (const agg of aggs.filter((a) => a.fn === 'AVG' && a.cols.length === 1 && a.inner.trim() === `[${a.cols[0]}]`)) {
      const col = agg.cols[0];
      const group = groupByColumns(sql).find((g) => columns.has(g));
      const buckets = new Map();
      for (const r of filteredRows(sql, rows)) {
        const v = r?.[col];
        if (typeof v !== 'number' || !Number.isFinite(v)) continue;
        const k = group ? String(r?.[group]) : '';
        if (!buckets.has(k)) buckets.set(k, []);
        buckets.get(k).push(v);
      }
      const worst = [...buckets.entries()].map(([k, xs]) => [k, outlierInfluence(xs)]).sort((a, b) => b[1] - a[1])[0];
      if (worst && worst[1] > 0.25) {
        add('I6', chart.id, `AVG(${col})${group ? ` in ${group}=${worst[0]}` : ''} moved ${Math.round(worst[1] * 100)}% by one row`);
      }
    }

    // I7 — a measure summed or averaged over its own bands.
    for (const g of groupByColumns(sql)) {
      if (!/\b(band|bucket|bin)s?\b/i.test(norm(g))) continue;
      const own = aggs.find((a) => a.fn !== 'COUNT' && a.cols.some((c) => norm(g).includes(norm(c))));
      if (own) add('I7', chart.id, `${own.fn}(${own.cols[0]}) by ${g}`);
    }

    // I9 — a series of a week or more drawn as three points.
    if (truth.time && parts.has(truth.time) && (chart.resultData || []).length <= 3 && daySpan(rows, truth.time) >= 7) {
      add('I9', chart.id, `${(chart.resultData || []).length} points over ${truth.time}`);
    }
  }

  // KPIs have no SQL; their label states the aggregate.
  for (const kpi of kpis) {
    for (const [col, rule] of Object.entries(measures)) {
      const fn = kpiAggregate(kpi, col);
      if (!fn) continue;
      for (const scope of rule.scope || []) {
        const levels = new Set(rows.map((r) => r?.[scope]).filter((v) => v !== null && v !== undefined && v !== ''));
        if (levels.size > 1) add('I3', `kpi:${kpi.label}`, `${col} across ${levels.size} values of ${scope}`);
      }
      if (fn === 'SUM' && (rule.noSum || (rule.noSumAcross || []).length)) add('I3', `kpi:${kpi.label}`, `${col} totalled`);
    }
    if (truth.long && kpiAggregate(kpi, truth.long.value)) add('I4', `kpi:${kpi.label}`, `${truth.long.value} across ${truth.long.by}`);
    for (const col of columns) {
      if (kpiAggregate(kpi, col) !== 'AVG') continue;
      const influence = outlierInfluence(numbers(rows, col));
      if (influence > 0.25) add('I6', `kpi:${kpi.label}`, `AVG(${col}) moved ${Math.round(influence * 100)}% by one row`);
    }
  }

  // I8 — one measure, one average.
  const stated = new Map();
  const state = (measure, figure, where) => {
    if (!figure || !Number.isFinite(figure.value)) return;
    const key = norm(measure).replace(/^(average|avg|mean)\s+/, '');
    if (!stated.has(key)) stated.set(key, []);
    stated.get(key).push({ ...figure, where });
  };
  for (const kpi of kpis) {
    if (/^(average|avg|mean)\b/i.test(norm(kpi.label)) || /\brate$/i.test(norm(kpi.label))) {
      state(kpi.label, readFigure(kpi.value), `kpi:${kpi.label}`);
    }
  }
  for (const chart of charts) {
    if (hasFilter(chart.sql)) continue;
    const headline = (result.perChart || []).find((p) => p.id === chart.id)?.headline || '';
    const m = /the\s+(-?[\d.,]+\s*[KMB]?%?)\s+average (?:across|over all records)/i.exec(headline);
    if (m && chart.yAxisKey) state(chart.yAxisKey, readFigure(m[1]), chart.id);
  }
  for (const figures of stated.values()) {
    const [first, ...rest] = figures;
    for (const other of rest) {
      const tolerance = Math.max(first.step, other.step) * 0.51;
      if (Math.abs(first.value - other.value) > tolerance) {
        add('I8', other.where, `${other.value} here, ${first.value} at ${first.where}`);
      }
    }
  }

  // I10 — whatever leads has to be able to carry it.
  // Only when something could have led instead: a report whose every finding
  // is thin has nothing better to open with.
  const lead = charts[0];
  const stronger = charts.some((c) => evidenceOf(result, c) && evidenceOf(result, c) !== 'thin');
  if (lead && evidenceOf(result, lead) === 'thin' && stronger) add('I10', lead.id, `${lead.title}`);

  return out;
}
