import test from 'node:test';
import assert from 'node:assert/strict';
import { detectRepeatedMeasures, repetitionReason } from '../lib/dataGrain.js';
import { profileColumns } from '../lib/chartResolver.js';
import { classifyColumns } from '../lib/measureSemantics.js';
import { planKpis } from '../lib/analystPlanner.js';

const detect = (rows) => detectRepeatedMeasures(rows, profileColumns(rows));

/**
 * Orders joined to customers before upload: every one of a customer's ten order
 * rows carries that customer's lifetime total. This is the shape that produced
 * a 34.3B headline against a true 4.74B, arriving as a flat file so there is no
 * provenance left to catch it with.
 */
function joinedOrders({ customers = 20, perCustomer = 10 } = {}) {
  const rows = [];
  for (let c = 0; c < customers; c++) {
    for (let o = 0; o < perCustomer; o++) {
      rows.push({
        customer: `Cust ${c}`,
        region: ['North', 'South', 'East', 'West'][c % 4],
        order_value: 50 + c * 3 + o * 7,
        lifetime_value: 1000 + c * 137,
      });
    }
  }
  return rows;
}

test('a measure repeated down a pre-joined file is found, with its key', () => {
  const hits = detect(joinedOrders());
  assert.ok(hits.lifetime_value, 'the customer-level total is flagged');
  assert.deepEqual(hits.lifetime_value.key, ['customer']);
  assert.equal(hits.lifetime_value.groups, 20);
  assert.equal(hits.lifetime_value.factor, 10);
});

test('a genuine row-level measure in the same file is left alone', () => {
  const hits = detect(joinedOrders());
  assert.ok(!hits.order_value, 'order_value varies within a customer, so it stays summable');
});

test('a flat fact table has nothing repeated', () => {
  const rows = Array.from({ length: 200 }, (_, i) => ({
    category: ['A', 'B', 'C', 'D'][i % 4],
    revenue: 100 + i * 13,
    units: 1 + (i % 9),
  }));
  assert.deepEqual(detect(rows), {});
});

test('a coarse measure is not an attribute just because a key determines it', () => {
  // The regression guard. `billed_artist_count` is 1 for every solo track and 2
  // for every duet, so it holds still inside any group keyed on the flag that
  // decides it — and summing it is still the correct, reported figure. What
  // separates it from a real attribute is that it does not vary across those
  // groups: two values over a hundred-odd of them.
  const rows = [];
  for (let i = 0; i < 700; i++) {
    rows.push({
      artist: `Artist ${i % 120}`,
      is_collaboration: 'False',
      billed_artist_count: 1,
      daily_streams: 100000 + i * 37,
    });
  }
  for (let i = 0; i < 23; i++) {
    rows.push({
      artist: `Artist ${i}`,
      is_collaboration: 'True',
      billed_artist_count: 2,
      daily_streams: 250000 + i * 91,
    });
  }
  assert.ok(!detect(rows).billed_artist_count);
});

test('a key with a group per row proves nothing', () => {
  // Everything is trivially constant within a key unique to each row, so a
  // near-unique column must never be usable as one.
  const rows = Array.from({ length: 120 }, (_, i) => ({
    ticket: `T-${i}`,
    opened_by: `User ${i % 6}`,
    minutes: 5 + i,
  }));
  assert.ok(!detect(rows).minutes, 'a per-row key cannot make a measure an attribute');
});

test('constancy is confirmed against every row, not the sample', () => {
  // Screening strides the table, so a single contradicting row can sit between
  // sampled rows. Claiming repetition costs a legitimate SUM, so the claim is
  // always re-checked in full.
  const rows = [];
  for (let c = 0; c < 20; c++) {
    for (let o = 0; o < 1250; o++) {
      rows.push({ customer: `Cust ${c}`, order_value: 10 + o, lifetime_value: 1000 + c * 137 });
    }
  }
  assert.ok(detect(rows).lifetime_value, 'constant to begin with');

  // Break it on an odd index, which the stride-2 screen never visits.
  const odd = rows.findIndex((r, i) => i % 2 === 1 && r.customer === 'Cust 7');
  rows[odd] = { ...rows[odd], lifetime_value: -1 };
  assert.ok(!detect(rows).lifetime_value, 'one contradicting row is enough to withdraw it');
});

test('a tiny table is never enough evidence', () => {
  const rows = [
    { team: 'A', value: 10, score: 1 },
    { team: 'A', value: 10, score: 2 },
    { team: 'B', value: 20, score: 3 },
    { team: 'B', value: 20, score: 4 },
  ];
  assert.deepEqual(detect(rows), {});
});

test('the reason names the grain and the repetition', () => {
  const why = repetitionReason({ key: ['Year', 'Team'], groups: 2664, factor: 76.1 });
  assert.match(why, /one value per Year and Team/);
  assert.match(why, /76x/);
  assert.match(why, /count the same figure once per row/);
  assert.equal(repetitionReason(null), null);
});

test('a repeated measure reaches classifyColumns as an attribute', () => {
  const rows = joinedOrders();
  const profile = profileColumns(rows);
  const repeatedAt = detectRepeatedMeasures(rows, profile);
  const classes = classifyColumns({
    profile,
    cardinality: profile.cardinality,
    rowCount: rows.length,
    repeatedAt,
  });
  // "lifetime" reads as someone else's total, so it lands in preAggregate;
  // either kind is in the set the planner refuses to sum.
  const notSummable = new Set([...classes.preAggregate, ...classes.attribute]);
  assert.ok(notSummable.has('lifetime_value'));
  assert.ok(classes.additive.includes('order_value'));
  assert.match(classes.byColumn.lifetime_value.why, /once per row/);
});

test('without the measured evidence the same file is still summed', () => {
  // Pins what this is worth: provenance alone cannot see a join that already
  // happened, so the veto exists only because the repetition was measured.
  const rows = joinedOrders();
  const profile = profileColumns(rows);
  const blind = classifyColumns({
    profile,
    cardinality: profile.cardinality,
    rowCount: rows.length,
  });
  // "lifetime" reads as a total, but on a fact table a total is a legitimate
  // thing to sum — so name matching alone classifies it additive and the
  // 34.3B headline goes straight through.
  assert.ok(blind.additive.includes('lifetime_value'), 'names alone leave it summable');
  assert.ok(![...blind.preAggregate, ...blind.attribute].includes('lifetime_value'));
});

test('no KPI card totals a repeated measure', () => {
  const kpis = planKpis(joinedOrders());
  const summed = kpis.filter((k) => /SUM\(\s*\[?lifetime_value/i.test(String(k.sql || '')));
  assert.equal(summed.length, 0, 'a customer lifetime total never becomes a headline sum');
});
