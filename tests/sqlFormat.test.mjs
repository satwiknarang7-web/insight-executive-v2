import test from 'node:test';
import assert from 'node:assert/strict';
import { formatSql } from '../lib/sqlFormat.js';

test('a one-line query is broken at its clauses', () => {
  const out = formatSql(
    'SELECT [Region], SUM([Revenue]) AS [Total Revenue] FROM SalesData GROUP BY [Region] ORDER BY [Total Revenue] DESC LIMIT 10'
  );
  assert.equal(
    out,
    [
      'SELECT [Region],',
      '       SUM([Revenue]) AS [Total Revenue]',
      'FROM SalesData',
      'GROUP BY [Region]',
      'ORDER BY [Total Revenue] DESC',
      'LIMIT 10',
    ].join('\n')
  );
});

test('no line is long enough to need scrolling sideways', () => {
  const out = formatSql(
    'SELECT [Customers.Region], [Orders.Category], SUM([Orders.Revenue]) AS [Total Revenue] ' +
      "FROM SalesData WHERE [Customers.Region] = 'North America' GROUP BY [Customers.Region], [Orders.Category] " +
      'ORDER BY [Total Revenue] DESC LIMIT 50'
  );
  for (const line of out.split('\n')) {
    assert.ok(line.length <= 72, `line still runs long: ${line}`);
  }
});

test('formatting only adds whitespace — the query itself is untouched', () => {
  const sql =
    "SELECT [Region], AVG([Unit Price]) AS [Average Unit Price] FROM SalesData WHERE [Region] <> 'N/A' GROUP BY [Region]";
  const squash = (s) => s.replace(/\s+/g, ' ').trim();
  assert.equal(squash(formatSql(sql)), squash(sql));
});

test('a comma inside a function call is not a new select item', () => {
  const out = formatSql('SELECT ROUND(AVG([Score]), 2) AS [Mean] FROM SalesData');
  assert.equal(out, 'SELECT ROUND(AVG([Score]), 2) AS [Mean]\nFROM SalesData');
});

test('clause words inside a bracketed name or a string are left alone', () => {
  // A column genuinely called "Order From Warehouse", and a value containing
  // the word "where". Splitting on either would corrupt the query on screen.
  const sql = "SELECT [Order From Warehouse] FROM SalesData WHERE [Note] = 'ask where it shipped'";
  const out = formatSql(sql);
  assert.equal(out, "SELECT [Order From Warehouse]\nFROM SalesData\nWHERE [Note] = 'ask where it shipped'");
});

test('a word that merely starts with a clause name is not a clause', () => {
  const out = formatSql('SELECT [Selection], [Grouping] FROM SalesData');
  assert.equal(out, 'SELECT [Selection],\n       [Grouping]\nFROM SalesData');
});

test('a long CASE is broken at its WHENs rather than left on one line', () => {
  const out = formatSql(
    'SELECT CASE WHEN [Age] < 30 THEN \'under 30\' WHEN [Age] < 60 THEN \'30-59\' ELSE \'60+\' END AS [Band], ' +
      'COUNT(*) AS [Count] FROM SalesData GROUP BY [Band]'
  );
  const lines = out.split('\n');
  assert.ok(lines.length > 4, 'the CASE is spread out');
  assert.ok(
    lines.some((l) => l.trim().startsWith('WHEN [Age] < 60')),
    'each WHEN starts a line'
  );
  assert.ok(lines.some((l) => l.trim().startsWith('END AS [Band]')));
});

test('a multi-word join keyword is not split in half', () => {
  const out = formatSql('SELECT * FROM a LEFT OUTER JOIN b ON a.id = b.id');
  assert.ok(out.includes('LEFT OUTER JOIN b ON a.id = b.id'));
  assert.ok(!out.includes('\nJOIN'), 'JOIN did not start a second line of its own');
});

test('nothing recognisable is returned unchanged rather than mangled', () => {
  assert.equal(formatSql(''), '');
  assert.equal(formatSql(null), '');
  assert.equal(formatSql('   '), '');
  assert.equal(formatSql('not really sql at all'), 'not really sql at all');
});
