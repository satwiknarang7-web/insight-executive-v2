import test from 'node:test';
import assert from 'node:assert/strict';
import { planQuestion, readAggregate, readChartType } from '../lib/questionPlanner.js';

/* Reading a question into a chart, with no language model.

   The bug these are written for: the offline path picked the storyboard
   candidate that shared the most words with the question, so it could only ever
   answer with a bar chart, and one incidental word counted as a match. */

const context = {
  columns: ['Category', 'Gender', 'Region', 'Order_Date', 'Total_Amount', 'Quantity', 'Age'],
  profile: {
    dimensions: ['Category', 'Gender', 'Region', 'Order_Date'],
    measures: ['Total_Amount', 'Quantity', 'Age'],
    temporal: ['Order_Date'],
    cardinality: { Category: 7, Gender: 2, Region: 4, Order_Date: 900 },
  },
  sample: [{ Order_Date: '2025-01-02' }],
  measures: [],
};

const plan = (q) => planQuestion(q, context);

test('the shape that was asked for is the shape that is built', () => {
  const cases = {
    'total amount by category as a treemap': 'treemap',
    'total amount by category as a donut': 'donut',
    'total amount by category as a pie chart': 'pie',
    'quantity by category as a funnel': 'funnel',
    'total amount by region on a map': 'filledmap',
    'total amount by category, horizontal bar': 'hbar',
    'total amount by category as a table': 'table',
    'total amount by category as a waterfall': 'waterfall',
  };
  for (const [question, type] of Object.entries(cases)) {
    const { spec, error } = plan(question);
    assert.equal(error, null, `${question} → ${error}`);
    assert.equal(spec.chart_type, type, question);
  }
});

test('a longer shape word wins over a shorter one inside it', () => {
  // "treemap" contains "map", "bubble map" contains "bubble".
  assert.equal(readChartType('as a treemap'), 'treemap');
  assert.equal(readChartType('on a bubble map'), 'bubblemap');
  assert.equal(readChartType('on a map'), 'filledmap');
});

test('a matrix names its own rows and columns', () => {
  const { spec, error } = plan('make a matrix of average total amount, with row: Category and column: Gender');
  assert.equal(error, null);
  assert.equal(spec.chart_type, 'matrix');
  assert.match(spec.sql, /\[Category\], \[Gender\]/);
  assert.match(spec.sql, /AVG\(\[Total_Amount\]\)/);
});

test('the question this was written for is declined, not answered with something else', () => {
  // There is no tenure column. The old path answered it with average spend by
  // category, on the strength of the word "category".
  const { spec, error } = plan('make a matrix of average monthly tenure, with row: category and column: Gender');
  assert.equal(spec, null);
  assert.match(error, /No column here matches what you asked to measure/);
  assert.match(error, /Total_Amount/, 'and it says what there is instead');
});

test('a column is not matched on a fragment of a word', () => {
  // "Age" sits inside "aver-age-". That is not a match.
  assert.equal(plan('average monthly tenure by category').spec, null);
  // Named properly, it is.
  const { spec } = plan('average age by category');
  assert.match(spec.sql, /AVG\(\[Age\]\)/);
});

test('ranking words choose an end of the list, not an aggregate', () => {
  const low = plan('lowest total amount by category');
  assert.match(low.spec.sql, /SUM\(\[Total_Amount\]\)/, 'still a total');
  assert.match(low.spec.sql, /ORDER BY \[Total Amount\] ASC/, 'read from the bottom');

  const high = plan('highest total amount by category');
  assert.match(high.spec.sql, /SUM\(\[Total_Amount\]\)/);
  assert.match(high.spec.sql, /ORDER BY \[Total Amount\] DESC/);

  // "maximum" really is an aggregate.
  assert.equal(readAggregate('maximum total amount'), 'MAX');
  assert.equal(readAggregate('average order value'), 'AVG');
  assert.equal(readAggregate('how many orders'), 'COUNT');
});

test('a grouping named without a "by" is still found', () => {
  const { spec, error } = plan('which region has the highest average total amount');
  assert.equal(error, null);
  assert.match(spec.sql, /GROUP BY \[Region\]/);
  assert.match(spec.sql, /AVG\(\[Total_Amount\]\)/);
});

test('a legend splits the bars rather than making a cross-tab', () => {
  const { spec } = plan('total amount by category split by gender');
  assert.equal(spec.chart_type, 'bar');
  assert.equal(spec.seriesKey, 'Gender');
});

test('a date axis is grouped into the period that was asked for', () => {
  assert.match(plan('total amount over time by month').spec.sql, /SUBSTRING\(\[Order_Date\], 1, 7\)/);
  assert.match(plan('monthly total amount trend').spec.sql, /SUBSTRING\(\[Order_Date\], 1, 7\)/);
  assert.match(plan('total amount over time').spec.sql, /SUBSTRING\(\[Order_Date\], 1, 4\)/);
});

test('a trend with no date named uses the one date column there is', () => {
  const { spec, error } = plan('total amount trend');
  assert.equal(error, null);
  assert.match(spec.sql, /Order_Date/);
});

test('counting needs no column', () => {
  const { spec } = plan('how many orders per region');
  assert.match(spec.sql, /COUNT\(\*\)/);
  assert.match(spec.sql, /GROUP BY \[Region\]/);
});

test('one number, with nothing to group by, is a card', () => {
  const { spec } = plan('what is the total amount');
  assert.equal(spec.chart_type, 'card');
  assert.doesNotMatch(spec.sql, /GROUP BY/);
});

test('a saved measure is preferred over a column that shares its words', () => {
  const withMeasure = {
    ...context,
    measures: [{ id: 'm1', name: 'Average Order Value', expr: 'SUM([Total_Amount]) / COUNT(*)', format: 'currency' }],
  };
  const { spec, error } = planQuestion('Average Order Value by category', withMeasure);
  assert.equal(error, null);
  assert.match(spec.sql, /SUM\(\[Total_Amount\]\) \/ COUNT\(\*\)/);
});

test('what it cannot do, it says rather than approximating', () => {
  assert.match(plan('median total amount by category').error, /Medians are not available/);
  assert.equal(plan('total amount by category').error, null, 'the ordinary case still works');
  assert.equal(plan('').error, 'Ask a question first.');

  // A shape needing two different measures cannot come from a question naming
  // one, and saying so beats plotting a number against itself.
  assert.match(plan('total amount by category as a bubble').error, /different measures/);
});

test('a shape that needs a grouping the question never named is refused', () => {
  const { spec, error } = plan('relationship between quantity and age');
  assert.equal(spec, null);
  assert.match(error, /needs/);
});
