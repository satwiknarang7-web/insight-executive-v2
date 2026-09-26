'use client';

/**
 * How the table was read, and the reader's corrections to it.
 *
 * Every column with what it was read as — a date, a category, a number to add
 * up or to average, an id — and why. A wrong reading is the most common
 * reason a dashboard is wrong, so fixing one is a single choice here and the
 * dashboard is rebuilt around it. Below it, the measures: the ones the engine
 * derived, and a builder for your own (a total, an average, a ratio of two, a
 * rate, any of them restricted to some rows).
 */

import { useMemo, useState } from 'react';
import { Plus, RotateCcw, Trash2, X } from 'lucide-react';
import { useDashboard } from '../../lib/store/DashboardProvider';

const ROLE_OPTIONS = [
  { value: 'measure:sum', label: 'Number — add up' },
  { value: 'measure:avg', label: 'Number — average' },
  { value: 'dimension', label: 'Category' },
  { value: 'time', label: 'Date / period' },
  { value: 'id', label: 'Identifier' },
  { value: 'ignore', label: 'Ignore' },
];

const FORMAT_OPTIONS = [
  { value: 'number', label: 'Number' },
  { value: 'currency', label: 'Money' },
  { value: 'percent', label: 'Percent' },
];

const roleValue = (f) => (f.role === 'measure' ? `measure:${f.agg || 'sum'}` : f.role === 'text' ? 'ignore' : f.role);

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40);
}

export default function FieldsPanel({ onClose }) {
  const { engine, settings, setFieldOverride, saveMeasure, deleteMeasure, status } = useDashboard();
  const fields = engine?.ds?.fields || [];
  const measures = engine?.measures || [];
  const [busy, setBusy] = useState(null);

  const onRole = async (f, value) => {
    setBusy(f.name);
    const [role, agg] = value.split(':');
    try {
      await setFieldOverride(f.name, { role, ...(agg ? { agg } : {}), ...(role === 'time' && f.kind === 'number' ? { timeUnit: 'year' } : {}) });
    } finally {
      setBusy(null);
    }
  };
  const onFormat = async (f, format) => {
    setBusy(f.name);
    try {
      await setFieldOverride(f.name, { format, scale: format === 'percent' ? (f.max <= 1.0001 ? 1 : 100) : 1 });
    } finally {
      setBusy(null);
    }
  };

  return (
    <aside className="flex h-full min-h-0 w-full flex-col overflow-hidden" aria-label="Fields and measures" data-testid="fields-panel">
      <div className="flex shrink-0 items-center gap-2 border-b border-white/8 px-5 py-4">
        <span className="text-[15px] font-semibold text-white/95">Fields & measures</span>
        <button type="button" onClick={onClose} aria-label="Close" className="ml-auto rounded-md p-1 text-white/40 hover:bg-white/5 hover:text-white">
          <X size={15} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <p className="mb-3 text-[12px] leading-relaxed text-white/50">
          How each column was read. Change one and the dashboard is rebuilt around it.
        </p>
        <ul className="space-y-2">
          {fields.map((f) => {
            const overridden = !!settings.overrides[f.name];
            return (
              <li key={f.name} className="rounded-lg border border-white/8 p-2.5">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-white/85" title={f.name}>{f.label}</span>
                  {overridden && (
                    <button type="button" title="Back to the automatic reading" onClick={() => setFieldOverride(f.name, null)} className="rounded p-1 text-white/40 hover:bg-white/5 hover:text-white">
                      <RotateCcw size={12} />
                    </button>
                  )}
                </div>
                <div className="mt-0.5 truncate text-[11px] text-white/40">
                  {f.kind} · {f.distinct?.toLocaleString()} distinct{f.fill < 0.99 ? ` · ${Math.round(f.fill * 100)}% filled` : ''} · {f.why}
                </div>
                <div className="mt-2 flex gap-2">
                  <select
                    aria-label={`How to read ${f.label}`}
                    value={roleValue(f)}
                    disabled={busy === f.name || status === 'building'}
                    onChange={(e) => onRole(f, e.target.value)}
                    className="min-w-0 flex-1 rounded-md border border-white/10 bg-white/[0.03] px-2 py-1.5 text-[12px] text-white/80 focus:outline-none"
                  >
                    {ROLE_OPTIONS.filter((o) => !(o.value.startsWith('measure') && f.kind !== 'number') && !(o.value === 'time' && f.kind !== 'date' && !(f.kind === 'number' && f.min >= 1900 && f.max <= 2100))).map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                  {f.role === 'measure' && (
                    <select
                      aria-label={`Format of ${f.label}`}
                      value={f.format || 'number'}
                      disabled={busy === f.name}
                      onChange={(e) => onFormat(f, e.target.value)}
                      className="w-28 rounded-md border border-white/10 bg-white/[0.03] px-2 py-1.5 text-[12px] text-white/80 focus:outline-none"
                    >
                      {FORMAT_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  )}
                </div>
              </li>
            );
          })}
        </ul>

        <h3 className="mb-2 mt-6 text-[11px] font-bold uppercase tracking-[0.12em] text-white/45">Measures</h3>
        <ul className="space-y-1">
          {measures.map((m) => (
            <li key={m.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[12px] text-white/75 hover:bg-white/[0.03]">
              <span className="min-w-0 flex-1 truncate">{m.label}</span>
              <span className="shrink-0 text-[10px] uppercase tracking-[0.1em] text-white/35">{m.origin === 'custom' ? 'yours' : m.origin === 'derived' ? 'derived' : m.type}</span>
              {m.origin === 'custom' && (
                <button type="button" aria-label={`Delete ${m.label}`} onClick={() => deleteMeasure(m.id)} className="rounded p-1 text-white/35 hover:text-rose-400">
                  <Trash2 size={12} />
                </button>
              )}
            </li>
          ))}
        </ul>
        <MeasureBuilder fields={fields} measures={measures} onSave={saveMeasure} />
      </div>
    </aside>
  );
}

function MeasureBuilder({ fields, measures, onSave }) {
  const nums = fields.filter((f) => f.role === 'measure');
  const cats = fields.filter((f) => (f.role === 'dimension' || f.role === 'id') && f.distinct <= 200);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState('ratio');
  const [a, setA] = useState(nums[0]?.name || '');
  const [b, setB] = useState('rows');
  const [where, setWhere] = useState({ field: '', value: '' });
  const [name, setName] = useState('');
  const [format, setFormat] = useState('number');
  const { fieldValues } = useDashboard();
  const [values, setValues] = useState([]);

  const loadValues = (field) => {
    setWhere({ field, value: '' });
    if (field) fieldValues(field).then((r) => setValues(r.values.slice(0, 200))).catch(() => setValues([]));
  };

  const label = (n) => fields.find((f) => f.name === n)?.label || n;
  const suggested = useMemo(() => {
    if (kind === 'ratio') return `${label(a)} per ${b === 'rows' ? 'row' : label(b)?.toLowerCase()}`;
    if (kind === 'rate') return `${where.value || '…'} rate`;
    if (kind === 'distinct') return `Distinct ${label(a)?.toLowerCase()}`;
    return `${kind === 'avg' ? 'Average' : kind === 'median' ? 'Median' : 'Total'} ${label(a)?.toLowerCase()}${where.field && where.value ? ` (${where.value})` : ''}`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, a, b, where, fields]);

  const build = () => {
    const filter = where.field && where.value ? [{ field: where.field, values: [where.value] }] : undefined;
    const title = name.trim() || suggested;
    const base = { label: title, format, scale: 1, currency: '', polarity: 0, importance: 99 };
    let m;
    if (kind === 'ratio') {
      const num = { id: `sum:${a}`, type: 'agg', field: a, agg: 'sum', where: filter };
      const den = b === 'rows' ? { id: 'count', type: 'count' } : { id: `sum:${b}`, type: 'agg', field: b, agg: 'sum' };
      m = { ...base, id: `custom:${slug(title)}`, type: 'ratio', num, den, additive: false };
    } else if (kind === 'rate') {
      if (!where.field || !where.value) return;
      m = { ...base, id: `custom:${slug(title)}`, type: 'rate', event: { field: where.field, value: where.value }, format: 'percent', additive: false };
    } else if (kind === 'distinct') {
      m = { ...base, id: `custom:${slug(title)}`, type: 'distinct', field: a, additive: false };
    } else {
      m = { ...base, id: `custom:${slug(title)}`, type: 'agg', field: a, agg: kind, where: filter, additive: kind === 'sum' };
    }
    onSave(m);
    setOpen(false);
    setName('');
  };

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-white/15 px-3 py-2 text-[12px] font-semibold text-white/60 hover:bg-white/5 hover:text-white">
        <Plus size={13} /> New measure
      </button>
    );
  }
  const input = 'w-full rounded-md border border-white/10 bg-white/[0.03] px-2 py-1.5 text-[12px] text-white/85 focus:outline-none';
  return (
    <div className="mt-3 space-y-2 rounded-lg border border-white/10 p-3" data-testid="measure-builder">
      <select aria-label="Kind of measure" value={kind} onChange={(e) => setKind(e.target.value)} className={input}>
        <option value="ratio">Ratio — one number divided by another</option>
        <option value="sum">Total of a column</option>
        <option value="avg">Average of a column</option>
        <option value="median">Median of a column</option>
        <option value="distinct">Count of distinct values</option>
        <option value="rate">Rate — share of rows where…</option>
      </select>
      {kind !== 'rate' && (
        <select aria-label="Column" value={a} onChange={(e) => setA(e.target.value)} className={input}>
          {(kind === 'distinct' ? cats : nums).map((f) => (
            <option key={f.name} value={f.name}>{f.label}</option>
          ))}
        </select>
      )}
      {kind === 'ratio' && (
        <select aria-label="Divided by" value={b} onChange={(e) => setB(e.target.value)} className={input}>
          <option value="rows">÷ number of rows</option>
          {nums.filter((f) => f.name !== a).map((f) => (
            <option key={f.name} value={f.name}>÷ {f.label}</option>
          ))}
        </select>
      )}
      <div className="flex gap-2">
        <select aria-label="Only where" value={where.field} onChange={(e) => loadValues(e.target.value)} className={input}>
          <option value="">{kind === 'rate' ? 'Where column…' : 'All rows'}</option>
          {cats.map((f) => (
            <option key={f.name} value={f.name}>where {f.label} is</option>
          ))}
        </select>
        {where.field && (
          <select aria-label="Value" value={where.value} onChange={(e) => setWhere((w) => ({ ...w, value: e.target.value }))} className={input}>
            <option value="">…</option>
            {values.map((v) => (
              <option key={v.value} value={v.value}>{v.value}</option>
            ))}
          </select>
        )}
      </div>
      <div className="flex gap-2">
        <input aria-label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder={suggested} className={input} />
        {kind !== 'rate' && (
          <select aria-label="Format" value={format} onChange={(e) => setFormat(e.target.value)} className="w-28 rounded-md border border-white/10 bg-white/[0.03] px-2 py-1.5 text-[12px] text-white/85 focus:outline-none">
            {FORMAT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        )}
      </div>
      <div className="flex gap-2 pt-1">
        <button type="button" onClick={build} disabled={kind === 'rate' && !where.value} className="rounded-md bg-accent-500 px-3 py-1.5 text-[12px] font-bold text-on-accent hover:bg-accent-400 disabled:opacity-40">
          Save measure
        </button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-md border border-white/10 px-3 py-1.5 text-[12px] font-semibold text-white/55 hover:bg-white/5">
          Cancel
        </button>
      </div>
      {measures.some((m) => m.label === (name.trim() || suggested)) && <p className="text-[11px] text-amber-300/90">A measure with this name exists; saving replaces yours of the same name.</p>}
    </div>
  );
}
