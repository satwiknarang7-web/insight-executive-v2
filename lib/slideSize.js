/**
 * How much of the dashboard one finding takes.
 *
 * Every card used to be the same size, which said every finding was equally
 * important — and they are not. A twelve-month trend is the story; a two-slice
 * donut beside it is a footnote, and giving them the same rectangle makes the
 * reader work out the difference for themselves.
 *
 * Four sizes, expressed as a share of a row rather than in pixels, because a
 * dashboard is read at every width between a phone and a wall display and a
 * pixel size is right at exactly one of them. The spans are CSS classes with
 * their own breakpoints (see globals.css): the grid is one column on a phone,
 * two on a tablet and six on a desktop, and each size claims a different number
 * of those six.
 *
 * The height goes with it. A chart given the full width and left at the height
 * of a third-width card is a letterbox, and a letterbox is the one shape a
 * trend line cannot be read in.
 */

export const SLIDE_SIZES = [
  {
    id: 'small',
    label: 'Small',
    blurb: 'A third of the row — three across.',
    /** Grid span, per breakpoint. Defined in globals.css. */
    span: 'slide-small',
    /** The chart's own height inside the card. */
    height: 'h-40',
  },
  {
    id: 'medium',
    label: 'Medium',
    blurb: 'Half the row — two across.',
    span: 'slide-medium',
    height: 'h-48',
  },
  {
    id: 'large',
    label: 'Large',
    blurb: 'Two thirds of the row.',
    span: 'slide-large',
    height: 'h-64',
  },
  {
    id: 'full',
    label: 'Full width',
    blurb: 'The whole row, on its own.',
    span: 'slide-full',
    height: 'h-80',
  },
];

/**
 * Half a row.
 *
 * The same two-across a dashboard has always had, so a deck made before sizing
 * existed — and one made by the analyst, which sets no size — lays out exactly
 * as it did.
 */
export const DEFAULT_SLIDE_SIZE = 'medium';

export const isSlideSize = (id) => SLIDE_SIZES.some((s) => s.id === id);

/** The size a slide is, falling back to the default rather than to nothing. */
export function slideSize(id) {
  return SLIDE_SIZES.find((s) => s.id === id) || SLIDE_SIZES.find((s) => s.id === DEFAULT_SLIDE_SIZE);
}

/**
 * The next size round, for a control that cycles rather than opens a menu.
 *
 * Small to medium to large to full and back. Used by the keyboard shortcut and
 * by the compact control on a narrow screen, where four buttons do not fit.
 */
export function nextSlideSize(id) {
  const at = SLIDE_SIZES.findIndex((s) => s.id === (isSlideSize(id) ? id : DEFAULT_SLIDE_SIZE));
  return SLIDE_SIZES[(at + 1) % SLIDE_SIZES.length].id;
}
