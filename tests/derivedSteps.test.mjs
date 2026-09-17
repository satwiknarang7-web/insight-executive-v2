import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveSteps, MAX_DERIVED } from '../lib/derivedSteps.js';
import { preparationFor } from '../lib/preparation.js';

/* The shaping a report gets with no model behind it.

   The bug these are written for: measures were derived deterministically and
   steps were not, so a browser with no key saved got a report with the
   analyst's measures on it and never one of its steps. */

const daily = (n) => {
  const rows = [];
  for (let i = 0; i < n; i++) {
    const date = new Date(Date.UTC(2025, 0, 1 + i));
    rows.push({ Order_Date: date.toISOString().slice(0, 10), City: 'Berlin, DE', Revenue: 100 + i });
  }
  return rows;
};

const context = ({ columns, dimensions, measures, temporal, cardinality, vocabulary }) => ({
  columns,
  profile: { dimensions, measures, temporal, cardinality },
  vocabulary,
});

test('a daily date gets the month column a breakdown is grouped by', () => {
  const steps = deriveSteps(
    context({
      columns: ['Order_Date', 'Revenue'],
      dimensions: ['Order_Date'],
      measures: ['Revenue'],
      temporal: ['Order_Date'],
      cardinality: { Order_Date: 365 },
      vocabulary: { dimensions: {}, measures: {}, sample: daily(8) },
    })
  );
  const month = steps.find((s) => s.part === 'year_month');
  assert.ok(month, 'a month column is proposed');
  assert.equal(month.kind, 'datepart');
  assert.equal(month.column, 'Order_Date');
  assert.match(month.name, /Month/);
  assert.ok(month.why.length > 0, 'and it says why');
});

test('a date that is already monthly is left alone', () => {
  const steps = deriveSteps(
    context({
      columns: ['Month', 'Revenue'],
      dimensions: ['Month'],
      measures: ['Revenue'],
      temporal: ['Month'],
      cardinality: { Month: 18 },
      vocabulary: { dimensions: {}, measures: {}, sample: [{ Month: '2025-01-01' }, { Month: '2025-02-01' }] },
    })
  );
  assert.deepEqual(steps, []);
});

test('an hour is proposed only when the timestamps carry one that varies', () => {
  const varied = [
    { Seen_At: '2025-01-01 09:15' },
    { Seen_At: '2025-01-02 14:40' },
    { Seen_At: '2025-01-03 21:05' },
  ];
  const midnight = varied.map((r) => ({ Seen_At: `${r.Seen_At.slice(0, 10)} 00:00` }));
  const build = (sample) =>
    deriveSteps(
      context({
        columns: ['Seen_At'],
        dimensions: ['Seen_At'],
        measures: [],
        temporal: ['Seen_At'],
        cardinality: { Seen_At: 500 },
        vocabulary: { dimensions: {}, measures: {}, sample },
      })
    );

  assert.ok(build(varied).some((s) => s.part === 'hour'), 'a varying time of day is a column');
  assert.ok(!build(midnight).some((s) => s.part === 'hour'), 'an export stamped midnight is not');
});

test('a compound column is split only when nearly every value has the shape', () => {
  const levels = (values) => ({
    dimensions: { City: values.map((value) => ({ value, count: 10, sharePct: 10 })) },
    measures: {},
    sample: [],
  });
  const build = (values) =>
    deriveSteps(
      context({
        columns: ['City'],
        dimensions: ['City'],
        measures: [],
        temporal: [],
        cardinality: { City: values.length },
        vocabulary: levels(values),
      })
    );

  const split = build(['Berlin, DE', 'Paris, FR', 'Madrid, ES', 'Lisbon, PT']).find((s) => s.kind === 'split');
  assert.ok(split, 'four cities with a country after the comma');
  assert.equal(split.separator, ', ');
  assert.equal(split.into.length, 2);
  assert.equal(split.dropOriginal, false, 'the original stays: this only adds');

  // A comma in one value out of four is a comma in a sentence.
  assert.equal(build(['Berlin', 'Paris', 'Madrid', 'Lisbon, Portugal']).length, 0);
});

test('a continuous number is banded at boundaries a person would have picked', () => {
  const steps = deriveSteps(
    context({
      columns: ['Age', 'Region'],
      dimensions: ['Region'],
      measures: ['Age'],
      temporal: [],
      cardinality: { Age: 70 },
      vocabulary: { dimensions: {}, measures: { Age: { min: 18, median: 41, max: 88 } }, sample: [] },
    })
  );
  const band = steps.find((s) => s.kind === 'bucket');
  assert.ok(band);
  assert.equal(band.column, 'Age');
  assert.deepEqual(band.edges, [...band.edges].sort((a, b) => a - b), 'boundaries go up');
  assert.equal(new Set(band.edges).size, band.edges.length, 'and never repeat');
  for (const edge of band.edges) {
    assert.equal(edge, Math.round(edge), `${edge} is a round number`);
  }
});

test('an identifier, a rate and a spike are not banded', () => {
  const build = (column, range, distinct) =>
    deriveSteps(
      context({
        columns: [column],
        dimensions: [],
        measures: [column],
        temporal: [],
        cardinality: { [column]: distinct },
        vocabulary: { dimensions: {}, measures: { [column]: range }, sample: [] },
      })
    );

  assert.equal(build('Customer_ID', { min: 1, median: 500, max: 1000 }, 1000).length, 0);
  assert.equal(build('Churn_Rate', { min: 0, median: 0.4, max: 1 }, 400).length, 0);
  // A median at the floor is a spike with a tail: every row lands in one band.
  assert.equal(build('Spend', { min: 0, median: 1, max: 100000 }, 900).length, 0);
  // Ten distinct values is already a category.
  assert.equal(build('Rating', { min: 1, median: 5, max: 10 }, 10).length, 0);
});

test('it never proposes more than it was asked to, or a column that exists', () => {
  const steps = deriveSteps(
    context({
      columns: ['Order_Date', 'Order Date Month'],
      dimensions: ['Order_Date'],
      measures: [],
      temporal: ['Order_Date'],
      cardinality: { Order_Date: 365 },
      vocabulary: { dimensions: {}, measures: {}, sample: daily(8) },
    })
  );
  assert.ok(steps.length <= MAX_DERIVED);
  assert.ok(!steps.some((s) => s.name === 'Order Date Month'), 'the column is already there');
});

test('the derived steps and a model proposal end up in one checked list', () => {
  const columns = ['Order_Date', 'Revenue', 'Cost'];
  const derived = deriveSteps(
    context({
      columns,
      dimensions: ['Order_Date'],
      measures: ['Revenue', 'Cost'],
      temporal: ['Order_Date'],
      cardinality: { Order_Date: 365 },
      vocabulary: { dimensions: {}, measures: {}, sample: daily(8) },
    })
  );
  const model = {
    steps: [{ kind: 'derive', name: 'Margin', expr: '[Revenue] - [Cost]', why: 'What is left after cost.' }],
    measures: [],
    summary: 'Derived a margin.',
  };

  const merged = preparationFor(model, { columns, derived });
  const kinds = merged.steps.map((s) => s.kind);
  assert.ok(kinds.includes('datepart'), 'the rule-written step survives');
  assert.ok(kinds.includes('derive'), 'and so does the model’s');
  assert.equal(merged.steps[0].source, 'derived', 'additive rules go first, so they are applied');
  assert.equal(merged.steps.at(-1).source, 'model');

  // With no provider at all, the derived steps are the whole preparation.
  const alone = preparationFor(null, { columns, derived });
  assert.equal(alone.steps.length, derived.length);
  assert.ok(alone.steps.every((s) => s.source === 'derived'));
});

test('a step that names a column that is not there is dropped with a reason', () => {
  const merged = preparationFor(
    { steps: [{ kind: 'datepart', column: 'Nope', part: 'year_month', name: 'Nope Month' }], measures: [] },
    { columns: ['Order_Date'], derived: [] }
  );
  assert.equal(merged.steps.length, 0);
  assert.equal(merged.skipped.length, 1);
  assert.ok(merged.skipped[0].reason);
});
