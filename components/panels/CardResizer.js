'use client';

/**
 * The corner you drag to size a card.
 *
 * Width and height in one gesture, because that is how a card is sized
 * everywhere else and because two separate controls make the common case — a
 * bit wider and a bit taller — into two decisions.
 *
 * The width snaps to the grid's columns while the height is free, which is not
 * a compromise between the two: see lib/slideSize.js for why a dashboard read
 * at every width from a phone to a wall display cannot have a card measured in
 * pixels across, while the room its plot gets is exactly a pixel question.
 *
 * It answers the arrow keys too. A drag handle that only takes a mouse is a
 * control that a keyboard cannot reach, and this one governs how much of the
 * report a reader can see at once.
 */
import { useCallback, useRef, useState } from 'react';
import { GRID_COLUMNS, MAX_HEIGHT, MIN_HEIGHT, columnsForWidth, describeLayout, resizeLayout, slideLayout } from '../../lib/slideSize';

/** The step an arrow key takes: one column, or a readable slice of height. */
const HEIGHT_STEP = 24;

/** How many columns the grid actually has at this width, per globals.css. */
function gridColumns() {
  if (typeof window === 'undefined') return GRID_COLUMNS;
  if (window.matchMedia('(min-width: 1280px)').matches) return GRID_COLUMNS;
  if (window.matchMedia('(min-width: 768px)').matches) return 2;
  return 1;
}

export default function CardResizer({ layout, onResize, label }) {
  const current = slideLayout(layout);
  const [dragging, setDragging] = useState(false);
  const start = useRef(null);

  const onPointerDown = useCallback(
    (event) => {
      const card = event.currentTarget.closest('[data-card]');
      const grid = card?.parentElement;
      if (!card || !grid) return;

      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture?.(event.pointerId);

      const rect = card.getBoundingClientRect();
      start.current = {
        x: event.clientX,
        y: event.clientY,
        width: rect.width,
        height: current.height,
        gridWidth: grid.clientWidth,
        columns: gridColumns(),
      };
      setDragging(true);
    },
    [current.height]
  );

  const onPointerMove = useCallback(
    (event) => {
      const from = start.current;
      if (!from) return;
      // The pointer's travel, not its position: the handle sits in the corner
      // and the card's own edge is what is being moved.
      const cols = columnsForWidth(from.width + (event.clientX - from.x), {
        gridWidth: from.gridWidth,
        columns: from.columns,
      });
      const height = from.height + (event.clientY - from.y);
      onResize(resizeLayout(current, { cols, height }));
    },
    [current, onResize]
  );

  const stop = useCallback((event) => {
    start.current = null;
    setDragging(false);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  }, []);

  const onKeyDown = useCallback(
    (event) => {
      const moves = {
        ArrowLeft: { cols: current.cols - 1 },
        ArrowRight: { cols: current.cols + 1 },
        ArrowUp: { height: current.height - HEIGHT_STEP },
        ArrowDown: { height: current.height + HEIGHT_STEP },
      };
      const move = moves[event.key];
      if (!move) return;
      event.preventDefault();
      event.stopPropagation();
      onResize(resizeLayout(current, move));
    },
    [current, onResize]
  );

  return (
    <button
      type="button"
      aria-label={`Resize ${label}. Currently ${describeLayout(current)}. Arrow keys resize.`}
      title={describeLayout(current)}
      onPointerDown={onPointerDown}
      onPointerMove={dragging ? onPointerMove : undefined}
      onPointerUp={stop}
      onPointerCancel={stop}
      onKeyDown={onKeyDown}
      onClick={(e) => {
        // The card behind this is a link outside edit mode; a grab is not a
        // click on the finding.
        e.preventDefault();
        e.stopPropagation();
      }}
      className={`absolute bottom-1 right-1 flex h-6 w-6 cursor-nwse-resize items-center justify-center rounded text-white/20 transition-colors hover:text-accent-400 ${
        dragging ? 'text-accent-400' : ''
      }`}
      style={{ touchAction: 'none' }}
    >
      {/* Three strokes in the corner: the shape everything else on a desktop
          uses for this, so it needs no explaining. */}
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
        <path d="M11 1 1 11M11 5 5 11M11 9 9 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </button>
  );
}

export { MIN_HEIGHT, MAX_HEIGHT };
