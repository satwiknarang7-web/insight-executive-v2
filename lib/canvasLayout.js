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

/**
 * And the height, which is fixed.
 *
 * The board is a page, not a scroll. That is the difference between a
 * dashboard and a report, and it is what makes the dashboard tab and the deck
 * show the same thing: what is arranged inside this rectangle is what the slide
 * shows, at whatever size the slide happens to be. A board that grew downwards
 * had to be cut into pages to be presented, and a reader arranging one had no
 * way to see where a page would end.
 *
 * Sixteen by nine, because the surface it has to survive is a projector.
 */
export const CANVAS_HEIGHT = Math.round(CANVAS_WIDTH * 0.5625);

/** Kept for the callers that still ask; the page has one height now. */
export const MIN_CANVAS_HEIGHT = CANVAS_HEIGHT;

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
  const h = clamp(Math.round(num(layout?.h, DEFAULT_CARD.h)), MIN_CARD_HEIGHT, CANVAS_HEIGHT);
  const x = clamp(Math.round(num(layout?.x, 0)), 0, CANVAS_WIDTH - w);
  const y = clamp(Math.round(num(layout?.y, 0)), 0, CANVAS_HEIGHT - h);
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

  /*
   * And squeezed into the page if it overflows it.
   *
   * A deck arranged before the board was a page can be taller than one, and
   * clamping each card to the bottom edge would stack them all on top of each
   * other there. Scaling the whole arrangement keeps it recognisable — the same
   * board, shorter — which is what somebody reopening an old analysis expects
   * to see.
   */
  const lowest = placed.reduce((max, entry) => Math.max(max, entry.box.y + entry.box.h), 0);
  if (lowest > CANVAS_HEIGHT && lowest > 0) {
    const squeeze = CANVAS_HEIGHT / lowest;
    return placed.map((entry) => ({
      ...entry,
      box: cardBox({
        ...entry.box,
        y: Math.round(entry.box.y * squeeze),
        h: Math.round(entry.box.h * squeeze),
      }),
    }));
  }

  return placed;
}

/** The arrangement as a map, for a renderer that has a slide in hand. */
export function layoutMap(slides = [], sizeOf = null) {
  return new Map(arrange(slides, sizeOf).map((entry) => [String(entry.id), entry.box]));
}

/**
 * How tall the canvas is: one page, always.
 *
 * Takes the boxes so every caller reads the same way, and ignores them: a card
 * cannot be outside the page, because `cardBox` will not put one there.
 */
export function canvasHeight() {
  return CANVAS_HEIGHT;
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
 * The scale that fits the page into the room available.
 *
 * Both directions when a height is given — a slide is bounded in both and the
 * page must not run off the bottom of it. Width alone otherwise, which is the
 * dashboard, where the page sits in a column that can be as tall as the page
 * needs.
 */
export function canvasScale(availableWidth, availableHeight = null) {
  if (!(availableWidth > 0)) return 1;
  const byWidth = availableWidth / CANVAS_WIDTH;
  if (!(availableHeight > 0)) return Math.min(1, byWidth);
  return Math.min(byWidth, availableHeight / CANVAS_HEIGHT);
}

/** A box moved by a drag, in canvas units. */
export function moveBox(box, dx, dy) {
  return cardBox({ ...box, x: (box?.x || 0) + dx, y: (box?.y || 0) + dy });
}

/** A box resized by a drag, in canvas units. */
export function resizeBox(box, dw, dh) {
  return cardBox({ ...box, w: (box?.w || 0) + dw, h: (box?.h || 0) + dh });
}
