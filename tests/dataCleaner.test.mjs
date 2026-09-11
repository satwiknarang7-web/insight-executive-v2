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
  cleanFloatingPoints,
  noteMalformedRow,
  describeSchema,
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

test('one mistyped cell does not redefine the whole column', () => {
  // The mirror image of the bug this heuristic was written for. Any single
  // decimal-comma value settled the column, so one hand-typed "1,50" among two
  // hundred American prices read every one of them as a thousandth of itself —
  // the same silent thousandfold error, arrived at from the other side.
  const rows = [];
  for (let i = 0; i < 200; i++) rows.push({ price: `${1 + (i % 9)},${String(100 + (i % 900)).padStart(3, '0')}` });
  rows.push({ price: '1,50' });

  const { cleanedData, metrics } = sanitizeDataset(rows);
  assert.equal(metrics.columnStats.price.commaConvention, 'thousands');
  assert.equal(cleanedData[0].price, 1100);
  assert.ok(Math.min(...cleanedData.map((r) => r.price)) >= 150, 'nothing was divided by a thousand');
});

test('a column that is mostly decimal-comma is still read that way', () => {
  // The rule is about weight of evidence, not about refusing a minority. Half
  // the values proving a decimal comma still settles it, as it always did.
  assert.equal(commaConvention(['1,234', '900,50']), 'decimal');
  assert.equal(commaConvention(['1,234', '2,345', '3,456', '900,50', '12,75']), 'decimal');
  assert.equal(commaConvention(Array(50).fill('1,234').concat('900,50')), 'thousands');
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

test('a ten-digit measure is not redacted as a phone number', () => {
  // The same bug as the order ids, one boundary further in. Any bare ten-digit
  // run matched, so a revenue of 9,876,543,210 written without separators
  // became [REDACTED_PHONE] — one constant string where there had been a
  // column of numbers, and the column stopped being a measure at all.
  const { cleanedData, metrics } = sanitizeDataset([
    { Revenue: '9876543210' },
    { Revenue: '1234567891' },
    { Revenue: '5555555555' },
  ]);
  assert.deepEqual(cleanedData.map((r) => r.Revenue), [9876543210, 1234567891, 5555555555]);
  assert.equal(metrics.columnStats.Revenue.type, 'number');
});

test('a bare ten-digit number in a phone column is still redacted', () => {
  const out = clean([{ Phone: '9625152011', Mobile: '9625152011', Tel: '9625152011' }]);
  assert.equal(out[0].Phone, '[REDACTED_PHONE]');
  assert.equal(out[0].Mobile, '[REDACTED_PHONE]');
  assert.equal(out[0].Tel, '[REDACTED_PHONE]');
  assert.equal(clean([{ 'Contact Mobile': '9625152011' }])[0]['Contact Mobile'], '[REDACTED_PHONE]');
});

test('a ten-digit run inside a sentence is redacted whatever the column is called', () => {
  // A cell that is nothing but ten digits is as likely a measure as a number;
  // ten digits sitting in a sentence are not.
  assert.equal(clean([{ Note: 'ring 5551234567 before noon' }])[0].Note, 'ring [REDACTED_PHONE] before noon');
});

test('a column called Hotel is not read as a phone column', () => {
  assert.equal(clean([{ Hotel: '9876543210' }])[0].Hotel, 9876543210);
});

// ---------------------------------------------------------------------------
// A timestamp is a fact about the file, not about the reader
// ---------------------------------------------------------------------------

const inZone = (tz, fn) => {
  const before = process.env.TZ;
  process.env.TZ = tz;
  try {
    return fn();
  } finally {
    if (before === undefined) delete process.env.TZ;
    else process.env.TZ = before;
  }
};

const ZONES = ['UTC', 'Pacific/Auckland', 'Asia/Kolkata', 'America/Los_Angeles'];

test('a timestamp without a zone means the same instant wherever the browser is', () => {
  // The date-only path is anchored at UTC for exactly this reason; the datetime
  // path still handed the string to `new Date()`, which reads a naive timestamp
  // as LOCAL. The same file produced a different instant in every timezone.
  for (const tz of ZONES) {
    assert.equal(
      inZone(tz, () => clean([{ d: '2025-03-15 10:30:00' }])[0].d),
      '2025-03-15T10:30:00.000Z',
      `wrong in ${tz}`
    );
  }
});

test('a timestamped row keeps its calendar day east of Greenwich', () => {
  // In Auckland the old path turned 15 March 10:30 into 2025-03-14T21:30Z, so
  // every daily total moved that row into the day before for anyone there.
  assert.match(inZone('Pacific/Auckland', () => clean([{ d: '2025-03-15T10:30:00' }])[0].d), /^2025-03-15T/);
});

test('a timestamp that carries its own offset is still read as that instant', () => {
  for (const tz of ZONES) {
    assert.equal(
      inZone(tz, () => clean([{ d: '2025-03-15T10:30:00+05:30' }])[0].d),
      '2025-03-15T05:00:00.000Z'
    );
    assert.equal(
      inZone(tz, () => clean([{ d: '2025-03-15T10:30:00Z' }])[0].d),
      '2025-03-15T10:30:00.000Z'
    );
  }
});

test('a day-first date is still day-first once it carries a time', () => {
  // `25/04/2025` parsed; `25/04/2025 10:30` did not parse at all, so the same
  // column was temporal or not depending on whether it had a clock on it.
  assert.equal(clean([{ d: '25/04/2025 10:30' }])[0].d, '2025-04-25T10:30:00.000Z');
  assert.equal(clean([{ d: '03/15/2025 10:30:00' }])[0].d, '2025-03-15T10:30:00.000Z');
});

test('an impossible timestamp is left as text', () => {
  assert.equal(clean([{ d: '2025-02-30 10:30:00' }])[0].d, '2025-02-30 10:30:00');
  assert.equal(clean([{ d: '2025-03-15 25:30:00' }])[0].d, '2025-03-15 25:30:00');
});

// ---------------------------------------------------------------------------
// Blanks
// ---------------------------------------------------------------------------

test("Excel's own error values are blanks, not categories", () => {
  // A spreadsheet writes its failures into the cell and the export carries them
  // through verbatim. Left as text they counted as distinct values, and enough
  // of them turned a measure into a mixed column dropped from the analysis.
  const errors = ['#N/A', '#VALUE!', '#REF!', '#DIV/0!', '#NAME?', '#NUM!', '#NULL!'];
  const rows = errors.map((v) => ({ region: 'North', amount: v }));
  for (let i = 0; i < 20; i++) rows.push({ region: 'South', amount: String(100 + i) });

  const { cleanedData, metrics } = sanitizeDataset(rows);
  assert.equal(metrics.columnStats.amount.type, 'number');
  assert.equal(metrics.columnStats.amount.nullCount, errors.length);
  assert.ok(cleanedData.slice(0, errors.length).every((r) => r.amount === null));
});

// ---------------------------------------------------------------------------
// Currency: the symbol is not always in front, and the sign is not always
// behind it
// ---------------------------------------------------------------------------

test('a negative currency amount parses whichever side of the symbol the sign is on', () => {
  // Excel's own currency format writes -$1,234.50; only $-1,234.50 was read.
  const rows = clean([{ v: '-$1,234.50' }, { v: '$-500' }, { v: '$250' }]);
  assert.deepEqual(rows.map((r) => r.v), [-1234.5, -500, 250]);
});

test('a trailing currency symbol is still a number', () => {
  // The standard German and French export format. Left as text the whole column
  // typed as a category and was never analysed as a measure.
  const { cleanedData, metrics } = sanitizeDataset([
    { umsatz: '1.234,56 €' },
    { umsatz: '900,50 €' },
    { umsatz: '2.000,00 €' },
  ]);
  assert.deepEqual(cleanedData.map((r) => r.umsatz), [1234.56, 900.5, 2000]);
  assert.equal(metrics.columnStats.umsatz.type, 'number');
  assert.deepEqual(metrics.decimalCommaColumns, ['umsatz']);
});

test('the number regexes still refuse things that are not numbers', () => {
  const rows = clean([{ v: '-+5' }, { v: '$$5' }, { v: '5€%' }, { v: '100 USD' }, { v: '1,2,3' }]);
  assert.deepEqual(rows.map((r) => r.v), ['-+5', '$$5', '5€%', '100 USD', '1,2,3']);
});

// ---------------------------------------------------------------------------
// Trimming precision in prose must not change the number
// ---------------------------------------------------------------------------

test('trimming runaway precision never rounds a real number away to zero', () => {
  // Every headline, bullet and insight line on /dashboard, /report, /present
  // and /insight goes through this. A conversion rate of 0.00042 was rendered
  // as 0.00 — not a shorter way of writing the number but a different number,
  // in prose the product promises is verified.
  assert.equal(cleanFloatingPoints('a rate of 0.0001234 per unit'), 'a rate of 0.00012 per unit');
  assert.equal(cleanFloatingPoints('p = 0.000512'), 'p = 0.00051');
  assert.equal(cleanFloatingPoints('value 1234.56789'), 'value 1234.57');
  assert.equal(cleanFloatingPoints('0.5678'), '0.57');
  assert.equal(cleanFloatingPoints('exactly 0.0000'), 'exactly 0.00');
  assert.equal(cleanFloatingPoints(''), '');
  assert.equal(cleanFloatingPoints(undefined), undefined);
});

// ---------------------------------------------------------------------------
// A misaligned file must be distinguishable from a sparse one
// ---------------------------------------------------------------------------

test("a short row's missing cells are counted apart from cells that are blank", () => {
  // Both used to land in nullsFound alone, so one stray unquoted comma looked
  // exactly like a column with some empty cells in it.
  const columns = ['a', 'b', 'c'];
  const metrics = createMetrics(columns, 3);
  sanitizeChunk(
    [
      { a: '1', b: '', c: '3' }, // a genuinely blank cell
      { a: '2', b: '5' }, // a short row: `c` never arrived
      { a: '3', b: '6', c: '9' },
    ],
    columns,
    metrics,
    []
  );
  assert.equal(metrics.nullsFound, 2);
  assert.equal(metrics.nullsFromShortRows, 1);
});

test('a malformed row is counted and a bounded sample of them is kept', () => {
  const metrics = createMetrics(['a'], 0);
  for (let i = 1; i <= 25; i++) noteMalformedRow(metrics, i, i % 2 ? 'TooManyFields' : 'TooFewFields');
  assert.equal(metrics.malformedRows, 25);
  // Capped: a file that is malformed throughout must not grow an unbounded
  // array inside the metrics object the worker structure-clones to the UI.
  assert.equal(metrics.malformedSamples.length, 10);
  assert.deepEqual(metrics.malformedSamples[0], { row: 1, kind: 'TooManyFields' });
});

test('an overflow field never becomes a column of its own', () => {
  // Papa parks the values past the last header under `__parsed_extra`. It is
  // not a column, and a row carrying one must not smuggle it downstream.
  const columns = ['a', 'b'];
  const metrics = createMetrics(columns, 2);
  const out = sanitizeChunk(
    [
      { a: '1', b: '2', __parsed_extra: ['3'] },
      { a: '4', b: '5' },
    ],
    columns,
    metrics,
    []
  );
  assert.deepEqual(Object.keys(out[0]), ['a', 'b']);
  assert.ok(!describeSchema(out).includes('__parsed_extra'));
});

// ---------------------------------------------------------------------------
// Outliers: rows and cells are different numbers
// ---------------------------------------------------------------------------

test('outlier rows are counted separately from outlier cells', () => {
  // /quality and the landing card describe this number to the user as a count
  // of rows, while finalizeMetrics counts one per anomalous cell — so a single
  // bad row in three columns was reported as three bad rows.
  const rows = [];
  for (let i = 0; i < 40; i++) rows.push({ x: String(10 + (i % 3)), y: String(20 + (i % 3)) });
  rows.push({ x: '5000', y: '9000' });

  const { metrics } = sanitizeDataset(rows);
  assert.equal(metrics.outliersCount, 2);
  assert.equal(metrics.outlierRows, 1);
});

test('corrupted values in a right-skewed money column are flagged', () => {
  // mean +/- 2.5sd is not robust on a long right tail: the corrupt values are
  // themselves what inflates sd, so past a handful of them they sit inside
  // their own fence and the file is reported clean. Money columns are exactly
  // this shape. Under the plain fence only five of the eight rows below were
  // found; the three smallest corruptions hid behind the other five.
  const rows = [];
  // A lognormal-ish spread: many small values, a few large legitimate ones.
  for (let i = 0; i < 300; i++) rows.push({ revenue: Math.exp(5 + ((i * 37) % 100) / 40).toFixed(2) });
  // Eight rows where somebody typed the amount in a thousand times its unit.
  const corrupted = [10, 33, 56, 79, 102, 125, 148, 171];
  for (const i of corrupted) rows[i].revenue = String(Number(rows[i].revenue) * 1000);

  const { cleanedData, metrics } = sanitizeDataset(rows);
  for (const i of corrupted) assert.ok(cleanedData[i].isAnomaly, `row ${i} should be flagged`);
  // And a long tail is not itself an anomaly: nothing else was swept up.
  assert.equal(metrics.outlierRows, corrupted.length);
  // The method used is recorded, so /quality can say which fence it applied.
  assert.equal(metrics.columnStats.revenue.outlierMethod, 'log-z');
  assert.equal(metrics.outlierMethod, 'log-z');
});

test('a healthy long tail is not reported as a file full of anomalies', () => {
  // The other half of the trade: a robust fence must not start calling an
  // ordinary skewed money column defective. A median/MAD or IQR fence flagged
  // 7-17% of these rows; the integrity score on /quality is built from that
  // count, so it would have marked a clean file down.
  const rows = [];
  for (let i = 0; i < 300; i++) rows.push({ revenue: Math.exp(5 + ((i * 37) % 100) / 40).toFixed(2) });
  const { metrics } = sanitizeDataset(rows);
  assert.ok(metrics.outlierRows <= 6, `flagged ${metrics.outlierRows} of 300 clean rows`);
});

test('a symmetric column keeps the plain standard-deviation fence', () => {
  const rows = [];
  for (let i = 0; i < 200; i++) rows.push({ score: String(100 + ((i * 13) % 21) - 10) });
  rows.push({ score: '400' });
  const { metrics } = sanitizeDataset(rows);
  assert.equal(metrics.columnStats.score.outlierMethod, 'z');
  assert.equal(metrics.outlierRows, 1);
});

test('a decimal measure is not redacted as a phone number', () => {
  // The ten-digit guard tested for exactly ten BARE digits, so it protected
  // 9876543210 and missed 9876543210.5 — the same magnitude with a decimal
  // place, which came out as "[REDACTED_PHONE].5". No phone number has a
  // decimal point, so this shape was never ambiguous in the first place.
  const { cleanedData, metrics } = sanitizeDataset([
    { Revenue: '9876543210.5' },
    { Revenue: '2500000000.75' },
    { Revenue: '1234567890.25' },
  ]);
  assert.deepEqual(cleanedData.map((r) => r.Revenue), [9876543210.5, 2500000000.75, 1234567890.25]);
  assert.equal(metrics.columnStats.Revenue.type, 'number');
});

test('redaction never quietly costs a column its type', () => {
  // The second half of the loss. Redaction rewrites the cell to a string, so a
  // column with enough redacted cells falls below the numeric-purity threshold
  // in profileColumns and stops being a measure at all — it vanishes from every
  // total, chart and KPI without anything saying so.
  const rows = Array.from({ length: 120 }, (_, i) => ({
    Tax_revenue_current_LCU_Value: `${1605180000000 + i}.${i % 10}`,
  }));
  const { cleanedData, metrics } = sanitizeDataset(rows);
  assert.equal(metrics.columnStats.Tax_revenue_current_LCU_Value.type, 'number');
  assert.ok(
    cleanedData.every((r) => typeof r.Tax_revenue_current_LCU_Value === 'number'),
    'every value survives as a number'
  );
});

test('a signed or separated number is still a number', () => {
  const out = clean([{ Revenue: '-9876543210.5', Balance: '1,234,567,890' }]);
  assert.ok(!String(out[0].Revenue).includes('REDACTED'));
  assert.ok(!String(out[0].Balance).includes('REDACTED'));
});

test('anything punctuated like a phone number is still redacted', () => {
  // The guard only ever protects a cell that is nothing but a number. A real
  // phone number carries a +, brackets or separators between its groups, so it
  // never reaches that test whatever the column is called.
  assert.equal(clean([{ Contact: '+1 555-123-4567' }])[0].Contact, '[REDACTED_PHONE]');
  assert.equal(clean([{ Contact: '(555) 123-4567' }])[0].Contact, '[REDACTED_PHONE]');
  assert.equal(clean([{ Contact: '555-123-4567' }])[0].Contact, '[REDACTED_PHONE]');
  assert.equal(clean([{ Contact: '555.123.4567' }])[0].Contact, '[REDACTED_PHONE]');
});
