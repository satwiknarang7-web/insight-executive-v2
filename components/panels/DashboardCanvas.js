'use client';

/**
 * The board the cards sit on.
 *
 * Absolute positions on a canvas of fixed logical width, scaled to whatever
 * width the page gives it — see lib/canvasLayout.js for why the coordinates are
 * logical rather than real. This component owns three things and nothing else:
 * the scale, the drag, and the fallback on a narrow screen.
 *
 * **The drag is a pointer, not a library.** Move by dragging the card, resize by
 * dragging its corner, both in edit mode only. Every delta is divided by the
 * scale on the way in, because the pointer moves in screen pixels and the card
 * lives in canvas ones — without that, a board scaled to 70% moves further than
 * the cursor does, which feels broken in a way that is hard to name.
 *
 * **A drag is not a click.** The cards are links to their write-ups outside edit
 * mode and full of text fields inside it, so a press that lands on a control, or
 * that never travels far enough to be a drag, is left alone entirely.
 *
 * **Below the tablet breakpoint there is no canvas.** A layout scaled to fit a
 * phone puts a chart at four hundred pixels wide and its labels below legibility,
 * so the cards stack in the order the arrangement reads in — down the page, then
 * across — at full width, each keeping the height it was given.
 *
 * **The page is a fixed size**, and this is the same page the deck's closing
 * slide shows. That is the point of it: what is arranged here is what is
 * presented, at whatever size the screen it is presented on happens to be.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  canvasScale,
  cardBox,
  layoutMap,
  moveBox,
  readingOrder,
  resizeBox,
} from '../../lib/canvasLayout';

/**
 * Hold the pointer for the length of the drag, where the browser allows it.
 *
 * Capture is what keeps a fast drag attached to the card when the cursor
 * outruns it, and it is also the one call here that can throw: a pointer id
 * with no active pointer behind it — a synthetic event, some assistive tools —
 * raises rather than returning false. The drag is better without capture than
 * not started at all.
 */
function hold(element, pointerId) {
  try {
    element?.setPointerCapture?.(pointerId);
  } catch {
    /* no capture; the move handler still tracks the pointer */
  }
}

function release(element, pointerId) {
  try {
    element?.releasePointerCapture?.(pointerId);
  } catch {
    /* it was never held */
  }
}

/** How far a press has to travel before it is a drag rather than a click. */
const DRAG_THRESHOLD = 3;

/** Anything a press might have been aimed at instead of the card. */
const CONTROLS = 'input, textarea, select, button, a, [contenteditable="true"], [data-no-drag]';

/** Where the stacking fallback takes over. Matches globals.css and the grid. */
const NARROW = '(max-width: 767px)';

export default function DashboardCanvas({ slides = [], sizeOf = null, editing = false, onMove, children }) {
  const hostRef = useRef(null);
  const [width, setWidth] = useState(CANVAS_WIDTH);
  const [narrow, setNarrow] = useState(false);
  const [dragging, setDragging] = useState(null);

  // The room available, measured rather than assumed: the canvas sits inside a
  // page frame whose width depends on the sidebar, which the reader can collapse.
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host || typeof ResizeObserver === 'undefined') return undefined;
    const measure = () => setWidth(host.clientWidth || CANVAS_WIDTH);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const mq = window.matchMedia(NARROW);
    const sync = () => setNarrow(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  const boxes = layoutMap(slides, sizeOf);
  const scale = canvasScale(width);
  const height = CANVAS_HEIGHT;

  /**
   * A press on a card, which may become a move.
   *
   * The card is not moved on the first pixel: until the pointer has travelled
   * far enough to mean it, this is still a click on whatever is underneath.
   */
  const startMove = useCallback(
    (event, id, box) => {
      if (!editing || event.button !== 0) return;
      if (event.target.closest(CONTROLS)) return;
      hold(event.currentTarget, event.pointerId);
      setDragging({ id, mode: 'move', box, x: event.clientX, y: event.clientY, moved: false });
    },
    [editing]
  );

  const startResize = useCallback(
    (event, id, box) => {
      if (!editing || event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      hold(event.currentTarget, event.pointerId);
      setDragging({ id, mode: 'resize', box, x: event.clientX, y: event.clientY, moved: true });
    },
    [editing]
  );

  const onPointerMove = useCallback(
    (event) => {
      if (!dragging) return;
      const dx = (event.clientX - dragging.x) / scale;
      const dy = (event.clientY - dragging.y) / scale;
      if (!dragging.moved && Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
      if (!dragging.moved) setDragging((d) => (d ? { ...d, moved: true } : d));

      const next = dragging.mode === 'move' ? moveBox(dragging.box, dx, dy) : resizeBox(dragging.box, dx, dy);
      onMove?.(dragging.id, next);
    },
    [dragging, scale, onMove]
  );

  const endDrag = useCallback(
    (event) => {
      if (!dragging) return;
      // A press that became a drag must not also open the card it started on.
      if (dragging.moved) {
        event.preventDefault();
        event.stopPropagation();
      }
      release(event.currentTarget, event.pointerId);
      setDragging(null);
    },
    [dragging]
  );

  const render = (slide, index, extra = {}) =>
    children({
      slide,
      index,
      box: boxes.get(String(slide.id)) || cardBox(null),
      dragging: dragging?.id === slide.id && dragging.moved,
      onCardPointerDown: (event) => startMove(event, slide.id, boxes.get(String(slide.id)) || cardBox(null)),
      onResizePointerDown: (event) => startResize(event, slide.id, boxes.get(String(slide.id)) || cardBox(null)),
      ...extra,
    });

  // Stacked: one column, in the order the arrangement reads. The heights are
  // kept because they are the reader's, and the widths are not because there is
  // only one width here.
  if (narrow) {
    return (
      <div ref={hostRef} className="flex flex-col gap-4">
        {/*
          * Said rather than silently done.
          *
          * The arrangement is a position on a page, and there is no page at
          * this width — so the tiles are shown in the order the arrangement
          * reads and nothing can be dragged. Somebody who opened the board to
          * move a card deserves to be told that is not available here, instead
          * of tapping a tile that will not move.
          */}
        {editing && (
          <p className="rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2 text-[12px] leading-relaxed text-white/45">
            This screen is too narrow for the board, so the tiles are listed in the order the arrangement
            reads. Open it on a wider screen to move or resize them.
          </p>
        )}
        {readingOrder(slides, sizeOf).map((slide, index) => render(slide, index, { stacked: true }))}
      </div>
    );
  }

  return (
    <div ref={hostRef} className="w-full">
      {/* The outer box takes the scaled height, so the page below it starts
          where the canvas visually ends rather than where its unscaled self
          would have. */}
      <div style={{ height: height * scale }} className="relative w-full overflow-hidden">
        <div
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          style={{
            width: CANVAS_WIDTH,
            height,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
            touchAction: dragging ? 'none' : undefined,
            // Centred in whatever room is left over. A scaled page still takes
            // its full logical width in the layout, so the margin is computed
            // from the drawn width rather than left to the browser.
            marginLeft: Math.max(0, (width - CANVAS_WIDTH * scale) / 2),
          }}
          className="relative"
        >
          {slides.map((slide, index) => render(slide, index))}
        </div>
      </div>
    </div>
  );
}
