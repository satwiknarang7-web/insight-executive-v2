import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatExact,
  formatNumber,
  formatPercent,
  formatValue,
  isPercentKey,
  isCurrencyKey,
  isIdentifierKey,
  truncateLabel,
} from '../lib/format.js';

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

/* A number that is a label is not a quantity.

   A PIN code of 505800 was shown in the Explore table as "505.8K", which is
   not a shorter way of writing that postal code — it is a different thing. */

test('a column whose numbers are labels is never abbreviated', () => {
  for (const key of [
    'Pincode', 'PIN_CODE', 'zip_code', 'Postal Code', 'Customer_ID', 'customerID',
    'Order_No', 'Phone', 'Account_Number', 'Product_Code', 'Year',
  ]) {
    assert.equal(isIdentifierKey(key), true, `${key} should be a label`);
    assert.equal(formatValue(505800, key), '505800', `${key} was abbreviated`);
  }
});

test('a word merely ending in those letters is still a quantity', () => {
  // A bare `id$` matches "paid", "valid" and "grid" — a column called
  // Total_Paid losing its formatting is a worse bug than the one being fixed,
  // and a quieter one.
  for (const key of ['Total_Paid', 'Paid', 'Valid_Until', 'Grid_Size', 'Total_Amount', 'Quantity', 'Discount']) {
    assert.equal(isIdentifierKey(key), false, `${key} should be a number`);
  }
  assert.equal(formatValue(1234567, 'Total_Paid'), '$1.2M');
});

test('a table shows the value, a card shows the summary', () => {
  // Explore is a table of rows: the reader is checking cells against their own
  // records, and an abbreviation there is a number they cannot check.
  assert.equal(formatExact(1234567, 'Total_Amount'), '1,234,567');
  assert.equal(formatExact(1234.5678, 'Avg_Rating'), '1,234.5678');
  assert.equal(formatExact(505800, 'Pincode'), '505800', 'no separators in a postal code');
  assert.equal(formatExact(42, 'Quantity'), '42');
  // Compact notation still belongs on a card.
  assert.equal(formatNumber(1234567), '1.2M');
});

test('grouping does not follow the machine it is rendered on', () => {
  // The same saved analysis opened on two laptops otherwise groups its digits
  // two different ways.
  assert.equal(formatExact(2500000, 'Revenue'), '2,500,000');
});

test('formatNumber scales past M through B and T', () => {
  assert.equal(formatNumber(2_500), '2.5K');
  assert.equal(formatNumber(2_500_000), '2.5M');
  assert.equal(formatNumber(2_500_000_000), '2.5B');
  assert.equal(formatNumber(2_500_000_000_000), '2.5T');
});

test('formatNumber falls back to an exponent above 1e15', () => {
  // The regression: a row-grain sum of a repeated country-level measure came to
  // 1.078e18 and rendered as "1080507215161.0M" — no readable magnitude, and
  // wide enough that the y axis clipped every tick to a row of zeros.
  assert.equal(formatNumber(1.078e18), '1.08e18');
  assert.equal(formatNumber(5.824e18), '5.82e18');
  assert.ok(!String(formatNumber(1.078e18)).includes('M'));
});

test('formatNumber output stays narrow enough for a 96px axis gutter', () => {
  // yAxisGeometry caps the gutter at 96px and sizes it at length * 12 * 0.58.
  // That cap is only safe while the formatter cannot return an unbounded
  // string, which is what "1080507215161.0M" (16 chars, 111px) violated.
  const widest = [1e3, 1e6, 1e9, 1e12, 1e15, 1e18, -1.0805e18, Number.MAX_SAFE_INTEGER]
    .map((v) => String(formatNumber(v)).length)
    .reduce((a, b) => Math.max(a, b), 0);
  assert.ok(widest * 12 * 0.58 + 14 <= 96, `widest formatted value was ${widest} chars`);
});

test('formatNumber keeps sign and small-number behaviour', () => {
  assert.equal(formatNumber(-2_500_000_000), '-2.5B');
  assert.equal(formatNumber(999), 999);
  assert.equal(formatNumber(12.345), 12.35);
});

test('a percentage carries its unit and is never abbreviated', () => {
  // A rate on an axis read "9 18 27 36" — a medal rate with nothing to say what
  // it was a rate of. And formatNumber compacts at a thousand, so routing a
  // percentage through it produced "2.3K%": a magnitude suffix on a number that
  // cannot usefully have one.
  assert.equal(formatPercent(51.72), '51.7%');
  assert.equal(formatPercent(2.345), '2.35%');
  assert.equal(formatPercent(0), '0%');
  assert.equal(formatPercent(123.4), '123%');
  assert.doesNotMatch(String(formatPercent(2345)), /K/);
});

test('percent wins over currency when a name says both', () => {
  // CURRENCY_KEY_RE matches "cost", so "Shipping Cost Rate" — a percentage of
  // order value — was rendered as a sum of money.
  assert.equal(isPercentKey('Shipping Cost Rate'), true);
  assert.equal(isCurrencyKey('Shipping Cost Rate'), false);
  assert.equal(formatValue(2.3, 'Shipping Cost Rate'), '2.3%');
  assert.equal(formatValue(718000, 'Total Revenue'), '$718.0K');
});

test('a word that merely contains a rate word is not a percentage', () => {
  assert.equal(isPercentKey('Shareholders'), false);
  assert.equal(isPercentKey('Operating Cost'), false);
  assert.equal(isPercentKey('Medal Rate'), true);
  assert.equal(isPercentKey('F Share of Records'), true);
});
