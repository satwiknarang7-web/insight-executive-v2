import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  compileMeasure,
  measureByDimensionSql,
  measureSql,
  readMeasureValue,
  formatMeasureValue,
  validateExpression,
  expandReferences,
} from '../lib/measures.js';
import { parseMeasurePhrase, matchColumn } from '../lib/measureLanguage.js';
import { addKpi, updateKpi } from '../lib/storyboardEdits.js';
import { mountTable, unmountTable, runSql } from '../lib/pipeline.js';

// A small orders table, with the column-name awkwardness real exports have:
// an underscore, a space, and an ID column that is numeric but not a measure.
const ROWS = [
  { Order_ID: 1, Region: 'West', Customer: 'Acme', 'Unit Price': 10, Units: 5, Revenue: 50, Cost: 30 },
  { Order_ID: 2, Region: 'West', Customer: 'Acme', 'Unit Price': 20, Units: 2, Revenue: 40, Cost: 25 },
  { Order_ID: 3, Region: 'East', Customer: 'Globex', 'Unit Price': 5, Units: 20, Revenue: 100, Cost: 60 },
  { Order_ID: 4, Region: 'East', Customer: 'Initech', 'Unit Price': 10, Units: 1, Revenue: 10, Cost: 9 },
];

const COLUMNS = Object.keys(ROWS[0]);
const PROFILE = {
  measures: ['Unit Price', 'Units', 'Revenue', 'Cost'],
  dimensions: ['Region', 'Customer'],
};
const CTX = { columns: COLUMNS, profile: PROFILE, measures: [] };

/** Parse a phrase and fail the test with the parser's own reason if it can't. */
function parse(phrase, context = CTX) {
  const result = parseMeasurePhrase(phrase, context);
  assert.ok(result.ok, `could not parse "${phrase}": ${result.error}`);
  return result.measure;
}

/** Run a measure the way the app does and return the single value. */
function evaluate(measure, context = CTX) {
  const { sql, error } = measureSql(measure, context);
  assert.equal(error, null);
  mountTable(ROWS);
  try {
    return readMeasureValue(runSql(sql));
  } finally {
    unmountTable();
  }
}

// ---------------------------------------------------------------------------
// The English parser
// ---------------------------------------------------------------------------

test('an unqualified numeric column means its total', () => {
  const m = parse('total revenue');
  assert.equal(m.expr, 'SUM([Revenue])');
  assert.equal(evaluate(m), 200);
});

test('average, maximum and minimum each pick their aggregate', () => {
  assert.equal(parse('average unit price').expr, 'AVG([Unit Price])');
  assert.equal(parse('highest revenue').expr, 'MAX([Revenue])');
  assert.equal(parse('lowest revenue').expr, 'MIN([Revenue])');
  assert.equal(evaluate(parse('average unit price')), 11.25);
});

test('"number of orders" counts rows without needing a column', () => {
  const m = parse('number of orders');
  assert.equal(m.expr, 'COUNT(*)');
  assert.equal(evaluate(m), 4);
});

test('distinct counts are recognised, including plural column names', () => {
  const m = parse('number of distinct customers');
  assert.equal(m.expr, 'COUNT(DISTINCT [Customer])');
  assert.equal(evaluate(m), 3);
});

test('a difference becomes subtraction of two aggregates', () => {
  const m = parse('revenue minus cost');
  assert.equal(evaluate(m), 76);
});

test('a percentage-of phrase divides, scales and formats as a percent', () => {
  const m = parse('cost as a percentage of revenue');
  assert.equal(m.format, 'percent');
  assert.equal(evaluate(m), 62);
  assert.equal(formatMeasureValue(evaluate(m), m.format), '62.0%');
});

test('reading order beats SQL precedence: "a minus b divided by c" is a margin', () => {
  const m = parse('revenue minus cost divided by revenue');
  // (200 - 124) / 200
  assert.equal(evaluate(m), 0.38);
});

test('"per" is division', () => {
  const m = parse('revenue per units');
  assert.equal(evaluate(m), 200 / 28);
});

test('a where clause becomes a row filter, not part of the aggregate', () => {
  const m = parse('total revenue where region is West');
  assert.equal(m.filter, "[Region] = 'West'");
  assert.equal(evaluate(m), 90);
});

test('filters support comparisons, contains, and and/or', () => {
  assert.equal(parse('total revenue where unit price is at least 10').filter, '[Unit Price] >= 10');
  assert.equal(parse('total revenue where customer contains Acme').filter, "[Customer] LIKE '%Acme%'");
  assert.equal(
    parse('total revenue where region is West and unit price is more than 5').filter,
    "[Region] = 'West' AND [Unit Price] > 5"
  );
  assert.equal(evaluate(parse('total revenue where region is not West')), 110);
});

test('a name can be given up front or at the end', () => {
  assert.equal(parse('Gross Profit = revenue minus cost').name, 'Gross Profit');
  assert.equal(parse('revenue minus cost, call it Gross Profit').name, 'Gross Profit');
});

test('a measure name is not split apart by a word inside it', () => {
  // "Revenue Per Unit" contains "per", which the parser otherwise reads as
  // division — the phrase is about the measure, not about dividing by "unit".
  const existing = [{ id: 'm1', name: 'Revenue Per Unit', expr: 'SUM([Revenue]) / SUM([Units])' }];
  const m = parse('Revenue Per Unit divided by 2, call it Half Rate', { ...CTX, measures: existing });
  assert.equal(m.name, 'Half Rate');
  assert.equal(m.expr, '[Revenue Per Unit] / 2');
  assert.equal(evaluate(m, { ...CTX, measures: [...existing, m] }), (200 / 28) / 2);
});

test('an unnamed measure is titled from what was typed', () => {
  assert.equal(parse('total revenue').name, 'Total Revenue');
});

test('a name already in use gets a suffix instead of overwriting', () => {
  const existing = [{ id: 'a', name: 'Total Revenue', expr: 'SUM([Revenue])' }];
  const m = parse('total revenue', { ...CTX, measures: existing });
  assert.equal(m.name, 'Total Revenue 2');
});

test('conversational preamble is ignored', () => {
  assert.equal(parse('please create a measure for the total revenue').expr, 'SUM([Revenue])');
  assert.equal(parse('I want to see average units').expr, 'AVG([Units])');
});

test('a column that does not exist is an error, never a substitution', () => {
  const result = parseMeasurePhrase('total margin of safety', CTX);
  assert.equal(result.ok, false);
  assert.match(result.error, /could not find a column/i);
});

test('a phrase with words it cannot place is declined, not guessed at', () => {
  // Naming a column is not enough. "What share of revenue comes from Electronics"
  // mentions revenue, but answering it with a plain total would be confidently
  // wrong — the words that carry the actual question went unheard.
  const result = parseMeasurePhrase('what share of revenue comes from the Electronics category', CTX);
  assert.equal(result.ok, false);
  assert.match(result.error, /could not tell what/i);
});

test('filler and question words do not count as unplaced', () => {
  assert.equal(parse('I want to see the average revenue for each of my rows').expr, 'AVG([Revenue])');
});

test('a non-numeric column can only be counted', () => {
  const result = parseMeasurePhrase('average region', CTX);
  assert.equal(result.ok, false);
  assert.match(result.error, /not a numeric column/i);
});

test('column matching prefers the longest name that fits', () => {
  const columns = ['Price', 'Unit Price'];
  assert.equal(matchColumn('average unit price', columns), 'Unit Price');
  assert.equal(matchColumn('average price', columns), 'Price');
});

// ---------------------------------------------------------------------------
// Validation — the part that decides what is allowed to run
// ---------------------------------------------------------------------------

test('a bare column reference is refused, with the fix in the message', () => {
  const v = validateExpression('[Revenue] / SUM([Revenue])', { columns: COLUMNS });
  assert.equal(v.ok, false);
  assert.match(v.error, /needs an aggregate around it/);
});

test('an expression that aggregates nothing is not a measure', () => {
  assert.equal(validateExpression('1 + 1', { columns: COLUMNS }).ok, false);
});

test('nested aggregates are refused', () => {
  assert.equal(validateExpression('SUM(AVG([Revenue]))', { columns: COLUMNS }).ok, false);
});

test('unknown columns are refused', () => {
  const v = validateExpression('SUM([Profit])', { columns: COLUMNS });
  assert.equal(v.ok, false);
  assert.match(v.error, /no column or measure called "Profit"/);
});

test('unbracketed column names get a specific message', () => {
  assert.match(validateExpression('SUM(Revenue)', { columns: COLUMNS }).error, /in brackets/);
});

test('statements, comments and multiple queries are refused', () => {
  for (const attempt of [
    'SUM([Revenue]); DROP TABLE SalesData',
    'SUM([Revenue]) -- comment',
    '(SELECT SUM([Revenue]) FROM SalesData)',
    'SUM([Revenue]) UNION SELECT 1',
  ]) {
    assert.equal(validateExpression(attempt, { columns: COLUMNS }).ok, false, attempt);
  }
});

test('unbalanced brackets are refused', () => {
  assert.equal(validateExpression('SUM([Revenue]', { columns: COLUMNS }).ok, false);
  assert.equal(validateExpression('SUM([Revenue]))', { columns: COLUMNS }).ok, false);
});

test('a filter may not aggregate, and a measure may not be a bare predicate', () => {
  const v = validateExpression('SUM([Revenue]) > 10', { columns: COLUMNS, mode: 'filter' });
  assert.equal(v.ok, false);
  assert.match(v.error, /cannot use SUM/);
  assert.equal(validateExpression("[Region] = 'West'", { columns: COLUMNS, mode: 'filter' }).ok, true);
});

test('case and spacing in a written column name are tolerated', () => {
  assert.equal(validateExpression('SUM([unit price])', { columns: COLUMNS }).ok, true);
});

// ---------------------------------------------------------------------------
// Measures built out of measures
// ---------------------------------------------------------------------------

const PROFIT = { id: 'm1', name: 'Profit', expr: 'SUM([Revenue]) - SUM([Cost])', format: 'currency' };

test('one measure can reference another', () => {
  const margin = { id: 'm2', name: 'Margin', expr: '[Profit] / SUM([Revenue]) * 100', format: 'percent' };
  const compiled = compileMeasure(margin, { columns: COLUMNS, measures: [PROFIT, margin] });
  assert.equal(compiled.ok, true);
  assert.deepEqual(compiled.dependsOn, ['Profit']);
  assert.equal(evaluate(margin, { columns: COLUMNS, measures: [PROFIT, margin] }), 38);
});

test('a referenced measure is parenthesised so precedence cannot change', () => {
  assert.equal(
    expandReferences('[Profit] / SUM([Revenue])', [PROFIT]),
    '(SUM([Revenue]) - SUM([Cost])) / SUM([Revenue])'
  );
});

test('a measure cannot be wrapped in an aggregate', () => {
  const bad = { id: 'm3', name: 'Bad', expr: 'SUM([Profit])' };
  const compiled = compileMeasure(bad, { columns: COLUMNS, measures: [PROFIT, bad] });
  assert.equal(compiled.ok, false);
  assert.match(compiled.error, /already a measure/);
});

test('a reference cycle reports rather than hangs', () => {
  const a = { id: 'a', name: 'A', expr: '[B] + SUM([Units])' };
  const b = { id: 'b', name: 'B', expr: '[A] + SUM([Units])' };
  const compiled = compileMeasure(a, { columns: COLUMNS, measures: [a, b] });
  assert.equal(compiled.ok, false);
  assert.match(compiled.error, /circle|itself/i);
});

test('a measure cannot reference itself', () => {
  const self = { id: 's', name: 'Self', expr: '[Self] + SUM([Units])' };
  assert.equal(compileMeasure(self, { columns: COLUMNS, measures: [self] }).ok, false);
});

// ---------------------------------------------------------------------------
// The queries the app actually runs
// ---------------------------------------------------------------------------

test('breaking a measure out by a dimension groups and orders by it', () => {
  const margin = { id: 'm2', name: 'Margin %', expr: '[Profit] / SUM([Revenue]) * 100', format: 'percent' };
  const built = measureByDimensionSql(
    margin,
    { dimension: 'Region', limit: 5 },
    { columns: COLUMNS, measures: [PROFIT, margin] }
  );
  assert.equal(built.error, null);
  assert.equal(built.xAxisKey, 'Region');
  assert.equal(built.yAxisKey, 'Margin %');

  mountTable(ROWS);
  try {
    const rows = runSql(built.sql);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].Region, 'West'); // (90-55)/90 beats (110-69)/110
    assert.equal(Math.round(rows[0]['Margin %']), 39);
  } finally {
    unmountTable();
  }
});

test('a measure filter narrows the rows a grouped query then splits', () => {
  const m = parse('total revenue where unit price is at least 10');
  const built = measureByDimensionSql(m, { dimension: 'Region' }, CTX);
  mountTable(ROWS);
  try {
    const rows = runSql(built.sql);
    const west = rows.find((r) => r.Region === 'West');
    assert.equal(west[m.name], 90);
    assert.equal(rows.find((r) => r.Region === 'East')[m.name], 10);
  } finally {
    unmountTable();
  }
});

test('an invalid measure produces no SQL at all', () => {
  const { sql, error } = measureSql({ name: 'Bad', expr: 'SUM([Nope])' }, CTX);
  assert.equal(sql, null);
  assert.ok(error);
});

test('a value that is not finite is reported as no value', () => {
  assert.equal(readMeasureValue([{ Value: Infinity }]), null);
  assert.equal(readMeasureValue([{ Value: NaN }]), null);
  assert.equal(readMeasureValue([]), null);
  assert.equal(formatMeasureValue(null), '—');
});

test('formats render the way the card will show them', () => {
  assert.equal(formatMeasureValue(1234567, 'currency'), '$1.2M');
  assert.equal(formatMeasureValue(38.25, 'percent'), '38.3%');
  assert.equal(formatMeasureValue(4200, 'number'), '4.2K');
});

// ---------------------------------------------------------------------------
// Pinning a measure to the KPI strip
// ---------------------------------------------------------------------------

test('a pinned card remembers the measure that computed it', () => {
  const [card] = addKpi([], {
    label: 'Margin',
    value: '38.0%',
    source: { measureId: 'm1' },
    autoLabel: true,
  });
  assert.equal(card.source.measureId, 'm1');
  assert.equal(card.custom, true);
});

test("a pinned card's generated label follows the measure it is pointed at", () => {
  const pinned = addKpi([], { label: 'Margin', value: '38.0%', source: { measureId: 'm1' }, autoLabel: true });
  const repointed = updateKpi(pinned, 0, { label: 'Half Rate', value: '19.0%', source: { measureId: 'm2' }, autoLabel: true });
  assert.equal(repointed[0].label, 'Half Rate');
  assert.equal(repointed[0].source.measureId, 'm2');
});

test('a label somebody typed is not renamed by a later measure', () => {
  const pinned = addKpi([], { label: 'Margin', value: '38.0%', source: { measureId: 'm1' } });
  assert.equal(pinned[0].autoLabel, undefined);
});
