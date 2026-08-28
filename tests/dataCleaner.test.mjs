import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeDataset,
  nullifyStrayValues,
  commaConvention,
  commaEvidence,
  createMetrics,
  sanitizeChunk,
  finalizeMetrics,
} from '../lib/dataCleaner.js';

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

// ---------------------------------------------------------------------------
// Commas: thousands separator or decimal point?
//
// The bug these cover: every comma was stripped as a thousands separator, so a
// German or Brazilian export where "900,50" means nine hundred and a half was
// silently stored as 90050. The column still typed cleanly as a number, so
// nothing downstream flagged it and every total, chart and "verified" finding
// was a hundred times too big — stated with the confidence the product exists
// to earn. A comma cannot be read one cell at a time, so it is decided for the
// whole column.
// ---------------------------------------------------------------------------

test('a decimal-comma column is read as decimals, not multiplied by a hundred', () => {
  const rows = clean([
    { branch: 'Nord', turnover: '900,50' },
    { branch: 'Sud', turnover: '1200,75' },
    { branch: 'Ost', turnover: '340,20' },
  ]);
  assert.deepEqual(rows.map((r) => r.turnover), [900.5, 1200.75, 340.2]);
});

test('dot-grouped European numbers parse instead of being left as text', () => {
  const rows = clean([{ v: '1.234,56' }, { v: '2.000,00' }, { v: '900,50' }]);
  assert.deepEqual(rows.map((r) => r.v), [1234.56, 2000, 900.5]);
});

test('comma-grouped thousands still parse the way they always did', () => {
  const rows = clean([{ v: '1,234.50' }, { v: '12,345' }, { v: '1,234,567' }]);
  assert.deepEqual(rows.map((r) => r.v), [1234.5, 12345, 1234567]);
});

test('a column that contradicts itself is left as text rather than half wrong', () => {
  // "1,234.50" proves the comma groups; "900,50" proves it is the decimal
  // point. No reading makes both true, so neither is guessed at.
  const { cleanedData, metrics } = sanitizeDataset([{ v: '1,234.50' }, { v: '900,50' }]);
  assert.deepEqual(cleanedData.map((r) => r.v), ['1,234.50', '900,50']);
  assert.equal(metrics.columnStats.v.commaConvention, 'mixed');
  assert.deepEqual(metrics.ambiguousCommaColumns, ['v']);
});

test('with no evidence either way a comma is a thousands separator', () => {
  // "1,234" is 1234 in en-US and 1.234 in de-DE and nothing here says which.
  // The commoner export format wins, which is also the behaviour every file
  // already had.
  const rows = clean([{ v: '1,234' }, { v: '5,678' }]);
  assert.deepEqual(rows.map((r) => r.v), [1234, 5678]);
});

test('one decimal-comma value settles the whole column, ambiguous ones included', () => {
  const { cleanedData, metrics } = sanitizeDataset([{ v: '1,234' }, { v: '900,50' }]);
  assert.deepEqual(cleanedData.map((r) => r.v), [1.234, 900.5]);
  assert.deepEqual(metrics.decimalCommaColumns, ['v']);
});

test('percentages and accounting negatives follow the column convention too', () => {
  assert.equal(clean([{ v: '12,5%' }, { v: '7,25%' }])[0].v, 0.125);
  assert.equal(clean([{ v: '(1.200,50)' }, { v: '300,25' }])[0].v, -1200.5);
});

test('a plain decimal in a decimal-comma column is not regrouped', () => {
  // The dot only becomes a group separator in a value that has a comma to be
  // the decimal point. Otherwise 3.14 would become 314.
  const rows = clean([{ v: '900,50' }, { v: '3.14' }]);
  assert.deepEqual(rows.map((r) => r.v), [900.5, 3.14]);
});

test('a decimal-comma value is not mistaken for a zero-padded code', () => {
  // "0,5" reaches looksLikeIdentifier as digits "05". In this column the comma
  // is the decimal point, so it is half — not a padded identifier.
  const rows = clean([{ v: '0,5' }, { v: '900,50' }]);
  assert.deepEqual(rows.map((r) => r.v), [0.5, 900.5]);
});

test('genuinely malformed numbers are still refused', () => {
  // Neither grouping explains these, and parseFloat would answer both with a
  // plausible wrong number rather than failing.
  const rows = clean([{ v: '1,2,3' }, { v: '1.234.567' }]);
  assert.deepEqual(rows.map((r) => r.v), ['1,2,3', '1.234.567']);
});

test('the column decision survives a streamed ingest, chunk boundaries and all', () => {
  // The path the app actually takes: sanitizeChunk cannot see a whole column,
  // and here the first decimal comma does not appear until the third chunk. The
  // convention has to be settled in finalizeMetrics or the early rows keep a
  // reading the later ones disprove.
  const columns = ['umsatz'];
  const metrics = createMetrics(columns, 0);
  const cleaned = [];

  const raw = [];
  for (let i = 0; i < 40; i++) raw.push({ umsatz: String(100 + i) });
  for (let i = 0; i < 40; i++) raw.push({ umsatz: `${900 + i},50` });

  const CHUNK = 17; // deliberately not a divisor of 80
  for (let i = 0; i < raw.length; i += CHUNK) {
    sanitizeChunk(raw.slice(i, i + CHUNK), columns, metrics, cleaned);
  }
  finalizeMetrics(cleaned, columns, metrics);

  assert.equal(metrics.columnStats.umsatz.commaConvention, 'decimal');
  assert.equal(metrics.columnStats.umsatz.type, 'number');
  assert.ok(cleaned.every((r) => typeof r.umsatz === 'number'), 'every row ends up numeric');
  assert.equal(cleaned[40].umsatz, 900.5);
  assert.ok(Math.max(...cleaned.map((r) => r.umsatz)) < 1000, 'nothing was inflated');
});

test('commaConvention reads only positional evidence, never a guess', () => {
  assert.equal(commaEvidence('1,234.56'), 'thousands'); // dot after comma
  assert.equal(commaEvidence('1.234,56'), 'decimal'); //   dot before comma
  assert.equal(commaEvidence('1,234,567'), 'thousands'); // two commas
  assert.equal(commaEvidence('900,50'), 'decimal'); //      not three digits
  assert.equal(commaEvidence('1,234'), null); //            unknowable
  assert.equal(commaEvidence('42'), null); //               no comma at all

  assert.equal(commaConvention(['1,234']), 'thousands');
  assert.equal(commaConvention(['1,234', '900,50']), 'decimal');
  assert.equal(commaConvention(['1,234.5', '900,50']), 'mixed');
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
