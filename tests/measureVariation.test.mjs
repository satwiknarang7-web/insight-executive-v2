import test from 'node:test';
import assert from 'node:assert/strict';
import { byVariation, measureVariation, quantile } from '../lib/measureVariation.js';

/* One row must not decide what the dashboard opens with.

   The shipped strip on a 44-row comparison of AI subscription plans led with
   "Average Min Seats 8.8". `Min Seats` is the number 1 on thirty-two rows and 2
   on six; one row — Microsoft's enterprise tier — reads 300. That single row
   gave the column a range of 299 and therefore the widest relative range in the
   file, and 8.8 is a figure no plan in it is anywhere near.

   `max - min` is decided by two rows, and often, as here, by one. The middle
   half of a column cannot be moved that way. */

/** The real shape of `Min Seats`: 32 ones, 6 twos, and one 300. */
function plansTable() {
  const rows = [];
  for (let i = 0; i < 44; i++) {
    rows.push({
      'Min Seats': i === 0 ? 300 : i < 7 ? 2 : 1,
      // A price: it moves, everywhere, by amounts that are the point of the file.
      'Monthly Price USD': [0, 4.15, 20, 25, 100, 200, 250][i % 7] + (i % 3),
      // The other trap: nearly constant, counted in millions.
      'Context Window': i % 9 === 0 ? 200000 : 1000000,
    });
  }
  return rows;
}

const stats = (rows, m) => {
  const v = rows.map((r) => r[m]).filter(Number.isFinite);
  return { mean: v.reduce((a, b) => a + b, 0) / v.length, spread: Math.max(...v) - Math.min(...v) };
};
const statsFor = (rows, ms) => Object.fromEntries(ms.map((m) => [m, stats(rows, m)]));

test('the old statistic really does put the one-row column first', () => {
  // Stated rather than assumed: this is the fixture reproducing the bug, and
  // without it the tests below prove nothing. `Min Seats` wins on range over
  // mean because of a single row, which is the whole of the defect.
  const rows = plansTable();
  const cols = Object.keys(rows[0]);
  const s = statsFor(rows, cols);
  const oldWay = [...cols].sort(
    (a, b) => s[b].spread / Math.abs(s[b].mean) - s[a].spread / Math.abs(s[a].mean)
  );
  assert.equal(oldWay[0], 'Min Seats');
});

test('a column that does vary keeps the order it always had', () => {
  /* The change is a gate, not a new ranking. Four real exports say the old
     ordering is a good one once the constant columns are out of its way, and
     every robust dispersion measure tried in its place moved at least one of
     them to something worse — a retail file off revenue, a campaign file off
     cost per acquisition. So among columns that vary, nothing is reordered. */
  const rows = Array.from({ length: 60 }, (_, i) => ({
    Wide: (i % 30) * 100,
    Narrow: 50 + (i % 4),
    Middle: (i % 12) * 3,
  }));
  const cols = ['Narrow', 'Middle', 'Wide'];
  const s = statsFor(rows, cols);
  const v = measureVariation(rows, cols, s);
  for (const c of cols) assert.equal(v[c].varies, true);

  const oldWay = [...cols].sort((a, b) => s[b].spread / Math.abs(s[b].mean) - s[a].spread / Math.abs(s[a].mean));
  assert.deepEqual([...cols].sort(byVariation(v)), oldWay);
});

test('and a column that is one number in the middle goes last', () => {
  const rows = plansTable();
  const cols = Object.keys(rows[0]);
  const v = measureVariation(rows, cols, statsFor(rows, cols));

  assert.deepEqual([...cols].sort(byVariation(v))[0], 'Monthly Price USD');

  // Both traps fail the same honest test: more than half of each column is a
  // single value, so its middle half holds nothing to report — whatever one
  // extreme row does to its range.
  assert.equal(v['Min Seats'].varies, false);
  assert.equal(v['Context Window'].varies, false);
  assert.equal(v['Monthly Price USD'].varies, true);
});

test('an outlier of any size cannot rescue a constant column', () => {
  const rows = plansTable();
  const cols = Object.keys(rows[0]);
  rows[0]['Min Seats'] = 5_000_000;
  const v = measureVariation(rows, cols, statsFor(rows, cols));
  assert.equal(v['Min Seats'].varies, false, 'one row still decided the column');
  assert.equal(v['Min Seats'].iqr, 0);
  assert.deepEqual([...cols].sort(byVariation(v))[0], 'Monthly Price USD');
});

test('when every column is constant the ends still order them', () => {
  // A file where nothing varies through its middle still has to put something
  // on the card, and there the extremes are the only information there is. An
  // empty card is worse than a weak one.
  const rows = Array.from({ length: 40 }, (_, i) => ({
    A: i === 0 ? 100 : 1,
    B: i === 0 ? 3 : 1,
  }));
  const v = measureVariation(rows, ['A', 'B'], statsFor(rows, ['A', 'B']));
  assert.equal(v.A.varies, false);
  assert.equal(v.B.varies, false);
  assert.deepEqual(['B', 'A'].sort(byVariation(v)), ['A', 'B']);
});

test('a column centred on zero is the most variable one, not a constant', () => {
  /* The trap in asking the question as a ratio. A profit, a delta, a
     temperature anomaly swings hard in both directions and averages out to
     nothing, so scaling its spread by its centre divides by zero — and reports
     the most variable column in the file as flat. The question is asked against
     the column's own range instead, which is zero only when the column is. */
  const rows = Array.from({ length: 40 }, (_, i) => ({
    Delta: i % 2 ? 5 : -5,
    Flat: 7,
  }));
  const v = measureVariation(rows, ['Delta', 'Flat'], statsFor(rows, ['Delta', 'Flat']));
  assert.equal(v.Delta.varies, true, 'a column swinging from -5 to 5 was called constant');
  assert.equal(v.Flat.varies, false);
  assert.deepEqual(['Flat', 'Delta'].sort(byVariation(v)), ['Delta', 'Flat']);
});

test('nulls and non-numbers are skipped, not counted as zero', () => {
  const rows = [
    ...Array.from({ length: 20 }, () => ({ Price: null })),
    ...Array.from({ length: 20 }, (_, i) => ({ Price: 100 + i })),
  ];
  const v = measureVariation(rows, ['Price'], statsFor(rows.filter((r) => r.Price !== null), ['Price']));
  // Twenty values from 100 to 119: median 109.5, IQR about 10.
  assert.ok(Math.abs(v.Price.median - 109.5) < 1, `median was ${v.Price.median}`);
  assert.ok(v.Price.iqr > 5 && v.Price.iqr < 15, `iqr was ${v.Price.iqr}`);
});

test('quantiles interpolate, and survive the degenerate widths', () => {
  assert.equal(quantile([1, 2, 3, 4], 0.5), 2.5);
  assert.equal(quantile([1, 2, 3, 4, 5], 0.25), 2);
  assert.equal(quantile([7], 0.5), 7);
  assert.ok(Number.isNaN(quantile([], 0.5)));
});

test('a large column is sampled, not truncated', () => {
  // Past the cap the values are taken on a stride, so the quantiles are the
  // column's quantiles — not the first twenty thousand rows', which on a file
  // sorted by anything at all would be a different distribution entirely.
  const n = 200_000;
  const rows = Array.from({ length: n }, (_, i) => ({ Sorted: i }));
  const v = measureVariation(rows, ['Sorted'], { Sorted: { mean: n / 2, spread: n - 1 } });
  assert.ok(Math.abs(v.Sorted.median - n / 2) < n * 0.01, `median was ${v.Sorted.median}`);
  assert.ok(Math.abs(v.Sorted.iqr - n / 2) < n * 0.01, `iqr was ${v.Sorted.iqr}`);
});

test('the sample does not fall into step with the shape of the file', () => {
  /* The failure mode a plain every-k-th-row sample has, and the reason the
     stride is coprime to the row count.

     Real exports repeat: five rows per order, twelve per contract, one per
     month per store. Here every tenth row carries a value a hundred times the
     others — a header line, a total row, a different unit. A stride that is a
     multiple of ten reads only those rows and reports a column of 100s; one
     that is coprime to the row count advances its phase every visit and sees
     the file as it is. */
  const n = 200_000;
  const rows = Array.from({ length: n }, (_, i) => ({ Periodic: i % 10 === 0 ? 100 : 1 }));
  const v = measureVariation(rows, ['Periodic'], { Periodic: { mean: 10.9, spread: 99 } });

  // Nine in ten rows are 1, so every quartile is 1 and the column does not move
  // through its middle. A sample locked to the tenth row would say the median
  // is 100 and the column is constant at a hundred times its real size.
  assert.equal(v.Periodic.median, 1, 'the sample read one phase of the file');
  assert.equal(v.Periodic.varies, false);
});

/* And the planner, which is the thing the reader sees. */
const { planKpis, planCharts } = await import('../lib/analystPlanner.js');

test('the strip leads with a price rather than a seat minimum', () => {
  const rows = plansTable().map((r, i) => ({ ...r, Provider: ['OpenAI', 'Anthropic', 'Google'][i % 3] }));
  const labels = planKpis(rows).map((k) => k.label);

  assert.ok(
    !labels.some((l) => /min seats/i.test(l)),
    `a column that is the number 1 on three quarters of the file is still a headline: ${JSON.stringify(labels)}`
  );
  assert.ok(
    labels.some((l) => /monthly price/i.test(l)),
    `the measure the file is about is missing: ${JSON.stringify(labels)}`
  );
});

test('the charts are planned on the same reading', () => {
  const rows = plansTable().map((r, i) => ({ ...r, Provider: ['OpenAI', 'Anthropic', 'Google'][i % 3] }));
  const charted = planCharts(rows, { max: 6 }).map((c) => `${c.title} ${c.yAxisKey}`).join(' | ');
  assert.ok(/price/i.test(charted), `no chart of the price column: ${charted}`);
  assert.ok(!/min seats/i.test(charted), `the one-row column was charted: ${charted}`);
});
