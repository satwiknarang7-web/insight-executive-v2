import test from 'node:test';
import assert from 'node:assert/strict';
import { critique } from '../lib/critic.js';

/**
 * The critic exists for the mistakes reading the output cannot catch.
 *
 * Both of these shipped in real reports. One was found by reading a PDF and
 * recomputing medal rates by hand; the other by noticing that page 3 and page 8
 * disagreed. Neither is visible in any single sentence.
 */

const finding = (over) => ({
  id: 'slide_1',
  title: 'A finding',
  dimension: 'Region',
  dimensionKey: 'region',
  measureKey: 'Total Amount',
  outcomeRate: null,
  metrics: { evidence: 'strong' },
  recommendation: '',
  ...over,
});

const profile = (over = {}) => ({
  dimensions: ['region'],
  measures: ['Total Amount'],
  cardinality: { region: 5, 'Total Amount': 400 },
  rowCount: 500,
  ...over,
});

// ---------------------------------------------------------------------------
// A deck that argues with itself
// ---------------------------------------------------------------------------

test('two findings about one column pointing opposite ways is a question', () => {
  // The reported case: a 43.2% share of revenue called "who the data covers,
  // not a position to rebalance" on page 3, and "decide whether the reliance is
  // a strength to press or an exposure to hedge" on page 8.
  const questions = critique({
    profile: profile({ dimensions: ['age_group'], cardinality: { age_group: 6 }, rowCount: 900 }),
    findings: [
      finding({
        title: 'Total Amount by Customer Age Group',
        dimension: 'Customer Age Group',
        dimensionKey: 'age_group',
        recommendation: 'Decide whether the reliance on 26-35 is a strength to press or an exposure to hedge.',
      }),
      finding({
        id: 'slide_2',
        title: 'Record Count Share by Customer Age Group',
        dimension: 'Customer Age Group',
        dimensionKey: 'age_group',
        recommendation: 'Most of the total is 26-35 — that is who the data covers, not a position to rebalance.',
      }),
    ],
  });
  const found = questions.find((q) => q.kind === 'contradiction');
  assert.ok(found, 'the disagreement is surfaced');
  assert.match(found.question, /opposite instructions/);
  assert.match(found.question, /Customer Age Group/);
});

test('one stance stated twice is not a contradiction', () => {
  const questions = critique({
    profile: profile(),
    findings: [
      finding({ recommendation: 'Decide whether the reliance on EMEA is a strength to press or an exposure to hedge.' }),
      finding({ id: 'slide_2', recommendation: 'A bad quarter for EMEA is a bad quarter for the total.' }),
    ],
  });
  assert.equal(questions.filter((q) => q.kind === 'contradiction').length, 0);
});

test('the same stance on two different columns is not a contradiction', () => {
  const questions = critique({
    profile: profile({ dimensions: ['region', 'sex'], cardinality: { region: 5, sex: 2 }, rowCount: 500 }),
    findings: [
      finding({ recommendation: 'Decide whether the reliance on EMEA is an exposure to hedge.' }),
      finding({
        id: 'slide_2', dimension: 'Sex', dimensionKey: 'sex',
        recommendation: 'Most of the total is M — that is who the data covers, not a position to rebalance.',
      }),
    ],
  });
  assert.equal(questions.filter((q) => q.kind === 'contradiction').length, 0);
});

// ---------------------------------------------------------------------------
// A deck that never reached the question
// ---------------------------------------------------------------------------

test('an outcome column nothing is built on is a question', () => {
  // A 202,616-row athlete export came back as six charts of record counts while
  // the column recording who won sat unread. A chart that is not there leaves
  // no mark on the page, so nothing could have told the reader.
  const questions = critique({
    profile: profile({ measures: ['Total Amount', 'Medal_Binary'], cardinality: { region: 5, Medal_Binary: 2 } }),
    findings: [finding({ recommendation: 'Watch this.' })],
    outcome: { column: 'Medal_Binary', event: 1 },
  });
  const found = questions.find((q) => q.kind === 'unused-outcome');
  assert.ok(found);
  assert.match(found.question, /Medal_Binary records what happened/);
});

test('an outcome the deck is built on raises nothing', () => {
  const questions = critique({
    profile: profile(),
    findings: [finding({ outcomeRate: { column: 'Medal_Binary', event: 1 } })],
    outcome: { column: 'Medal_Binary', event: 1 },
  });
  assert.equal(questions.filter((q) => q.kind === 'unused-outcome').length, 0);
});

test('columns nobody asked about are named, most useful first', () => {
  const questions = critique({
    profile: profile({
      dimensions: ['region', 'sport', 'season'],
      measures: ['Total Amount', 'weight'],
      cardinality: { region: 5, sport: 51, season: 2, 'Total Amount': 400, weight: 300 },
      rowCount: 500,
    }),
    findings: [finding()],
  });
  const found = questions.find((q) => q.kind === 'unused-columns');
  assert.ok(found);
  // A readable breakdown leads; a 51-level dimension and a measure follow.
  assert.match(found.question, /season/);
  assert.ok(found.evidence.includes('sport'));
  assert.ok(!found.evidence.includes('region'), 'the column the deck used is not listed');
});

test('a column the engine deliberately withheld is not asked about again', () => {
  // Those absences already have their own notice. Repeating them here would
  // bury the ones that have no explanation.
  const questions = critique({
    profile: profile({
      dimensions: ['region'],
      measures: ['Total Amount', 'Tax_revenue_current_LCU_Value'],
      cardinality: { region: 5, 'Total Amount': 400, Tax_revenue_current_LCU_Value: 800 },
      rowCount: 500,
    }),
    findings: [finding()],
    withheld: ['Tax_revenue_current_LCU_Value'],
  });
  const found = questions.find((q) => q.kind === 'unused-columns');
  assert.ok(!found || !found.evidence.includes('Tax_revenue_current_LCU_Value'));
});

test('an identifier is not a breakdown anyone wanted', () => {
  const questions = critique({
    profile: profile({
      dimensions: ['region', 'athlete_name'],
      cardinality: { region: 5, athlete_name: 495 },
      rowCount: 500,
    }),
    findings: [finding()],
  });
  const found = questions.find((q) => q.kind === 'unused-columns');
  assert.ok(!found || !found.evidence.includes('athlete_name'));
});

// ---------------------------------------------------------------------------
// Shape of the thing
// ---------------------------------------------------------------------------

test('an instruction resting on thin evidence is questioned', () => {
  // The engine caps the verb by the tier, so this should never fire. It is kept
  // because "should never fire" is the claim worth watching.
  const questions = critique({
    profile: profile(),
    findings: [finding({ metrics: { evidence: 'thin' }, recommendation: 'Decide whether to double down on EMEA.' })],
  });
  assert.ok(questions.some((q) => q.kind === 'overreach'));
});

test('every critique is a question, and never a claim', () => {
  const questions = critique({
    profile: profile({ dimensions: ['region', 'season'], cardinality: { region: 5, season: 2 }, rowCount: 500 }),
    findings: [
      finding({ dimension: 'Region', recommendation: 'Decide whether the reliance on EMEA is an exposure to hedge.' }),
      finding({ id: 's2', dimension: 'Region', recommendation: 'That is who the data covers, not a position to rebalance.' }),
    ],
    outcome: { column: 'Medal_Binary' },
  });
  assert.ok(questions.length > 0);
  for (const q of questions) {
    assert.ok(q.question.trim().endsWith('?'), `not a question: ${q.question}`);
    assert.ok(Array.isArray(q.evidence));
    assert.equal(q.metrics, undefined, 'a critique carries no statistics of its own');
    assert.equal(q.evidenceTier, undefined, 'and no evidence tier — it proves nothing');
  }
});

test('an empty or clean deck is left alone', () => {
  assert.deepEqual(critique({ findings: [], profile: profile() }), []);
  const clean = critique({
    profile: { dimensions: ['region'], measures: ['Total Amount'], cardinality: { region: 5, 'Total Amount': 400 }, rowCount: 500 },
    findings: [finding({ recommendation: 'Watch this for another period.' })],
  });
  assert.equal(clean.length, 0, 'a deck that used what it had raises nothing');
});
