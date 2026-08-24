import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveChart,
  profileColumns,
  canonicalType,
  isAggregatedSql,
  isTemporalValue,
} from '../lib/chartResolver.js';

test('2-row Yes/No distribution requested as scatter → downgraded to donut', () => {
  const rows = [
    { PhoneService: 'Yes', TotalCustomers: 6361 },
    { PhoneService: 'No', TotalCustomers: 682 },
  ];
  const spec = resolveChart(rows, { type: 'scatter', xKey: 'TotalCustomers', yKey: 'PhoneService' });
  assert.equal(spec.type, 'donut');
  assert.equal(spec.xKey, 'PhoneService'); // category on name axis
  assert.equal(spec.yKey, 'TotalCustomers'); // measure on value axis
});

test('fuzzy "distribution" type is treated like scatter and downgraded', () => {
  const rows = [
    { Region: 'North', Total: 100 },
    { Region: 'South', Total: 80 },
    { Region: 'East', Total: 60 },
  ];
  const spec = resolveChart(rows, { type: 'distribution' });
  assert.notEqual(spec.type, 'scatter');
  assert.ok(['donut', 'bar'].includes(spec.type));
});

test('two-measure result with few rows → composed, not scatter', () => {
  const rows = [
    { Region: 'North', AvgRevenue: 1200, AvgTenure: 24 },
    { Region: 'South', AvgRevenue: 900, AvgTenure: 18 },
    { Region: 'East', AvgRevenue: 600, AvgTenure: 12 },
  ];
  const spec = resolveChart(rows, { type: 'auto' });
  assert.equal(spec.type, 'composed');
  assert.equal(spec.secondaryKey, 'AvgTenure');
});

test('high-cardinality two-measure correlation → scatter with numeric axes', () => {
  const rows = Array.from({ length: 20 }, (_, i) => ({
    Region: `R${i}`,
    AvgRevenue: 100 + i,
    AvgTenure: 5 + i,
  }));
  const spec = resolveChart(rows, { type: 'scatter' });
  assert.equal(spec.type, 'scatter');
  assert.equal(typeof rows[0][spec.xKey], 'number');
  assert.equal(typeof rows[0][spec.yKey], 'number');
  assert.notEqual(spec.xKey, spec.yKey);
});

test('temporal x with many rows → area', () => {
  const rows = Array.from({ length: 14 }, (_, i) => ({
    month: `2026-${String(i + 1).padStart(2, '0')}`,
    revenue: 1000 + i * 50,
  }));
  const spec = resolveChart(rows, { type: 'auto' });
  assert.equal(spec.type, 'area');
  assert.equal(spec.xKey, 'month');
  assert.equal(spec.yKey, 'revenue');
});

test('negative values exclude part-to-whole types (treemap → bar)', () => {
  const rows = [
    { source: 'Billing', leakage: -5000 },
    { source: 'Discount', leakage: 100 },
    { source: 'SLA', leakage: -200 },
  ];
  const spec = resolveChart(rows, { type: 'treemap' });
  assert.equal(spec.type, 'bar');
});

test('radar requires 3+ measures and a small row count', () => {
  const ok = resolveChart(
    [
      { region: 'N', a: 1, b: 2, c: 3 },
      { region: 'S', a: 4, b: 5, c: 6 },
      { region: 'E', a: 7, b: 8, c: 9 },
    ],
    { type: 'radar' },
  );
  assert.equal(ok.type, 'radar');

  const tooFew = resolveChart(
    [
      { region: 'N', a: 1, b: 2 },
      { region: 'S', a: 4, b: 5 },
      { region: 'E', a: 4, b: 5 },
    ],
    { type: 'radar' },
  );
  assert.notEqual(tooFew.type, 'radar');
});

test('invalid requested axis keys are repaired against the data', () => {
  const rows = [
    { Category: 'A', Sales: 50 },
    { Category: 'B', Sales: 70 },
  ];
  const spec = resolveChart(rows, { type: 'bar', xKey: 'DoesNotExist', yKey: 'AlsoMissing' });
  assert.equal(spec.xKey, 'Category');
  assert.equal(spec.yKey, 'Sales');
});

test('identifier columns are not chosen as measures', () => {
  const rows = [
    { customer_id: 1001, Region: 'North', Revenue: 500 },
    { customer_id: 1002, Region: 'South', Revenue: 300 },
  ];
  const spec = resolveChart(rows, { type: 'bar' });
  assert.equal(spec.yKey, 'Revenue');
  assert.notEqual(spec.yKey, 'customer_id');
});

test('empty rows resolve to a safe default', () => {
  const spec = resolveChart([], { type: 'scatter' });
  assert.equal(spec.type, 'bar');
  assert.equal(spec.xKey, null);
});

test('profileColumns ignores Projected* simulation columns as measures', () => {
  const rows = [{ Region: 'N', Revenue: 100, 'Projected Revenue': 110 }];
  const p = profileColumns(rows);
  assert.ok(p.measures.includes('Revenue'));
  assert.ok(!p.measures.includes('Projected Revenue'));
});

test('canonicalType maps fuzzy names', () => {
  assert.equal(canonicalType('correlation'), 'scatter');
  assert.equal(canonicalType('dual-axis'), 'composed');
  assert.equal(canonicalType('column'), 'bar');
  assert.equal(canonicalType('proportion'), 'donut');
  assert.equal(canonicalType(undefined), 'auto');
});

test('isAggregatedSql detects aggregation', () => {
  assert.equal(isAggregatedSql('SELECT [Region], SUM([Rev]) FROM SalesData GROUP BY [Region]'), true);
  assert.equal(isAggregatedSql('SELECT COUNT(*) FROM SalesData'), true);
  assert.equal(isAggregatedSql('SELECT [CustomerID], [Revenue] FROM SalesData'), false);
  assert.equal(isAggregatedSql(''), false);
});

test('isTemporalValue recognizes common date formats', () => {
  assert.equal(isTemporalValue('2026-04-01'), true);
  assert.equal(isTemporalValue('Q1'), true);
  assert.equal(isTemporalValue('Jan'), true);
  assert.equal(isTemporalValue('North'), false);
  assert.equal(isTemporalValue(42), false);
});

test('a mostly-numeric column is still a measure', () => {
  // Real exports carry the occasional "unknown". Requiring a perfectly clean
  // column meant one such cell demoted the whole column to a category, so it
  // disappeared from the measure lists and could not be averaged.
  const rows = [];
  for (let i = 0; i < 500; i++) rows.push({ athlete: `a${i}`, height: 170 + (i % 20), weight: 60 + (i % 30) });
  rows[123].height = 'unknown';
  rows[400].height = null;

  const p = profileColumns(rows);
  assert.ok(p.measures.includes('height'), 'one stray value does not unmake a measure');
  assert.ok(p.measures.includes('weight'));
  assert.ok(!p.dimensions.includes('height'), 'and it is not offered as a category either');
});

test('a genuinely mixed column stays a category', () => {
  // Sizes of S/M/L with a few numeric codes are not a measure to average.
  const rows = [];
  for (let i = 0; i < 100; i++) rows.push({ size: ['S', 'M', 'L'][i % 3] });
  for (let i = 0; i < 20; i++) rows.push({ size: 42 });

  const p = profileColumns(rows);
  assert.ok(!p.measures.includes('size'));
  assert.ok(p.dimensions.includes('size'));
});
