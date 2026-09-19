import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_AVOID,
  MAX_KEY_MEASURES,
  acceptPurpose,
  orderByPurpose,
  purposeAvoids,
  purposeRanking,
  purposeScore,
} from '../lib/datasetPurpose.js';

/* What the table is for, and the contract that keeps a model honest about it.

   The planner used to rank dimensions by cardinality plus a list of English
   business words, and measures by the width of their numeric range. On a
   comparison of AI subscription plans that led with `Average Context Window` —
   a column counted in millions, identical on most rows, and the widest range in
   the file — while the prices and the two efficiency columns the file exists to
   compare went unreported.

   A model now says what the file is about. Everything it says is checked here
   first, because the whole safety argument is that it chooses the questions and
   the engine still computes every answer. */

const COLUMNS = [
  'Provider',
  'Plan Name',
  'Monthly Price USD',
  'Intelligence Index',
  'Intelligence per 100 USD',
  'Context Window',
  'Price Source URL',
  'As Of',
];

test('a column the model invented cannot reach the planner', () => {
  const purpose = acceptPurpose(
    {
      subject: 'a subscription plan',
      keyMeasures: ['Monthly Price USD', 'Total Revenue', 'Intelligence per 100 USD'],
      keyDimensions: ['Provider', 'Region'],
      avoid: ['Price Source URL', 'Imaginary Column'],
    },
    { columns: COLUMNS }
  );

  // `Total Revenue` and `Region` are not in this file. They are dropped, and
  // dropping them does not void the names that were right.
  assert.deepEqual(purpose.keyMeasures, ['Monthly Price USD', 'Intelligence per 100 USD']);
  assert.deepEqual(purpose.keyDimensions, ['Provider']);
  assert.deepEqual(purpose.avoid, ['Price Source URL']);
});

test('a name written loosely still resolves; a wrong one still does not', () => {
  const purpose = acceptPurpose(
    { keyMeasures: ['monthly price usd', 'context_window'], keyDimensions: ['  Provider  '] },
    { columns: COLUMNS }
  );
  // Case and spacing are forgiven, because refusing them throws away a correct
  // answer over punctuation.
  assert.deepEqual(purpose.keyMeasures, ['Monthly Price USD', 'Context Window']);
  assert.deepEqual(purpose.keyDimensions, ['Provider']);

  assert.equal(acceptPurpose({ keyMeasures: ['Montly Price'] }, { columns: COLUMNS }), null);
});

test('a column cannot be both the point and the plumbing', () => {
  const purpose = acceptPurpose(
    { keyMeasures: ['Monthly Price USD'], avoid: ['Monthly Price USD', 'As Of'] },
    { columns: COLUMNS }
  );
  // The deliberate pick wins over the bulk list: one careless entry in a long
  // `avoid` must not delete the best chart in the deck.
  assert.deepEqual(purpose.keyMeasures, ['Monthly Price USD']);
  assert.deepEqual(purpose.avoid, ['As Of']);
});

test('nothing usable is no purpose at all, which is the old behaviour', () => {
  assert.equal(acceptPurpose(null, { columns: COLUMNS }), null);
  assert.equal(acceptPurpose({}, { columns: COLUMNS }), null);
  assert.equal(acceptPurpose({ subject: 'a plan' }, { columns: COLUMNS }), null, 'prose alone changes nothing');
  assert.equal(acceptPurpose({ keyMeasures: ['x'] }, { columns: [] }), null);
});

test('lists are capped and de-duplicated', () => {
  const many = Array.from({ length: 40 }, () => 'Provider');
  const purpose = acceptPurpose({ keyDimensions: many, avoid: COLUMNS.slice(1) }, { columns: COLUMNS });
  assert.deepEqual(purpose.keyDimensions, ['Provider']);
  assert.ok(purpose.avoid.length <= MAX_AVOID);

  const wide = acceptPurpose({ keyMeasures: COLUMNS }, { columns: COLUMNS });
  assert.ok(wide.keyMeasures.length <= MAX_KEY_MEASURES);
});

test('the purpose outweighs the statistics it is there to overrule', () => {
  const ranking = purposeRanking(
    acceptPurpose(
      {
        keyMeasures: ['Intelligence per 100 USD', 'Monthly Price USD'],
        keyDimensions: ['Provider'],
        avoid: ['Price Source URL', 'As Of'],
      },
      { columns: COLUMNS }
    )
  );

  // The planner's own dimension score runs about -5 to +5. A named column has
  // to beat that band outright, or the statistics it is there to overrule would
  // still decide.
  assert.ok(purposeScore(ranking, 'Provider', 'dimension') > 5);
  assert.ok(purposeScore(ranking, 'Intelligence per 100 USD', 'measure') > 5);

  // First pick outranks second.
  assert.ok(
    purposeScore(ranking, 'Intelligence per 100 USD', 'measure') >
      purposeScore(ranking, 'Monthly Price USD', 'measure')
  );

  // Named as a measure is not named as a dimension.
  assert.equal(purposeScore(ranking, 'Monthly Price USD', 'dimension'), 0);

  // A column nobody mentioned is left exactly where the statistics put it.
  assert.equal(purposeScore(ranking, 'Context Window', 'measure'), 0);

  // Plumbing is pushed below everything, decisively.
  assert.ok(purposeScore(ranking, 'Price Source URL', 'dimension') < -10);
  assert.ok(purposeAvoids(ranking, 'As Of'));
  assert.ok(!purposeAvoids(ranking, 'Provider'));
});

test('with no purpose, the order is whatever it was before', () => {
  const ranking = purposeRanking(null);
  const bySpread = (a, b) => ({ A: 1, B: 3, C: 2 })[b] - ({ A: 1, B: 3, C: 2 })[a];

  assert.equal(purposeScore(ranking, 'anything', 'measure'), 0);
  assert.equal(purposeAvoids(ranking, 'anything'), false);
  assert.deepEqual(orderByPurpose(['A', 'B', 'C'], ranking, 'measure', bySpread), ['B', 'C', 'A']);
});

test('the reader gets the measure they came for, not the widest column', () => {
  const ranking = purposeRanking(
    acceptPurpose({ keyMeasures: ['Monthly Price USD'] }, { columns: COLUMNS })
  );

  // This is the shipped failure, in one line: Context Window has by far the
  // widest range (180K to 1M) and Monthly Price USD does not, so ranking on
  // spread alone put the boring column first.
  const spread = { 'Context Window': 820000, 'Monthly Price USD': 2500, 'Intelligence Index': 39 };
  const bySpread = (a, b) => spread[b] - spread[a];

  assert.deepEqual(
    orderByPurpose(Object.keys(spread), ranking, 'measure', bySpread),
    ['Monthly Price USD', 'Context Window', 'Intelligence Index']
  );
});

/* And the planner itself, on the shape of the file that motivated all this.
   `analystPlanner` is heavy, so it is imported lazily. */
const { planCharts, planKpis } = await import('../lib/analystPlanner.js');

/** A miniature of the AI-plans file: the same trap, in twelve rows. */
function plansTable() {
  const providers = ['OpenAI', 'Anthropic', 'Google', 'xAI'];
  const rows = [];
  for (let i = 0; i < 12; i++) {
    rows.push({
      Provider: providers[i % providers.length],
      'Plan Name': `Plan ${i}`,
      // Prices vary a lot in meaning and little in absolute size.
      'Monthly Price USD': [0, 20, 100, 200][i % 4] + i,
      'Intelligence Index': 30 + (i % 25),
      'Intelligence per 100 USD': 40 + (i % 60) * 3,
      // The trap: counted in tokens, nearly constant, widest range in the file.
      'Context Window': i % 5 === 0 ? 200000 : 1000000,
      'Price Source URL': `https://example.com/pricing/${i}`,
    });
  }
  return rows;
}

const yKeys = (charts) => charts.map((c) => c.yAxisKey).filter(Boolean);

test('the planner charts what the file is for, not what has the widest range', () => {
  const rows = plansTable();
  const columns = Object.keys(rows[0]);
  const purpose = acceptPurpose(
    {
      subject: 'a subscription plan offered by an AI vendor',
      keyMeasures: ['Intelligence per 100 USD', 'Monthly Price USD'],
      keyDimensions: ['Provider'],
      avoid: ['Price Source URL'],
    },
    { columns }
  );

  const without = planCharts(rows, { max: 6 });
  const with_ = planCharts(rows, { max: 6, purpose });

  // The efficiency column is the point of this file. Nothing in the statistics
  // says so, which is exactly why the old planner never charted it.
  // Case-insensitive: the planner title-cases its own aliases, so the column
  // comes back as "Average Intelligence Per 100 USD".
  const mentions = (charts, col) => {
    const needle = col.toLowerCase();
    return charts.some(
      (c) =>
        String(c.yAxisKey || '').toLowerCase().includes(needle) ||
        String(c.title || '').toLowerCase().includes(needle)
    );
  };

  assert.ok(
    mentions(with_, 'Intelligence per 100 USD'),
    `the purpose-led plan never charted the efficiency column: ${JSON.stringify(yKeys(with_))}`
  );

  // And the plumbing is off the report entirely, in either direction.
  const grouped = with_.map((c) => c.xAxisKey).filter(Boolean);
  assert.ok(!grouped.includes('Price Source URL'), 'a source URL was used as a category');

  // The comparison is the point of the test, so it is stated rather than
  // implied: this is a change in what gets planned, not a no-op.
  assert.notDeepEqual(yKeys(with_), yKeys(without));
});

test('the KPI strip drops what the purpose calls plumbing', () => {
  /**
   * Built so the statistics pick the wrong card on their own.
   *
   * `Context Window` here swings from a thousand to a million — the highest
   * relative variation in the table — so the strip chooses it on the numbers,
   * which is exactly how the shipped report came to open with "Average Context
   * Window 753.2K". The purpose is the only thing that knows it is a boring
   * column in a file about what things cost.
   */
  const rows = [];
  for (let i = 0; i < 12; i++) {
    rows.push({
      Provider: ['OpenAI', 'Anthropic', 'Google', 'xAI'][i % 4],
      'Monthly Price USD': 100 + (i % 3),
      'Context Window': i % 2 === 0 ? 1000 : 1000000,
      'Price Source URL': `https://example.com/${i}`,
    });
  }
  const columns = Object.keys(rows[0]);
  const labels = (kpis) => kpis.map((k) => k.label);

  const without = labels(planKpis(rows));
  assert.ok(
    without.some((l) => /context window/i.test(l)),
    `the fixture does not reproduce the trap: ${JSON.stringify(without)}`
  );

  const purpose = acceptPurpose(
    { keyMeasures: ['Monthly Price USD'], avoid: ['Price Source URL', 'Context Window'] },
    { columns }
  );
  const with_ = labels(planKpis(rows, { purpose }));

  assert.ok(
    !with_.some((l) => /context window/i.test(l)),
    `a column the purpose called plumbing is still a headline: ${JSON.stringify(with_)}`
  );
  assert.ok(
    with_.some((l) => /monthly price/i.test(l)),
    `the measure the reader came for is missing: ${JSON.stringify(with_)}`
  );
});

test('no purpose plans exactly what it planned before', () => {
  const rows = plansTable();
  assert.deepEqual(yKeys(planCharts(rows, { max: 6, purpose: null })), yKeys(planCharts(rows, { max: 6 })));
  assert.deepEqual(
    planKpis(rows, { purpose: null }).map((k) => k.label),
    planKpis(rows).map((k) => k.label)
  );
});
