/**
 * Tables nobody wrote by hand, each with one planted trap and the truth it was
 * built with.
 *
 * The corpus proves the engine on files someone chose. This is what stands in
 * for "some other dataset": eight archetypes, each a trap the rules in
 * `eval/audit.mjs` exist for, generated at random sizes and scales under
 * column names drawn from several domains and from meaningless codes — so
 * nothing passes by recognising an English word. Seeds are fixed; a
 * difference in the scorecard is a difference in the engine.
 *
 * Every table goes through `eval/chain.mjs` as CSV text, so it is typed the way
 * the app would type an upload.
 */
import { ingest } from './chain.mjs';

const CASES_PER_ARCHETYPE = 5;

function rng(seed) {
  let s = seed >>> 0 || 1;
  const next = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 0x100000000);
  const int = (lo, hi) => lo + Math.floor(next() * (hi - lo + 1));
  const pick = (a) => a[Math.floor(next() * a.length)];
  return { next, int, pick };
}

const cell = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = (header, rows) => [header.join(','), ...rows.map((r) => r.map(cell).join(','))].join('\n') + '\n';
const r2 = (x) => Math.round(x * 100) / 100;
const iso = (ms) => new Date(ms).toISOString().slice(0, 19) + 'Z';
const DAY = 86400000;

/** Column names from four vocabularies, one of them meaningless on purpose. */
const NAMES = {
  key: ['item_id', 'asset_ref', 'listing_code', 'member_no', 'k1', 'unit_key'],
  category: ['segment', 'family', 'cluster', 'group_c', 'dim_a', 'division'],
  scope: ['billing_basis', 'currency_code', 'pricing_unit', 'basis', 'dim_s', 'measure_basis'],
  money: ['list_price', 'fee', 'charge_amt', 'cost_val', 'm_1', 'rate_card'],
  quality: ['quality_idx', 'benchmark', 'rating_pts', 'm_2', 'perf_score', 'grade_val'],
  amount: ['amount', 'volume', 'qty_moved', 'm_3', 'throughput', 'load_val'],
  time: ['recorded_at', 'event_time', 'ts', 't_0', 'logged', 'captured_on'],
  level: ['on_hand', 'balance', 'headcount', 'level_l', 'queue_depth', 'backlog'],
  rate: ['pct_bounce', 'fill_rate', 'share_pct', 'r_1', 'yield_pct', 'ratio_val'],
  flag: ['outcome_flag', 'lapsed', 'passed', 'f_1', 'defaulted', 'won'],
};
const labels = (r, prefix, n) => Array.from({ length: n }, (_, i) => `${prefix} ${String.fromCharCode(65 + i)}${r.int(1, 9)}`);

/* ── The archetypes ────────────────────────────────────────────────────── */

const ARCHETYPES = {
  /* A price quoted in several bases at wildly different scales. */
  scope(r) {
    const [key, cat, scope, money, quality] = ['key', 'category', 'scope', 'money', 'quality'].map((k) => r.pick(NAMES[k]));
    const bases = labels(r, 'Basis', r.int(2, 4)).map((b, i) => [b, [1, 12, 90, 400][i]]);
    const cats = labels(r, 'Group', r.int(3, 6));
    const rows = Array.from({ length: r.int(24, 160) }, (_, i) => {
      const [basis, scale] = r.pick(bases);
      return [`${key.toUpperCase()}-${1000 + i}`, r.pick(cats), basis, r2(scale * (5 + r.next() * 20)), r.int(20, 90)];
    });
    return { header: [key, cat, scope, money, quality], rows, truth: { grain: 'entity', measures: { [money]: { scope: [scope] } } } };
  },

  /* One entity worth fifty of the rest. */
  outlier(r) {
    const [key, cat, money] = ['key', 'category', 'money'].map((k) => r.pick(NAMES[k]));
    const cats = labels(r, 'Group', r.int(2, 5));
    const rows = Array.from({ length: r.int(30, 250) }, (_, i) => [`${key.toUpperCase()}-${i}`, r.pick(cats), r2(50 + r.next() * 150)]);
    rows[r.int(0, rows.length - 1)][2] = r2(10000 + r.next() * 5000);
    return { header: [key, cat, money], rows, truth: { grain: 'entity', measures: {} } };
  },

  /* A series shorter than a month, at hour or minute resolution. */
  resolution(r) {
    const [time, cat, amount] = ['time', 'category', 'amount'].map((k) => r.pick(NAMES[k]));
    const days = r.pick([3, 9, 20, 27]);
    const step = r.pick([60000, 600000, 3600000]);
    const start = Date.UTC(2026, r.int(0, 10), 1);
    const n = Math.min(3000, Math.floor((days * DAY) / step));
    const cats = labels(r, 'Line', r.int(2, 4));
    const rows = Array.from({ length: n }, (_, i) => [iso(start + i * step), r.pick(cats), r2(10 + r.next() * 40 + (i / n) * 15)]);
    return { header: [time, cat, amount], rows, truth: { grain: 'event', time, measures: {} } };
  },

  /* One value column holding quantities on different scales. */
  long(r) {
    const quantities = labels(r, 'Indicator', r.int(2, 4)).map((q, i) => [q, [1, 1e3, 1e6, 1e9][i]]);
    const entities = labels(r, 'Region', r.int(3, 8));
    const years = Array.from({ length: r.int(4, 10) }, (_, i) => 2014 + i);
    const [entityCol, byCol, valueCol] = [r.pick(['country', 'entity', 'site', 'e_1']), r.pick(['indicator', 'series', 'metric_name', 'q_1']), r.pick(['value', 'obs', 'reading', 'v'])];
    const rows = [];
    for (const e of entities) for (const y of years) for (const [q, scale] of quantities) rows.push([e, y, q, r2(scale * (1 + r.next() * 9))]);
    return { header: [entityCol, 'year', byCol, valueCol], rows, truth: { grain: 'long', long: { value: valueCol, by: byCol }, measures: {} } };
  },

  /* A level recorded every period: never summed across periods. */
  level(r) {
    const [key, level, amount] = ['key', 'level', 'amount'].map((k) => r.pick(NAMES[k]));
    const periodCol = r.pick(['week_start', 'snapshot_date', 'period', 'as_of']);
    const start = Date.UTC(2026, 0, 5);
    const ents = Array.from({ length: r.int(8, 30) }, (_, i) => `${key.toUpperCase()}-${i}`);
    const periods = r.int(6, 20);
    const levels = ents.map(() => r.int(50, 900));
    const rows = [];
    // A level carries over: each period is the last one plus a net movement.
    for (let p = 0; p < periods; p++) {
      ents.forEach((e, i) => {
        levels[i] = Math.max(0, levels[i] + r.int(-60, 60));
        rows.push([iso(start + p * 7 * DAY).slice(0, 10), e, levels[i], r.int(0, 120)]);
      });
    }
    return {
      header: [periodCol, key, level, amount],
      rows,
      truth: { grain: 'entityPeriod', time: periodCol, additive: [amount], measures: { [level]: { noSumAcross: [periodCol] } } },
    };
  },

  /* A percentage recorded per row: averaged, never summed. */
  rate(r) {
    const [time, cat, amount, rate] = ['time', 'category', 'amount', 'rate'].map((k) => r.pick(NAMES[k]));
    const start = Date.UTC(2026, 0, 1);
    const cats = labels(r, 'Channel', r.int(2, 5));
    const days = r.int(60, 200);
    const rows = [];
    for (let d = 0; d < days; d++) for (const c of cats) rows.push([iso(start + d * DAY).slice(0, 10), c, r.int(100, 5000), r2(10 + r.next() * 60)]);
    return { header: [time, cat, amount, rate], rows, truth: { grain: 'entityPeriod', time, additive: [amount], measures: { [rate]: { noSum: true } } } };
  },

  /* A yes/no outcome in several spellings, driven by one column. */
  outcome(r) {
    const [key, cat, flag] = ['key', 'category', 'flag'].map((k) => r.pick(NAMES[k]));
    const driver = r.pick(['tier', 'plan_type', 'cohort', 'dim_d']);
    const levels = labels(r, 'Level', r.int(2, 4));
    const groups = labels(r, 'Group', 3);
    const rows = Array.from({ length: r.int(200, 900) }, (_, i) => {
      const lvl = r.pick(levels);
      const p = 0.1 + levels.indexOf(lvl) * 0.2;
      return [`${key.toUpperCase()}-${i}`, r.pick(groups), lvl, r.next() < p ? r.pick(['Yes', 'Y', 'TRUE', '1']) : r.pick(['No', 'N', 'FALSE', '0'])];
    });
    return { header: [key, cat, driver, flag], rows, truth: { grain: 'entity', outcomes: [flag], measures: {} } };
  },

  /* Additive events over two years: the shape the engine was built for, as a control. */
  control(r) {
    const [time, cat, amount] = ['time', 'category', 'amount'].map((k) => r.pick(NAMES[k]));
    const start = Date.UTC(2025, 0, 1);
    const cats = labels(r, 'Region', r.int(3, 6));
    const rows = Array.from({ length: r.int(300, 1500) }, () => [iso(start + r.int(0, 700) * DAY).slice(0, 10), r.pick(cats), r2(20 + r.next() * 400)]);
    return { header: [time, cat, amount], rows, truth: { grain: 'event', time, additive: [amount], measures: {} } };
  },
};

/** Every fuzz case: `{ name, trap, rows, truth }`, typed by the app's ingest. */
export function fuzzCases() {
  const out = [];
  Object.entries(ARCHETYPES).forEach(([trap, build], a) => {
    for (let i = 0; i < CASES_PER_ARCHETYPE; i++) {
      const r = rng(20260923 + a * 1000 + i * 7919);
      const { header, rows, truth } = build(r);
      out.push({ name: `fuzz_${trap}_${i + 1}`, trap, rows: ingest(csv(header, rows)).rows, truth });
    }
  });
  return out;
}
