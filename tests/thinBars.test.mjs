import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeChart } from '../lib/insightEngine.js';

/* An average is only as good as the count behind it.

   From the shipped report: "Average Min Seats by Audience", badged STRONG
   EVIDENCE, with its leading bar reading 300. Exactly one row in the file has a
   seat minimum of 300 — Microsoft's enterprise tier — and the other rows in
   that group have no value at all, so the bar was an average of one number.

   The tier was reading `sourceRows / barCount`, a mean: forty-four rows over
   three bars said fifteen, no penalty applied, and the card asserted strong
   evidence for a statistic computed from a single observation. The mean is the
   wrong statistic for the question, because a mean is exactly what hides the
   bar resting on one row. */

/** The chart as the planner now builds it, with its support counts lifted. */
const chart = (support) => ({
  id: 'c1',
  title: 'Average Min Seats by Audience',
  chart_type: 'bar',
  xAxisKey: 'Audience',
  yAxisKey: 'Average Min Seats',
  dimension: 'Audience',
  measure: 'Min Seats',
  resultData: [
    { Audience: 'Enterprise', 'Average Min Seats': 300 },
    { Audience: 'Business', 'Average Min Seats': 2 },
    { Audience: 'Individual', 'Average Min Seats': 1 },
  ],
  ...(support ? { support } : {}),
});

test('a bar resting on one value is not strong evidence', () => {
  const thin = analyzeChart(
    chart({ byLabel: { Enterprise: 1, Business: 7, Individual: 31 }, min: 1, max: 31, leader: 1 }),
    44
  );

  assert.notEqual(thin.metrics.evidence, 'strong', 'an average of one number was called strong evidence');

  // And it says so, rather than only scoring it down. Someone deciding whether
  // to act on this ranking is owed the reason.
  assert.ok(
    thin.metrics.evidenceNotes.some((n) => /thinnest bar averages 1 value/i.test(n)),
    `the thin bar was never mentioned: ${JSON.stringify(thin.metrics.evidenceNotes)}`
  );
});

test('the same chart with real support behind every bar keeps its tier', () => {
  const solid = analyzeChart(
    chart({ byLabel: { Enterprise: 14, Business: 15, Individual: 15 }, min: 14, max: 15, leader: 14 }),
    44
  );

  // The point is not that averages by category are suspect — it is that thin
  // ones are. Where every bar rests on a dozen values, nothing is deducted.
  assert.ok(
    ['strong', 'moderate'].includes(solid.metrics.evidence),
    `a well-supported ranking was downgraded: ${solid.metrics.evidence}`
  );
  assert.ok(!solid.metrics.evidenceNotes.some((n) => /thinnest bar/i.test(n)));
});

test('a chart whose query carries no counts is judged exactly as before', () => {
  // Most charts do not carry support — a sum by category, a trend, a
  // distribution. Those have to be unaffected, or this change would reach far
  // beyond the thing it is for.
  const before = analyzeChart(chart(null), 44);
  assert.ok(before.metrics.evidence, 'a chart without support produced no tier at all');
  assert.ok(!before.metrics.evidenceNotes.some((n) => /thinnest bar/i.test(n)));
});

test('the support column is lifted out, never drawn', async () => {
  const { liftSupport } = await import('../lib/pipeline.js');
  const { SUPPORT_KEY } = await import('../lib/aggregateNames.js');

  const spec = { xAxisKey: 'Audience', supportKey: SUPPORT_KEY };
  const rows = [
    { Audience: 'Enterprise', 'Average Min Seats': 300, [SUPPORT_KEY]: 1 },
    { Audience: 'Individual', 'Average Min Seats': 1, [SUPPORT_KEY]: 31 },
  ];

  const cleaned = liftSupport(spec, rows);

  // Lifted, not left in: a second numeric column in the results is a second
  // measure to `extractSeries` and a second series to a legend.
  for (const row of cleaned) assert.ok(!(SUPPORT_KEY in row), 'the support column was drawn as data');
  assert.deepEqual(Object.keys(cleaned[0]), ['Audience', 'Average Min Seats']);

  assert.equal(spec.support.min, 1);
  assert.equal(spec.support.max, 31);
  // The leader is the first row, because the query orders by the measure.
  assert.equal(spec.support.leader, 1);
  assert.equal(spec.support.byLabel.Enterprise, 1);
  assert.equal(spec.supportKey, undefined, 'the marker outlived the lift');
});

test('a chart that carries no support column passes through untouched', async () => {
  const { liftSupport } = await import('../lib/pipeline.js');
  const rows = [{ a: 1 }, { a: 2 }];
  const spec = { xAxisKey: 'a' };
  assert.equal(liftSupport(spec, rows), rows, 'rows were copied for no reason');
  assert.equal(spec.support, undefined);
});

test('a category with no values behind it is not drawn at all', async () => {
  const { liftSupport } = await import('../lib/pipeline.js');
  const { SUPPORT_KEY } = await import('../lib/aggregateNames.js');

  /* GROUP BY returns a row for every category that exists; AVG over a group
     whose measure is null on every row returns null. So the results carry a
     category with no value, and the chart drew it as a bar of nothing.

     On the file this came from, two vendors quote no price and eight of
     forty-four rows name no flagship model, and "Cursor", "Perplexity" and an
     empty label were all on the axis. Nobody had noticed, because until the
     count was carried there was nothing in the result that said so. */
  const spec = { xAxisKey: 'Provider', yAxisKey: 'Average Price', supportKey: SUPPORT_KEY };
  const rows = [
    { Provider: 'OpenAI', 'Average Price': 100, [SUPPORT_KEY]: 5 },
    { Provider: 'Cursor', 'Average Price': null, [SUPPORT_KEY]: 0 },
    { Provider: 'Perplexity', [SUPPORT_KEY]: 0 },
    { Provider: 'Anthropic', 'Average Price': 40, [SUPPORT_KEY]: 3 },
  ];

  const cleaned = liftSupport(spec, rows);
  assert.deepEqual(cleaned.map((r) => r.Provider), ['OpenAI', 'Anthropic']);
  // And the empty groups are not counted against the chart's evidence either:
  // a bar that is not drawn is not the thinnest bar.
  assert.equal(spec.support.min, 3);
  assert.equal(spec.support.byLabel.Cursor, undefined);
});

test('a real zero is kept, because zero is a value', () => {
  // The distinction the check turns on. A free plan priced at 0 rests on real
  // rows and belongs on the chart; only a group with no rows to average goes.
  return import('../lib/pipeline.js').then(async ({ liftSupport }) => {
    const { SUPPORT_KEY } = await import('../lib/aggregateNames.js');
    const spec = { xAxisKey: 'Plan', yAxisKey: 'Average Price', supportKey: SUPPORT_KEY };
    const cleaned = liftSupport(spec, [
      { Plan: 'Free', 'Average Price': 0, [SUPPORT_KEY]: 9 },
      { Plan: 'Pro', 'Average Price': 20, [SUPPORT_KEY]: 4 },
    ]);
    assert.deepEqual(cleaned.map((r) => r.Plan), ['Free', 'Pro']);
  });
});
