import { test } from 'node:test';
import assert from 'node:assert/strict';
import { outcomeColumn, outcomeRateName, outcomeRateExpression } from '../lib/measureSemantics.js';
import { outcomeSpread } from '../lib/chartSignals.js';
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

test('a prepared label is found through its flag wrapper', () => {
  // A prepared dataset almost never names its label bare. `Medal_Binary` was
  // classified as a binary, dropped before planning, and a 202,616-row athlete
  // export came back as six charts of record counts with nothing about who wins.
  for (const [col, levels] of [
    ['Medal_Binary', [0, 1]],
    ['is_churned', ['No', 'Yes']],
    ['fraud_flag', [0, 1]],
    ['readmitted_yn', ['N', 'Y']],
    ['converted_label', [0, 1]],
  ]) {
    const sample = Array.from({ length: 40 }, (_, i) => ({ [col]: levels[i % 2] }));
    const found = outcomeColumn({ columns: [col], sample, cardinality: { [col]: 2 } });
    assert.ok(found, `${col} should read as an outcome`);
    assert.equal(found.column, col);
  }
});

test('the flag wrapper is not part of the metric name', () => {
  const sample = Array.from({ length: 40 }, (_, i) => ({ Medal_Binary: i % 2 }));
  const found = outcomeColumn({ columns: ['Medal_Binary'], sample, cardinality: { Medal_Binary: 2 } });
  assert.equal(outcomeRateName(found), 'Medal Rate', 'not "Medal Binary Rate"');
});

test('a good outcome is not reported as a risk', () => {
  const sample = Array.from({ length: 40 }, (_, i) => ({ Medal_Binary: i % 2 }));
  const found = outcomeColumn({ columns: ['Medal_Binary'], sample, cardinality: { Medal_Binary: 2 } });
  assert.equal(found.highIsGood, true, 'a medal rate climbing is not an exposure');
});

test('a circumstance is still not an outcome', () => {
  // Representing_Host is 0/1 like the label beside it, and is a predictor. The
  // name still has to say the column is a result.
  const sample = Array.from({ length: 40 }, (_, i) => ({ Representing_Host: i % 2 }));
  assert.equal(
    outcomeColumn({ columns: ['Representing_Host'], sample, cardinality: { Representing_Host: 2 } }),
    null
  );
});

test('the rate expression matches the column\'s own type', () => {
  // The bug this guards: a flag parsed from CSV holds the NUMBER 1, and
  // "[Medal_Binary] = '1'" matches nothing — every group comes back 0.0% and
  // the chart draws a row of empty bars with no error anywhere.
  const numeric = outcomeColumn({
    columns: ['Medal_Binary'],
    sample: Array.from({ length: 40 }, (_, i) => ({ Medal_Binary: i % 2 })),
    cardinality: { Medal_Binary: 2 },
  });
  assert.match(outcomeRateExpression(numeric), /=\s*1\s+THEN/, 'a number is compared unquoted');
  assert.doesNotMatch(outcomeRateExpression(numeric), /'1'/);

  const textual = outcomeColumn({
    columns: ['Churn'],
    sample: Array.from({ length: 40 }, (_, i) => ({ Churn: ['Yes', 'No'][i % 2] })),
    cardinality: { Churn: 2 },
  });
  assert.match(outcomeRateExpression(textual), /=\s*'Yes'\s+THEN/, 'text stays quoted');
});
