/**
 * Reshaping data before it is analysed.
 *
 * Two things are being pinned. That each step produces the query it claims and
 * the columns it claims — because everything downstream, from the profile to
 * the chart planner, is handed that column list and has to be right about it.
 * And that an expression typed by a person cannot become a query: these strings
 * are concatenated into SQL, which makes the validator the only thing standing
 * between a formula box and the table it runs over.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { UNCERTAIN, columnUncertainCount, createConfidence, noteUncertain } from '../lib/cellConfidence.js';
import {
  confidenceAfterTransforms,
  DERIVE,
  DROP,
  FILTER,
  RENAME,
  RETYPE,
  columnNameProblem,
  describeTransform,
  planTransform,
  planTransforms,
  validateTransform,
} from '../lib/transforms.js';

const COLUMNS = ['region', 'units', 'revenue'];

/* -- what each step does -------------------------------------------------- */

test('rename aliases the column and leaves the order alone', () => {
  const step = planTransform({ kind: RENAME, column: 'revenue', to: 'Net revenue' }, COLUMNS);
  assert.equal(step.ok, true);
  assert.deepEqual(step.columns, ['region', 'units', 'Net revenue']);
  assert.match(step.sql, /\[revenue\] AS \[Net revenue\]/);
  assert.match(step.sql, /^SELECT \[region\], \[units\]/);
});

test('drop removes it from the query and from what follows', () => {
  const step = planTransform({ kind: DROP, column: 'units' }, COLUMNS);
  assert.deepEqual(step.columns, ['region', 'revenue']);
  assert.equal(step.sql.includes('[units]'), false);
});

test('derive appends the column and keeps the rest in place', () => {
  const step = planTransform({ kind: DERIVE, name: 'per_unit', expr: '[revenue] / [units]' }, COLUMNS);
  assert.equal(step.ok, true);
  assert.deepEqual(step.columns, ['region', 'units', 'revenue', 'per_unit']);
  assert.match(step.sql, /\(\[revenue\] \/ \[units\]\) AS \[per_unit\]/);
});

test('retype casts in place without moving the column', () => {
  const step = planTransform({ kind: RETYPE, column: 'units', to: 'number' }, COLUMNS);
  assert.deepEqual(step.columns, COLUMNS, 'the shape is unchanged');
  assert.match(step.sql, /TO_NUMBER\(\[units\]\) AS \[units\]/);
});

test('filter is the one step that changes rows rather than shape', () => {
  const step = planTransform({ kind: FILTER, expr: '[units] > 0' }, COLUMNS);
  assert.deepEqual(step.columns, COLUMNS);
  assert.match(step.sql, /WHERE \(\[units\] > 0\)/);
});

/* -- what is refused ------------------------------------------------------ */

test('a step cannot mention a column that is not there', () => {
  const ops = [
    { kind: RENAME, column: 'nope', to: 'x' },
    { kind: DROP, column: 'nope' },
    { kind: RETYPE, column: 'nope', to: 'number' },
  ];
  for (const op of ops) {
    const checked = validateTransform(op, COLUMNS);
    assert.equal(checked.ok, false, `${op.kind} accepted a missing column`);
    assert.match(checked.error, /no column called/);
  }
});

test('a derived column cannot take a name that is taken', () => {
  const checked = validateTransform({ kind: DERIVE, name: 'units', expr: '1 + 1' }, COLUMNS);
  assert.equal(checked.ok, false);
  assert.match(checked.error, /already a column/);
});

test('a name that could escape its brackets is refused', () => {
  assert.match(columnNameProblem('bad] name', []), /cannot contain/);
  assert.equal(columnNameProblem('', []), 'Give the column a name.');
  assert.match(columnNameProblem('Region', ['region']), /already a column/);
  assert.equal(columnNameProblem('margin', COLUMNS), null);
});

test('an expression cannot become a query', () => {
  // These strings are concatenated into SQL. The validator is the only thing
  // between the formula box and the table.
  const attacks = [
    '1; DROP TABLE Dataset',
    '1 /* sneak */ + 1',
    '(SELECT 1)',
    '[units] FROM Dataset',
    '1 UNION SELECT * FROM Dataset',
    '1 -- comment',
  ];
  for (const expr of attacks) {
    const derived = validateTransform({ kind: DERIVE, name: 'x', expr }, COLUMNS);
    const filtered = validateTransform({ kind: FILTER, expr }, COLUMNS);
    assert.equal(derived.ok, false, `derive accepted: ${expr}`);
    assert.equal(filtered.ok, false, `filter accepted: ${expr}`);
  }
});

test('an aggregate is refused — a derived column is computed from one row', () => {
  // SUM here would silently collapse the table rather than add a column.
  const checked = validateTransform({ kind: DERIVE, name: 'total', expr: 'SUM([revenue])' }, COLUMNS);
  assert.equal(checked.ok, false);
  assert.match(checked.error, /filter picks rows|cannot use SUM/i);
});

test('dropping the last column is refused', () => {
  const checked = validateTransform({ kind: DROP, column: 'only' }, ['only']);
  assert.equal(checked.ok, false);
  assert.match(checked.error, /nothing left/);
});

/* -- a list of them ------------------------------------------------------- */

test('each step sees the columns the one before it left', () => {
  const { steps, columns } = planTransforms(
    [
      { id: '1', kind: RENAME, column: 'revenue', to: 'net' },
      { id: '2', kind: DERIVE, name: 'per_unit', expr: '[net] / [units]' },
      { id: '3', kind: DROP, column: 'units' },
    ],
    COLUMNS
  );

  assert.equal(steps.length, 3);
  assert.deepEqual(columns, ['region', 'net', 'per_unit']);
  // Step 2 could only be written against the name step 1 created.
  assert.match(steps[1].sql, /\[net\] \/ \[units\]/);
});

test('a broken step is skipped and the rest still run', () => {
  // Transforms are edited by hand and refer to each other. Blanking the dataset
  // because one of them is stale would make the reader undo backwards to find
  // out which.
  const { steps, columns, skipped } = planTransforms(
    [
      { id: '1', kind: DROP, column: 'units' },
      { id: '2', kind: DERIVE, name: 'per_unit', expr: '[revenue] / [units]' },
      { id: '3', kind: RENAME, column: 'region', to: 'Territory' },
    ],
    COLUMNS
  );

  assert.equal(steps.length, 2, 'the two that could run, ran');
  assert.deepEqual(columns, ['Territory', 'revenue']);
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].id, '2');
  assert.match(skipped[0].reason, /units/);
});

test('a step turned off is skipped and says so', () => {
  const { steps, skipped } = planTransforms(
    [{ id: '1', kind: DROP, column: 'units', enabled: false }],
    COLUMNS
  );
  assert.equal(steps.length, 0);
  assert.deepEqual(skipped, [{ id: '1', reason: 'turned off' }]);
});

test('no steps is not an error, it is the data as it arrived', () => {
  const { steps, columns, skipped } = planTransforms([], COLUMNS);
  assert.deepEqual(steps, []);
  assert.deepEqual(columns, COLUMNS);
  assert.deepEqual(skipped, []);
});

test('every step can describe itself to a person', () => {
  const ops = [
    { kind: RENAME, column: 'a', to: 'b' },
    { kind: DROP, column: 'a' },
    { kind: DERIVE, name: 'x', expr: '1' },
    { kind: RETYPE, column: 'a', to: 'number' },
    { kind: FILTER, expr: '[a] > 1' },
  ];
  for (const op of ops) {
    const text = describeTransform(op);
    assert.ok(text && text !== 'Unknown step', `${op.kind} has no description`);
  }
});

/* -- doubt, carried across a reshape -------------------------------------- */

const COLS = ['region', 'units', 'revenue', 'a'];
/** The store follows the PLAN, so every test here plans its ops first. */
const after = (store, ops, columns = COLS) => confidenceAfterTransforms(store, planTransforms(ops, columns));

function storeWith(counts) {
  const store = createConfidence();
  for (const [column, n] of Object.entries(counts)) {
    for (let i = 0; i < n; i++) noteUncertain(store, column, i, UNCERTAIN.DATE_ORDER);
  }
  return store;
}

test('no transforms leaves the store exactly as it was', () => {
  const store = storeWith({ units: 3 });
  assert.equal(after(store, []), store, 'the same object, untouched');
});

test('a rename takes the doubt with it', () => {
  const result = after(storeWith({ revenue: 5 }), [
    { kind: RENAME, column: 'revenue', to: 'net' },
  ]);
  assert.equal(columnUncertainCount(result, 'net'), 5);
  assert.equal(columnUncertainCount(result, 'revenue'), 0, 'and leaves nothing behind');
});

test('a drop takes its doubt out of the total', () => {
  const result = after(storeWith({ units: 4, region: 2 }), [
    { kind: DROP, column: 'units' },
  ]);
  assert.equal(columnUncertainCount(result, 'units'), 0);
  assert.equal(columnUncertainCount(result, 'region'), 2);
  assert.equal(result.total, 2, 'the dropped column is not still counted');
});

test('a derived column is no sounder than its shakiest input', () => {
  // [net] / [units] cannot be more trustworthy than units was.
  const result = after(
    storeWith({ units: 40, net: 2 }),
    [{ kind: DERIVE, name: 'per_unit', expr: '[net] / [units]' }],
    ['units', 'net']
  );
  assert.equal(columnUncertainCount(result, 'per_unit'), 40, 'it inherits the worst, not the average');
});

test('a derived column from clean inputs carries no doubt', () => {
  const result = after(storeWith({ units: 3 }), [
    { kind: DERIVE, name: 'flag', expr: '[region]' },
  ]);
  assert.equal(columnUncertainCount(result, 'flag'), 0);
});

test('row positions are thrown away, because a filter renumbers them', () => {
  const result = after(storeWith({ units: 3 }), [
    { kind: FILTER, expr: '[units] > 0' },
  ]);
  assert.deepEqual(result.cells, {}, 'no position survives a reshape');
  assert.equal(result.truncated, true, 'and the store says so');
  assert.equal(columnUncertainCount(result, 'units'), 3, 'while the counts stay exact');
});

test('a step turned off changes nothing', () => {
  const result = after(storeWith({ revenue: 5 }), [
    { kind: RENAME, column: 'revenue', to: 'net', enabled: false },
  ]);
  assert.equal(columnUncertainCount(result, 'revenue'), 5, 'the rename never happened');
});

test('renames chain, so the last name holds the doubt', () => {
  const result = after(storeWith({ a: 7 }), [
    { kind: RENAME, column: 'a', to: 'b' },
    { kind: RENAME, column: 'b', to: 'c' },
  ]);
  assert.equal(columnUncertainCount(result, 'c'), 7);
  assert.equal(columnUncertainCount(result, 'a'), 0);
  assert.equal(columnUncertainCount(result, 'b'), 0);
});
