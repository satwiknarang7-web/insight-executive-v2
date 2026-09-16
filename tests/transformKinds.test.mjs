/**
 * Every kind of step, planned and then actually run.
 *
 * `transforms.test.mjs` pins the five original steps and the rules about
 * expressions. This file covers the rest of the Power Query surface — and runs
 * each plan through alasql, because a step that produces plausible SQL the
 * engine then refuses is exactly the failure a person would meet first. The
 * columns a plan promises are checked against the columns that came back.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import alasql from 'alasql';

import { registerEngineFunctions } from '../lib/engineFunctions.js';
import {
  ADDITIVE_KINDS,
  BLANKS,
  BUCKET,
  CONDITIONAL,
  DATEPART,
  DEDUPE,
  FILL,
  FILTER,
  GROUP,
  INDEX,
  KEEP,
  LIMIT,
  MERGE,
  PIVOT,
  REPLACE,
  RETYPE,
  SORT,
  SPLIT,
  TEXT,
  TRANSFORM_KINDS,
  UNPIVOT,
  bucketLabels,
  describeTransform,
  literal,
  planTransform,
  planTransforms,
  validateTransform,
} from '../lib/transforms.js';

registerEngineFunctions(alasql);

const ROWS = [
  { region: 'North', city: 'Austin, TX', date: '2024-03-15T00:00:00.000Z', units: 5, revenue: 100, name: ' alice ' },
  { region: 'North', city: 'Boston, MA', date: '2024-11-02T00:00:00.000Z', units: 2, revenue: 40, name: 'BOB' },
  { region: 'South', city: 'Miami, FL', date: '2024-11-20T00:00:00.000Z', units: null, revenue: 10, name: null },
  { region: 'South', city: 'Miami, FL', date: '2024-11-20T00:00:00.000Z', units: null, revenue: 10, name: null },
];
const COLUMNS = ['region', 'city', 'date', 'units', 'revenue', 'name'];

/** Run a list of steps the way the worker does: one query per step. */
function run(ops, rows = ROWS, columns = COLUMNS) {
  const plan = planTransforms(ops, columns, 'T');
  let current = rows;
  for (const step of plan.steps) {
    alasql.tables.T = { data: current };
    current = alasql(step.sql);
  }
  delete alasql.tables.T;
  return { ...plan, rows: current };
}

const keysOf = (rows) => (rows.length ? Object.keys(rows[0]) : []);

/* -- shape-changing steps -------------------------------------------------- */

test('keep selects a subset, in the order asked for', () => {
  const { rows, columns } = run([{ id: '1', kind: KEEP, columns: ['revenue', 'region'] }]);
  assert.deepEqual(columns, ['revenue', 'region']);
  assert.deepEqual(keysOf(rows), ['revenue', 'region']);
});

test('retype reads a text column as a number without touching the rest', () => {
  const rows = [{ a: '1,234', b: 'x' }, { a: 'n/a', b: 'y' }];
  const { rows: out } = run([{ id: '1', kind: RETYPE, column: 'a', to: 'number' }], rows, ['a', 'b']);
  assert.equal(out[0].a, 1234);
  assert.equal(out[1].a, null, '"n/a" is nothing, not zero');
  assert.equal(out[1].b, 'y');
});

test('retype to date leaves a timestamp the rest of the app reads', () => {
  const rows = [{ d: '2024-03-15' }, { d: 'never' }];
  const { rows: out } = run([{ id: '1', kind: RETYPE, column: 'd', to: 'date' }], rows, ['d']);
  assert.equal(out[0].d, '2024-03-15T00:00:00.000Z');
  assert.equal(out[1].d, null);
});

test('filter can keep or remove', () => {
  const kept = run([{ id: '1', kind: FILTER, expr: '[revenue] > 20' }]);
  assert.equal(kept.rows.length, 2);
  const removed = run([{ id: '1', kind: FILTER, mode: 'remove', expr: '[revenue] > 20' }]);
  assert.equal(removed.rows.length, 2);
  assert.ok(removed.rows.every((r) => r.revenue <= 20));
  assert.match(describeTransform({ kind: FILTER, mode: 'remove', expr: '[x] = 1' }), /^Remove rows where/);
});

test('a conditional column is a CASE, and each rule is validated as a formula', () => {
  const op = {
    id: '1',
    kind: CONDITIONAL,
    name: 'Size',
    rules: [
      { when: '[revenue] >= 100', then: "'Large'" },
      { when: '[revenue] >= 40', then: "'Medium'" },
    ],
    otherwise: "'Small'",
  };
  const { rows, columns } = run([op]);
  assert.deepEqual(columns, [...COLUMNS, 'Size']);
  assert.deepEqual(rows.map((r) => r.Size), ['Large', 'Medium', 'Small', 'Small']);

  const bad = validateTransform({ ...op, rules: [{ when: 'SELECT 1', then: '1' }] }, COLUMNS);
  assert.equal(bad.ok, false);
  assert.match(bad.error, /Rule 1/);
});

test('bucket bands a number, names the bands, and leaves a blank blank', () => {
  const { rows } = run([{ id: '1', kind: BUCKET, name: 'Band', column: 'revenue', edges: [20, 50] }]);
  assert.deepEqual(rows.map((r) => r.Band), ['50+', '20–50', '< 20', '< 20']);
  const blank = run([{ id: '1', kind: BUCKET, name: 'Band', column: 'units', edges: [3] }]);
  // alasql leaves a CASE that reached NULL as an absent key, which every reader
  // here treats the same as null.
  assert.equal(blank.rows[2].Band == null, true);
  assert.deepEqual(bucketLabels([10, 100]), ['< 10', '10–100', '100+']);
  assert.match(validateTransform({ kind: BUCKET, name: 'x', column: 'revenue', edges: [5, 2] }, COLUMNS).error, /go up/);
});

test('bucket labels are always text, even when they look like numbers', () => {
  const step = planTransform({ kind: BUCKET, name: 'B', column: 'revenue', edges: [50], labels: ['1', '2'] }, COLUMNS, 'T');
  assert.match(step.sql, /THEN '1'/);
  assert.match(step.sql, /ELSE '2'/);
});

test('datepart pulls a part of a date out beside it', () => {
  const { rows, columns } = run([
    { id: '1', kind: DATEPART, name: 'Month', column: 'date', part: 'year_month' },
    { id: '2', kind: DATEPART, name: 'Quarter', column: 'date', part: 'quarter' },
    { id: '3', kind: DATEPART, name: 'Weekday', column: 'date', part: 'weekday' },
  ]);
  assert.deepEqual(columns.slice(-3), ['Month', 'Quarter', 'Weekday']);
  assert.equal(rows[0].Month, '2024-03');
  assert.equal(rows[0].Quarter, 1);
  assert.equal(rows[0].Weekday, 'Friday');
  assert.equal(validateTransform({ kind: DATEPART, name: 'x', column: 'date', part: 'eon' }, COLUMNS).ok, false);
});

test('split makes one column into several, keeping or dropping the original', () => {
  const kept = run([{ id: '1', kind: SPLIT, column: 'city', separator: ',', into: ['Town', 'State'] }]);
  assert.deepEqual(kept.columns, [...COLUMNS, 'Town', 'State']);
  assert.equal(kept.rows[0].Town, 'Austin');
  assert.equal(kept.rows[0].State, 'TX', 'the piece is trimmed');

  // Names are unique without regard to case, so "City" can only replace "city".
  const dropped = run([
    { id: '1', kind: SPLIT, column: 'city', separator: ',', into: ['City', 'State'], dropOriginal: true },
  ]);
  assert.equal(dropped.columns.includes('city'), false);
  assert.equal(dropped.columns.includes('City'), true);
  const clash = validateTransform({ kind: SPLIT, column: 'city', separator: ',', into: ['City', 'State'] }, COLUMNS);
  assert.equal(clash.ok, false);
});

test('split refuses a piece named after a column that stays', () => {
  const checked = validateTransform({ kind: SPLIT, column: 'city', separator: ',', into: ['region', 'x'] }, COLUMNS);
  assert.equal(checked.ok, false);
  assert.match(checked.error, /already a column/);
});

test('merge joins columns with a separator and skips blanks', () => {
  const { rows } = run([{ id: '1', kind: MERGE, name: 'Label', columns: ['region', 'name'], separator: ' / ' }]);
  assert.equal(rows[0].Label, 'North /  alice ');
  assert.equal(rows[2].Label, 'South', 'a blank part does not leave a dangling separator');
});

test('text tidies a column in place', () => {
  const { rows, columns } = run([
    { id: '1', kind: TEXT, column: 'name', op: 'trim' },
    { id: '2', kind: TEXT, column: 'name', op: 'proper' },
  ]);
  assert.deepEqual(columns, COLUMNS, 'the shape is unchanged');
  assert.deepEqual(rows.map((r) => r.name), ['Alice', 'Bob', null, null]);
});

test('replace swaps whole values or text inside them', () => {
  const whole = run([{ id: '1', kind: REPLACE, column: 'region', find: 'North', replacement: 'N' }]);
  assert.deepEqual(whole.rows.map((r) => r.region), ['N', 'N', 'South', 'South']);
  const inside = run([{ id: '1', kind: REPLACE, column: 'city', mode: 'text', find: ', ', replacement: '|' }]);
  assert.equal(inside.rows[0].city, 'Austin|TX');
  // A number typed as text compares as a number, so it matches a number column.
  const step = planTransform({ kind: REPLACE, column: 'units', find: '5', replacement: '50' }, COLUMNS, 'T');
  assert.match(step.sql, /\[units\] = 5 THEN 50/);
});

test('fill puts a value into the blanks and nowhere else', () => {
  const { rows } = run([{ id: '1', kind: FILL, column: 'units', value: '0' }]);
  assert.deepEqual(rows.map((r) => r.units), [5, 2, 0, 0]);
  assert.equal(typeof rows[2].units, 'number', 'a fill typed as "0" is the number 0');
});

test('blanks removes rows that are blank in the named columns, or entirely', () => {
  const named = run([{ id: '1', kind: BLANKS, columns: ['units'] }]);
  assert.equal(named.rows.length, 2);
  const all = run([{ id: '1', kind: BLANKS }], [{ a: null, b: '' }, { a: 1, b: null }], ['a', 'b']);
  assert.equal(all.rows.length, 1);
});

test('dedupe removes whole-row duplicates, or keeps the first per key', () => {
  const whole = run([{ id: '1', kind: DEDUPE }]);
  assert.equal(whole.rows.length, 3);
  const byKey = run([{ id: '1', kind: DEDUPE, columns: ['region'] }]);
  assert.equal(byKey.rows.length, 2);
  assert.deepEqual(keysOf(byKey.rows).sort(), [...COLUMNS].sort(), 'every column survives');
  assert.equal(byKey.rows.find((r) => r.region === 'North').city, 'Austin, TX', 'the first row for the key');
});

test('sort and limit order the rows and keep the top', () => {
  const sorted = run([{ id: '1', kind: SORT, by: [{ column: 'revenue', direction: 'desc' }] }]);
  assert.deepEqual(sorted.rows.map((r) => r.revenue), [100, 40, 10, 10]);
  const top = run([{ id: '1', kind: LIMIT, count: 2, by: 'revenue' }]);
  assert.deepEqual(top.rows.map((r) => r.revenue), [100, 40]);
  const first = run([{ id: '1', kind: LIMIT, count: 1 }]);
  assert.equal(first.rows.length, 1);
  assert.equal(validateTransform({ kind: LIMIT, count: 0 }, COLUMNS).ok, false);
});

test('group collapses the table to one row per key with the aggregates named', () => {
  const { rows, columns, steps } = run([
    {
      id: '1',
      kind: GROUP,
      by: ['region'],
      aggregates: [
        { fn: 'SUM', column: 'revenue', name: 'Revenue' },
        { fn: 'COUNT', name: 'Orders' },
        { fn: 'COUNT_DISTINCT', column: 'city', name: 'Cities' },
        { fn: 'AVG', column: 'units', name: 'Avg units' },
      ],
    },
  ]);
  assert.deepEqual(columns, ['region', 'Revenue', 'Orders', 'Cities', 'Avg units']);
  const north = rows.find((r) => r.region === 'North');
  assert.equal(north.Revenue, 140);
  assert.equal(north.Orders, 2);
  assert.equal(north.Cities, 2);
  assert.equal(north['Avg units'], 3.5);
  // The lineage says an aggregate came from its column, and a count from nothing.
  assert.deepEqual(steps[0].lineage.Revenue, ['revenue']);
  assert.deepEqual(steps[0].lineage.Orders, []);
});

test('group refuses an aggregate that reuses a key name', () => {
  const checked = validateTransform(
    { kind: GROUP, by: ['region'], aggregates: [{ fn: 'SUM', column: 'revenue', name: 'region' }] },
    COLUMNS
  );
  assert.equal(checked.ok, false);
  assert.match(checked.error, /already a column/);
});

test('unpivot turns columns into rows and pivot turns them back', () => {
  const wide = [{ region: 'N', Jan: 1, Feb: 2 }, { region: 'S', Jan: 3, Feb: 4 }];
  const long = run(
    [{ id: '1', kind: UNPIVOT, columns: ['Jan', 'Feb'], nameColumn: 'Month', valueColumn: 'Sales' }],
    wide,
    ['region', 'Jan', 'Feb']
  );
  assert.deepEqual(long.columns, ['region', 'Month', 'Sales']);
  assert.equal(long.rows.length, 4);
  assert.deepEqual(long.rows.find((r) => r.region === 'S' && r.Month === 'Feb').Sales, 4);

  const back = run(
    [{ id: '1', kind: PIVOT, column: 'Month', measure: 'Sales', values: ['Jan', 'Feb'] }],
    long.rows,
    long.columns
  );
  assert.deepEqual(back.columns, ['region', 'Jan', 'Feb']);
  assert.deepEqual(back.rows.find((r) => r.region === 'N'), { region: 'N', Jan: 1, Feb: 2 });
});

test('pivot counts when asked to, and refuses a value that clashes with a column', () => {
  const step = planTransform({ kind: PIVOT, column: 'region', measure: 'revenue', fn: 'COUNT', values: ['North'] }, COLUMNS, 'T');
  assert.match(step.sql, /SUM\(CASE WHEN \[region\] = 'North' THEN 1 ELSE 0 END\) AS \[North\]/);
  const clash = validateTransform({ kind: PIVOT, column: 'region', measure: 'revenue', values: ['city'] }, COLUMNS);
  assert.equal(clash.ok, false);
});

test('index numbers the rows', () => {
  const { rows } = run([{ id: '1', kind: INDEX, name: 'Row' }]);
  assert.deepEqual(rows.map((r) => r.Row), [1, 2, 3, 4]);
});

/* -- the contract every kind keeps ---------------------------------------- */

const ONE_OF_EACH = [
  { kind: 'rename', column: 'region', to: 'Region' },
  { kind: 'drop', column: 'name' },
  { kind: KEEP, columns: ['region', 'revenue'] },
  { kind: 'derive', name: 'Per unit', expr: '[revenue] / [units]' },
  { kind: RETYPE, column: 'units', to: 'integer' },
  { kind: FILTER, expr: '[revenue] > 0' },
  { kind: CONDITIONAL, name: 'Big', rules: [{ when: '[revenue] > 50', then: '1' }], otherwise: '0' },
  { kind: BUCKET, name: 'Band', column: 'revenue', edges: [50] },
  { kind: DATEPART, name: 'Year', column: 'date', part: 'year' },
  { kind: SPLIT, column: 'city', separator: ',', into: ['Town', 'State'] },
  { kind: MERGE, name: 'Key', columns: ['region', 'city'], separator: '-' },
  { kind: TEXT, column: 'name', op: 'upper' },
  { kind: REPLACE, column: 'region', find: 'North', replacement: 'N' },
  { kind: FILL, column: 'units', value: 0 },
  { kind: BLANKS, columns: ['units'] },
  { kind: DEDUPE },
  { kind: SORT, by: [{ column: 'revenue', direction: 'desc' }] },
  { kind: LIMIT, count: 3 },
  { kind: GROUP, by: ['region'], aggregates: [{ fn: 'SUM', column: 'revenue', name: 'Total' }] },
  { kind: UNPIVOT, columns: ['units', 'revenue'] },
  { kind: PIVOT, column: 'region', measure: 'revenue', values: ['North', 'South'] },
  { kind: INDEX, name: 'Row' },
];

test('there is an example of every kind, and every kind is one of these', () => {
  assert.deepEqual(new Set(ONE_OF_EACH.map((o) => o.kind)), new Set(TRANSFORM_KINDS));
});

test('every kind describes itself, plans, runs, and returns the columns it promised', () => {
  for (const op of ONE_OF_EACH) {
    assert.notEqual(describeTransform(op), 'Unknown step', `${op.kind} has no description`);
    const { steps, skipped, rows, columns } = run([{ id: 'x', ...op }]);
    assert.equal(skipped.length, 0, `${op.kind} was skipped: ${skipped[0]?.reason}`);
    assert.equal(steps.length, 1);
    assert.ok(Array.isArray(rows), `${op.kind} returned no rows`);
    if (rows.length) {
      assert.deepEqual(new Set(keysOf(rows)), new Set(columns), `${op.kind} returned different columns than it planned`);
    }
    // Lineage names every output column and nothing else.
    assert.deepEqual(Object.keys(steps[0].lineage).sort(), [...columns].sort(), `${op.kind} lineage is incomplete`);
  }
});

test('every kind refuses a column that does not exist', () => {
  const none = ['nothing'];
  for (const op of ONE_OF_EACH) {
    // A step that names no column has nothing to be wrong about.
    const mentions = op.column || op.columns || op.by || op.expr || op.rules || op.measure;
    if (!mentions) continue;
    const checked = validateTransform(op, none);
    assert.equal(checked.ok, false, `${op.kind} accepted columns that are not there`);
  }
});

test('the additive kinds are the ones that add a column and change nothing else', () => {
  for (const kind of ADDITIVE_KINDS) {
    const op = ONE_OF_EACH.find((o) => o.kind === kind);
    const { rows, columns } = run([{ id: 'x', ...op }]);
    assert.equal(rows.length, ROWS.length, `${kind} changed the row count`);
    assert.ok(columns.length > COLUMNS.length, `${kind} added no column`);
    for (const c of COLUMNS) {
      assert.deepEqual(rows.map((r) => r[c]), ROWS.map((r) => r[c]), `${kind} changed ${c}`);
    }
  }
});

/* -- values on the way into SQL ------------------------------------------- */

test('a value typed into a step cannot break out of its quotes', () => {
  assert.equal(literal("O'Brien"), "'O''Brien'");
  assert.equal(literal("x'; DROP TABLE T; --"), "'x''; DROP TABLE T; --'");
  assert.equal(literal(12), '12');
  assert.equal(literal('12.5'), '12.5');
  assert.equal(literal(null), 'NULL');
  const { rows } = run([{ id: '1', kind: FILL, column: 'name', value: "it's; DROP TABLE T" }]);
  assert.equal(rows[2].name, "it's; DROP TABLE T");
});
