import test from 'node:test';
import assert from 'node:assert/strict';
import { auditPresentation, shortenTitle } from '../lib/presentationAudit.js';
import {
  reviewDeck,
  applyRepairs,
  rewriteTargets,
  fallbackRewrites,
  openQuestions,
} from '../lib/deckRepair.js';

/**
 * The loop that closes before the customer sees anything.
 *
 * The critic used to list what was wrong underneath the findings and leave the
 * findings wrong. These tests are about the other half: what can be fixed
 * mechanically, what has to be handed to a model, and — the part that matters
 * most — what neither of them is allowed to touch.
 */

const slide = (over = {}) => ({
  id: over.id || 'c1',
  pageTitle: over.title || 'Total Amount by Region',
  findings: { metrics: { evidence: 'strong' } },
  chart: {
    title: over.title || 'Total Amount by Region',
    chart_type: over.chart_type || 'bar',
    dimension: over.dimension || 'Region',
    xAxisKey: over.dimension || 'Region',
    yAxisKey: over.measure || 'Total_Amount',
    colorBy: over.colorBy,
    resultData: over.rows || new Array(5).fill({}),
    sql: over.sql || 'SELECT Region, SUM(Total_Amount) FROM t GROUP BY Region',
  },
});

const profile = { dimensions: ['Region', 'Month'], measures: ['Total_Amount'], temporal: ['Month'] };

// ---------------------------------------------------------------------------
// What the audit can see
// ---------------------------------------------------------------------------

test('a donut of two slices is a sentence drawn as a circle', () => {
  const board = [slide({ chart_type: 'donut', rows: new Array(2).fill({}) })];
  const found = auditPresentation({ storyboard: board, profile });
  const item = found.find((f) => f.kind === 'degenerate-share');
  assert.ok(item, 'not flagged');
  assert.equal(item.repair.op, 'chart_type');
  assert.ok(['bar', 'hbar'].includes(item.repair.chart_type));
});

test('a donut of forty is a colour wheel', () => {
  const board = [slide({ chart_type: 'donut', rows: new Array(40).fill({}) })];
  assert.ok(auditPresentation({ storyboard: board, profile }).some((f) => f.kind === 'degenerate-share'));
});

test('a donut of five is left alone', () => {
  const board = [slide({ chart_type: 'donut' })];
  assert.ok(!auditPresentation({ storyboard: board, profile }).some((f) => f.kind === 'degenerate-share'));
});

test('one colour per bar on one series encodes nothing', () => {
  const board = [slide({ colorBy: 'category', rows: new Array(30).fill({}) })];
  const item = auditPresentation({ storyboard: board, profile }).find((f) => f.kind === 'rainbow');
  assert.equal(item.repair.colorBy, 'series');
});

test('a heading that names the operation is flagged for rewriting, not for repair', () => {
  // The defect is mechanical; the fix is a sentence. Those go to different
  // places, which is the whole reason the two halves are separate.
  const board = [slide({ title: 'Sum of Total Amount by Region' })];
  const item = auditPresentation({ storyboard: board, profile }).find((f) => f.kind === 'operation-title');
  assert.equal(item.repair, null);
  assert.ok(item.rewrite);
});

test('a heading that says what the chart shows is not an operation name', () => {
  // "Distribution of Units Sold" reads like "Sum of Units Sold" and is not the
  // same thing: it names the spread the chart draws. Shortening it produced
  // "Units Sold", a heading that no longer says what the chart is, which is how
  // this rule lost two of its entries.
  for (const title of ['Distribution of Units Sold', 'Share of Revenue by Region']) {
    const found = auditPresentation({ storyboard: [slide({ title })], profile });
    assert.ok(!found.some((f) => f.kind === 'operation-title'), title);
  }
});

test('a heading that gets clipped on screen is flagged', () => {
  const long = 'Total Amount by Customer Age Group and Payment Mode Segment';
  const found = auditPresentation({ storyboard: [slide({ title: long })], profile });
  assert.ok(found.some((f) => f.kind === 'long-title'));
});

test('two slides under one heading is a deck nobody can navigate', () => {
  const board = [slide({ id: 'c1' }), slide({ id: 'c2' })];
  assert.ok(auditPresentation({ storyboard: board, profile }).some((f) => f.kind === 'duplicate-title'));
});

test('one measure at two scales is disclosed, never repaired', () => {
  // This is the defect that shipped: a rate drawn as 0.12% on one chart and 2.4
  // on another. The audit can see it and must not "fix" it — the disagreement
  // is in the planner, and a repair here would invent which of the two is meant.
  const board = [
    slide({ id: 'c1', measure: 'Shipping Cost Rate', rows: [{ 'Shipping Cost Rate': 0.0009 }, { 'Shipping Cost Rate': 0.0012 }] }),
    slide({ id: 'c2', title: 'Shipping Cost Rate by Category', measure: 'Shipping Cost Rate', rows: [{ 'Shipping Cost Rate': 2.3 }, { 'Shipping Cost Rate': 1.8 }] }),
  ];
  const item = auditPresentation({ storyboard: board, profile }).find((f) => f.kind === 'unit-disagreement');
  assert.ok(item, 'the two scales were not noticed');
  assert.equal(item.repair, null, 'it must not repair a disagreement it cannot resolve');
  assert.match(item.question, /Which is the figure to quote/);
});

test('one measure at one scale is not a disagreement', () => {
  const board = [
    slide({ id: 'c1', measure: 'Shipping Cost Rate', rows: [{ 'Shipping Cost Rate': 0.0009 }, { 'Shipping Cost Rate': 0.0012 }] }),
    slide({ id: 'c2', title: 'Other', measure: 'Shipping Cost Rate', rows: [{ 'Shipping Cost Rate': 0.004 }, { 'Shipping Cost Rate': 0.006 }] }),
  ];
  assert.ok(!auditPresentation({ storyboard: board, profile }).some((f) => f.kind === 'unit-disagreement'));
});

test('the same figure twice on the strip costs a quarter of it', () => {
  const kpis = [
    { label: 'Average Total Amount', value: '23.7K' },
    { label: 'Average Order Value', value: '23.7K' },
    { label: 'Records', value: '250.0K' },
  ];
  const item = auditPresentation({ storyboard: [], kpis, profile }).find((f) => f.kind === 'duplicate-kpi');
  assert.equal(item.repair.index, 1, 'the second one goes, not the first');
});

// ---------------------------------------------------------------------------
// Applying what it found
// ---------------------------------------------------------------------------

test('a mechanical fix lands the way a person\'s edit lands', () => {
  const board = [slide({ chart_type: 'donut', rows: new Array(2).fill({}) })];
  const audit = reviewDeck({ storyboard: board, profile });
  const out = applyRepairs({ storyboard: board, kpis: [], audit });
  assert.notEqual(out.storyboard[0].chart.chart_type, 'donut');
  // Through the same whitelist, recorded on the slide, so it shows as edited
  // and can be typed over.
  assert.ok(out.storyboard[0].edits.includes('chart.chart_type'));
  assert.equal(out.applied.length, 1);
});

test('removing repeated cards does not shift the ones still to go', () => {
  const kpis = [
    { label: 'A', value: '1' },
    { label: 'B', value: '1' },
    { label: 'C', value: '2' },
    { label: 'D', value: '2' },
  ];
  const audit = reviewDeck({ storyboard: [], kpis, profile });
  const out = applyRepairs({ storyboard: [], kpis, audit });
  assert.deepEqual(out.kpis.map((k) => k.label), ['A', 'C']);
});

test('no repair touches a number or a query', () => {
  const before = slide({ chart_type: 'donut', rows: new Array(2).fill({}), colorBy: 'category' });
  const audit = reviewDeck({ storyboard: [before], profile });
  const out = applyRepairs({ storyboard: [before], kpis: [], audit });
  assert.equal(out.storyboard[0].chart.sql, before.chart.sql);
  assert.equal(out.storyboard[0].chart.resultData, before.chart.resultData);
  assert.deepEqual(out.storyboard[0].findings, before.findings);
});

// ---------------------------------------------------------------------------
// The half that needs words
// ---------------------------------------------------------------------------

test('the model is handed the defects, not the deck', () => {
  const board = [
    slide({ id: 'c1', title: 'Sum of Total Amount by Region' }),
    slide({ id: 'c2', title: 'Revenue by month', dimension: 'Month' }),
  ];
  const targets = rewriteTargets(reviewDeck({ storyboard: board, profile }));
  assert.equal(targets.length, 1, 'the heading that was fine was not sent');
  assert.equal(targets[0].id, 'c1');
});

test('one slide with two faults is one target, with both reasons', () => {
  const board = [slide({ title: 'Sum of Total Amount by Customer Age Group and Payment Mode' })];
  const targets = rewriteTargets(reviewDeck({ storyboard: board, profile }));
  assert.equal(targets.length, 1);
  assert.match(targets[0].why, /operation/);
  assert.match(targets[0].why, /clipped/);
});

test('with no provider, the floor only removes words that carry nothing', () => {
  assert.equal(shortenTitle('Sum of Total Amount by Region'), 'Total Amount by Region');
  assert.equal(shortenTitle('Revenue by Region (top 10)'), 'Revenue by Region');
  // It will not paraphrase, and it will not leave a fragment.
  assert.equal(shortenTitle('Total Amount by Customer Age Group'), null);
  assert.equal(shortenTitle('Sum of Revenue'), null, 'a one-word heading is a fragment');
});

test('the floor never collides two headings', () => {
  const board = [
    slide({ id: 'c1', title: 'Total Amount by Region' }),
    slide({ id: 'c2', title: 'Sum of Total Amount by Region' }),
  ];
  const ops = fallbackRewrites(reviewDeck({ storyboard: board, profile }), board);
  assert.deepEqual(ops, [], 'shortening c2 would have duplicated c1');
});

// ---------------------------------------------------------------------------
// What is left over
// ---------------------------------------------------------------------------

test('what nothing can fix becomes a question, not a silent pass', () => {
  const board = [
    slide({ id: 'c1', measure: 'Rate', rows: [{ Rate: 0.001 }, { Rate: 0.002 }] }),
    slide({ id: 'c2', title: 'Rate by Category', measure: 'Rate', rows: [{ Rate: 2.3 }, { Rate: 1.8 }] }),
  ];
  const questions = openQuestions(reviewDeck({ storyboard: board, profile }));
  assert.equal(questions.length, 1);
  assert.equal(questions[0].source, 'audit');
  assert.ok(questions[0].question.endsWith('?'));
});

test('a clean deck produces nothing at all', () => {
  const board = [slide({ id: 'c1' }), slide({ id: 'c2', title: 'Revenue over time', dimension: 'Month', chart_type: 'line' })];
  const audit = reviewDeck({ storyboard: board, kpis: [{ label: 'A', value: '1' }], profile });
  assert.deepEqual(audit, []);
  assert.deepEqual(rewriteTargets(audit), []);
  assert.deepEqual(openQuestions(audit), []);
  const out = applyRepairs({ storyboard: board, kpis: [], audit });
  assert.deepEqual(out.storyboard, board, 'a deck with nothing wrong is returned untouched');
});
