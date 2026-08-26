import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHART_TYPES,
  buildChartSpec,
  chartArity,
  chartRequirement,
  looksGeographic,
} from '../lib/chartSpecs.js';
import { resolveChart, usesSecondDimension } from '../lib/chartResolver.js';

const columns = ['Region', 'Category', 'Month', 'Revenue', 'Units'];
const context = { columns, measures: [] };

const sum = (column) => ({ aggregate: 'SUM', column, measureId: null });

test('every offered type declares what it needs', () => {
  for (const type of CHART_TYPES) {
    const req = chartRequirement(type);
    assert.ok(req.label, `${type} has a label`);
    assert.ok(req.blurb, `${type} explains itself`);
    assert.ok(req.measures.length >= 1, `${type} measures something`);
    for (const slot of [...req.dimensions, ...req.measures]) {
      assert.ok(slot.key && slot.label, `${type} slot is named`);
    }
  }
});

test('a matrix asks for two categories, a bar for one', () => {
  assert.deepEqual(chartArity('matrix'), { dimensions: 2, measures: 1 });
  assert.deepEqual(chartArity('ribbon'), { dimensions: 2, measures: 1 });
  assert.deepEqual(chartArity('bar'), { dimensions: 1, measures: 1 });
  assert.deepEqual(chartArity('bubble'), { dimensions: 1, measures: 3 });
  assert.deepEqual(chartArity('card'), { dimensions: 0, measures: 1 });
});

test('a bar groups by one column and orders by the measure', () => {
  const { spec, error } = buildChartSpec(
    { type: 'bar', dims: { dimension: 'Region' }, vals: { measure: sum('Revenue') }, limit: 10 },
    context
  );
  assert.equal(error, null);
  assert.equal(
    spec.sql,
    'SELECT [Region], SUM([Revenue]) AS [Total Revenue] FROM SalesData GROUP BY [Region] ORDER BY [Total Revenue] DESC LIMIT 10'
  );
  assert.equal(spec.xAxisKey, 'Region');
  assert.equal(spec.yAxisKey, 'Total Revenue');
  assert.equal(spec.title, 'Total Revenue by Region');
});

test('a matrix groups by both categories and keeps the second as its columns', () => {
  const { spec, error } = buildChartSpec(
    {
      type: 'matrix',
      dims: { dimension: 'Region', dimension2: 'Category' },
      vals: { measure: sum('Revenue') },
      limit: 50,
    },
    context
  );
  assert.equal(error, null);
  assert.match(spec.sql, /GROUP BY \[Region\], \[Category\]/);
  assert.equal(spec.xAxisKey, 'Region');
  assert.equal(spec.secondaryYAxisKey, 'Category', 'the column axis is where the renderer looks');
  assert.equal(spec.title, 'Total Revenue by Region and Category');
});

test('the same column cannot be both axes of a cross-tab', () => {
  const { spec, error } = buildChartSpec(
    {
      type: 'matrix',
      dims: { dimension: 'Region', dimension2: 'Region' },
      vals: { measure: sum('Revenue') },
    },
    context
  );
  assert.equal(spec, null);
  assert.match(error, /two different columns/);
});

test('a missing choice explains itself rather than emitting broken SQL', () => {
  const noDimension = buildChartSpec({ type: 'bar', dims: {}, vals: { measure: sum('Revenue') } }, context);
  assert.equal(noDimension.spec, null);
  assert.match(noDimension.error, /group by/i);

  const noColumn = buildChartSpec(
    { type: 'bar', dims: { dimension: 'Region' }, vals: { measure: { aggregate: 'SUM', column: '' } } },
    context
  );
  assert.equal(noColumn.spec, null);
  assert.match(noColumn.error, /column/i);
});

test('a bubble carries three measures and puts the third on the size axis', () => {
  const { spec, error } = buildChartSpec(
    {
      type: 'bubble',
      dims: { dimension: 'Region' },
      vals: { measure: sum('Revenue'), measure2: sum('Units'), measure3: { aggregate: 'COUNT' } },
      limit: 50,
    },
    context
  );
  assert.equal(error, null);
  assert.equal(spec.xAxisKey, 'Total Revenue');
  assert.equal(spec.yAxisKey, 'Total Units');
  assert.equal(spec.secondaryYAxisKey, 'Record Count', 'a count says what it counted');

  // And the resolver agrees it is a bubble rather than demoting it to a scatter.
  const rows = [
    { Region: 'West', 'Total Revenue': 10, 'Total Units': 4, 'Record Count': 3 },
    { Region: 'East', 'Total Revenue': 20, 'Total Units': 9, 'Record Count': 5 },
    { Region: 'North', 'Total Revenue': 30, 'Total Units': 14, 'Record Count': 8 },
  ];
  assert.equal(
    resolveChart(rows, { type: spec.chart_type, xKey: spec.xAxisKey, yKey: spec.yAxisKey }).type,
    'bubble'
  );
});

test('two measures that name themselves the same way still get two columns', () => {
  const { spec } = buildChartSpec(
    {
      type: 'composed',
      dims: { dimension: 'Region' },
      vals: { measure: sum('Revenue'), measure2: sum('Revenue') },
      limit: 10,
    },
    context
  );
  assert.match(spec.sql, /AS \[Total Revenue\]/);
  assert.match(spec.sql, /AS \[Total Revenue \(2\)\]/);
  assert.equal(spec.secondaryYAxisKey, 'Total Revenue (2)');
});

test('an ordered axis is sorted by the axis, not by the measure', () => {
  const line = buildChartSpec(
    { type: 'line', dims: { dimension: 'Month' }, vals: { measure: sum('Revenue') }, limit: 15 },
    context
  ).spec;
  assert.match(line.sql, /ORDER BY \[Month\] ASC/, 'the top 15 months by size is not a trend');

  const bar = buildChartSpec(
    { type: 'bar', dims: { dimension: 'Month' }, vals: { measure: sum('Revenue') }, limit: 15 },
    context
  ).spec;
  assert.match(bar.sql, /ORDER BY \[Total Revenue\] DESC/);
});

test('a card asks for nothing to group by and emits no GROUP BY or LIMIT', () => {
  const { spec, error } = buildChartSpec({ type: 'card', dims: {}, vals: { measure: sum('Revenue') } }, context);
  assert.equal(error, null);
  assert.equal(spec.sql, 'SELECT SUM([Revenue]) AS [Total Revenue] FROM SalesData');
  assert.equal(spec.title, 'Total Revenue');
  assert.equal(spec.xAxisKey, 'Total Revenue');
});

test('a saved measure can stand in for an aggregate, and brings its filter', () => {
  const measures = [{ id: 'm1', name: 'West Revenue', expr: 'SUM([Revenue])', filter: `[Region] = 'West'` }];
  const { spec, error } = buildChartSpec(
    { type: 'bar', dims: { dimension: 'Category' }, vals: { measure: { measureId: 'm1' } }, limit: 10 },
    { columns, measures }
  );
  assert.equal(error, null);
  assert.match(spec.sql, /WHERE /);
  assert.match(spec.sql, /AS \[West Revenue\]/);
  assert.ok(spec.sql.indexOf('WHERE') < spec.sql.indexOf('GROUP BY'), 'the filter narrows before the split');
});

test('two measures filtered differently are refused rather than half-applied', () => {
  const measures = [
    { id: 'm1', name: 'West Revenue', expr: 'SUM([Revenue])', filter: `[Region] = 'West'` },
    { id: 'm2', name: 'East Revenue', expr: 'SUM([Revenue])', filter: `[Region] = 'East'` },
  ];
  const { spec, error } = buildChartSpec(
    {
      type: 'composed',
      dims: { dimension: 'Category' },
      vals: { measure: { measureId: 'm1' }, measure2: { measureId: 'm2' } },
      limit: 10,
    },
    { columns, measures }
  );
  assert.equal(spec, null);
  assert.match(error, /filter the rows differently/);
});

test('only the two-category types keep their second string column', () => {
  assert.equal(usesSecondDimension('matrix'), true);
  assert.equal(usesSecondDimension('ribbon'), true);
  assert.equal(usesSecondDimension('bar'), false);
  assert.equal(usesSecondDimension('donut'), false);
});

test('a map prefers a column that names places', () => {
  assert.equal(looksGeographic('Country'), true);
  assert.equal(looksGeographic('ship_to_region'), true);
  assert.equal(looksGeographic('Product'), false);
  assert.equal(chartRequirement('filledmap').dimensions[0].prefer, 'geo');
});

test('the retired ArcGIS type is not offered any more', () => {
  assert.ok(!CHART_TYPES.includes('arcgis'));
});
