import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDashboard, summaryOf } from '../lib/engine/planner.js';
import { readDataset } from '../lib/engine/fields.js';
import { buildMeasures } from '../lib/engine/measures.js';
import { retrieve, search, HELP } from '../lib/assistant/retrieve.js';
import { checkAction } from '../lib/assistant/actions.js';
import { readCommand, matchTile } from '../lib/assistant/local.js';

const rows = Array.from({ length: 240 }, (_, i) => ({
  order_date: `2025-${String(1 + (i % 12)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`,
  region: ['North', 'South', 'East', 'West'][i % 4],
  product: `P${i % 9}`,
  units: 1 + (i % 6),
  revenue: 20 + ((i * 37) % 400),
}));
const board = buildDashboard(rows, { name: 'orders.csv' });
const ds = readDataset(rows, { name: 'orders.csv' });
const engine = { ds: summaryOf ? summaryOf(ds) : board.ds, measures: buildMeasures(rows, ds) };
const state = { board, engine, filters: [], dataset: { fileName: 'orders.csv', rowCount: rows.length, columns: Object.keys(rows[0]), transforms: [] }, pathname: '/dashboard' };
const tiles = board.sections.flatMap((s) => s.tiles);

test('help questions find the right page', () => {
  assert.equal(search(HELP, 'how do I download a powerpoint')[0].id, 'help:report');
  assert.equal(search(HELP, 'change a chart type')[0].id, 'help:edit');
  assert.equal(search(HELP, 'where do I upload my csv')[0].id, 'help:upload');
});

test('questions about the data retrieve the data', () => {
  const hits = retrieve('what does the region column hold', state);
  assert.ok(hits.some((h) => h.id === 'field:region'), hits.map((h) => h.id).join(','));
  assert.ok(hits.some((h) => h.id === 'data:table'));
});

test('commands become checked actions', () => {
  const nav = readCommand('go to the report', state).actions[0];
  assert.deepEqual(checkAction(nav, state).action, { type: 'navigate', path: '/report' });

  const f = readCommand('filter region to West', state).actions[0];
  assert.deepEqual(checkAction(f, state).action.filter, { field: 'region', values: ['West'] });

  const only = readCommand('only show North', state).actions[0];
  assert.deepEqual(only, { type: 'set_filter', field: 'region', values: ['North'] });

  const t = tiles[0];
  const rm = readCommand(`remove the ${t.title} chart`, state).actions[0];
  assert.equal(checkAction(rm, state).action.id, t.id);

  assert.equal(readCommand('drop the units column', state).actions[0].type, 'transform');
  assert.equal(readCommand('add revenue by product', state).actions[0].question, 'revenue by product');
  assert.equal(readCommand('clear filters', state).actions[0].type, 'clear_filters');
});

test('only chart types the data supports are accepted', () => {
  const trend = tiles.find((t) => t.kind === 'trend');
  assert.ok(trend);
  const bad = checkAction({ type: 'edit_chart', id: trend.id, patch: { viz: 'scatter' } }, state);
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /can't show/);
  const ok = checkAction({ type: 'edit_chart', id: trend.id, patch: { viz: 'area' } }, state);
  assert.equal(ok.ok, true);
});

test('made-up columns, measures and pages are refused', () => {
  assert.equal(checkAction({ type: 'set_filter', field: 'ghost', values: ['x'] }, state).ok, false);
  assert.equal(checkAction({ type: 'add_kpi', measure: 'profit' }, state).ok, false);
  assert.equal(checkAction({ type: 'navigate', page: 'admin' }, state).ok, false);
  assert.equal(checkAction({ type: 'set_field', field: 'region', role: 'measure' }, state).ok, false);
  assert.equal(checkAction({ type: 'delete_everything' }, state).ok, false);
  assert.equal(checkAction({ type: 'remove_chart', id: 'nope' }, state).ok, false);
});

test('a measure proposal becomes a measure the engine understands', () => {
  const r = checkAction({ type: 'add_measure', label: 'Revenue per unit', kind: 'ratio', field: 'revenue', per: 'units', format: 'currency' }, state);
  assert.equal(r.ok, true);
  assert.equal(r.action.measure.type, 'ratio');
  assert.equal(r.action.measure.den.field, 'units');
  const rate = checkAction({ type: 'add_measure', label: 'West share', kind: 'rate', where: { field: 'region', value: 'West' } }, state);
  assert.equal(rate.action.measure.type, 'rate');
});

test('a read-only dashboard is not changed', () => {
  const ro = { ...state, board: { ...board, readOnly: true } };
  assert.equal(checkAction({ type: 'remove_chart', id: tiles[0].id }, ro).ok, false);
});

test('chart names are matched loosely', () => {
  assert.equal(matchTile(board, tiles[0].title.toLowerCase())?.id, tiles[0].id);
  assert.equal(matchTile(board, 'zzz qqq'), null);
});

test('questions about the columns are answered from the table itself', () => {
  const r = readCommand('what columns does my data have?', state);
  assert.match(r.reply, /Region — category/);
  assert.match(readCommand('how many rows are there', state).reply, /240 rows/);
});

test('a demo dataset can be loaded by asking', () => {
  const none = { board: null, engine: null, dataset: null };
  const a = readCommand('add a demo dataset', none).actions[0];
  assert.deepEqual(checkAction(a, none).action, { type: 'load_sample', key: 'retail' });
  assert.equal(checkAction(readCommand('load the churn sample', none).actions[0], none).action.key, 'churn');
  assert.equal(checkAction({ type: 'load_sample', sample: 'nope' }, none).ok, false);
});

test('data prep asked in plain words becomes a transform, chart asks do not', () => {
  const dataset = { columns: ['order_date', 'region', 'revenue', 'discount', 'notes'] };
  const type = (q) => readCommand(q, { dataset })?.actions?.[0]?.type;
  for (const q of ['please rename region to area', 'can you remove duplicates', 'I want to drop the notes column', 'delete notes column', 'make a column profit = revenue - discount', 'change discount to text']) {
    assert.equal(type(q), 'transform', q);
  }
  for (const q of ['show revenue by region', 'remove the revenue chart', 'go to the dashboard']) assert.notEqual(type(q), 'transform', q);
});
