/**
 * Which chart the data asks for.
 *
 * The rule this file defends is that the answer comes from the *values*. Every
 * fixture here uses columns called `a` and `b`, or worse — because a chooser
 * that needs a column to be called `order_date` is a chooser that works on
 * English exports and fails on everyone else's.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { chooseChart, keepsOwnOrder, readShape, recommendCharts } from '../lib/chartAdvisor.js';

const best = (rows, options = {}) => chooseChart(rows, options).type;
const types = (rows, options = {}) => recommendCharts(rows, options).recommendations.map((r) => r.type);

/* -- time ----------------------------------------------------------------- */

test('an evenly spaced series over time is a line, and a long one an area', () => {
  const short = Array.from({ length: 6 }, (_, i) => ({ a: `2024-0${i + 1}`, b: 100 + i * 10 }));
  assert.equal(best(short), 'line');
  const long = Array.from({ length: 24 }, (_, i) => ({ a: `20${24 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`, b: 100 + i }));
  assert.equal(best(long), 'area');
  assert.ok(types(long).includes('line'), 'the line is still on the list');
});

test('dates that are not evenly spaced are columns, because a line invents the gaps', () => {
  const rows = [
    { a: '2024-01-02', b: 5 },
    { a: '2024-01-03', b: 7 },
    { a: '2024-06-19', b: 2 },
    { a: '2024-11-30', b: 9 },
  ];
  assert.equal(best(rows), 'bar');
  assert.equal(readShape(rows, { xKey: 'a' }).evenlySpaced, false);
});

test('a time axis with a label no calendar has is still a time axis', () => {
  // Period 13 and 14 are a fiscal year, or a mistake. Either way the reader
  // sees time, so the chooser does too.
  const rows = Array.from({ length: 14 }, (_, i) => ({ a: `2026-${String(i + 1).padStart(2, '0')}`, b: 1000 + i * 50 }));
  const shape = readShape(rows, { xKey: 'a' });
  assert.equal(shape.isTemporal, true);
  assert.equal(shape.isBanded, false, 'a year-month is not a range from 2026 to 1');
  assert.equal(best(rows), 'area');
});

test('a series that swings either side of zero over time offers a waterfall', () => {
  const rows = Array.from({ length: 8 }, (_, i) => ({ a: `2024-0${i + 1}`, b: i % 2 ? -40 + i : 50 - i }));
  assert.ok(types(rows).includes('waterfall'));
});

/* -- cycles --------------------------------------------------------------- */

test('month names keep calendar order and are never sorted into a ranking', () => {
  const rows = [
    { a: 'Mar', b: 10 },
    { a: 'Jan', b: 90 },
    { a: 'Feb', b: 50 },
  ];
  const shape = readShape(rows, { xKey: 'a' });
  assert.equal(shape.isCyclical, true);
  assert.equal(shape.cycle, 'month');
  assert.equal(keepsOwnOrder(rows, { xKey: 'a' }), true);
  assert.equal(best(rows), 'bar');
  assert.ok(!types(rows).includes('donut'), 'a cycle is not a pie');
});

test('weekdays and quarters are cycles too', () => {
  assert.equal(readShape([{ a: 'Monday', b: 1 }, { a: 'Tuesday', b: 2 }], { xKey: 'a' }).cycle, 'weekday');
  assert.equal(readShape([{ a: 'Q1', b: 1 }, { a: 'Q2', b: 2 }], { xKey: 'a' }).cycle, 'quarter');
});

/* -- bands ---------------------------------------------------------------- */

test('ordered bands are a distribution, drawn in their own order', () => {
  const rows = [
    { a: '< 10', b: 4 },
    { a: '10–100', b: 40 },
    { a: '100+', b: 12 },
  ];
  assert.equal(readShape(rows, { xKey: 'a' }).isBanded, true);
  assert.equal(keepsOwnOrder(rows, { xKey: 'a' }), true);
  assert.equal(best(rows), 'bar');
  assert.ok(!types(rows).includes('hbar'), 'bands read left to right, not sideways');
});

test('bands written other ways are still bands', () => {
  assert.equal(readShape([{ a: '0-9', b: 1 }, { a: '10-19', b: 2 }], { xKey: 'a' }).isBanded, true);
  assert.equal(readShape([{ a: '18 to 30', b: 1 }, { a: '31 to 50', b: 2 }], { xKey: 'a' }).isBanded, true);
});

/* -- parts of a whole ------------------------------------------------------ */

test('values that add up to a hundred are parts of a whole', () => {
  const rows = [
    { a: 'w', b: 55 },
    { a: 'x', b: 25 },
    { a: 'y', b: 15 },
    { a: 'z', b: 5 },
  ];
  assert.equal(readShape(rows, { xKey: 'a' }).looksLikeShares, true);
  assert.equal(best(rows), 'donut');
});

test('many parts of one whole are a treemap rather than a wheel of slivers', () => {
  const rows = Array.from({ length: 20 }, (_, i) => ({ a: `c${i}`, b: 5 }));
  assert.equal(best(rows), 'treemap');
});

test('a negative value rules out every part-to-whole shape', () => {
  const rows = [
    { a: 'x', b: 60 },
    { a: 'y', b: 45 },
    { a: 'z', b: -5 },
  ];
  const offered = types(rows);
  for (const t of ['donut', 'treemap', 'radial', 'funnel', 'pie']) {
    assert.ok(!offered.includes(t), `${t} was offered over a negative value`);
  }
  assert.ok(offered.includes('waterfall'));
});

test('a concentrated split is worth showing as parts even without shares', () => {
  const rows = [
    { a: 'x', b: 900 },
    { a: 'y', b: 80 },
    { a: 'z', b: 20 },
  ];
  assert.ok(types(rows).includes('donut'));
  assert.equal(best(rows), 'bar', 'the ranking still leads');
});

/* -- rankings and labels --------------------------------------------------- */

test('long category names turn the ranking sideways', () => {
  const rows = [
    { a: 'Professional services and consulting', b: 90 },
    { a: 'Wholesale distribution of components', b: 60 },
    { a: 'Retail, including franchised outlets', b: 30 },
  ];
  assert.equal(best(rows), 'hbar');
});

test('short names stay upright', () => {
  const rows = [
    { a: 'N', b: 90 },
    { a: 'S', b: 60 },
    { a: 'E', b: 30 },
  ];
  assert.equal(best(rows), 'bar');
});

test('steps that lose most of what entered them are a funnel', () => {
  const rows = [
    { a: 'visited', b: 1000 },
    { a: 'signed up', b: 400 },
    { a: 'paid', b: 120 },
    { a: 'renewed', b: 60 },
  ];
  assert.ok(types(rows).includes('funnel'));
});

test('a ranking sorted high to low is not a funnel', () => {
  // Every ranking ordered by value is monotone. What a funnel has and a
  // ranking does not is that most of the first step is gone by the last.
  const shallow = [
    { a: 'x', b: 100 },
    { a: 'y', b: 92 },
    { a: 'z', b: 85 },
    { a: 'w', b: 80 },
  ];
  assert.ok(!types(shallow).includes('funnel'), 'a gentle decline is not a funnel');

  const steep = [
    { a: 'x', b: 1000 },
    { a: 'y', b: 300 },
    { a: 'z', b: 60 },
  ];
  assert.ok(types(steep).includes('funnel'));
  assert.ok(
    !types(steep, { orderedByValue: true }).includes('funnel'),
    'a caller that sorted by value says so, and the funnel is withdrawn'
  );
});

/* -- several measures ------------------------------------------------------ */

test('two measures that move together are a scatter, and the reason says so', () => {
  const rows = Array.from({ length: 20 }, (_, i) => ({ a: `r${i}`, b: i * 2, c: i * 2 + (i % 3) }));
  const { recommendations } = recommendCharts(rows, { xKey: 'a' });
  const scatter = recommendations.find((r) => r.type === 'scatter');
  assert.ok(scatter, 'no scatter offered');
  assert.match(scatter.why, /move together/);
  assert.equal(best(rows), 'scatter');
});

test('two measures orders of magnitude apart need an axis each', () => {
  const rows = Array.from({ length: 8 }, (_, i) => ({ a: `r${i}`, b: 1_000_000 + i, c: 3 + (i % 4) }));
  const { recommendations } = recommendCharts(rows, { xKey: 'a' });
  const composed = recommendations.find((r) => r.type === 'composed');
  assert.ok(composed);
  assert.match(composed.why, /magnitude/);
});

test('three measures across a few groups are a radar; many rows are a bubble', () => {
  const few = Array.from({ length: 5 }, (_, i) => ({ a: `g${i}`, b: i + 1, c: i + 2, d: i + 3 }));
  assert.ok(types(few).includes('radar'));
  const many = Array.from({ length: 30 }, (_, i) => ({ a: `g${i}`, b: i + 1, c: 30 - i, d: (i % 7) + 1 }));
  assert.ok(types(many).includes('bubble'));
});

/* -- degenerate cases ------------------------------------------------------ */

test('one row is a card, not a chart', () => {
  assert.equal(best([{ a: 'total', b: 42 }]), 'card');
  assert.equal(best([{ a: 'x', b: 1, c: 2, d: 3 }]), 'card');
  assert.ok(types([{ a: 'x', b: 1, c: 2 }]).includes('multicard'));
});

test('no rows, or no numbers, is a table', () => {
  assert.equal(best([]), 'table');
  assert.equal(best([{ a: 'x', b: 'y' }, { a: 'p', b: 'q' }]), 'table');
});

/* -- geography, by the values ---------------------------------------------- */

test('a map is offered when the values match places, whatever the column is called', () => {
  const placeNames = new Set(['france', 'spain', 'italy']);
  const rows = [
    { zzz: 'France', b: 10 },
    { zzz: 'Spain', b: 8 },
    { zzz: 'Italy', b: 6 },
  ];
  assert.ok(types(rows, { xKey: 'zzz', placeNames }).includes('filledmap'));
  // The same column with names no map has stays a ranking.
  const notPlaces = [
    { zzz: 'Alpha', b: 10 },
    { zzz: 'Beta', b: 8 },
    { zzz: 'Gamma', b: 6 },
  ];
  assert.ok(!types(notPlaces, { xKey: 'zzz', placeNames }).includes('filledmap'));
});

/* -- the contract ---------------------------------------------------------- */

test('a preferred type is honoured when the data supports it, and replaced when it does not', () => {
  const shares = [
    { a: 'x', b: 50 },
    { a: 'y', b: 30 },
    { a: 'z', b: 20 },
  ];
  const kept = chooseChart(shares, { xKey: 'a', preferred: 'bar' });
  assert.equal(kept.type, 'bar');
  assert.equal(kept.replaced, false);

  const negative = [
    { a: 'x', b: 50 },
    { a: 'y', b: -30 },
    { a: 'z', b: 20 },
  ];
  const swapped = chooseChart(negative, { xKey: 'a', preferred: 'donut' });
  assert.notEqual(swapped.type, 'donut');
  assert.equal(swapped.replaced, true);
  assert.ok(swapped.why, 'a replacement without a reason is just a surprise');
});

test('every recommendation carries a score and a reason, and no type appears twice', () => {
  const rows = Array.from({ length: 10 }, (_, i) => ({ a: `c${i}`, b: 100 - i * 7 }));
  const { recommendations } = recommendCharts(rows, { xKey: 'a' });
  assert.ok(recommendations.length > 1);
  const seen = new Set();
  let previous = Infinity;
  for (const r of recommendations) {
    assert.ok(!seen.has(r.type), `${r.type} appears twice`);
    seen.add(r.type);
    assert.ok(r.score > 0 && r.score <= 1, `${r.type} scored ${r.score}`);
    assert.ok(r.why && r.why.length > 10, `${r.type} has no reason`);
    assert.ok(r.score <= previous, 'the list is not in order');
    previous = r.score;
  }
});

test('the chooser never reads a column name', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const src = readFileSync(fileURLToPath(new URL('../lib/chartAdvisor.js', import.meta.url)), 'utf8');
  // The failure this guards against is a lexicon creeping back in: a regex of
  // English words matched against a column name, which works on the files
  // somebody remembered and silently fails on everyone else's.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  // The shape a lexicon takes is a regular expression full of English nouns,
  // matched against a column name. So the check is on the patterns rather than
  // on the prose: the sentences this module writes for a reader may say
  // "total" and "over time", and none of them decides anything.
  const patterns = code.match(/\/(?![/*])(?:\\.|\[[^\]]*\]|[^/\n\\])+\/[gimsuy]*/g) || [];
  assert.ok(patterns.length > 3, 'the pattern scan found nothing — it has stopped working');

  for (const word of ['date', 'time', 'year', 'month', 'revenue', 'amount', 'country', 'region', 'price', 'sales', 'qty', 'name']) {
    const guilty = patterns.find((p) => new RegExp(`\\b${word}\\b`, 'i').test(p));
    assert.ok(!guilty, `chartAdvisor matches column text with ${guilty} — that is a lexicon, not evidence`);
  }
});

test('the same data gives the same answer whatever its columns are called', () => {
  const plain = [
    { a: 'x', b: 55 },
    { a: 'y', b: 25 },
    { a: 'z', b: 20 },
  ];
  const named = [
    { 製品カテゴリ: 'x', 売上高: 55 },
    { 製品カテゴリ: 'y', 売上高: 25 },
    { 製品カテゴリ: 'z', 売上高: 20 },
  ];
  assert.equal(best(plain), best(named));
});
