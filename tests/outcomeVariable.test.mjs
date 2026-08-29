import { test } from 'node:test';
import assert from 'node:assert/strict';
import { outcomeColumn, outcomeRateName } from '../lib/measureSemantics.js';
import { outcomeSpread } from '../lib/chartSignals.js';
import { planCharts, planKpis } from '../lib/analystPlanner.js';
import { runAnalysis } from '../lib/pipeline.js';

/* The dataset's outcome, and what a deck built on one should say.

   Written from a report generated off churn_sample.csv that never once
   mentioned churn: every column was treated as interchangeable, so the file's
   whole subject was charted as one more attribute — or not at all. */

/** Rows where contract type really drives churn, the way the real data does. */
function churnRows(n = 900) {
  let seed = 5;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const rows = [];
  for (let i = 0; i < n; i++) {
    const contract = pick(['Month-to-month', 'Month-to-month', 'One year', 'Two year']);
    const tier = pick(['Basic', 'Standard', 'Premium', 'Enterprise']);
    const base = { 'Month-to-month': 0.45, 'One year': 0.16, 'Two year': 0.05 }[contract];
    rows.push({
      Customer_ID: `C${1000 + i}`,
      Plan_Tier: tier,
      Contract_Type: contract,
      Region: pick(['North', 'South', 'East', 'West']),
      Tenure_Months: Math.round(1 + rnd() * 60),
      Monthly_Charge: { Basic: 35, Standard: 65, Premium: 110, Enterprise: 155 }[tier],
      Churn: rnd() < base ? 'Yes' : 'No',
    });
  }
  return rows;
}

test('a column that records what happened is found by name and shape', () => {
  const sample = Array.from({ length: 40 }, (_, i) => ({ Churn: i % 3 ? 'No' : 'Yes' }));
  const found = outcomeColumn({ columns: ['Churn'], sample, cardinality: { Churn: 2 } });
  assert.equal(found.column, 'Churn');
  assert.equal(found.event, 'Yes');
  assert.equal(found.highIsGood, false);
  assert.equal(outcomeRateName(found), 'Churn Rate');
});

test('a column named for the good state still counts the level it is named for', () => {
  // "Active Rate" must be the rate of being active, not a rate of inactivity
  // wearing the word "active".
  const sample = Array.from({ length: 40 }, (_, i) => ({ Active: i % 4 ? 'Yes' : 'No' }));
  const found = outcomeColumn({ columns: ['Active'], sample, cardinality: { Active: 2 } });
  assert.equal(found.event, 'Yes');
  assert.equal(found.highIsGood, true, 'and a high one is good news');
});

test('an ordinary attribute is not mistaken for an outcome', () => {
  const sample = Array.from({ length: 40 }, (_, i) => ({
    Region: ['North', 'South'][i % 2],
    Plan_Tier: 'Basic',
    Gender: ['Male', 'Female'][i % 2],
  }));
  const columns = ['Region', 'Plan_Tier', 'Gender'];
  assert.equal(outcomeColumn({ columns, sample, cardinality: { Region: 2, Gender: 2 } }), null);
});

test('a column with more than two levels is not an outcome flag', () => {
  const sample = Array.from({ length: 40 }, (_, i) => ({ Churn: ['Yes', 'No', 'Pending'][i % 3] }));
  assert.equal(outcomeColumn({ columns: ['Churn'], sample, cardinality: { Churn: 3 } }), null);
});

test('the outcome rate is the first thing the deck says', () => {
  const kpis = planKpis(churnRows());
  assert.equal(kpis[0].label, 'Churn Rate');
  assert.equal(kpis[kpis.length - 1].label, 'Records Analyzed', 'and provenance is last');
});

test('the deck charts the outcome, not only the attributes around it', () => {
  const charts = planCharts(churnRows(), { max: 9 });
  const outcomeCharts = charts.filter((c) => c.outcomeRate);
  assert.ok(outcomeCharts.length >= 1, `no chart of the outcome: ${charts.map((c) => c.title).join(' | ')}`);
  assert.match(outcomeCharts[0].title, /Churn Rate by /);
  // And it leads, because it is the dependent variable.
  assert.ok(charts.indexOf(outcomeCharts[0]) === 0, 'the outcome chart opens the deck');
});

test('a rate that is the same everywhere is not charted three times', () => {
  // Churn assigned at random: no segment differs from any other beyond noise.
  let seed = 9;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const flat = Array.from({ length: 900 }, (_, i) => ({
    Contract_Type: ['Month-to-month', 'One year', 'Two year'][i % 3],
    Plan_Tier: ['Basic', 'Standard', 'Premium'][i % 3],
    Region: ['North', 'South', 'East', 'West'][i % 4],
    Monthly_Charge: 50 + (i % 40),
    Churn: rnd() < 0.3 ? 'Yes' : 'No',
  }));
  const charts = planCharts(flat, { max: 9 });
  const outcomeCharts = charts.filter((c) => c.outcomeRate);
  assert.ok(outcomeCharts.length <= 1, `${outcomeCharts.length} charts of a rate that does not move`);
});

test('a spread within sampling error is not a finding', () => {
  const groups = [
    { label: 'North', n: 225, rate: 0.374 },
    { label: 'South', n: 225, rate: 0.315 },
    { label: 'East', n: 225, rate: 0.279 },
    { label: 'West', n: 225, rate: 0.255 },
  ];
  // Twelve points of range on 225-row groups at a 31% base rate is roughly what
  // chance produces; the same range on much larger groups is not.
  assert.ok(outcomeSpread(groups) < 0.12, `scored ${outcomeSpread(groups)}`);
  const bigger = groups.map((g) => ({ ...g, n: g.n * 20 }));
  assert.ok(outcomeSpread(bigger) > 0.3, `scored ${outcomeSpread(bigger)}`);
});

test('the risk card is about the outcome, not about who is biggest', () => {
  const { synthesis } = runAnalysis(churnRows(), { maxCharts: 9 });
  const { risk, focus, opportunity } = synthesis.strategicScorecard;

  assert.match(risk, /churn rate/i, `risk was: ${risk}`);
  assert.match(risk, /Month-to-month/);
  assert.doesNotMatch(risk, /outsized share/, 'a standing share is not the risk when churn is measurable');

  // And the focus is about closing the gap, not about copying the segment that
  // is leaving — the ranking prose it would otherwise borrow says "find what
  // the leaders do differently", which on a churn rate is exactly backwards.
  assert.match(focus, /Two year/, `focus was: ${focus}`);
  assert.doesNotMatch(focus, /what the leaders do differently/);

  // Risk and opportunity must not be the same segment pointing two ways.
  if (opportunity) {
    assert.doesNotMatch(opportunity, /Month-to-month/, `both cards were about the same segment`);
  }
});

test('a total and its own share are one fact, an average is another', () => {
  // "Total Revenue by Category" and "Total Revenue Share by Category" rank the
  // same categories on the same number and may not both appear. An average is a
  // different question — how big each one is, against how big each is per
  // record — and blocking that too collapsed a deck of eight viable candidates
  // into three, which is how this deck came to be all bar charts.
  const charts = planCharts(churnRows(), { max: 9 });
  const pairs = new Set();
  for (const c of charts) {
    const measure = String(c.yAxisKey || '')
      .toLowerCase()
      .replace(/\s+share$/, '')
      .replace(/^share of\s+/, '')
      .trim();
    const key = `${c.dimension || c.xAxisKey}|${c.chart_type === 'composed' ? 'composed' : ''}|${measure}`;
    assert.ok(!pairs.has(key), `the same fact twice: ${key}`);
    pairs.add(key);
  }

  // And the deck is not one shape repeated. Two is the honest ceiling on this
  // fixture: it has no date column for a trend and only two numeric columns,
  // whose scales are too far apart to share an axis in a combo. The varied-deck
  // test in analystPlanner covers the case where more shapes are available.
  const types = new Set(charts.map((c) => c.chart_type));
  assert.ok(types.size >= 2, `only ${types.size} chart types: ${[...types].join(', ')}`);
});

test('a past participle is not a noun: "Churn Rate", never "Churned Rate"', () => {
  // The column name went straight into the card, the chart title and the axis.
  for (const [column, expected] of [
    ['Churned', 'Churn Rate'],
    ['Churn', 'Churn Rate'],
    ['Exited', 'Exit Rate'],
    ['Cancelled', 'Cancellation Rate'],
    ['Converted', 'Conversion Rate'],
    ['Retained', 'Retention Rate'],
    ['Attrition', 'Attrition Rate'],
    ['Active', 'Active Rate'],
  ]) {
    assert.equal(outcomeRateName({ column }), expected);
  }
});

test('the outcome is crossed with a continuous measure, not only with categories', () => {
  // Churn against tenure, banded — the chart a retention review opens with, and
  // the one the deck could not build at all while outcome charts split only by
  // categorical columns.
  let seed = 5;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const rows = Array.from({ length: 900 }, (_, i) => {
    const tenure = Math.round(1 + rnd() * 60);
    // Early tenure leaves; late tenure stays.
    const risk = tenure < 12 ? 0.55 : tenure < 30 ? 0.25 : 0.06;
    return {
      Contract_Type: ['Month-to-month', 'One year', 'Two year'][i % 3],
      Tenure_Months: tenure,
      Monthly_Charge: 40 + (i % 60),
      Churned: rnd() < risk ? 'Yes' : 'No',
    };
  });

  const charts = planCharts(rows, { max: 9 });
  const banded = charts.find((c) => c.outcomeRate && /Tenure/i.test(c.title));
  assert.ok(banded, `no churn-by-tenure chart: ${charts.map((c) => c.title).join(' | ')}`);
  assert.match(banded.title, /^Churn Rate by /);
  assert.match(banded.sql, /CASE WHEN/, 'the continuous column is banded');
  assert.match(banded.sql, /ORDER BY MIN\(/, 'and the bands run low to high');
});

test('a segment count is never a date, and never the first thing said', () => {
  const rows = Array.from({ length: 720 }, (_, i) => ({
    Order_Date: `2025-${String(1 + (i % 12)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`,
    Product_Category: ['A', 'B', 'C', 'D', 'E', 'F'][i % 6],
    Units_Sold: 1 + (i % 8),
    Revenue: 100 + (i % 400),
  }));
  const labels = planKpis(rows).map((k) => k.label);
  // "Order Date Segments: 240" is the number of days the file covers.
  assert.ok(!labels.some((l) => /order date segments/i.test(l)), labels.join(', '));
});
