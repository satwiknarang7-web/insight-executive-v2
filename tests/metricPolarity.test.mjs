import test from 'node:test';
import assert from 'node:assert/strict';
import { metricPolarity, leadingIsBad, rankingVerb } from '../lib/metricPolarity.js';
import { checkValidity } from '../lib/validitySceptic.js';

/**
 * Which direction is good.
 *
 * Nothing in the engine knew, and a shipped report reached "lifting the 5 below
 * average is worth more here than pushing Books further ahead" about a SHIPPING
 * COST RATE — advice to raise shipping costs in five categories. The arithmetic
 * was right, the evidence tier was right, the sentence was grammatical, and no
 * check that reads numbers could ever have caught it, because the numbers were
 * never wrong.
 */

test('a cost is a measure where less is better', () => {
  for (const name of [
    'Shipping Cost Rate',
    'Cost per Order',
    'Total Expenses',
    'Refund Rate',
    'Churn Rate',
    'Cancellation Rate',
    'Defect Count',
    'Average Delay',
    'Complaints per 1000',
  ]) {
    assert.equal(metricPolarity(name), 'lower', name);
  }
});

test('revenue is a measure where more is better', () => {
  for (const name of ['Total Revenue', 'Gross Margin', 'Net Profit', 'Retention Rate', 'Conversion Rate']) {
    assert.equal(metricPolarity(name), 'higher', name);
  }
});

test('most measures are neither, and stay neutral', () => {
  // Being unsure is cheap. Being confidently backwards is what this file exists
  // to stop, so a measure with no clear direction keeps the neutral wording.
  for (const name of ['Total Amount', 'Quantity', 'Units Sold', 'Customer Age', 'Unit Price', 'Rating', '']) {
    assert.equal(metricPolarity(name), null, name);
  }
});

test('return on investment is not a return rate', () => {
  // Reversing this would reintroduce the bug in the other direction.
  assert.equal(metricPolarity('Return on Investment'), 'higher');
  assert.equal(metricPolarity('Return Rate'), 'lower');
  assert.equal(metricPolarity('Cost Saving'), 'higher');
});

test('topping a cost ranking is not leading', () => {
  // "Books leads categories on shipping cost rate" reads as praise, and a
  // reader skimming headlines takes the verb at face value long before they
  // read the number under it.
  assert.equal(rankingVerb('Shipping Cost Rate'), 'has the highest');
  assert.equal(rankingVerb('Total Revenue'), 'leads');
  assert.equal(rankingVerb('Total Amount'), 'leads');
  assert.ok(leadingIsBad('Refund Rate'));
  assert.ok(!leadingIsBad('Total Amount'));
});

/* -- and the check that should have caught it ------------------------------ */

test('the executive summary is read like everything else', () => {
  // The claim escaped because A7 moved it onto the opening page and the checks
  // were reading findings and slides. The one surface a senior reader is
  // guaranteed to see was the one nothing looked at.
  const findings = [
    {
      id: 'c1',
      title: 'Shipping Cost Rate by Category',
      measure: 'Shipping Cost Rate',
      metrics: { evidence: 'strong', leader: 'Books', leadOverFieldSd: 3.7 },
    },
  ];
  const slideZero = {
    macroInsights: [
      'Books has the highest Shipping Cost Rate; lifting the 5 below average is worth more here than pushing Books further ahead.',
    ],
  };
  const found = checkValidity({ findings, slideZero });
  assert.ok(
    found.some((i) => i.kind === 'inverted-effort'),
    'the summary was not checked'
  );
});

test('a summary bullet that agrees with its numbers raises nothing', () => {
  const findings = [
    {
      id: 'c1',
      title: 'Total Amount by Category',
      measure: 'Total Amount',
      metrics: { evidence: 'strong', leader: 'Electronics', leadOverFieldSd: 3.1 },
    },
  ];
  const slideZero = {
    macroInsights: ['Electronics leads categories on Total Amount, the largest share of any category.'],
  };
  assert.deepEqual(checkValidity({ findings, slideZero }), []);
});
