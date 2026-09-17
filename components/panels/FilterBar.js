'use client';

/**
 * The slice the dashboard is showing, and the controls for changing it.
 *
 * Two ways in, because they answer different questions. A chip appears when
 * somebody clicks a bar — that is the fast path, and the chip exists mostly so
 * the click can be undone by someone who does not remember making it. The
 * picker is the slow path: it is how a filter is found rather than stumbled
 * into, and it is the only way to reach the columns no chart on the deck is
 * about.
 *
 * The values come from the vocabulary the worker already computed, so opening
 * the picker costs nothing and never scans the rows. A column it did not
 * summarise — an identifier, a free-text field, anything above forty distinct
 * values — is offered as a range or not at all rather than as a list of
 * thousands of checkboxes.
 */
import { useMemo, useState } from 'react';
import { CalendarRange, Filter, ListFilter, Loader2, Plus, Sigma, X } from 'lucide-react';
import { useActions, useAnalysis, useDataset } from '../../lib/store/DatasetProvider';
import { DATES, RANGE, VALUES, describeFilter } from '../../lib/filters';
import { prettyColumn } from '../../lib/aggregateNames';

export default function FilterBar() {
  const { dataset } = useDataset();
  const { analysis, filters, filtering } = useAnalysis();
  const { applyFilters, removeFilter, clearFilters } = useActions();
  const [adding, setAdding] = useState(false);

  const active = filters || [];
  const rows = analysis?.filter?.rowCount;

  if (!dataset) return null;

  return (
    <div className="mb-5 flex flex-wrap items-center gap-2" data-tutorial="dashboard-filters">
      <span className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.2em] text-white/30">
        <Filter size={12} /> Filter
      </span>

      {active.map((filter) => (
        <button
          key={`${filter.column}-${filter.kind}`}
          type="button"
          onClick={() => removeFilter(filter.column)}
          title="Remove this filter"
          className="group flex min-h-9 items-center gap-1.5 rounded-lg border border-accent-500/30 bg-accent-500/10 px-3 py-1.5 text-[12px] font-semibold text-accent-300 transition-colors hover:border-accent-500/50"
        >
          {describeFilter(filter, prettyColumn(filter.column))}
          <X size={12} className="text-accent-400/60 group-hover:text-accent-300" />
        </button>
      ))}

      {!active.length && (
        <span className="text-[12px] text-white/30">
          The whole table. Click a bar, a slice or a cell to narrow it.
        </span>
      )}

      <button
        type="button"
        onClick={() => setAdding((v) => !v)}
        className="flex min-h-9 items-center gap-1 rounded-lg border border-white/10 px-2.5 py-1.5 text-[11px] font-bold text-white/50 transition-colors hover:bg-white/5 hover:text-white"
      >
        <Plus size={12} /> Filter
      </button>

      {active.length > 0 && (
        <button
          type="button"
          onClick={clearFilters}
          className="min-h-9 rounded-lg px-2 py-1.5 text-[11px] font-bold uppercase tracking-[0.15em] text-white/35 transition-colors hover:text-white"
        >
          Clear all
        </button>
      )}

      {filtering && (
        <span className="flex items-center gap-1.5 text-[11px] text-white/35">
          <Loader2 size={12} className="animate-spin" /> Recomputing
        </span>
      )}

      {/* The row count is the honest label on a filtered deck: every figure
          above is a figure over these rows and no others. */}
      {!filtering && active.length > 0 && Number.isFinite(rows) && (
        <span className="text-[11px] text-white/35">
          {rows.toLocaleString()} of {(dataset.rowCount || 0).toLocaleString()} rows
        </span>
      )}

      {adding && (
        <FilterPicker
          dataset={dataset}
          active={active}
          onClose={() => setAdding(false)}
          onAdd={(filter) => {
            setAdding(false);
            applyFilters([...active.filter((f) => f.column !== filter.column), filter]);
          }}
        />
      )}
    </div>
  );
}

/**
 * Choose a column, then choose what to keep.
 *
 * The column list is ordered the way a person looks for one: the categories
 * first, because that is what a filter usually is, then numbers, then dates.
 */
function FilterPicker({ dataset, active, onClose, onAdd }) {
  const [column, setColumn] = useState(null);
  const profile = dataset.profile;
  const vocabulary = dataset.vocabulary;

  const choices = useMemo(() => {
    const temporal = new Set(profile?.temporal || []);
    const levels = vocabulary?.dimensions || {};
    const out = [];
    for (const name of profile?.dimensions || []) {
      if (temporal.has(name)) continue;
      if (levels[name]?.length) out.push({ column: name, kind: VALUES });
    }
    for (const name of profile?.measures || []) out.push({ column: name, kind: RANGE });
    for (const name of temporal) out.push({ column: name, kind: DATES });
    return out;
  }, [profile, vocabulary]);

  const chosen = choices.find((c) => c.column === column) || null;

  return (
    <div className="panel absolute z-30 mt-2 w-[min(28rem,calc(100vw-2rem))] overflow-hidden p-3" style={{ top: '100%' }}>
      <div className="mb-2 flex items-center justify-between">
        <span className="label">{chosen ? prettyColumn(chosen.column) : 'Filter on'}</span>
        <button type="button" onClick={chosen ? () => setColumn(null) : onClose} className="text-white/35 hover:text-white">
          <X size={14} />
        </button>
      </div>

      {!chosen && (
        <div className="max-h-72 overflow-y-auto">
          {choices.length === 0 && (
            <p className="px-2 py-4 text-[12px] text-white/35">
              Nothing here can be filtered on yet — the columns are identifiers or free text.
            </p>
          )}
          {choices.map((choice) => (
            <button
              key={choice.column}
              type="button"
              onClick={() => setColumn(choice.column)}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-[13px] text-white/75 transition-colors hover:bg-white/5"
            >
              {choice.kind === VALUES && <ListFilter size={13} className="text-white/30" />}
              {choice.kind === RANGE && <Sigma size={13} className="text-white/30" />}
              {choice.kind === DATES && <CalendarRange size={13} className="text-white/30" />}
              <span className="min-w-0 flex-1 truncate">{prettyColumn(choice.column)}</span>
              {active.some((f) => f.column === choice.column) && (
                <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-accent-400/70">on</span>
              )}
            </button>
          ))}
        </div>
      )}

      {chosen?.kind === VALUES && (
        <ValuePicker
          column={chosen.column}
          levels={vocabulary?.dimensions?.[chosen.column] || []}
          selected={active.find((f) => f.column === chosen.column && f.kind === VALUES)?.values || []}
          onApply={(values) => onAdd({ kind: VALUES, column: chosen.column, values })}
        />
      )}

      {chosen?.kind === RANGE && (
        <RangePicker
          column={chosen.column}
          range={vocabulary?.measures?.[chosen.column] || null}
          current={active.find((f) => f.column === chosen.column && f.kind === RANGE) || null}
          onApply={(min, max) => onAdd({ kind: RANGE, column: chosen.column, min, max })}
        />
      )}

      {chosen?.kind === DATES && (
        <DatePicker
          current={active.find((f) => f.column === chosen.column && f.kind === DATES) || null}
          onApply={(from, to) => onAdd({ kind: DATES, column: chosen.column, from, to })}
        />
      )}
    </div>
  );
}

const FIELD =
  'min-w-0 flex-1 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-[12px] text-white/85 outline-none focus:border-accent-500/50';
const APPLY =
  'rounded-lg bg-accent-500 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.2em] text-on-accent transition-colors hover:bg-accent-400 disabled:opacity-40';

/** Tick the values to keep. Counts ride along, because they are already known. */
function ValuePicker({ levels, selected, onApply }) {
  const [picked, setPicked] = useState(new Set(selected));
  const toggle = (value) => {
    const next = new Set(picked);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    setPicked(next);
  };

  return (
    <>
      <div className="max-h-64 overflow-y-auto">
        {levels.map((level) => (
          <label
            key={level.value}
            className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] text-white/75 transition-colors hover:bg-white/5"
          >
            <input
              type="checkbox"
              checked={picked.has(level.value)}
              onChange={() => toggle(level.value)}
              className="h-3.5 w-3.5 accent-accent-500"
            />
            <span className="min-w-0 flex-1 truncate">{level.value}</span>
            <span className="shrink-0 text-[11px] tabular-nums text-white/25">{level.count}</span>
          </label>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-end gap-2 border-t border-white/8 pt-2">
        <button type="button" disabled={!picked.size} onClick={() => onApply([...picked])} className={APPLY}>
          Apply
        </button>
      </div>
    </>
  );
}

/** Between two numbers. Either end may be left open. */
function RangePicker({ range, current, onApply }) {
  const [min, setMin] = useState(current?.min ?? '');
  const [max, setMax] = useState(current?.max ?? '');

  return (
    <>
      {range && (
        <p className="mb-2 text-[11px] text-white/30">
          The column runs {range.min} to {range.max}, and the middle value is {range.median}.
        </p>
      )}
      <div className="flex items-center gap-2">
        <input value={min} onChange={(e) => setMin(e.target.value)} placeholder="lowest" inputMode="decimal" className={FIELD} />
        <span className="text-[11px] text-white/30">to</span>
        <input value={max} onChange={(e) => setMax(e.target.value)} placeholder="highest" inputMode="decimal" className={FIELD} />
        <button
          type="button"
          disabled={min === '' && max === ''}
          onClick={() => onApply(min === '' ? null : Number(min), max === '' ? null : Number(max))}
          className={APPLY}
        >
          Apply
        </button>
      </div>
    </>
  );
}

/** Between two dates, either end open. */
function DatePicker({ current, onApply }) {
  const [from, setFrom] = useState(current?.from || '');
  const [to, setTo] = useState(current?.to || '');

  return (
    <div className="flex items-center gap-2">
      <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={FIELD} />
      <span className="text-[11px] text-white/30">to</span>
      <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={FIELD} />
      <button type="button" disabled={!from && !to} onClick={() => onApply(from || null, to || null)} className={APPLY}>
        Apply
      </button>
    </div>
  );
}
