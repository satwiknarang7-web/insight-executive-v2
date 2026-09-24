'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Loader2, Sparkles, X } from 'lucide-react';

import { useActions, useDataset, useMeasures } from '../../lib/store/DatasetProvider';
import { planQuestion } from '../../lib/questionPlanner';
import { answeredQuestions, buildQuestionnaire, preferredAnswers } from '../../lib/questionnaire';

const LETTERS = ['A', 'B', 'C'];

/**
 * "A few questions about your data" — the step between a cleaned table and a
 * report.
 *
 * Phase 3 of docs/design/question-first-reports.md, asked as a short
 * questionnaire (lib/questionnaire.js): five to ten multiple-choice questions
 * about this table, one at a time, each with three answers drawn from what the
 * rows can answer and a fourth, "Other", in the reader's own words. Each answer
 * is one question the report is built from, compiled by
 * lib/questionCompiler.js. "Choose for me" answers them all with the
 * recommended choice.
 *
 * "Other" is read offline by the Ask page's planner as it is typed in, and
 * refused by name when it names something the table does not have — while the
 * reader is still on that question.
 *
 * The line on top says what one row was read as. A table read wrongly is
 * caught there, before any chart exists, rather than on slide four.
 *
 * @param {object}   props
 * @param {object[]} [props.initial]  questions already chosen (Change questions)
 * @param {(questions: object[]) => void} props.onBuild
 * @param {(questions: object[]) => void} [props.onSkip]  build with the recommended answers
 * @param {() => void} [props.onCancel]
 */
export default function QuestionCard({ initial = null, onBuild, onSkip, onCancel }) {
  const { suggestQuestions } = useActions();
  const { dataset } = useDataset();
  const measures = useMeasures();
  const [state, setState] = useState({ loading: true, error: null, questions: [], grain: null, rowCount: 0 });
  const [answers, setAnswers] = useState({});
  const [drafts, setDrafts] = useState({});
  const [draftError, setDraftError] = useState(null);
  const [step, setStep] = useState(0);
  const [kept, setKept] = useState([]);

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
        // Reopened on a report: the answers that built it. Questions of the
        // reader's own are kept alongside.
        if (initial?.length) {
          const ids = new Set(initial.map((q) => q.id));
          const restored = {};
          for (const mcq of buildQuestionnaire(questions)) {
            const hit = mcq.options.find((o) => ids.has(o.id));
            if (hit) restored[mcq.id] = { choice: hit.id };
          }
          setAnswers(restored);
          setKept(initial.filter((q) => q.intent === 'custom'));
        }
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

  const questionnaire = useMemo(() => buildQuestionnaire(state.questions), [state.questions]);
  const total = questionnaire.length;
  const mcq = questionnaire[step] || null;
  const answer = mcq ? answers[mcq.id] : null;
  const last = step >= total - 1;
  const picked = [...answeredQuestions(questionnaire, answers), ...kept];

  const choose = (choice) => {
    if (!mcq) return;
    setDraftError(null);
    setAnswers((prev) => {
      // Choosing the chosen answer again clears it: the question is skipped.
      if (prev[mcq.id]?.choice === choice && choice !== 'other') {
        const next = { ...prev };
        delete next[mcq.id];
        return next;
      }
      return { ...prev, [mcq.id]: { choice } };
    });
  };

  // "Other", read into a question now so one the table cannot answer is
  // refused while the reader is still looking at it.
  const readOther = () => {
    const text = (drafts[mcq.id] || '').trim();
    if (!text) {
      setDraftError('Write what you want to know, or pick one of the answers above.');
      return false;
    }
    const read = planQuestion(text, {
      columns: dataset?.columns || [],
      profile: dataset?.profile,
      sample: dataset?.preview || [],
      measures: measures || [],
    });
    if (!read.spec) {
      setDraftError(read.error || 'That could not be read into a chart.');
      return false;
    }
    const question = { id: `custom|${text}`, intent: 'custom', text, spec: read.spec };
    setAnswers((prev) => ({ ...prev, [mcq.id]: { choice: 'other', question } }));
    setDraftError(null);
    return question;
  };

  const next = () => {
    if (answer?.choice === 'other') {
      const question = readOther();
      if (!question) return;
      if (last) {
        const withOther = { ...answers, [mcq.id]: { choice: 'other', question } };
        onBuild([...answeredQuestions(questionnaire, withOther), ...kept]);
        return;
      }
    } else if (last) {
      onBuild(picked);
      return;
    }
    setStep((s) => Math.min(s + 1, total - 1));
  };

  const skip = () => {
    if (!mcq) return;
    setAnswers((prev) => {
      const nextAnswers = { ...prev };
      delete nextAnswers[mcq.id];
      return nextAnswers;
    });
    setDraftError(null);
    if (!last) setStep((s) => s + 1);
  };

  const back = () => {
    setDraftError(null);
    setStep((s) => Math.max(0, s - 1));
  };

  const optionClass = (on) =>
    `flex w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${
      on ? 'border-accent-500/40 bg-accent-500/[0.07]' : 'border-white/8 hover:border-white/15 hover:bg-white/[0.03]'
    }`;
  const letterClass = (on) =>
    `mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-[10px] font-black ${
      on ? 'border-accent-400 bg-accent-500 text-on-accent' : 'border-white/25 text-white/45'
    }`;

  return (
    <div className="card p-5" data-testid="question-card">
      <div className="mb-1 flex items-center gap-2">
        <Sparkles size={15} className="text-accent-400" />
        <span className="text-sm font-black text-white/90">A few questions about your data</span>
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
          Read as: {state.subject || state.grain.why} · {state.rowCount.toLocaleString()} rows. Each answer becomes a chart in the report.
          {state.fromModel && ' A model wrote these choices from your table; every one was checked against your rows first.'}
        </p>
      )}

      {state.loading && (
        <div className="flex items-center gap-2 py-6 text-[13px] text-white/50">
          <Loader2 size={15} className="animate-spin" /> Reading what this table can answer…
        </div>
      )}
      {state.error && <p className="py-3 text-[13px] text-rose-300">{state.error}</p>}

      {!state.loading && !state.error && total === 0 && (
        <p className="py-3 text-[13px] text-white/50">
          Nothing here has an obvious question to ask. Build the dashboard by hand, or ask on the Ask page.
        </p>
      )}

      {!state.loading && !state.error && mcq && (
        <>
          <div className="mb-2 flex items-center gap-3">
            <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-white/40" data-testid="question-progress">
              Question {step + 1} of {total}
            </span>
            <div className="flex flex-1 gap-1" aria-hidden="true">
              {questionnaire.map((q, i) => (
                <span
                  key={q.id}
                  className={`h-1 flex-1 rounded-full ${i === step ? 'bg-accent-400' : answers[q.id] ? 'bg-accent-500/40' : 'bg-white/10'}`}
                />
              ))}
            </div>
          </div>
          <p className="mb-3 text-[14px] font-bold leading-snug text-white/90" id={`stem-${step}`}>
            {mcq.stem}
          </p>

          <div className="flex flex-col gap-1.5" role="radiogroup" aria-labelledby={`stem-${step}`}>
            {mcq.options.map((q, i) => {
              const on = answer?.choice === q.id;
              return (
                <button key={q.id} type="button" role="radio" aria-checked={on} onClick={() => choose(q.id)} className={optionClass(on)}>
                  <span className={letterClass(on)}>{LETTERS[i]}</span>
                  <span className="min-w-0 flex-1 text-[13px] leading-snug text-white/80">
                    {q.text}
                    {q.id === mcq.preferred && !initial?.length && (
                      <span className="ml-2 text-[10px] font-bold uppercase tracking-[0.12em] text-accent-400/80">Recommended</span>
                    )}
                  </span>
                </button>
              );
            })}
            <button
              type="button"
              role="radio"
              aria-checked={answer?.choice === 'other'}
              onClick={() => choose('other')}
              className={optionClass(answer?.choice === 'other')}
            >
              <span className={letterClass(answer?.choice === 'other')}>{LETTERS[mcq.options.length] || 'D'}</span>
              <span className="min-w-0 flex-1 text-[13px] leading-snug text-white/80">Other — tell us exactly what you want</span>
            </button>
          </div>

          {answer?.choice === 'other' && (
            <div className="mt-2">
              <input
                aria-label="Your own question"
                autoFocus
                value={drafts[mcq.id] || ''}
                onChange={(e) => {
                  const value = e.target.value;
                  setDrafts((prev) => ({ ...prev, [mcq.id]: value }));
                  setDraftError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    next();
                  }
                }}
                placeholder="e.g. average price by region"
                className="w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-[13px] text-white/85 placeholder:text-white/25 focus:border-accent-500/50 focus:outline-none"
              />
              {draftError && <p className="mt-1.5 text-[12px] leading-relaxed text-amber-300/90">{draftError}</p>}
            </div>
          )}

          {last && kept.length > 0 && (
            <div className="mt-4">
              <p className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-white/40">Also kept from before</p>
              <ul className="flex flex-col gap-1">
                {kept.map((q) => (
                  <li key={q.id} className="flex items-center gap-2 text-[12px] text-white/65">
                    <span className="min-w-0 flex-1">{q.text}</span>
                    <button
                      type="button"
                      aria-label={`Remove ${q.text}`}
                      onClick={() => setKept((prev) => prev.filter((c) => c.id !== q.id))}
                      className="rounded p-0.5 text-white/30 hover:bg-white/5 hover:text-white"
                    >
                      <X size={12} />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {mcq && step > 0 && (
          <button
            type="button"
            onClick={back}
            className="flex items-center gap-1 rounded-xl border border-white/10 px-3 py-2.5 text-xs font-bold uppercase tracking-[0.15em] text-white/50 transition-colors hover:bg-white/5 hover:text-white"
          >
            <ArrowLeft size={13} /> Back
          </button>
        )}
        {mcq && (
          <button
            type="button"
            onClick={next}
            disabled={last && !answer && picked.length === 0}
            className="flex items-center gap-2 rounded-xl bg-accent-500 px-4 py-2.5 text-xs font-black uppercase tracking-[0.15em] text-on-accent transition-transform hover:bg-accent-400 active:scale-[0.99] disabled:opacity-40"
          >
            {last ? `Build the report${picked.length ? ` · ${picked.length}` : ''}` : (
              <>
                Next <ArrowRight size={13} />
              </>
            )}
          </button>
        )}
        {mcq && !last && (
          <button
            type="button"
            onClick={skip}
            className="rounded-xl px-3 py-2.5 text-xs font-bold uppercase tracking-[0.15em] text-white/40 transition-colors hover:text-white"
          >
            Skip
          </button>
        )}
        {onSkip && !state.loading && (
          <button
            type="button"
            // The recommended answer to every question, whoever wrote the
            // choices — the model's when a model answered, the catalogue's
            // otherwise.
            onClick={() => onSkip(answeredQuestions(questionnaire, preferredAnswers(questionnaire)))}
            className="ml-auto rounded-xl border border-white/10 px-4 py-2.5 text-xs font-bold uppercase tracking-[0.15em] text-white/50 transition-colors hover:bg-white/5 hover:text-white"
          >
            Choose for me
          </button>
        )}
      </div>
    </div>
  );
}
