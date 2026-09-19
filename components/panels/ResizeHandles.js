'use client';

/**
 * The grips around a card on the board.
 *
 * There used to be one, in the bottom-right corner, and it could only do what a
 * bottom-right corner can do: push the right edge out and the bottom edge down.
 * Making a card wider on its left meant dragging it wider on the right and then
 * dragging the whole card back — two gestures for one intention, and the second
 * one destroys the alignment the first one was measured against.
 *
 * So there are eight: the four edges and the four corners, as every other
 * canvas has. An edge changes one dimension, a corner changes both, and the
 * side opposite the one being dragged does not move — which is what makes a
 * card alignable at all. See `resizeBox` in lib/canvasLayout.js.
 *
 * **The edges are strips, not dots.** A four-pixel target is a control that
 * misses; these are ten pixels of hit area running the length of each side,
 * which is about where a pointer aims when somebody means "this edge". They are
 * invisible until the card is hovered, and then only the thinnest accent line
 * shows — a card ringed with eight visible marks is a card whose content nobody
 * can read.
 *
 * **They sit inside the card's edge rather than straddling it.** Straddling
 * aims better, and it does not survive the cards: a finding card clips its own
 * chart with `overflow-hidden`, so anything hanging past its border is not
 * drawn and, more to the point, is not clickable either. Inside the border the
 * strips land on the card's own padding, clear of its title and its plot.
 *
 * **One tab stop, not eight.** The corner grip stays in the keyboard order and
 * answers the arrow keys; the other seven are `tabIndex={-1}`. Eight stops per
 * card would make a ten-card board an eighty-press walk to reach anything, and
 * every size the seven can produce, the one can too.
 */
import { MIN_CARD_HEIGHT, MIN_CARD_WIDTH } from '../../lib/canvasLayout';

/** How far an arrow key moves an edge. Big enough to be worth a press. */
const STEP = 20;

/**
 * Where each grip sits and what it says it will do.
 *
 * The corners are kept clear of the edges rather than overlapping them, so a
 * press near a corner resizes both dimensions instead of whichever of the two
 * happened to be painted last.
 */
const HANDLES = [
  { edge: 'n', name: 'top edge', cursor: 'ns-resize', className: 'top-0 left-4 right-4 h-2.5' },
  { edge: 's', name: 'bottom edge', cursor: 'ns-resize', className: 'bottom-0 left-4 right-4 h-2.5' },
  { edge: 'w', name: 'left edge', cursor: 'ew-resize', className: 'left-0 top-4 bottom-4 w-2.5' },
  { edge: 'e', name: 'right edge', cursor: 'ew-resize', className: 'right-0 top-4 bottom-4 w-2.5' },
  { edge: 'nw', name: 'top-left corner', cursor: 'nwse-resize', className: 'top-0 left-0 h-4 w-4' },
  { edge: 'ne', name: 'top-right corner', cursor: 'nesw-resize', className: 'top-0 right-0 h-4 w-4' },
  { edge: 'sw', name: 'bottom-left corner', cursor: 'nesw-resize', className: 'bottom-0 left-0 h-4 w-4' },
];

/** What an arrow key does to the bottom-right corner. */
const KEYS = {
  ArrowLeft: { dx: -STEP, dy: 0 },
  ArrowRight: { dx: STEP, dy: 0 },
  ArrowUp: { dx: 0, dy: -STEP },
  ArrowDown: { dx: 0, dy: STEP },
};

export default function ResizeHandles({ label, onPointerDown, onKeyResize, box }) {
  const what = label || 'this card';

  const onKeyDown = (event) => {
    const move = KEYS[event.key];
    if (!move || !onKeyResize) return;
    event.preventDefault();
    event.stopPropagation();
    onKeyResize(move.dx, move.dy);
  };

  return (
    <>
      {HANDLES.map((handle) => (
        <button
          key={handle.edge}
          type="button"
          data-no-drag
          tabIndex={-1}
          aria-hidden="true"
          title={`Drag the ${handle.name}`}
          onPointerDown={(event) => onPointerDown(event, handle.edge)}
          style={{ cursor: handle.cursor, touchAction: 'none' }}
          className={`group/grip absolute z-20 flex items-center justify-center ${handle.className}`}
        >
          {/*
            * The line the pointer is actually aiming at, drawn inside a target
            * three times its size. Invisible until the card is hovered, because
            * eight permanent marks around every card is a border, not a hint.
            */}
          <span
            className={`rounded-full bg-accent-400/0 transition-colors group-hover/grip:bg-accent-400/70 ${
              handle.edge.length === 2 ? 'h-1.5 w-1.5' : handle.cursor === 'ns-resize' ? 'h-[3px] w-full' : 'h-full w-[3px]'
            }`}
          />
        </button>
      ))}

      {/*
        * The bottom-right corner, which keeps the grip everybody recognises and
        * the keyboard's only way in. Sized and drawn exactly as the single
        * handle was, so nothing a reader already knows has moved.
        */}
      <button
        type="button"
        data-no-drag
        aria-label={
          box
            ? `Resize ${what}. Currently ${Math.round(box.w)} by ${Math.round(box.h)}. Arrow keys resize; minimum ${MIN_CARD_WIDTH} by ${MIN_CARD_HEIGHT}.`
            : `Resize ${what}. Arrow keys resize.`
        }
        title="Drag to resize"
        onPointerDown={(event) => onPointerDown(event, 'se')}
        onKeyDown={onKeyDown}
        onClick={(event) => {
          // The card behind this is a link outside edit mode; a grab is not a
          // click on the finding.
          event.preventDefault();
          event.stopPropagation();
        }}
        style={{ touchAction: 'none' }}
        className="absolute bottom-1 right-1 z-20 flex h-6 w-6 cursor-nwse-resize items-center justify-center rounded text-white/20 transition-colors hover:text-accent-400 focus-visible:text-accent-400"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M11 1 1 11M11 5 5 11M11 9 9 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
    </>
  );
}
