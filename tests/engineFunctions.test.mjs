/**
 * The functions a formula can call, and what they do with a blank.
 *
 * alasql's own UPPER throws on null and its YEAR answers 1970. Every function
 * registered here answers a blank with a blank, and that is what these tests
 * pin — plus the reading of messy numbers, since "1,234" and "(45)" and "$12"
 * are what a column of numbers looks like when it arrives as text.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import alasql from 'alasql';

import { FUNCTIONS, FUNCTION_NAMES, registerEngineFunctions, toDate, toNumber } from '../lib/engineFunctions.js';

const F = FUNCTIONS;

test('every text function answers a blank with a blank instead of throwing', () => {
  for (const name of ['UPPER', 'LOWER', 'TRIM', 'PROPER', 'LEN', 'LENGTH', 'TO_TEXT']) {
    assert.equal(F[name](null), null, `${name}(null)`);
    assert.equal(F[name](undefined), null, `${name}(undefined)`);
    assert.equal(F[name](''), null, `${name}('')`);
  }
  assert.equal(F.SUBSTRING(null, 1, 2), null);
  assert.equal(F.REPLACE(null, 'a', 'b'), null);
  assert.equal(F.SPLIT_PART(null, ',', 1), null);
  assert.equal(F.INSTR(null, ','), null);
});

test('proper case handles the names people actually have', () => {
  assert.equal(F.PROPER("o'neil mcdonald-smith"), "O'Neil Mcdonald-Smith");
  assert.equal(F.PROPER('  new   york '), '  New   York ');
  assert.equal(F.PROPER('ÉLODIE'), 'Élodie');
});

test('substring and split are one-based, the way SQL counts', () => {
  assert.equal(F.SUBSTRING('Austin', 1, 3), 'Aus');
  assert.equal(F.SUBSTRING('Austin', 4), 'tin');
  assert.equal(F.SPLIT_PART('a, b, c', ',', 2), 'b');
  assert.equal(F.SPLIT_PART('a, b', ',', 3), null, 'a piece past the end is nothing, not an error');
  assert.equal(F.TEXT_BEFORE('Austin, TX', ','), 'Austin');
  assert.equal(F.TEXT_AFTER('a.b.c', '.'), 'c', 'after the LAST separator');
  assert.equal(F.TEXT_AFTER('abc', '.'), null);
});

test('joining text skips blanks so there is no dangling separator', () => {
  assert.equal(F.TEXT_JOIN(', ', 'Austin', null, 'TX'), 'Austin, TX');
  assert.equal(F.TEXT_JOIN(', ', null, ''), null);
  assert.equal(F.CONCAT('a', null, 'b'), 'ab');
});

test('reading a number from text handles the ways people write them', () => {
  assert.equal(toNumber('1,234.50'), 1234.5);
  assert.equal(toNumber('$12'), 12);
  assert.equal(toNumber('€1 234'), 1234);
  assert.equal(toNumber('(45)'), -45, 'accounting negatives');
  assert.equal(toNumber('12%'), 12);
  assert.equal(toNumber('USD 99.9'), 99.9);
  assert.equal(toNumber('n/a'), null, 'not zero');
  assert.equal(toNumber(''), null);
  assert.equal(toNumber(null), null);
  assert.equal(toNumber(7), 7);
  assert.equal(toNumber(Infinity), null);
  assert.equal(F.TO_INTEGER('12.9'), 12);
});

test('arithmetic helpers refuse the cases that produce Infinity or NaN', () => {
  assert.equal(F.SAFE_DIVIDE(10, 0), null);
  assert.equal(F.SAFE_DIVIDE(10, null), null);
  assert.equal(F.SAFE_DIVIDE(10, 4), 2.5);
  assert.equal(F.SQRT(-1), null);
  assert.equal(F.LOG(0), null);
  assert.equal(F.ROUND('12.345', 2), 12.35);
  assert.equal(F.ROUND(null, 2), null);
  assert.equal(F.GREATEST(1, null, 5), 5);
  assert.equal(F.LEAST(null, null), null);
});

test('date parts read the ISO strings the cleaner writes, at UTC', () => {
  const d = '2024-03-15T00:00:00.000Z';
  assert.equal(F.YEAR(d), 2024);
  assert.equal(F.MONTH(d), 3);
  assert.equal(F.DAY(d), 15);
  assert.equal(F.QUARTER(d), 1);
  assert.equal(F.DAYOFWEEK(d), 6, 'Friday, counted from Sunday = 1');
  assert.equal(F.WEEKDAY_NAME(d), 'Friday');
  assert.equal(F.MONTH_NAME(d), 'March');
  assert.equal(F.YEAR_MONTH(d), '2024-03');
  assert.equal(F.YEAR_QUARTER(d), '2024-Q1');
  assert.equal(F.DATE_ONLY('2024-03-15T23:59:00.000Z'), '2024-03-15');
  assert.equal(F.DAYS_BETWEEN(d, '2024-03-20'), 5);
  assert.equal(F.MONTHS_BETWEEN(d, '2025-01-01'), 10);
  assert.equal(F.ADD_DAYS('2024-03-15', 1), '2024-03-16T00:00:00.000Z');
});

test('a blank or unreadable date is nothing, not 1970', () => {
  for (const name of ['YEAR', 'MONTH', 'DAY', 'QUARTER', 'WEEKDAY_NAME', 'MONTH_NAME', 'YEAR_MONTH', 'DATE_ONLY']) {
    assert.equal(F[name](null), null, `${name}(null)`);
    assert.equal(F[name]('not a date'), null, `${name}('not a date')`);
  }
  assert.equal(toDate('2024-03-15').toISOString(), '2024-03-15T00:00:00.000Z', 'a bare date is read at UTC');
  assert.equal(toDate(2024).getUTCFullYear(), 2024, 'a bare year is a year');
});

test('conversions to date give the cleaner\'s own format', () => {
  assert.equal(F.TO_DATE('2024-03-15'), '2024-03-15T00:00:00.000Z');
  assert.equal(F.TO_DATE('March 15, 2024').slice(0, 10), '2024-03-15');
  assert.equal(F.TO_DATE(''), null);
});

test('registered on alasql, the null-safe versions win over the built-ins', () => {
  registerEngineFunctions(alasql);
  alasql.tables.Fx = { data: [{ s: null, d: null, n: '1,5' }] };
  const [row] = alasql('SELECT UPPER([s]) AS [u], YEAR([d]) AS [y], TO_NUMBER([n]) AS [n] FROM Fx');
  delete alasql.tables.Fx;
  assert.equal(row.u, null);
  assert.equal(row.y, null, 'not 1970');
  assert.equal(row.n, 15);
});

test('the validator sees exactly the functions the engine has', () => {
  assert.ok(FUNCTION_NAMES.includes('SPLIT_PART'));
  assert.ok(FUNCTION_NAMES.includes('YEAR_MONTH'));
  assert.equal(FUNCTION_NAMES.length, Object.keys(FUNCTIONS).length);
});
