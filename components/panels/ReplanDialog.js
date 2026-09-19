'use client';

/**
 * Asking a model to choose what the dashboard shows.
 *
 * One field, and it is optional. What the reader is trying to decide is the
 * single most useful thing this pass can be told — it turns "which of these
 * forty columns matter" into a brief — and demanding it would turn a button
 * into a form. Empty is a legitimate answer and the prompt is built without
 * that section.
 *
 * Afterwards the old board is still in hand, so the two can be compared and
 * the previous one put back. That is the point of offering both planners
 * rather than replacing one with the other: the rule list needs no key, runs
 * instantly and never invents; the model reads what the columns mean. Neither
 * is right for every table.
 */
import { Loader2, Sparkles, Undo2, Wand2, X } from 'lucide-react';

const EXAMPLES = [
  'Which plan each engineer should get, for the money',
  'Where we are losing customers and what it costs',
  'Which products are worth keeping in the range',
];

export default function ReplanDialog({ state, busy = false, onIntent, onRun, onRestore, onClose }) {
  const result = state?.result || null;
  const planned = result?.planned || 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={busy ? undefined : onClose}
      role="presentation"
    >
      <div
        className="panel w-full max-w-lg p-6"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Re-plan the dashboard"
      >
        <div className="mb-1 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Wand2 size={15} className="text-accent-400" />
            <h2 className="text-base font-black text-white">Re-plan with AI</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="rounded-lg p-1 text-white/30 transition-colors hover:bg-white/5 hover:text-white disabled:opacity-30"
          >
            <X size={16} />
          </button>
        </div>

        {!result && (
          <>
            <p className="mb-5 text-[12px] leading-relaxed text-white/45">
              The dashboard you have was planned by rules — what varies most, what groups cleanly. A model
              can read what the columns <em>mean</em> instead. It is shown the column names and types, never
              your rows, and every chart it proposes is a query this app runs and checks for itself.
            </p>

            <label className="label mb-2 block" htmlFor="replan-intent">
              What are you trying to decide? <span className="text-white/25">(optional)</span>
            </label>
            <textarea
              id="replan-intent"
              value={state?.intent || ''}
              onChange={(e) => onIntent(e.target.value)}
              rows={3}
              disabled={busy}
              placeholder={EXAMPLES[0]}
              className="w-full rounded-xl border border-white/10 bg-white/[0.03] p-3 text-[13px] leading-relaxed text-white/85 outline-none placeholder:text-white/20 focus:border-accent-500/40 disabled:opacity-50"
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {EXAMPLES.slice(1).map((example) => (
                <button
                  key={example}
                  type="button"
                  disabled={busy}
                  onClick={() => onIntent(example)}
                  className="rounded-full border border-white/8 px-2.5 py-1 text-[11px] text-white/35 transition-colors hover:border-accent-500/30 hover:text-accent-300 disabled:opacity-30"
                >
                  {example}
                </button>
              ))}
            </div>

            <div className="mt-6 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="rounded-lg border border-white/10 px-4 py-2.5 text-[10px] font-black uppercase tracking-[0.2em] text-white/45 transition-colors hover:bg-white/5 hover:text-white disabled:opacity-30"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onRun}
                disabled={busy}
                className="flex items-center gap-2 rounded-lg bg-accent-500 px-4 py-2.5 text-[10px] font-black uppercase tracking-[0.2em] text-on-accent transition-colors hover:bg-accent-400 disabled:opacity-50"
              >
                {busy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                {busy ? 'Planning' : 'Plan the dashboard'}
              </button>
            </div>
          </>
        )}

        {result && (
          <>
            {planned > 0 ? (
              <p className="mb-4 text-[13px] leading-relaxed text-white/70">
                The model planned {planned} {planned === 1 ? 'chart' : 'charts'}, and every one of them ran
                here against your rows. The dashboard you had is not lost.
              </p>
            ) : (
              <p className="mb-4 text-[13px] leading-relaxed text-amber-200/80">
                {result.reason || 'Nothing could be planned for this table.'}
              </p>
            )}

            {/* What it proposed and this app would not run. Shown rather than
                swallowed: a refusal is the guard working, and a reader deciding
                whether to trust this pass should see how often it fires. */}
            {result.rejected?.length > 0 && (
              <div className="mb-4 rounded-xl border border-white/8 bg-white/[0.02] p-3">
                <div className="label mb-1.5">Not run ({result.rejected.length})</div>
                <ul className="space-y-1">
                  {result.rejected.slice(0, 4).map((line) => (
                    <li key={line} className="text-[12px] leading-relaxed text-white/40">
                      {line}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex items-center justify-end gap-2">
              {result.replaced?.length > 0 && (
                <button
                  type="button"
                  onClick={() => onRestore(result.replaced)}
                  className="flex items-center gap-2 rounded-lg border border-white/10 px-4 py-2.5 text-[10px] font-black uppercase tracking-[0.2em] text-white/45 transition-colors hover:bg-white/5 hover:text-white"
                >
                  <Undo2 size={13} /> Put the old one back
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg bg-accent-500 px-4 py-2.5 text-[10px] font-black uppercase tracking-[0.2em] text-on-accent transition-colors hover:bg-accent-400"
              >
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
