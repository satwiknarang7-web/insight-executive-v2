import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeChart } from '../lib/insightEngine.js';
import { dropTiedRankings, plateauShare } from '../lib/pipeline.js';

/* A ranking has to rank something.

   From the shipped report: "Average Context Window by Product", eleven bars, of
   which the top SEVEN read 1.0M exactly — ChatGPT, Claude, Gemini and four more,
   every one of them quoting the same round number, because a context window is
   a figure a vendor announces rather than a quantity that varies. The card
   opened "ChatGPT leads products on average context window at 1.0M".

   ChatGPT was first because alasql returned it first. The card's own prose said
   the field was "nearer a tie than a ranking" three sentences later, which did
   not help: the headline had already named a winner, and the headline is what
   gets read.

   Two things are wrong and each needs its own fix. The chart should mostly not
   be on the slide — a ranking whose bars are mostly one repeated value is not a
   ranking. And when the deck is thin enough that it stays, it must not claim a
   leader it does not have. */

/** The real figures, from the file the report was generated from. */
const CONTEXT_WINDOW = [
  ['ChatGPT', 1000000], ['Claude', 1000000], ['Gemini', 1000000],
  ['Google AI Plus', 1000000], ['Google AI Pro', 1000000], ['Google AI Ultra', 1000000],
  ['Microsoft 365 Copilot', 1000000], ['GitHub Copilot', 600000],
  ['Grok', 428579.57], ['Le Chat', 256000], ['Model Vault', 192000],
];

const chartOf = (pairs, over = {}) => ({
  id: 'c1',
  title: 'Average Context Window by Product',
  chart_type: 'hbar',
  xAxisKey: 'Product',
  yAxisKey: 'Average Context Window',
  dimension: 'Product',
  measure: 'Context Window',
  resultData: pairs.map(([label, value]) => ({ Product: label, 'Average Context Window': value })),
  ...over,
});

const filler = (n) => Array.from({ length: n }, () => ({ chart_type: 'line', title: 'Trend' }));

test('a ranking that is mostly one repeated value is dropped', () => {
  const tied = chartOf(CONTEXT_WINDOW);
  assert.equal(Math.round(plateauShare(tied) * 100), 64, 'seven of eleven is the plateau');

  const deck = dropTiedRankings([tied, ...filler(4)]);
  assert.ok(!deck.includes(tied), 'the tied ranking survived a deck that had plenty else to show');
  assert.equal(deck.length, 4);
});

test('a ranking that actually ranks is untouched', () => {
  // Same shape, same measure, real separation between every bar.
  const real = chartOf(CONTEXT_WINDOW.map(([l], i) => [l, 1000000 - i * 70000]));
  assert.ok(plateauShare(real) < 0.5, `a spread field was read as a plateau: ${plateauShare(real)}`);
  assert.deepEqual(dropTiedRankings([real, ...filler(4)]).length, 5);
});

test('the deck is never emptied to make the point', () => {
  const tied = chartOf(CONTEXT_WINDOW);
  // Nothing else to show. A weak chart on the slide beats a deck of one, and
  // the finding still refuses to name a leader — see below.
  const deck = dropTiedRankings([tied, ...filler(1)]);
  assert.ok(deck.includes(tied), 'the only comparison in the file was cut');
});

test('shapes that are not rankings are not judged on repetition', () => {
  const pairs = CONTEXT_WINDOW;
  // A trend of a flat metric is a finding about a flat metric. A histogram with
  // a tall mode is a histogram. Neither claims an order.
  for (const over of [{ chart_type: 'line' }, { chart_type: 'area' }, { chart_type: 'scatter' }]) {
    assert.equal(plateauShare(chartOf(pairs, over)), null, `${over.chart_type} was judged as a ranking`);
  }
  assert.equal(
    plateauShare(chartOf(pairs, { title: 'Distribution of Context Window', chart_type: 'bar' })),
    null,
    'a histogram was judged as a ranking'
  );
});

test('three bars are too few to call a plateau', () => {
  // Two of three equal is a tie the finding states in words. It is not a chart
  // that should not exist, and cutting at that width would gut ordinary decks.
  assert.equal(plateauShare(chartOf([['a', 5], ['b', 5], ['c', 1]])), null);
});

test('a shared top value is never reported as a leader', () => {
  const f = analyzeChart(chartOf(CONTEXT_WINDOW), 44);

  assert.ok(
    !/^ChatGPT leads/.test(f.headline),
    `the headline still crowned the first row: ${f.headline}`
  );
  assert.match(f.headline, /7 of 11 products share the highest/);
  assert.equal(f.metrics.tiedAtTop, 7);
  assert.equal(f.metrics.topSharedWith.length, 7);
  assert.match(f.metrics.leadIsReal, /no leader here/);
  assert.ok(f.metrics.evidenceNotes.some((n) => /sit at the top value/.test(n)));

  // And nothing downstream is told to act on the order.
  assert.match(f.recommendation, /nothing to rank here/i);
});

test('the gap is measured to the first category actually behind', () => {
  const f = analyzeChart(chartOf(CONTEXT_WINDOW), 44);
  // The runner-up is on the same value, so "0.0% ahead of Claude" is arithmetic
  // dressed as a comparison. GitHub Copilot at 600K is the real comparison.
  assert.ok(!/0\.0% ahead/.test(f.detail), `a zero gap was reported as a lead: ${f.detail}`);
  assert.match(f.detail, /ahead of GitHub Copilot/);
});

test('a two-way tie names both rather than counting them', () => {
  const f = analyzeChart(chartOf([['A', 100], ['B', 100], ['C', 40], ['D', 10]]), 80);
  assert.match(f.headline, /A and B share the highest/);
  assert.equal(f.metrics.tiedAtTop, 2);
});

test('an ordinary ranking says exactly what it said before', () => {
  const plain = chartOf([['A', 100], ['B', 62], ['C', 40], ['D', 10]]);
  const f = analyzeChart(plain, 80);
  assert.match(f.headline, /^A leads/);
  assert.equal(f.metrics.tiedAtTop, null);
  assert.equal(f.metrics.topSharedWith, null);
  assert.ok(!f.metrics.evidenceNotes.some((n) => /top value/.test(n)));
});

test('a merely bunched field is still a ranking, and still says so', () => {
  /* The distinction this turns on, and the one a first attempt got wrong.

     North 1010, West 1005, South 1000, Central 995, East 990 is a field where
     a normal month could rearrange the order — and the engine has said exactly
     that, in those words, since long before any of this. It is NOT a shared top
     value: there is an ordering here, it is just not a durable one.

     A tolerance loose enough to call 1010 and 1005 the same number turns every
     close race into "no leader exists", which is a different and false claim. */
  const bunched = chartOf([
    ['North', 1010], ['West', 1005], ['South', 1000], ['Central', 995], ['East', 990],
  ]);

  assert.ok(plateauShare(bunched) < 0.5, 'a bunched field was read as a plateau');
  const f = analyzeChart(bunched, 500);
  assert.equal(f.metrics.tiedAtTop, null, 'close values were reported as identical ones');
  assert.match(f.metrics.leadIsReal, /provisional/);
  assert.match(f.detail, /nearer a tie than a ranking/);
});

test('an average of the same figure over different row counts is one value', () => {
  // Why the tolerance is not simply equality: AVG over seven rows and AVG over
  // one are the same number in arithmetic and can differ in the last bits.
  const withNoise = chartOf([
    ['ChatGPT', 1000000], ['Claude', 1000000 + 1e-9], ['Gemini', 1000000 - 2e-9],
    ['Copilot', 1000000], ['Grok', 428579.57], ['Le Chat', 256000],
  ]);
  assert.equal(analyzeChart(withNoise, 44).metrics.tiedAtTop, 4);
});
