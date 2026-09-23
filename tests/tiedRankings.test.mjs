import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeChart } from '../lib/insightEngine.js';

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
