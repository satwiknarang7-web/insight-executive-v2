'use client';

/**
 * Build a chart by hand.
 *
 * The generated storyboard is whatever the planner thought was interesting;
 * this is the escape hatch for the question the user actually came with. It
 * composes a grouped aggregate query from the loaded column profile and hands
 * it to the engine, which runs it and computes the same verified statistics a
 * generated slide carries — so a hand-built chart is never less trustworthy
 * than an automatic one.
 */
import { useMemo, useState } from 'react';
import { BarChart3, Loader2, Plus, X } from 'lucide-react';
import { measureByDimensionSql } from '../../lib/measures';

const AGGREGATES = [
  { key: 'SUM', label: 'Total' },
  { key: 'AVG', label: 'Average' },
  { key: 'COUNT', label: 'Count' },
  { key: 'MAX', label: 'Maximum' },
  { key: 'MIN', label: 'Minimum' },
];

const TYPES = ['bar', 'line', 'area', 'donut', 'treemap', 'radial', 'scatter'];
const LIMITS = [5, 10, 15, 20, 30];

/** Compose the SQL. Bracketed identifiers so spaces and dots in joined columns work. */
export function buildSpec({ dimension, measure, aggregate, chartType, limit }) {
  const isCount = aggregate === 'COUNT';
  const alias = isCount ? 'Count' : `${titleOf(aggregate)} ${pretty(measure)}`;
  const expr = isCount ? 'COUNT(*)' : `${aggregate}([${measure}])`;
  const title = isCount
    ? `Record Count by ${pretty(dimension)}`
    : `${titleOf(aggregate)} ${pretty(measure)} by ${pretty(dimension)}`;

  return {
    sql: `SELECT [${dimension}], ${expr} AS [${alias}] FROM SalesData GROUP BY [${dimension}] ORDER BY [${alias}] DESC LIMIT ${limit}`,
    chart_type: chartType,
    xAxisKey: dimension,
    yAxisKey: alias,
    title,
  };
}

const pretty = (s) => String(s || '').replace(/_/g, ' ').replace(/\./g, ' · ').trim();
const titleOf = (agg) => AGGREGATES.find((a) => a.key === agg)?.label || agg;

export default function NewChartDialog({ profile, columns = [], customMeasures = [], onCreate, onClose }) {
  const dimensions = useMemo(() => profile?.dimensions || [], [profile]);
  const measures = useMemo(() => profile?.measures || [], [profile]);

  const [dimension, setDimension] = useState(dimensions[0] || '');
  const [measure, setMeasure] = useState(measures[0] || '');
  const [aggregate, setAggregate] = useState(measures.length ? 'SUM' : 'COUNT');
  const [chartType, setChartType] = useState('bar');
  const [limit, setLimit] = useState(10);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // A saved measure can stand in for an aggregate-and-column pair: it already
  // is one, usually a more interesting one than any single column can express.
  const chosenMeasure = aggregate.startsWith('measure:')
    ? customMeasures.find((m) => m.id === aggregate.slice(8)) || null
    : null;
  const isCount = aggregate === 'COUNT';
  const ready = !!dimension && (!!chosenMeasure || isCount || !!measure);

  let spec = null;
  let specError = null;
  if (ready && chosenMeasure) {
    const built = measureByDimensionSql(
      chosenMeasure,
      { dimension, limit },
      { columns, profile, measures: customMeasures }
    );
    specError = built.error;
    if (!built.error) {
      spec = {
        sql: built.sql,
        chart_type: chartType,
        xAxisKey: built.xAxisKey,
        yAxisKey: built.yAxisKey,
        title: `${chosenMeasure.name} by ${pretty(dimension)}`,
      };
    }
  } else if (ready) {
    spec = buildSpec({ dimension, measure, aggregate, chartType, limit });
  }

  const create = async () => {
    if (!spec) return;
    setBusy(true);
    setError(null);
    try {
      await onCreate(spec);
      onClose();
    } catch (e) {
      setError(e.message || 'That chart could not be built.');
    } finally {
      setBusy(false);
    }
  };

  if (dimensions.length === 0) {
    return (
      <Shell onClose={onClose}>
        <p className="text-sm text-white/50">
          This dataset has no categorical or date column to group by, so there is nothing to chart against.
        </p>
      </Shell>
    );
  }

  return (
    <Shell onClose={onClose}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Group by">
          <Select value={dimension} onChange={setDimension} options={dimensions} format={pretty} />
        </Field>

        <Field label="Measure">
          <Select
            value={aggregate}
            onChange={setAggregate}
            options={measures.length ? AGGREGATES.map((a) => a.key) : ['COUNT']}
            format={titleOf}
            groups={
              customMeasures.length
                ? [{ label: 'Measures', options: customMeasures.map((m) => ({ value: `measure:${m.id}`, label: m.name })) }]
                : []
            }
          />
        </Field>

        {!isCount && !chosenMeasure && (
          <Field label="Of column">
            <Select value={measure} onChange={setMeasure} options={measures} format={pretty} />
          </Field>
        )}

        <Field label="Chart type">
          <Select value={chartType} onChange={setChartType} options={TYPES} />
        </Field>

        <Field label="Show top">
          <Select value={limit} onChange={(v) => setLimit(Number(v))} options={LIMITS} format={(n) => `${n} rows`} />
        </Field>
      </div>

      {spec && (
        <div className="mt-5">
          <div className="label mb-2">Query</div>
          <pre className="code-surface overflow-x-auto rounded-lg border border-white/10 p-3 font-mono text-[11px] leading-relaxed">
            {spec.sql}
          </pre>
        </div>
      )}

      {(error || specError) && (
        <p className="mt-4 rounded-lg border border-rose-500/25 bg-rose-500/8 px-3 py-2 text-[13px] text-rose-300">
          {error || specError}
        </p>
      )}

      <div className="mt-5 flex items-center gap-2">
        <button
          type="button"
          onClick={create}
          disabled={!ready || busy}
          className="flex items-center gap-2 rounded-lg bg-accent-500 px-4 py-2.5 text-[10px] font-black uppercase tracking-[0.2em] text-on-accent transition-colors hover:bg-accent-400 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/30"
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
          {busy ? 'Building' : 'Add chart'}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-white/10 px-3 py-2.5 text-[10px] font-black uppercase tracking-[0.2em] text-white/45 transition-colors hover:bg-white/5 hover:text-white"
        >
          Cancel
        </button>
      </div>
    </Shell>
  );
}

function Shell({ children, onClose }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm sm:p-8"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="panel slide-in my-auto w-full max-w-2xl p-6"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Add a chart"
      >
        <div className="mb-5 flex items-center gap-3">
          <BarChart3 size={16} className="text-accent-400" />
          <h2 className="text-base font-black text-white">Add a chart</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="ml-auto rounded-lg border border-white/10 p-1.5 text-white/40 transition-colors hover:bg-white/5 hover:text-white"
          >
            <X size={14} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="flex flex-col gap-2">
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

function Select({ value, onChange, options, format = (v) => v, groups = [] }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm font-bold capitalize text-white/85 outline-none focus:border-accent-500/50"
    >
      {options.map((o) => (
        <option key={o} value={o} className="bg-surface">
          {format(o)}
        </option>
      ))}
      {groups.map((group) => (
        <optgroup key={group.label} label={group.label}>
          {group.options.map((o) => (
            <option key={o.value} value={o.value} className="bg-surface">
              {o.label}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
