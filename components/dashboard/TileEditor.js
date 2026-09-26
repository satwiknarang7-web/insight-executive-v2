'use client';

/**
 * Edit one chart, or build a new one.
 *
 * The chart type comes first. Every type the dashboard can draw is laid out as
 * a gallery, and choosing one reveals only the settings that type needs — a
 * donut asks for a total and a category, a scatter for two numbers. Types this
 * table cannot support stay in the gallery, greyed out, with the reason on
 * hover: a chart that silently disappears from the list reads as a chart the
 * product lost.
 *
 * Nothing is ever drawn as something other than what was picked. The settings
 * below the gallery only offer choices `allowedViz` accepts for the chosen
 * type, so changing the measure or the category cannot knock the chart over
 * into a different one.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  Bubbles,
  ChartArea,
  ChartBar,
  ChartBarStacked,
  ChartColumn,
  ChartColumnBig,
  ChartColumnStacked,
  ChartGantt,
  ChartLine,
  ChartNoAxesColumn,
  ChartNoAxesCombined,
  ChartPie,
  ChartScatter,
  ChartSpline,
  Check,
  Donut,
  Funnel,
  Gauge,
  Grid3x3,
  Hash,
  LandPlot,
  LayoutGrid,
  Loader2,
  Map as MapIcon,
  MapPin,
  Radar,
  SquareStack,
  Table2,
  Target,
  X,
} from 'lucide-react';
import { allowedViz, grainsFor, MAP_VIZ, VIZ } from '../../lib/engine/tiles';

/**
 * Every chart a tile can be, in the order a person reaches for them. `kind` is
 * what the engine computes (`kinds` when a type can be drawn from either, date
 * first); `split` means the type needs a second category, `pair` two measures,
 * `size` a third number column.
 */
const TYPES = [
  { viz: 'hbar', kind: 'breakdown', label: 'Bar', icon: ChartBar, needs: 'a column of categories' },
  { viz: 'column', kind: 'breakdown', label: 'Column', icon: ChartColumn, needs: 'a column of categories' },
  { viz: 'line', kind: 'trend', label: 'Line', icon: ChartLine, needs: 'a date column' },
  { viz: 'area', kind: 'trend', label: 'Area', icon: ChartArea, needs: 'a date column and a measure that adds up (a total, not an average)' },
  { viz: 'donut', kind: 'breakdown', label: 'Donut', icon: Donut, needs: 'a total that cannot be negative, split across 2 to 6 categories' },
  { viz: 'pie', kind: 'breakdown', label: 'Pie', icon: ChartPie, needs: 'a total that cannot be negative, split across 2 to 6 categories' },
  { viz: 'treemap', kind: 'breakdown', label: 'Treemap', icon: LayoutGrid, needs: 'a total that cannot be negative, split across categories' },
  { viz: 'funnel', kind: 'breakdown', label: 'Funnel', icon: Funnel, needs: 'a total that cannot be negative, split across 2 to 8 stages' },
  { viz: 'waterfall', kinds: ['trend', 'breakdown'], label: 'Waterfall', icon: ChartGantt, needs: 'a measure that adds up, over time or across up to 12 categories' },
  { viz: 'radial', kind: 'breakdown', label: 'Radial bars', icon: Target, needs: 'a measure that cannot be negative, across 2 to 8 categories' },
  { viz: 'gauge', kind: 'breakdown', label: 'Gauge', icon: Gauge, needs: 'a total that cannot be negative, split across categories' },
  { viz: 'cards', kind: 'breakdown', label: 'Number cards', icon: SquareStack, needs: 'a column with up to 12 categories' },
  { viz: 'map', kind: 'breakdown', label: 'Map', icon: MapIcon, needs: 'a column of countries or regions' },
  { viz: 'bubbleMap', kind: 'breakdown', label: 'Bubble map', icon: MapPin, needs: 'a column of countries or regions, and a measure that cannot be negative' },
  { viz: 'shapeMap', kind: 'breakdown', label: 'Shape map', icon: LandPlot, needs: 'a column of countries or regions' },
  { viz: 'stackedColumn', kind: 'breakdown', split: true, label: 'Stacked column', icon: ChartColumnStacked, needs: 'a measure that adds up and two category columns' },
  { viz: 'stackedBar', kind: 'breakdown', split: true, label: 'Stacked bar', icon: ChartBarStacked, needs: 'a measure that adds up and two category columns' },
  { viz: 'groupedColumn', kind: 'breakdown', split: true, label: 'Grouped column', icon: ChartColumnBig, needs: 'two category columns' },
  { viz: 'stackedArea', kind: 'trend', split: true, label: 'Stacked area', icon: ChartArea, needs: 'a date column, a measure that adds up and a category to split by' },
  { viz: 'ribbon', kind: 'trend', split: true, label: 'Ribbon', icon: ChartSpline, needs: 'a date column and a category to rank in each period' },
  { viz: 'combo', kinds: ['trend', 'breakdown'], pair: true, label: 'Combo', icon: ChartNoAxesCombined, needs: 'two measures, over time or across categories' },
  { viz: 'heatmap', kind: 'breakdown', split: true, label: 'Heatmap', icon: Grid3x3, needs: 'two category columns' },
  { viz: 'radar', kind: 'breakdown', label: 'Radar', icon: Radar, needs: 'a measure that cannot be negative, across 3 to 10 categories' },
  { viz: 'histogram', kind: 'distribution', label: 'Histogram', icon: ChartNoAxesColumn, needs: 'a number column' },
  { viz: 'scatter', kind: 'relationship', label: 'Scatter', icon: ChartScatter, needs: 'two number columns' },
  { viz: 'bubble', kind: 'relationship', size: true, label: 'Bubble', icon: Bubbles, needs: 'three number columns' },
  { viz: 'table', kind: 'table', label: 'Ranking table', icon: Table2, needs: 'a column to rank' },
  { viz: 'kpi', kind: 'kpi', label: 'Single number', icon: Hash, needs: 'a measure' },
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
    case 'kpi':
      return { kind, measures: [m?.id], title: m?.label || 'Number', h: 3 };
    default:
      return { kind: 'breakdown', measures: [m?.id], dim: dim?.name, series: null, limit: 12, title: `${m?.label} by ${dim?.label?.toLowerCase()}` };
  }
}

const uniq = (xs) => [...new Set(xs.filter(Boolean))];

export default function TileEditor({ tile, engine, onApply, onClose, mode = 'edit' }) {
  const measures = useMemo(() => engine?.measures || [], [engine]);
  const fields = useMemo(() => engine?.ds?.fields || [], [engine]);
  const ds = engine?.ds;
  const [draft, setDraft] = useState(tile);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const [titleTouched, setTitleTouched] = useState(mode === 'edit');
  // A new chart starts with nothing chosen: the type is the first decision.
  const [picked, setPicked] = useState(mode === 'edit');
  useEffect(() => {
    setDraft(tile);
    setTitleTouched(mode === 'edit');
    setPicked(mode === 'edit');
    setNote(null);
  }, [tile, mode]);

  const dims = fields.filter((f) => f.role === 'dimension' && !f.alias);
  const splitDims = dims.filter((f) => f.distinct >= 2 && f.distinct <= 60);
  const seriesDims = dims.filter((f) => f.distinct >= 2 && f.distinct <= 12);
  const ordinalNums = fields.filter((f) => f.role === 'measure' && f.ordinal);
  const times = fields.filter((f) => f.role === 'time');
  const nums = fields.filter((f) => f.role === 'measure');
  const rowsDims = fields.filter((f) => (f.role === 'dimension' || f.role === 'id') && f.distinct >= 2);
  const label = (name) => fields.find((f) => f.name === name)?.label || name;
  const mLabel = (id) => measures.find((m) => m.id === id)?.label || id;
  const ok = (spec) => !!ds && !!spec?.viz && allowedViz(spec, ds, measures).includes(spec.viz);
  const type = TYPES.find((t) => t.viz === draft.viz) || null;

  const autoTitle = (next) => {
    const m = next.measures?.length === 2 ? `${mLabel(next.measures[0])} and ${mLabel(next.measures[1])?.toLowerCase()}` : mLabel(next.measures?.[0]);
    if (next.kind === 'breakdown') return `${m} by ${label(next.dim)?.toLowerCase()}${next.series ? ` and ${label(next.series)?.toLowerCase()}` : ''}`;
    if (next.kind === 'trend' && next.viz === 'ribbon') return `Which ${label(next.series)?.toLowerCase()} leads on ${m?.toLowerCase()}, over time`;
    if (next.kind === 'trend') return `${m}${next.series ? ` by ${label(next.series)?.toLowerCase()}` : ''} over time`;
    if (next.kind === 'distribution') return `Distribution of ${label(next.field)?.toLowerCase()}`;
    if (next.kind === 'relationship' && next.viz === 'bubble' && next.size) return `${label(next.y)} vs ${label(next.x)?.toLowerCase()}, sized by ${label(next.size)?.toLowerCase()}`;
    if (next.kind === 'relationship') return `${label(next.y)} vs ${label(next.x)?.toLowerCase()}`;
    if (next.kind === 'table') return `Top ${label(next.dim)?.toLowerCase()} by ${m?.toLowerCase()}`;
    if (next.kind === 'kpi') return m;
    return next.title;
  };

  /**
   * A spec that draws `t` from this table, or null when nothing can. The
   * current choices are tried first, so switching a revenue-by-region bar to
   * a donut keeps revenue and region if a donut can show them.
   */
  const specForKind = (t, kind, prefer) => {
    const base = { ...defaultSpec(kind, prefer, { measures, fields }), filters: prefer?.filters || [], viz: t.viz, series: null, edges: undefined, labels: undefined, size: undefined };
    const ms = uniq([prefer?.measures?.[0], base.measures?.[0], ...measures.map((m) => m.id)]).slice(0, 16);
    // The measures to try: one at a time, or two different ones for a combo,
    // the pair already on the chart first.
    const sets = t.pair
      ? [
          ...(prefer?.measures?.length === 2 ? [prefer.measures] : []),
          ...ms.flatMap((a) => ms.filter((b) => b !== a).map((b) => [a, b])),
        ]
      : ms.map((m) => [m]);
    if (kind === 'breakdown') {
      const ds_ = uniq([prefer?.dim, base.dim, ...[...splitDims, ...ordinalNums, ...dims.filter((f) => f.map)].map((f) => f.name)]).slice(0, 16);
      for (const set of sets) {
        for (const d of ds_) {
          const cand = { ...base, kind, measures: set, dim: d };
          if (t.split) {
            for (const sd of uniq([prefer?.series, ...seriesDims.map((f) => f.name)]).filter((x) => x !== d)) {
              if (ok({ ...cand, series: sd })) return { ...cand, series: sd };
            }
          } else if (ok(cand)) return cand;
        }
      }
      return null;
    }
    if (kind === 'trend') {
      for (const set of sets) {
        const cand = { ...base, kind, measures: set };
        if (t.split) {
          for (const sd of uniq([prefer?.series, ...seriesDims.map((f) => f.name)])) {
            if (ok({ ...cand, series: sd })) return { ...cand, series: sd };
          }
        } else if (ok(cand)) return cand;
      }
      return null;
    }
    if (kind === 'relationship' && t.size) {
      // A third number, other than the two on the axes, sets each bubble's size.
      for (const s of uniq([prefer?.size, ...nums.map((f) => f.name)]).filter((n) => n !== base.x && n !== base.y)) {
        if (ok({ ...base, size: s })) return { ...base, size: s };
      }
      return null;
    }
    if (kind === 'kpi') return measures.length ? { ...base, measures: [ms[0]] } : null;
    return ok(base) ? base : null;
  };
  // A type drawable from a date or from categories tries the date first.
  const specFor = (t, prefer = draft) => {
    if (!ds) return null;
    for (const kind of t.kinds || [t.kind]) {
      const spec = specForKind(t, kind, prefer);
      if (spec) return spec;
    }
    return null;
  };

  // Which types this table can draw at all. Independent of the current
  // choices, so a type is never greyed out just because of what is picked.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- specFor reads only the stable lists below
  const possible = useMemo(() => Object.fromEntries(TYPES.map((t) => [t.viz, !!specFor(t, null)])), [ds, measures, fields]);

  const pickType = (t) => {
    const spec = specFor(t);
    if (!spec) return;
    const next = { ...draft, ...spec };
    if (!titleTouched) next.title = autoTitle(next);
    if (t.kind === 'kpi') next.h = 3;
    setNote(null);
    setDraft(next);
    setPicked(true);
  };

  /** A change to the specifics. The options offered already fit the type; this is the backstop. */
  const change = (patch) => {
    setDraft((d) => {
      const next = { ...d, ...patch };
      if (!titleTouched) next.title = autoTitle(next);
      if (!ok(next)) {
        const allowed = ds ? allowedViz(next, ds, measures) : [];
        if (allowed.length) {
          setNote(`${VIZ[d.viz] || d.viz} can't show this, so it's now ${VIZ[allowed[0]]}.`);
          next.viz = allowed[0];
        }
      } else setNote(null);
      return next;
    });
  };
  /** Only the choices that keep the chosen type drawable. */
  const fits = (patch) => ok({ ...draft, ...patch });

  const apply = async () => {
    setBusy(true);
    try {
      await onApply(draft);
    } finally {
      setBusy(false);
    }
  };

  // A combo keeps its second measure while the first changes, and the other way round.
  const pair = draft.viz === 'combo' && draft.measures?.length === 2;
  const measureOptions = measures
    .filter((m) => (pair ? m.id !== draft.measures[1] && fits({ measures: [m.id, draft.measures[1]] }) : fits({ measures: [m.id] })))
    .map((m) => ({ value: m.id, label: m.label }));
  const lineOptions = pair ? measures.filter((m) => m.id !== draft.measures[0] && fits({ measures: [draft.measures[0], m.id] })).map((m) => ({ value: m.id, label: m.label })) : [];
  const someOff = TYPES.some((t) => !possible[t.viz]);
  const onMap = MAP_VIZ.includes(draft.viz);
  const partsOfWhole = ['donut', 'pie', 'treemap', 'funnel', 'gauge', 'radial', 'waterfall', ...MAP_VIZ].includes(draft.viz);
  const date = fields.find((f) => f.name === draft.dim);

  return (
    <aside className="flex h-full min-h-0 w-full flex-col overflow-hidden" aria-label="Chart editor" data-testid="tile-editor">
      <div className="flex shrink-0 items-center gap-2 border-b border-white/8 px-5 py-4">
        <span className="text-[15px] font-semibold text-white/95">{mode === 'add' ? 'Add a chart' : 'Edit chart'}</span>
        <button type="button" onClick={onClose} aria-label="Close editor" className="ml-auto rounded-md p-1 text-white/40 hover:bg-white/5 hover:text-white">
          <X size={15} />
        </button>
      </div>
      <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4">
        {/* 1. The type. */}
        <div>
          <span className="mb-2 block text-[11px] font-bold uppercase tracking-[0.12em] text-white/45">
            {picked ? 'Chart type' : 'What kind of chart?'}
          </span>
          <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="Chart type">
            {TYPES.map((t) => {
              const on = picked && draft.viz === t.viz;
              const can = possible[t.viz];
              const Icon = t.icon;
              return (
                <button
                  key={t.viz}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  disabled={!can}
                  onClick={() => pickType(t)}
                  title={can ? t.label : `${t.label} needs ${t.needs}.`}
                  className={`flex flex-col items-center gap-1.5 rounded-xl border px-1.5 py-2.5 text-center text-[11.5px] font-semibold leading-tight transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${
                    on
                      ? 'border-accent-400/60 bg-accent-400/12 text-accent-300'
                      : 'border-white/10 bg-white/[0.02] text-white/70 enabled:hover:border-white/25 enabled:hover:bg-white/[0.05] enabled:hover:text-white'
                  }`}
                >
                  <Icon size={20} strokeWidth={1.75} className={on ? 'text-accent-400' : ''} />
                  {t.label}
                </button>
              );
            })}
          </div>
          {someOff && <p className="mt-2 text-[11px] leading-relaxed text-white/40">Greyed-out types need something this table does not have — hover one to see what.</p>}
          {note && <p className="mt-1.5 text-[12px] text-amber-300/90">{note}</p>}
        </div>

        {!picked && <p className="rounded-xl border border-dashed border-white/12 px-4 py-6 text-center text-[12.5px] text-white/45">Pick a chart type to choose what it shows.</p>}

        {/* 2. What it shows — only what this type needs. */}
        {picked && type && (
          <div key={draft.viz} className="anim-rise space-y-4">
            {['breakdown', 'trend', 'kpi'].includes(draft.kind) && (
              <Select
                label={pair ? 'Columns' : 'Measure'}
                value={draft.measures?.[0]}
                onChange={(v) => v && change({ measures: pair ? [v, draft.measures[1]] : [v] })}
                options={measureOptions}
              />
            )}
            {pair && <Select label="Line" value={draft.measures[1]} onChange={(v) => v && change({ measures: [draft.measures[0], v] })} options={lineOptions} />}

            {draft.kind === 'breakdown' && (
              <>
                <Select
                  label={onMap ? 'Place' : draft.viz === 'funnel' ? 'Stages' : draft.viz === 'radar' ? 'Around' : 'By'}
                  value={draft.dim}
                  onChange={(v) => v && change({ dim: v, edges: undefined, labels: undefined, series: draft.series === v ? null : draft.series })}
                  options={uniq([...splitDims, ...ordinalNums, ...dims.filter((f) => f.map)].map((f) => f.name))
                    .map((n) => fields.find((f) => f.name === n))
                    .filter((f) => f && fits({ dim: f.name }))
                    .map((f) => ({ value: f.name, label: `${f.label} (${f.distinct})` }))}
                />
                {type.split && (
                  <Select
                    label="Split by"
                    value={draft.series}
                    onChange={(v) => v && change({ series: v })}
                    options={seriesDims.filter((f) => f.name !== draft.dim && fits({ series: f.name })).map((f) => ({ value: f.name, label: f.label }))}
                  />
                )}
                {!onMap && (
                  <Select label="Show" value={String(draft.limit || 12)} onChange={(v) => change({ limit: Number(v) })} options={[5, 8, 12, 20].map((n) => ({ value: String(n), label: `Top ${n}` }))} />
                )}
                {!partsOfWhole && (
                  <Select label="Order" value={draft.sort || 'value'} onChange={(v) => change({ sort: v })} options={[{ value: 'value', label: 'Largest first' }, { value: 'label', label: 'By name / natural order' }]} />
                )}
              </>
            )}

            {draft.kind === 'trend' && (
              <>
                {times.length > 1 && <Select label="Date" value={draft.dim} onChange={(v) => v && change({ dim: v, grain: grainsFor(fields.find((f) => f.name === v))[0] })} options={times.map((f) => ({ value: f.name, label: f.label }))} />}
                <Select
                  label="Every"
                  value={draft.grain}
                  onChange={(v) => v && change({ grain: v })}
                  options={[...grainsFor(date), ...(date?.kind === 'date' ? ['weekday', ...(date?.hasTime ? ['hourOfDay'] : [])] : [])]
                    .filter((g) => fits({ grain: g }))
                    .map((g) => ({ value: g, label: GRAIN_LABEL[g] }))}
                />
                {(type.split || draft.viz === 'line') && !['weekday', 'hourOfDay'].includes(draft.grain) && (
                  <Select
                    label="Split by"
                    value={draft.series}
                    allowNone={!type.split}
                    onChange={(v) => (v || !type.split) && change({ series: v })}
                    options={seriesDims.filter((f) => fits({ series: f.name })).map((f) => ({ value: f.name, label: f.label }))}
                  />
                )}
              </>
            )}

            {draft.kind === 'distribution' && <Select label="Number" value={draft.field} onChange={(v) => v && change({ field: v })} options={nums.map((f) => ({ value: f.name, label: f.label }))} />}

            {draft.kind === 'relationship' && (
              <>
                <Select label="Across (x)" value={draft.x} onChange={(v) => v && change({ x: v })} options={nums.filter((f) => f.name !== draft.y).map((f) => ({ value: f.name, label: f.label }))} />
                <Select label="Up (y)" value={draft.y} onChange={(v) => v && change({ y: v })} options={nums.filter((f) => f.name !== draft.x).map((f) => ({ value: f.name, label: f.label }))} />
                {draft.viz === 'bubble' && (
                  <Select
                    label="Size"
                    value={draft.size}
                    onChange={(v) => v && change({ size: v })}
                    options={nums.filter((f) => f.name !== draft.x && f.name !== draft.y).map((f) => ({ value: f.name, label: f.label }))}
                  />
                )}
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

            {/* 3. How it sits on the board. */}
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
        )}
      </div>
      <div className="flex shrink-0 gap-2 border-t border-white/8 px-4 py-3">
        <button
          type="button"
          onClick={apply}
          disabled={busy || !picked || !ok(draft)}
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
