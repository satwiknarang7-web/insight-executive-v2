import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CARD_W,
  FOOTER_H,
  MAX_ROWS,
  cardHeight,
  footerBaseline,
  rowCentre,
  keyRoles,
  orderedColumns,
  depths,
  seedPositions,
  canvasSize,
  anchorSides,
} from '../lib/erLayout.js';

const tables = [
  { name: 'orders', columns: ['id', 'customer_id', 'order_date', 'revenue'] },
  { name: 'customers', columns: ['customer_id', 'region', 'tier'] },
  { name: 'loose', columns: ['a', 'b'] },
];

const rels = [
  { id: 'r1', from: { table: 'orders', column: 'customer_id' }, to: { table: 'customers', column: 'customer_id' } },
];

test('a card grows with its column count and stops growing at the cap', () => {
  assert.ok(cardHeight(4) > cardHeight(2));
  assert.equal(cardHeight(MAX_ROWS + 9), cardHeight(MAX_ROWS + 1), 'truncated cards are all the same height');
});

test('a truncated card is exactly one footer taller than a full one', () => {
  // The "+N more columns" line needs a strip of its own. It used to be drawn
  // into the bottom padding, which is thinner than a row — so it landed on top
  // of the last column name.
  assert.equal(cardHeight(MAX_ROWS + 1) - cardHeight(MAX_ROWS), FOOTER_H);
});

test('the truncation line clears the last column row', () => {
  const columns = MAX_ROWS + 5;
  const lastRowBaseline = rowCentre(MAX_ROWS - 1) + 3.5;
  assert.ok(
    footerBaseline(columns) - lastRowBaseline >= 10,
    'a full line of clear space between the last column and the footer'
  );
  assert.ok(footerBaseline(columns) < cardHeight(columns), 'and it stays inside the card');
});

test('row centres step down without overlapping', () => {
  const a = rowCentre(0);
  const b = rowCentre(1);
  assert.ok(b > a);
  assert.equal(b - a, rowCentre(2) - rowCentre(1), 'rows are evenly spaced');
});

test('keys are read from the relationships, not guessed', () => {
  const orders = keyRoles('orders', tables[0].columns, rels);
  assert.ok(orders.foreign.has('customer_id'), 'orders points out with customer_id');
  assert.ok(orders.primary.has('id'), 'nobody references orders, so its id-shaped column is the PK');

  const customers = keyRoles('customers', tables[1].columns, rels);
  assert.ok(customers.primary.has('customer_id'), 'customers is pointed AT on customer_id');
  assert.equal(customers.foreign.size, 0);
});

test('a column that is a foreign key is not also claimed as the primary key', () => {
  // 'customer_id' in orders is an FK and also id-shaped; the fallback must not
  // grab it, or the card would show two primary keys and no foreign key.
  const orders = keyRoles('orders', ['customer_id', 'total'], rels);
  assert.ok(orders.foreign.has('customer_id'));
  assert.ok(!orders.primary.has('customer_id'));
});

test('keys are floated to the top of the card', () => {
  const roles = keyRoles('orders', tables[0].columns, rels);
  const ordered = orderedColumns(tables[0].columns, roles);
  assert.deepEqual(ordered.slice(0, 2).sort(), ['customer_id', 'id']);
  assert.equal(ordered.length, tables[0].columns.length, 'no column is dropped');
});

test('depth walks outward from the fact table and parks orphans last', () => {
  const d = depths(['orders', 'customers', 'loose'], 'orders', rels);
  assert.equal(d.get('orders'), 0);
  assert.equal(d.get('customers'), 1);
  assert.ok(d.get('loose') > d.get('customers'), 'an unrelated table sits past the related ones');
});

// ---------------------------------------------------------------------------
// The bug this file exists for
// ---------------------------------------------------------------------------

test('seeding is deterministic', () => {
  const a = seedPositions(tables, 'orders', rels);
  const b = seedPositions(tables, 'orders', rels);
  assert.deepEqual(a, b, 'the same model always opens the same way');
});

test('related tables are laid out in separate columns', () => {
  const p = seedPositions(tables, 'orders', rels);
  assert.ok(p.customers.x > p.orders.x, 'the looked-up table sits to the right');
  assert.ok(Math.abs(p.customers.x - p.orders.x) >= CARD_W, 'columns do not overlap');
});

test('cards in the same column do not overlap vertically', () => {
  const stacked = [
    { name: 'fact', columns: ['id'] },
    { name: 'a', columns: ['id', 'x'] },
    { name: 'b', columns: ['id', 'y'] },
  ];
  const stackedRels = [
    { id: '1', from: { table: 'fact', column: 'id' }, to: { table: 'a', column: 'id' } },
    { id: '2', from: { table: 'fact', column: 'id' }, to: { table: 'b', column: 'id' } },
  ];
  const p = seedPositions(stacked, 'fact', stackedRels);
  const aBottom = p.a.y + cardHeight(2);
  assert.ok(p.b.y >= aBottom, 'the second card starts below the first');
});

test('the canvas is big enough to hold every card', () => {
  const p = seedPositions(tables, 'orders', rels);
  const size = canvasSize(tables, p);
  for (const t of tables) {
    assert.ok(p[t.name].x + CARD_W <= size.width, `${t.name} fits horizontally`);
    assert.ok(p[t.name].y + cardHeight(t.columns.length) <= size.height, `${t.name} fits vertically`);
  }
});

test('connectors leave the side of the card that faces the other card', () => {
  const left = { x: 0, y: 0 };
  const right = { x: 400, y: 0 };
  assert.deepEqual(anchorSides(left, right), { fromSide: 'right', toSide: 'left' });
  assert.deepEqual(anchorSides(right, left), { fromSide: 'left', toSide: 'right' });
});
