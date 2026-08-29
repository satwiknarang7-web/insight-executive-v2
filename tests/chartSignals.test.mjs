import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  association,
  bucketCount,
  distributionShape,
  groupAggregate,
  groupMeanPairs,
  legibility,
  mixUnevenness,
  needsHorizontalBars,
  relationshipStrength,
  sampleRows,
  spearman,
  suitsPartToWhole,
  trendStrength,
  varianceExplained,
} from '../lib/chartSignals.js';

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

test('groupAggregate reproduces what the planner SQL would return', () => {
  const rows = [
    { region: 'North', revenue: 10 },
    { region: 'North', revenue: 20 },
    { region: 'South', revenue: 5 },
  ];
  const summed = groupAggregate(rows, 'region', 'revenue', 'SUM');
  assert.deepEqual(summed.groups.map((g) => [g.label, g.value]), [['North', 30], ['South', 5]]);

  const averaged = groupAggregate(rows, 'region', 'revenue', 'AVG');
  assert.deepEqual(averaged.groups.map((g) => [g.label, g.value]), [['North', 15], ['South', 5]]);

  const counted = groupAggregate(rows, 'region', null, 'COUNT');
  assert.deepEqual(counted.groups.map((g) => [g.label, g.value]), [['North', 2], ['South', 1]]);
});

test('a blank dimension value is counted but never becomes a category', () => {
  const rows = [{ tier: 'Gold' }, { tier: '' }, { tier: null }, { tier: 'Gold' }];
  const { groups, blanks, blankRate } = groupAggregate(rows, 'tier', null, 'COUNT');
  assert.deepEqual(groups.map((g) => g.label), ['Gold']);
  assert.equal(blanks, 2);
  assert.equal(blankRate, 0.5);
});

test('sampleRows is deterministic and order-preserving', () => {
  const rows = Array.from({ length: 1000 }, (_, i) => ({ i }));
  const a = sampleRows(rows, 100);
  const b = sampleRows(rows, 100);
  assert.deepEqual(a, b, 'the same file always scores the same way');
  assert.ok(a.length <= 100);
  assert.deepEqual([...a].sort((x, y) => x.i - y.i), a, 'row order survives');
  assert.deepEqual(sampleRows(rows, 5000), rows, 'nothing to do under the limit');
});

// ---------------------------------------------------------------------------
// Is there anything to see?
// ---------------------------------------------------------------------------

test('an even split scores zero and a monopoly scores one', () => {
  assert.equal(mixUnevenness([50, 50]), 0, 'two identical bars are not a finding');
  assert.equal(mixUnevenness([25, 25, 25, 25]), 0);
  assert.equal(mixUnevenness([100, 0]), 1);
  assert.ok(mixUnevenness([80, 15, 5]) > 0.5);
});

test('a mix containing negatives has no share of a whole to report', () => {
  assert.equal(mixUnevenness([100, -40, 20]), 0);
});

test('eta squared separates "regions differ" from "orders differ"', () => {
  // Tight inside each group, far apart between them: the category explains it.
  const explained = [
    { label: 'A', values: [10, 11, 9, 10] },
    { label: 'B', values: [100, 101, 99, 100] },
  ];
  assert.ok(varianceExplained(explained) > 0.95);

  // The same group means, but the values inside each group swamp the gap.
  const noise = [
    { label: 'A', values: [-500, 500, -480, 520] },
    { label: 'B', values: [-400, 600, -420, 620] },
  ];
  assert.ok(varianceExplained(noise) < 0.1, 'the split is not what is moving the measure');
});

test('trend strength needs both a clean fit and a real movement', () => {
  assert.ok(trendStrength([100, 120, 140, 160, 180, 200]) > 0.9, 'straight and large');
  assert.ok(trendStrength([100, 101, 100, 101, 100, 101]) < 0.05, 'straight but going nowhere');
  assert.ok(trendStrength([100, 900, 50, 800, 20, 850]) < 0.2, 'large but not a trend');
  assert.equal(trendStrength([100, 200, 300]), 0, 'three points is not a series');
});

test('a correlation carried by one outlier scores below its Pearson', () => {
  // A blob plus one far-out point: Pearson is high, the ranks disagree.
  const xs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 200];
  const ys = [5, 3, 6, 2, 7, 1, 4, 8, 3, 300];
  const rank = spearman(xs, ys);
  assert.ok(rank !== null);
  assert.ok(relationshipStrength(xs, ys) < 0.7, 'the extreme point is not a relationship');

  // Every point on the line: nothing to discount.
  const clean = Array.from({ length: 24 }, (_, i) => i);
  assert.ok(relationshipStrength(clean, clean.map((v) => v * 3 + 1)) > 0.9);
});

test('a rectangular histogram is a result, not a finding', () => {
  const flat = Array.from({ length: 400 }, (_, i) => i);
  const piled = Array.from({ length: 400 }, (_, i) => (i < 380 ? 1 : 5000));
  assert.ok(distributionShape(flat).signal < distributionShape(piled).signal);
  assert.ok(distributionShape(piled).skew > 1, 'a long upper tail is right-skewed');
});

test("Cramer's V catches one dimension wearing two names", () => {
  const rows = Array.from({ length: 400 }, (_, i) => ({
    state: ['CA', 'TX', 'NY', 'FL'][i % 4],
    // A city belongs to exactly one state: knowing one gives you the other.
    city: ['Los Angeles', 'Houston', 'New York City', 'Miami'][i % 4],
    // Cycles on a co-prime period, so it is independent of the two above.
    channel: ['Online', 'Retail', 'Partner'][i % 3],
  }));
  assert.ok(association(rows, 'state', 'city') > 0.95, 'the same dimension twice');
  assert.ok(association(rows, 'state', 'channel') < 0.3, 'genuinely different cuts');
});

test('a breakdown is scored on how readable it is, not only what it says', () => {
  assert.equal(legibility(1), 0, 'one bar is not a comparison');
  assert.ok(legibility(6) > legibility(2), 'a yes/no split says less than six categories');
  assert.ok(legibility(6) > legibility(30), 'thirty bars is a wall');
});

// ---------------------------------------------------------------------------
// Decisions that depend on the values rather than the columns
// ---------------------------------------------------------------------------

test('bucket count follows the data instead of a fixed four', () => {
  const tight = Array.from({ length: 200 }, (_, i) => 100 + (i % 5));
  const spread = Array.from({ length: 200 }, (_, i) => Math.exp(i / 20));
  assert.ok(bucketCount(tight) >= 4);
  assert.ok(bucketCount(spread) > bucketCount(tight), 'a long tail earns more bands');
  for (const values of [tight, spread]) {
    const n = bucketCount(values);
    assert.ok(n >= 4 && n <= 10, `bands stay readable: ${n}`);
  }
  assert.equal(bucketCount([7, 7, 7, 7, 7, 7, 7, 7, 7]), 4, 'no spread, no bands to add');
});

test('long category names ask for horizontal bars', () => {
  assert.equal(needsHorizontalBars(['N', 'S', 'E', 'W']), false);
  assert.equal(
    needsHorizontalBars(['Wireless Noise Cancelling Headphones', 'Stainless Steel Cookware Set']),
    true
  );
});

test('a part-to-whole chart is refused when the slices are not the whole', () => {
  const covered = [{ value: 50 }, { value: 30 }, { value: 15 }, { value: 5 }];
  assert.equal(suitsPartToWhole(covered, 4), true);

  // Top four of a long tail: showing them as a whole overstates every slice.
  const tail = [
    { value: 10 }, { value: 10 }, { value: 10 }, { value: 10 },
    ...Array.from({ length: 30 }, () => ({ value: 10 })),
  ];
  assert.equal(suitsPartToWhole(tail, 4), false);
  assert.equal(suitsPartToWhole(tail, 34, { maxSlices: 40 }), true, 'a treemap can hold them all');

  assert.equal(suitsPartToWhole([{ value: 5 }, { value: -5 }], 2), false, 'no negative share');
  assert.equal(suitsPartToWhole(covered, 9), false, 'nine slices stop being comparable');
});

test('a correlation preview groups first, the way the query will', () => {
  const rows = [
    { rep: 'a', spend: 10, sales: 100 },
    { rep: 'a', spend: 30, sales: 300 },
    { rep: 'b', spend: 50, sales: 500 },
  ];
  const { xs, ys } = groupMeanPairs(rows, 'rep', 'spend', 'sales');
  assert.deepEqual(xs, [20, 50]);
  assert.deepEqual(ys, [200, 500]);
});
