import test from 'node:test';
import assert from 'node:assert/strict';
import {
  nearDuplicates,
  contestedBasis,
  argumentSpine,
  argumentBriefing,
  acceptArgument,
  spineAsBullets,
} from '../lib/synthesiser.js';

/**
 * A7, which reads the findings as a set rather than one at a time.
 *
 * The deck this was written against had seven findings and about four distinct
 * claims — one metric charted twice, one flat series charted twice, two slides
 * carrying word-for-word identical recommendations — and ended on description,
 * with not one recommendation attached to a figure. Nothing noticed, because
 * nothing was looking at the deck as a whole.
 */

const finding = (over = {}) => ({
  id: over.id || 'c1',
  title: over.title || 'Total Amount by Category',
  measure: over.measure || 'Total Amount',
  dimension: over.dimension || 'Category',
  headline: over.headline || 'Electronics leads categories on total amount at 4.3B, 72.6% of the total.',
  detail: over.detail || 'The gap is wide.',
  recommendation: over.recommendation || '',
  verifiedFacts: over.verifiedFacts || ['Leader: Electronics', 'Leader share: 72.6%'],
  metrics: { evidence: 'strong', ...over.metrics },
});

// ---------------------------------------------------------------------------
// Seven findings, four claims
// ---------------------------------------------------------------------------

test('the same measure over the same column is one claim, not two', () => {
  // These were "Total Amount Trend Over Month" and "Monthly Changes in Total
  // Amount": different titles, different chart types, one series. Matching on
  // wording would never have caught it.
  const found = nearDuplicates([
    finding({ id: 'c1', title: 'Total Amount Trend Over Month', dimension: 'Month' }),
    finding({ id: 'c2', title: 'Monthly Changes in Total Amount', dimension: 'Month', metrics: { evidence: 'moderate' } }),
  ]);
  const dup = found.find((f) => f.kind === 'duplicate-claim');
  assert.equal(dup.id, 'c2', 'the weaker evidence is the redundant one');
});

test('two findings about different things are not duplicates', () => {
  const found = nearDuplicates([
    finding({ id: 'c1', dimension: 'Category' }),
    finding({ id: 'c2', dimension: 'Customer_Age_Group' }),
  ]);
  assert.ok(!found.some((f) => f.kind === 'duplicate-claim'));
});

test('the same instruction twice is cleared the second time', () => {
  // Word for word, about two different columns, on one deck.
  const advice = 'Decide whether the reliance is a strength to press or an exposure to hedge.';
  const found = nearDuplicates([
    finding({ id: 'c1', dimension: 'Category', recommendation: advice }),
    finding({ id: 'c2', dimension: 'Region', recommendation: advice }),
  ]);
  const repeat = found.find((f) => f.kind === 'repeated-advice');
  assert.equal(repeat.id, 'c2');
  assert.equal(repeat.repair.op, 'clear_text');
});

test('similar but not identical advice is left alone', () => {
  const found = nearDuplicates([
    finding({ id: 'c1', dimension: 'Category', recommendation: 'Decide whether the reliance on Electronics is a strength or an exposure.' }),
    finding({ id: 'c2', dimension: 'Region', recommendation: 'Decide whether the reliance on North is a strength or an exposure.' }),
  ]);
  assert.ok(!found.some((f) => f.kind === 'repeated-advice'));
});

// ---------------------------------------------------------------------------
// Rows the data says did not happen
// ---------------------------------------------------------------------------

const orders = ({ cancelled = 0, total = 1000 } = {}) =>
  Array.from({ length: total }, (_, i) => ({
    Order_Status: i < cancelled ? (i % 2 ? 'Cancelled' : 'Returned') : 'Delivered',
    Total_Amount: 100,
  }));

const shape = { dimensions: ['Order_Status'], measures: ['Total_Amount'] };

test('a status column marking rows void is found, and quantified', () => {
  const found = contestedBasis(orders({ cancelled: 102 }), shape);
  assert.equal(found.column, 'Order_Status');
  assert.equal(found.rows, 102);
  assert.equal(found.sharePct, 10.2);
  assert.deepEqual([...found.levels].sort(), ['Cancelled', 'Returned']);
});

test('it detects and does not filter', () => {
  // Filtering is a decision about what the customer means by their own measure.
  // Making it here would be this file deciding what a business counts as
  // revenue, so what it earns is a place in the argument, not a WHERE clause.
  const rows = orders({ cancelled: 102 });
  const before = rows.length;
  contestedBasis(rows, shape);
  assert.equal(rows.length, before);
});

test('a handful of void rows is a rounding error, not a premise', () => {
  assert.equal(contestedBasis(orders({ cancelled: 3 }), shape), null);
});

test('a table with no status column has no contested basis', () => {
  assert.equal(contestedBasis(orders({ cancelled: 102 }), { dimensions: ['Region'], measures: ['Total_Amount'] }), null);
  assert.equal(contestedBasis([], shape), null);
});

// ---------------------------------------------------------------------------
// The spine
// ---------------------------------------------------------------------------

test('a doubt that changes every figure comes before the figures', () => {
  // The one ordering rule here that is not a matter of taste. A total whose
  // basis is contested cannot lead, because nothing under it survives the
  // decision about what the measure means.
  const steps = argumentSpine({
    findings: [finding()],
    contested: contestedBasis(orders({ cancelled: 102 }), shape),
    rowCount: 1000,
  });
  assert.equal(steps[0].role, 'doubt');
  assert.match(steps[0].text, /10\.2%/);
  assert.equal(steps[1].role, 'claim');
});

test('with nothing contested, the largest claim leads', () => {
  const steps = argumentSpine({ findings: [finding()], rowCount: 1000 });
  assert.equal(steps[0].role, 'claim');
  assert.deepEqual(steps[0].cites, ['c1']);
});

test('every step that makes a claim says which finding it came from', () => {
  const steps = argumentSpine({
    findings: [finding({ id: 'c1' }), finding({ id: 'c2', dimension: 'Region' })],
    rowCount: 1000,
  });
  for (const s of steps.filter((x) => x.role === 'claim')) {
    assert.ok(s.cites.length, `${s.role} cited nothing`);
  }
});

test('the argument ends on a decision carrying a figure', () => {
  // The report this was built against ended on description: seven findings, not
  // one recommendation with a number, an action or a consequence attached.
  const steps = argumentSpine({
    findings: [finding({ recommendation: 'Model the total without Electronics.', verifiedFacts: ['Leader share: 72.6%'] })],
    rowCount: 1000,
  });
  const decision = steps.at(-1);
  assert.equal(decision.role, 'decision');
  assert.match(decision.text, /72\.6%/);
});

test('a deck with nothing actionable ends on no decision rather than a hollow one', () => {
  const steps = argumentSpine({
    findings: [finding({ recommendation: '', metrics: { evidence: 'thin' } })],
    rowCount: 1000,
  });
  assert.ok(!steps.some((s) => s.role === 'decision'));
});

test('a contested basis IS the decision', () => {
  const steps = argumentSpine({
    findings: [finding({ recommendation: 'Press the Electronics advantage.' })],
    contested: contestedBasis(orders({ cancelled: 102 }), shape),
    rowCount: 1000,
  });
  assert.match(steps.at(-1).text, /Settle the treatment/);
  assert.match(steps.at(-1).text, /nothing below is worth acting on/);
});

// ---------------------------------------------------------------------------
// What the model may write
// ---------------------------------------------------------------------------

test('the briefing hands each step the evidence behind it', () => {
  const steps = argumentSpine({ findings: [finding()], rowCount: 1000 });
  const brief = argumentBriefing({ steps, findings: [finding()] });
  assert.ok(brief.steps[0].facts.includes('Leader share: 72.6%'));
});

test('a figure that appears in the evidence is allowed through', () => {
  const steps = [{ role: 'claim', says: 'Electronics leads.', facts: ['Leader share: 72.6%'] }];
  const out = acceptArgument([{ step: 1, text: 'Electronics carries 72.6% of the total.' }], { steps });
  assert.equal(out.length, 1);
});

test('a figure that appears nowhere was invented', () => {
  // The guarantee inverts here rather than disappearing. Every other agent is
  // shown no numbers, so any digit is invented; this one is shown the verified
  // ones, so a digit that is not among them is.
  const steps = [{ role: 'claim', says: 'Electronics leads.', facts: ['Leader share: 72.6%'] }];
  const out = acceptArgument(
    [
      { step: 1, text: 'Electronics carries 81.4% of the total.' },
      { step: 1, text: 'Revenue grew 12% year on year.' },
    ],
    { steps }
  );
  assert.deepEqual(out, []);
});

test('small counts a writer can see for themselves are not quotations', () => {
  const steps = [{ role: 'claim', says: 'Electronics leads.', facts: ['Leader share: 72.6%'] }];
  const out = acceptArgument([{ step: 1, text: 'Two of the seven categories carry it, led by Electronics at 72.6%.' }], { steps });
  assert.equal(out.length, 1);
});

test('a sentence citing a step that does not exist is dropped', () => {
  const steps = [{ role: 'claim', says: 'Electronics leads.', facts: [] }];
  assert.deepEqual(acceptArgument([{ step: 9, text: 'Something else entirely.' }], { steps }), []);
  assert.deepEqual(acceptArgument([{ text: 'Uncited.' }], { steps }), []);
});

test('rubbish is survivable, and the spine is always the floor', () => {
  assert.deepEqual(acceptArgument(null, {}), []);
  assert.deepEqual(acceptArgument(['x', null, {}], { steps: [] }), []);
  assert.deepEqual(nearDuplicates(), []);
  assert.deepEqual(argumentSpine({}), []);
  const steps = argumentSpine({ findings: [finding()], rowCount: 10 });
  assert.deepEqual(spineAsBullets(steps), steps.map((s) => s.text));
});
