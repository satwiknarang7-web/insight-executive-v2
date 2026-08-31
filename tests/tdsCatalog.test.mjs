import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/* The catalog query, spelled for a case-sensitive server.
 *
 * A Fabric warehouse is created with `Latin1_General_100_BIN2_UTF8` — binary,
 * and so case-sensitive for object and column names. Against it,
 * `information_schema.tables` came back as "Invalid object name", immediately
 * after a connection that had just succeeded: `testConnection` uses built-in
 * functions, which are keywords and not collation-sensitive, so the failure
 * appeared only at the point of listing tables.
 *
 * Read from the source because the driver needs a live server to run, and the
 * spelling is the whole of the fix. */

const source = readFileSync(
  fileURLToPath(new URL('../lib/connectors/tds.server.js', import.meta.url)),
  'utf8'
);

/** The file minus its comments, so prose about the bug cannot satisfy a test. */
const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('the catalog is queried in the case the catalog declares', () => {
  assert.match(code, /from INFORMATION_SCHEMA\.TABLES/);
  assert.doesNotMatch(code, /from information_schema/);
});

test('and so are the columns read from it', () => {
  for (const column of ['TABLE_SCHEMA', 'TABLE_NAME', 'TABLE_TYPE']) {
    assert.match(code, new RegExp(column), `${column} is selected in capitals`);
  }
  // The lowercase spellings must not survive anywhere in the executed SQL.
  for (const lower of ['table_schema', 'table_name', 'table_type']) {
    assert.doesNotMatch(code, new RegExp(`\b${lower}\b`), `${lower} still appears`);
  }
});

test('our own aliases stay lowercase, because we read them back', () => {
  // `as [schema]` is the name this code destructures; it is not a catalog name
  // and must not be swept up in the uppercasing.
  assert.match(code, /as \[schema\]/);
  assert.match(code, /as \[name\]/);
  assert.match(code, /as \[type\]/);
});
