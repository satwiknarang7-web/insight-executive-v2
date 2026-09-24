/**
 * The questions a table can answer, proposed from what it is.
 *
 * Phase 2 of docs/design/question-first-reports.md. A report used to be "the
 * charts the column types permit, minus the ones a filter has learned to
 * reject". It is now built from questions — typed, shown to the reader, and
 * compiled into charts by `lib/questionCompiler.js`. This file is where the
 * questions come from when nobody has asked any: the shape catalogue.
 *
 * It reads only `lib/tableModel.js` and the rows. Every question is a template
 * keyed on the table's grain, filled with columns the model has already typed
 * — an event log gets a trend and the split of its main total; a table of
 * priced things gets "which gives the most for the money"; a table with a
 * yes/no outcome gets the outcome rate by whatever moves it most. Nothing here
 * recognises a domain.
 *
 * **Evidence picks the splits.** Which of a table's dimensions a question is
 * asked across is decided by the rows: an outcome's drivers are ranked by how
 * far its rate moves across their levels, and a comparison's by how much of
 * the measure the dimension explains (adjusted eta squared). The question asked
 * first is the one with an answer — and a driver that answers it perfectly is
 * dropped, because it is the outcome restated (revenue is non-zero exactly
 * when a visitor converted).
 *
 * A question:
 *
 *   {
 *     id, text, intent,       // trend | composition | compare | rank | tradeoff |
 *                             // outcome-rate | ratio | items | relationship
 *     measure,                // the column measured (null: how many rows)
 *     cost,                   // tradeoff: what the measure is per
 *     other,                  // relationship: the second measure; ratio: the denominator
 *     by, band,               // what it is split by; band: a numeric split, banded
 *     over,                   // trend: the time column
 *     items,                  // items: the columns compared side by side
 *     outcome,                // outcome-rate, or a trend of one: the outcome
 *     mean,                   // compare: average an additive measure, not total it
 *     recommended,            // pre-ticked, and what the report is built from
 *   }
 */

import { prettyColumn } from './aggregateNames.js';
import { extent, spanOf } from './extent.js';
import { measureDependence } from './chartSignals.js';
import { LOCAL_CURRENCY_RE } from './measureUnits.js';
import { sampleOf } from './tableModel.js';

const RECOMMENDED = 8;
const MAX_DIM_LEVELS = 20;

const present = (v) => v !== null && v !== undefined && v !== '';
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const name = prettyColumn;

const YES = /^(y|yes|true|t|1)$/i;
const NO = /^(n|no|false|f|0)$/i;

/* ── Reading the model ─────────────────────────────────────────────────── */

/**
 * An ordinal scale — a rating, a level, a grade: ten or fewer whole numbers
 * over a range of ten or less. Drivers, not totals. A score shared by every
 * plan on the same model also has few values, but it runs from 38 to 57; the
 * range is what tells them apart.
 */
function ordinal(model, rows, col) {
  const c = model.columns[col];
  if (!c || c.type !== 'number' || c.distinct > 10) return false;
  const values = rows.map((r) => r?.[col]).filter(isNum);
  return values.every(Number.isInteger) && spanOf(values) <= 10;
}

/**
 * The columns a question can split by, best first: categories of three to
 * twelve levels, then two-level flags, then small ordinal scales, then wider
 * categories. A single-column key names every row and splits nothing; half of
 * a pair does — in a table keyed by (provider, plan) the provider is the first
 * thing a reader compares by — and in a panel the thing each row is about is
 * always a split, however many of them there are.
 */
function dimensions(model, rows, { exclude = [] } = {}) {
  const key = [model.grain.key].flat().filter(Boolean);
  const coarse = key.length === 2 && model.grain.kind === 'entity' ? [...key].sort((a, b) => model.columns[a].distinct - model.columns[b].distinct)[0] : null;
  const panel = model.grain.kind === 'entityPeriod' ? model.grain.entity : null;
  const scored = [];
  for (const [c, info] of Object.entries(model.columns)) {
    if (exclude.includes(c)) continue;
    let rank = null;
    if (c === coarse || c === panel) rank = -1;
    else if (key.includes(c)) continue;
    else if (['category', 'flag'].includes(info.type) && info.distinct >= 2 && info.distinct <= MAX_DIM_LEVELS) {
      rank = info.distinct >= 3 && info.distinct <= 12 ? 0 : info.distinct === 2 ? 1 : 3;
    } else if (ordinal(model, rows, c)) rank = 2;
    if (rank !== null) scored.push([c, rank]);
  }
  return scored.sort((a, b) => a[1] - b[1]).map(([c]) => c);
}

/** Whether most rows have a value in a column. */
export function wellFilled(model, rows, col) {
  const filled = model.columns[col]?.filled;
  return (filled ?? rows.filter((r) => present(r?.[col])).length) >= rows.length / 2;
}

function measureSets(model, rows) {
  const all = Object.keys(model.measures).filter((m) => !ordinal(model, rows, m));
  const flows = all.filter((m) => model.measures[m].sum && !model.measures[m].noSumAcross.length);
  // Filled first: a total most rows leave blank is not the one the table is
  // kept for, and "Total Field 01" read off one row in six headlines nothing.
  // Then money: of the totals a table carries, the one in currency is the one
  // it is usually kept for.
  const sparse = (m) => wellFilled(model, rows, m) ? 0 : 1;
  flows.sort((a, b) => sparse(a) - sparse(b) || (model.measures[b].unit === 'currency') - (model.measures[a].unit === 'currency'));
  const levels = all.filter((m) => model.measures[m].noSumAcross.length);
  const rates = all.filter((m) => !model.measures[m].sum);
  return { all, flows, levels, rates };
}

/** Pearson r over the rows where both are numbers. */
function correlation(rows, a, b) {
  return correlated(rows, a, b).r;
}

/** Pearson r, and how many rows it was read from. */
function correlated(rows, a, b) {
  const pairs = rows.filter((r) => isNum(r?.[a]) && isNum(r?.[b])).map((r) => [r[a], r[b]]);
  if (pairs.length < 8) return { r: 0, n: pairs.length };
  const ma = pairs.reduce((s, p) => s + p[0], 0) / pairs.length;
  const mb = pairs.reduce((s, p) => s + p[1], 0) / pairs.length;
  let num = 0;
  let da = 0;
  let db = 0;
  for (const [x, y] of pairs) {
    num += (x - ma) * (y - mb);
    da += (x - ma) ** 2;
    db += (y - mb) ** 2;
  }
  return { r: da && db ? num / Math.sqrt(da * db) : 0, n: pairs.length };
}

/**
 * The chance of an |r| this large from n rows of two unrelated columns — a
 * two-sided test on Fisher's z. Read against how many pairs were searched: the
 * best of twelve hundred pairs of noise, on the eight rows two sparse columns
 * share, reaches r = 0.92 by luck alone.
 */
function chanceOf(r, n) {
  if (n <= 3) return 1;
  const z = Math.abs(Math.atanh(Math.min(Math.abs(r), 0.999999))) * Math.sqrt(n - 3);
  return erfc(z / Math.SQRT2);
}

/** Complementary error function (Numerical Recipes' erfcc, error < 1.2e-7). */
function erfc(x) {
  const t = 1 / (1 + 0.5 * Math.abs(x));
  const y =
    t *
    Math.exp(
      -x * x - 1.26551223 + t * (1.00002368 + t * (0.37409189 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277))))))))
    );
  return x >= 0 ? y : 2 - y;
}

/**
 * How much of a measure a dimension explains: eta squared, adjusted for the
 * number of groups so a column with twenty levels does not win by having more
 * room to fit noise.
 */
export function explained(rows, measure, dim) {
  const groups = new Map();
  let n = 0;
  let sum = 0;
  for (const r of rows) {
    const v = r?.[measure];
    const k = r?.[dim];
    if (!isNum(v) || !present(k)) continue;
    const g = groups.get(k) || [];
    g.push(v);
    groups.set(k, g);
    n += 1;
    sum += v;
  }
  const k = groups.size;
  if (k < 2 || n <= k) return 0;
  const grand = sum / n;
  let between = 0;
  let total = 0;
  for (const g of groups.values()) {
    const mu = g.reduce((s, v) => s + v, 0) / g.length;
    between += g.length * (mu - grand) ** 2;
    for (const v of g) total += (v - grand) ** 2;
  }
  if (!total) return 0;
  const eta2 = between / total;
  return eta2 - ((1 - eta2) * (k - 1)) / (n - k);
}

/**
 * Whether a dimension is a banding of the measure: each level's values sit in
 * a range no other level's reach into. `Risk_Category` holding Low, Medium and
 * High cut from `Automation_Probability` explains all of it and says nothing —
 * the rule the old planner kept for columns named "… Band", read from values.
 */
export function bandingOf(rows, measure, dim) {
  const ranges = new Map();
  for (const r of rows) {
    const v = r?.[measure];
    const k = r?.[dim];
    if (!isNum(v) || !present(k)) continue;
    const g = ranges.get(k) || [Infinity, -Infinity];
    ranges.set(k, [Math.min(g[0], v), Math.max(g[1], v)]);
  }
  if (ranges.size < 2) return false;
  const sorted = [...ranges.values()].sort((a, b) => a[0] - b[0]);
  return sorted.every((g, i) => i === 0 || g[0] >= sorted[i - 1][1]);
}

/**
 * Whether a numeric split is a factor of the measure: the measure's average in
 * each level is that level times one steady number. `Amount` by `Qty` — six
 * orders average 6 × £200, one order 1 × £200 — says only that more units cost
 * more, and "where does amount come from, by qty" is the product restated.
 */
export function factorOf(rows, measure, dim) {
  const groups = new Map();
  for (const r of rows) {
    const v = r?.[measure];
    const k = r?.[dim];
    if (!isNum(v) || !isNum(k) || k <= 0) continue;
    const g = groups.get(k) || [0, 0];
    g[0] += v;
    g[1] += 1;
    groups.set(k, g);
  }
  const levels = [...groups.entries()].filter(([, g]) => g[1] >= 5);
  if (levels.length < 3) return false;
  const perUnit = levels.map(([k, [s, n]]) => s / n / k);
  const means = levels.map(([, [s, n]]) => s / n);
  if (perUnit.some((x) => x <= 0)) return false;
  return extent(means).max / extent(means).min >= 2 && extent(perUnit).max / extent(perUnit).min < 1.25;
}

/**
 * How far an outcome's rate moves across a driver's levels, in points — and
 * whether the driver separates it perfectly, which makes it the outcome
 * restated rather than something that explains it.
 */
export function outcomeSpread(rows, outcome, driver, { band = false } = {}) {
  const isEvent = (v) => String(v) === String(outcome.event);
  const groups = new Map();
  const values = band ? rows.map((r) => r?.[driver]).filter(isNum).sort((x, y) => x - y) : null;
  const edges = band ? [0.25, 0.5, 0.75].map((q) => values[Math.floor(q * (values.length - 1))]) : null;
  for (const r of rows) {
    const o = r?.[outcome.column];
    if (!present(o)) continue;
    let k = r?.[driver];
    if (!present(k)) continue;
    if (band) k = edges.filter((e) => k > e).length;
    const g = groups.get(k) || [0, 0];
    g[0] += isEvent(o) ? 1 : 0;
    g[1] += 1;
    groups.set(k, g);
  }
  const floor = rows.length * 0.05;
  const rates = [...groups.values()].filter(([, n]) => n >= floor && n >= 5).map(([e, n]) => (100 * e) / n);
  if (rates.length < 2) return { spread: 0, separates: false };
  return { spread: extent(rates).max - extent(rates).min, separates: rates.every((r) => r <= 1 || r >= 99) };
}

/** A two-level yes/no column, read as an outcome: which level is the event. */
function flagOutcome(rows, col, model = null) {
  // The model counted every row: a column without exactly two values is not a
  // yes/no, and there is no need to read it again to find that out.
  if (model && model.columns[col]?.distinct !== 2) return null;
  const levels = [...new Set(rows.map((r) => r?.[col]).filter(present).map(String))];
  if (levels.length !== 2) return null;
  const yes = levels.find((l) => YES.test(l.trim()));
  const no = levels.find((l) => NO.test(l.trim()));
  if (!yes || !no) return null;
  return { column: col, event: yes, other: no, levels, kind: 'binary', highIsGood: false, source: 'flag' };
}

/* ── The catalogue ─────────────────────────────────────────────────────── */

/**
 * Every question the catalogue can ask of this table, best first, the first
 * few marked `recommended`.
 *
 * @param {object[]} rows
 * @param {object} model     from `buildTableModel`
 * @param {object} [options]
 * @param {object} [options.outcome]  from `outcomeVariable`: a named or briefed outcome, or null
 */
export function suggestQuestions(rows, model, { outcome = null } = {}) {
  const out = [];
  const seen = new Set();
  // Scores — how much a split explains, how strongly two measures move
  // together — are read from a sample on a large table (see
  // SAMPLE_ROWS in lib/tableModel.js). Checks that must hold for every row,
  // such as a range never overlapping another or one count never exceeding
  // another, still read every row.
  const sample = sampleOf(rows);
  // Two lists. `ask` is the ranked set the recommended questions come from;
  // `offer` is the long tail the card lists after them and never pre-ticks —
  // the splits with no evident effect, which a reader may still want answered
  // ("does department matter?" — no, and that is an answer).
  const tail = [];
  const add = (list) => (q) => {
    const id = [q.intent, q.outcome?.column, q.measure, q.cost, q.other, q.by, q.over, q.level, ...(q.items || [])].filter(Boolean).join('|');
    if (seen.has(id)) return;
    seen.add(id);
    list.push({ id, ...q });
  };
  const ask = add(out);
  const offer = add(tail);
  const grain = model.grain;
  const time = grain.time;
  const long = model.long;
  const key = [grain.key].flat().filter(Boolean);
  const entityWord = key.length ? name(key[key.length - 1]) : 'row';
  const { flows, levels, rates } = measureSets(model, rows);
  const entityLike = ['entity', 'observation'].includes(grain.kind);

  /**
   * The outcomes. A column named for one (or a brief's) comes first. Failing
   * that, yes/no columns that other columns move: a flag whose rate differs by
   * ten points or more across some driver, the later columns first — a table
   * is usually laid out with what happened after what it happened to.
   */
  const binaries = [];
  // A table of priced things describes an offer, and its yes/no columns are
  // what the offer includes (SSO, an API, open weights) — features, not
  // outcomes. So is any table with three or more of them: a feature matrix.
  const priced = Object.values(model.measures).some((m) => m.unit === 'currency' && !m.sum);
  const flagColumns = Object.keys(model.columns).filter((c) => flagOutcome(rows, c, model));
  if (outcome?.column && (outcome.kind || 'binary') === 'binary') binaries.push(outcome);
  else if (!outcome?.column && !priced && flagColumns.length <= 2) {
    const flags = Object.keys(model.columns)
      .map((c, i) => ({ o: flagOutcome(rows, c, model), i }))
      .filter((f) => f.o);
    const scored = flags
      .map((f) => {
        const drivers = dimensions(model, rows, { exclude: [f.o.column] });
        const best = Math.max(0, ...drivers.map((d) => {
          const s = outcomeSpread(sample, f.o, d);
          return s.separates ? 0 : s.spread;
        }));
        return { ...f, best };
      })
      .filter((f) => f.best >= 10)
      .sort((a, b) => b.i - a.i);
    binaries.push(...scored.slice(0, 2).map((f) => f.o));
  }
  const outcomeCols = binaries.map((o) => o.column);
  const continuous = outcome?.column && outcome.kind === 'continuous' ? outcome.column : null;
  const dims = dimensions(model, rows, { exclude: [...outcomeCols, long?.by].filter(Boolean) });

  // A long table: every question is asked of the value within one quantity.
  if (long) {
    if (time) ask({ intent: 'trend', measure: long.value, over: time, text: `How has each ${name(long.by).toLowerCase()} moved over time?` });
    // Compared by their average over the periods: a population summed over
    // twelve years is no one's population.
    for (const d of dims.slice(0, 2)) {
      ask({ intent: 'compare', measure: long.value, by: d, mean: !!time, text: `How does each ${name(d).toLowerCase()} compare on each ${name(long.by).toLowerCase()}?` });
    }
    // And each quantity on its own, to choose between.
    const counts = new Map();
    for (const r of rows) if (present(r?.[long.by])) counts.set(r[long.by], (counts.get(r[long.by]) || 0) + 1);
    const quantities = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([l]) => l).slice(0, 6);
    if (time) for (const l of quantities) offer({ intent: 'trend', measure: long.value, over: time, level: l, text: `How has ${l} moved over time?` });
    for (const d of dims.slice(0, 2)) {
      for (const l of quantities.filter((x) => !LOCAL_CURRENCY_RE.test(String(x)))) {
        offer({ intent: 'compare', measure: long.value, by: d, level: l, mean: !!time, text: `How does each ${name(d).toLowerCase()} compare on ${l}?` });
      }
    }
  }

  // A survey: the items side by side, then who answers differently.
  if (grain.kind === 'response') {
    const items = Object.keys(model.measures).filter((m) => !model.measures[m].sum && ordinal(model, rows, m));
    if (items.length >= 3) {
      ask({ intent: 'items', items, text: 'Which questions score lowest, and which highest?' });
      const last = items[items.length - 1];
      for (const d of dims.filter((c) => !items.includes(c)).slice(0, 2)) {
        ask({ intent: 'compare', measure: last, by: d, text: `How does ${name(last)} differ by ${name(d).toLowerCase()}?` });
      }
      // Any other item, by who answered it.
      for (const d of dims.filter((c) => !items.includes(c)).slice(0, 3)) {
        for (const item of items.slice(0, -1).reverse().slice(0, 3)) {
          offer({ intent: 'compare', measure: item, by: d, text: `How does ${name(item)} differ by ${name(d).toLowerCase()}?` });
        }
      }
    }
  }

  // Each outcome: its rate, its rate by whatever moves it most, and in time.
  binaries.forEach((o, n) => {
    // Phrased around the column and its level, which reads right for any
    // outcome: "How often is Churned “Yes”?", "… is Converted “true”?".
    const is = `${name(o.column)} “${o.event}”`;
    ask({ intent: 'outcome-rate', outcome: o, text: `How often is ${is}?` });
    const drivers = [
      ...dimensions(model, rows, { exclude: outcomeCols }).map((c) => ({ by: c, band: false })),
      // A measure only comparable within a scope cannot be banded across it.
      ...Object.keys(model.measures)
        .filter((m) => !ordinal(model, rows, m) && !model.measures[m].scope.length)
        .map((m) => ({ by: m, band: true })),
    ]
      .map((d) => ({ ...d, ...outcomeSpread(sample, o, d.by, { band: d.band }) }))
      .filter((d) => !d.separates && d.spread > 0)
      .sort((a, b) => b.spread - a.spread);
    // The first outcome gets three drivers, a second one: two outcomes should
    // not fill the report between them.
    const lead = n === 0 ? 3 : 1;
    drivers.slice(0, 8).forEach((d, i) => {
      (i < lead ? ask : offer)({ intent: 'outcome-rate', outcome: o, by: d.by, band: d.band, text: `Does ${name(d.by).toLowerCase()} change how often ${name(o.column)} is “${o.event}”?` });
    });
    if (time && n === 0) ask({ intent: 'trend', outcome: o, over: time, text: `How has the share with ${is} moved over time?` });
  });

  // A continuous outcome, from a brief: what explains it, and what moves with it.
  if (continuous) {
    const byExplained = dims
      .filter((d) => !bandingOf(rows, continuous, d))
      .map((d) => ({ d, e: explained(sample, continuous, d) }))
      .filter((x) => x.e > 0)
      .sort((a, b) => b.e - a.e);
    for (const { d } of byExplained.slice(0, 3)) {
      ask({ intent: 'compare', measure: continuous, by: d, mean: true, text: `How does ${name(continuous)} differ by ${name(d).toLowerCase()}?` });
    }
    const partner = Object.keys(model.measures)
      .filter((m) => m !== continuous)
      .map((m) => ({ m, r: Math.abs(correlation(sample, continuous, m)) }))
      .filter((x) => x.r < 0.97 && !measureDependence(sample, continuous, x.m, Object.keys(model.columns)).dependent)
      .sort((a, b) => b.r - a.r)[0];
    if (partner?.r >= 0.2) ask({ intent: 'relationship', measure: continuous, other: partner.m, text: `Does ${name(partner.m)} move with ${name(continuous)}?` });
  }

  // Things with a price: the most for the money, within a like-for-like basis.
  if (entityLike) {
    // The price comparable across the most rows: fewest scopes first, so a USD
    // price beats the same price in each row's local currency; then the one
    // most rows actually have.
    const filled = (m) => model.columns[m]?.filled || 0;
    const byScope = (xs) => [...xs].sort((a, b) => model.measures[a].scope.length - model.measures[b].scope.length || filled(b) - filled(a));
    // A price, not a flow: a monthly charge per customer is what they pay, and
    // "tenure per charge, by customer" answers nothing anyone asked.
    const cost = byScope(rates).find((m) => model.measures[m].unit === 'currency');
    const qualities = rates.filter((m) => m !== cost && model.measures[m].unit !== 'currency');
    const benefit = qualities.find((m) => model.measures[m].unit === 'score') || [...flows, ...qualities].find((m) => m !== cost && model.measures[m].unit !== 'currency');
    if (cost && benefit && key.length) {
      ask({ intent: 'tradeoff', measure: benefit, cost, text: `Which ${entityWord.toLowerCase()} gives the most ${name(benefit)} per ${name(cost)}?` });
    }
    if (cost && dims[0]) ask({ intent: 'compare', measure: cost, by: dims[0], mean: true, text: `How does ${name(cost)} compare across ${name(dims[0]).toLowerCase()}s?` });
    if (benefit && dims[0]) ask({ intent: 'compare', measure: benefit, by: dims[0], mean: true, text: `Which ${name(dims[0]).toLowerCase()} leads on ${name(benefit)}?` });
  }

  // Comparisons with answers: the measure and split the rows say differ most.
  const comparable = entityLike ? [...rates, ...flows] : rates;
  const pairs = comparable
    .filter((m) => m !== continuous && !(long && m === long.value))
    .flatMap((m) => dims.filter((d) => d !== m && !bandingOf(rows, m, d)).map((d) => ({ m, d, e: explained(sample, m, d) })))
    .filter((p) => p.e > 0.02)
    .sort((a, b) => b.e - a.e);
  const usedMeasures = new Set();
  const levelsOf = (d) => model.columns[d]?.distinct || Infinity;
  for (const p of pairs) {
    if (usedMeasures.has(p.m)) continue;
    usedMeasures.add(p.m);
    // The coarsest split that explains most of it: a neighbourhood explains
    // price a little better than its city only because it sits inside it.
    const coarser = pairs
      .filter((x) => x.m === p.m && levelsOf(x.d) < levelsOf(p.d) && x.e >= 0.8 * p.e)
      .sort((a, b) => levelsOf(a.d) - levelsOf(b.d))[0];
    const by = coarser ? coarser.d : p.d;
    ask({ intent: 'compare', measure: p.m, by, mean: true, text: `How does ${name(p.m)} differ by ${name(by).toLowerCase()}?` });
    if (usedMeasures.size >= 3) break;
  }
  // And every measure by the leading splits, whatever the rows say about it.
  for (const m of comparable.filter((x) => x !== continuous && !(long && x === long.value)).slice(0, 6)) {
    for (const d of dims.filter((x) => x !== m && !bandingOf(rows, m, x)).slice(0, 3)) {
      offer({ intent: 'compare', measure: m, by: d, mean: true, text: `How does ${name(m)} differ by ${name(d).toLowerCase()}?` });
    }
  }

  // Rows in time: the main total's trend, the volume, and where the total comes from.
  const primary = flows[0] || null;
  if (time && !long) {
    if (primary) ask({ intent: 'trend', measure: primary, over: time, text: `How is ${name(primary)} moving over time?` });
    if (levels[0]) ask({ intent: 'trend', measure: levels[0], over: time, text: `Is ${name(levels[0])} building up or running down?` });
    if (!primary && !levels[0] && rates[0]) ask({ intent: 'trend', measure: rates[0], over: time, text: `How has ${name(rates[0])} moved over time?` });
    if (grain.kind === 'event') ask({ intent: 'trend', measure: null, over: time, text: 'Is the volume of rows rising or falling?' });
    if (flows[1]) ask({ intent: 'trend', measure: flows[1], over: time, text: `How is ${name(flows[1])} moving over time?` });
  }
  if (primary && !long && !entityLike) {
    dims.filter((d) => !factorOf(rows, primary, d)).slice(0, 6).forEach((d, i) =>
      (i < 3 ? ask : offer)({ intent: 'composition', measure: primary, by: d, text: `Where does ${name(primary)} come from, by ${name(d).toLowerCase()}?` })
    );
    for (const f of flows.slice(1, 3)) {
      for (const d of dims.filter((x) => !factorOf(rows, f, x)).slice(0, 2)) offer({ intent: 'composition', measure: f, by: d, text: `Where does ${name(f)} come from, by ${name(d).toLowerCase()}?` });
    }
  }

  // More to choose from, never pre-ticked: the questionnaire asks five to ten
  // multiple-choice questions, and a table with two splits and one total
  // should still have that many worth asking. Each is one the compiler draws
  // as validly as the ones above: an average per row by a split, how the rows
  // themselves divide, and the other measures over time.
  if (!long && !entityLike) {
    for (const m of flows.slice(0, 3)) {
      for (const d of dims.filter((x) => x !== m && !bandingOf(rows, m, x) && !factorOf(rows, m, x)).slice(0, 3)) {
        offer({ intent: 'compare', measure: m, by: d, mean: true, text: `How does the average ${name(m)} differ by ${name(d).toLowerCase()}?` });
      }
    }
  }
  if (!long) {
    for (const d of dims.slice(0, 3)) offer({ intent: 'composition', measure: null, by: d, text: `How are the rows split by ${name(d).toLowerCase()}?` });
  }
  if (time && !long) {
    for (const m of [...flows.slice(2, 4), ...rates.slice(0, 3)]) {
      offer({ intent: 'trend', measure: m, over: time, text: `How has ${name(m)} moved over time?` });
    }
  }

  // A funnel: one count that never exceeds another is a rate of it.
  if (!entityLike && dims[0]) {
    const counts = flows.filter((m) => model.measures[m].unit === 'count');
    let funnel = null;
    for (const a of counts) {
      for (const b of counts) {
        if (a === b) continue;
        const both = rows.filter((r) => isNum(r?.[a]) && isNum(r?.[b]));
        // A funnel's two counts are kept on the same rows. Two sparse columns
        // that happen to share ten rows are not one, and the ratio of their
        // sums would be read over all the rows each has on its own.
        const either = rows.filter((r) => isNum(r?.[a]) || isNum(r?.[b])).length;
        if (both.length < 10 || both.length < 0.8 * either || both.some((r) => r[a] > r[b])) continue;
        const share = both.reduce((s, r) => s + r[a], 0) / (both.reduce((s, r) => s + r[b], 0) || 1);
        if (share > 0 && share < 1 && (!funnel || share < funnel.share)) funnel = { a, b, share };
      }
    }
    if (funnel) ask({ intent: 'ratio', measure: funnel.a, other: funnel.b, by: dims[0], text: `Which ${name(dims[0]).toLowerCase()} turns the most ${name(funnel.b)} into ${name(funnel.a)}?` });
  }

  if (!primary && !rates.length && !binaries.length && dims.length && !entityLike) {
    // Nothing to measure but the rows themselves.
    ask({ intent: 'composition', measure: null, by: dims[0], text: `How are the rows split by ${name(dims[0]).toLowerCase()}?` });
  }

  // The two measures that move together most, unless one restates the other:
  // the same figure at another scale (r above 0.97), or a total against one of
  // its own factors — revenue against units sold, where revenue is units
  // times a price. And not a pair that luck explains once every pair searched
  // is counted: on a wide table of noise, one pair in a thousand looks strong.
  const pool = [...flows, ...rates];
  const candidates = [];
  let searched = 0;
  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      const { r: signed, n } = correlated(sample, pool[i], pool[j]);
      if (n < 8) continue;
      searched += 1;
      const r = Math.abs(signed);
      if (r > 0.97 || r < 0.2) continue;
      candidates.push({ a: pool[i], b: pool[j], r, n });
    }
  }
  candidates.sort((x, y) => y.r - x.r);
  const columnNames = Object.keys(model.columns);
  const related = [];
  for (const c of candidates) {
    if (related.length >= 3) break;
    if (chanceOf(c.r, c.n) * searched >= 0.01) continue;
    if (measureDependence(sample, c.a, c.b, columnNames).dependent) continue;
    related.push(c);
  }
  related.forEach(({ a, b, r }, i) =>
    (i === 0 && r >= 0.3 ? ask : offer)({ intent: 'relationship', measure: b, other: a, text: `Does ${name(a)} move with ${name(b)}?` })
  );

  // Things in a table of entities, ranked by each measure.
  if (grain.kind === 'entity' && key.length) {
    for (const m of [...flows, ...rates].slice(0, 3)) offer({ intent: 'rank', measure: m, text: `Which ${entityWord.toLowerCase()}s have the most ${name(m)}?` });
  }

  return [...out.map((q, i) => ({ ...q, recommended: i < RECOMMENDED })), ...tail.map((q) => ({ ...q, recommended: false }))];
}
