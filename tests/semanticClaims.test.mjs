import test from 'node:test';
import assert from 'node:assert/strict';
import { claimsBriefing, acceptUnitClaims } from '../lib/semanticClaims.js';
import { classifyColumns } from '../lib/measureSemantics.js';
import { detectDenomination } from '../lib/measureUnits.js';

/**
 * The first agent, and the only one that runs before a chart exists.
 *
 * It exists because `measureUnits` finds a unit that varies by row with a
 * lexicon — LCU, local currency, a currency column — and that lexicon is right
 * about the files it was written for. `importe` is the same hazard in a word it
 * does not have, and the failure is silent: reais summed onto dollars, printed
 * as one figure.
 */

const profile = (over = {}) => ({
  measures: ['Tax_revenue_current_LCU_Value', 'importe', 'Units_Sold'],
  dimensions: ['Region'],
  // Well under the per-row threshold: at 900 distinct over 900 rows
  // `classifyColumns` reads a column as an identifier before it ever reaches
  // the unit branch, which is correct and made an earlier fixture lie.
  cardinality: { Region: 5, importe: 300, Units_Sold: 40 },
  ...over,
});

test('the briefing carries the shape and nothing in it', () => {
  const brief = claimsBriefing({ profile: profile() });
  assert.equal(brief.columns.length, 4);
  assert.ok(brief.columns.every((c) => 'name' in c && 'kind' in c));
  // A model that cannot see a value cannot quote one, and cannot be steered by
  // the data it is judging.
  assert.doesNotMatch(JSON.stringify(brief), /\d{4,}/);
  assert.equal(brief.columns.find((c) => c.name === 'importe').kind, 'number');
  assert.equal(brief.columns.find((c) => c.name === 'Region').kind, 'category');
});

test('a column the lexicon misses is accepted', () => {
  const claims = acceptUnitClaims([{ column: 'importe', unit: 'moneda local' }], {
    profile: profile(),
    detected: {},
  });
  assert.ok(claims.importe);
  assert.match(claims.importe.why, /not the same unit on every row/);
  assert.equal(claims.importe.source, 'model', 'and is marked as claimed, not measured');
});

test('measurement wins every collision', () => {
  // The deterministic answer is not up for discussion. A model that disagrees
  // with the lexicon about a column the lexicon settled is ignored, in both
  // directions: it cannot relabel it and it cannot clear it.
  const detected = { Tax_revenue_current_LCU_Value: { unit: 'local currency', why: 'lexicon' } };
  const claims = acceptUnitClaims(
    [{ column: 'Tax_revenue_current_LCU_Value', unit: 'dollars' }],
    { profile: profile(), detected }
  );
  assert.deepEqual(claims, {});
});

test('a claim about something that is not a measure goes nowhere', () => {
  const claims = acceptUnitClaims(
    [
      { column: 'Region', unit: 'euros' },
      { column: 'Nope', unit: 'euros' },
    ],
    { profile: profile(), detected: {} }
  );
  assert.deepEqual(claims, {});
});

test('a unit with a digit in it was invented', () => {
  // It was shown no values, so a number in its answer came from nowhere.
  const claims = acceptUnitClaims(
    [
      { column: 'Units_Sold', unit: '12 things' },
      { column: 'importe', unit: 'x'.repeat(80) },
    ],
    { profile: profile(), detected: {} }
  );
  assert.deepEqual(claims, {});
});

test('rubbish is survivable', () => {
  assert.deepEqual(acceptUnitClaims(null, { profile: profile() }), {});
  assert.deepEqual(acceptUnitClaims([null, 'x', {}, { column: '' }], { profile: profile() }), {});
});

test('a flood is capped', () => {
  const many = Array.from({ length: 40 }, (_, i) => ({ column: `m${i}`, unit: 'local currency' }));
  const wide = profile({ measures: many.map((m) => m.column) });
  assert.ok(Object.keys(acceptUnitClaims(many, { profile: wide, detected: {} })).length <= 6);
});

test('an accepted claim takes the column out of the sums', () => {
  // The whole point: a claimed column is refused the same way a lexicon-caught
  // one is, and for the same reason.
  const p = profile();
  const claims = acceptUnitClaims([{ column: 'importe', unit: 'moneda local' }], {
    profile: p,
    detected: detectDenomination({ profile: p, cardinality: p.cardinality }),
  });
  const classes = classifyColumns({
    profile: p,
    cardinality: p.cardinality,
    rowCount: 900,
    denominatedBy: claims,
  });
  assert.ok(classes.denominated.includes('importe'), 'the claimed column is refused');
  assert.ok(
    classes.denominated.includes('Tax_revenue_current_LCU_Value'),
    'and the lexicon still catches its own'
  );
  assert.ok(classes.additive.includes('Units_Sold'), 'while an ordinary count is untouched');
});

test('no claims is exactly the old behaviour', () => {
  const p = profile();
  const withNothing = classifyColumns({
    profile: p, cardinality: p.cardinality, rowCount: 900, denominatedBy: null,
  });
  const before = classifyColumns({ profile: p, cardinality: p.cardinality, rowCount: 900 });
  assert.deepEqual(withNothing.denominated, before.denominated);
  assert.deepEqual(withNothing.additive, before.additive);
});

test('being wrong costs a chart, never a wrong number', () => {
  // The failure is one-directional, which is what makes this safe to act on.
  // A false claim REFUSES an aggregate; it cannot produce one.
  const p = profile();
  const wrong = acceptUnitClaims([{ column: 'Units_Sold', unit: 'local currency' }], {
    profile: p,
    detected: {},
  });
  const classes = classifyColumns({
    profile: p, cardinality: p.cardinality, rowCount: 900, denominatedBy: wrong,
  });
  assert.ok(classes.denominated.includes('Units_Sold'), 'it is withheld');
  assert.ok(!classes.additive.includes('Units_Sold'), 'and never summed on a false premise');
});
