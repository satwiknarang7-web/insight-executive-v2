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

/**
 * And what a KPI tile is, which is not the same thing.
 *
 * A number and its name need a corner. Sized like a chart — a share of six
 * columns, plus the room a plot wants — a card somebody added arrived as a
 * 700x380 rectangle holding two lines of text, which is why the first thing
 * anyone did after adding one was resize it.
 */
export const KPI_TILE = { w: 340, h: 120 };

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

/** Do two boxes cover any of the same page? */
function overlaps(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * The size a card asks for before anything is known about where it goes.
 *
 * `sizeOf` may answer in either of two languages. A box — `{w, h}` — is a
 * caller that knows what its tile is: a KPI card is a number and its name and
 * wants a corner, not half a row. Otherwise it is the pre-canvas size, a share
 * of six columns plus the plot's height, and the chrome above and below the
 * plot is added back here.
 */
function wantedSize(slide, sizeOf) {
  const size = sizeOf?.(slide) || null;
  if (!size) return { ...DEFAULT_CARD };
  if (Number.isFinite(Number(size.w)) && Number.isFinite(Number(size.h))) {
    return { w: Number(size.w), h: Number(size.h) };
  }
  return {
    w: Math.round((CANVAS_WIDTH - GUTTER) * (size.cols / 6)) - GUTTER,
    h: size.height + 190,
  };
}

/**
 * The first place on the page a card of this size fits without covering one.
 *
 * A new card used to be flowed from the top-left corner as if the board were
 * empty, which put every chart and every card anyone added on top of the board
 * they already had — the one moment a dashboard is guaranteed to look broken is
 * the moment you add something to it.
 *
 * Candidates are the edges of what is already down: a card can only ever sit
 * flush against the page or against a neighbour, so those are the only
 * positions worth trying. Top to bottom, then left to right, which is the order
 * the board is read in — a new card appears where the eye would next expect
 * one.
 */
function freeSpot(w, h, taken) {
  const columns = [...new Set([0, ...taken.map((box) => box.x + box.w + GUTTER)])]
    .filter((x) => x >= 0 && x + w <= CANVAS_WIDTH)
    .sort((a, b) => a - b);
  const rows = [...new Set([0, ...taken.map((box) => box.y + box.h + GUTTER)])]
    .filter((y) => y >= 0 && y + h <= CANVAS_HEIGHT)
    .sort((a, b) => a - b);

  for (const y of rows) {
    for (const x of columns) {
      const box = { x, y, w, h };
      if (!taken.some((other) => overlaps(box, other))) return box;
    }
  }
  return null;
}

/**
 * The arrangement for a board, filling in the cards nobody has placed.
 *
 * Every deck before this one has no coordinates at all, and a deck the analyst
 * has just built has none either, and neither does the card somebody added a
 * second ago. The placed ones are left exactly where they are and the rest are
 * dropped into the gaps between them — so an existing dashboard opens looking
 * like the dashboard it was, and adding to one does not disturb it.
 *
 * @param {object[]} slides   the storyboard
 * @param {function} sizeOf   slide -> {cols, height} or {w, h}, the size it wants
 */
export function arrange(slides = [], sizeOf = null) {
  const taken = [];
  const pending = [];
  const boxes = new Map();

  // The cards somebody has already put somewhere go down first, and they are
  // not moved: the whole point of an arrangement is that it survives the next
  // thing added to it.
  for (const slide of slides) {
    if (slide?.layout && Number.isFinite(Number(slide.layout.x)) && Number.isFinite(Number(slide.layout.y))) {
      const box = cardBox(slide.layout);
      boxes.set(slide.id, box);
      taken.push(box);
    } else {
      pending.push(slide);
    }
  }

  // Then the ones nobody has placed, each into the first gap it fits in.
  for (const slide of pending) {
    const wanted = cardBox(wantedSize(slide, sizeOf));
    const spot = freeSpot(wanted.w, wanted.h, taken);
    // Nowhere free: under everything, and the squeeze below brings the board
    // back onto the page. A new card half-under an old one is worse than a
    // board that shuffles up to make room for it.
    const box = spot
      ? { ...wanted, ...spot }
      : { ...wanted, x: 0, y: taken.reduce((low, other) => Math.max(low, other.y + other.h), 0) + GUTTER };
    boxes.set(slide.id, box);
    taken.push(box);
  }

  const placed = slides.map((slide) => ({ id: slide.id, box: boxes.get(slide.id) }));

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

/**
 * The bounding box of an arrangement.
 *
 * The canvas is a fixed rectangle and a board rarely fills all of it, so a
 * surface that scales the canvas shows the board plus however much empty page
 * the arrangement happened to leave. Scaling this instead puts the cards
 * themselves against the edges of whatever they are being shown in — which is
 * what a projected dashboard is for.
 *
 * Empty is the whole page: there is nothing to fit, and a zero-sized box would
 * scale to infinity.
 */
export function contentBounds(boxes = []) {
  const list = [...boxes].filter((box) => box && Number.isFinite(box.w) && Number.isFinite(box.h));
  if (!list.length) return { x: 0, y: 0, w: CANVAS_WIDTH, h: CANVAS_HEIGHT };
  const x = Math.min(...list.map((box) => box.x));
  const y = Math.min(...list.map((box) => box.y));
  const right = Math.max(...list.map((box) => box.x + box.w));
  const bottom = Math.max(...list.map((box) => box.y + box.h));
  return { x, y, w: Math.max(1, right - x), h: Math.max(1, bottom - y) };
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

/**
 * A box resized by a drag, in canvas units.
 *
 * Only the bottom-right corner used to be draggable, so making a card wider on
 * its left meant dragging the right edge out and then dragging the whole card
 * back — two gestures for one intention, and the second one undoes the
 * alignment the first one was measured against.
 *
 * So the drag names the edge it has hold of, and the rule is the one every
 * other canvas follows: **the edge you are dragging moves and the opposite edge
 * stays exactly where it is.** That is what makes a card alignable at all. Drag
 * the left edge of a card whose right edge lines up with the one above it, and
 * the right edge has to still line up when you let go.
 *
 * It is also why the minimum size is enforced against the anchored edge rather
 * than by `cardBox`. Shrinking past the minimum from the west, `cardBox` would
 * clamp the width and leave `x` where the pointer put it — so the card would
 * stop shrinking and start sliding rightwards instead, away from a right edge
 * that was supposed to be nailed down.
 *
 * `dx`/`dy` are the pointer's travel since the drag began, in canvas units, and
 * `edge` defaults to the bottom-right corner — which is what the old two-argument
 * call meant.
 */
export function resizeBox(box, dx, dy, edge = 'se') {
  const base = cardBox(box);
  const side = String(edge || 'se');

  let left = base.x;
  let top = base.y;
  let right = base.x + base.w;
  let bottom = base.y + base.h;

  if (side.includes('e')) right += dx;
  if (side.includes('w')) left += dx;
  if (side.includes('s')) bottom += dy;
  if (side.includes('n')) top += dy;

  // Never off the page.
  left = Math.max(0, left);
  top = Math.max(0, top);
  right = Math.min(CANVAS_WIDTH, right);
  bottom = Math.min(CANVAS_HEIGHT, bottom);

  // Never smaller than a card can be drawn in. The edge under the pointer is
  // the one that gives way; the other one is the one being aligned against.
  if (right - left < MIN_CARD_WIDTH) {
    if (side.includes('w')) left = right - MIN_CARD_WIDTH;
    else right = left + MIN_CARD_WIDTH;
  }
  if (bottom - top < MIN_CARD_HEIGHT) {
    if (side.includes('n')) top = bottom - MIN_CARD_HEIGHT;
    else bottom = top + MIN_CARD_HEIGHT;
  }

  return cardBox({ x: left, y: top, w: right - left, h: bottom - top });
}
