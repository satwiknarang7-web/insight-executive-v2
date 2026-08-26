'use client';

/**
 * Write a measure by saying what you want.
 *
 * The whole point of the feature is that the box at the top takes a sentence,
 * not a formula — so the formula is shown, always, but below the answer rather
 * than in place of it. Two things follow from that:
 *
 *   - Nothing is saved until the number has been computed and shown. A measure
 *     that was never evaluated is a guess, and a guess is what this app exists
 *     not to put on a dashboard.
 *   - The generated formula stays editable. The parser is deliberately narrow;
 *     when it reads a phrase almost-but-not-quite right, correcting one word of
 *     SQL is far quicker than fighting the sentence into a shape it accepts.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Loader2, Sparkles, TriangleAlert, Wand2, X } from 'lucide-react';
import { useActions, useDataset, useMeasures } from '../../lib/store/DatasetProvider';
import { exampleMeasurePhrases } from '../../lib/measureLanguage';
import { MEASURE_FORMATS, formatMeasureValue, measureSql } from '../../lib/measures';

export default function MeasureBuilder({ initial = null, onSaved, onCancel, phraseRef = null }) {
  const { dataset } = useDataset();
  const measures = useMeasures();
  const { draftMeasure, saveMeasure, evaluateMeasure } = useActions();

  const [phrase, setPhrase] = useState('');
  const [draft, setDraft] = useState(initial);
  const [value, setValue] = useState(null);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState(null);

  // Four chips, not the whole list: this row sits under the box as a nudge, and
  // the reference panel beside it is where the full set belongs.
  const examples = useMemo(
    () => exampleMeasurePhrases(dataset?.profile, { measures, sample: dataset?.preview || [] }).slice(0, 4),
    [dataset, measures]
  );
  const context = useMemo(
    () => ({ columns: dataset?.columns || [], profile: dataset?.profile, measures }),
    [dataset, measures]
  );

  /** Run the draft and show its value — the proof that it means something. */
  const check = useCallback(
    async (candidate) => {
      setChecking(true);
      setError(null);
      try {
        const { value: computed } = await evaluateMeasure(candidate);
        setValue(computed);
        if (computed === null) setError('That formula runs, but produces no value for this data.');
      } catch (e) {
        setValue(null);
        setError(e.message);
      } finally {
        setChecking(false);
      }
    },
    [evaluateMeasure]
  );

  // An existing measure opened for editing shows its current value straight away.
  useEffect(() => {
    if (initial) check(initial);
  }, [initial, check]);

  const build = async (text) => {
    const said = (text ?? phrase).trim();
    if (!said || busy) return;
    setBusy(true);
    setError(null);
    setValue(null);
    try {
      const candidate = await draftMeasure(said);
      setDraft(candidate);
      await check(candidate);
    } catch (e) {
      setDraft(null);
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  /** Edit one field of the draft. Touching the formula invalidates the value. */
  const patch = (fields) => {
    setDraft((d) => ({ ...d, ...fields }));
    if (fields.expr !== undefined || fields.filter !== undefined) setValue(null);
  };

  const save = () => {
    try {
      const saved = saveMeasure(draft);
      setDraft(null);
      setValue(null);
      setPhrase('');
      setError(null);
      onSaved?.(saved);
    } catch (e) {
      setError(e.message);
    }
  };

  // Let the reference panel append a column name or replace the whole phrase.
  if (phraseRef) {
    phraseRef.current = (text, { replace = false } = {}) => {
      setPhrase((current) => {
        if (replace) return text;
        const trimmed = current.trimEnd();
        return trimmed ? `${trimmed} ${text}` : text;
      });
    };
  }

  const sql = draft ? measureSql(draft, context).sql : null;
  const canSave = !!draft && value !== null && !checking;

  return (
    <div>
      {!initial && (
        <>
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Sparkles size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-accent-400" />
              <input
                value={phrase}
                onChange={(e) => setPhrase(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && build()}
                placeholder="Say what you want to measure — “profit as a percentage of revenue”"
                aria-label="Describe the measure"
                className="w-full rounded-lg border border-white/10 bg-white/5 py-3 pl-9 pr-3 text-sm text-white/85 outline-none placeholder:text-white/25 focus:border-accent-500/50"
              />
            </div>
            <button
              type="button"
              onClick={() => build()}
              disabled={!phrase.trim() || busy}
              className="flex items-center justify-center gap-2 rounded-lg bg-accent-500 px-4 py-3 text-[10px] font-black uppercase tracking-[0.2em] text-on-accent transition-colors hover:bg-accent-400 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/30"
            >
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />}
              {busy ? 'Working' : 'Build it'}
            </button>
          </div>

          {!draft && examples.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {examples.map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => {
                    setPhrase(example);
                    if (!example.endsWith('…')) build(example);
                  }}
                  className="rounded-full border border-white/10 px-3 py-1.5 text-[11px] text-white/45 transition-colors hover:border-accent-500/40 hover:text-white/80"
                >
                  {example}
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {error && !draft && (
        <p className="mt-3 flex items-start gap-2 rounded-lg border border-rose-500/25 bg-rose-500/8 px-3 py-2 text-[13px] text-rose-300">
          <TriangleAlert size={14} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </p>
      )}

      {draft && (
        <div className={initial ? '' : 'mt-5 border-t border-white/8 pt-5'}>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <label className="min-w-0 flex-1">
              <span className="label">Name</span>
              <input
                value={draft.name}
                onChange={(e) => patch({ name: e.target.value })}
                aria-label="Measure name"
                className="mt-1.5 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm font-bold text-white/90 outline-none focus:border-accent-500/50"
              />
            </label>

            <div className="text-right">
              <div className="label">Value now</div>
              <div className="mt-1 text-3xl font-black tracking-tight text-white">
                {checking ? (
                  <Loader2 size={22} className="animate-spin text-white/30" />
                ) : (
                  formatMeasureValue(value, draft.format)
                )}
              </div>
            </div>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_auto]">
            <label className="min-w-0">
              <span className="label">Formula</span>
              <input
                value={draft.expr}
                onChange={(e) => patch({ expr: e.target.value })}
                aria-label="Measure formula"
                spellCheck={false}
                className="code-surface mt-1.5 w-full rounded-lg border border-white/10 px-3 py-2 font-mono text-[12px] text-white/80 outline-none focus:border-accent-500/50"
              />
            </label>
            <label>
              <span className="label">Format</span>
              <select
                value={draft.format}
                onChange={(e) => patch({ format: e.target.value })}
                aria-label="Value format"
                className="mt-1.5 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm font-bold text-white/85 outline-none focus:border-accent-500/50"
              >
                {MEASURE_FORMATS.map((f) => (
                  <option key={f.key} value={f.key} className="bg-surface">
                    {f.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="mt-4 block">
            <span className="label">Only count rows where</span>
            <input
              value={draft.filter || ''}
              onChange={(e) => patch({ filter: e.target.value.trim() ? e.target.value : null })}
              placeholder="every row"
              aria-label="Row filter"
              spellCheck={false}
              className="code-surface mt-1.5 w-full rounded-lg border border-white/10 px-3 py-2 font-mono text-[12px] text-white/80 outline-none placeholder:font-sans placeholder:text-white/25 focus:border-accent-500/50"
            />
          </label>

          {sql && (
            <pre className="code-surface mt-4 overflow-x-auto rounded-lg border border-white/10 p-3 font-mono text-[11px] leading-relaxed text-white/45">
              {sql}
            </pre>
          )}

          {error && (
            <p className="mt-3 flex items-start gap-2 rounded-lg border border-rose-500/25 bg-rose-500/8 px-3 py-2 text-[13px] text-rose-300">
              <TriangleAlert size={14} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </p>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={save}
              disabled={!canSave}
              className="flex items-center gap-2 rounded-lg bg-accent-500 px-4 py-2.5 text-[10px] font-black uppercase tracking-[0.2em] text-on-accent transition-colors hover:bg-accent-400 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/30"
            >
              <Check size={13} />
              {initial ? 'Save changes' : 'Save measure'}
            </button>
            <button
              type="button"
              onClick={() => check(draft)}
              disabled={checking}
              className="rounded-lg border border-white/10 px-3 py-2.5 text-[10px] font-black uppercase tracking-[0.2em] text-white/45 transition-colors hover:bg-white/5 hover:text-white"
            >
              {value === null ? 'Compute value' : 'Recompute'}
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft(null);
                setValue(null);
                setError(null);
                onCancel?.();
              }}
              className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-2.5 text-[10px] font-black uppercase tracking-[0.2em] text-white/45 transition-colors hover:bg-white/5 hover:text-white"
            >
              <X size={13} />
              Discard
            </button>
            {value === null && !checking && !error && (
              <span className="text-[11px] text-white/35">Compute the value before saving.</span>
            )}
          </div>

          {draft.explanation && <p className="mt-3 text-[12px] leading-relaxed text-white/35">{draft.explanation}</p>}
        </div>
      )}
    </div>
  );
}
