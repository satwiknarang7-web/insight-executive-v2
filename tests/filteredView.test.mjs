import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyFiltered, clearFiltered } from '../lib/filteredView.js';

/**
 * The deck under a filter.
 *
 * This module had no test at all, which is how a reader could lose an
 * arrangement they had just made: `kpisUnfiltered` is a snapshot of the
 * figures the whole table produced, and it was being read as a snapshot of the
 * cards, so a tile moved while a filter was on went back where it came from on
 * the next filter change and again when the filter was cleared.
 */

/** An analysis with two generated cards and one chart, as the provider holds it. */
function deck() {
  return {
    kpis: [
      { id: 'kpi_1', label: 'Total Revenue', value: '1.4M', trend: 'up' },
      { id: 'kpi_2', label: 'Total Units Sold', value: '11.9K', trend: 'up' },
    ],
    storyboard: [
      {
        id: 'slide_1',
        insight_anchor: 'whole-table headline',
        insight_implication: 'whole-table detail',
        findings: { metrics: { leader: 'North' }, verifiedFacts: ['a'] },
        chart: { id: 'slide_1', resultData: [{ region: 'North', total: 10 }] },
      },
    ],
  };
}

const filteredResult = {
  charts: [{ id: 'slide_1', resultData: [{ region: 'North', total: 4 }] }],
  perChart: [{ id: 'slide_1', headline: 'sliced headline', detail: 'sliced detail', metrics: {}, verifiedFacts: ['b'] }],
  kpis: [
    { label: 'Total Revenue', value: '480K', trend: 'down' },
    { label: 'Total Units Sold', value: '3.9K', trend: 'down' },
  ],
  rowCount: 210,
};

const meta = { filters: [{ column: 'region', values: ['North'] }], where: '[region] = 1', sql: 'SELECT 1' };

test('a filter recomputes the card values and leaves the rest alone', () => {
  const filtered = applyFiltered(deck(), filteredResult, meta);
  assert.equal(filtered.kpis[0].value, '480K');
  assert.equal(filtered.kpis[0].trend, 'down');
  assert.equal(filtered.kpis[0].label, 'Total Revenue');
  assert.equal(filtered.filter.rowCount, 210);
  // And the slide's own fields are the slice's, with the originals held.
  assert.equal(filtered.storyboard[0].insight_anchor, 'sliced headline');
  assert.equal(filtered.storyboard[0].unfiltered.insight_anchor, 'whole-table headline');
});

test('a tile moved under a filter stays where it was put', () => {
  const filtered = applyFiltered(deck(), filteredResult, meta);

  // The reader drags the first card into a corner while the filter is on. This
  // is `editKpi` in the provider: it writes onto the analysis on screen, which
  // is the filtered one, and never touches the snapshot.
  const moved = {
    ...filtered,
    kpis: filtered.kpis.map((c, i) => (i === 0 ? { ...c, layout: { x: 900, y: 40, w: 300, h: 160 } } : c)),
  };

  // Narrowing the filter again used to rebuild the strip from the snapshot,
  // which has no idea the card was moved.
  const narrowed = applyFiltered(moved, { ...filteredResult, kpis: [
    { label: 'Total Revenue', value: '120K', trend: 'down' },
    { label: 'Total Units Sold', value: '900', trend: 'down' },
  ], rowCount: 40 }, meta);

  assert.deepEqual(
    narrowed.kpis[0].layout,
    { x: 900, y: 40, w: 300, h: 160 },
    'the layout did not survive a second filter'
  );
  assert.equal(narrowed.kpis[0].value, '120K', 'and the value is still the slice’s');

  // Clearing it restores the whole table's figures without undoing the move.
  const cleared = clearFiltered(narrowed);
  assert.deepEqual(
    cleared.kpis[0].layout,
    { x: 900, y: 40, w: 300, h: 160 },
    'the layout did not survive clearing the filter'
  );
  assert.equal(cleared.kpis[0].value, '1.4M', 'clearing restores the unfiltered figure');
  assert.equal(cleared.filter, null);
});

test('a card the reader renamed under a filter keeps its name', () => {
  const filtered = applyFiltered(deck(), filteredResult, meta);
  const renamed = {
    ...filtered,
    kpis: filtered.kpis.map((c, i) =>
      i === 0 ? { ...c, label: 'Revenue (North)', origLabel: 'Total Revenue', edited: true } : c
    ),
  };
  const again = applyFiltered(renamed, filteredResult, meta);
  assert.equal(again.kpis[0].label, 'Revenue (North)');
  assert.equal(again.kpis[0].edited, true);
  // Matching still happens on the generated label, so the figure still lands.
  assert.equal(again.kpis[0].value, '480K');
});

test('a card the reader added is not rebuilt from the planner at all', () => {
  const base = deck();
  base.kpis.push({ id: 'kpi_3', label: 'Margin', value: '18%', custom: true, layout: { x: 10, y: 10, w: 200, h: 120 } });
  const filtered = applyFiltered(base, filteredResult, meta);
  const own = filtered.kpis.find((c) => c.label === 'Margin');
  assert.ok(own, 'a custom card disappeared under a filter');
  assert.deepEqual(own.layout, { x: 10, y: 10, w: 200, h: 120 });
});

test('clearing a filter on an unfiltered deck is a no-op', () => {
  const d = deck();
  assert.equal(clearFiltered(d), d);
});
