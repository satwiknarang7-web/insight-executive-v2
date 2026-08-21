import test from 'node:test';
import assert from 'node:assert/strict';
import { quoteIdent, quoteQualified } from '../lib/connectors/dialect.js';

test('each dialect uses its own delimiters', () => {
  assert.equal(quoteIdent('postgres', 'orders'), '"orders"');
  assert.equal(quoteIdent('supabase', 'orders'), '"orders"');
  assert.equal(quoteIdent('mysql', 'orders'), '`orders`');
  assert.equal(quoteIdent('sqlserver', 'orders'), '[orders]');
});

test('a name carrying the closing delimiter cannot escape the quotes', () => {
  // Without doubling, each of these would end the identifier early and leave
  // the rest of the string as executable SQL.
  assert.equal(quoteIdent('postgres', 'a"; drop table t --'), '"a""; drop table t --"');
  assert.equal(quoteIdent('mysql', 'a`; drop table t --'), '`a``; drop table t --`');
  assert.equal(quoteIdent('sqlserver', 'a]; drop table t --'), '[a]]; drop table t --]');
});

test('the opening bracket is harmless in SQL Server', () => {
  // Only ] terminates the identifier, so [ needs no escaping.
  assert.equal(quoteIdent('sqlserver', 'a[b'), '[a[b]');
});

test('a null byte is refused rather than quoted', () => {
  // Some client libraries treat NUL as end-of-string and would silently
  // truncate the statement there.
  assert.throws(() => quoteIdent('postgres', 'orders\u0000extra'), /null byte/);
});

test('an empty identifier is refused', () => {
  assert.throws(() => quoteIdent('postgres', ''), /cannot be empty/);
  assert.throws(() => quoteIdent('postgres', null), /cannot be empty/);
});

test('an unknown dialect fails loudly instead of guessing', () => {
  // Guessing a delimiter would produce SQL that is valid for some other
  // database and silently wrong for this one.
  assert.throws(() => quoteIdent('mongodb', 'orders'), /No quoting rules/);
  assert.throws(() => quoteIdent(undefined, 'orders'), /No quoting rules/);
});

test('Oracle and Snowflake quote like Postgres and preserve case', () => {
  // Both fold unquoted identifiers to upper case, so quoting is what makes a
  // mixed-case table reachable at all.
  assert.equal(quoteIdent('oracle', 'Orders'), '"Orders"');
  assert.equal(quoteIdent('snowflake', 'Orders'), '"Orders"');
  assert.equal(quoteQualified('oracle', 'HR', 'EMPLOYEES'), '"HR"."EMPLOYEES"');
  assert.equal(quoteIdent('oracle', 'a"; drop table t --'), '"a""; drop table t --"');
});

test('qualified names quote both halves', () => {
  assert.equal(quoteQualified('postgres', 'public', 'orders'), '"public"."orders"');
  assert.equal(quoteQualified('mysql', 'shop', 'orders'), '`shop`.`orders`');
  assert.equal(quoteQualified('sqlserver', 'dbo', 'orders'), '[dbo].[orders]');
});

test('ordinary names survive unchanged apart from the quotes', () => {
  assert.equal(quoteIdent('postgres', 'Order_Items 2026'), '"Order_Items 2026"');
  assert.equal(quoteIdent('mysql', 'order items'), '`order items`');
});
