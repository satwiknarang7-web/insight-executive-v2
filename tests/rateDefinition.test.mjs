import test from 'node:test';
import assert from 'node:assert/strict';
import { rateSensitivity, describeRate, orderingIsUnstable } from '../lib/rateDefinition.js';

/**
 * A ratio has two definitions, and they do not agree.
 *
 * On a real 250,000-row export, shipping cost as a share of order value put
 * Books on top by ratio-of-sums and Grocery on top by mean-of-ratios. Same
 * rows, same columns, same arithmetic, different question — and the engine
 * picked one silently, measured its leader 3.7 standard deviations clear of the
 * field, and printed that as robustness. The figure was right. The claim it
 * implied was false: the ordering was stable given a definition nobody stated.
 */

/**
 * A field where the two definitions genuinely disagree.
 *
 * Books:   300 orders, shipping 30 on a value of 100. 30% either way.
 * Grocery:  10 tiny orders where shipping nearly matches the basket (80%), and
 *           10 enormous ones where it is nothing (0.01%).
 *
 * Grocery's pooled rate is 0.018% — the huge orders swamp the denominator — and
 * its per-order mean is 40%. So the sums say Books and the means say Grocery,
 * which is the shape of the real export this was built from.
 */
const flipping = () => [
  ...Array.from({ length: 300 }, () => ({ Category: 'Books', Shipping_Cost: 30, Order_Value: 100 })),
  ...Array.from({ length: 10 }, () => ({ Category: 'Grocery', Shipping_Cost: 8, Order_Value: 10 })),
  ...Array.from({ length: 10 }, () => ({ Category: 'Grocery', Shipping_Cost: 10, Order_Value: 100000 })),
];

const spec = { dimension: 'Category', numerator: 'Shipping_Cost', denominator: 'Order_Value' };

test('the two definitions can name different leaders', () => {
  const check = rateSensitivity(flipping(), spec);
  assert.equal(check.leaderOfSums, 'Books');
  assert.equal(check.leaderOfRatios, 'Grocery');
  assert.equal(check.agrees, false);
  assert.ok(orderingIsUnstable(check));
});

test('a ranking that survives both definitions says so', () => {
  const rows = [
    ...Array.from({ length: 100 }, () => ({ Category: 'Books', Shipping_Cost: 50, Order_Value: 100 })),
    ...Array.from({ length: 100 }, () => ({ Category: 'Electronics', Shipping_Cost: 5, Order_Value: 100 })),
  ];
  const check = rateSensitivity(rows, spec);
  assert.equal(check.agrees, true);
  assert.equal(check.leaderOfSums, 'Books');
  assert.ok(!orderingIsUnstable(check));
});

test('the definition is stated whatever the answer', () => {
  // An unstated definition is how this went wrong. Saying it costs a line.
  const agreeing = rateSensitivity(
    [
      ...Array.from({ length: 50 }, () => ({ Category: 'A', Shipping_Cost: 10, Order_Value: 100 })),
      ...Array.from({ length: 50 }, () => ({ Category: 'B', Shipping_Cost: 1, Order_Value: 100 })),
    ],
    spec
  );
  const said = describeRate(agreeing, { numerator: 'Shipping_Cost', denominator: 'Order_Value' });
  assert.match(said[0], /total shipping cost divided by total order value/);
  assert.match(said[1], /does not depend on which was used/);
});

test('a disagreement names both leaders and takes the claim back', () => {
  const check = rateSensitivity(flipping(), spec);
  const said = describeRate(check, { numerator: 'Shipping_Cost', denominator: 'Order_Value' });
  assert.match(said[1], /Grocery/);
  assert.match(said[1], /Books/);
  assert.match(said[1], /not a stable ranking/);
});

test('a row with a zero denominator has no per-row rate and is not counted as one', () => {
  // Counting it as zero would drag the group's mean toward nothing for a reason
  // about missing data rather than about the group.
  const rows = [
    ...Array.from({ length: 20 }, () => ({ Category: 'A', Shipping_Cost: 10, Order_Value: 100 })),
    ...Array.from({ length: 20 }, () => ({ Category: 'A', Shipping_Cost: 0, Order_Value: 0 })),
    ...Array.from({ length: 20 }, () => ({ Category: 'B', Shipping_Cost: 1, Order_Value: 100 })),
  ];
  const check = rateSensitivity(rows, spec);
  assert.equal(check.leaderOfSums, 'A');
  assert.equal(check.leaderOfRatios, 'A');
});

test('groups too small to rank are left out of both rankings', () => {
  const rows = [
    ...Array.from({ length: 50 }, () => ({ Category: 'A', Shipping_Cost: 1, Order_Value: 100 })),
    ...Array.from({ length: 50 }, () => ({ Category: 'B', Shipping_Cost: 2, Order_Value: 100 })),
    // One row at an absurd rate would top a per-order ranking on its own.
    { Category: 'Tiny', Shipping_Cost: 99, Order_Value: 100 },
  ];
  const check = rateSensitivity(rows, spec);
  assert.equal(check.groups, 2);
  assert.notEqual(check.leaderOfRatios, 'Tiny');
});

test('nothing to compare returns nothing', () => {
  assert.equal(rateSensitivity([], spec), null);
  assert.equal(rateSensitivity(flipping(), { dimension: 'Category' }), null);
  assert.equal(rateSensitivity([{ Category: 'A', Shipping_Cost: 1, Order_Value: 1 }], spec), null);
  assert.deepEqual(describeRate(null), []);
  assert.equal(orderingIsUnstable(null), false);
});
