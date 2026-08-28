import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertEngineSelect, UnsafeQuery } from '../lib/engineSql.js';

const accepts = (sql) => assertEngineSelect(sql);
const rejects = (sql) => {
  assert.throws(() => assertEngineSelect(sql), UnsafeQuery, `should have refused: ${sql}`);
};

// ---------------------------------------------------------------------------
// The two holes in the guard this replaces.
// ---------------------------------------------------------------------------

test('a second statement is refused even when the string ends in a semicolon', () => {
  // The old check was `sql.includes(';') && !/;\s*$/.test(sql)`, which only
  // caught a semicolon that was NOT at the end — so anything ending in one
  // walked straight through.
  rejects('SELECT 1; SELECT 2;');
  rejects('SELECT 1; DROP TABLE SalesData;');
  rejects('SELECT 1; SELECT 2');
});

test('SELECT ... INTO is refused — in this engine it writes a file', () => {
  // `INTO` was absent from the old forbidden list. AlaSQL's `SELECT * INTO
  // XLSX(...)` writes a workbook.
  rejects("SELECT * INTO XLSX('out.xlsx') FROM SalesData;");
  rejects("SELECT * INTO CSV('out.csv') FROM SalesData");
  rejects('SELECT * INTO OtherTable FROM SalesData');
});

// ---------------------------------------------------------------------------
// What it must still accept — a guard that blocks real work is not a guard.
// ---------------------------------------------------------------------------

test('the queries this route exists to produce are accepted unchanged', () => {
  const real = [
    'SELECT [Region], SUM([Revenue]) AS [Total Revenue] FROM SalesData GROUP BY [Region] ORDER BY [Total Revenue] DESC LIMIT 10',
    'SELECT [Month], AVG([Units Sold]) AS [Average Units] FROM SalesData GROUP BY [Month] ORDER BY [Month] ASC',
    "SELECT [Category], SUM(CASE WHEN [Status] = 'Won' THEN [Revenue] ELSE 0 END) AS [Won] FROM SalesData GROUP BY [Category] LIMIT 20",
  ];
  for (const sql of real) assert.equal(accepts(sql), sql);
});

test('a trailing semicolon is stripped rather than refused', () => {
  assert.equal(accepts('SELECT [A], COUNT(*) AS [N] FROM SalesData GROUP BY [A];'), 'SELECT [A], COUNT(*) AS [N] FROM SalesData GROUP BY [A]');
});

test('a semicolon inside a string literal is not a second statement', () => {
  // The old check rejected this outright — a false positive, because it never
  // looked inside quoted text. Stripping literals before matching is what the
  // connector guard already got right.
  const sql = "SELECT [Note] FROM SalesData WHERE [Note] = 'first; second'";
  assert.equal(accepts(sql), sql);
});

test('an ordinary column name is not mistaken for a keyword', () => {
  // The old forbidden list matched these words anywhere in the query, so a
  // column called "source" or "update" made a legitimate question fail.
  for (const column of ['source', 'attach', 'update', 'replace', 'assert', 'require']) {
    const sql = `SELECT [${column}], COUNT(*) AS [N] FROM SalesData GROUP BY [${column}]`;
    assert.equal(accepts(sql), sql, `"${column}" is a fine column name`);
  }
});

// ---------------------------------------------------------------------------
// Everything the shared connector guard already refuses, still refused here.
// ---------------------------------------------------------------------------

test('anything that is not a single read-only SELECT is refused', () => {
  for (const sql of [
    '',
    '   ',
    'DROP TABLE SalesData',
    'DELETE FROM SalesData',
    'UPDATE SalesData SET x = 1',
    'CREATE TABLE t (a int)',
    'TRUNCATE TABLE SalesData',
    'WITH x AS (DELETE FROM SalesData RETURNING *) SELECT * FROM x',
    'SELECT * FROM SalesData FOR UPDATE',
  ]) {
    rejects(sql);
  }
});

test('a CTE is refused, because this engine has none', () => {
  // The connector guard allows WITH — right for a real database, wrong here.
  // The prompt tells the model CTEs are unsupported, so one coming back means
  // it ignored its instructions, not that there is a query worth running.
  rejects('WITH totals AS (SELECT 1 AS n) SELECT * FROM totals');
});

test('a refusal explains itself', () => {
  // The reason reaches the user as the "unavailable" text on the Ask page, so
  // it has to say something they can act on.
  for (const sql of ['SELECT 1; SELECT 2;', "SELECT * INTO CSV('x') FROM SalesData", 'DROP TABLE t']) {
    try {
      assertEngineSelect(sql);
      assert.fail(`should have refused: ${sql}`);
    } catch (error) {
      assert.ok(error instanceof UnsafeQuery);
      assert.ok(error.message.length > 10, 'the reason is a sentence, not a code');
    }
  }
});

test('the ask route keeps no second copy of these rules', () => {
  // The point of the change: one guard, not two that disagree. The route file
  // imports the LLM SDKs and next/server, so it cannot be imported here.
  const source = readFileSync(new URL('../app/api/ask/route.js', import.meta.url), 'utf8');
  assert.match(source, /assertEngineSelect\(/, 'the route uses the shared guard');
  assert.ok(!/const FORBIDDEN\s*=/.test(source), 'and no longer keeps its own forbidden list');
  assert.ok(
    !/includes\(';'\)/.test(source),
    'nor its own semicolon check, which was the half that did not work'
  );
});
