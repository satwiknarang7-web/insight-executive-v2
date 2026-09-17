import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DATES,
  RANGE,
  VALUES,
  applyClick,
  clearColumn,
  clickTarget,
  describeFilter,
  describeFilters,
  filterFromClick,
  filterSql,
  filterWhere,
  isSelected,
  toggleValue,
  validFilters,
  validateFilter,
} from '../lib/filters.js';

/* A dashboard filter, as a query.

   The rule these are written for: a filter is a narrower table, not a display
   mode — the sentence under a chart is a reading of the result set, so it has
   to be recomputed, and that only works if the filter is something the engine
   can run. */

const columns = ['region', 'contract_type', 'monthly_charge', 'order_date'];

test('a filter is only accepted over a column that exists', () => {
  assert.equal(validateFilter({ kind: VALUES, column: 'nope', values: ['x'] }, columns).ok, false);
  assert.match(validateFilter({ kind: VALUES, column: 'nope', values: ['x'] }, columns).error, /nope/);
  assert.equal(validateFilter({ kind: 'sideways', column: 'region' }, columns).ok, false);
  assert.equal(validateFilter({ kind: VALUES, column: 'region', values: [] }, columns).ok, false);
  assert.equal(validateFilter({ kind: RANGE, column: 'monthly_charge' }, columns).ok, false, 'a range needs an end');
  assert.equal(validateFilter({ kind: RANGE, column: 'monthly_charge', min: 90, max: 10 }, columns).ok, false);
  assert.equal(validateFilter({ kind: DATES, column: 'order_date', from: '2025-06-01', to: '2025-01-01' }, columns).ok, false);

  const ok = validateFilter({ kind: VALUES, column: 'region', values: ['North', 'North', 'South'] }, columns);
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.filter.values, ['North', 'South'], 'the same value twice is one value');
});

test('the clause is a value in a list, a range, or a span of days', () => {
  assert.equal(
    filterWhere([{ kind: VALUES, column: 'region', values: ['North', 'South'] }]),
    "([region] IN ('North', 'South'))"
  );
  assert.equal(
    filterWhere([{ kind: RANGE, column: 'monthly_charge', min: 10, max: 90 }]),
    '([monthly_charge] >= 10 AND [monthly_charge] <= 90)'
  );
  assert.equal(
    filterWhere([{ kind: RANGE, column: 'monthly_charge', min: null, max: 90 }]),
    '([monthly_charge] <= 90)'
  );
  // Compared on the first ten characters, so a timestamp column behaves like a
  // date one rather than falling outside its own last day.
  assert.match(
    filterWhere([{ kind: DATES, column: 'order_date', from: '2025-01-01', to: '2025-03-31' }]),
    /SUBSTRING\(\[order_date\], 1, 10\) >= '2025-01-01' AND SUBSTRING\(\[order_date\], 1, 10\) <= '2025-03-31'/
  );
  assert.equal(filterWhere([]), '');
});

test('two filters narrow each other, and the values inside one do not', () => {
  const where = filterWhere([
    { kind: VALUES, column: 'region', values: ['North', 'South'] },
    { kind: RANGE, column: 'monthly_charge', min: 50, max: 90 },
  ]);
  assert.match(where, /IN \('North', 'South'\)/, 'two regions are both kept');
  assert.equal(where.split(' AND ').length, 3, 'one AND between the filters, one inside the range');
});

test('a value carrying a quote cannot end the string it is in', () => {
  const where = filterWhere([{ kind: VALUES, column: 'region', values: ["O'Brien's"] }]);
  assert.equal(where, "([region] IN ('O''Brien''s'))");
  assert.equal((where.match(/'/g) || []).length % 2, 0, 'the quotes still balance');
});

test('the filter is a query that can be shown', () => {
  const sql = filterSql([{ kind: VALUES, column: 'region', values: ['North'] }]);
  assert.match(sql, /^SELECT \* FROM SalesData WHERE /);
  assert.equal(filterSql([]), '', 'no filter, no query');
});

test('a chip says what it is in words', () => {
  assert.equal(describeFilter({ kind: VALUES, column: 'region', values: ['North'] }, 'Region'), 'Region is North');
  assert.equal(
    describeFilter({ kind: VALUES, column: 'region', values: ['North', 'South'] }, 'Region'),
    'Region is North or South'
  );
  assert.equal(
    describeFilter({ kind: VALUES, column: 'region', values: ['a', 'b', 'c'] }, 'Region'),
    'Region is any of 3',
    'three values is a count, not a paragraph'
  );
  assert.equal(describeFilter({ kind: RANGE, column: 'x', min: 10, max: null }, 'Charge'), 'Charge at least 10');
  assert.equal(describeFilter({ kind: DATES, column: 'd', from: null, to: '2025-06-30' }, 'Date'), 'Date up to 2025-06-30');
  assert.match(
    describeFilters([
      { kind: VALUES, column: 'region', values: ['North'] },
      { kind: RANGE, column: 'monthly_charge', min: 50, max: null },
    ]),
    /region is North, monthly_charge at least 50/
  );
});

test('clicking the value that is the filter clears it', () => {
  const once = toggleValue([], 'region', 'North');
  assert.deepEqual(once, [{ kind: VALUES, column: 'region', values: ['North'] }]);
  assert.deepEqual(toggleValue(once, 'region', 'North'), [], 'the same click again undoes it');
  // A different bar on the same chart is a change of mind, not a union.
  assert.deepEqual(toggleValue(once, 'region', 'South'), [{ kind: VALUES, column: 'region', values: ['South'] }]);
  assert.equal(toggleValue(once, 'contract_type', 'One year').length, 2, 'another column is another filter');
  assert.equal(isSelected(once, 'region', 'North'), true);
  assert.equal(isSelected(once, 'region', 'South'), false);
  assert.deepEqual(clearColumn(once, 'region'), []);
});

test('only a chart that can name its column is clickable', () => {
  const context = { columns, temporal: ['order_date'] };
  assert.deepEqual(
    clickTarget({ dimension: 'region', xAxisKey: 'region' }, context),
    { column: 'region', kind: VALUES }
  );
  assert.deepEqual(
    clickTarget({ dimension: 'order_date', xAxisKey: 'Month' }, context),
    { column: 'order_date', kind: DATES },
    'a date bucketed inside the query still names its column'
  );
  // The ones that cannot say.
  assert.equal(clickTarget({ dimension: 'region', xAxisKey: 'Band' }, context), null, 'an alias over a category');
  assert.equal(clickTarget({ dimension: 'gone', xAxisKey: 'gone' }, context), null, 'a column that is not there');
  assert.equal(clickTarget({ xAxisKey: 'region' }, context), null, 'no dimension at all');
  assert.equal(
    clickTarget({ dimension: 'region', xAxisKey: 'region', seriesKey: 'channel' }, context),
    null,
    'a split bar is a category and a series at once'
  );
});

test('a click on a bucketed date is the span that bucket covers', () => {
  const target = { column: 'order_date', kind: DATES };
  assert.deepEqual(filterFromClick(target, '2025-02'), {
    kind: DATES,
    column: 'order_date',
    from: '2025-02-01',
    to: '2025-02-28',
  });
  // Februaries are not all the same length.
  assert.equal(filterFromClick(target, '2024-02').to, '2024-02-29');
  assert.deepEqual(filterFromClick(target, '2025'), {
    kind: DATES,
    column: 'order_date',
    from: '2025-01-01',
    to: '2025-12-31',
  });
  assert.equal(filterFromClick(target, 'Q1'), null, 'a bucket this cannot read is not guessed at');

  const list = applyClick([], target, '2025-02');
  assert.equal(list.length, 1);
  assert.deepEqual(applyClick(list, target, '2025-02'), [], 'the same month again clears it');
  assert.equal(applyClick(list, target, '2025-03')[0].from, '2025-03-01', 'a different month replaces it');
});

test('only the filters that check out survive', () => {
  const list = validFilters(
    [
      { kind: VALUES, column: 'region', values: ['North'] },
      { kind: VALUES, column: 'ghost', values: ['x'] },
      { kind: RANGE, column: 'monthly_charge', min: 'ten' },
    ],
    columns
  );
  assert.equal(list.length, 1);
  assert.equal(list[0].column, 'region');
});
