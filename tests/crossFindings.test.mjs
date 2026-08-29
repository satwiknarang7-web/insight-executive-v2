import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  attributeChange,
  interactionResidual,
  resolveColumn,
  segmentOverlap,
} from '../lib/crossFindings.js';
import { runAnalysis } from '../lib/pipeline.js';

/* Statements that need more than one finding to be true.

   Every sentence in a deck used to be written from one chart, which is why the
   summary read as a list: revenue fell, one category is most of revenue, one
   region is largest — three facts and no story, with the reader left to notice
   that the first two are probably the same sentence. */

test('an axis alias resolves back to the column underneath it', () => {
  const columns = ['Order_Date', 'Total_Amount', 'Quantity', 'Product_Category'];
  assert.equal(resolveColumn('Total Amount', columns), 'Total_Amount');
  assert.equal(resolveColumn('Average Total Amount', columns), 'Total_Amount');
  assert.equal(resolveColumn('Product Category', columns), 'Product_Category');
  assert.equal(resolveColumn('Nothing Like It', columns), null);
  assert.equal(resolveColumn('', columns), null);
});

test('the segment that moved the total is found, not guessed', () => {
  // One category falls to nothing; the rest are flat. The trend chart shows a
  // decline and cannot say whose.
  const rows = [];
  for (let month = 1; month <= 12; month++) {
    for (const cat of ['Electronics', 'Home', 'Sports']) {
      for (let k = 0; k < 40; k++) {
        rows.push({
          Period: `2025-${String(month).padStart(2, '0')}`,
          Category: cat,
          Revenue: cat === 'Electronics' ? Math.round(1000 * (1 - (month / 12) * 0.8)) : 300,
        });
      }
    }
  }
  const moved = attributeChange(rows, {
    timeColumn: 'Period',
    measureColumn: 'Revenue',
    dimension: 'Category',
  });
  assert.equal(moved.segment, 'Electronics');
  assert.equal(moved.direction, 'fall');
  assert.ok(moved.share > 0.95, `share was ${moved.share}`);
  assert.equal(moved.segments, 3);
});

test('a movement spread evenly across segments names no culprit', () => {
  const rows = [];
  for (let month = 1; month <= 12; month++) {
    for (const cat of ['A', 'B', 'C', 'D']) {
      rows.push({ Period: `2025-${String(month).padStart(2, '0')}`, Cat: cat, V: 1000 - month * 50 });
    }
  }
  const moved = attributeChange(rows, { timeColumn: 'Period', measureColumn: 'V', dimension: 'Cat' });
  // Every segment fell by the same amount, so no one of them is the story.
  assert.ok(Math.abs(moved.share) < 0.5, `one of four claimed ${moved.share} of the fall`);
});

test('too few periods to compare is not an attribution', () => {
  const rows = [
    { P: '2025-01', C: 'A', V: 10 },
    { P: '2025-02', C: 'A', V: 5 },
  ];
  assert.equal(attributeChange(rows, { timeColumn: 'P', measureColumn: 'V', dimension: 'C' }), null);
  assert.equal(attributeChange([], { timeColumn: 'P', measureColumn: 'V', dimension: 'C' }), null);
  assert.equal(attributeChange(rows, {}), null);
});

test('a cross-tab cell that its own margins do not predict is found', () => {
  // Electronics is the bigger row and North the bigger column, so an
  // independent grid would put the most in Electronics/North. It holds the
  // least — which neither bar chart of the margins can show.
  const cells = [
    { Cat: 'Electronics', Region: 'North', Revenue: 100 },
    { Cat: 'Electronics', Region: 'South', Revenue: 900 },
    { Cat: 'Home', Region: 'North', Revenue: 400 },
    { Cat: 'Home', Region: 'South', Revenue: 400 },
  ];
  const residual = interactionResidual(cells, {
    rowKey: 'Cat',
    columnKey: 'Region',
    valueKey: 'Revenue',
  });
  assert.ok(residual, 'a departure this large is a finding');
  assert.notEqual(Math.round(residual.ratio * 10) / 10, 1);
});

test('a grid whose cells are exactly what its margins predict has no residual', () => {
  // Perfectly independent: every cell is row total x column total / grand.
  const cells = [];
  for (const [r, rw] of [['A', 3], ['B', 1]]) {
    for (const [c, cw] of [['X', 2], ['Y', 2]]) cells.push({ R: r, C: c, V: rw * cw * 100 });
  }
  assert.equal(interactionResidual(cells, { rowKey: 'R', columnKey: 'C', valueKey: 'V' }), null);
});

test('two standout segments are measured for being the same records', () => {
  // Month-to-month customers are the new ones: two charts, one population.
  const same = Array.from({ length: 900 }, (_, i) => ({
    Contract: i % 3 === 0 ? 'Month-to-month' : 'Two year',
    Band: i % 3 === 0 ? '0-12' : '24+',
  }));
  const overlap = segmentOverlap(same, {
    columnA: 'Contract', valueA: 'Month-to-month',
    columnB: 'Band', valueB: '0-12',
  });
  assert.equal(overlap.overlap, 1);
  assert.ok(overlap.lift > 2, `lift was ${overlap.lift}`);

  // And two genuinely separate populations read as separate.
  const apart = Array.from({ length: 900 }, (_, i) => ({
    Contract: i % 3 === 0 ? 'Month-to-month' : 'Two year',
    Band: i % 5 === 0 ? '0-12' : '24+',
  }));
  const independent = segmentOverlap(apart, {
    columnA: 'Contract', valueA: 'Month-to-month',
    columnB: 'Band', valueB: '0-12',
  });
  assert.ok(Math.abs(independent.lift - 1) < 0.4, `lift was ${independent.lift}`);
});

test('the summary says who moved the total, in words, from the rows', () => {
  let seed = 21;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const W = { Electronics: 14, Home: 1.4, Sports: 1.2, Fashion: 1.1, Grocery: 0.5 };
  const rows = [];
  for (let i = 0; i < 9000; i++) {
    const cat = pick(Object.keys(W));
    const reg = pick(['North', 'South', 'East', 'West']);
    const month = 1 + Math.floor((i / 9000) * 24);
    const y = 2024 + Math.floor((month - 1) / 12);
    const mo = ((month - 1) % 12) + 1;
    // Only one category falls, and it is weak in one region.
    const decay = cat === 'Electronics' ? 1 - (month / 24) * 0.8 : 1;
    rows.push({
      Order_Date: `${y}-${String(mo).padStart(2, '0')}-15`,
      Category: cat,
      Region: reg,
      Quantity: 1 + Math.floor(rnd() * 5),
      Total_Amount: Math.round(
        2000 * W[cat] * (0.7 + rnd() * 0.6) * decay * (cat === 'Electronics' && reg === 'North' ? 0.2 : 1)
      ),
    });
  }

  const { synthesis } = runAnalysis(rows, { maxCharts: 9 });
  const joined = synthesis.connections.join(' | ');

  assert.match(joined, /of the fall in|all of the fall/, `no attribution: ${joined}`);
  assert.match(joined, /Electronics/);
  // And it does not also say the weaker, inferred version of the same thing.
  assert.doesNotMatch(joined, /substantially a report on/, `both versions shipped: ${joined}`);
});
