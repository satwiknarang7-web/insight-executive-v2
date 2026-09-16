/**
 * The "Get data" catalog: everything the app can load from, in one list.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { acceptFor, allSources, searchSources, sourceById, sourceGroups } from '../lib/sources.js';
import { availableConnectors } from '../lib/connectors/registry.js';
import { WEB_SOURCES } from '../lib/webSources.js';

test('every shipped connector and every web source is in the catalog, once', () => {
  const ids = allSources().map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, 'a source id repeats');
  for (const c of availableConnectors()) assert.ok(ids.includes(c.id), `${c.id} is missing from the catalog`);
  for (const w of WEB_SOURCES) assert.ok(ids.includes(w.id), `${w.id} is missing from the catalog`);
});

test('each source knows what kind of thing it is', () => {
  for (const s of allSources()) {
    assert.ok(['file', 'paste', 'web', 'connector'].includes(s.kind), `${s.id} has kind ${s.kind}`);
    assert.ok(s.label && s.blurb, `${s.id} is missing text`);
    if (s.kind === 'connector') assert.equal(s.connector, s.id);
    if (s.kind === 'web') assert.equal(s.web, s.id);
  }
});

test('the groups are the ones the page shows, and none is empty', () => {
  const groups = sourceGroups();
  assert.deepEqual(groups.map((g) => g.id), ['files', 'web', 'databases', 'warehouses', 'services']);
  for (const g of groups) assert.ok(g.items.length > 0, `${g.id} is empty`);
  assert.ok(groups.find((g) => g.id === 'warehouses').items.some((i) => i.id === 'snowflake'));
  assert.ok(groups.find((g) => g.id === 'services').items.some((i) => i.id === 'airtable'));
});

test('search finds a source by label, by keyword, and ranks the label match first', () => {
  assert.equal(searchSources('parquet')[0].id, 'parquet');
  assert.equal(searchSources('google')[0].id, 'googlesheets');
  assert.ok(searchSources('presto').some((s) => s.id === 'trino'), 'a keyword finds Trino');
  assert.ok(searchSources('aurora').some((s) => s.id === 'rds-postgres'));
  assert.equal(searchSources('postgres')[0].id, 'postgres', 'the label match outranks the flavours');
  assert.deepEqual(searchSources('xyzzy'), []);
  assert.equal(searchSources('').length, allSources().length);
});

test('a file source says which files it takes, and the drop zone takes all of them', () => {
  assert.match(acceptFor('parquet'), /\.parquet/);
  assert.match(acceptFor('sqlite'), /\.db/);
  const all = acceptFor();
  for (const ext of ['.csv', '.xlsx', '.json', '.xml', '.parquet', '.sqlite', '.pdf']) assert.ok(all.includes(ext), `${ext} not accepted`);
  assert.equal(sourceById('document').needs, 'model');
  assert.equal(sourceById('nope'), null);
});
