import test from 'node:test';
import assert from 'node:assert/strict';
import { runAnalysis } from '../lib/pipeline.js';
import { ANALYZE, stepIndexFor } from '../lib/progressSteps.js';

/**
 * The analysis reads its own output before handing it over.
 *
 * Until now the review ran after the deck was already on screen, so it could
 * describe a gap and never travel with the thing it described. These hold the
 * loop to two things: that it says what it is doing, and that what it found
 * leaves with the result.
 */

/** A monthly trend, a tier that explains churn, and an outcome worth charting. */
function orders({ rows = 900 } = {}) {
  const out = [];
  for (let i = 0; i < rows; i++) {
    const month = `2025-${String((i % 12) + 1).padStart(2, '0')}-15`;
    const tier = ['Free', 'Pro', 'Enterprise'][i % 3];
    out.push({
      Order_Date: month,
      Plan_Tier: tier,
      Region: ['North', 'South', 'East'][i % 3],
      Revenue: 100 + (i % 12) * 90,
      // Churn is strongly explained by tier, so a chart of it is a real finding.
      churned: tier === 'Free' ? (i % 10 < 6 ? 'Yes' : 'No') : i % 10 < 1 ? 'Yes' : 'No',
    });
  }
  return out;
}

const run = (rows, opts = {}) => {
  const stages = [];
  const result = runAnalysis(rows, {
    ...opts,
    onProgress: ({ stage, percent }) => stages.push({ stage, percent }),
  });
  return { result, stages };
};

test('the loading screen is told every stage the engine runs', () => {
  const { stages } = run(orders());
  const names = stages.map((s) => s.stage);
  for (const expected of [
    'Planning charts',
    'Running queries',
    'Verifying the maths',
    'Reviewing the deck',
    'Writing the report',
  ]) {
    assert.ok(names.includes(expected), `never announced "${expected}"`);
  }
});

test('the engine does not announce Ready, because it is not the last thing to run', () => {
  // The deck is BUILT here and finished two steps later, in the provider, where
  // the presentation audit repairs it and A2 rewrites what a rule cannot. The
  // worker cannot reach a model, so those steps cannot live here — and a
  // 'Ready' at this point ticks the panel's last box while a customer still has
  // two passes to wait for.
  const { stages } = run(orders());
  assert.ok(!stages.some((s) => s.stage === 'Ready'), 'the engine claimed the job was finished');
});

test('every stage belongs to a step the panel can show', () => {
  // A stage the plan does not claim leaves the checklist stuck on whichever
  // step it was on, which is worse than showing nothing.
  const { stages } = run(orders());
  for (const { stage } of stages) {
    assert.ok(stepIndexFor(ANALYZE, stage) >= 0, `no step claims "${stage}"`);
  }
});

test('the stages run forwards', () => {
  const { stages } = run(orders());
  let last = -1;
  for (const { percent } of stages) {
    assert.ok(percent >= last, `progress went backwards to ${percent}`);
    last = percent;
  }
  // Short of 100 on purpose: the last stretch belongs to the repair pass.
  const handover = stages.at(-1).percent;
  assert.ok(handover < 100, `the engine reached ${handover}% before the deck had been read back`);
  assert.ok(handover >= 80, `the engine stopped at ${handover}%, which leaves the bar looking stalled`);
});

test('an outcome reaches even a two-slide deck, so the gap cannot open', () => {
  // Worth pinning, because it is the reason the review repairs nothing. An
  // outcome chart carries a base score of 98, second only to the time trend, so
  // it survives selection at any deck size above one. The athlete export failed
  // because the outcome was never DETECTED, not because its charts lost — and a
  // repair written for the losing case never fired on any fixture, including a
  // uniform outcome and a two-slide deck.
  for (const maxCharts of [2, 4, 8]) {
    const { result } = run(orders(), { maxCharts });
    assert.ok(
      result.charts.some((c) => c.outcomeRate),
      `no chart of the outcome at maxCharts=${maxCharts}`
    );
    assert.ok(!result.critique.some((q) => q.kind === 'unused-outcome'));
  }
});

test('an outcome chart carries the query behind it', () => {
  const { result } = run(orders(), { maxCharts: 4 });
  const chart = result.charts.find((c) => c.outcomeRate);
  assert.ok(chart.sql);
  assert.ok(Array.isArray(chart.resultData) && chart.resultData.length > 0, 'the query ran');
  assert.match(chart.sql, /SUM\(CASE WHEN/);
});

test('the deck is verified once, because the review does not rewrite it', () => {
  const { stages } = run(orders(), { maxCharts: 8 });
  const verifies = stages.filter((s) => s.stage === 'Verifying the maths').length;
  assert.equal(verifies, 1, 'a review that rewrote the deck would verify twice');
});

test('the questions it could not answer come back with the result', () => {
  const { result } = run(orders(), { maxCharts: 3 });
  assert.ok(Array.isArray(result.critique));
  for (const q of result.critique) {
    assert.ok(q.question.trim().endsWith('?'));
    assert.equal(q.metrics, undefined, 'a question carries no statistics');
  }
});

test('a dataset with no outcome raises no outcome question', () => {
  const rows = Array.from({ length: 300 }, (_, i) => ({
    Region: ['North', 'South', 'East'][i % 3],
    Revenue: 100 + (i % 20) * 15,
    Units: 1 + (i % 7),
  }));
  const { result } = run(rows);
  assert.ok(!result.critique.some((q) => q.kind === 'unused-outcome'));
});
