import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatNumber, formatValue, isCurrencyKey, truncateLabel } from '../lib/format.js';

test('truncateLabel ignores the recharts index arg (no "…" collapse)', () => {
  // Recharts calls tickFormatter(value, index). The index must NOT shorten the label.
  assert.equal(truncateLabel('Electronic check', 0), 'Electronic check');
  assert.equal(truncateLabel('Mailed check', 1), 'Mailed check');
  assert.equal(truncateLabel('Bank transfer', 2), 'Bank transfer');
  assert.equal(truncateLabel('Credit card', 3), 'Credit card');
});

test('truncateLabel only truncates genuinely long labels', () => {
  assert.equal(truncateLabel('Short'), 'Short');
  const long = truncateLabel('Bank transfer (automatic)');
  assert.ok(long.endsWith('…'));
  assert.ok(long.length <= 16);
});

test('truncateLabel passes through non-strings', () => {
  assert.equal(truncateLabel(42), 42);
  assert.equal(truncateLabel(null), null);
});

test('formatNumber is compact and ignores the index arg', () => {
  assert.equal(formatNumber(950, 0), 950);
  assert.equal(formatNumber(1500), '1.5K');
  assert.equal(formatNumber(2_400_000), '2.4M');
  assert.equal(formatNumber('n/a'), 'n/a');
});

test('formatValue prefixes currency for monetary keys only', () => {
  assert.equal(formatValue(1500, 'revenue'), '$1.5K');
  assert.equal(formatValue(1500, 'count'), '1.5K');
  assert.equal(isCurrencyKey('TotalCharges'), true);
  assert.equal(isCurrencyKey('tenure'), false);
});
