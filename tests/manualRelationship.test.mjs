import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAnalysisView,
  buildDataModel,
  inferRelationships,
  manualRelationship,
  relationshipId,
  testRelationship,
} from '../lib/dataModel.js';

/* Relationships the user writes themselves.

   Inference is a guess, and the point of this feature is being able to overrule
   it. The point of these tests is that overruling it is not the same as being
   trusted blindly: the pairing is measured first, and the one thing that cannot
   be overruled is a parent column that does not identify a row. */

const sales = {
  name: 'sales',
  columns: ['Cust_No', 'Prod', 'Amount'],
  rows: [
    { Cust_No: 'c1', Prod: 'p1', Amount: 10 },
    { Cust_No: 'c2', Prod: 'p1', Amount: 20 },
    { Cust_No: 'c3', Prod: 'p2', Amount: 30 },
    { Cust_No: 'c9', Prod: 'p2', Amount: 40 },
    // A repeated customer, so the fact side is many — which is what a sales
    // table looks like and what makes this a many-to-one.
    { Cust_No: 'c1', Prod: 'p2', Amount: 50 },
  ],
};
const people = {
  name: 'people',
  columns: ['Ref', 'City'],
  rows: [
    { Ref: 'c1', City: 'Leeds' },
    { Ref: 'c2', City: 'York' },
    { Ref: 'c3', City: 'Hull' },
  ],
};
const repeated = {
  name: 'repeated',
  columns: ['Ref', 'Note'],
  rows: [
    { Ref: 'c1', Note: 'first' },
    { Ref: 'c1', Note: 'second' },
    { Ref: 'c2', Note: 'third' },
  ],
};
const tables = [sales, people, repeated];
const link = { from: { table: 'sales', column: 'Cust_No' }, to: { table: 'people', column: 'Ref' } };

test('a pairing inference never offered can still be measured', () => {
  // Nothing about "Cust_No" points at a table called people with a column Ref,
  // so the inference has no name evidence to work from at all.
  const inferred = inferRelationships(tables).relationships;
  assert.ok(
    !inferred.some((r) => r.from.column === 'Cust_No' && r.to.table === 'people'),
    'inference does not offer this pairing on its own'
  );

  const measured = testRelationship(tables, link);
  assert.equal(measured.ok, true);
  assert.equal(measured.cardinality, 'many-to-one');
  assert.equal(measured.matched, 3);
  assert.equal(measured.distinct, 4);
  assert.equal(measured.overlap, 0.75);
});

test('a partial match is a warning, not a refusal — it is the user’s call', () => {
  const { problems, warnings } = testRelationship(tables, link);
  assert.deepEqual(problems, []);
  assert.ok(warnings.some((w) => /75%/.test(w)));
});

test('a parent column with repeated values is refused outright', () => {
  const measured = testRelationship(tables, {
    from: { table: 'sales', column: 'Cust_No' },
    to: { table: 'repeated', column: 'Ref' },
  });
  assert.equal(measured.ok, false);
  assert.equal(measured.cardinality, null);
  assert.match(measured.problems[0], /multiplied/);
});

test('values that never meet are refused', () => {
  const measured = testRelationship(tables, {
    from: { table: 'sales', column: 'Prod' },
    to: { table: 'people', column: 'Ref' },
  });
  assert.equal(measured.ok, false);
  assert.match(measured.problems[0], /nothing would join/);
});

test('nonsense pairings are refused rather than measured', () => {
  assert.match(testRelationship(tables, {}).problems[0], /Choose a column/);
  assert.match(
    testRelationship(tables, {
      from: { table: 'sales', column: 'Cust_No' },
      to: { table: 'sales', column: 'Amount' },
    }).problems[0],
    /cannot be joined to itself/
  );
  assert.match(
    testRelationship(tables, { from: { table: 'ghost', column: 'a' }, to: { table: 'people', column: 'Ref' } })
      .problems[0],
    /not loaded/
  );
});

test('a measured pairing becomes a relationship shaped like an inferred one', () => {
  const measured = testRelationship(tables, link);
  const rel = manualRelationship(link, measured);
  assert.equal(rel.id, relationshipId(link.from, link.to));
  assert.equal(rel.source, 'manual');
  assert.equal(rel.confidence, 1, 'an instruction, not a guess');
  assert.equal(rel.cardinality, 'many-to-one');

  // Everything the review page reads off an inferred relationship.
  for (const key of ['id', 'from', 'to', 'cardinality', 'confidence', 'overlap', 'reasons']) {
    assert.ok(key in rel, `carries ${key}`);
  }
});

test('a hand-added relationship joins its table and marks it a dimension', () => {
  const measured = testRelationship(tables, link);
  const rel = manualRelationship(link, measured);

  // Without it, people is unrelated: nothing links the two tables.
  const before = buildDataModel([sales, people], { factTable: 'sales' });
  assert.equal(before.tables.find((t) => t.name === 'people').role, 'unrelated');

  const after = buildDataModel([sales, people], { factTable: 'sales', relationships: [rel] });
  assert.equal(
    after.tables.find((t) => t.name === 'people').role,
    'dimension',
    'the role follows the model the user asked for, not the guess'
  );
  assert.deepEqual(after.relationships, [rel]);

  // And the view actually carries the joined column.
  const view = buildAnalysisView({ sales, people }, after);
  assert.ok(view.columns.includes('City'));
  assert.equal(view.rows.length, sales.rows.length, 'a many-to-one join adds no rows');
  assert.equal(view.rows.find((r) => r.Cust_No === 'c1').City, 'Leeds');
  assert.equal(view.rows.find((r) => r.Cust_No === 'c9').City, null, 'an unmatched key comes through empty');
});

test('switching a relationship off is honoured the same way', () => {
  const model = buildDataModel([sales, people], { factTable: 'sales', relationships: [] });
  assert.deepEqual(model.relationships, []);
  assert.equal(model.tables.find((t) => t.name === 'people').role, 'unrelated');
});
