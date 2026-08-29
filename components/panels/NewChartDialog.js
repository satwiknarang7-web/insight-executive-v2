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
 *
 * The form is not fixed. It asks for exactly what the chosen type needs, which
 * `lib/chartSpecs` declares: one category for a bar, two for a matrix, three
 * measures for a bubble, a column of place names for a map, and nothing to group
 * by at all for a card. Offering one dimension for every type was how a matrix
 * ended up drawn with a single column and a bubble quietly degraded to a
 * scatter — the chart was built, it simply could not be the chart that was
 * asked for.
 */
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, BarChart3, Loader2, Plus, X } from 'lucide-react';
import { formatSql } from '../../lib/sqlFormat';
import {
  AGGREGATES,
  BUCKETS,
  CHART_TYPE_GROUPS,
  SORTS,
  aggregateLabel,
  buildChartSpec,
  chartRequirement,
  chartTypeLabel,
  bucketableColumn,
  limitFormat,
  looksGeographic,
  pretty,
} from '../../lib/chartSpecs';

/**
 * A starting choice for one dimension slot.
 *
 * `prefer` is a hint from the requirement — a map wants a place, a trend wants a
 * date — and it is only a starting point: every column stays selectable, because
 * a column called `site` holds countries often enough that refusing it would be
 * worse than pre-selecting the wrong one.
 */
function pickDimension({ prefer }, { dimensions, temporal, taken }) {
  const free = dimensions.filter((d) => !taken.includes(d));
  const pool = free.length ? free : dimensions;
  if (prefer === 'geo') return pool.find(looksGeographic) || pool[0] || '';
  if (prefer === 'time') return pool.find((d) => temporal.includes(d)) || pool[0] || '';
  return pool[0] || '';
}

/** A starting choice for one measure slot: a real column when there is one. */
function pickMeasure(index, measures) {
  if (!measures.length) return { aggregate: 'COUNT', column: '', measureId: null };
  return { aggregate: 'SUM', column: measures[Math.min(index, measures.length - 1)], measureId: null };
}

export default function NewChartDialog({ profile, columns = [], customMeasures = [], sample = [], onCreate, onClose }) {
  const dimensions = useMemo(() => profile?.dimensions || [], [profile]);
  const measures = useMemo(() => profile?.measures || [], [profile]);
  const temporal = useMemo(() => profile?.temporal || [], [profile]);

  const [chartType, setChartType] = useState('bar');
  const [dims, setDims] = useState({});
  const [vals, setVals] = useState({});
  const [limit, setLimit] = useState(10);
  const [sort, setSort] = useState('value-desc');
  const [bucket, setBucket] = useState('auto');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const requirement = chartRequirement(chartType);

  /**
   * Can this map actually place the column that was chosen?
   *
   * The name test is not enough, and this dialog was proving it: a column called
   * `region` holding "North", "South", "East", "West" passes `looksGeographic`,
   * so no warning fired, and the map it built matched none of the four and drew
   * an empty world. The boundary file holds country names — so the honest check
   * is against the boundary file, using the values themselves.
   *
   * The atlas is imported only once a map type is selected, which is the same
   * module the map itself loads, so nothing extra is downloaded for anyone
   * building a bar chart.
   */
  const geoSlot = requirement.dimensions.find((slot) => slot.prefer === 'geo');
  const geoColumn = geoSlot ? dims[geoSlot.key] : null;
  const [geoCheck, setGeoCheck] = useState(null);

  useEffect(() => {
    // No clearing branch: setting state synchronously here would re-render on
    // every pass. The result carries the column it describes instead, and a
    // result for a column no longer selected is simply not read.
    if (!geoColumn) return undefined;
    let cancelled = false;
    Promise.all([
      import('world-atlas/countries-110m.json'),
      import('topojson-client'),
      import('../../lib/geo'),
    ])
      .then(([topoMod, topojson, geo]) => {
        if (cancelled) return;
        const topo = topoMod.default || topoMod;
        const names = topojson.feature(topo, topo.objects.countries).features.map((f) => f.properties.name);
        const values = (sample || []).map((row) => row?.[geoColumn]);
        setGeoCheck({ column: geoColumn, ...geo.placeableRegions(values, names) });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [geoColumn, sample]);

  // Changing the type changes the questions, so it re-seeds the answers. Slots
  // the new type shares with the old one keep what was already chosen — picking
  // "matrix" after "bar" should not make you choose the same rows column again.
  useEffect(() => {
    const req = chartRequirement(chartType);
    setDims((current) => {
      const next = {};
      const taken = [];
      for (const slot of req.dimensions) {
        const kept = current[slot.key];
        // An optional well starts empty. Guessing a legend for someone would
        // change what the chart claims without being asked to.
        const value = slot.optional
          ? (kept && dimensions.includes(kept) && !taken.includes(kept) ? kept : '')
          : kept && dimensions.includes(kept) && !taken.includes(kept)
            ? kept
            : pickDimension(slot, { dimensions, temporal, taken });
        next[slot.key] = value;
        if (value) taken.push(value);
      }
      return next;
    });
    setVals((current) => {
      const next = {};
      req.measures.forEach((slot, i) => {
        next[slot.key] = current[slot.key] || pickMeasure(i, measures);
      });
      return next;
    });
    setLimit(req.limit?.preset ?? null);
    setSort('value-desc');
  }, [chartType, dimensions, measures, temporal]);

  const { spec, error: specError } = useMemo(
    () =>
      buildChartSpec(
        { type: chartType, dims, vals, limit, sort, bucket },
        { columns, profile, sample, measures: customMeasures }
      ),
    [chartType, dims, vals, limit, sort, bucket, columns, profile, sample, customMeasures]
  );

  // Warnings, not refusals: each of these produces a chart that renders and
  // says less than it should, and the person building it is better placed than
  // this dialog to know whether the column really does hold countries.
  const warnings = useMemo(() => {
    const list = [];
    const geo = geoCheck && geoCheck.column === geoColumn ? geoCheck : null;
    for (const slot of requirement.dimensions) {
      const chosen = dims[slot.key];
      if (!chosen) continue;
      if (slot.optional) continue;
      if (slot.prefer === 'geo') {
        // The values, when they can be read; the name only as a fallback while
        // the boundary file is still loading.
        if (geo && geo.total > 0 && geo.matched.length === 0) {
          list.push(
            `None of the values in “${pretty(chosen)}” match a country in the boundary file` +
              ` (${geo.unmatched.slice(0, 4).join(', ')}${geo.unmatched.length > 4 ? '…' : ''}).` +
              ' A filled map can only shade countries, so this one would come out blank.'
          );
        } else if (geo && geo.matched.length > 0 && geo.share < 0.5) {
          list.push(
            `Only ${geo.matched.length} of ${geo.total} values in “${pretty(chosen)}” match a country` +
              ` — the rest (${geo.unmatched.slice(0, 3).join(', ')}…) would be left off the map.`
          );
        } else if (!geo && !looksGeographic(chosen)) {
          list.push(
            `“${pretty(chosen)}” does not look like a place. A map can only draw names it can match to a country — check the count it reports once it is on the board.`
          );
        }
      }
      if (slot.prefer === 'time' && temporal.length > 0 && !temporal.includes(chosen)) {
        list.push(
          `“${pretty(chosen)}” is not a date column, so the axis carries no real order. ${
            temporal.length === 1 ? `Try “${pretty(temporal[0])}”.` : 'Pick one of the date columns instead.'
          }`
        );
      }
    }
    if (requirement.measures.length > 1) {
      const chosen = requirement.measures
        .map((slot) => vals[slot.key])
        .filter((v) => v && !v.measureId && v.aggregate !== 'COUNT')
        .map((v) => `${v.aggregate}:${v.column}`);
      if (chosen.length > 1 && new Set(chosen).size < chosen.length) {
        list.push('Two of the measures are the same calculation, so the chart plots one number against itself.');
      }
    }
    return list;
  }, [requirement, dims, vals, temporal, geoCheck, geoColumn]);

  // The date axis is grouped by month or year rather than by the individual
  // day. Only offered when the chosen column is actually a date — on anything
  // else the control would be a no-op.
  const timeSlot = requirement.dimensions.find((slot) => slot.prefer === 'time' || requirement.ordered);
  const showBucket =
    !!timeSlot && bucketableColumn(dims[timeSlot.key], { profile, sample });

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

  if (dimensions.length === 0 && measures.length === 0) {
    return (
      <Shell onClose={onClose}>
        <p className="text-sm text-white/50">
          This dataset has no column that can be grouped by or measured, so there is nothing to chart.
        </p>
      </Shell>
    );
  }

  return (
    <Shell onClose={onClose}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Chart type">
          <select
            value={chartType}
            onChange={(e) => setChartType(e.target.value)}
            className={selectClass}
          >
            {CHART_TYPE_GROUPS.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.types.map((t) => (
                  <option key={t} value={t} className="bg-surface">
                    {chartTypeLabel(t)}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </Field>

        {requirement.limit && !showBucket && (
          <Field label={requirement.limit.label}>
            <Select
              value={limit ?? requirement.limit.preset}
              onChange={(v) => setLimit(Number(v))}
              options={requirement.limit.options}
              format={limitFormat}
            />
          </Field>
        )}

        {requirement.sortable && (
          <Field label="Order">
            <Select
              value={sort}
              onChange={setSort}
              options={SORTS.map((s) => s.key)}
              format={(k) => SORTS.find((s) => s.key === k)?.label || k}
            />
          </Field>
        )}

        {showBucket && (
          <Field label="Group dates">
            <Select
              value={bucket}
              onChange={setBucket}
              options={BUCKETS.map((b) => b.key)}
              format={(k) => BUCKETS.find((b) => b.key === k)?.label || k}
            />
          </Field>
        )}
      </div>

      <p className="mt-3 text-[12px] leading-relaxed text-white/40">{requirement.blurb}</p>

      {requirement.dimensions.length > 0 && (
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          {requirement.dimensions.map((slot) => (
            <Field key={slot.key} label={slot.label} help={slot.help}>
              <Select
                value={dims[slot.key] || ''}
                onChange={(v) => setDims((d) => ({ ...d, [slot.key]: v }))}
                // An optional well can be emptied again, so it carries the way
                // out as its first choice.
                options={slot.optional ? ['', ...dimensions] : dimensions}
                format={(v) => (v === '' ? 'None' : pretty(v))}
              />
            </Field>
          ))}
        </div>
      )}

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {requirement.measures.map((slot) => (
          <MeasureField
            key={slot.key}
            slot={slot}
            value={vals[slot.key]}
            measures={measures}
            customMeasures={customMeasures}
            onChange={(v) => setVals((s) => ({ ...s, [slot.key]: v }))}
          />
        ))}
      </div>

      {warnings.length > 0 && (
        <ul className="mt-4 flex flex-col gap-1.5">
          {warnings.map((w, i) => (
            <li
              key={i}
              className="flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/[0.06] px-3 py-2 text-[12px] leading-relaxed text-amber-200/85"
            >
              <AlertTriangle size={13} className="mt-0.5 shrink-0 text-amber-400" />
              {w}
            </li>
          ))}
        </ul>
      )}

      {spec && (
        <div className="mt-5">
          <div className="label mb-2">Query</div>
          <pre className="code-surface whitespace-pre-wrap break-words rounded-lg border border-white/10 p-3 font-mono text-[11px] leading-relaxed">
            {formatSql(spec.sql)}
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
          disabled={!spec || busy}
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

/**
 * One measure slot: what to calculate, and over which column.
 *
 * The aggregate and the column are one decision presented as two, so they sit
 * together rather than being scattered by however many measures the type wants.
 * A saved measure replaces both — it already is an aggregate over a column,
 * usually a more interesting one than any single column can express.
 */
function MeasureField({ slot, value, measures, customMeasures, onChange }) {
  const selection = value || { aggregate: 'COUNT', column: '', measureId: null };
  const usingSaved = !!selection.measureId;
  const needsColumn = !usingSaved && selection.aggregate !== 'COUNT';

  const pick = (raw) => {
    if (raw.startsWith('measure:')) {
      onChange({ aggregate: null, column: selection.column, measureId: raw.slice(8) });
      return;
    }
    onChange({
      aggregate: raw,
      column: selection.column || measures[0] || '',
      measureId: null,
    });
  };

  return (
    <label className="flex flex-col gap-2">
      <span className="label">{slot.label}</span>
      <select
        value={usingSaved ? `measure:${selection.measureId}` : selection.aggregate || 'COUNT'}
        onChange={(e) => pick(e.target.value)}
        className={selectClass}
      >
        {(measures.length ? AGGREGATES.map((a) => a.key) : ['COUNT']).map((key) => (
          <option key={key} value={key} className="bg-surface">
            {aggregateLabel(key)}
          </option>
        ))}
        {customMeasures.length > 0 && (
          <optgroup label="Measures">
            {customMeasures.map((m) => (
              <option key={m.id} value={`measure:${m.id}`} className="bg-surface">
                {m.name}
              </option>
            ))}
          </optgroup>
        )}
      </select>

      {needsColumn && (
        <Select
          value={selection.column || ''}
          onChange={(v) => onChange({ ...selection, column: v })}
          options={measures}
          format={pretty}
        />
      )}

      {slot.help && <span className="text-[11px] leading-relaxed text-white/30">{slot.help}</span>}
    </label>
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

function Field({ label, help, children }) {
  return (
    <label className="flex flex-col gap-2">
      <span className="label">{label}</span>
      {children}
      {help && <span className="text-[11px] leading-relaxed text-white/30">{help}</span>}
    </label>
  );
}

const selectClass =
  'rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm font-bold text-white/85 outline-none focus:border-accent-500/50';

function Select({ value, onChange, options, format = (v) => v }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={selectClass}>
      {options.map((o) => (
        <option key={o} value={o} className="bg-surface">
          {format(o)}
        </option>
      ))}
    </select>
  );
}
