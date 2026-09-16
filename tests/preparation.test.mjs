/**
 * The guard between a model's idea of how to prepare a table and the engine.
 *
 * The model proposes steps and measures; nothing it says reaches the data
 * without planning against the real columns first. These tests pin what is
 * kept, what is dropped and why, and the line between a step that runs on its
 * own and one that waits for a person.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  acceptMeasures,
  acceptPreparation,
  acceptSteps,
  describePreparation,
  pickFields,
  preparationBriefing,
  splitProposals,
} from '../lib/preparation.js';

const COLUMNS = ['Order Date', 'Region', 'Revenue', 'Cost', 'Units', 'Customer'];

test('a step is kept only with the fields its kind defines', () => {
  const picked = pickFields({ kind: 'derive', name: 'Margin', expr: '[Revenue] - [Cost]', sql: 'DROP TABLE x', why: 'x' });
  assert.deepEqual(picked, { kind: 'derive', name: 'Margin', expr: '[Revenue] - [Cost]' });
  assert.equal(pickFields({ kind: 'explode' }), null);
  assert.equal(pickFields({ kind: 'DERIVE', name: 'a', expr: '1' }).kind, 'derive', 'case is forgiven');
});

test('steps are planned in order, so a later one may use an earlier one\'s column', () => {
  const { steps, skipped, columns } = acceptSteps(
    [
      { kind: 'derive', name: 'Margin', expr: '[Revenue] - [Cost]', why: 'Profit per order.' },
      { kind: 'derive', name: 'Margin %', expr: 'SAFE_DIVIDE([Margin], [Revenue]) * 100', why: 'As a rate.' },
      { kind: 'datepart', name: 'Month', column: 'Order Date', part: 'year_month', why: 'A series.' },
    ],
    { columns: COLUMNS }
  );
  assert.equal(skipped.length, 0);
  assert.deepEqual(steps.map((s) => s.name), ['Margin', 'Margin %', 'Month']);
  assert.deepEqual(columns, [...COLUMNS, 'Margin', 'Margin %', 'Month']);
  assert.equal(steps[0].source, 'model');
  assert.equal(steps[0].why, 'Profit per order.');
  assert.ok(steps[0].id.startsWith('ai_1_'));
});

test('a step naming a column that is not there is dropped with the reason', () => {
  const { steps, skipped } = acceptSteps(
    [
      { kind: 'derive', name: 'Margin', expr: '[Revenue] - [Costs]' },
      { kind: 'drop', column: 'Customer' },
    ],
    { columns: COLUMNS }
  );
  assert.equal(steps.length, 1);
  assert.equal(steps[0].kind, 'drop');
  assert.equal(skipped.length, 1);
  assert.match(skipped[0].reason, /Costs/);
});

test('a formula that is really a query never gets through', () => {
  const { steps, skipped } = acceptSteps(
    [
      { kind: 'derive', name: 'x', expr: '(SELECT 1)' },
      { kind: 'filter', expr: '1; DROP TABLE SalesData' },
      { kind: 'derive', name: 'y', expr: 'SUM([Revenue])' },
    ],
    { columns: COLUMNS }
  );
  assert.equal(steps.length, 0);
  assert.equal(skipped.length, 3);
});

test('an unknown kind, or too many steps, is refused rather than guessed at', () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ kind: 'derive', name: `c${i}`, expr: '1' }));
  const { steps, skipped } = acceptSteps([{ kind: 'teleport' }, ...many], { columns: COLUMNS, maxSteps: 3 });
  assert.equal(steps.length, 3);
  assert.match(skipped[0].reason, /not a kind of step/);
  assert.match(skipped[1].reason, /first 3/);
});

test('measures are validated as aggregates over the columns the steps leave', () => {
  const { measures, skipped } = acceptMeasures(
    [
      { name: 'Margin Rate', expr: 'SUM([Margin]) / SUM([Revenue]) * 100', format: 'percent', by: 'region', why: 'Profitability.' },
      { name: 'Bare', expr: '[Revenue] / [Units]' },
      { name: 'Filtered', expr: 'SUM([Revenue])', filter: "[Region] = 'West'", format: 'currency' },
      { name: 'Bad filter', expr: 'SUM([Revenue])', filter: 'SUM([Units]) > 1' },
    ],
    { columns: [...COLUMNS, 'Margin'] }
  );
  assert.deepEqual(measures.map((m) => m.name), ['Margin Rate', 'Filtered']);
  assert.equal(measures[0].format, 'percent');
  assert.equal(measures[0].by, 'Region', 'the dimension is resolved to the real column name');
  assert.equal(measures[0].source, 'model');
  assert.equal(measures[1].filter, "[Region] = 'West'");
  assert.equal(skipped.length, 2);
  assert.match(skipped[0].reason, /aggregate/);
  assert.match(skipped[1].reason, /Filter/);
});

test('a measure name that is taken gets a different one', () => {
  const { measures } = acceptMeasures([{ name: 'Total Revenue', expr: 'SUM([Revenue])' }], {
    columns: COLUMNS,
    measures: [{ name: 'Total Revenue', expr: 'SUM([Revenue])' }],
  });
  assert.notEqual(measures[0].name, 'Total Revenue');
});

test('the whole reply is accepted together, measures seeing the steps\' columns', () => {
  const out = acceptPreparation(
    {
      summary: 'Orders, one row each. 1,234 of them.',
      steps: [{ kind: 'derive', name: 'Margin', expr: '[Revenue] - [Cost]' }],
      measures: [{ name: 'Total Margin', expr: 'SUM([Margin])', format: 'currency' }],
    },
    { columns: COLUMNS }
  );
  assert.equal(out.steps.length, 1);
  assert.equal(out.measures.length, 1);
  assert.equal(out.summary, 'Orders, one row each. 1,234 of them.');
  assert.deepEqual(out.columns, [...COLUMNS, 'Margin']);
  assert.equal(acceptPreparation(null, { columns: COLUMNS }).steps.length, 0, 'nothing is a fine answer');
});

test('only steps that add a column run on their own, and only up to the first that does not', () => {
  const { automatic, suggested } = splitProposals([
    { kind: 'derive', name: 'Margin' },
    { kind: 'datepart', name: 'Month' },
    { kind: 'filter', expr: "[Region] <> 'Test'" },
    { kind: 'bucket', name: 'Band' },
    { kind: 'drop', column: 'Customer' },
  ]);
  assert.deepEqual(automatic.map((s) => s.name), ['Margin', 'Month']);
  assert.deepEqual(suggested.map((s) => s.kind), ['filter', 'bucket', 'drop']);
});

test('the briefing shows the shape and what already exists, never the rows', () => {
  const briefing = preparationBriefing({
    vocabulary: {
      dimensions: { Region: [{ value: 'West', sharePct: 60 }] },
      measures: { Revenue: { min: 1, max: 9, median: 4 } },
      sample: [{ Region: 'West', Revenue: 4 }],
    },
    profile: { dimensions: ['Region'], measures: ['Revenue'], cardinality: { Region: 1 } },
    columns: ['Region', 'Revenue', 'Note'],
    transforms: [{ kind: 'derive', name: 'x', expr: '1' }, { kind: 'drop', column: 'y', enabled: false }],
    measures: [{ name: 'Total', expr: 'SUM([Revenue])' }],
    fileName: 'orders.csv',
    rowCount: 10,
  });
  assert.deepEqual(briefing.columns.map((c) => c.name), ['Region', 'Revenue', 'Note']);
  assert.equal(briefing.columns[2].kind, 'text', 'a column the profile does not list still exists');
  assert.deepEqual(briefing.existingSteps, ['Add x = 1'], 'a step turned off is not a step');
  assert.deepEqual(briefing.existingMeasures, [{ name: 'Total', expr: 'SUM([Revenue])' }]);
  assert.equal(briefing.sample.length, 1);
  assert.equal(briefing.rowCount, 10);
});

test('the dashboard line says what happened, in words', () => {
  assert.equal(
    describePreparation({ applied: [1, 2], suggested: [1], measures: [1] }),
    'Before analysing, the analyst added 2 columns, defined 1 measure and suggested 1 more step for you to accept.'
  );
  assert.equal(describePreparation({ applied: [1] }), 'Before analysing, the analyst added 1 column.');
  assert.equal(describePreparation({}), '');
});
