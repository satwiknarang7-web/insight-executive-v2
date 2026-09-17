import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CANVAS_WIDTH,
  MIN_CANVAS_HEIGHT,
  MIN_CARD_HEIGHT,
  MIN_CARD_WIDTH,
  PAGE_HEIGHT,
  arrange,
  canvasHeight,
  canvasScale,
  cardBox,
  layoutMap,
  moveBox,
  paginateBoard,
  readingOrder,
  resizeBox,
} from '../lib/canvasLayout.js';
import { composeBoard, planSlicers } from '../lib/boardComposer.js';

/* The dashboard as an arrangement.

   Two rules hold everything else up: a coordinate means the same thing on every
   screen because it is measured against a fixed logical canvas, and a card can
   never be put somewhere nobody can reach it. */

test('a card is bounded to the canvas, and to a size a chart can be drawn in', () => {
  assert.deepEqual(cardBox({ x: 100, y: 50, w: 400, h: 300 }), { x: 100, y: 50, w: 400, h: 300 });

  // Dragged off the right edge: a card nobody can see and nobody can get back.
  assert.equal(cardBox({ x: 5000, y: 0, w: 400, h: 300 }).x, CANVAS_WIDTH - 400);
  assert.equal(cardBox({ x: -200, y: -200, w: 400, h: 300 }).x, 0);
  assert.equal(cardBox({ x: 0, y: -200, w: 400, h: 300 }).y, 0, 'the canvas has no upstairs');

  assert.equal(cardBox({ w: 10, h: 10 }).w, MIN_CARD_WIDTH);
  assert.equal(cardBox({ w: 10, h: 10 }).h, MIN_CARD_HEIGHT);
  assert.equal(cardBox({ w: 9999, h: 300 }).w, CANVAS_WIDTH);

  // Nothing at all is a card of the default size, not a crash.
  const empty = cardBox(null);
  assert.ok(empty.w >= MIN_CARD_WIDTH && empty.h >= MIN_CARD_HEIGHT);
  assert.deepEqual(cardBox({ x: 'left', y: null, w: undefined, h: NaN }), empty);
});

test('the canvas grows to hold what is on it, and never shrinks below a slide', () => {
  assert.equal(canvasHeight([]), MIN_CANVAS_HEIGHT);
  assert.equal(canvasHeight([{ y: 0, h: 300 }]), MIN_CANVAS_HEIGHT, 'a short board is still a board');
  assert.ok(canvasHeight([{ y: 900, h: 400 }]) > 1300, 'and a long one is as long as it needs');
});

test('it scales down to fit and never magnifies', () => {
  assert.equal(canvasScale(CANVAS_WIDTH), 1);
  assert.equal(canvasScale(CANVAS_WIDTH / 2), 0.5);
  assert.equal(canvasScale(CANVAS_WIDTH * 3), 1, 'a wide screen shows the board, not a blown-up board');
  assert.equal(canvasScale(0), 1, 'and an unmeasured container does not divide by zero');
});

test('a deck that has never been arranged is flowed across the canvas', () => {
  const slides = [
    { id: 'a', size: { cols: 3, height: 200 } },
    { id: 'b', size: { cols: 3, height: 200 } },
    { id: 'c', size: { cols: 6, height: 300 } },
  ];
  const sizeOf = (slide) => slide.size;
  const placed = arrange(slides, sizeOf);

  assert.equal(placed.length, 3);
  assert.equal(placed[0].box.x, 0, 'the first starts at the left');
  assert.ok(placed[1].box.x > placed[0].box.x, 'the second sits beside it');
  assert.equal(placed[1].box.y, placed[0].box.y, 'on the same row');
  assert.equal(placed[2].box.x, 0, 'and the full-width one starts a new row');
  assert.ok(placed[2].box.y > placed[0].box.y);
  // Nothing runs off the edge.
  for (const { box } of placed) assert.ok(box.x + box.w <= CANVAS_WIDTH, 'a card overhangs the canvas');
});

test('a card that has been placed is left exactly where it was put', () => {
  const slides = [
    { id: 'a', layout: { x: 900, y: 40, w: 300, h: 250 } },
    { id: 'b', size: { cols: 3, height: 200 } },
  ];
  const boxes = layoutMap(slides, (s) => s.size);
  assert.deepEqual(boxes.get('a'), { x: 900, y: 40, w: 300, h: 250 });
  assert.ok(boxes.has('b'));
});

test('reading order is down the page, then across', () => {
  const slides = [
    { id: 'right', layout: { x: 800, y: 0, w: 300, h: 200 } },
    { id: 'below', layout: { x: 0, y: 500, w: 300, h: 200 } },
    { id: 'left', layout: { x: 0, y: 10, w: 300, h: 200 } },
  ];
  assert.deepEqual(
    readingOrder(slides).map((s) => s.id),
    ['left', 'right', 'below'],
    'ten pixels of drift is the same row, five hundred is not'
  );
});

test('a drag moves and resizes inside the same bounds', () => {
  const box = { x: 100, y: 100, w: 400, h: 300 };
  assert.deepEqual(moveBox(box, 50, 25), { x: 150, y: 125, w: 400, h: 300 });
  assert.equal(moveBox(box, -500, -500).x, 0, 'a drag past the edge stops at it');
  assert.deepEqual(resizeBox(box, 100, 50), { x: 100, y: 100, w: 500, h: 350 });
  assert.equal(resizeBox(box, -9999, -9999).w, MIN_CARD_WIDTH);
});

/* And the arrangement the analyst proposes. */

const charts = [
  { id: 'c1', chart_type: 'line', dimension: 'order_date' },
  { id: 'c2', chart_type: 'donut', dimension: 'region' },
  { id: 'c3', chart_type: 'bar', dimension: 'region' },
  { id: 'c4', chart_type: 'card' },
];

test('the board is a grid: full rows, equal cards, equal gutters', () => {
  const boxes = composeBoard(charts, []);
  const lead = boxes.get('c1');
  assert.equal(lead.x, 0);
  assert.equal(lead.y, 0);
  assert.equal(lead.w, CANVAS_WIDTH, 'a trend leading the deck is read across the room');

  // Everything on a row shares its height and its width, and the row ends flush
  // with the edge — the ragged right and the three different heights are what
  // this replaced.
  const rest = ['c2', 'c3', 'c4'].map((id) => boxes.get(id)).filter(Boolean);
  const rows = new Map();
  for (const box of rest) {
    if (!rows.has(box.y)) rows.set(box.y, []);
    rows.get(box.y).push(box);
  }
  for (const row of rows.values()) {
    assert.equal(new Set(row.map((b) => b.h)).size, 1, 'a row of different heights');
    // Equal to the pixel the row cannot divide: the last card takes the
    // rounding so the row ends flush rather than a pixel or two short.
    const widths = row.map((b) => b.w);
    assert.ok(Math.max(...widths) - Math.min(...widths) <= 1, 'a row of different widths');
    const right = Math.max(...row.map((b) => b.x + b.w));
    assert.equal(right, CANVAS_WIDTH, 'the row does not reach the edge');
  }
  for (const box of boxes.values()) assert.ok(box.x + box.w <= CANVAS_WIDTH);
});

test('the cards go across the top, all of them the same', () => {
  const cards = [{ id: 'k1' }, { id: 'k2' }, { id: 'k3' }, { id: 'k4' }];
  const boxes = composeBoard(charts, [], cards);
  const row = cards.map((c) => boxes.get(c.id));
  assert.ok(row.every((b) => b.y === 0), 'the numbers open the board');
  assert.equal(new Set(row.map((b) => b.w)).size, 1);
  assert.equal(new Set(row.map((b) => b.h)).size, 1);
  assert.ok(boxes.get('c1').y > row[0].h, 'and the charts start under them');
});

test('a donut leading the deck is not stretched across it', () => {
  const boxes = composeBoard([{ id: 'only', chart_type: 'donut' }], []);
  assert.equal(boxes.get('only').w, CANVAS_WIDTH, 'a row of one still fills its row');
  assert.ok(boxes.get('only').h < 400, 'but it is not given a lead finding’s height');
});

test('the filters are a strip across the top, like every other row', () => {
  const slicers = [
    { id: 'f1', chart_type: 'slicer', values: 3 },
    { id: 'f2', chart_type: 'slicer', values: 4 },
  ];
  const boxes = composeBoard(charts, slicers, [{ id: 'k1' }, { id: 'k2' }]);
  const strip = slicers.map((s) => boxes.get(s.id));

  assert.ok(strip.every((b) => b.y === 0), 'the filters open the board');
  assert.equal(new Set(strip.map((b) => b.h)).size, 1, 'and share a height like any row');
  assert.equal(Math.max(...strip.map((b) => b.x + b.w)), CANVAS_WIDTH, 'the strip reaches the edge');

  // A rail down the side was the other arrangement, and the wrong one: two
  // filters beside a board 1400 tall either stretch over all of it or stop
  // somewhere up the side.
  assert.ok(boxes.get('k1').y >= strip[0].h, 'the numbers sit under the filters');
  assert.ok(boxes.get('c1').y > boxes.get('k1').y, 'and the charts under those');
  assert.equal(boxes.get('c1').x, 0, 'nothing is indented around a rail any more');
});

test('a filter is offered for a column the deck actually breaks numbers down by', () => {
  const profile = {
    dimensions: ['region', 'contract_type', 'customer_id'],
    measures: ['revenue'],
    temporal: ['order_date'],
    cardinality: { region: 4, contract_type: 3, customer_id: 9000, order_date: 365 },
  };
  const context = { profile, columns: ['region', 'contract_type', 'customer_id', 'order_date', 'revenue'], sample: [{ region: 'North', revenue: 1 }] };

  const specs = planSlicers(
    [
      { chart_type: 'bar', dimension: 'region' },
      { chart_type: 'donut', dimension: 'region' },
      { chart_type: 'bar', dimension: 'contract_type' },
      { chart_type: 'line', dimension: 'order_date' },
      { chart_type: 'table', dimension: 'customer_id' },
    ],
    context
  );

  assert.equal(specs.length, 2, 'two at most — a filter rail wider than that is a form');
  assert.equal(specs[0].dimension, 'region', 'the column the most charts use comes first');
  assert.equal(specs[1].dimension, 'contract_type');
  assert.ok(specs.every((s) => s.chart_type === 'slicer'));
  assert.match(specs[0].sql, /GROUP BY \[region\]/);
  assert.equal(specs[0].title, 'Region', 'named for what it filters, not for what it counts');

  // Nine thousand customer ids is not a list of boxes, and a date is a range.
  assert.ok(!specs.some((s) => s.dimension === 'customer_id'));
  assert.ok(!specs.some((s) => s.dimension === 'order_date'));
});

test('a deck that breaks nothing down offers no filters', () => {
  assert.deepEqual(planSlicers([{ chart_type: 'card' }], { profile: { cardinality: {} } }), []);
  assert.deepEqual(planSlicers([], {}), []);
});

/* And the board, cut to fit a slide. */

test('a board taller than a page is cut between cards, never through one', () => {
  const entries = [
    { id: 'rail', box: { x: 0, y: 0, w: 240, h: 300 } },
    { id: 'lead', box: { x: 256, y: 0, w: 1184, h: 340 } },
    { id: 'a', box: { x: 256, y: 356, w: 375, h: 300 } },
    { id: 'b', box: { x: 256, y: 700, w: 375, h: 280 } },
  ];
  const pages = paginateBoard(entries, PAGE_HEIGHT);
  assert.equal(pages.length, 2);
  assert.deepEqual([...pages[0].boxes.keys()].sort(), ['a', 'lead', 'rail']);
  assert.deepEqual([...pages[1].boxes.keys()], ['b']);

  // Every page opens at its own top-left: a page below the rail must not begin
  // with an empty column where the rail is not.
  for (const page of pages) {
    const boxes = [...page.boxes.values()];
    assert.equal(Math.min(...boxes.map((b) => b.y)), 0, 'a page starts at its top');
    assert.equal(Math.min(...boxes.map((b) => b.x)), 0, 'and at its left');
  }
  // Relative positions inside a page survive the lift.
  assert.equal(pages[0].boxes.get('lead').x - pages[0].boxes.get('rail').x, 256);
});

test('a board that fits is one page, and an empty one is still a page', () => {
  const entries = [{ id: 'only', box: { x: 0, y: 0, w: 600, h: 300 } }];
  assert.equal(paginateBoard(entries).length, 1);
  assert.equal(paginateBoard([]).length, 1, 'a deck with nothing on the board still has a slide');
});
