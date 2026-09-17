/**
 * Where each card sits on the dashboard.
 *
 * The dashboard was a flowing grid: cards in order, each claiming a share of a
 * row, the browser deciding where they landed. That is the right layout for a
 * document and the wrong one for a dashboard, where the arrangement is part of
 * what is being said — the trend across the top, its two drivers beneath it,
 * the slicer down the side. So a card now carries a position as well as a size,
 * and the board is a canvas.
 *
 * **The canvas has a fixed logical width**, and every position is a coordinate
 * on it. That is the only way an arrangement can mean anything: a layout in
 * real pixels is an arrangement for the screen it was made on, and the next
 * screen gets a different dashboard. Here the whole canvas is scaled to whatever
 * width it is given, so a phone, a laptop and a projector show the same board at
 * different sizes — and below the tablet breakpoint, where that scale would put
 * a chart at forty percent, the cards stack in reading order instead.
 *
 * **Reading order is top-to-bottom, then left-to-right**, computed from the
 * coordinates rather than stored. The order cards were created in stops meaning
 * anything the moment they can be moved, and the stacked fallback, the deck's
 * narration and anything else that has to walk the board in sequence should
 * follow the arrangement a person actually made.
 *
 * **Nothing collides.** Cards may overlap, and dropping one on another is an
 * arrangement rather than a mistake to be corrected — a canvas that pushes its
 * neighbours around fights you the moment you want two things touching.
 *
 * Pure: coordinates in, coordinates out. No React, no DOM.
 */

/** The width every coordinate is measured against. */
export const CANVAS_WIDTH = 1440;

/** The shortest canvas, so an empty or sparse board is not a sliver. */
export const MIN_CANVAS_HEIGHT = 720;

/** Room under the lowest card, so the last one is not flush with the edge. */
export const CANVAS_PADDING = 24;

export const MIN_CARD_WIDTH = 220;

/**
 * The shortest a card can be.
 *
 * Low enough for a card that holds one number and its name, because those are
 * tiles on this board like everything else. A chart dragged this short is a
 * chart with no plot, which is the dragger's business — the composer never
 * proposes one, and `MIN_PLOT_HEIGHT` on the card keeps the axis from eating
 * what is left.
 */
export const MIN_CARD_HEIGHT = 96;

/** What a card is, before anyone has moved it. */
const DEFAULT_CARD = { w: 700, h: 380 };

/** The gap the automatic arrangement leaves between cards. */
const GUTTER = 16;

const num = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));

/**
 * One card's box, whatever the slide carries.
 *
 * Bounded to the canvas horizontally — a card dragged off the right edge is a
 * card nobody can see and nobody can get back — and never smaller than a chart
 * can be drawn in. `y` is free: the canvas grows downwards.
 */
export function cardBox(layout) {
  const w = clamp(Math.round(num(layout?.w, DEFAULT_CARD.w)), MIN_CARD_WIDTH, CANVAS_WIDTH);
  const h = Math.max(MIN_CARD_HEIGHT, Math.round(num(layout?.h, DEFAULT_CARD.h)));
  const x = clamp(Math.round(num(layout?.x, 0)), 0, CANVAS_WIDTH - w);
  const y = Math.max(0, Math.round(num(layout?.y, 0)));
  return { x, y, w, h };
}

/**
 * The arrangement for a board, filling in the cards nobody has placed.
 *
 * Every deck before this one has no coordinates at all, and a deck the analyst
 * has just built has none either. Rather than dropping them all at the origin,
 * the unplaced cards are flowed across the canvas in the order they arrive, at
 * the width their old size asked for — so an existing dashboard opens looking
 * like the dashboard it was, and is a canvas from the first drag.
 *
 * @param {object[]} slides   the storyboard
 * @param {function} sizeOf   slide -> {cols, height}, the pre-canvas size
 */
export function arrange(slides = [], sizeOf = null) {
  const placed = [];
  let penX = 0;
  let penY = 0;
  let rowHeight = 0;

  for (const slide of slides) {
    if (slide?.layout && Number.isFinite(Number(slide.layout.x)) && Number.isFinite(Number(slide.layout.y))) {
      placed.push({ id: slide.id, box: cardBox(slide.layout) });
      continue;
    }

    // The old size, as a width: a card that claimed three of six columns takes
    // half the canvas. The chart's height plus the chrome above and below it.
    const size = sizeOf?.(slide) || null;
    const w = size ? Math.round((CANVAS_WIDTH - GUTTER) * (size.cols / 6)) - GUTTER : DEFAULT_CARD.w;
    const h = size ? size.height + 190 : DEFAULT_CARD.h;
    const box = cardBox({ w, h });

    if (penX + box.w > CANVAS_WIDTH) {
      penX = 0;
      penY += rowHeight + GUTTER;
      rowHeight = 0;
    }
    placed.push({ id: slide.id, box: { ...box, x: penX, y: penY } });
    penX += box.w + GUTTER;
    rowHeight = Math.max(rowHeight, box.h);
  }

  return placed;
}

/** The arrangement as a map, for a renderer that has a slide in hand. */
export function layoutMap(slides = [], sizeOf = null) {
  return new Map(arrange(slides, sizeOf).map((entry) => [String(entry.id), entry.box]));
}

/** How tall the canvas has to be to hold this arrangement. */
export function canvasHeight(boxes = []) {
  const lowest = boxes.reduce((max, box) => Math.max(max, (box?.y || 0) + (box?.h || 0)), 0);
  return Math.max(MIN_CANVAS_HEIGHT, Math.round(lowest + CANVAS_PADDING));
}

/**
 * Reading order: down the page, then across.
 *
 * Two cards are on the same "row" when their tops are within a card's own
 * tolerance of each other, because nobody aligns by pixel and a layout where a
 * card sitting three pixels high jumps the queue is a layout that reads wrong.
 */
const ROW_TOLERANCE = 80;

export function readingOrder(slides = [], sizeOf = null) {
  const boxes = layoutMap(slides, sizeOf);
  return [...slides].sort((a, b) => {
    const A = boxes.get(String(a.id)) || { x: 0, y: 0 };
    const B = boxes.get(String(b.id)) || { x: 0, y: 0 };
    if (Math.abs(A.y - B.y) > ROW_TOLERANCE) return A.y - B.y;
    return A.x - B.x;
  });
}

/**
 * How much of the board one slide shows.
 *
 * A dashboard is as tall as it needs to be and a slide is not, so the closing
 * slide of a deck has to choose: shrink the whole board until it fits, or show
 * it a screenful at a time. Shrinking was what it did, and it scaled to fit
 * BOTH directions — so a board half as tall again as a slide came out at a
 * third of its size with two thirds of the slide's width left empty beside it,
 * which is the worst of the two answers. This is the other one.
 *
 * The page is a shape rather than a measurement: about sixteen by nine of the
 * canvas, so a page fills a slide's width and the scale is decided by the width
 * alone. The number of pages a board needs is then a property of the board and
 * not of the screen it is being shown on, which is what lets the deck know how
 * many slides it has before anything has been measured.
 */
export const PAGE_HEIGHT = Math.round(CANVAS_WIDTH * 0.46);

/**
 * The board, cut into pages.
 *
 * Cut between cards, never through one: a page ends where the next card would
 * have crossed its bottom edge, and that card starts the next page. Each page's
 * cards are lifted so the topmost sits at the top, because a page is a view of
 * the board and not a window onto a taller thing.
 *
 * A card taller than a page gets a page of its own and is scaled down to fit
 * when it is drawn; there is nothing else to do with it, and nothing on a
 * composed board is that tall.
 *
 * @param {{id: string, box: object}[]} entries
 * @returns {{boxes: Map<string, object>, height: number}[]} at least one page
 */
export function paginateBoard(entries = [], pageHeight = PAGE_HEIGHT) {
  const sorted = [...entries]
    .filter((entry) => entry && entry.box)
    .sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
  if (!sorted.length) return [{ boxes: new Map(), height: pageHeight }];

  const pages = [];
  let current = [];
  let top = sorted[0].box.y;

  const close = () => {
    if (!current.length) return;
    // Lifted in both directions, for the same reason: a page is a view of the
    // board rather than a window onto a bigger one, and a page that begins
    // below the filter rail would otherwise open with an empty column where the
    // rail is not.
    const lift = Math.min(...current.map((entry) => entry.box.y));
    const shift = Math.min(...current.map((entry) => entry.box.x));
    const boxes = new Map(
      current.map((entry) => [String(entry.id), { ...entry.box, x: entry.box.x - shift, y: entry.box.y - lift }])
    );
    const height = Math.max(...current.map((entry) => entry.box.y + entry.box.h)) - lift;
    pages.push({ boxes, height });
    current = [];
  };

  for (const entry of sorted) {
    const bottom = entry.box.y + entry.box.h;
    if (current.length && bottom - top > pageHeight) {
      close();
      top = entry.box.y;
    }
    current.push(entry);
  }
  close();

  return pages.length ? pages : [{ boxes: new Map(), height: pageHeight }];
}

/** The scale that fits the canvas into the room available. Never magnified. */
export function canvasScale(availableWidth) {
  if (!(availableWidth > 0)) return 1;
  return Math.min(1, availableWidth / CANVAS_WIDTH);
}

/** A box moved by a drag, in canvas units. */
export function moveBox(box, dx, dy) {
  return cardBox({ ...box, x: (box?.x || 0) + dx, y: (box?.y || 0) + dy });
}

/** A box resized by a drag, in canvas units. */
export function resizeBox(box, dw, dh) {
  return cardBox({ ...box, w: (box?.w || 0) + dw, h: (box?.h || 0) + dh });
}
