import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  MIN_CARD_HEIGHT,
  MIN_CARD_WIDTH,
  arrange,
  canvasHeight,
  canvasScale,
  cardBox,
  contentBounds,
  layoutMap,
  moveBox,
  readingOrder,
  resizeBox,
} from '../lib/canvasLayout.js';
import { composeBoard, fitFilters, planSlicers } from '../lib/boardComposer.js';

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

test('the board is one page, and a card cannot leave it', () => {
  assert.equal(canvasHeight(), CANVAS_HEIGHT, 'the page has one height');
  assert.equal(canvasHeight([{ y: 900, h: 400 }]), CANVAS_HEIGHT, 'whatever it is asked about');

  // The page is what makes the dashboard and the slide show the same thing, so
  // nothing may be arranged outside it.
  const low = cardBox({ x: 0, y: 5000, w: 400, h: 300 });
  assert.equal(low.y + low.h, CANVAS_HEIGHT, 'a card dragged off the bottom stops at it');
  assert.equal(cardBox({ x: 0, y: 0, w: 400, h: 5000 }).h, CANVAS_HEIGHT, 'and none is taller than the page');
});

test('it scales to fit, and to fit both ways when both are bounded', () => {
  assert.equal(canvasScale(CANVAS_WIDTH), 1);
  assert.equal(canvasScale(CANVAS_WIDTH / 2), 0.5);
  assert.equal(canvasScale(CANVAS_WIDTH * 3), 1, 'a wide screen shows the board, not a blown-up board');
  assert.equal(canvasScale(0), 1, 'and an unmeasured container does not divide by zero');

  // A slide is bounded in both directions, and the page must not run off the
  // bottom of one. There the width is allowed to go past 1 to fill the room.
  assert.equal(canvasScale(CANVAS_WIDTH * 2, CANVAS_HEIGHT), 1, 'height decides when it is the tighter');
  assert.equal(canvasScale(CANVAS_WIDTH, CANVAS_HEIGHT / 2), 0.5);
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
  // Nothing runs off any edge: an arrangement taller than the page is squeezed
  // into it rather than stacked at the bottom of it.
  for (const { box } of placed) {
    assert.ok(box.x + box.w <= CANVAS_WIDTH, 'a card overhangs the canvas');
    assert.ok(box.y + box.h <= CANVAS_HEIGHT, 'a card hangs off the page');
  }
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

test('every edge and corner resizes, and the opposite side stays put', () => {
  const box = { x: 400, y: 300, w: 400, h: 300 };

  // An edge moves one side. This is the whole reason the edges exist: making a
  // card wider on its left used to mean dragging the right edge out and then
  // dragging the card back, which moves the edge you were aligning against.
  assert.deepEqual(resizeBox(box, -100, 0, 'w'), { x: 300, y: 300, w: 500, h: 300 });
  assert.deepEqual(resizeBox(box, 100, 0, 'e'), { x: 400, y: 300, w: 500, h: 300 });
  assert.deepEqual(resizeBox(box, 0, -100, 'n'), { x: 400, y: 200, w: 400, h: 400 });
  assert.deepEqual(resizeBox(box, 0, 100, 's'), { x: 400, y: 300, w: 400, h: 400 });

  // An edge does not touch the other dimension, however far the pointer wanders
  // off it — a horizontal drag on the left edge is not a request to move down.
  const west = resizeBox(box, -50, 250, 'w');
  assert.equal(west.y, box.y);
  assert.equal(west.h, box.h);

  // A corner moves two, and the diagonally opposite one stays where it is.
  assert.deepEqual(resizeBox(box, -100, -100, 'nw'), { x: 300, y: 200, w: 500, h: 400 });
  assert.deepEqual(resizeBox(box, 100, -100, 'ne'), { x: 400, y: 200, w: 500, h: 400 });
  assert.deepEqual(resizeBox(box, -100, 100, 'sw'), { x: 300, y: 300, w: 500, h: 400 });
  assert.deepEqual(resizeBox(box, 100, 100, 'se'), { x: 400, y: 300, w: 500, h: 400 });

  // Two arguments still mean the bottom-right corner, which is what every
  // caller written before the edges existed meant by it.
  assert.deepEqual(resizeBox(box, 100, 100), resizeBox(box, 100, 100, 'se'));
});

test('shrinking past the minimum stops rather than sliding the card sideways', () => {
  const box = { x: 400, y: 300, w: 400, h: 300 };

  // Dragging the left edge right, past the point where the card can get any
  // narrower. Clamping the width alone would leave x where the pointer put it,
  // so the card would stop shrinking and start sliding rightwards — away from
  // the right edge the reader was measuring against.
  const west = resizeBox(box, 9999, 0, 'w');
  assert.equal(west.w, MIN_CARD_WIDTH);
  assert.equal(west.x + west.w, box.x + box.w, 'the right edge moved');

  const north = resizeBox(box, 0, 9999, 'n');
  assert.equal(north.h, MIN_CARD_HEIGHT);
  assert.equal(north.y + north.h, box.y + box.h, 'the bottom edge moved');

  // And from the other side, where the anchored edge is the left one.
  const east = resizeBox(box, -9999, 0, 'e');
  assert.equal(east.w, MIN_CARD_WIDTH);
  assert.equal(east.x, box.x, 'the left edge moved');
});

test('an edge dragged off the page stops at it', () => {
  const box = { x: 100, y: 100, w: 400, h: 300 };

  assert.equal(resizeBox(box, -9999, 0, 'w').x, 0);
  assert.equal(resizeBox(box, 0, -9999, 'n').y, 0);

  const east = resizeBox(box, 9999, 0, 'e');
  assert.equal(east.x + east.w, CANVAS_WIDTH);

  const south = resizeBox(box, 0, 9999, 's');
  assert.equal(south.y + south.h, CANVAS_HEIGHT);
});

test('a card nobody placed lands in the gaps, not on top of the board', () => {
  // The board as the composer left it: a full-width row, then two beside it.
  const slides = [
    { id: 'lead', layout: { x: 0, y: 0, w: 1440, h: 300 } },
    { id: 'left', layout: { x: 0, y: 316, w: 700, h: 260 } },
    { id: 'right', layout: { x: 716, y: 316, w: 724, h: 260 } },
    // And the card somebody just added, which has never been anywhere.
    { id: 'new' },
  ];
  const boxes = layoutMap(slides, () => ({ w: 340, h: 120 }));
  const added = boxes.get('new');

  for (const id of ['lead', 'left', 'right']) {
    const other = boxes.get(id);
    const clear =
      added.x >= other.x + other.w ||
      other.x >= added.x + added.w ||
      added.y >= other.y + other.h ||
      other.y >= added.y + added.h;
    assert.ok(clear, `the new card is sitting on ${id}`);
  }
  assert.ok(added.y + added.h <= CANVAS_HEIGHT, 'and it is still on the page');

  // Nothing that was already placed moved to make room for it.
  assert.deepEqual(boxes.get('lead'), { x: 0, y: 0, w: 1440, h: 300 });
  assert.deepEqual(boxes.get('right'), { x: 716, y: 316, w: 724, h: 260 });
});

test('a sizeOf that answers in boxes is taken at its word', () => {
  // A KPI card is a number and its name. Sized as a share of six columns it
  // came out half a row tall, which is not what a number needs.
  const boxes = layoutMap([{ id: 'card' }], () => ({ w: 340, h: 120 }));
  assert.deepEqual(boxes.get('card'), { x: 0, y: 0, w: 340, h: 120 });
});

test('the board is fitted by what is on it, not by the page around it', () => {
  // A board arranged into the top-left corner shown on a slide that scales the
  // whole canvas is a board with half a screen of empty page beside it.
  assert.deepEqual(contentBounds([{ x: 100, y: 50, w: 300, h: 200 }, { x: 500, y: 50, w: 200, h: 400 }]), {
    x: 100,
    y: 50,
    w: 600,
    h: 400,
  });
  // Nothing on it is the whole page: there is nothing to fit to.
  assert.deepEqual(contentBounds([]), { x: 0, y: 0, w: CANVAS_WIDTH, h: CANVAS_HEIGHT });
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

test('a donut leading the deck is not given the lead finding’s row', () => {
  // On a page every row fills the height it is given, so the difference a lead
  // makes is which row it is in and how much of the page that row claims —
  // not, as it was on a scrolling board, a taller box for the same chart.
  const donut = composeBoard([{ id: 'only', chart_type: 'donut' }], []);
  const trend = composeBoard([{ id: 'only', chart_type: 'line' }], []);
  assert.equal(donut.get('only').w, CANVAS_WIDTH, 'a row of one still fills its row');
  assert.equal(donut.get('only').y, 0, 'and with nothing else on the board it opens it');
  assert.equal(trend.get('only').h, donut.get('only').h, 'one chart is one page either way');
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

test('a filter opens as a list while the charts can still breathe', () => {
  // Two charts leave room for three checkboxes to sit open.
  const roomy = [{ id: 'f1', values: 3 }];
  assert.equal(fitFilters(roomy, { charts: 2, cards: 4 }).mode, 'list');
  assert.equal(roomy[0].slicerMode, 'list', 'and the tile is told');

  // Seven do not: a hundred and eighty pixels holding three checkboxes is
  // height the charts under them lose.
  const tight = [{ id: 'f1', values: 3 }];
  const fitted = fitFilters(tight, { charts: 7, cards: 4 });
  assert.equal(fitted.mode, 'dropdown');
  assert.ok(
    fitted.height < fitFilters(roomy, { charts: 2, cards: 4 }).height,
    'and it costs the page a line rather than a list'
  );
  assert.equal(tight[0].slicerMode, 'dropdown');
});

test('however tight the page, a filter keeps room for the card around it', () => {
  // The regression this guards: a filter planned at 96px, drawn inside a card
  // whose padding, type label and title take about a hundred on their own, so
  // the control the tile exists to show hung off the bottom edge.
  const tight = fitFilters([{ id: 'f1', values: 3 }], { charts: 9, cards: 4 });
  assert.equal(tight.mode, 'dropdown', 'nine charts cannot afford a list');
  assert.ok(tight.height >= 110, `a filter given ${tight.height}px is a filter you cannot read`);

  // And a list is at least its chrome plus a row for every value it holds.
  const list = fitFilters([{ id: 'f1', values: 4 }], { charts: 1, cards: 0 });
  assert.equal(list.mode, 'list');
  assert.ok(list.height >= 100 + 4 * 20, 'a list of four values has to fit four values');
});

test('a mode somebody chose is never overruled by the room', () => {
  const chosen = [{ id: 'f1', values: 3, slicerMode: 'list' }];
  fitFilters(chosen, { charts: 9, cards: 4 });
  assert.equal(chosen[0].slicerMode, 'list', 'the editor beats the composer');
});

test('no filters, no strip', () => {
  assert.equal(fitFilters([], { charts: 4 }).height, 0);
});
