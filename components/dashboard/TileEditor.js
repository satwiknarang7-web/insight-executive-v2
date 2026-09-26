'use client';

/**
 * Edit one chart, or build a new one.
 *
 * The choices come from what the data holds: the measures the engine knows
 * (with the reader's own), the columns that can split them, the time grains
 * the dates allow — and the chart types `allowedViz` says this exact
 * combination can be drawn as. A type that cannot show the data is not in the
 * list, so nothing is ever drawn as something other than what was picked.
 */

import { useEffect, useMemo, useState } from 'react';
import { Check, Info, Loader2, X } from 'lucide-react';
import { allowedViz, grainsFor, VIZ } from '../../lib/engine/tiles';

const KINDS = [
  { id: 'breakdown', label: 'Compare categories', needs: 'dims' },
  { id: 'trend', label: 'Over time', needs: 'time' },
  { id: 'distribution', label: 'Distribution', needs: 'numbers' },
  { id: 'relationship', label: 'Relationship', needs: 'twoNumbers' },
  { id: 'table', label: 'Ranking table', needs: 'dims' },
];

const GRAIN_LABEL = { hour: 'Hour', day: 'Day', week: 'Week', month: 'Month', quarter: 'Quarter', year: 'Year', weekday: 'Day of week', hourOfDay: 'Hour of day' };

function Select({ label, value, onChange, options, allowNone = false, noneLabel = 'None' }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] text-white/45">{label}</span>
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        className="w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-[13px] text-white/85 focus:border-accent-500/50 focus:outline-none"
      >
        {allowNone && <option value="">{noneLabel}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** A spec for a kind, reusing what the current tile already has where it fits. */
export function defaultSpec(kind, prev, { measures, fields }) {
  const dims = fields.filter((f) => f.role === 'dimension' && !f.alias);
  const times = fields.filter((f) => f.role === 'time');
  const nums = fields.filter((f) => f.role === 'measure');
  const m = measures.find((x) => x.id === prev?.measures?.[0]) || measures[0];
  const dim = dims.find((f) => f.name === prev?.dim) || dims.find((f) => f.distinct >= 2 && f.distinct <= 12) || dims[0];
  switch (kind) {
    case 'trend': {
      const t = times[0];
      return { kind, measures: [m?.id], dim: t?.name, grain: grainsFor(t)[Math.min(3, grainsFor(t).length - 1)] || 'month', series: null, title: `${m?.label} over time` };
    }
    case 'distribution': {
      const f = nums.find((x) => x.name === m?.field) || nums[0];
      return { kind, field: f?.name, measures: [], title: `Distribution of ${f?.label?.toLowerCase()}` };
    }
    case 'relationship': {
      const [a, b] = nums;
      return { kind, x: a?.name, y: b?.name, color: null, measures: [], title: `${b?.label} vs ${a?.label?.toLowerCase()}` };
    }
    case 'table': {
      const rowDim = fields.filter((f) => (f.role === 'dimension' || f.role === 'id') && f.kind === 'text').sort((a, b) => b.distinct - a.distinct)[0] || dim;
      return { kind, dim: rowDim?.name, measures: measures.slice(0, 3).map((x) => x.id), limit: 10, title: `Top ${rowDim?.label?.toLowerCase()} by ${m?.label?.toLowerCase()}` };
    }
    default:
      return { kind: 'breakdown', measures: [m?.id], dim: dim?.name, series: null, limit: 12, title: `${m?.label} by ${dim?.label?.toLowerCase()}` };
  }
}

export default function TileEditor({ tile, engine, onApply, onClose, mode = 'edit' }) {
  const measures = useMemo(() => (engine?.measures || []).filter((m) => m.origin !== 'long' || true), [engine]);
  const fields = useMemo(() => engine?.ds?.fields || [], [engine]);
  const [draft, setDraft] = useState(tile);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const [titleTouched, setTitleTouched] = useState(mode === 'edit');
  useEffect(() => {
    setDraft(tile);
    setTitleTouched(mode === 'edit');
  }, [tile, mode]);

  const dims = fields.filter((f) => f.role === 'dimension' && !f.alias);
  const splitDims = dims.filter((f) => f.distinct >= 2 && f.distinct <= 60);
  const seriesDims = dims.filter((f) => f.distinct >= 2 && f.distinct <= 12);
  const ordinalNums = fields.filter((f) => f.role === 'measure' && f.ordinal);
  const times = fields.filter((f) => f.role === 'time');
  const nums = fields.filter((f) => f.role === 'measure');
  const rowsDims = fields.filter((f) => (f.role === 'dimension' || f.role === 'id') && f.distinct >= 2);
  const available = KINDS.filter((k) => (k.needs === 'time' ? times.length : k.needs === 'numbers' ? nums.length : k.needs === 'twoNumbers' ? nums.length >= 2 : dims.length || rowsDims.length));
  const ds = engine?.ds;
  const vizes = ds ? allowedViz(draft, ds, measures) : [];
  const label = (name) => fields.find((f) => f.name === name)?.label || name;
  const mLabel = (id) => measures.find((m) => m.id === id)?.label || id;

  /** Apply a change: keep the chart type if it still fits, else say why it changed. */
  const change = (patch) => {
    setDraft((d) => {
      const next = { ...d, ...patch };
      if (!titleTouched) {
        const m = mLabel(next.measures?.[0]);
        if (next.kind === 'breakdown') next.title = `${m} by ${label(next.dim)?.toLowerCase()}${next.series ? ` and ${label(next.series)?.toLowerCase()}` : ''}`;
        if (next.kind === 'trend') next.title = `${m}${next.series ? ` by ${label(next.series)?.toLowerCase()}` : ''} over time`;
        if (next.kind === 'distribution') next.title = `Distribution of ${label(next.field)?.toLowerCase()}`;
        if (next.kind === 'relationship') next.title = `${label(next.y)} vs ${label(next.x)?.toLowerCase()}`;
        if (next.kind === 'table') next.title = `Top ${label(next.dim)?.toLowerCase()} by ${m?.toLowerCase()}`;
      }
      const allowed = ds ? allowedViz(next, ds, measures) : [];
      if (!allowed.includes(next.viz)) {
        if (d.viz && allowed.length) setNote(`${VIZ[d.viz] || d.viz} can't show this, so it's now ${VIZ[allowed[0]]}.`);
        next.viz = allowed[0];
      } else setNote(null);
      return next;
    });
  };

  const setKind = (kind) => {
    const spec = defaultSpec(kind, draft, { measures, fields });
    const next = { ...draft, ...spec, series: spec.series ?? null, edges: undefined, labels: undefined, filters: draft.filters || [] };
    next.viz = ds ? allowedViz(next, ds, measures)[0] : 'table';
    setNote(null);
    setDraft(next);
  };

  const apply = async () => {
    setBusy(true);
    try {
      await onApply(draft);
    } finally {
      setBusy(false);
    }
  };

  const measureOptions = measures.map((m) => ({ value: m.id, label: m.label }));

  return (
    <aside className="flex h-full min-h-0 w-full flex-col overflow-hidden" aria-label="Chart editor" data-testid="tile-editor">
      <div className="flex shrink-0 items-center gap-2 border-b border-white/8 px-5 py-4">
        <span className="text-[15px] font-semibold text-white/95">{mode === 'add' ? 'Add a chart' : 'Edit chart'}</span>
        <button type="button" onClick={onClose} aria-label="Close editor" className="ml-auto rounded-md p-1 text-white/40 hover:bg-white/5 hover:text-white">
          <X size={15} />
        </button>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        <div>
          <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.12em] text-white/45">What to show</span>
          <div className="flex flex-wrap gap-1.5">
            {available.map((k) => (
              <button
                key={k.id}
                type="button"
                onClick={() => setKind(k.id)}
                className={`rounded-lg border px-2.5 py-1.5 text-[12px] font-semibold ${draft.kind === k.id ? 'border-accent-500/50 bg-accent-500/10 text-accent-300' : 'border-white/10 text-white/60 hover:bg-white/5'}`}
              >
                {k.label}
              </button>
            ))}
          </div>
        </div>

        {(draft.kind === 'breakdown' || draft.kind === 'trend') && (
          <Select label="Measure" value={draft.measures?.[0]} onChange={(v) => v && change({ measures: [v] })} options={measureOptions} />
        )}

        {draft.kind === 'breakdown' && (
          <>
            <Select
              label="By"
              value={draft.dim}
              onChange={(v) => v && change({ dim: v, edges: undefined, labels: undefined, series: draft.series === v ? null : draft.series })}
              options={[...splitDims, ...ordinalNums].map((f) => ({ value: f.name, label: `${f.label} (${f.distinct})` }))}
            />
            <Select
              label="Split by"
              value={draft.series}
              allowNone
              onChange={(v) => change({ series: v })}
              options={seriesDims.filter((f) => f.name !== draft.dim).map((f) => ({ value: f.name, label: f.label }))}
            />
            <Select label="Show" value={String(draft.limit || 12)} onChange={(v) => change({ limit: Number(v) })} options={[5, 8, 12, 20].map((n) => ({ value: String(n), label: `Top ${n}` }))} />
            <Select label="Order" value={draft.sort || 'value'} onChange={(v) => change({ sort: v })} options={[{ value: 'value', label: 'Largest first' }, { value: 'label', label: 'By name / natural order' }]} />
          </>
        )}

        {draft.kind === 'trend' && (
          <>
            {times.length > 1 && <Select label="Date" value={draft.dim} onChange={(v) => v && change({ dim: v, grain: grainsFor(fields.find((f) => f.name === v))[0] })} options={times.map((f) => ({ value: f.name, label: f.label }))} />}
            <Select
              label="Every"
              value={draft.grain}
              onChange={(v) => v && change({ grain: v })}
              options={[...grainsFor(fields.find((f) => f.name === draft.dim)), ...(fields.find((f) => f.name === draft.dim)?.kind === 'date' ? ['weekday', ...(fields.find((f) => f.name === draft.dim)?.hasTime ? ['hourOfDay'] : [])] : [])].map((g) => ({ value: g, label: GRAIN_LABEL[g] }))}
            />
            {!['weekday', 'hourOfDay'].includes(draft.grain) && (
              <Select label="Split by" value={draft.series} allowNone onChange={(v) => change({ series: v })} options={seriesDims.map((f) => ({ value: f.name, label: f.label }))} />
            )}
          </>
        )}

        {draft.kind === 'distribution' && <Select label="Number" value={draft.field} onChange={(v) => v && change({ field: v })} options={nums.map((f) => ({ value: f.name, label: f.label }))} />}

        {draft.kind === 'relationship' && (
          <>
            <Select label="Across (x)" value={draft.x} onChange={(v) => v && change({ x: v })} options={nums.filter((f) => f.name !== draft.y).map((f) => ({ value: f.name, label: f.label }))} />
            <Select label="Up (y)" value={draft.y} onChange={(v) => v && change({ y: v })} options={nums.filter((f) => f.name !== draft.x).map((f) => ({ value: f.name, label: f.label }))} />
            <Select label="Colour by" value={draft.color} allowNone onChange={(v) => change({ color: v })} options={dims.filter((f) => f.distinct <= 3).map((f) => ({ value: f.name, label: f.label }))} />
          </>
        )}

        {draft.kind === 'table' && (
          <>
            <Select label="One row per" value={draft.dim} onChange={(v) => v && change({ dim: v })} options={rowsDims.map((f) => ({ value: f.name, label: `${f.label} (${f.distinct})` }))} />
            <div>
              <span className="mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] text-white/45">Columns (first one ranks)</span>
              <div className="max-h-44 space-y-0.5 overflow-y-auto rounded-lg border border-white/10 p-1.5">
                {measures.map((m) => {
                  const on = draft.measures?.includes(m.id);
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => change({ measures: on ? draft.measures.filter((x) => x !== m.id) : [...(draft.measures || []), m.id].slice(0, 6) })}
                      className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[12px] text-white/75 hover:bg-white/5"
                    >
                      <span className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${on ? 'border-accent-400 bg-accent-500 text-on-accent' : 'border-white/25'}`}>{on && <Check size={10} strokeWidth={3} />}</span>
                      <span className="truncate">{m.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <Select label="Rows" value={String(draft.limit || 10)} onChange={(v) => change({ limit: Number(v) })} options={[5, 10, 20, 50].map((n) => ({ value: String(n), label: `Top ${n}` }))} />
          </>
        )}

        <div>
          <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.12em] text-white/45">Chart type</span>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Chart type">
            {vizes.map((v) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={draft.viz === v}
                onClick={() => change({ viz: v })}
                className={`rounded-lg border px-2.5 py-1.5 text-[12px] font-semibold ${draft.viz === v ? 'border-accent-500/50 bg-accent-500/10 text-accent-300' : 'border-white/10 text-white/60 hover:bg-white/5'}`}
              >
                {VIZ[v]}
              </button>
            ))}
          </div>
          <p className="mt-1.5 flex gap-1 text-[11px] leading-relaxed text-white/40">
            <Info size={12} className="mt-px shrink-0" aria-hidden="true" /> Only the types this data can be drawn as are listed.
          </p>
          {note && <p className="mt-1 text-[12px] text-amber-300/90">{note}</p>}
        </div>

        <label className="block">
          <span className="mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] text-white/45">Title</span>
          <input
            value={draft.title || ''}
            onChange={(e) => {
              setTitleTouched(true);
              setDraft((d) => ({ ...d, title: e.target.value }));
            }}
            className="w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-[13px] text-white/85 focus:border-accent-500/50 focus:outline-none"
          />
        </label>

        <div className="flex gap-2">
          <Select label="Width" value={String(draft.w || 6)} onChange={(v) => setDraft((d) => ({ ...d, w: Number(v) }))} options={[{ value: '6', label: 'Half' }, { value: '12', label: 'Full' }]} />
          <Select label="Height" value={String(draft.h || 4)} onChange={(v) => setDraft((d) => ({ ...d, h: Number(v) }))} options={[{ value: '3', label: 'Short' }, { value: '4', label: 'Medium' }, { value: '5', label: 'Tall' }, { value: '6', label: 'Extra tall' }]} />
        </div>
      </div>
      <div className="flex gap-2 border-t border-white/8 px-4 py-3">
        <button
          type="button"
          onClick={apply}
          disabled={busy || !draft.viz}
          className="flex items-center gap-2 rounded-lg bg-accent-500 px-4 py-2 text-[12px] font-black uppercase tracking-[0.12em] text-on-accent hover:bg-accent-400 disabled:opacity-40"
        >
          {busy && <Loader2 size={13} className="animate-spin" />} {mode === 'add' ? 'Add to dashboard' : 'Apply'}
        </button>
        <button type="button" onClick={onClose} className="rounded-lg border border-white/10 px-4 py-2 text-[12px] font-bold uppercase tracking-[0.12em] text-white/50 hover:bg-white/5 hover:text-white">
          Cancel
        </button>
      </div>
    </aside>
  );
}
