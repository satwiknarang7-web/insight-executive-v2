import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatExact,
  formatNumber,
  formatValue,
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
