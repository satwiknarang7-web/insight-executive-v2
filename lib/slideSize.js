/**
 * How much of the dashboard one finding takes.
 *
 * Every card used to be the same size, which said every finding was equally
 * important — and they are not. A twelve-month trend is the story; a two-slice
 * donut beside it is a footnote, and giving them the same rectangle makes the
 * reader work out the difference for themselves.
 *
 * This was four named sizes, and four names is not a size control. It is a
 * short list of shapes somebody else chose, and the one you want is reliably
 * between two of them. So a card now carries a width and a height, both set by
 * dragging its corner.
 *
 * **Width is in columns, not pixels.** A dashboard is read at every width
 * between a phone and a wall display, and a pixel width is right at exactly one
 * of them. The grid is six columns on a desktop, two on a tablet and one on a
 * phone; a card claims a number of them, and the same card is a third of the
 * row on every desktop rather than 420px on all of them. Below the desktop
 * breakpoint a wide card is capped at what the grid has — see `.slide-tile` in
 * globals.css, which reads the two custom properties `slideStyle` writes.
 *
 * **Height is in pixels**, because that one is a pixel question: it is how much
 * room the plot gets, and nothing about a phone makes a line chart need less of
 * it. Bounded at both ends — under about 120px a chart is axis labels and no
 * plot, and past 900 a single card is a page.
 */

/** The grid the dashboard lays out on, at its widest. */
export const GRID_COLUMNS = 6;

export const MIN_HEIGHT = 120;
export const MAX_HEIGHT = 900;

/**
 * The four named sizes, kept for the decks that were saved with them.
 *
 * Not offered any more — they are what a size *was*, and a deck made before
 * this must open at the size it was made at rather than at the default.
 */
const LEGACY = {
  small: { cols: 2, height: 160 },
  medium: { cols: 3, height: 192 },
  large: { cols: 4, height: 256 },
  full: { cols: 6, height: 320 },
};

/** Half a row, which is what a deck that sets no size has always been. */
export const DEFAULT_LAYOUT = { ...LEGACY.medium };

const clampInt = (n, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number(n) || 0)));

/**
 * The width and height of one card, whatever it was saved as.
 *
 * Takes the old string ids, the new `{cols, height}`, or nothing at all, and
 * always returns a layout inside the bounds — a stored value that has drifted
 * out of range (a hand-edited save, a column count from a future grid) is
 * brought back rather than trusted.
 */
export function slideLayout(size) {
  if (typeof size === 'string') return { ...(LEGACY[size] || DEFAULT_LAYOUT) };
  if (size && typeof size === 'object') {
    return {
      cols: clampInt(size.cols ?? DEFAULT_LAYOUT.cols, 1, GRID_COLUMNS),
      height: clampInt(size.height ?? DEFAULT_LAYOUT.height, MIN_HEIGHT, MAX_HEIGHT),
    };
  }
  return { ...DEFAULT_LAYOUT };
}

/**
 * The style a card wears.
 *
 * Two custom properties rather than a grid-column value, because the cap at
 * each breakpoint is a media query and an inline style has no media queries. JS
 * knows the number, so it writes both and the stylesheet picks one.
 */
export function slideStyle(layout) {
  const { cols } = slideLayout(layout);
  return { '--span-md': Math.min(cols, 2), '--span-xl': cols };
}

/** A layout with one edge moved, kept inside the bounds. */
export function resizeLayout(layout, { cols, height } = {}) {
  const current = slideLayout(layout);
  return {
    cols: cols === undefined ? current.cols : clampInt(cols, 1, GRID_COLUMNS),
    height: height === undefined ? current.height : clampInt(height, MIN_HEIGHT, MAX_HEIGHT),
  };
}

/** How a size reads in a label: "3 of 6 columns · 192px". */
export function describeLayout(layout) {
  const { cols, height } = slideLayout(layout);
  return `${cols} of ${GRID_COLUMNS} columns · ${height}px tall`;
}

/**
 * Which column a card would claim if its right edge were dragged to `width`.
 *
 * The grid's own geometry decides it: the track width is what is left of the
 * container once the gaps are taken out, so a card is as many tracks as its
 * width covers, gaps included, rounded to the nearest.
 */
export function columnsForWidth(width, { gridWidth, columns = GRID_COLUMNS, gap = 16 }) {
  if (!(gridWidth > 0) || columns < 1) return 1;
  const track = (gridWidth - gap * (columns - 1)) / columns;
  if (!(track > 0)) return 1;
  return clampInt((width + gap) / (track + gap), 1, columns);
}
