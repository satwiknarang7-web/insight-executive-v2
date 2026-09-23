import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
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
