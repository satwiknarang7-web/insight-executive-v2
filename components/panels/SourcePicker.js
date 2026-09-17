'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import { brandFor, searchSources, sourceById, sourceGroups } from '../../lib/sources';

/**
 * Choosing where the data comes from.
 *
 * This was a grid of thirty-eight tiles, every one the same size and weight,
 * which is the shape of a catalogue rather than of a choice. Nobody reads
 * thirty-eight things: they either already know what they want, or they want
 * the obvious one. A grid serves neither — it makes the person who knows scan
 * for their name, and it buries the CSV that nine in ten of them are here for
 * under twenty-nine database logos.
 *
 * So it is a dropdown. Closed, it shows the choice and nothing else. Open, it
 * is a search box over a grouped list, which answers both people: type three
 * letters, or take the first item. It is also, unlike a grid, the control that
 * every other application uses for exactly this, which counts for something.
 *
 * Built by hand rather than as a `<select>` because a native option list
 * cannot hold a mark, a description, or a group that stays visible while you
 * filter it.
 */
export default function SourcePicker({ value, onChange, allowsModel = true }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const rootRef = useRef(null);
  const inputRef = useRef(null);

  const groups = useMemo(() => sourceGroups(), []);
  const results = useMemo(() => (query.trim() ? searchSources(query) : null), [query]);
  const flat = useMemo(() => results || groups.flatMap((g) => g.items), [results, groups]);
  const chosen = sourceById(value) || flat[0];

  // Clicking away closes it, which is the one behaviour a dropdown cannot do
  // without listening outside itself.
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => {
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
    else setQuery('');
    setActive(0);
  }, [open]);

  const pick = useCallback(
    (id) => {
      onChange(id);
      setOpen(false);
    },
    [onChange]
  );

  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => {
        const next = e.key === 'ArrowDown' ? i + 1 : i - 1;
        return Math.max(0, Math.min(flat.length - 1, next));
      });
      return;
    }
    if (e.key === 'Enter' && flat[active]) {
      e.preventDefault();
      pick(flat[active].id);
    }
  };

  const row = (item, index) => {
    const brand = brandFor(item);
    const selected = item.id === value;
    const highlighted = index === active;
    const locked = item.needs === 'model' && !allowsModel;
    return (
      <button
        key={item.id}
        type="button"
        role="option"
        aria-selected={selected}
        onMouseEnter={() => setActive(index)}
        onClick={() => pick(item.id)}
        className={`flex w-full items-start gap-3 px-3 py-2 text-left transition-colors ${
          highlighted ? 'bg-white/6' : ''
        }`}
      >
        <Mark brand={brand} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className={`truncate text-[13px] font-semibold ${selected ? 'text-accent-300' : 'text-white/85'}`}>
              {item.label}
            </span>
            {locked && (
              <span className="rounded-full border border-accent-500/30 bg-accent-500/10 px-1.5 py-px text-[8px] font-bold uppercase tracking-[0.15em] text-accent-400">
                Pro
              </span>
            )}
            {selected && <Check size={13} className="shrink-0 text-accent-400" />}
          </span>
          <span className="mt-0.5 line-clamp-1 block text-[11px] text-white/35">{item.blurb}</span>
        </span>
      </button>
    );
  };

  // A flat index across the groups, so the arrow keys walk the list the way it
  // looks rather than the way it is nested.
  let cursor = -1;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-full items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-left transition-colors hover:border-accent-500/30"
      >
        <Mark brand={brandFor(chosen)} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold text-white/85">{chosen?.label}</span>
          <span className="mt-0.5 line-clamp-1 block text-[11px] text-white/35">{chosen?.blurb}</span>
        </span>
        <ChevronDown size={15} className={`shrink-0 text-white/30 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="panel absolute z-30 mt-2 w-full overflow-hidden">
          <div className="relative border-b border-white/8">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/25" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Search — Postgres, Parquet, Google Sheets…"
              aria-label="Search data sources"
              className="w-full border-0 bg-transparent py-2.5 pl-9 pr-3 text-[13px] outline-none placeholder:text-white/25"
            />
          </div>

          <div role="listbox" className="max-h-[22rem] overflow-y-auto py-1">
            {results ? (
              results.length ? (
                results.map((item) => row(item, ++cursor))
              ) : (
                <p className="px-3 py-6 text-center text-[12px] leading-relaxed text-white/35">
                  Nothing called “{query}”. A database not listed here can usually be reached through the
                  Postgres or MySQL connector it is compatible with.
                </p>
              )
            ) : (
              groups.map((g) => (
                <div key={g.id}>
                  <div className="sticky top-0 flex items-center gap-2 bg-surface px-3 py-1.5">
                    <span className="label">{g.label}</span>
                    <span className="text-[10px] text-white/20">{g.items.length}</span>
                  </div>
                  {g.items.map((item) => row(item, ++cursor))}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The mark: two letters in the colour the thing is known by.
 *
 * Not the logo. Thirty companies' trademarks are thirty licences, and a mark
 * that is subtly wrong is worse than one that is plainly ours — so this is the
 * colour and the initials, which is enough to find a row by at a glance.
 */
function Mark({ brand }) {
  return (
    <span
      aria-hidden="true"
      className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[10px] font-bold tracking-tight"
      style={
        brand.color
          ? { backgroundColor: `${brand.color}22`, color: brand.color, boxShadow: `inset 0 0 0 1px ${brand.color}33` }
          : undefined
      }
    >
      {brand.mark}
    </span>
  );
}
