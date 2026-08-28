'use client';

/**
 * The measures the app wrote for this dataset.
 *
 * These come from `lib/measureSemantics.js`, which reads the shape of the data
 * — which table each column came from, which one identifies a transaction,
 * which are components of a larger amount — and writes the measures an analyst
 * would have written by hand: order value, discount rate, basket size, the rate
 * at which orders are cancelled.
 *
 * They are shown here rather than saved silently, and the distinction matters.
 * The report already uses them, so the numbers are on screen either way; what
 * this panel offers is the chance to see how each one is defined, check the
 * value it produces, and decide whether it belongs in your own list. Keeping
 * one copies it into your measures, where it can be renamed and edited like
 * anything you wrote yourself.
 */
import { useCallback, useEffect, useState } from 'react';
import { Check, Loader2, Plus, Sparkles, TriangleAlert } from 'lucide-react';
import { useActions, useMeasures } from '../../lib/store/DatasetProvider';
import { formatMeasureValue } from '../../lib/measures';

export default function DerivedMeasures({ derived = [] }) {
  const measures = useMeasures();
  const { evaluateMeasure, saveMeasure } = useActions();

  const [values, setValues] = useState({});
  const [error, setError] = useState(null);

  // Which of these the user has already kept. Matched on the formula, not the
  // name, so a kept measure that was then renamed is still recognised as this
  // one rather than being offered again.
  const keptExprs = new Set(measures.map((m) => String(m.expr).replace(/\s+/g, '')));
  const isKept = (m) => keptExprs.has(String(m.expr).replace(/\s+/g, ''));

  const compute = useCallback(async () => {
    const next = {};
    for (const m of derived) {
      try {
        const { value } = await evaluateMeasure(m);
        next[m.name] = { value };
      } catch (e) {
        next[m.name] = { error: e.message };
      }
    }
    setValues(next);
  }, [derived, evaluateMeasure]);

  useEffect(() => {
    if (derived.length) compute();
  }, [derived, compute]);

  if (!derived.length) return null;

  const keep = (m) => {
    try {
      saveMeasure({ ...m, source: 'auto' });
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <section className="card mb-8 p-6">
      <div className="mb-1 flex items-center gap-3">
        <Sparkles size={15} className="text-accent-400" />
        <h2 className="text-sm font-black text-white">Written for this dataset</h2>
      </div>
      <p className="mb-5 text-[12px] leading-relaxed text-white/40">
        Worked out from the shape of your data and already used in the report. Keep one to add it to
        your own measures, where you can rename or edit it.
      </p>

      {error && (
        <p className="mb-4 flex items-start gap-2 rounded-lg border border-rose-500/25 bg-rose-500/8 px-3 py-2 text-[13px] text-rose-300">
          <TriangleAlert size={14} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </p>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        {derived.map((m) => {
          const state = values[m.name];
          const kept = isKept(m);
          return (
            <div key={m.name} className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-black text-white">{m.name}</div>
                  {m.why && <div className="mt-0.5 text-[11px] leading-snug text-white/35">{m.why}</div>}
                </div>
                <div className="shrink-0 text-right">
                  {state?.error ? (
                    <TriangleAlert size={15} className="ml-auto text-amber-400" />
                  ) : state ? (
                    <div className="text-lg font-black tracking-tight text-white">
                      {formatMeasureValue(state.value, m.format)}
                    </div>
                  ) : (
                    <Loader2 size={14} className="ml-auto animate-spin text-white/25" />
                  )}
                </div>
              </div>

              <pre className="code-surface mt-3 overflow-x-auto rounded-lg border border-white/10 p-2 font-mono text-[10px] leading-relaxed text-white/45">
                {m.expr}
              </pre>

              <button
                type="button"
                onClick={() => keep(m)}
                disabled={kept}
                className={`mt-3 flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[10px] font-black uppercase tracking-[0.16em] transition-colors ${
                  kept
                    ? 'cursor-default border-accent-500/30 bg-accent-500/10 text-accent-300'
                    : 'border-white/10 text-white/45 hover:bg-white/5 hover:text-white'
                }`}
              >
                {kept ? <Check size={11} /> : <Plus size={11} />}
                {kept ? 'In your measures' : 'Keep'}
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
