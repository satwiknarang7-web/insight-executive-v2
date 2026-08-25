import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalType, resolveChart } from '../lib/chartResolver.js';
import { buildWaterfall } from '../lib/waterfall.js';

test('the new type names survive canonicalisation', () => {
  const cases = {
    hbar: 'hbar', 'horizontal bar': 'hbar',
    waterfall: 'waterfall', 'Waterfall Chart': 'waterfall',
    funnel: 'funnel', bubble: 'bubble', ribbon: 'ribbon', gauge: 'gauge',
    pie: 'pie', card: 'card', kpi: 'kpi', table: 'table', matrix: 'matrix',
    'multi-row card': 'multicard', 'pivot table': 'matrix',
  };
  for (const [input, expected] of Object.entries(cases)) {
    assert.equal(canonicalType(input), expected, `${input} -> ${expected}`);
  }
});

test('the specific names win over the loose substring rules', () => {
  // 'horizontal bar' contains "bar" and 'bubble chart' does not contain "bar",
  // but 'pie' used to be swallowed by the donut rule. Order is what fixes this.
  assert.equal(canonicalType('horizontal bar'), 'hbar');
  assert.notEqual(canonicalType('pie'), 'donut');
  assert.equal(canonicalType('column'), 'bar', 'a column chart is a vertical bar');
});

test('an unknown type still falls back to bar', () => {
  assert.equal(canonicalType('sunburst'), 'bar');
  assert.equal(canonicalType(''), 'auto');
});

const ranked = [
  { Region: 'West', Revenue: 500 },
  { Region: 'East', Revenue: 300 },
  { Region: 'North', Revenue: 200 },
  { Region: 'South', Revenue: 100 },
];

test('a horizontal bar is kept when the data supports a bar', () => {
  assert.equal(resolveChart(ranked, { type: 'hbar' }).type, 'hbar');
});

test('a bubble without a third measure degrades to scatter, not to bar', () => {
  const twoNumbers = [
    { spend: 10, revenue: 20 }, { spend: 30, revenue: 45 }, { spend: 50, revenue: 61 },
  ];
  assert.equal(resolveChart(twoNumbers, { type: 'bubble' }).type, 'scatter');

  const threeNumbers = twoNumbers.map((r, i) => ({ ...r, units: 5 + i }));
  assert.equal(resolveChart(threeNumbers, { type: 'bubble' }).type, 'bubble');
});

test('a funnel refuses negative values', () => {
  const withNegative = [{ stage: 'A', n: 10 }, { stage: 'B', n: -4 }];
  assert.equal(resolveChart(withNegative, { type: 'funnel' }).type, 'bar');
  assert.equal(resolveChart([{ stage: 'A', n: 10 }, { stage: 'B', n: 4 }], { type: 'funnel' }).type, 'funnel');
});

test('a waterfall needs more than one row', () => {
  assert.equal(resolveChart([{ m: 'Jan', v: 10 }], { type: 'waterfall' }).type, 'bar');
  assert.equal(resolveChart([{ m: 'Jan', v: 10 }, { m: 'Feb', v: 14 }], { type: 'waterfall' }).type, 'waterfall');
});

test('a table renders whatever it is given', () => {
  assert.equal(resolveChart(ranked, { type: 'table' }).type, 'table');
  assert.equal(resolveChart(ranked, { type: 'matrix' }).type, 'matrix');
});

// ---------------------------------------------------------------------------
// Waterfall geometry
// ---------------------------------------------------------------------------

test('a running series is differenced into changes', () => {
  const rows = [{ m: 'Jan', v: 100 }, { m: 'Feb', v: 140 }, { m: 'Mar', v: 120 }];
  const bars = buildWaterfall(rows, 'm', 'v');

  assert.equal(bars.length, 4, 'three steps plus a total');
  assert.equal(bars[0].signed, 100);
  assert.equal(bars[1].signed, 40, 'Feb is +40 on Jan, not 140');
  assert.equal(bars[2].signed, -20, 'Mar is a fall');
  assert.equal(bars[3].kind, 'total');
  assert.equal(bars[3].signed, 120, 'the total equals the last running value');
});

test('a series that already holds changes is not differenced again', () => {
  const rows = [{ m: 'Start', v: 100 }, { m: 'Won', v: 30 }, { m: 'Lost', v: -50 }];
  const bars = buildWaterfall(rows, 'm', 'v');
  assert.equal(bars[1].signed, 30, 'taken as given, not 30-100');
  assert.equal(bars[2].signed, -50);
  assert.equal(bars[3].signed, 80, '100 + 30 - 50');
});

test('every bar floats on a base that leaves no gap', () => {
  const bars = buildWaterfall([{ m: 'a', v: 10 }, { m: 'b', v: 25 }, { m: 'c', v: 5 }], 'm', 'v');
  for (const bar of bars) {
    // The visible bar spans base..base+delta and must cover the actual change.
    assert.ok(bar.delta >= 0, 'a drawn height is never negative');
    const top = bar.base + bar.delta;
    const expected = bar.kind === 'total' ? Math.max(0, bar.signed) : Math.max(bar.cumulative, bar.cumulative - bar.signed);
    assert.ok(Math.abs(top - expected) < 1e-9, `bar top ${top} should reach ${expected}`);
  }
});
