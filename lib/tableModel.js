/**
 * What this table is, verified against its rows: one description the rest of
 * the analysis reads instead of each module working it out again.
 *
 * Phase 1 of docs/design/question-first-reports.md. Until now the facts about a
 * column were spread across `measureSemantics`, `measureUnits`, `dataGrain`,
 * `rateDefinition`, `metricPolarity`, `dimensionRoles` and the regexes in
 * the old planner, and each answered a narrower question than the one a chart
 * needs answered: not "is this a rate" but "which aggregations of this column
 * mean anything, and across what". The question catalogue and the compiler
 * (lib/questionCatalogue.js, lib/questionCompiler.js) are built on it, and it
 * is scored against the corpus truth by `eval/scorecard.mjs`.
 *
 *   {
 *     grain:    { kind, key, time, entity, why },
 *     columns:  { [name]: { type, distinct } },
 *     long:     { value, by, why } | null,
 *     measures: { [name]: { unit, sum, noSumAcross, scope, robust, outlier, why } },
 *   }
 *
 * **Evidence, in order of trust.** The rows decide wherever they can: whether a
 * combination of columns identifies a row, whether two measures are the same
 * quantity in different currencies, whether a value carries over from one
 * period to the next, whether one row moves an average. A column's NAME is
 * used only where the rows cannot settle a question on their own — a percentage
 * and a count can hold identical numbers — and every name rule is a short list
 * kept in one place below. A model's claims (phase 4) arrive as proposals and
 * are checked against the same rows.
 *
 * **Grain** — what one row is:
 *
 *   long          one value column holding several quantities, named by another
 *                 column (an indicator, a scenario); nothing is combined across it
 *   response      a survey: several answers on one small shared scale
 *   entityPeriod  one row per thing per period, densely: (sku, week), (channel, day)
 *   event         rows in time: a log of identified records, or a series
 *   entity        one row per thing, identified by a column or a pair of them
 *   observation   rows with no identity and no time: repeated measurements
 */

import { detectRepeatedMeasures, repetitionReason } from './dataGrain.js';

const ENGINE_COLUMNS = new Set(['isAnomaly']);

/* ── The name rules, all of them ───────────────────────────────────────── */

// Values that are never summed across rows: rates, prices, scores, readings.
const NO_SUM_NAME =
  /(pct|percent|rate|ratio|share|score|index|rating|rank|average|avg|mean|median|per[\s_]|[\s_]per|temperature|temp[\s_]c|humidity|satisfaction|csat|nps|price|attendance|probability|multiplier)/i;
// Stocks rather than flows: a level carried from one period to the next.
const LEVEL_NAME = /(stock|inventory|on[\s_]?hand|balance|headcount|backlog|queue|level|outstanding|capacity|population)/i;
// A column that states what unit or basis the numbers beside it are in.
const UNIT_NAME = /(unit|basis|currency|ccy|uom|denomination|billing|pricing)/i;
// A column naming which quantity a long table's value column holds.
const QUANTITY_NAME = /(indicator|metric|measure|series|variable|scenario|version|kpi|kind|type)/i;
const QUANTITY_VALUE = /^(budget|actual|actuals|forecast|plan|target|prior|baseline)$/i;
// A money-denominated measure, for `unit` only.
const MONEY_NAME = /(price|cost|revenue|amount|spend|usd|eur|gbp|inr|salary|fee|charge|sales|income|budget|value)/i;
const PERCENT_NAME = /(pct|percent|rate|share|%)/i;

/* ── Small statistics ──────────────────────────────────────────────────── */

const present = (v) => v !== null && v !== undefined && v !== '';
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : NaN;
};
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

function groupValues(rows, by, col) {
  const out = new Map();
  for (const r of rows) {
    const v = r?.[col];
    if (!isNum(v)) continue;
    const k = String(r?.[by] ?? '');
    if (!out.has(k)) out.set(k, []);
    out.get(k).push(v);
  }
  return out;
}

function uniqueOn(rows, cols) {
  const seen = new Set();
  for (const r of rows) {
    const k = cols.map((c) => String(r?.[c] ?? '')).join('\u0001');
    if (seen.has(k)) return false;
    seen.add(k);
  }
  return true;
}

/**
 * How far the single most extreme value moves the mean, as a share of the
 * median — counted only when that value is an outlier in its own right (eight
 * median absolute deviations out, and three times further than any other).
 */
export function outlierInfluence(values) {
  if (values.length < 5) return { influence: 0, value: null };
  const med = median(values);
  const devs = values.map((v) => Math.abs(v - med));
  let worst = 0;
  for (let i = 1; i < devs.length; i++) if (devs[i] > devs[worst]) worst = i;
  const mad = median(devs);
  const second = Math.max(...devs.filter((_, i) => i !== worst));
  if (devs[worst] <= 8 * (mad || Math.abs(med) * 0.01 || 1) || devs[worst] < 3 * second) return { influence: 0, value: null };
  const without = values.filter((_, i) => i !== worst);
  const base = Math.abs(med) || Math.abs(mean(without)) || 1;
  return { influence: Math.abs(mean(values) - mean(without)) / base, value: values[worst] };
}

/* ── Columns ───────────────────────────────────────────────────────────── */

const YEAR_LIKE = (values) => values.every((v) => Number.isInteger(v) && v >= 1900 && v <= 2100);

function typeColumns(rows, temporal = [], labels = []) {
  const names = Object.keys(rows[0] || {}).filter((c) => !ENGINE_COLUMNS.has(c));
  // Whole numbers the profiler has already read as labels: an hour or a month
  // pulled out of a timestamp is something to group by, and its average ("the
  // mean hour of the day, 11.5") is nobody's question.
  const labelled = new Set(labels);
  const n = rows.length;
  const out = {};
  for (const c of names) {
    const values = rows.map((r) => r?.[c]).filter(present);
    const distinct = new Set(values.map(String)).size;
    const numeric = values.length > 0 && values.filter(isNum).length / values.length >= 0.95;
    let type;
    if (distinct <= 1) type = 'constant';
    else if (temporal.includes(c)) type = 'time';
    else if (numeric && YEAR_LIKE(values.filter(isNum)) && distinct <= 200) type = 'time';
    else if (numeric && labelled.has(c)) type = 'category';
    else if (numeric) type = 'number';
    else if (values.every((v) => /^https?:\/\//i.test(String(v)))) type = 'url';
    // Mostly numbers the cleaner could not read (two comma conventions in one
    // column): a measure it could not type, not a category to split by.
    else if (values.filter((v) => /^[\s$€£¥(+-]*[\d][\d.,\s]*[)%]?\s*$/.test(String(v))).length > values.length / 2) type = 'mixed';
    else if (distinct === 2) type = 'flag';
    else if (distinct > 0.5 * n && mean(values.map((v) => String(v).length)) > 30) type = 'text';
    else type = 'category';
    out[c] = { type, distinct, filled: values.length };
  }
  return out;
}

/* ── Long format ───────────────────────────────────────────────────────── */

/**
 * A value column that holds several quantities, and the column naming which.
 *
 * Structure first: the non-numeric columns together identify a row, and
 * dropping the candidate leaves every other combination repeated once per
 * level of it — the table is fully crossed on it. Then either the values are a
 * different size in each level (GDP beside life expectancy: a hundredfold or
 * more), or the column's name or levels say it names a quantity or a version of
 * one (indicator, scenario; Budget, Actual). Scale alone is not enough at ten
 * times: products in a sales panel differ by that much and are rightly summed.
 */
function detectLong(rows, columns) {
  const numeric = Object.keys(columns).filter((c) => columns[c].type === 'number');
  const labels = Object.keys(columns).filter((c) => ['category', 'flag', 'time'].includes(columns[c].type));
  if (!numeric.length || numeric.length > 2 || labels.length < 2 || !uniqueOn(rows, labels)) return null;

  for (const by of labels.filter((c) => columns[c].type !== 'time' && columns[c].distinct <= 30)) {
    const rest = labels.filter((c) => c !== by);
    const groups = new Map();
    for (const r of rows) {
      const k = rest.map((c) => String(r?.[c] ?? '')).join('\u0001');
      groups.set(k, (groups.get(k) || 0) + 1);
    }
    const crossed = [...groups.values()].filter((g) => g === columns[by].distinct).length / groups.size;
    if (crossed < 0.9) continue;

    for (const value of numeric) {
      const medians = [...groupValues(rows, by, value).values()].map((xs) => Math.abs(median(xs))).filter((m) => m > 0);
      const spread = medians.length >= 2 ? Math.max(...medians) / Math.min(...medians) : 1;
      const levels = new Set(rows.map((r) => String(r?.[by] ?? '')));
      const named = QUANTITY_NAME.test(by) || [...levels].every((l) => QUANTITY_VALUE.test(l.trim()));
      if (spread >= 100) return { value, by, why: `its typical size differs ${Math.round(spread).toLocaleString('en-US')}-fold between levels of ${by}` };
      if (named && numeric.length === 1) return { value, by, why: `${by} names which quantity each row's ${value} is` };
    }
  }
  return null;
}

/* ── Grain ─────────────────────────────────────────────────────────────── */

function detectResponse(rows, columns) {
  const scales = Object.keys(columns).filter((c) => {
    if (columns[c].type !== 'number') return false;
    const vs = rows.map((r) => r?.[c]).filter(isNum);
    return vs.every(Number.isInteger) && Math.max(...vs) - Math.min(...vs) <= 10 && columns[c].distinct <= 11;
  });
  if (scales.length < 4) return null;
  // One shared scale: most of them run over the same range.
  const ranges = scales.map((c) => {
    const vs = rows.map((r) => r?.[c]).filter(isNum);
    return `${Math.min(...vs)}-${Math.max(...vs)}`;
  });
  const common = Math.max(...[...new Set(ranges)].map((r) => ranges.filter((x) => x === r).length));
  return common >= 4 ? scales : null;
}

function detectGrain(rows, columns, long) {
  const n = rows.length;
  const names = Object.keys(columns);
  const times = names.filter((c) => columns[c].type === 'time').sort((a, b) => columns[b].distinct - columns[a].distinct);
  const time = times[0] || null;
  const labels = names.filter((c) => ['category', 'flag', 'text'].includes(columns[c].type));
  const single = labels.find((c) => columns[c].distinct === n && n >= 5) || null;

  if (long) return { kind: 'long', key: null, time, entity: null, why: long.why };

  const scale = detectResponse(rows, columns);
  if (scale) return { kind: 'response', key: single, time, entity: null, why: `${scale.length} answers on one shared scale` };

  if (time) {
    if (single) return { kind: 'event', key: single, time, entity: null, why: `each row is one ${single}, stamped with ${time}` };
    if (columns[time].distinct === n) return { kind: 'event', key: null, time, entity: null, why: `each row is one ${time}: a series` };
    // A panel: one row per thing per period, and nearly every pairing present.
    const periods = columns[time].distinct;
    for (const e of labels.filter((c) => columns[c].distinct >= 2 && columns[c].distinct < n)) {
      const dense = n >= 0.8 * columns[e].distinct * periods;
      if (dense && n >= 20 && uniqueOn(rows, [e, time])) {
        return { kind: 'entityPeriod', key: [e, time], time, entity: e, why: `one row per ${e} per ${time}` };
      }
    }
    return { kind: 'event', key: null, time, entity: null, why: `each row is an event, dated by ${time}` };
  }

  if (single) return { kind: 'entity', key: single, time: null, entity: single, why: `each row is one ${single}` };
  for (let i = 0; i < labels.length; i++) {
    for (let j = i + 1; j < labels.length; j++) {
      if (uniqueOn(rows, [labels[i], labels[j]])) {
        return { kind: 'entity', key: [labels[i], labels[j]], time: null, entity: labels[i], why: `each row is one ${labels[i]} × ${labels[j]}` };
      }
    }
  }
  return { kind: 'observation', key: null, time: null, entity: null, why: 'no column or pair identifies a row, and there is no time' };
}

/* ── Measures ──────────────────────────────────────────────────────────── */

/** A measure family: three or more columns running over one bounded scale are scores. */
function scaleFamily(rows, columns) {
  const bounded = {};
  for (const c of Object.keys(columns)) {
    if (columns[c].type !== 'number') continue;
    const vs = rows.map((r) => r?.[c]).filter(isNum);
    const lo = Math.min(...vs);
    const hi = Math.max(...vs);
    if (lo < 0) continue;
    const ceiling = [1, 5, 7, 10, 100].find((b) => hi <= b && hi > b * 0.6);
    if (ceiling) (bounded[ceiling] ||= []).push(c);
  }
  return new Set(Object.values(bounded).filter((cs) => cs.length >= 3).flat());
}

function lagCorrelation(rows, entity, time, col) {
  const series = new Map();
  for (const r of [...rows].sort((a, b) => String(a?.[time]).localeCompare(String(b?.[time])))) {
    if (!isNum(r?.[col])) continue;
    const k = String(r?.[entity] ?? '');
    if (!series.has(k)) series.set(k, []);
    series.get(k).push(r[col]);
  }
  const pairs = [];
  for (const xs of series.values()) for (let i = 1; i < xs.length; i++) pairs.push([xs[i - 1], xs[i]]);
  if (pairs.length < 10) return 0;
  const ma = mean(pairs.map((p) => p[0]));
  const mb = mean(pairs.map((p) => p[1]));
  let num = 0;
  let da = 0;
  let db = 0;
  for (const [a, b] of pairs) {
    num += (a - ma) * (b - mb);
    da += (a - ma) ** 2;
    db += (b - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

/**
 * The columns within which a measure is comparable.
 *
 * Three kinds of evidence. The measure's own name says so ("… Within
 * Provider"). Another measure is the same quantity converted: `price_local /
 * price_usd` is constant inside each currency and different between them, so
 * the currency is what the local price is denominated in. Or a column that
 * names a unit or basis (`buyer_unit`, `currency`) splits the measure into
 * groups whose typical sizes differ tenfold — per-user against per-instance.
 */
function detectScopes(rows, columns, measures) {
  const out = Object.fromEntries(measures.map((m) => [m, new Set()]));
  const why = Object.fromEntries(measures.map((m) => [m, []]));
  const splits = Object.keys(columns).filter((c) => ['category', 'flag'].includes(columns[c].type) && columns[c].distinct >= 2 && columns[c].distinct <= 12);
  const norm = (s) => String(s).toLowerCase().replace(/[\s_]+/g, ' ').trim();

  for (const m of measures) {
    const within = /\bwithin\s+(.+)$/i.exec(norm(m))?.[1];
    if (within) {
      const s = Object.keys(columns).find((c) => norm(c) === within);
      if (s) {
        out[m].add(s);
        why[m].push(`its name says it compares only within ${s}`);
      }
    }
  }

  // Conversion: the ratio of two measures is fixed inside each level of a
  // column and different between levels. Found per split first, then kept only
  // for the coarsest split that shows it — a provider quoting in one currency
  // shows the same fixed ratio, because provider refines currency.
  const conversions = [];
  for (const s of splits) {
    for (const a of measures) {
      for (const b of measures) {
        if (a === b) continue;
        const ratios = new Map();
        for (const r of rows) {
          if (!isNum(r?.[a]) || !isNum(r?.[b]) || r[b] === 0) continue;
          const k = String(r?.[s] ?? '');
          if (!ratios.has(k)) ratios.set(k, []);
          ratios.get(k).push(r[a] / r[b]);
        }
        const groups = [...ratios.values()].filter((xs) => xs.length >= 2);
        if (groups.length < 2) continue;
        // The values have to move inside a level while their ratio does not.
        // Rows that repeat one value — every plan on one model carries that
        // model's scores — have a fixed ratio and nothing converted.
        const moving = [...groupValues(rows, s, a).values()].filter((xs) => {
          if (xs.length < 2) return false;
          const mu = mean(xs);
          return mu !== 0 && Math.sqrt(mean(xs.map((x) => (x - mu) ** 2))) / Math.abs(mu) > 0.05;
        });
        if (moving.length < 2) continue;
        const steady = groups.every((xs) => {
          const mu = mean(xs);
          return mu !== 0 && Math.sqrt(mean(xs.map((x) => (x - mu) ** 2))) / Math.abs(mu) < 0.02;
        });
        const centres = groups.map((xs) => mean(xs));
        // Exchange rates differ by multiples; a derived ratio such as price per
        // benchmark point drifts by less. Three times is the line between them.
        if (!steady || Math.max(...centres) / Math.min(...centres) < 3) continue;
        // Of the pair, the one whose size swings with the level is the local one.
        const swing = (col) => {
          const ms = [...groupValues(rows, s, col).values()].map((xs) => Math.abs(median(xs))).filter((x) => x > 0);
          return ms.length ? Math.max(...ms) / Math.min(...ms) : 1;
        };
        const [local, other] = swing(a) >= swing(b) ? [a, b] : [b, a];
        // A currency moves the local column by an order of magnitude or more
        // between levels and leaves the converted one where it was. Price
        // divided by a per-level constant (price per benchmark point) moves by
        // no more than that constant does.
        if (swing(local) < 10 || swing(local) < 3 * swing(other)) continue;
        conversions.push({ s, local, other });
      }
    }
  }
  const refines = (fine, coarse) => {
    const map = new Map();
    for (const r of rows) {
      const f = String(r?.[fine] ?? '');
      const c = String(r?.[coarse] ?? '');
      if (map.has(f) && map.get(f) !== c) return false;
      map.set(f, c);
    }
    return true;
  };
  for (const c of conversions) {
    const pair = (x) => [x.local, x.other].sort().join('');
    const coarser = conversions.some((d) => pair(d) === pair(c) && d.s !== c.s && refines(c.s, d.s) && !refines(d.s, c.s));
    if (coarser || out[c.local].has(c.s)) continue;
    out[c.local].add(c.s);
    why[c.local].push(`it is ${c.other} converted at a different rate in each ${c.s}`);
  }

  // A unit or basis column that splits a money measure five times over or
  // more: a price per user beside a price per instance. Money only —
  // storage and seat counts grow with the plan; they are not denominated in it.
  // The column says it is a unit or basis in its name, or in most of its
  // levels ("Basis A3", "per seat").
  const unitLike = (c) => {
    if (UNIT_NAME.test(c)) return true;
    const levels = [...new Set(rows.map((r) => r?.[c]).filter(present).map(String))];
    return levels.filter((l) => UNIT_NAME.test(l) || /\bper\s/i.test(l)).length > levels.length / 2;
  };
  for (const s of splits.filter(unitLike)) {
    for (const m of measures.filter((x) => MONEY_NAME.test(x))) {
      const ms = [...groupValues(rows, s, m).values()].map((xs) => Math.abs(median(xs))).filter((x) => x > 0);
      if (ms.length < 2) continue;
      const spread = Math.max(...ms) / Math.min(...ms);
      if (spread >= 5 && !out[m].has(s)) {
        out[m].add(s);
        why[m].push(`its typical size differs ${Math.round(spread)}-fold between levels of ${s}`);
      }
    }
  }
  return { scopes: Object.fromEntries(measures.map((m) => [m, [...out[m]]])), why };
}

function unitOf(name, values) {
  if (PERCENT_NAME.test(name)) return 'percent';
  if (MONEY_NAME.test(name)) return 'currency';
  if (/(score|index|rating|grade)/i.test(name)) return 'score';
  if (values.every(Number.isInteger)) return 'count';
  return 'unknown';
}

/* ── The model ─────────────────────────────────────────────────────────── */

/**
 * Describe a table from its rows. `temporal` is the profiler's list of date
 * columns (`profileColumns(rows).temporal`); without it only year-shaped
 * numbers are recognised as time.
 */
export function buildTableModel(rows, { temporal = [], labels = [], notSummed = {} } = {}) {
  if (!Array.isArray(rows) || !rows.length) {
    return { grain: { kind: 'observation', key: null, time: null, entity: null, why: 'no rows' }, columns: {}, long: null, measures: {} };
  }
  const columns = typeColumns(rows, temporal, labels);
  const long = detectLong(rows, columns);
  const grain = detectGrain(rows, columns, long);

  const keyCols = new Set([grain.key].flat().filter(Boolean));
  const measureNames = Object.keys(columns).filter((c) => columns[c].type === 'number' && !keyCols.has(c));
  const family = scaleFamily(rows, columns);
  const response = grain.kind === 'response' ? new Set(detectResponse(rows, columns)) : new Set();
  const { scopes, why: scopeWhy } = detectScopes(rows, columns, measureNames);

  const measures = {};
  for (const m of measureNames) {
    const values = rows.map((r) => r?.[m]).filter(isNum);
    const why = [...scopeWhy[m]];
    let sum = true;
    if (notSummed[m]) {
      // Someone else's total: repeated on every row of the group it belongs to,
      // or joined in from a table with one row per many of these. Summing it
      // counts it once per row — a country's tax revenue once per athlete.
      sum = false;
      why.push(notSummed[m]);
    } else if (NO_SUM_NAME.test(m)) {
      sum = false;
      why.push('its name says it is a rate, price, score or reading');
    } else if (response.has(m) || family.has(m)) {
      sum = false;
      why.push('it is one of several columns on one bounded scale — a score');
    }
    if (long && m === long.value) {
      why.push(`it holds a different quantity for each ${long.by}`);
    }

    const noSumAcross = [];
    if (grain.kind === 'entityPeriod' && LEVEL_NAME.test(m)) {
      const carry = lagCorrelation(rows, grain.entity, grain.time, m);
      if (carry > 0.5) {
        noSumAcross.push(grain.time);
        why.push(`a level: each ${grain.time} carries the last one over (r = ${carry.toFixed(2)})`);
      }
    }

    const { influence, value } = outlierInfluence(values);
    measures[m] = {
      unit: unitOf(m, values),
      sum,
      noSumAcross,
      scope: long && m === long.value ? [...new Set([...scopes[m], long.by])] : scopes[m],
      robust: influence <= 0.25,
      outlier: influence > 0.25 ? value : null,
      why,
    };
  }

  return { grain, columns, long, measures };
}

/**
 * The table model as the app builds it: the one entry point runAnalysis, the
 * worker's question card, the model recorder and the scorecard all use, so a
 * table is read the same way wherever it is read.
 *
 * On top of what the rows say on their own, it takes three things the rest of
 * the app already knows:
 *
 *   profile.temporal     which columns are dates
 *   profile.dimensions   which whole-number columns are labels (an hour pulled
 *                        out of a timestamp)
 *   provenance, roles    from a joined model: a measure from a dimension table
 *                        is that table's own figure, repeated per fact row
 *
 * and measures that hold one value per group and repeat across its rows
 * (lib/dataGrain.js) — the same figure arriving flattened, with the join done
 * before upload.
 */
export function readTable(rows, { profile = null, provenance = {}, roles = {} } = {}) {
  const notSummed = {};
  for (const [col, hit] of Object.entries(detectRepeatedMeasures(rows, profile) || {})) {
    notSummed[col] = repetitionReason(hit);
  }
  for (const [col, source] of Object.entries(provenance || {})) {
    if (source?.table && roles?.[source.table] === 'dimension') {
      notSummed[col] = `comes from ${source.table}, which joins one row to many — summing it would count it once per row`;
    }
  }
  return buildTableModel(rows, {
    temporal: profile?.temporal || [],
    labels: profile?.dimensions || [],
    notSummed,
  });
}
