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
 */
import { useMemo, useState } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import { formatNumber } from '../../lib/format';
import { DEFAULT_SLICER_MODE } from '../../lib/chartSpecs';

/** Above this many values, finding one by eye stops working. */
const SEARCHABLE = 8;

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

  const rows = useMemo(() => {
    const all = (data || []).filter((row) => row && row[nameKey] !== null && row[nameKey] !== undefined);
    const text = query.trim().toLowerCase();
    if (!text) return all;
    return all.filter((row) => String(row[nameKey]).toLowerCase().includes(text));
  }, [data, nameKey, query]);

  if (!data?.length) return null;

  /**
   * Closed, a dropdown says what it is filtering to rather than what it could.
   *
   * "3 of 4" would be arithmetic about a control; the values themselves are
   * what a reader needs to see without opening anything, and the count is only
   * reached for when there are too many of them to read.
   */
  if (mode === 'dropdown' && !open) {
    const chosenList = [...chosen];
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
          type="button"
          onClick={() => setOpen(true)}
          className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-[13px] transition-colors hover:border-accent-500/40 ${
            chosenList.length ? 'border-accent-500/30 bg-accent-500/10 text-accent-300' : 'border-white/10 bg-white/5 text-white/70'
          }`}
        >
          <span className="min-w-0 flex-1 truncate font-semibold">{summary}</span>
          <ChevronDown size={14} className="shrink-0 opacity-50" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {mode === 'dropdown' && (
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="mb-1.5 flex shrink-0 items-center justify-between rounded-lg border border-accent-500/30 bg-accent-500/10 px-3 py-1.5 text-[12px] font-semibold text-accent-300"
        >
          <span>Done</span>
          <ChevronDown size={14} className="rotate-180 opacity-50" />
        </button>
      )}
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
    </div>
  );
}
