import test from 'node:test';
import assert from 'node:assert/strict';

import { buildTableModel } from '../lib/tableModel.js';

/* What lib/tableModel.js reads from a table. The corpus and the fuzz tables
 * score it end to end (eval/scorecard.mjs); these pin each reading on a table
 * small enough to see why — several are false readings it once made. */

const range = (n, f) => Array.from({ length: n }, (_, i) => f(i));
const day = (i) => new Date(Date.UTC(2026, 0, 1 + i)).toISOString();

test('grain: an id per row with no time is a table of entities', () => {
  const rows = range(20, (i) => ({ id: `E${i}`, team: i % 3 ? 'A' : 'B', salary: 100 + i }));
  assert.equal(buildTableModel(rows).grain.kind, 'entity');
});

test('grain: a pair of columns can be the identity', () => {
  const rows = range(12, (i) => ({ vendor: `V${i % 4}`, plan: `P${Math.floor(i / 4)}`, price: 10 + i }));
  const { grain } = buildTableModel(rows);
  assert.equal(grain.kind, 'entity');
  assert.deepEqual(grain.key, ['vendor', 'plan']);
});

test('grain: one row per thing per period, densely, is a panel', () => {
  const rows = range(40, (i) => ({ date: day(Math.floor(i / 4)), channel: `C${i % 4}`, sessions: 100 + i }));
  const { grain } = buildTableModel(rows, { temporal: ['date'] });
  assert.equal(grain.kind, 'entityPeriod');
  assert.equal(grain.entity, 'channel');
});

test('grain: sparse orders by rep and date are events, not a panel', () => {
  const rows = range(40, (i) => ({ date: day(i * 3), rep: `R${i % 5}`, revenue: 100 + i }));
  assert.equal(buildTableModel(rows, { temporal: ['date'] }).grain.kind, 'event');
});

test('grain: repeated measurements with no identity are observations', () => {
  const rows = range(30, (i) => ({ team: `T${i % 3}`, points: 50 + i }));
  assert.equal(buildTableModel(rows).grain.kind, 'observation');
});

test('long: a value column a thousand times bigger for one indicator', () => {
  const rows = [];
  for (const country of ['A', 'B', 'C']) for (const year of [2020, 2021, 2022]) {
    rows.push({ country, year, indicator: 'GDP', value: 1e9 * (1 + year - 2020) });
    rows.push({ country, year, indicator: 'Life expectancy', value: 70 + year - 2020 });
  }
  const model = buildTableModel(rows);
  assert.deepEqual([model.grain.kind, model.long.value, model.long.by], ['long', 'value', 'indicator']);
  assert.ok(model.measures.value.scope.includes('indicator'));
});

test('long: budget and actual are the same size, and are still never added', () => {
  const rows = [];
  for (const dept of ['Ops', 'Sales', 'HR']) for (const m of [1, 2, 3, 4]) {
    rows.push({ dept, month: `2026-0${m}`, scenario: 'Budget', amount: 1000 });
    rows.push({ dept, month: `2026-0${m}`, scenario: 'Actual', amount: 950 + m * 10 });
  }
  assert.equal(buildTableModel(rows).long?.by, 'scenario');
});

test('long: a sales panel is not long, however much products differ', () => {
  const rows = [];
  for (const store of ['S1', 'S2', 'S3']) for (const product of ['Pen', 'Laptop']) for (const m of [1, 2, 3]) {
    rows.push({ store, product, month: `2026-0${m}`, revenue: product === 'Laptop' ? 40000 + m : 400 + m });
  }
  assert.equal(buildTableModel(rows).long, null);
});

test('scope: a price converted at a fixed rate per currency is scoped by the currency', () => {
  const fx = { USD: 1, INR: 83, JPY: 147 };
  const rows = range(30, (i) => {
    const currency = Object.keys(fx)[i % 3];
    const usd = 10 + i;
    return { sku: `S${i}`, currency, price_local: usd * fx[currency], price_usd: usd };
  });
  const { measures } = buildTableModel(rows);
  assert.deepEqual(measures.price_local.scope, ['currency']);
  assert.deepEqual(measures.price_usd.scope, []);
});

test('scope: price per benchmark point is a derived ratio, not a currency', () => {
  // Scores 15 to 57: a spread wide enough to look like exchange rates.
  const score = { M1: 15, M2: 40, M3: 57 };
  const rows = range(30, (i) => {
    const model = Object.keys(score)[i % 3];
    const price = 10 + i * 3;
    return { plan: `P${i}`, model, price_usd: price, usd_per_point: price / score[model] };
  });
  const { measures } = buildTableModel(rows);
  assert.deepEqual(measures.usd_per_point.scope, []);
  assert.deepEqual(measures.price_usd.scope, []);
});

test('scope: a money measure split tenfold by a basis column, named or not', () => {
  const named = range(20, (i) => ({ id: `P${i}`, buyer_unit: i % 2 ? 'user' : 'instance', fee: i % 2 ? 20 + i : 2000 + i }));
  assert.deepEqual(buildTableModel(named).measures.fee.scope, ['buyer_unit']);
  const byValues = range(20, (i) => ({ id: `P${i}`, dim_s: i % 2 ? 'Basis A1' : 'Basis B9', fee: i % 2 ? 20 + i : 2000 + i }));
  assert.deepEqual(buildTableModel(byValues).measures.fee.scope, ['dim_s']);
});

test('scope: storage grows with the plan; it is not denominated in the buyer unit', () => {
  const rows = range(20, (i) => ({ id: `P${i}`, buyer_unit: i % 2 ? 'user' : 'org', storage_gb: i % 2 ? 10 : 5000 }));
  assert.deepEqual(buildTableModel(rows).measures.storage_gb.scope, []);
});

test('scope: the name can say it outright', () => {
  const rows = range(12, (i) => ({ id: `P${i}`, Provider: `V${i % 3}`, 'Usage Multiplier Within Provider': 1 + (i % 4) }));
  assert.deepEqual(buildTableModel(rows).measures['Usage Multiplier Within Provider'].scope, ['Provider']);
});

test('levels: stock that carries over is never summed across weeks; shipments are', () => {
  const rows = [];
  const stock = { A: 300, B: 500, C: 200 };
  for (let w = 0; w < 10; w++) for (const sku of ['A', 'B', 'C']) {
    stock[sku] += (w * 7 + sku.charCodeAt(0)) % 41 - 20;
    rows.push({ week: day(w * 7), sku, stock_on_hand: stock[sku], units_shipped: ((w + 3) * 37 + sku.charCodeAt(0) * 11) % 90 });
  }
  const { measures } = buildTableModel(rows, { temporal: ['week'] });
  assert.deepEqual(measures.stock_on_hand.noSumAcross, ['week']);
  assert.deepEqual(measures.units_shipped.noSumAcross, []);
  assert.equal(measures.units_shipped.sum, true);
});

test('levels: a name that sounds like stock is not enough — it has to carry over', () => {
  const rows = [];
  for (let w = 0; w < 10; w++) for (const sku of ['A', 'B', 'C']) {
    rows.push({ week: day(w * 7), sku, stock_received: ((w + 5) * 53 + sku.charCodeAt(0) * 29) % 97 });
  }
  const { measures } = buildTableModel(rows, { temporal: ['week'] });
  assert.deepEqual(measures.stock_received.noSumAcross, []);
});

test('scope: two scores fixed per model are not a conversion, whatever their ratio', () => {
  // Every plan on a model carries that model's scores, so their ratio is
  // constant inside each model and a hundredfold apart between them — the
  // shape of an exchange rate, with nothing converted.
  const a = { M1: 10, M2: 12, M3: 11 };
  const b = { M1: 1, M2: 20, M3: 100 };
  const rows = range(30, (i) => {
    const model = Object.keys(a)[i % 3];
    return { plan: `P${i}`, model, bench_a: a[model], bench_b: b[model] };
  });
  const { measures } = buildTableModel(rows);
  assert.deepEqual([measures.bench_a.scope, measures.bench_b.scope], [[], []]);
});

test('sums: three columns on one 0–100 scale are scores', () => {
  const rows = range(30, (i) => ({ id: `S${i}`, math: 40 + i, reading: 45 + i, science: 38 + i, visits: i * 3 }));
  const { measures } = buildTableModel(rows);
  assert.deepEqual([measures.math.sum, measures.reading.sum, measures.science.sum], [false, false, false]);
});

test('robust: one row that decides the average is named', () => {
  const rows = range(20, (i) => ({ id: `P${i}`, cost: i === 7 ? 178 : 1 + (i % 5) * 0.1 }));
  const { measures } = buildTableModel(rows);
  assert.equal(measures.cost.robust, false);
  assert.equal(measures.cost.outlier, 178);
});

test('columns: a list of URLs is not a category, and the cleaner flag is not a column', () => {
  const rows = range(10, (i) => ({ id: `P${i}`, source: `https://example.com/${i % 3}`, isAnomaly: i === 3 }));
  const model = buildTableModel(rows);
  assert.equal(model.columns.source.type, 'url');
  assert.equal(model.columns.isAnomaly, undefined);
});
