import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectVoidRows,
  excludeVoidRows,
  describeExclusion,
  acceptVoidClaims,
  exclusionNotice,
} from '../lib/voidRows.js';
import { valueVocabulary, valuesBriefing } from '../lib/valueBriefing.js';

/**
 * Rows the data itself says did not happen.
 *
 * On a 250,000-row export, 25,000 of them — 10.2%, 602M — sat inside every
 * Total Amount figure of a finished report. Inside the headline, inside every
 * share, inside the trend, inside the category ranking. The arithmetic was
 * perfect throughout, which is exactly why nothing caught it.
 */

const orders = ({ cancelled = 0, total = 1000, status = ['Cancelled', 'Returned'] } = {}) =>
  Array.from({ length: total }, (_, i) => ({
    Order_ID: `ORD${i}`,
    Order_Status: i < cancelled ? status[i % status.length] : 'Delivered',
    Category: ['Books', 'Electronics'][i % 2],
    Total_Amount: 100,
  }));

const shape = {
  dimensions: ['Order_Status', 'Category'],
  measures: ['Total_Amount'],
  cardinality: { Order_Status: 3, Category: 2 },
};

// ---------------------------------------------------------------------------
// Finding them
// ---------------------------------------------------------------------------

test('a status column marking rows void is found and quantified', () => {
  const found = detectVoidRows(orders({ cancelled: 102 }), shape);
  assert.equal(found.column, 'Order_Status');
  assert.equal(found.rows, 102);
  assert.equal(found.sharePct, 10.2);
  assert.deepEqual(found.levels, ['Cancelled', 'Returned']);
});

test('a handful of void rows is a rounding error, not a premise', () => {
  // The threshold exists so a few test rows in somebody's export do not trigger
  // a notice about the integrity of their revenue.
  assert.equal(detectVoidRows(orders({ cancelled: 3 }), shape), null);
});

test('a column that is mostly void is not a status column', () => {
  // Four fifths cancelled is a category sharing vocabulary with a status, and
  // excluding most of a table on that reading would be catastrophic and silent.
  assert.equal(detectVoidRows(orders({ cancelled: 800 }), shape), null);
});

test('a value that only looks like a status is left alone', () => {
  // Exact matches, not substrings: `Return Requested` is not `Returned`.
  const rows = orders({ cancelled: 200, status: ['Return Requested', 'Cancellation Pending'] });
  assert.equal(detectVoidRows(rows, shape), null);
});

test('a table with no status column costs nothing', () => {
  const rows = orders({ cancelled: 102 });
  const out = excludeVoidRows(rows, { dimensions: ['Category'], measures: ['Total_Amount'] });
  assert.equal(out.rows, rows, 'the same array comes back, by identity');
  assert.equal(out.excluded, null);
});

// ---------------------------------------------------------------------------
// Taking them out
// ---------------------------------------------------------------------------

test('void rows leave the analysis and the table keeps them', () => {
  const rows = orders({ cancelled: 102 });
  const { rows: kept, excluded } = excludeVoidRows(rows, shape);
  assert.equal(kept.length, 898);
  assert.ok(kept.every((r) => r.Order_Status === 'Delivered'));
  // Nothing is deleted. Explore, Ask and the SQL console read this array.
  assert.equal(rows.length, 1000);
  assert.equal(excluded.kept, 898);
  assert.equal(excluded.total, 1000);
});

test('what is removed and what is reported can never disagree', () => {
  // The levels actually counted are the authority, not the patterns — so the
  // notice cannot name one set of statuses while a different set was dropped.
  const rows = orders({ cancelled: 102 });
  const { rows: kept, excluded } = excludeVoidRows(rows, shape);
  assert.equal(rows.length - kept.length, excluded.rows);
});

test('asked to keep them, the detection still runs and still reports', () => {
  // The whole value of the choice being a choice. A reader who decides a
  // cancelled order belongs in their total gets their total — and gets told
  // what is in it, because silence here is the original bug with a preference
  // attached to it.
  const rows = orders({ cancelled: 102 });
  const { rows: kept, excluded } = excludeVoidRows(rows, shape, null, { include: true });
  assert.equal(kept.length, 1000, 'nothing was excluded');
  assert.equal(excluded.applied, false);
  assert.equal(excluded.rows, 102, 'but it still counted them');
});

test('keeping them in is the louder sentence, and the louder notice', () => {
  // This is the state the original bug was in. Somebody who chose it is told
  // what their totals now contain, not reassured that a choice was respected —
  // and the notice goes where a capped table goes, which cannot be dismissed.
  const { excluded } = excludeVoidRows(orders({ cancelled: 102 }), shape, null, { include: true });
  const said = describeExclusion(excluded);
  assert.match(said, /are counted in every total/);
  assert.match(said, /not revenue/);
  assert.equal(exclusionNotice(excluded)[0].kind, 'rows-included');
  assert.equal(exclusionNotice(excluded, { label: 'Leave them out' })[0].action.label, 'Leave them out');
});

test('the exclusion is described in a sentence a reader can act on', () => {
  const { excluded } = excludeVoidRows(orders({ cancelled: 102 }), shape);
  const said = describeExclusion(excluded);
  assert.match(said, /10\.2%/);
  assert.match(said, /Cancelled or Returned/);
  assert.match(said, /898/);
  assert.match(said, /still there in Explore/);
  assert.equal(describeExclusion(null), '');
});

// ---------------------------------------------------------------------------
// The vocabulary a model is shown
// ---------------------------------------------------------------------------

test('the vocabulary lists what each column actually holds', () => {
  const vocab = valueVocabulary(orders({ cancelled: 102 }), shape);
  const statuses = vocab.dimensions.Order_Status.map((v) => v.value).sort();
  assert.deepEqual(statuses, ['Cancelled', 'Delivered', 'Returned']);
  assert.equal(vocab.measures.Total_Amount.min, 100);
});

test('high-cardinality columns are left out of the vocabulary', () => {
  // Twenty-five order IDs teach a model nothing and are the part of a table
  // most likely to be personal.
  const vocab = valueVocabulary(orders({ cancelled: 102, total: 1000 }), {
    ...shape,
    dimensions: ['Order_Status', 'Order_ID'],
    cardinality: { Order_Status: 3, Order_ID: 1000 },
  });
  assert.ok(vocab.dimensions.Order_Status);
  assert.ok(!vocab.dimensions.Order_ID);
});

test('the sample is taken across the table, not off the top', () => {
  // The first fifty rows of a sorted export are one region or one month, and a
  // vocabulary built from them describes that slice rather than the data.
  const rows = orders({ cancelled: 500, total: 1000 });
  const vocab = valueVocabulary(rows, shape);
  const seen = new Set(vocab.sample.map((r) => r.Order_Status));
  assert.ok(seen.size > 1, 'every sampled row had the same status');
});

test('the briefing still names a column whose values were too many to list', () => {
  const vocab = valueVocabulary(orders({ cancelled: 102 }), {
    ...shape,
    dimensions: ['Order_Status', 'Order_ID'],
    cardinality: { Order_Status: 3, Order_ID: 1000 },
  });
  const brief = valuesBriefing({ vocabulary: vocab, profile: { ...shape, dimensions: ['Order_Status', 'Order_ID'] } });
  const id = brief.columns.find((c) => c.name === 'Order_ID');
  assert.ok(id, 'the column vanished from the briefing entirely');
  assert.equal(id.values, null);
});

// ---------------------------------------------------------------------------
// What the lexicon cannot read
// ---------------------------------------------------------------------------

const german = ({ cancelled = 150, total = 1000 } = {}) =>
  Array.from({ length: total }, (_, i) => ({
    Bestellstatus: i < cancelled ? (i % 2 ? 'Storniert' : 'Retoure') : 'Geliefert',
    Betrag: 100,
  }));

const germanShape = { dimensions: ['Bestellstatus'], measures: ['Betrag'], cardinality: { Bestellstatus: 3 } };

test('a status the lexicon cannot read is missed entirely', () => {
  // The failure this exists to fix. The column name does not match, the values
  // do not match, and the total silently includes every cancellation.
  assert.equal(detectVoidRows(german(), germanShape), null);
});

test('a claim naming the column and its values reaches it', () => {
  const vocab = valueVocabulary(german(), germanShape);
  const brief = valuesBriefing({ vocabulary: vocab, profile: germanShape });
  const claim = acceptVoidClaims(
    { column: 'Bestellstatus', values: ['Storniert', 'Retoure'] },
    { columns: brief.columns }
  );
  assert.deepEqual(claim, { column: 'Bestellstatus', values: ['Storniert', 'Retoure'] });

  const { rows: kept, excluded } = excludeVoidRows(german(), germanShape, claim);
  assert.equal(kept.length, 850);
  assert.equal(excluded.sharePct, 15);
  // A reader deciding whether to trust the exclusion is owed which values were
  // measured and which were read by a model.
  assert.deepEqual(excluded.claimed, ['Retoure', 'Storniert']);
});

test('a claimed value the column does not hold is dropped', () => {
  // It would exclude nothing while reporting that it had.
  const brief = valuesBriefing({ vocabulary: valueVocabulary(german(), germanShape), profile: germanShape });
  const claim = acceptVoidClaims(
    { column: 'Bestellstatus', values: ['Storniert', 'Abgebrochen'] },
    { columns: brief.columns }
  );
  assert.deepEqual(claim.values, ['Storniert']);
});

test('a claim about a column nobody was shown goes nowhere', () => {
  const brief = valuesBriefing({ vocabulary: valueVocabulary(german(), germanShape), profile: germanShape });
  assert.equal(acceptVoidClaims({ column: 'Nope', values: ['x'] }, { columns: brief.columns }), null);
  assert.equal(acceptVoidClaims(null, { columns: brief.columns }), null);
  assert.equal(acceptVoidClaims({ column: 'Bestellstatus' }, { columns: brief.columns }), null);
});

test('claiming every value is void is not a reading of a status column', () => {
  const brief = valuesBriefing({ vocabulary: valueVocabulary(german(), germanShape), profile: germanShape });
  const claim = acceptVoidClaims(
    { column: 'Bestellstatus', values: ['Storniert', 'Retoure', 'Geliefert'] },
    { columns: brief.columns }
  );
  assert.equal(claim, null);
});

test('measurement wins: a claim cannot clear what the lexicon caught', () => {
  // The model only ever ADDS. It cannot relabel a value the lexicon settled and
  // it cannot take one out of the set.
  const rows = orders({ cancelled: 102 });
  const { excluded } = excludeVoidRows(rows, shape, { column: 'Order_Status', values: [] });
  assert.equal(excluded.rows, 102, 'an empty claim cleared the lexicon');
  assert.deepEqual(excluded.levels, ['Cancelled', 'Returned']);
});

test('being wrong costs rows, and says which ones', () => {
  // The failure is bounded and legible: a wrong claim makes totals too LOW, and
  // the values it removed are named. Today's behaviour is a total that is too
  // high for a reason nothing on the page mentions.
  const brief = valuesBriefing({ vocabulary: valueVocabulary(orders({ cancelled: 102 }), shape), profile: shape });
  const wrong = acceptVoidClaims({ column: 'Category', values: ['Books'] }, { columns: brief.columns });
  const { rows: kept, excluded } = excludeVoidRows(orders({ cancelled: 102 }), shape, wrong);
  assert.ok(kept.length < 1000);
  assert.equal(excluded.column, 'Category');
  assert.deepEqual(excluded.claimed, ['Books']);
  assert.match(describeExclusion(excluded), /Books/);
});
