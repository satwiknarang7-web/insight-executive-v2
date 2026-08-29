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

/* Sorting and date grouping — the three defects these were written for:
   a trend that showed its first ten days, a funnel ordered by size, and no
   way to change the order of anything. */

const dated = {
  columns: ['Order_Date', 'Category', 'Total_Amount'],
  profile: {
    dimensions: ['Order_Date', 'Category'],
    measures: ['Total_Amount'],
    temporal: ['Order_Date'],
    cardinality: { Order_Date: 900 },
  },
  sample: [{ Order_Date: '2025-03-15' }],
  measures: [],
};
const amount = { measure: sum('Total_Amount') };

test('a trend over dates groups by a period instead of listing days', () => {
  const { spec } = buildChartSpec({ type: 'line', dims: { dimension: 'Order_Date' }, vals: amount }, dated);
  assert.match(spec.sql, /SUBSTRING\(\[Order_Date\], 1, 4\) AS \[Year\]/);
  assert.match(spec.sql, /GROUP BY SUBSTRING\(\[Order_Date\], 1, 4\)/);
});

test('a bucketed trend is the whole series, never a top ten', () => {
  for (const bucket of ['auto', 'month', 'year', 'day']) {
    const { spec } = buildChartSpec(
      { type: 'line', dims: { dimension: 'Order_Date' }, vals: amount, bucket },
      dated
    );
    assert.doesNotMatch(spec.sql, /LIMIT/, `${bucket} keeps every period`);
  }
});

test('a chosen period wins over the automatic one', () => {
  const month = buildChartSpec(
    { type: 'area', dims: { dimension: 'Order_Date' }, vals: amount, bucket: 'month' },
    dated
  ).spec;
  assert.match(month.sql, /SUBSTRING\(\[Order_Date\], 1, 7\) AS \[Month\]/);

  const day = buildChartSpec(
    { type: 'area', dims: { dimension: 'Order_Date' }, vals: amount, bucket: 'day' },
    dated
  ).spec;
  assert.match(day.sql, /GROUP BY \[Order_Date\]/);
  assert.doesNotMatch(day.sql, /SUBSTRING/);
});

test('a column that is not a date is never bucketed', () => {
  const { spec } = buildChartSpec(
    { type: 'line', dims: { dimension: 'Category' }, vals: amount, bucket: 'month' },
    dated
  );
  assert.doesNotMatch(spec.sql, /SUBSTRING/);
});

test('a ranking can be ordered four ways', () => {
  const sql = (sort) =>
    buildChartSpec({ type: 'bar', dims: { dimension: 'Category' }, vals: amount, sort }, dated).spec.sql;
  assert.match(sql('value-desc'), /ORDER BY \[Total Amount\] DESC/);
  assert.match(sql('value-asc'), /ORDER BY \[Total Amount\] ASC/);
  assert.match(sql('category-asc'), /ORDER BY \[Category\] ASC/);
  assert.match(sql('category-desc'), /ORDER BY \[Category\] DESC/);
});

test('an unknown sort falls back to largest first rather than breaking the query', () => {
  const { spec } = buildChartSpec(
    { type: 'bar', dims: { dimension: 'Category' }, vals: amount, sort: 'nonsense' },
    dated
  );
  assert.match(spec.sql, /ORDER BY \[Total Amount\] DESC/);
});

test('a sort cannot override an axis that carries its own order', () => {
  const { spec } = buildChartSpec(
    { type: 'line', dims: { dimension: 'Order_Date' }, vals: amount, sort: 'value-desc' },
    dated
  );
  assert.match(spec.sql, /ORDER BY \[Year\] ASC/);
});

test('only the ranked types offer a sort', () => {
  assert.equal(chartRequirement('bar').sortable, true);
  assert.equal(chartRequirement('funnel').sortable, true);
  assert.equal(chartRequirement('line').sortable, false);
  assert.equal(chartRequirement('waterfall').sortable, false);
});

test('the funnel does not claim an order it does not apply', () => {
  const blurb = chartRequirement('funnel').blurb;
  assert.doesNotMatch(blurb, /the way the process runs\./);
  assert.match(blurb, /sort by category/i);
});
