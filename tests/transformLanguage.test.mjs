/**
 * Sentences that become steps, with no model in the loop.
 *
 * The parser is deliberately narrow: it handles what people type into the
 * shaping box and refuses the rest with a reason, so a phrase it cannot read
 * reaches the model rather than becoming the wrong step. Every accepted phrase
 * here is also validated against the column list before it is offered back.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { exampleTransformPhrases, parseTransformPhrase } from '../lib/transformLanguage.js';

const COLUMNS = ['Order_ID', 'Order Date', 'Region', 'City', 'First Name', 'Last Name', 'Revenue', 'Units', 'Status', 'Age'];
const parse = (phrase) => parseTransformPhrase(phrase, { columns: COLUMNS });
const one = (phrase) => {
  const r = parse(phrase);
  assert.equal(r.ok, true, `${phrase}: ${r.error}`);
  assert.equal(r.steps.length, 1);
  return r.steps[0];
};

test('rename', () => {
  assert.deepEqual(one('rename Revenue to Net sales'), { kind: 'rename', column: 'Revenue', to: 'Net sales', text: 'rename Revenue to Net sales' });
  assert.equal(one('rename the region column to Territory').to, 'Territory');
});

test('drop one column, or several', () => {
  assert.equal(one('drop the Order ID column').column, 'Order_ID');
  const many = parse('remove Order ID, Status and Age');
  assert.equal(many.ok, true);
  assert.deepEqual(many.steps.map((s) => s.column), ['Order_ID', 'Status', 'Age']);
});

test('keep only', () => {
  assert.deepEqual(one('keep only Region, Revenue and Units').columns, ['Region', 'Revenue', 'Units']);
});

test('a formula written as a formula becomes a derived column', () => {
  const step = one('add Per unit = [Revenue] / [Units]');
  assert.equal(step.kind, 'derive');
  assert.equal(step.name, 'Per unit');
  assert.equal(step.expr, '[Revenue] / [Units]');
  // Prose is not a formula — that is the model's job.
  const prose = parse('add a column called margin equal to revenue minus cost');
  assert.equal(prose.ok, false);
  assert.match(prose.error, /brackets/);
});

test('keep and remove rows read the measure grammar for conditions', () => {
  const keep = one('keep rows where Region is West and Units > 0');
  assert.equal(keep.kind, 'filter');
  assert.equal(keep.mode, 'keep');
  assert.equal(keep.expr, "[Region] = 'West' AND [Units] > 0");
  const remove = one('remove rows where Status is Cancelled');
  assert.equal(remove.mode, 'remove');
  assert.equal(remove.expr, "[Status] = 'Cancelled'");
  assert.equal(one('only keep rows where Age is at least 18').expr, '[Age] >= 18');
});

test('blank has its own reading, because a measure filter never needs one', () => {
  assert.equal(one('keep rows where Region is not blank').expr, 'NOT IS_BLANK([Region])');
  assert.equal(one('keep rows where City is empty').expr, 'IS_BLANK([City])');
  // Removing the blank rows of a column is the blanks step, which says so.
  assert.deepEqual(one('remove rows where Revenue is blank'), {
    kind: 'blanks',
    columns: ['Revenue'],
    text: 'remove rows where Revenue is blank',
  });
  assert.deepEqual(one('remove blank rows').columns, []);
});

test('date parts', () => {
  const month = one('extract the month from Order Date');
  assert.equal(month.kind, 'datepart');
  assert.equal(month.part, 'month');
  assert.equal(month.column, 'Order Date');
  assert.equal(month.name, 'Order Date Month');
  assert.equal(one('add the year and month of order date as Month').part, 'year_month');
  assert.equal(one('get the day of the week from order date').part, 'weekday');
  assert.equal(one('extract quarter from order date').part, 'quarter');
  assert.match(parse('extract the century from order date').error, /not a part of a date/);
});

test('split, on a named or a quoted separator', () => {
  const step = one('split City on the comma into Town and State');
  assert.deepEqual(step, { kind: 'split', column: 'City', separator: ',', into: ['Town', 'State'], text: 'split City on the comma into Town and State' });
  assert.equal(one('split City by "-" into A, B').separator, '-');
  assert.match(parse('split City on the comma into Town').error, /at least two/);
});

test('combine', () => {
  const step = one('combine First Name and Last Name into Full name with a space');
  assert.equal(step.kind, 'merge');
  assert.deepEqual(step.columns, ['First Name', 'Last Name']);
  assert.equal(step.separator, ' ');
  assert.equal(one('merge Region and City into Place with " / "').separator, ' / ');
});

test('text tidying', () => {
  assert.deepEqual(one('trim the spaces in City'), { kind: 'text', column: 'City', op: 'trim', text: 'trim the spaces in City' });
  assert.equal(one('uppercase Region').op, 'upper');
  assert.equal(one('proper case First Name').op, 'proper');
  assert.equal(one('make Status lowercase').op, 'lower');
});

test('replace and fill', () => {
  const whole = one('replace "N/A" with blank in Region');
  assert.deepEqual(whole, { kind: 'replace', column: 'Region', find: 'N/A', replacement: '', mode: 'value', text: 'replace "N/A" with blank in Region' });
  assert.equal(one('replace "Inc." with "Inc" inside City').mode, 'text');
  assert.deepEqual(one('fill blanks in Units with 0'), { kind: 'fill', column: 'Units', value: '0', text: 'fill blanks in Units with 0' });
});

test('duplicates, sorting and top N', () => {
  assert.deepEqual(one('remove duplicate rows').columns, []);
  assert.deepEqual(one('remove duplicates by Order ID').columns, ['Order_ID']);
  assert.deepEqual(one('sort by Revenue descending, Region').by, [
    { column: 'Revenue', direction: 'desc' },
    { column: 'Region', direction: 'asc' },
  ]);
  assert.deepEqual(one('keep the top 100 rows by Revenue'), { kind: 'limit', count: 100, by: 'Revenue', direction: 'desc', text: 'keep the top 100 rows by Revenue' });
  assert.equal(one('keep the lowest 5 by Age').direction, 'asc');
  assert.equal(one('keep the first 10 rows').by, undefined);
});

test('types and bands', () => {
  assert.deepEqual(one('read Units as a number'), { kind: 'retype', column: 'Units', to: 'number', text: 'read Units as a number' });
  assert.equal(one('convert Order Date to a date').to, 'date');
  assert.equal(one('treat Order ID as text').to, 'text');
  const band = one('band Age at 18, 30, 50, 65 as Age band');
  assert.deepEqual(band.edges, [18, 30, 50, 65]);
  assert.equal(band.name, 'Age band');
  assert.equal(one('bucket Revenue at 100 500').name, 'Revenue Band');
});

test('group by, with the aggregates named for people', () => {
  const step = one('group by Region: total Revenue, average Units, number of orders, distinct City');
  assert.equal(step.kind, 'group');
  assert.deepEqual(step.by, ['Region']);
  assert.deepEqual(step.aggregates, [
    { fn: 'SUM', column: 'Revenue', name: 'Total Revenue' },
    { fn: 'AVG', column: 'Units', name: 'Average Units' },
    { fn: 'COUNT', name: 'Number Of Orders' },
    { fn: 'COUNT_DISTINCT', column: 'City', name: 'Distinct City' },
  ]);
  assert.equal(one('summarise by Region and Status with total revenue').by.length, 2);
});

test('a row number', () => {
  assert.equal(one('add a row number').name, 'Row');
  assert.equal(one('add an index column called Seq').name, 'Seq');
});

test('a column that is not there is an error, never a guess', () => {
  const r = parse('rename Profit to Margin');
  assert.equal(r.ok, false);
  assert.match(r.error, /Profit/);
  const s = parse('split Nothing on the comma into A and B');
  assert.equal(s.ok, false);
});

test('an accepted step also passed validation against the columns', () => {
  // "Region" already exists, so a split into it is refused by the validator
  // even though the phrase parsed.
  const r = parse('split City on the comma into Region and State');
  assert.equal(r.ok, false);
  assert.match(r.error, /already a column/);
});

test('nonsense is declined with a hint, not turned into something', () => {
  const r = parse('make it better');
  assert.equal(r.ok, false);
  assert.match(r.error, /could not read/);
  assert.equal(parse('').ok, false);
});

test('examples are written against the dataset', () => {
  const profile = {
    dimensions: ['Region'],
    measures: ['Revenue', 'Units'],
    columns: { 'Order Date': { role: 'time' } },
  };
  const examples = exampleTransformPhrases(profile, COLUMNS);
  assert.ok(examples.some((e) => e.includes('Order Date')));
  assert.ok(examples.some((e) => e.includes('[Revenue]')));
  // Every example the box offers has to be one the parser accepts.
  for (const phrase of examples) {
    const r = parse(phrase);
    assert.equal(r.ok, true, `${phrase}: ${r.error}`);
  }
});
