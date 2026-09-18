'use client';

/**
 * A filter, drawn as a chart.
 *
 * The rows are the column's values and how many rows each one has, which came
 * from this tile's own query like every other figure on the board — so the
 * counts beside the boxes are real, and they narrow when another filter is on.
 *
 * Two shapes, because a slicer with six values and one with sixty are different
 * problems. A short list is a list: every box visible, nothing to open. A long
 * one gets a search field above it, so finding a value does not mean scrolling
 * for it. Both scroll inside the tile rather than growing it, because the tile's
 * height is a size the reader set.
 *
 * What it does NOT do is filter itself. A slicer narrowed by its own column
 * would show one ticked value and nothing else, and there would be no way back
 * to the others — the worker leaves this column out when it runs this tile's
 * query, which is the one place that rule lives.
 *
 * **Opened, the list leaves the tile.** A dropdown is chosen precisely when the
 * board cannot spare the height for a list, so drawing the list inside the tile
 * puts it in the one box guaranteed to be too short for it — what a reader saw
 * was "Done", one value, and a scrollbar. The open list is a panel outside the
 * board instead, positioned against the button it belongs to. A portal rather than an
 * absolute child because the tile clips its overflow, and `position: fixed`
 * inside the deck's scaled board would be measured against the transform rather
 * than the window.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search } from 'lucide-react';
import { formatNumber } from '../../lib/format';
import { DEFAULT_SLICER_MODE } from '../../lib/chartSpecs';

/** Above this many values, finding one by eye stops working. */
const SEARCHABLE = 8;

/** The tallest the opened list gets before it scrolls inside itself. */
const PANEL_MAX_HEIGHT = 280;

/** Clearance the panel wants below the button before it flips above it. */
const PANEL_GAP = 4;

/**
 * Which element an escaped panel has to be a child of.
 *
 * `document.body` is the obvious answer and it is wrong in a deck. Fullscreen
 * paints the subtree of the fullscreen element and nothing else, so a panel
 * portalled to the body while `/present` holds the screen is a sibling of the
 * only branch being rendered: it is in the DOM, it is positioned, it is
 * painted nowhere. From the presenter's side the filter simply stops working —
 * the chevron turns, `aria-expanded` goes true, and no list appears — which is
 * indistinguishable from a dead button and was reported as one.
 *
 * Watched rather than read once, because the panel can be open across a
 * fullscreen toggle, and the element it needs to live in changes underneath it.
 */
function usePortalRoot() {
  const [root, setRoot] = useState(null);

  useEffect(() => {
    const read = () => setRoot(document.fullscreenElement || document.body);
    read();
    document.addEventListener('fullscreenchange', read);
    return () => document.removeEventListener('fullscreenchange', read);
  }, []);

  return root;
}

/**
 * Where an opened list goes, in window coordinates.
 *
 * Measured from the button rather than laid out beside it, because the panel is
 * rendered into the body: that is what lets it escape a tile that clips its
 * overflow and a board that is drawn under a CSS transform. Re-measured on
 * scroll and resize, since neither moves the panel on its own.
 */
function useAnchoredPanel(open, anchorRef) {
  const [rect, setRect] = useState(null);

  useLayoutEffect(() => {
    if (!open) {
      setRect(null);
      return undefined;
    }
    const measure = () => {
      const el = anchorRef.current;
      if (!el) return;
      const box = el.getBoundingClientRect();
      const below = window.innerHeight - box.bottom - PANEL_GAP;
      const above = box.top - PANEL_GAP;
      // Below unless there is more room above, which is where a filter along
      // the bottom edge of a board ends up.
      const flip = below < Math.min(PANEL_MAX_HEIGHT, above);
      setRect({
        left: box.left,
        width: box.width,
        top: flip ? undefined : box.bottom + PANEL_GAP,
        bottom: flip ? window.innerHeight - box.top + PANEL_GAP : undefined,
        maxHeight: Math.max(120, Math.min(PANEL_MAX_HEIGHT, flip ? above : below)),
      });
    };
    measure();
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
    };
  }, [open, anchorRef]);

  return rect;
}

export default function SlicerTile({
  data,
  nameKey,
  valueKey,
  selected = [],
  onToggle = null,
  onClear = null,
  mode = DEFAULT_SLICER_MODE,
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const chosen = useMemo(() => new Set((selected || []).map((v) => String(v))), [selected]);

  const anchorRef = useRef(null);
  const panelRef = useRef(null);
  const panelAt = useAnchoredPanel(open && mode === 'dropdown', anchorRef);
  const portalRoot = usePortalRoot();

  // A panel in the body is outside everything that would otherwise dismiss it,
  // so it listens for the two gestures that mean "I am done here".
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event) => {
      if (panelRef.current?.contains(event.target) || anchorRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);


  const rows = useMemo(() => {
    const all = (data || []).filter((row) => row && row[nameKey] !== null && row[nameKey] !== undefined);
    const text = query.trim().toLowerCase();
    if (!text) return all;
    return all.filter((row) => String(row[nameKey]).toLowerCase().includes(text));
  }, [data, nameKey, query]);

  if (!data?.length) return null;

  const chosenList = [...chosen];

  /**
   * The values, as a list of tick-boxes.
   *
   * One definition, used in the tile when the board can spare the height for a
   * list and in the panel when it cannot — two copies of a checkbox row is two
   * places for them to drift apart.
   */
  const list = (
    <>
      {data.length > SEARCHABLE && (
        <div className="relative mb-1.5 shrink-0">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-white/25" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            aria-label={`Search ${nameKey}`}
            className="w-full rounded-lg border border-white/8 bg-white/[0.03] py-1 pl-7 pr-2 text-[12px] text-white/80 outline-none placeholder:text-white/25 focus:border-accent-500/40"
          />
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto pr-0.5">
        {rows.length === 0 && (
          <p className="px-1 py-3 text-[12px] text-white/30">Nothing called “{query}”.</p>
        )}
        {rows.map((row) => {
          const value = String(row[nameKey]);
          const on = chosen.has(value);
          return (
            <button
              key={value}
              type="button"
              role="checkbox"
              aria-checked={on}
              onClick={() => onToggle?.(value)}
              className={`flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left transition-colors hover:bg-white/5 ${
                on ? 'text-accent-300' : 'text-white/70'
              }`}
            >
              <span
                aria-hidden="true"
                className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${
                  on ? 'border-accent-500 bg-accent-500/20' : 'border-white/20'
                }`}
              >
                {on && <Check size={10} className="text-accent-400" />}
              </span>
              <span className="min-w-0 flex-1 truncate text-[12px] font-medium">{value}</span>
              <span className="shrink-0 text-[11px] tabular-nums text-white/25">
                {formatNumber(row[valueKey])}
              </span>
            </button>
          );
        })}
      </div>

      {/* Only once something is ticked: an always-present "clear" on a tile
          that filters nothing is a control with nothing to do. */}
      {chosen.size > 0 && onClear && (
        <button
          type="button"
          onClick={onClear}
          className="mt-1 shrink-0 self-start rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.15em] text-white/30 transition-colors hover:text-white"
        >
          Clear
        </button>
      )}
    </>
  );

  /**
   * A dropdown is a button in the tile and a list over the page.
   *
   * Closed, the button says what it is filtering to rather than what it could:
   * "3 of 4" would be arithmetic about a control, and the values themselves are
   * what a reader needs to see without opening anything.
   */
  if (mode === 'dropdown') {
    const summary =
      chosenList.length === 0
        ? 'All'
        : chosenList.length <= 2
          ? chosenList.join(', ')
          : `${chosenList.length} selected`;
    return (
      // Centred: closed, this tile is one control, and pinned to the top it
      // read as a card that had failed to draw the rest of itself.
      <div className="flex h-full flex-col justify-center">
        <button
          ref={anchorRef}
          type="button"
          aria-expanded={open}
          aria-haspopup="listbox"
          onClick={() => setOpen((v) => !v)}
          className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-[13px] transition-colors hover:border-accent-500/40 ${
            chosenList.length || open
              ? 'border-accent-500/30 bg-accent-500/10 text-accent-300'
              : 'border-white/10 bg-white/5 text-white/70'
          }`}
        >
          <span className="min-w-0 flex-1 truncate font-semibold">{summary}</span>
          <ChevronDown size={14} className={`shrink-0 opacity-50 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>

        {open &&
          panelAt &&
          portalRoot &&
          createPortal(
            <div
              ref={panelRef}
              role="listbox"
              aria-label={String(nameKey).replace(/_/g, ' ')}
              style={{
                position: 'fixed',
                left: panelAt.left,
                top: panelAt.top,
                bottom: panelAt.bottom,
                width: Math.max(panelAt.width, 180),
                maxHeight: panelAt.maxHeight,
                zIndex: 60,
              }}
              className="panel flex flex-col overflow-hidden p-2"
            >
              {list}
            </div>,
            portalRoot
          )}
      </div>
    );
  }

  return <div className="flex h-full flex-col">{list}</div>;
}
