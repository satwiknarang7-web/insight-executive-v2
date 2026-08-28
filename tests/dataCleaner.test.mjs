import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeDataset, nullifyStrayValues } from '../lib/dataCleaner.js';

const clean = (rows) => sanitizeDataset(rows).cleanedData;

test('an ISO date keeps its calendar day regardless of timezone', () => {
  // The bug: `new Date("2025-03-15").toISOString()` shifts the day west of UTC.
  const [row] = clean([{ d: '2025-03-15' }]);
  assert.match(row.d, /^2025-03-15T00:00:00\.000Z$/);
});

test('a slash date is anchored at UTC midnight, not shifted by the local zone', () => {
  const [row] = clean([{ d: '03/15/2025' }]);
  assert.equal(row.d, '2025-03-15T00:00:00.000Z');
});

test('an unambiguous day-first date is read as day-first', () => {
  // 25 cannot be a month, so this is 25 April, not April 25 misread.
  const [row] = clean([{ d: '25/04/2025' }]);
  assert.equal(row.d, '2025-04-25T00:00:00.000Z');
});

test('an impossible date is left as text rather than rolled over', () => {
  const [row] = clean([{ d: '2025-13-40' }]);
  assert.equal(row.d, '2025-13-40');
});

test('a datetime with a time component still parses to an ISO instant', () => {
  const [row] = clean([{ d: '2025-03-15 10:30:00' }]);
  // 10:30 local converts to UTC well inside the same calendar day everywhere.
  assert.match(row.d, /^2025-03-15T\d{2}:\d{2}:\d{2}/);
});

test('a zero-padded code keeps its leading zero instead of becoming a number', () => {
  const [row] = clean([{ zip: '02139' }]);
  assert.equal(row.zip, '02139');
  assert.equal(typeof row.zip, 'string');
});

test('a 16-digit identifier never ends up as a lossy number', () => {
  // A long digit run is caught by PII redaction before coercion; either way the
  // invariant that matters holds — it is never a Number that has lost precision.
  const [row] = clean([{ acct: '1234567890123456' }]);
  assert.equal(typeof row.acct, 'string');
});

test('genuine numbers still coerce, including currency and accounting', () => {
  const [row] = clean([{ a: '$1,234.50', b: '(500)', c: '0', d: '42' }]);
  assert.equal(row.a, 1234.5);
  assert.equal(row.b, -500);
  assert.equal(row.c, 0);
  assert.equal(row.d, 42);
});

test('a mostly-numeric column with one stray string is typed as a number', () => {
  const rows = [];
  for (let i = 0; i < 19; i++) rows.push({ amount: String(100 + i) });
  rows.push({ amount: 'pending' });
  const { metrics } = sanitizeDataset(rows);
  assert.equal(metrics.columnStats.amount.type, 'number');
  assert.ok(metrics.columnStats.amount.numericShare >= 0.9);
});

test('a genuinely mixed column stays mixed', () => {
  const rows = [
    { v: '1' }, { v: '2' }, { v: 'apple' }, { v: 'banana' }, { v: '3' }, { v: 'cherry' },
  ];
  const { metrics } = sanitizeDataset(rows);
  assert.equal(metrics.columnStats.v.type, 'mixed');
});

test('stray text in a measure is blanked so aggregates keep working', async () => {
  const { profileColumns } = await import('../lib/chartResolver.js');
  const alasql = (await import('alasql')).default;

  const rows = [];
  for (let i = 0; i < 300; i++) rows.push({ athlete: `a${i}`, height: 170 + (i % 20), weight: 60 + (i % 15) });
  rows[3].height = 'unknown';
  rows[77].height = '';
  rows[120].weight = null;

  const p = profileColumns(rows);
  assert.ok(p.measures.includes('height'), 'the column is still a measure');

  const cleared = nullifyStrayValues(rows, p.measures);
  assert.equal(cleared, 2, 'only the non-numeric cells are touched');
  assert.equal(rows[3].height, null);
  assert.equal(rows[5].height, 175, 'good values are left exactly as they were');

  // The point of the exercise: alasql returns no row at all for an AVG over a
  // column holding a string, so this is what actually breaks in the product.
  const table = `T${Date.now()}`;
  alasql(`CREATE TABLE ${table}`);
  alasql.tables[table].data = rows;
  const [out] = alasql(`SELECT AVG([height]) AS [Value] FROM ${table}`);
  assert.ok(typeof out.Value === 'number' && isFinite(out.Value), 'the average computes');
  alasql(`DROP TABLE ${table}`);
});

// ---------------------------------------------------------------------------
// Redaction has to be conservative: it cannot be undone by looking again
// ---------------------------------------------------------------------------

test('an identifier that contains ten digits is not a phone number', () => {
  // This is the bug in full. A real export keyed `ORD0000000001` had every one
  // of its 250,000 order ids rewritten to `ORD[REDACTED_PHONE]` — one distinct
  // value where there had been a quarter of a million — which turned every
  // count of orders into 1 and every per-order figure into the total.
  const out = clean([
    { Order_ID: 'ORD0000000001', Customer_ID: 'CUST00014303', Product_ID: 'PROD001017' },
    { Order_ID: 'ORD0000000002', Customer_ID: 'CUST00014304', Product_ID: 'PROD001018' },
  ]);
  assert.equal(out[0].Order_ID, 'ORD0000000001');
  assert.equal(out[1].Order_ID, 'ORD0000000002');
  assert.equal(out[0].Customer_ID, 'CUST00014303');
  assert.equal(out[0].Product_ID, 'PROD001017');
  assert.equal(new Set(out.map((r) => r.Order_ID)).size, 2, 'the ids stay distinct');
});

test('a long numeric key is not a phone number either', () => {
  // Compared as text: a purely numeric column is also type-coerced, which is
  // fine and separate. What matters is that the digits are still there.
  const out = clean([{ Ref: '123456789012' }, { Ref: '98765432101234' }]);
  assert.equal(String(out[0].Ref), '123456789012');
  assert.equal(String(out[1].Ref), '98765432101234');
});

test('real phone numbers are still redacted', () => {
  const out = clean([
    { Phone: '+91-9625152011', Note: 'call 555-123-4567 today' },
    { Phone: '(555) 123-4567', Note: '+1 555 123 4567' },
    { Phone: '9625152011', Note: 'nothing here' },
  ]);
  assert.equal(out[0].Phone, '[REDACTED_PHONE]');
  assert.equal(out[0].Note, 'call [REDACTED_PHONE] today', 'the surrounding words survive');
  assert.equal(out[1].Phone, '[REDACTED_PHONE]');
  assert.equal(out[1].Note, '[REDACTED_PHONE]');
  assert.equal(out[2].Phone, '[REDACTED_PHONE]');
  assert.equal(out[2].Note, 'nothing here');
});

test('emails and government-shaped ids are untouched by the change', () => {
  const out = clean([{ Email: 'sam@example.com', SSN: '123-45-6789', Card: '4111-1111-1111-1111' }]);
  assert.equal(out[0].Email, '[REDACTED_EMAIL]');
  assert.equal(out[0].SSN, '[REDACTED_ID]');
  assert.equal(out[0].Card, '[REDACTED_ID]');
});
