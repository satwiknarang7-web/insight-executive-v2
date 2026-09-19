import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_PLAN_CHARTS,
  acceptDashboardPlan,
  columnGuidance,
  columnsFromSchema,
  dashboardBriefing,
} from '../lib/dashboardPlan.js';
import { describeSchema } from '../lib/dataCleaner.js';

/* Letting a model choose what the dashboard is about.

   The model nominates queries; this app runs them and reads the statistics
   itself. So everything worth testing here is about what gets through: a
   query that reaches a column nobody has is a query that cannot run, and a
   deck of the same chart eight times is one chart. */

const rows = [
  { Provider: 'OpenAI', Plan: 'Plus', 'Monthly Price USD': 20, 'Intelligence Index': 53 },
  { Provider: 'Anthropic', Plan: 'Pro', 'Monthly Price USD': 20, 'Intelligence Index': 51 },
  { Provider: 'xAI', Plan: 'SuperGrok', 'Monthly Price USD': 30, 'Intelligence Index': 44 },
];

test('the columns the model may reach are read back out of the schema it was shown', () => {
  const schema = describeSchema(rows);
  const columns = columnsFromSchema(schema);
  assert.deepEqual(columns.sort(), ['Intelligence Index', 'Monthly Price USD', 'Plan', 'Provider']);
});

test('a query reaching for a column nobody has is refused', () => {
  const columns = ['Provider', 'Monthly Price USD'];
  const { charts, rejected } = acceptDashboardPlan(
    {
      charts: [
        {
          title: 'Average price by provider',
          chart_type: 'bar',
          sql: 'SELECT [Provider], AVG([Monthly Price USD]) AS [Average Price] FROM SalesData GROUP BY [Provider]',
        },
        {
          title: 'Churn by segment',
          chart_type: 'bar',
          sql: 'SELECT [Segment], AVG([Churn Rate]) AS [Average Churn] FROM SalesData GROUP BY [Segment]',
        },
      ],
    },
    { columns }
  );

  assert.equal(charts.length, 1, 'the invented chart got through');
  assert.equal(charts[0].title, 'Average price by provider');
  assert.match(rejected.join(' '), /no column called/);
  assert.match(rejected.join(' '), /Segment/);
});

test('an alias the query declares is a legal name for the rest of it', () => {
  // `AVG([Price]) AS [Average Price]` then `ORDER BY [Average Price]` is correct
  // SQL, and the alias is not a column. Refusing it would reject every
  // well-formed query the prompt asks for.
  const { charts, rejected } = acceptDashboardPlan(
    {
      charts: [
        {
          title: 'Average price by provider',
          chart_type: 'bar',
          sql:
            'SELECT [Provider], AVG([Monthly Price USD]) AS [Average Monthly Price USD] FROM SalesData ' +
            'GROUP BY [Provider] ORDER BY [Average Monthly Price USD] DESC LIMIT 10',
        },
      ],
    },
    { columns: ['Provider', 'Monthly Price USD'] }
  );
  assert.equal(rejected.length, 0, rejected.join('; '));
  assert.equal(charts.length, 1);
});

test('a chart type the engine cannot draw is refused', () => {
  const { charts, rejected } = acceptDashboardPlan(
    { charts: [{ title: 'Sankey of flows', chart_type: 'sankey', sql: 'SELECT [Provider] FROM SalesData' }] },
    { columns: ['Provider'] }
  );
  assert.equal(charts.length, 0);
  assert.match(rejected.join(' '), /not a chart this engine draws/);
});

test('the same query twice is one chart', () => {
  const sql = 'SELECT [Provider], AVG([Monthly Price USD]) AS [Avg] FROM SalesData GROUP BY [Provider]';
  const { charts, rejected } = acceptDashboardPlan(
    {
      charts: [
        { title: 'Price by provider', chart_type: 'bar', sql },
        { title: 'What each provider charges', chart_type: 'hbar', sql: `  ${sql.toUpperCase()}  ` },
      ],
    },
    { columns: ['Provider', 'Monthly Price USD'] }
  );
  assert.equal(charts.length, 1, 'the same question got asked twice');
  assert.match(rejected.join(' '), /same query/);
});

test('a deck is bounded, and junk in does not throw', () => {
  const sqlFor = (i) => `SELECT [Provider], AVG([Monthly Price USD]) AS [A${i}] FROM SalesData GROUP BY [Provider]`;
  const many = { charts: Array.from({ length: 30 }, (_, i) => ({ title: `Chart ${i}`, chart_type: 'bar', sql: sqlFor(i) })) };
  assert.equal(acceptDashboardPlan(many, { columns: ['Provider', 'Monthly Price USD'] }).charts.length, MAX_PLAN_CHARTS);
  assert.equal(acceptDashboardPlan(many, { columns: ['Provider', 'Monthly Price USD'], max: 3 }).charts.length, 3);

  for (const junk of [null, undefined, {}, [], 'nope', { charts: 'nope' }, { charts: [null, 3, {}] }]) {
    const out = acceptDashboardPlan(junk, { columns: ['Provider'] });
    assert.ok(Array.isArray(out.charts), `threw on ${JSON.stringify(junk)}`);
  }
});

test('the briefing carries the schema, the reader intent, and no data', () => {
  const schema = describeSchema(rows);
  const prompt = dashboardBriefing({
    schema,
    intent: 'Deciding which AI subscription to buy for each engineer',
    rowCount: 44,
  });

  assert.match(prompt, /Intelligence Index/, 'the model cannot chart a column it was not shown');
  assert.match(prompt, /which AI subscription to buy/, 'the reader said what they wanted and it was dropped');
  assert.match(prompt, /44 rows/);
  assert.match(prompt, /never state a number/i, 'the one rule that makes the output checkable');
  assert.match(prompt, /never summed/i, 'summing a price is the mistake this whole pass exists to avoid');

  // Intent is optional: a dashboard that cannot be built without an essay is
  // one nobody waits for.
  const bare = dashboardBriefing({ schema });
  assert.doesNotMatch(bare, /WHAT THE READER IS TRYING TO DECIDE/);
  assert.match(bare, /Intelligence Index/);
});

test('the model is handed what this app already worked out about the columns', () => {
  // The difference between asking a model to guess the rules and giving it the
  // tools. A raw schema says "DECIMAL"; it does not say this pair is quoted in
  // two currencies and must never be combined.
  const guidance = columnGuidance({
    profile: { measures: ['Monthly Price USD', 'Intelligence Index', 'Min Seats', 'Monthly Price Local Currency'] },
    denominated: ['Monthly Price Local Currency'],
    provenance: ['Price Source URL'],
  });

  assert.match(guidance, /Monthly Price Local Currency: DO NOT AGGREGATE/);
  assert.match(guidance, /Monthly Price USD: average, never sum/);
  assert.match(guidance, /Intelligence Index: average, never sum/);
  assert.match(guidance, /Price Source URL: records where the row came from/);

  // A quantity that really can be added up is not lectured about.
  assert.doesNotMatch(guidance, /Min Seats/);

  // And a column already refused outright is not also told to average itself.
  const denomLines = guidance.split('\n').filter((l) => /Monthly Price Local Currency/.test(l));
  assert.equal(denomLines.length, 1, 'the denominated column got two contradictory instructions');

  const prompt = dashboardBriefing({ schema: 'Table: SalesData', guidance });
  assert.match(prompt, /DO NOT AGGREGATE/, 'the guidance never reached the model');
});

test('nothing worth saying means nothing is said', () => {
  // A brief full of caveats about ordinary columns is one nobody reads to the end.
  const quiet = columnGuidance({ profile: { measures: ['Units', 'Revenue'] } });
  assert.equal(quiet, '');
  assert.doesNotMatch(dashboardBriefing({ schema: 'Table: SalesData', guidance: quiet }), /ALREADY WORKED OUT/);
});
