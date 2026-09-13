'use client';

import { useCallback, useMemo, useState } from 'react';
import { AlertTriangle, Check, Code2, Loader2, Plus, Trash2, Wand2, X } from 'lucide-react';
import { useActions, useDataset } from '../../lib/store/DatasetProvider';
import {
  DERIVE,
  DROP,
  FILTER,
  RENAME,
  RETYPE,
  RETYPE_TARGETS,
  describeTransform,
  planTransforms,
  validateTransform,
} from '../../lib/transforms';

/**
 * The steps between the file and the analysis.
 *
 * An ordered list, shown as a list, with the query each step becomes sitting
 * under it. That last part is the point: this app's whole claim is that a
 * number can be traced to something readable, and a transform layer that
 * reshaped the data invisibly would be the one place that claim stopped being
 * true — the figures would still trace to a query, over a table nobody could
 * account for.
 *
 * Steps are staged and applied together rather than one at a time. They refer
 * to each other, so a half-applied list is a list in a state its author never
 * asked for; and rebuilding the view costs a pass over every row, which is not
 * something to spend on each keystroke.
 */

const KINDS = [
  { id: DERIVE, label: 'Add a column' },
  { id: FILTER, label: 'Keep rows where' },
  { id: RENAME, label: 'Rename' },
  { id: RETYPE, label: 'Change type' },
  { id: DROP, label: 'Drop' },
];

const blank = (kind, columns) => {
  const first = columns[0] || '';
  switch (kind) {
    case DERIVE:
      return { kind, name: '', expr: '' };
    case FILTER:
      return { kind, expr: '' };
    case RENAME:
      return { kind, column: first, to: '' };
    case RETYPE:
      return { kind, column: first, to: 'number' };
    default:
      return { kind, column: first };
  }
};

export default function TransformPanel() {
  const { dataset } = useDataset();
  const { setTransforms } = useActions();

  const columns = useMemo(() => dataset?.columns || [], [dataset]);
  // The applied list is the dataset's; the staged list is what is being edited.
  const applied = useMemo(() => dataset?.transforms || [], [dataset]);
  const [steps, setSteps] = useState(null);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [showSql, setShowSql] = useState(false);

  const list = steps ?? applied;
  const dirty = steps !== null && JSON.stringify(steps) !== JSON.stringify(applied);

  /**
   * The columns a *new* step would be written against.
   *
   * Not the dataset's columns — the ones the staged list leaves behind. A
   * derive added after a rename has to be able to mention the new name, and
   * offering the old one would be offering a step that cannot run.
   */
  const plan = useMemo(() => planTransforms(list, dataset?.baseColumns || columns), [list, columns, dataset]);
  const available = plan.columns;

  const apply = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await setTransforms(list);
      setSteps(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }, [list, setTransforms]);

  const commitDraft = useCallback(() => {
    const checked = validateTransform(draft, available);
    if (!checked.ok) {
      setError(checked.error);
      return;
    }
    setSteps([...list, { ...draft, id: `t${Date.now()}` }]);
    setDraft(null);
    setError(null);
  }, [draft, available, list]);

  if (!dataset) return null;

  const field =
    'rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-[12px] text-white/85 outline-none focus:border-accent-500/50';

  return (
    <div className="card p-4">
      <div className="mb-1 flex items-center gap-2">
        <Wand2 size={14} className="text-accent-400" />
        <span className="label">Shape the data</span>
        {plan.steps.length > 0 && (
          <button
            onClick={() => setShowSql((v) => !v)}
            className="ml-auto flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.15em] text-white/30 transition-colors hover:text-accent-400"
          >
            <Code2 size={11} /> {showSql ? 'Hide' : 'Show'} SQL
          </button>
        )}
      </div>
      <p className="mb-3 text-[12px] leading-relaxed text-white/40">
        Each step is one query over the result of the one before it. Applied before anything is
        analysed, so the charts and the findings see the shape you made.
      </p>

      {list.length === 0 && !draft && (
        <p className="rounded-lg border border-white/6 bg-white/[0.02] px-3 py-2.5 text-[12px] text-white/35">
          No steps. The data is being analysed exactly as it was read.
        </p>
      )}

      <ul className="flex flex-col gap-1.5">
        {list.map((op, i) => {
          const step = plan.steps.find((s) => s.id === op.id);
          const failed = plan.skipped.find((s) => s.id === op.id && s.reason !== 'turned off');
          return (
            <li
              key={op.id || i}
              className={`rounded-lg border px-3 py-2 ${
                failed ? 'border-amber-500/30 bg-amber-500/[0.05]' : 'border-white/7 bg-white/[0.02]'
              }`}
            >
              <div className="flex items-start gap-2">
                <span className="mt-0.5 w-4 shrink-0 text-[10px] font-black tabular-nums text-white/25">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className={`text-[12px] ${op.enabled === false ? 'text-white/25 line-through' : 'text-white/75'}`}>
                    {describeTransform(op)}
                  </div>
                  {failed && (
                    <div className="mt-1 flex items-start gap-1.5 text-[11px] leading-relaxed text-amber-300/80">
                      <AlertTriangle size={11} className="mt-0.5 shrink-0" />
                      {failed.reason}
                    </div>
                  )}
                  {showSql && step && (
                    <code className="mt-1.5 block overflow-x-auto whitespace-pre rounded bg-black/30 px-2 py-1 font-mono text-[10px] text-white/40">
                      {step.sql}
                    </code>
                  )}
                </div>
                <button
                  onClick={() => setSteps(list.map((s, j) => (j === i ? { ...s, enabled: s.enabled === false } : s)))}
                  title={op.enabled === false ? 'Turn this step on' : 'Turn this step off'}
                  className="shrink-0 rounded p-1 text-white/25 transition-colors hover:bg-white/8 hover:text-white/70"
                >
                  <Check size={13} />
                </button>
                <button
                  onClick={() => setSteps(list.filter((_, j) => j !== i))}
                  title="Remove this step"
                  className="shrink-0 rounded p-1 text-white/25 transition-colors hover:bg-rose-500/12 hover:text-rose-300"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {draft ? (
        <div className="mt-2 rounded-lg border border-accent-500/25 bg-accent-500/[0.04] p-3">
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={draft.kind}
              onChange={(e) => setDraft(blank(e.target.value, available))}
              className={field}
            >
              {KINDS.map((k) => (
                <option key={k.id} value={k.id} className="bg-surface">
                  {k.label}
                </option>
              ))}
            </select>

            {(draft.kind === RENAME || draft.kind === RETYPE || draft.kind === DROP) && (
              <select
                value={draft.column}
                onChange={(e) => setDraft({ ...draft, column: e.target.value })}
                className={field}
              >
                {available.map((c) => (
                  <option key={c} value={c} className="bg-surface">
                    {c}
                  </option>
                ))}
              </select>
            )}

            {draft.kind === RENAME && (
              <input
                value={draft.to}
                onChange={(e) => setDraft({ ...draft, to: e.target.value })}
                placeholder="New name"
                className={`${field} min-w-0 flex-1`}
              />
            )}

            {draft.kind === RETYPE && (
              <select
                value={draft.to}
                onChange={(e) => setDraft({ ...draft, to: e.target.value })}
                className={field}
              >
                {Object.entries(RETYPE_TARGETS).map(([id, t]) => (
                  <option key={id} value={id} className="bg-surface">
                    {t.label}
                  </option>
                ))}
              </select>
            )}

            {draft.kind === DERIVE && (
              <input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="Column name"
                className={field}
              />
            )}

            {(draft.kind === DERIVE || draft.kind === FILTER) && (
              <input
                value={draft.expr}
                onChange={(e) => setDraft({ ...draft, expr: e.target.value })}
                placeholder={draft.kind === FILTER ? '[units] > 0' : '[revenue] / [units]'}
                spellCheck={false}
                className={`${field} min-w-0 flex-1 font-mono`}
              />
            )}
          </div>

          {/* The columns it may mention, because a formula box with no list
              beside it is a guessing game about spelling. */}
          {(draft.kind === DERIVE || draft.kind === FILTER) && (
            <div className="mt-2 flex flex-wrap gap-1">
              {available.map((c) => (
                <button
                  key={c}
                  onClick={() => setDraft({ ...draft, expr: `${draft.expr}[${c}]` })}
                  className="rounded border border-white/8 bg-white/[0.03] px-1.5 py-0.5 font-mono text-[10px] text-white/40 transition-colors hover:border-accent-500/30 hover:text-accent-300"
                >
                  {c}
                </button>
              ))}
            </div>
          )}

          <div className="mt-2.5 flex items-center gap-2">
            <button
              onClick={commitDraft}
              className="rounded-lg bg-accent-500 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.15em] text-on-accent transition-colors hover:bg-accent-400"
            >
              Add step
            </button>
            <button
              onClick={() => {
                setDraft(null);
                setError(null);
              }}
              className="rounded-lg border border-white/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.15em] text-white/45 transition-colors hover:bg-white/5"
            >
              <X size={12} />
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => {
            setDraft(blank(DERIVE, available));
            setError(null);
          }}
          className="mt-2 flex items-center gap-1.5 rounded-lg border border-dashed border-white/12 px-3 py-2 text-[11px] font-bold uppercase tracking-[0.15em] text-white/40 transition-colors hover:border-accent-500/30 hover:text-accent-300"
        >
          <Plus size={12} /> Add a step
        </button>
      )}

      {error && (
        <p className="mt-2 rounded-lg border border-rose-500/25 bg-rose-500/8 px-3 py-2 text-[12px] leading-relaxed text-rose-200">
          {error}
        </p>
      )}

      {dirty && (
        <div className="mt-3 flex items-center gap-2 border-t border-white/6 pt-3">
          <button
            onClick={apply}
            disabled={busy}
            className="flex items-center gap-2 rounded-lg bg-accent-500 px-4 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-on-accent transition-colors hover:bg-accent-400 disabled:opacity-40"
          >
            {busy && <Loader2 size={12} className="animate-spin" />} Apply
          </button>
          <button
            onClick={() => {
              setSteps(null);
              setError(null);
            }}
            className="text-[10px] font-black uppercase tracking-[0.2em] text-white/30 transition-colors hover:text-white/60"
          >
            Discard
          </button>
          {/* Said before the button is pressed, not after the deck disappears. */}
          <span className="ml-auto text-[11px] text-white/30">Re-runs the analysis</span>
        </div>
      )}
    </div>
  );
}
