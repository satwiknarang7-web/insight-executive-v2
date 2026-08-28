'use client';

/**
 * Measures — the calculations this dataset does not come with.
 *
 * A dataset has columns; a business has metrics. Margin, average order value,
 * win rate and revenue per customer are none of them a column in the file, and
 * before this page the only way to put one on a dashboard was to work it out
 * somewhere else and type the answer in. This is where that gap is closed: say
 * what the calculation is, once, and it becomes a named thing that can be put
 * on a card or broken out by any column — and that recomputes when the data
 * changes, because it is a query and not a number somebody remembered.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  BarChart3,
  Calculator,
  Loader2,
  Pencil,
  Pin,
  Plus,
  Sigma,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import PageFrame from '../../../components/shell/PageFrame';
import MeasureBuilder from '../../../components/panels/MeasureBuilder';
import MeasureReference from '../../../components/panels/MeasureReference';
import DerivedMeasures from '../../../components/panels/DerivedMeasures';
import { useActions, useAnalysis, useDataset, useMeasures } from '../../../lib/store/DatasetProvider';
import { compileMeasure, formatMeasureValue, measureByDimensionSql } from '../../../lib/measures';

const CHART_TYPES = ['bar', 'line', 'area', 'donut', 'treemap', 'radial'];

// Pinning a card and adding a chart both put something on the dashboard, which
// has to exist first — there is no board to add to until the dataset has been
// analysed.
const NEEDS_DASHBOARD = 'Analyse the dataset first — there is no dashboard yet to add this to.';

export default function MeasuresPage() {
  const { dataset } = useDataset();
  const { analysis } = useAnalysis();
  const measures = useMeasures();
  const { evaluateMeasure, deleteMeasure, createKpi, addSlide } = useActions();
  const router = useRouter();

  // Set by MeasureBuilder; called by the reference panel to type into its box.
  const insertRef = useRef(null);
  const insert = useCallback((text, opts) => insertRef.current?.(text, opts), []);

  const [values, setValues] = useState({});
  const [editing, setEditing] = useState(null);
  const [notice, setNotice] = useState(null);

  const context = useMemo(
    () => ({ columns: dataset?.columns || [], profile: dataset?.profile, measures }),
    [dataset, measures]
  );

  /**
   * Every measure's current value.
   *
   * Recomputed whenever the list changes rather than cached with the measure:
   * a stored value would go stale the moment a new file is loaded, and a stale
   * number on this page is exactly the failure the whole feature is about.
   */
  useEffect(() => {
    let cancelled = false;
    if (!dataset || !measures.length) {
      setValues({});
      return undefined;
    }
    (async () => {
      const next = {};
      for (const measure of measures) {
        try {
          const { value } = await evaluateMeasure(measure);
          next[measure.id] = { value };
        } catch (e) {
          next[measure.id] = { error: e.message };
        }
      }
      if (!cancelled) setValues(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [dataset, measures, evaluateMeasure]);

  const pin = useCallback(
    (measure) => {
      const state = values[measure.id];
      if (!analysis) {
        setNotice(NEEDS_DASHBOARD);
        return;
      }
      createKpi({
        label: measure.name,
        value: formatMeasureValue(state?.value ?? null, measure.format),
        source: { measureId: measure.id },
        autoLabel: true,
      });
      setNotice(`${measure.name} added to the dashboard.`);
    },
    [analysis, createKpi, values]
  );

  const remove = useCallback(
    (measure) => {
      try {
        deleteMeasure(measure.id);
        setNotice(null);
      } catch (e) {
        setNotice(e.message);
      }
    },
    [deleteMeasure]
  );

  if (!dataset) return null;

  return (
    <PageFrame
      title="Measures"
      subtitle="Calculations you describe in plain English, computed from the loaded rows"
    >
      <div className="mb-8 grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="card p-6">
          <div className="mb-4 flex items-center gap-3">
            <Calculator size={15} className="text-accent-400" />
            <h2 className="text-sm font-black text-white">
              {editing ? `Editing ${editing.name}` : 'New measure'}
            </h2>
          </div>
          <MeasureBuilder
            key={editing?.id || 'new'}
            initial={editing}
            phraseRef={insertRef}
            onSaved={() => {
              setEditing(null);
              setNotice(null);
            }}
            onCancel={() => setEditing(null)}
          />
        </section>

        <MeasureReference dataset={dataset} measures={measures} onInsert={insert} />
      </div>

      <DerivedMeasures derived={dataset.derivedMeasures || []} />

      {notice && (
        <p className="mb-6 rounded-lg border border-accent-500/25 bg-accent-500/[0.06] px-4 py-3 text-[13px] text-accent-200">
          {notice}
        </p>
      )}

      {measures.length === 0 ? (
        <section className="card p-8 text-center">
          <Sigma size={20} className="mx-auto mb-3 text-white/20" />
          <p className="mx-auto max-w-md text-[13px] leading-relaxed text-white/40">
            No measures yet. A measure is a calculation this file does not contain — a margin, a rate, an
            average per something — named once and reusable on every card and chart.
          </p>
        </section>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {measures.map((measure) => (
            <MeasureCard
              key={measure.id}
              measure={measure}
              state={values[measure.id]}
              context={context}
              dimensions={dataset.profile?.dimensions || []}
              onPin={() => pin(measure)}
              onEdit={() => setEditing(measure)}
              onDelete={() => remove(measure)}
              onChart={async (spec) => {
                if (!analysis) {
                  setNotice(NEEDS_DASHBOARD);
                  return;
                }
                await addSlide(spec, { title: spec.title });
                router.push('/dashboard');
              }}
            />
          ))}
        </div>
      )}
    </PageFrame>
  );
}

/** One saved measure: its value, its formula, and what can be done with it. */
function MeasureCard({ measure, state, context, dimensions, onPin, onEdit, onDelete, onChart }) {
  const [charting, setCharting] = useState(false);
  const compiled = useMemo(() => compileMeasure(measure, context), [measure, context]);
  const broken = !compiled.ok;

  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="truncate text-sm font-black text-white">{measure.name}</div>
          <div className="mt-0.5 text-[11px] text-white/30">
            {measure.source === 'model'
              ? 'Written by the model'
              : measure.source === 'auto'
                ? 'Written for this dataset'
                : 'Read from your words'}
            {compiled.ok && compiled.dependsOn?.length ? ` · uses ${compiled.dependsOn.join(', ')}` : ''}
          </div>
        </div>
        <div className="shrink-0 text-right">
          {broken || state?.error ? (
            <TriangleAlert size={16} className="ml-auto text-amber-400" />
          ) : state ? (
            <div className="text-2xl font-black tracking-tight text-white">
              {formatMeasureValue(state.value, measure.format)}
            </div>
          ) : (
            <Loader2 size={16} className="ml-auto animate-spin text-white/25" />
          )}
        </div>
      </div>

      <pre className="code-surface mt-3 overflow-x-auto rounded-lg border border-white/10 p-2.5 font-mono text-[11px] leading-relaxed text-white/45">
        {measure.expr}
        {measure.filter ? `\nWHERE ${measure.filter}` : ''}
      </pre>

      {(broken || state?.error) && (
        <p className="mt-2 text-[11px] leading-snug text-amber-400/90">
          {compiled.error || state?.error} This usually means the data changed — edit the formula to match
          the columns now loaded.
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        <Action icon={Pin} label="Pin to dashboard" onClick={onPin} disabled={broken} />
        <Action icon={BarChart3} label="Chart it" onClick={() => setCharting((v) => !v)} disabled={broken || !dimensions.length} />
        <Action icon={Pencil} label="Edit" onClick={onEdit} />
        <Action icon={Trash2} label="Delete" onClick={onDelete} tone="rose" />
      </div>

      {charting && (
        <ChartRow
          measure={measure}
          context={context}
          dimensions={dimensions}
          onDone={() => setCharting(false)}
          onChart={onChart}
        />
      )}
    </div>
  );
}

/** Break a measure out by a column and put the result on the dashboard. */
function ChartRow({ measure, context, dimensions, onChart, onDone }) {
  const [dimension, setDimension] = useState(dimensions[0] || '');
  const [chartType, setChartType] = useState('bar');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const add = async () => {
    const built = measureByDimensionSql(measure, { dimension, limit: 10 }, context);
    if (built.error) {
      setError(built.error);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onChart({
        sql: built.sql,
        chart_type: chartType,
        xAxisKey: built.xAxisKey,
        yAxisKey: built.yAxisKey,
        title: `${measure.name} by ${String(dimension).replace(/_/g, ' ')}`,
      });
      onDone();
    } catch (e) {
      setError(e.message || 'That chart could not be built.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 border-t border-white/8 pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] text-white/35">by</span>
        <select
          value={dimension}
          onChange={(e) => setDimension(e.target.value)}
          aria-label="Break out by"
          className="min-w-0 rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-[11px] font-bold capitalize text-white/75 outline-none focus:border-accent-500/50"
        >
          {dimensions.map((d) => (
            <option key={d} value={d} className="bg-surface">
              {d.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
        <select
          value={chartType}
          onChange={(e) => setChartType(e.target.value)}
          aria-label="Chart type"
          className="rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-[11px] font-bold capitalize text-white/75 outline-none focus:border-accent-500/50"
        >
          {CHART_TYPES.map((t) => (
            <option key={t} value={t} className="bg-surface">
              {t}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={add}
          disabled={busy || !dimension}
          className="flex items-center gap-1.5 rounded-lg bg-accent-500 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.2em] text-on-accent transition-colors hover:bg-accent-400 disabled:bg-white/10 disabled:text-white/30"
        >
          {busy ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
          Add to dashboard
        </button>
      </div>
      {error && <p className="mt-2 text-[11px] text-rose-400">{error}</p>}
    </div>
  );
}

function Action({ icon: Icon, label, onClick, disabled = false, tone = 'default' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[10px] font-black uppercase tracking-[0.16em] transition-colors disabled:cursor-not-allowed disabled:opacity-30 ${
        tone === 'rose'
          ? 'border-white/10 text-white/40 hover:border-rose-500/30 hover:bg-rose-500/10 hover:text-rose-300'
          : 'border-white/10 text-white/45 hover:bg-white/5 hover:text-white'
      }`}
    >
      <Icon size={11} />
      {label}
    </button>
  );
}
