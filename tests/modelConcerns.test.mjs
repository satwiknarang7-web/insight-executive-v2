import test from 'node:test';
import assert from 'node:assert/strict';
import { modelConcerns, POOR_MATCH, LOW_CONFIDENCE } from '../lib/dataModel.js';

const rel = (from, to, confidence = 0.95) => ({
  id: `${from}->${to}`,
  from: { table: from, column: 'k' },
  to: { table: to, column: 'id' },
  cardinality: 'many-to-one',
  confidence,
});

test('a clean model raises nothing', () => {
  const concerns = modelConcerns({
    model: { relationships: [rel('Orders', 'Customers')], warnings: [] },
    tables: [{ name: 'Orders', role: 'fact' }, { name: 'Customers', role: 'dimension' }],
    joins: [{ from: { table: 'Orders' }, to: { table: 'Customers' }, matchRate: 1 }],
  });
  assert.deepEqual(concerns, []);
});

test('a join that matched almost nothing is the loudest signal', () => {
  // This is the case that produces confident, precise, wrong totals: the join
  // succeeded structurally and matched almost no rows.
  const concerns = modelConcerns({
    model: { relationships: [rel('Orders', 'Customers', 0.98)], warnings: [] },
    tables: [],
    joins: [{ from: { table: 'Orders' }, to: { table: 'Customers' }, matchRate: 0.04 }],
  });
  assert.equal(concerns.length, 1);
  assert.match(concerns[0], /matched only 4% of rows/);
});

test('a measured match rate outranks a high confidence score', () => {
  // Confidence is what the inference believed beforehand; the match rate is
  // what happened. Only one of them should be reported, and it is the latter.
  const concerns = modelConcerns({
    model: { relationships: [rel('A', 'B', 0.99)], warnings: [] },
    joins: [{ from: { table: 'A' }, to: { table: 'B' }, matchRate: 0.5 }],
  });
  assert.equal(concerns.length, 1);
  assert.match(concerns[0], /matched only/);
  assert.doesNotMatch(concerns[0], /confidence/);
});

test('low confidence is reported when nothing was measured', () => {
  const concerns = modelConcerns({
    model: { relationships: [rel('A', 'B', 0.6)], warnings: [] },
    joins: [],
  });
  assert.equal(concerns.length, 1);
  assert.match(concerns[0], /low confidence/);
});

test('a well-matched join is not flagged for its confidence', () => {
  const concerns = modelConcerns({
    model: { relationships: [rel('A', 'B', 0.6)], warnings: [] },
    joins: [{ from: { table: 'A' }, to: { table: 'B' }, matchRate: 1 }],
  });
  assert.deepEqual(concerns, [], 'a join that matched every row is fine however it was guessed');
});

test('unsupported many-to-many links are surfaced verbatim', () => {
  const concerns = modelConcerns({
    model: { relationships: [], warnings: [{ message: 'A and B look related but neither side is unique.' }] },
  });
  assert.deepEqual(concerns, ['A and B look related but neither side is unique.']);
});

test('a table joined to nothing is called out, because its columns vanish', () => {
  const concerns = modelConcerns({
    model: { relationships: [], warnings: [] },
    tables: [{ name: 'Orders', role: 'fact' }, { name: 'Notes', role: 'unrelated' }],
  });
  assert.equal(concerns.length, 1);
  assert.match(concerns[0], /Notes is not related to anything/);
});

test('missing input is survivable', () => {
  assert.deepEqual(modelConcerns({}), []);
  assert.deepEqual(modelConcerns(), []);
  assert.deepEqual(modelConcerns({ model: { relationships: [] } }), []);
});

test('the thresholds are exported so the UI cannot drift from the check', () => {
  assert.equal(POOR_MATCH, 0.9);
  assert.equal(LOW_CONFIDENCE, 0.75);
});
