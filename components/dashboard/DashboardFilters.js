'use client';

/**
 * Filters, in one row above the charts: a date range when the table has
 * time, and a few category pickers the planner chose. Every tile and KPI is
 * recomputed under them; clicking a bar adds its category here too.
 */

import { useEffect, useRef, useState } from 'react';
import { Calendar, Check, ChevronDown, Filter, X } from 'lucide-react';
import { useDashboard } from '../../lib/store/DashboardProvider';

function CategoryPicker({ field, label, active, onChange }) {
  const { fieldValues } = useDashboard();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState(null);
  const [q, setQ] = useState('');
  const ref = useRef(null);
  useEffect(() => {
    if (!open || values) return;
    fieldValues(field).then((r) => setValues(r.values)).catch(() => setValues([]));
  }, [open, values, field, fieldValues]);
  useEffect(() => {
    if (!open) return;
    const close = (e) => !ref.current?.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const chosen = active?.values || [];
  const shown = (values || []).filter((v) => !q || v.value.toLowerCase().includes(q.toLowerCase())).slice(0, 100);
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex max-w-[220px] items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12px] font-semibold transition-colors ${chosen.length ? 'border-accent-500/40 bg-accent-500/10 text-accent-300' : 'border-white/10 text-white/60 hover:bg-white/5 hover:text-white'}`}
        aria-expanded={open}
      >
        <span className="truncate">{chosen.length ? `${label}: ${chosen.length === 1 ? chosen[0] : `${chosen.length} selected`}` : label}</span>
        <ChevronDown size={13} className="shrink-0" />
      </button>
      {open && (
        <div className="card absolute left-0 top-full z-40 mt-1 w-64 p-2 shadow-2xl">
          {(values?.length || 0) > 8 && (
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className="mb-2 w-full rounded-md border border-white/10 bg-white/[0.03] px-2 py-1.5 text-[12px] text-white/85 focus:border-accent-500/50 focus:outline-none" />
          )}
          <div className="max-h-64 overflow-y-auto">
            {!values && <div className="p-2 text-[12px] text-white/40">Loading…</div>}
            {shown.map((v) => {
              const on = chosen.includes(v.value);
              return (
                <button
                  key={v.value}
                  type="button"
                  onClick={() => onChange(on ? chosen.filter((x) => x !== v.value) : [...chosen, v.value])}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] text-white/75 hover:bg-white/5"
                >
                  <span className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${on ? 'border-accent-400 bg-accent-500 text-on-accent' : 'border-white/25'}`}>{on && <Check size={10} strokeWidth={3} />}</span>
                  <span className="min-w-0 flex-1 truncate">{v.value}</span>
                  <span className="shrink-0 font-mono text-[10px] text-white/35">{v.n.toLocaleString()}</span>
                </button>
              );
            })}
          </div>
          {chosen.length > 0 && (
            <button type="button" onClick={() => onChange([])} className="mt-1 w-full rounded-md px-2 py-1.5 text-left text-[12px] font-semibold text-accent-300 hover:bg-white/5">
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function DateRange({ field, label, active, onChange, min, max }) {
  const day = (t) => (typeof t === 'number' && t > 3000 ? new Date(t).toISOString().slice(0, 10) : t ? String(t) : '');
  const isYear = typeof min === 'number' && min < 3000;
  return (
    <div className="flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1 text-[12px] text-white/60">
      <Calendar size={13} className="shrink-0" aria-hidden="true" />
      <span className="hidden sm:inline">{label}</span>
      <input
        type={isYear ? 'number' : 'date'}
        aria-label={`${label} from`}
        value={active?.from ?? ''}
        min={day(min)}
        max={day(max)}
        onChange={(e) => onChange({ from: e.target.value ? (isYear ? Number(e.target.value) : e.target.value) : undefined, to: active?.to })}
        className="w-[118px] bg-transparent text-white/80 focus:outline-none"
        placeholder={day(min)}
      />
      <span className="text-white/30">–</span>
      <input
        type={isYear ? 'number' : 'date'}
        aria-label={`${label} to`}
        value={active?.to ?? ''}
        min={day(min)}
        max={day(max)}
        onChange={(e) => onChange({ from: active?.from, to: e.target.value ? (isYear ? Number(e.target.value) : e.target.value) : undefined })}
        className="w-[118px] bg-transparent text-white/80 focus:outline-none"
        placeholder={day(max)}
      />
    </div>
  );
}

export default function DashboardFilters({ board, fields }) {
  const { filters, setFilters } = useDashboard();
  const byName = (n) => fields.find((f) => f.name === n);
  const suggested = board?.filters || [];
  const shownFields = new Set(suggested.map((s) => s.field));
  const extra = filters.filter((f) => !shownFields.has(f.field));
  const set = (field, patch) => {
    const rest = filters.filter((f) => f.field !== field);
    const empty = patch === null || (Array.isArray(patch.values) && !patch.values.length) || (patch.from === undefined && patch.to === undefined && !patch.values);
    setFilters(empty ? rest : [...rest, { field, ...patch }]);
  };
  if (!suggested.length && !filters.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="filters">
      <span className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-[0.12em] text-white/40">
        <Filter size={12} aria-hidden="true" /> Filters
      </span>
      {suggested.map((s) => {
        const f = byName(s.field);
        if (!f) return null;
        const active = filters.find((x) => x.field === s.field);
        if (s.kind === 'time') {
          const toDate = (v) => (v !== undefined && v !== null && f.timeUnit !== 'year' ? (typeof v === 'string' ? v : v) : v);
          return <DateRange key={s.field} field={s.field} label={f.label} active={active} min={toDate(f.min)} max={toDate(f.max)} onChange={(r) => set(s.field, r)} />;
        }
        return <CategoryPicker key={s.field} field={s.field} label={f.label} active={active} onChange={(values) => set(s.field, { values })} />;
      })}
      {extra.map((f) => (
        <span key={f.field} className="flex items-center gap-1 rounded-lg border border-accent-500/40 bg-accent-500/10 px-2.5 py-1 text-[12px] font-semibold text-accent-300">
          {byName(f.field)?.label || f.field}: {Array.isArray(f.values) ? f.values.join(', ') : `${f.from ?? '…'} – ${f.to ?? '…'}`}
          <button type="button" aria-label="Remove filter" onClick={() => set(f.field, null)} className="rounded p-0.5 hover:bg-white/10">
            <X size={12} />
          </button>
        </span>
      ))}
      {filters.length > 0 && (
        <button type="button" onClick={() => setFilters([])} className="text-[12px] font-semibold text-white/45 hover:text-white">
          Clear all
        </button>
      )}
    </div>
  );
}
