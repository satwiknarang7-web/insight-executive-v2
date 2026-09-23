import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeChart } from '../lib/insightEngine.js';

/**
 * Sentences that gave the game away.
 *
 * Each of these was printed in a real exported report. None of them is
 * arithmetically wrong; each is a template firing where its preconditions did
 * not hold, which is the thing a reader notices before they notice anything
 * true on the same page.
 */

const ranking = (dim, rows, measure = 'Total') => ({
  title: `${measure} by ${dim}`,
  chart_type: 'bar',
  xAxisKey: dim,
  yAxisKey: measure,
  resultData: rows,
});

test('a two-level field gets no Pareto sentence', () => {
  // "Just 2 of 2 account for about 80% of the total — a concentrated mix."
  const f = analyzeChart(
    ranking('Sex', [
      { Sex: 'M', Total: 135100 },
      { Sex: 'F', Total: 67500 },
    ])
  );
  const all = `${f.headline} ${f.detail} ${f.recommendation}`;
  assert.doesNotMatch(all, /of 2 account for about 80%/);
  assert.doesNotMatch(all, /It takes 2 of 2/);
});

test('a field long enough to concentrate still measures one', () => {
  // The guard must not cost the finding where it is real. Asserted on the
  // metric rather than the prose: observations compete on weight for four slots
  // in the write-up, so whether this particular sentence is printed depends on
  // what else the chart supports — which is the engine working as designed and
  // not what this test is about.
  const rows = [
    { Region: 'A', Total: 5000 }, { Region: 'B', Total: 2600 }, { Region: 'C', Total: 900 },
    { Region: 'D', Total: 400 }, { Region: 'E', Total: 180 }, { Region: 'F', Total: 90 },
    { Region: 'G', Total: 60 }, { Region: 'H', Total: 30 },
  ];
  const f = analyzeChart(ranking('Region', rows));
  assert.equal(f.metrics.categories, 8);
  assert.ok(f.metrics.paretoCount > 0 && f.metrics.paretoCount < f.metrics.categories);
});

test('a multiplier of one is not offered as a finding', () => {
  // "M leads sexes on average height at 179.0, 1.0x the 173.4 average."
  const f = analyzeChart(
    ranking('Sex', [
      { Sex: 'M', 'Average Height': 179.0 },
      { Sex: 'F', 'Average Height': 167.9 },
    ], 'Average Height')
  );
  assert.doesNotMatch(f.headline, /1\.0×/);
});

test('a multiplier worth stating is still stated', () => {
  const f = analyzeChart(
    ranking('Plan', [
      { Plan: 'Enterprise', 'Average Spend': 4200 },
      { Plan: 'Pro', 'Average Spend': 900 },
      { Plan: 'Free', 'Average Spend': 40 },
    ], 'Average Spend')
  );
  assert.match(f.headline, /×\s*the/, 'a genuine gap to the average keeps its multiple');
});

test('two levels are compared to each other, not to a field', () => {
  // "Look for what separates the 1 below average from the rest" — where "the 1"
  // is the other bar and "the rest" is nobody.
  const f = analyzeChart(
    ranking('Sex', [
      { Sex: 'M', 'Average Height': 179.0 },
      { Sex: 'F', 'Average Height': 167.9 },
    ], 'Average Height')
  );
  assert.doesNotMatch(f.recommendation, /the 1 below average/);
  assert.match(f.recommendation, /between M and F/);
});

const series = (values) => ({
  title: 'Record Count Trend Over Year',
  chart_type: 'line',
  xAxisKey: 'Year',
  yAxisKey: 'Record Count',
  resultData: values.map((v, i) => ({ Year: 1960 + i * 4, 'Record Count': v })),
});

test('a series that swings every period is not a plateau with a lever', () => {
  // "Record count held roughly flat... find out why it is stuck flat and what
  // lever would break it out of the range" — said about the Olympic calendar,
  // where Summer and Winter Games alternate and the count halves and doubles by
  // construction. There is no lever.
  // Two stable levels and no drift, which is the shape the Games produce. An
  // earlier fixture added an (i % 3) wobble that happened to correlate with the
  // index, fitting a decline at R^2 0.76 — a reminder that this guard is only
  // reached when the straight line explains little.
  const alternating = [];
  for (let i = 0; i < 20; i++) alternating.push(i % 2 === 0 ? 13800 : 3400);
  const f = analyzeChart(series(alternating));
  // Not asserting the direction label: whether a perfect cycle fits as flat or
  // as a faint slope depends on nothing but which end it stops on, which is
  // exactly why this guard cannot sit behind that test.
  assert.doesNotMatch(f.recommendation, /stuck flat/);
  assert.match(f.recommendation, /alternates up and down/);
});

test('ordinary noise around a flat line is not called a cycle', () => {
  // Noise turns every period too. Without an amplitude floor this fires on any
  // flat series and sends the reader looking for a cycle that is not there.
  const f = analyzeChart(series([200, 204, 198, 206, 201, 199, 203, 205, 197, 202, 200, 204]));
  assert.doesNotMatch(f.recommendation, /alternates up and down/);
});

test('a wobbly but genuinely rising series keeps its own advice', () => {
  const f = analyzeChart(series([100, 118, 112, 150, 142, 180, 175, 205, 198, 240, 232, 270]));
  assert.equal(f.metrics.direction, 'rising');
  assert.doesNotMatch(f.recommendation, /alternates up and down/);
});

test('a zigzag that is genuinely climbing keeps its own advice', () => {
  // Turning hard every period is not on its own a cycle. This series turns at
  // every step and swings by most of its own level, and it is a rising series
  // with noise on it: the lows run 100, 60, 90, 110 and the highs 180, 210,
  // 240, 250. Calling that "not drifting" is wrong, and the engine already has
  // the right sentence for it.
  const f = analyzeChart(series([100, 180, 60, 210, 90, 240, 110, 250]));
  assert.doesNotMatch(f.recommendation, /alternates up and down/);
  assert.match(f.recommendation, /Do not plan off this direction yet/);
});

test('a seasonal pattern with a real trend is not reduced to its cycle', () => {
  // Both sides climb steadily, so the direction is a finding rather than an
  // artefact of where the series stops.
  const f = analyzeChart(series([100, 300, 120, 340, 150, 380, 175, 420, 200, 460, 230, 500]));
  assert.doesNotMatch(f.recommendation, /alternates up and down/);
});
