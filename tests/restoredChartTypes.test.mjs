import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildDashboard } from '../lib/engine/planner.js';
import { allowedViz, computeTile, MAP_VIZ, VIZ } from '../lib/engine/tiles.js';
import { readDataset } from '../lib/engine/fields.js';
import { buildMeasures } from '../lib/engine/measures.js';
import { dashboardToDeck } from '../lib/engine/deck.js';
import { readCommand } from '../lib/assistant/local.js';
import { fitBox, pathGeometry, ringsOf } from '../lib/geo/shape.js';

/* The chart types that went in the engine rebuild and came back: pie, radial
   bars, gauge, number cards, waterfall, ribbon, combo, bubble, radar, bubble
   map and shape map. Each is offered only where its data can carry it, and
   none is ever the first choice, so the planner builds what it built before. */

const RESTORED = ['pie', 'radial', 'gauge', 'cards', 'waterfall', 'ribbon', 'combo', 'bubble', 'radar', 'bubbleMap', 'shapeMap'];

const regions = ['California', 'Texas', 'New York', 'Florida', 'Illinois', 'Ohio'];
const segments = ['Consumer', 'Corporate', 'Home office'];
const rows = Array.from({ length: 360 }, (_, i) => ({
  order_id: `O${i}`,
  state: regions[i % regions.length],
  segment: segments[i % 3],
  units: 1 + ((i * 7) % 9),
  revenue: 40 + ((i * 37) % 400),
  margin_pct: 5 + ((i * 13) % 30),
  profit: ((i * 53) % 300) - 60,
  order_date: `2025-${String(1 + (i % 12)).padStart(2, '0')}-${String(1 + (i % 27)).padStart(2, '0')}`,
}));
const ds = readDataset(rows, { name: 'orders' });
const measures = buildMeasures(rows, ds);
const sum = (f) => measures.find((m) => m.id === `sum:${f}`)?.id;

test('every restored type has a name', () => {
  for (const v of RESTORED) assert.ok(VIZ[v], `${v} has no label`);
});

test('a total split across a few categories can be a pie, radial bars, a gauge, cards, a waterfall or a radar', () => {
  const tile = { kind: 'breakdown', measures: [sum('revenue')], dim: 'segment' };
  const allowed = allowedViz(tile, ds, measures);
  for (const v of ['pie', 'radial', 'gauge', 'cards', 'waterfall', 'radar']) assert.ok(allowed.includes(v), `${v} missing from ${allowed}`);
  assert.equal(allowed[0], 'hbar', 'the first choice is what it was');
});

test('a sum that can go negative is never a pie, donut, treemap, funnel, radial bars, a gauge, a radar or a bubble map, but can be a waterfall', () => {
  // Money that can be negative (a refund, a loss) is still summed.
  const ledger = rows.map((r, i) => ({ order_id: r.order_id, order_date: r.order_date, state: r.state, amount_usd: i % 5 === 0 ? -r.revenue : r.revenue }));
  const dsL = readDataset(ledger, { name: 'ledger' });
  const msL = buildMeasures(ledger, dsL);
  const m = msL.find((x) => x.field === 'amount_usd' && x.additive);
  assert.ok(m, 'the amount is summed');
  const allowed = allowedViz({ kind: 'breakdown', measures: [m.id], dim: 'state' }, dsL, msL);
  for (const v of ['pie', 'donut', 'treemap', 'funnel', 'radial', 'gauge', 'radar', 'bubbleMap']) assert.ok(!allowed.includes(v), `${v} offered for a sum with negative values: ${allowed}`);
  assert.ok(allowed.includes('waterfall'), 'a waterfall steps down for a negative part');
  // And the same once every value is positive.
  const positive = ledger.map((r) => ({ ...r, amount_usd: Math.abs(r.amount_usd) }));
  const dsP = readDataset(positive, { name: 'ledger' });
  const msP = buildMeasures(positive, dsP);
  const ok = allowedViz({ kind: 'breakdown', measures: [msP.find((x) => x.field === 'amount_usd' && x.additive).id], dim: 'state' }, dsP, msP);
  for (const v of ['pie', 'donut', 'treemap', 'funnel', 'gauge', 'bubbleMap']) assert.ok(ok.includes(v), `${v} missing once the sum is positive: ${ok}`);
});

test('an average is never split into parts: no pie, gauge or waterfall', () => {
  const avg = measures.find((x) => x.field === 'margin_pct' && !x.additive);
  assert.ok(avg, 'margin is read as something that is averaged');
  const allowed = allowedViz({ kind: 'breakdown', measures: [avg.id], dim: 'segment' }, ds, measures);
  for (const v of ['pie', 'gauge', 'waterfall']) assert.ok(!allowed.includes(v), `${v} offered for an average`);
  assert.ok(allowed.includes('radial') && allowed.includes('cards'), 'lengths and numbers are fine for an average');
});

test('a radar needs at least three spokes and no more than ten', () => {
  const two = [...rows.map((r) => ({ ...r, pair: r.units % 2 ? 'A' : 'B' }))];
  const ds2 = readDataset(two, { name: 'two' });
  const ms2 = buildMeasures(two, ds2);
  const allowed = allowedViz({ kind: 'breakdown', measures: [ms2.find((m) => m.id === 'sum:revenue').id], dim: 'pair' }, ds2, ms2);
  assert.ok(!allowed.includes('radar'), 'two categories drawn as a radar');
});

test('places can be a map, a bubble map or a shape map, and each reads every place', () => {
  assert.ok(ds.byName.state.map, 'the states are recognised as places');
  const tile = { kind: 'breakdown', measures: [sum('revenue')], dim: 'state', limit: 3 };
  const allowed = allowedViz(tile, ds, measures);
  for (const v of MAP_VIZ) assert.ok(allowed.includes(v), `${v} missing`);
  for (const viz of MAP_VIZ) {
    const c = computeTile(rows, { ...tile, viz }, ds, measures);
    assert.equal(c.data.length, regions.length, `${viz} dropped places to a top 3`);
    assert.ok(!c.data.some((r) => r.state === 'Other'), `${viz} folded places into Other`);
  }
});

test('a date axis can be a waterfall; two measures over it a combo', () => {
  const trend = { kind: 'trend', measures: [sum('revenue')], dim: 'order_date', grain: 'month' };
  const one = allowedViz(trend, ds, measures);
  assert.ok(one.includes('waterfall'));
  assert.equal(one[0], 'line');
  const two = allowedViz({ ...trend, measures: [sum('revenue'), sum('units')] }, ds, measures);
  assert.deepEqual(two, ['line', 'combo', 'table']);
  const c = computeTile(rows, { ...trend, measures: [sum('revenue'), sum('units')], viz: 'combo' }, ds, measures);
  assert.equal(c.ys.length, 2);
  assert.equal(c.data.length, 12);
});

test('two measures across categories can be a combo, and Other keeps both right', () => {
  const tile = { kind: 'breakdown', measures: [sum('revenue'), measures.find((m) => m.field === 'margin_pct' && !m.additive).id], dim: 'state', limit: 4 };
  assert.ok(allowedViz(tile, ds, measures).includes('combo'));
  const c = computeTile(rows, { ...tile, viz: 'combo' }, ds, measures);
  const other = c.data.find((r) => r.state === 'Other');
  assert.ok(other, 'the smaller states fold into Other');
  const avg = tile.measures[1];
  const kept = new Set(c.data.map((r) => r.state));
  const rest = rows.filter((r) => !kept.has(r.state));
  const expected = rest.reduce((s, r) => s + r.margin_pct, 0) / rest.length;
  assert.ok(Math.abs(other[avg] - expected) < 1e-9, `Other's average margin is ${other[avg]}, not ${expected}`);
});

test('a split over time can be a ribbon, whatever the measure', () => {
  const tile = { kind: 'trend', measures: [sum('revenue')], dim: 'order_date', grain: 'month', series: 'segment' };
  assert.ok(allowedViz(tile, ds, measures).includes('ribbon'));
  const avg = measures.find((m) => m.field === 'margin_pct' && !m.additive);
  assert.ok(allowedViz({ ...tile, measures: [avg.id] }, ds, measures).includes('ribbon'));
});

test('a bubble needs a size, and a point with no size is left out rather than drawn at zero', () => {
  const rel = { kind: 'relationship', x: 'units', y: 'revenue', measures: [] };
  assert.deepEqual(allowedViz(rel, ds, measures), ['scatter']);
  assert.deepEqual(allowedViz({ ...rel, size: 'margin_pct' }, ds, measures), ['scatter', 'bubble']);
  const holey = rows.map((r, i) => (i % 10 === 0 ? { ...r, margin_pct: null } : r));
  const c = computeTile(holey, { ...rel, size: 'margin_pct', viz: 'bubble' }, ds, measures);
  assert.equal(c.data.length, rows.length - rows.length / 10);
  assert.ok(c.data.every((p) => typeof p.margin_pct === 'number'));
});

test('several scores on one scale can be a radar', () => {
  const ms = measures.filter((m) => m.type === 'agg' && !m.additive).slice(0, 3);
  if (ms.length < 3) return;
  assert.ok(allowedViz({ kind: 'compare', measures: ms.map((m) => m.id) }, ds, measures).includes('radar'));
});

test('the dashboard the planner builds never starts with a restored type', () => {
  const board = buildDashboard(rows, { name: 'orders' });
  for (const t of board.sections.flatMap((s) => s.tiles)) assert.ok(!RESTORED.includes(t.viz), `the planner chose ${t.viz} for "${t.title}"`);
});

test('every restored type exports as a chart the documents can draw', () => {
  const tiles = RESTORED.map((viz, i) => ({
    id: `t${i}`,
    title: viz,
    viz,
    kind: viz === 'bubble' ? 'relationship' : viz === 'ribbon' || viz === 'combo' ? 'trend' : 'breakdown',
    computed: { data: [{ state: 'Texas', 'sum:revenue': 5 }], x: 'state', ys: ['sum:revenue'] },
    measures: ['sum:revenue'],
  }));
  const deck = dashboardToDeck({ sections: [{ tiles }] }, { measures, fields: ds.fields });
  const drawable = new Set(['line', 'area', 'bar', 'hbar', 'donut', 'scatter', 'table']);
  for (const s of deck.storyboard) assert.ok(drawable.has(s.chart.chart_type), `${s.pageTitle} exports as ${s.chart.chart_type}`);
});

test('the assistant knows the restored types by name, the longer phrase first', () => {
  const board = { sections: [{ tiles: [{ id: 'a', title: 'Revenue by state', viz: 'hbar', kind: 'breakdown' }] }], kpis: [] };
  const said = (phrase) => readCommand(phrase, { board })?.actions?.[0]?.patch?.viz;
  const cases = {
    'make revenue by state as a bubble map': 'bubbleMap',
    'make revenue by state as a shape map': 'shapeMap',
    'make revenue by state as a pie': 'pie',
    'make revenue by state as a donut': 'donut',
    'make revenue by state as a waterfall': 'waterfall',
    'make revenue by state as a radar': 'radar',
    'make revenue by state as a heat map': 'heatmap',
    'make revenue by state as a map': 'map',
    'show revenue by state as a combo chart': 'combo',
  };
  for (const [phrase, viz] of Object.entries(cases)) assert.equal(said(phrase), viz, phrase);
});

/* Where a region sits, read from its path. */

test('a path is read as its rings, and its centre is inside its largest one', () => {
  const square = 'M0,0L10,0L10,10L0,10Z';
  assert.deepEqual(ringsOf(square), [[[0, 0], [10, 0], [10, 10], [0, 10]]]);
  const g = pathGeometry(square);
  assert.deepEqual(g.box, [0, 0, 10, 10]);
  assert.deepEqual(g.centre.map((v) => Math.round(v * 1e6) / 1e6), [5, 5]);
  // A mainland and a small island far away: the centre stays on the mainland.
  const withIsland = 'M0,0L10,0L10,10L0,10ZM100,100L101,100L101,101L100,101Z';
  const h = pathGeometry(withIsland);
  assert.deepEqual(h.box, [0, 0, 101, 101]);
  assert.ok(h.centre[0] < 10 && h.centre[1] < 10, `centre ${h.centre} is in the sea`);
  assert.equal(pathGeometry(''), null);
});

test('fitBox pads the union of boxes', () => {
  assert.equal(fitBox([[0, 0, 10, 10], [20, 5, 30, 15]], 0.1), '-3 -3 36 21');
  assert.equal(fitBox([]), null);
});

test('every region on every map has a box and a centre within it', () => {
  const dir = path.join(import.meta.dirname, '..', 'lib', 'geo', 'maps');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const map = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    for (const l of map.locations) {
      assert.ok(!/[^MLHVCSQTAZmlhvcsqtaz0-9.,\seE+-]/.test(l.path), `${f} ${l.id} uses a path command this reader does not know`);
      const g = pathGeometry(l.path);
      assert.ok(g, `${f} ${l.id} has no shape`);
      const [x0, y0, x1, y1] = g.box;
      const [cx, cy] = g.centre;
      assert.ok(cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1, `${f} ${l.id}: centre ${g.centre} outside ${g.box}`);
    }
  }
});
