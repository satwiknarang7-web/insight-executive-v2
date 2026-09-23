import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_COMPOSED, acceptChart, acceptDeck } from '../lib/deckComposer.js';

/* The pass that lets a model choose the charts, and the gate that makes it safe.

   Every other model pass in this app is narrow: the unit pass names columns, the
   purpose pass names columns, the analyst pass reorders a finished deck. The
   charts themselves were chosen by a few hundred rules, which is why the
   ten-dataset evaluation found the planner dependable on the shapes those rules
   were written for and lost on the ones they were not.

   What does NOT change is the contract: the model chooses the questions, the
   engine computes every answer. This module is that contract, so each of its
   refusals is tested — and so is the case where a good chart sits beside a bad
   one, because dropping the whole deck over one bad query would make the pass
   useless. */

const COLUMNS = ['Provider', 'Plan Name', 'Audience', 'Monthly Price USD', 'Intelligence Index'];

const chart = (over = {}) => ({
  title: 'Average price by provider',
  chart_type: 'bar',
  sql:
    'SELECT [Provider], AVG([Monthly Price USD]) AS [Average Price] FROM SalesData ' +
    'GROUP BY [Provider] ORDER BY [Average Price] DESC LIMIT 10',
  xAxisKey: 'Provider',
  yAxisKey: 'Average Price',
  dimension: 'Provider',
  intent: 'What each vendor charges.',
  ...over,
});

const accept = (over) => acceptChart(chart(over), { columns: COLUMNS });

test('a sound chart is accepted, with its own id and its provenance on it', () => {
  const { chart: out, problem } = accept();
  assert.equal(problem, undefined);
  assert.equal(out.chart_type, 'bar');
  assert.equal(out.xAxisKey, 'Provider');
  assert.equal(out.dimension, 'Provider');
  // A reader is entitled to know which pass chose their charts.
  assert.equal(out.composedBy, 'model');
  assert.ok(out.id);
  // Said before any data was seen, so it is kept apart from the findings the
  // engine writes from the results.
  assert.equal(out.intent, 'What each vendor charges.');
});

test('a column the table does not have takes its chart with it', () => {
  /* The check `/api/ask` never had, and the one that matters most: a model that
     writes `[Total Revenue]` on a table without one produces a query that fails
     at runtime or, worse, an empty chart under a confident title. */
  const { problem } = accept({
    sql: 'SELECT [Provider], SUM([Total Revenue]) AS [T] FROM SalesData GROUP BY [Provider]',
    yAxisKey: 'T',
  });
  assert.match(problem, /no column called "Total Revenue"/);
});

test('an alias the query defined is not an invented column', () => {
  // `AS [Average Price]` introduces a name the rest of the query may use, and
  // the ORDER BY above does exactly that.
  assert.equal(accept().problem, undefined);
  const { problem } = accept({
    sql:
      'SELECT [Audience], SUM([Monthly Price USD]) AS [Total] FROM SalesData ' +
      'GROUP BY [Audience] HAVING [Total] > 0 ORDER BY [Total] DESC LIMIT 10',
    xAxisKey: 'Audience',
    yAxisKey: 'Total',
  });
  assert.equal(problem, undefined);
});

test('case and spacing are forgiven, because refusing them throws away a right answer', () => {
  const { problem, chart: out } = accept({
    sql: 'SELECT [provider], AVG([monthly price usd]) AS [Avg] FROM SalesData GROUP BY [provider]',
    xAxisKey: 'provider',
    yAxisKey: 'Avg',
  });
  assert.equal(problem, undefined);
  assert.ok(out);
});

test('anything that is not one read-only SELECT is refused', () => {
  for (const sql of [
    'DROP TABLE SalesData',
    'DELETE FROM SalesData',
    'SELECT * FROM SalesData; DROP TABLE SalesData',
    'WITH x AS (SELECT 1) SELECT * FROM x',
    'ATTACH FILE("/etc/passwd")',
  ]) {
    assert.ok(accept({ sql }).problem, `accepted: ${sql}`);
  }
});

test('a shape this app cannot draw is refused rather than silently drawn as a bar', () => {
  /* `canonicalType` answers 'bar' for anything it cannot place — right for a
     person's typo in the chart picker, wrong here. A model asking for a sankey
     has misunderstood the instruction, and a bar chart under its title hides
     that from everyone. */
  assert.match(accept({ chart_type: 'sankey' }).problem, /cannot draw a sankey/);
  assert.match(accept({ chart_type: '' }).problem, /cannot draw/);
  // And the ones it can: by their own name, or by a phrasing it maps.
  for (const t of ['bar', 'hbar', 'line', 'area', 'donut', 'treemap', 'scatter', 'waterfall', 'radar']) {
    assert.equal(accept({ chart_type: t }).problem, undefined, t);
  }
  assert.equal(accept({ chart_type: 'horizontal bar' }).chart.chart_type, 'hbar');
});

test('a slicer is not a chart a model composes', () => {
  // A filter tile is not a finding, and it is planned from the columns rather
  // than from a query.
  assert.match(accept({ chart_type: 'slicer' }).problem, /slicers are not composed/);
});

test('a chart with no title, no query or no axes is refused', () => {
  assert.match(accept({ title: '' }).problem, /no title/);
  assert.match(accept({ sql: '' }).problem, /no query/);
  assert.match(accept({ xAxisKey: '' }).problem, /no axes/);
  assert.match(accept({ yAxisKey: '   ' }).problem, /no axes/);
  assert.match(acceptChart(null, { columns: COLUMNS }).problem, /not an object/);
});

test('one bad chart costs one chart, not the deck', () => {
  const deck = acceptDeck(
    {
      charts: [
        chart(),
        chart({ title: 'Invented', sql: 'SELECT [Nope] FROM SalesData GROUP BY [Nope]', yAxisKey: 'Nope' }),
        chart({
          title: 'Price by audience',
          sql:
            'SELECT [Audience], AVG([Monthly Price USD]) AS [Avg] FROM SalesData ' +
            'GROUP BY [Audience] ORDER BY [Avg] DESC LIMIT 10',
          xAxisKey: 'Audience',
          yAxisKey: 'Avg',
        }),
      ],
    },
    { columns: COLUMNS }
  );
  assert.deepEqual(deck.charts.map((c) => c.title), ['Average price by provider', 'Price by audience']);
  // Reported rather than swallowed: a pass whose failures are invisible cannot
  // be improved.
  assert.equal(deck.skipped.length, 1);
  assert.match(deck.skipped[0], /Invented/);
});

test('the same query twice is one chart', () => {
  const deck = acceptDeck([chart(), chart({ title: 'A second name for it' })], { columns: COLUMNS });
  assert.equal(deck.charts.length, 1);
  assert.match(deck.skipped[0], /the same query as an earlier chart/);
});

test('nothing usable is no deck at all, which is the planner as it stands', () => {
  assert.equal(acceptDeck([{ title: 'x' }], { columns: COLUMNS }), null);
  assert.equal(acceptDeck(null, { columns: COLUMNS }), null);
  assert.equal(acceptDeck({ charts: [] }, { columns: COLUMNS }), null);
  // No columns means nothing can be checked, so nothing is accepted.
  assert.equal(acceptDeck([chart()], { columns: [] }), null);
});

test('the deck is capped', () => {
  const many = Array.from({ length: MAX_COMPOSED + 6 }, (_, i) =>
    chart({
      title: `Chart ${i}`,
      sql: `SELECT [Provider], COUNT(*) AS [n${i}] FROM SalesData GROUP BY [Provider] LIMIT ${10 + i}`,
      yAxisKey: `n${i}`,
    })
  );
  const deck = acceptDeck(many, { columns: COLUMNS });
  assert.equal(deck.charts.length, MAX_COMPOSED);
  assert.ok(deck.skipped.length >= 6);
});

/* And what the engine does with one, which is the whole point. */

test('a composed chart is executed, graded and critiqued like a planned one', async () => {
  const { runAnalysis } = await import('../lib/pipeline.js');
  const rows = Array.from({ length: 200 }, (_, i) => ({
    region: ['North', 'South', 'East'][i % 3],
    category: ['A', 'B'][i % 2],
    revenue: 100 + (i % 70) * 13,
    units: 1 + (i % 9),
  }));
  const deck = acceptDeck(
    [
      {
        title: 'Where the revenue is',
        chart_type: 'hbar',
        sql:
          'SELECT [region], SUM([revenue]) AS [Total Revenue] FROM SalesData ' +
          'GROUP BY [region] ORDER BY [Total Revenue] DESC LIMIT 10',
        xAxisKey: 'region',
        yAxisKey: 'Total Revenue',
        dimension: 'region',
      },
    ],
    { columns: Object.keys(rows[0]) }
  );

  // A composed deck is the playbook's; on the question path a model proposes
  // questions instead (lib/modelQuestions.js). Both go in phase 5 of
  // docs/design/question-first-reports.md.
  const result = runAnalysis(rows, { maxCharts: 6, composed: deck.charts, planner: 'playbook' });
  const mine = (result.charts || []).find((c) => c.title === 'Where the revenue is');
  assert.ok(mine, 'the composed chart never reached the deck');
  // Run against the reader's own rows by the same engine.
  assert.equal((mine.resultData || []).length, 3);

  const finding = (result.perChart || []).find((f) => f.title === 'Where the revenue is');
  assert.ok(finding, 'it was not analysed');
  // Graded on the same scale, and the sentence computed from the rows rather
  // than taken from the model.
  assert.ok(['thin', 'indicative', 'moderate', 'strong'].includes(finding.metrics.evidence));
  assert.match(finding.headline, /leads regions on total revenue/i);

  // And the planner still fills the rest of the deck.
  assert.ok((result.charts || []).some((c) => c.title !== 'Where the revenue is'));
});

test('an empty composition changes nothing', async () => {
  const { runAnalysis } = await import('../lib/pipeline.js');
  const rows = Array.from({ length: 150 }, (_, i) => ({
    region: ['North', 'South'][i % 2],
    revenue: 50 + (i % 40) * 11,
  }));
  const titles = (composed) => (runAnalysis(rows, { maxCharts: 6, composed }).charts || []).map((c) => c.title);
  assert.deepEqual(titles([]), titles(undefined));
});
