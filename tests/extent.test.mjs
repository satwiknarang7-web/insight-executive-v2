import test from 'node:test';
import assert from 'node:assert/strict';

import { extent, spanOf } from '../lib/extent.js';
import { outlierInfluence } from '../lib/tableModel.js';

test('extent reads a list far longer than the argument limit', () => {
  const values = Array.from({ length: 500000 }, (_, i) => (i * 7919) % 100003);
  assert.throws(() => Math.max(...values), RangeError, 'the spread it replaces overflows at this size');
  assert.deepEqual(extent(values), { min: 0, max: 100002 });
  assert.equal(spanOf(values), 100002);
});

test('extent agrees with Math.min and Math.max where both work', () => {
  assert.deepEqual(extent([3, -2, 9, 0]), { min: -2, max: 9 });
  assert.deepEqual(extent([]), { min: Math.min(), max: Math.max() });
  assert.deepEqual(extent([4, NaN, 'x', 1]), { min: 1, max: 4 }, 'non-numbers are skipped');
});

test('an outlier is still found among half a million values', () => {
  const values = Array.from({ length: 500000 }, (_, i) => 100 + (i % 10));
  values[1234] = 1e7;
  assert.equal(outlierInfluence(values).value, 1e7);
});
