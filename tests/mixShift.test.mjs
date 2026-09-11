import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { planCharts } from '../lib/analystPlanner.js';
import { analyzeChart, isPercentageMeasure } from '../lib/insightEngine.js';

const require = createRequire(import.meta.url);
const alasql = require('alasql');

/**
 * Athlete-shaped rows: the female share climbs from about 20% to about 45%
 * across the period, which is the shape of the real export and the finding that
 * neither "Record Count by Sex" nor "Record Count Over Year" can express on its
 * own.
 */
function participation() {
  const rows = [];
  const years = [1960, 1968, 1976, 1984, 1992, 2000, 2008, 2016];
  years.forEach((year, i) => {
    const femaleShare = 0.2 + (i / (years.length - 1)) * 0.25;
    for (let n = 0; n < 400; n++) {
      rows.push({
        Year: year,
        Sex: n / 400 < femaleShare ? 'F' : 'M',
        Sport: ['Rowing', 'Judo', 'Archery'][n % 3],
        Weight: 55 + (n % 30),
      });
    }
  });
  return rows;
}

const runSql = (rows, sql) => {
  if (alasql.tables.SalesData) delete alasql.tables.SalesData;
  alasql('CREATE TABLE SalesData');
  alasql.tables.SalesData.data = rows;
  return alasql(sql);
};

test('a shift in a category\'s mix over time is found and charted', () => {
  const chart = planCharts(participation(), { max: 8 }).find((c) => /Mix Over/.test(c.title));
  assert.ok(chart, 'the crossing of two columns is offered as a candidate');
  assert.match(chart.title, /Sex Mix Over Year/);
  assert.equal(chart.mixOf, 'Sex');
});

test('the mix chart charts a share, and the share is right', () => {
  const rows = participation();
  const chart = planCharts(rows, { max: 8 }).find((c) => /Mix Over/.test(c.title));
  const out = runSql(rows, chart.sql);
  const key = Object.keys(out[0]).find((k) => k !== chart.xAxisKey);

  // Counts rise for every level at once whenever a dataset simply gets bigger,
  // which is a fact about sampling rather than about the mix.
  assert.match(key, /Share/);
  assert.ok(Math.abs(Number(out[0][key]) - 20) < 2, `first period was ${out[0][key]}`);
  assert.ok(Math.abs(Number(out[out.length - 1][key]) - 45) < 2, `last period was ${out.at(-1)[key]}`);
});

test('the rising level is charted, not its mirror image', () => {
  // On a two-level column one share is the other subtracted from a hundred, so
  // both move by exactly the same amount and iteration order would otherwise
  // decide. "The female share rose to 45%" is the finding; "the male share fell
  // to 55%" is the same arithmetic told backwards.
  const chart = planCharts(participation(), { max: 8 }).find((c) => /Mix Over/.test(c.title));
  assert.match(chart.sql, /\[Sex\] = 'F'/);
});

test('a mix that does not move is not charted', () => {
  const rows = [];
  for (const year of [1960, 1968, 1976, 1984, 1992, 2000, 2008, 2016]) {
    for (let n = 0; n < 400; n++) {
      rows.push({ Year: year, Sex: n % 3 === 0 ? 'F' : 'M', Weight: 55 + (n % 30) });
    }
  }
  const chart = planCharts(rows, { max: 8 }).find((c) => /Mix Over/.test(c.title));
  assert.equal(chart, undefined, 'a stable composition is not a finding');
});

test('a share is described in points, not as a percentage of itself', () => {
  // 19.7% to 45.5% is a rise of 131% of itself and of 25.8 percentage points.
  // Only the second is a sentence a reader can act on; the first reads like a
  // share passing a hundred.
  const rows = participation();
  const chart = planCharts(rows, { max: 8 }).find((c) => /Mix Over/.test(c.title));
  const f = analyzeChart({ ...chart, resultData: runSql(rows, chart.sql) });
  assert.match(f.headline, /percentage points/);
  assert.doesNotMatch(f.headline, /\d+% increase/);
  assert.doesNotMatch(f.detail, /compounded/, 'a share does not compound');
});

test('an ordinary measure keeps its relative-change wording', () => {
  // The guard must not reach charts that are not percentages.
  const rows = [100, 140, 190, 250, 320, 400].map((v, i) => ({
    Month: `2024-0${i + 1}`,
    Revenue: v,
  }));
  const f = analyzeChart({
    title: 'Revenue Over Month',
    chart_type: 'line',
    xAxisKey: 'Month',
    yAxisKey: 'Revenue',
    resultData: rows,
  });
  assert.match(f.headline, /increase/);
  assert.doesNotMatch(f.headline, /percentage points/);
});

test('isPercentageMeasure reads the alias, not the numbers', () => {
  assert.equal(isPercentageMeasure('F Share of Records'), true);
  assert.equal(isPercentageMeasure('Churn Rate'), true);
  assert.equal(isPercentageMeasure('Total Revenue'), false);
  assert.equal(isPercentageMeasure('Shareholders'), false, 'a word boundary, not a substring');
});

test('a mix shift is not given growth-target advice', () => {
  // "Growth is decelerating: set targets off the recent rate and find out what
  // stopped working" was printed about the share of athletes who are women.
  // There is no target and nothing stopped working.
  const rows = participation();
  const chart = planCharts(rows, { max: 8 }).find((c) => /Mix Over/.test(c.title));
  const f = analyzeChart({ ...chart, resultData: runSql(rows, chart.sql) });
  assert.doesNotMatch(f.recommendation, /set targets/);
  assert.doesNotMatch(f.recommendation, /stopped working/);
  assert.match(f.recommendation, /different populations/);
  assert.match(f.recommendation, /sex mix/i);
});
