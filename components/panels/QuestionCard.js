'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, Loader2, MessageSquarePlus, Plus, Sparkles, X } from 'lucide-react';

import { useActions, useDataset, useMeasures } from '../../lib/store/DatasetProvider';
import { planQuestion } from '../../lib/questionPlanner';

/**
 * "What do you want to know?" — the step between a cleaned table and a report.
 *
 * Phase 3 of docs/design/question-first-reports.md. A report is built from the
 * questions ticked here, compiled by lib/questionCompiler.js; the ones the
 * catalogue recommends arrive ticked, so building straight away is one click,
 * and "Choose for me" skips the card with that same set.
 *
 * Multiple choice rather than a text box, because a reader recognises the
 * question they came with far faster than they can phrase it — and one of the
 * options can still be "something else", read offline by the Ask page's
 * planner and refused by name when it names something the table does not have.
 *
 * The line on top says what one row was read as. A table read wrongly is
 * caught there, before any chart exists, rather than on slide four.
 *
 * @param {object}   props
 * @param {object[]} [props.initial]  questions already chosen (Change questions)
 * @param {(questions: object[]) => void} props.onBuild
 * @param {(questions: object[]) => void} [props.onSkip]  build with the pre-ticked set
 * @param {() => void} [props.onCancel]
 */
export default function QuestionCard({ initial = null, onBuild, onSkip, onCancel }) {
  const { suggestQuestions } = useActions();
  const { dataset } = useDataset();
  const measures = useMeasures();
  const [state, setState] = useState({ loading: true, error: null, questions: [], grain: null, rowCount: 0 });
  const [chosen, setChosen] = useState(() => new Set());
  const [custom, setCustom] = useState([]);
  const [draft, setDraft] = useState('');
  const [draftError, setDraftError] = useState(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    suggestQuestions()
      .then((found) => {
        if (cancelled) return;
        const questions = found?.questions || [];
        setState({
          loading: false,
          error: null,
          questions,
          grain: found?.grain || null,
          rowCount: found?.rowCount || 0,
          fromModel: !!found?.fromModel,
          subject: found?.subject || null,
        });
        // Reopened on a report: what it answers. Otherwise: what is recommended.
        const earlier = (initial || []).filter((q) => q.intent === 'custom');
        setCustom(earlier);
        const ids = initial?.length ? initial.map((q) => q.id) : questions.filter((q) => q.recommended).map((q) => q.id);
        setChosen(new Set(ids));
      })
      .catch((e) => {
        if (!cancelled) setState((s) => ({ ...s, loading: false, error: e?.message || 'Could not read the table.' }));
      });
    return () => {
      cancelled = true;
    };
    // Asked once per opening; the table does not change under an open card.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const options = useMemo(() => [...state.questions, ...custom], [state.questions, custom]);
  const visible = showAll ? options : options.filter((q, i) => i < 8 || chosen.has(q.id) || q.intent === 'custom');
  const picked = options.filter((q) => chosen.has(q.id));

  const toggle = (id) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // A question in the reader's own words, read now so a question the table
  // cannot answer is refused while they are still looking at it.
  const addCustom = () => {
    const text = draft.trim();
    if (!text) return;
    const read = planQuestion(text, {
      columns: dataset?.columns || [],
      profile: dataset?.profile,
      sample: dataset?.preview || [],
      measures: measures || [],
    });
    if (!read.spec) {
      setDraftError(read.error || 'That could not be read into a chart.');
      return;
    }
    const q = { id: `custom|${text}`, intent: 'custom', text, spec: read.spec };
    setCustom((prev) => [...prev.filter((c) => c.id !== q.id), q]);
    setChosen((prev) => new Set([...prev, q.id]));
    setDraft('');
    setDraftError(null);
  };

  return (
    <div className="card p-5" data-testid="question-card">
      <div className="mb-1 flex items-center gap-2">
        <Sparkles size={15} className="text-accent-400" />
        <span className="text-sm font-black text-white/90">What do you want to know?</span>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close"
            className="ml-auto rounded-lg p-1 text-white/30 transition-colors hover:bg-white/5 hover:text-white"
          >
            <X size={15} />
          </button>
        )}
      </div>
      {state.grain && (
        <p className="mb-4 text-[12px] leading-relaxed text-white/45">
          Read as: {state.subject || state.grain.why} · {state.rowCount.toLocaleString()} rows. Every chart answers one of the questions you tick.
          {state.fromModel && ' A model read the table and chose the ticked questions; every one was checked against your rows first.'}
        </p>
      )}

      {state.loading && (
        <div className="flex items-center gap-2 py-6 text-[13px] text-white/50">
          <Loader2 size={15} className="animate-spin" /> Reading what this table can answer…
        </div>
      )}
      {state.error && <p className="py-3 text-[13px] text-rose-300">{state.error}</p>}

      {!state.loading && !state.error && (
        <>
          {options.length === 0 && (
            <p className="py-3 text-[13px] text-white/50">
              Nothing here has an obvious question to ask. Write your own below, or build the dashboard by hand.
            </p>
          )}
          <ul className="flex flex-col gap-1.5" role="group" aria-label="Questions">
            {visible.map((q) => {
              const on = chosen.has(q.id);
              return (
                <li key={q.id}>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    onClick={() => toggle(q.id)}
                    className={`flex w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                      on ? 'border-accent-500/40 bg-accent-500/[0.07]' : 'border-white/8 hover:border-white/15 hover:bg-white/[0.03]'
                    }`}
                  >
                    <span
                      className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                        on ? 'border-accent-400 bg-accent-500 text-on-accent' : 'border-white/25'
                      }`}
                    >
                      {on && <Check size={11} strokeWidth={3.5} />}
                    </span>
                    <span className="min-w-0 flex-1 text-[13px] leading-snug text-white/80">
                      {q.text}
                      {q.source === 'model' && (
                        <span className="ml-2 text-[10px] font-bold uppercase tracking-[0.12em] text-accent-300/90">Model</span>
                      )}
                      {q.recommended && !initial?.length && (
                        <span className="ml-2 text-[10px] font-bold uppercase tracking-[0.12em] text-accent-400/80">Recommended</span>
                      )}
                      {q.intent === 'custom' && (
                        <span className="ml-2 text-[10px] font-bold uppercase tracking-[0.12em] text-white/35">Yours</span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {!showAll && options.length > visible.length && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="mt-2 text-[12px] font-bold text-accent-300 hover:text-accent-200"
            >
              Show all {options.length} questions
            </button>
          )}

          <div className="mt-4">
            <label htmlFor="own-question" className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-white/40">
              <MessageSquarePlus size={12} /> Something else
            </label>
            <div className="flex gap-2">
              <input
                id="own-question"
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  setDraftError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addCustom();
                  }
                }}
                placeholder="e.g. average price by region"
                className="min-w-0 flex-1 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-[13px] text-white/85 placeholder:text-white/25 focus:border-accent-500/50 focus:outline-none"
              />
              <button
                type="button"
                onClick={addCustom}
                disabled={!draft.trim()}
                className="flex items-center gap-1 rounded-lg border border-white/10 px-3 py-2 text-[12px] font-bold text-white/60 transition-colors hover:bg-white/5 hover:text-white disabled:opacity-40"
              >
                <Plus size={13} /> Add
              </button>
            </div>
            {draftError && <p className="mt-1.5 text-[12px] leading-relaxed text-amber-300/90">{draftError}</p>}
          </div>
        </>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onBuild(picked)}
          disabled={state.loading || picked.length === 0}
          className="flex items-center gap-2 rounded-xl bg-accent-500 px-4 py-2.5 text-xs font-black uppercase tracking-[0.15em] text-on-accent transition-transform hover:bg-accent-400 active:scale-[0.99] disabled:opacity-40"
        >
          Build the report{picked.length ? ` · ${picked.length}` : ''}
        </button>
        {onSkip && (
          <button
            type="button"
            // The pre-ticked set, whoever ticked it — the model's picks when
            // a model answered, the catalogue's otherwise.
            onClick={() => onSkip(state.questions.filter((q) => q.recommended))}
            className="rounded-xl border border-white/10 px-4 py-2.5 text-xs font-bold uppercase tracking-[0.15em] text-white/50 transition-colors hover:bg-white/5 hover:text-white"
          >
            Choose for me
          </button>
        )}
      </div>
    </div>
  );
}
