'use client';

/**
 * What the analysis says, as against what it shows.
 *
 * The dashboard used to carry both: a wall of prose and a scorecard above the
 * board, so the page somebody opened to look at their charts opened on six
 * paragraphs about them instead. They are different things read at different
 * moments — a board is scanned and this is read — and once the board became an
 * arrangement the difference turned structural: a summary pinned above a canvas
 * is a summary in the way of it.
 *
 * So the words are here and the board is there. Both are still one analysis,
 * both are edited in place, and the deck still opens with this and closes with
 * that.
 */
import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ChevronDown,
  HelpCircle,
  Info,
  LayoutDashboard,
  Pencil,
  Plus,
  Sparkles,
  Target,
  TrendingUp,
  Trash2,
} from 'lucide-react';
import { useActions, useAnalysis, useDataset } from '../../../lib/store/DatasetProvider';
import PageFrame from '../../../components/shell/PageFrame';
import Collapse from '../../../components/shell/Collapse';
import EditableText from '../../../components/panels/EditableText';
import NarrationNote from '../../../components/panels/NarrationNote';
import { cleanFloatingPoints } from '../../../lib/dataCleaner';

export default function SummaryPage() {
  const { dataset } = useDataset();
  const { analysis } = useAnalysis();
  const { editSummary } = useActions();
  const [editing, setEditing] = useState(false);
  const [showSummary, setShowSummary] = useState(true);
  const [showNotes, setShowNotes] = useState(false);

  const notes = useMemo(() => {
    const fold = (items, key) => {
      const seen = new Map();
      for (const item of items || []) {
        const text = key(item);
        if (!text) continue;
        const at = seen.get(text);
        if (at) at.count += 1;
        else seen.set(text, { ...item, text, count: 1 });
      }
      return [...seen.values()];
    };
    const questions = fold(analysis?.critique, (q) => q?.question);
    const edits = fold(analysis?.analystEdits, (e) => {
      const what = describeEdit(e);
      return e?.why ? `${what} — ${e.why}` : what;
    });
    return { questions, edits, total: questions.length + edits.length };
  }, [analysis?.critique, analysis?.analystEdits]);


  const summary = analysis?.slideZero;

  // Bullets are edited as a list: rewriting one, dropping one and adding one are
  // all the same commit of a new array.
  const setInsight = useCallback(
    (index, text) => {
      const list = [...(summary?.macroInsights || [])];
      list[index] = text;
      editSummary({ macroInsights: list });
    },
    [editSummary, summary]
  );

  const removeInsight = useCallback(
    (index) => {
      editSummary({ macroInsights: (summary?.macroInsights || []).filter((_, i) => i !== index) });
    },
    [editSummary, summary]
  );

  const addInsight = useCallback(() => {
    editSummary({ macroInsights: [...(summary?.macroInsights || []), ''] });
  }, [editSummary, summary]);

  if (!analysis || !summary) {
    return (
      <PageFrame title="Summary" subtitle="What the analysis says.">
        <div className="card flex flex-col items-start gap-4 p-8">
          <p className="text-[13px] leading-relaxed text-white/45">
            Nothing has been analysed yet, so there is nothing to summarise — the summary is written when the
            dashboard is built.
          </p>
          <Link
            href="/dashboard"
            className="flex items-center gap-2 rounded-xl bg-accent-500 px-4 py-2.5 text-[10px] font-black uppercase tracking-[0.2em] text-on-accent transition-colors hover:bg-accent-400"
          >
            <LayoutDashboard size={13} /> Go to the dashboard
          </Link>
        </div>
      </PageFrame>
    );
  }

  return (
    <PageFrame
      title="Summary"
      subtitle={`What the analysis says about ${dataset?.fileName || 'this data'}.`}
      action={
        <button
          onClick={() => setEditing((v) => !v)}
          aria-pressed={editing}
          className={`flex min-h-11 items-center gap-2 rounded-lg border px-3 py-2 text-[10px] font-black uppercase tracking-[0.2em] transition-colors sm:min-h-0 ${
            editing
              ? 'border-accent-500/40 bg-accent-500/10 text-accent-300'
              : 'border-white/10 text-white/45 hover:bg-white/5 hover:text-white'
          }`}
        >
          {editing ? 'Done' : 'Edit'}
        </button>
      }
    >

  {/* Executive summary.
      Dimmed while a filter is on, and labelled. Every sentence in it was
      written about the whole table: the figures under the charts are
      recomputed on a filter because they are readings of a result set, and
      these are not — they are prose, and prose cannot be recomputed. Saying
      so is the only honest thing left to do with it. */}
  <section
    className={`mb-8 transition-opacity ${analysis.filter ? 'opacity-45' : ''}`}
    data-tutorial="dashboard-summary"
  >
    <div className="mb-3 flex items-center gap-3">
      <Sparkles size={14} className="text-accent-400" />
      <EditableText
        as="h2"
        editing={editing}
        value={summary.title}
        onCommit={(text) => editSummary({ title: text })}
        ariaLabel="Summary title"
        placeholder="Executive summary"
        className="label"
      />
      {analysis.filter && (
        <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.15em] text-amber-300/80">
          Written for all {(dataset.rowCount || 0).toLocaleString()} rows
        </span>
      )}
      <div className="h-px flex-1 bg-gradient-to-r from-white/10 to-transparent" />
      <Collapse open={showSummary} onToggle={() => setShowSummary((v) => !v)} label="executive summary" />
    </div>

    {showSummary && (
    <>

    {/* The opening line — what an analyst says before the bullets. */}
    {(summary.headline || editing) && (
      <EditableText
        as="p"
        editing={editing}
        value={summary.headline}
        display={cleanFloatingPoints(summary.headline)}
        onCommit={(text) => editSummary({ headline: text })}
        ariaLabel="Opening line"
        placeholder="One sentence: the thing you would say first."
        multiline
        rows={2}
        className="mb-4 max-w-4xl text-[17px] font-medium leading-relaxed text-white/85"
      />
    )}

    <div className="grid gap-4 lg:grid-cols-3">
      <div className="card p-6 lg:col-span-2">
        <ul className="flex flex-col gap-4">
          {summary.macroInsights.map((line, i) => (
            <li key={i} className="flex gap-3">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-500" />
              <EditableText
                as="p"
                editing={editing}
                value={line}
                display={cleanFloatingPoints(line)}
                onCommit={(text) => setInsight(i, text)}
                ariaLabel={`Takeaway ${i + 1}`}
                placeholder="What is true, and what follows from it."
                multiline
                rows={2}
                className="text-[15px] leading-relaxed text-white/75"
              />
              {editing && (
                <button
                  type="button"
                  aria-label={`Delete takeaway ${i + 1}`}
                  title="Delete this takeaway"
                  onClick={() => removeInsight(i)}
                  className="mt-0.5 shrink-0 rounded-lg p-1.5 text-white/20 transition-colors hover:bg-rose-500/10 hover:text-rose-400"
                >
                  <Trash2 size={13} />
                </button>
              )}
            </li>
          ))}
        </ul>

        {editing && (
          <button
            type="button"
            onClick={addInsight}
            className="mt-4 flex items-center gap-2 rounded-lg border border-white/10 min-h-11 px-3 py-2 text-[10px] font-black uppercase tracking-[0.2em] sm:min-h-0 text-white/45 transition-colors hover:bg-white/5 hover:text-white"
          >
            <Plus size={13} /> Add a takeaway
          </button>
        )}

        {/* How to read the numbers above. Computed from what the queries
            actually did, not written by anyone, and deliberately not
            editable: a share of the top ten rows does not become a share of
            the business because the wording was tidied up. */}
        {summary.caveats?.length > 0 && (
          <ul className="mt-5 flex flex-col gap-1.5 border-t border-white/8 pt-4">
            {summary.caveats.map((line, i) => (
              <li key={i} className="flex gap-2 text-[12px] leading-relaxed text-white/40">
                <Info size={12} className="mt-0.5 shrink-0 text-amber-400/70" />
                {line}
              </li>
            ))}
          </ul>
        )}

        {/*
          * What the deck does not say, and what was repaired before anyone
          * saw it — behind one line.
          *
          * Both lists are worth keeping and neither is a finding. They used
          * to sit open at the foot of the executive summary, so the last
          * thing a reader saw was four questions the analysis could not
          * answer and four notes about slides it had edited. That is our
          * working, and a reader is owed the ability to see it rather than
          * the obligation to read it.
          */}
        {notes.total > 0 && (
          <div className="mt-5 border-t border-white/8 pt-4">
            <button
              type="button"
              onClick={() => setShowNotes((v) => !v)}
              aria-expanded={showNotes}
              className="flex w-full items-center gap-2 text-left text-[11px] text-white/30 transition-colors hover:text-white/55"
            >
              <HelpCircle size={12} className="shrink-0" />
              <span className="font-semibold">How this deck was checked</span>
              <span className="text-white/25">
                {notes.questions.length > 0 &&
                  `${notes.questions.length} open question${notes.questions.length === 1 ? '' : 's'}`}
                {notes.questions.length > 0 && notes.edits.length > 0 && ' · '}
                {notes.edits.length > 0 && `${notes.edits.length} edit${notes.edits.length === 1 ? '' : 's'}`}
              </span>
              <ChevronDown
                size={13}
                className={`ml-auto shrink-0 transition-transform ${showNotes ? 'rotate-180' : ''}`}
              />
            </button>

            {showNotes && (
              <div className="mt-4 flex flex-col gap-5">
                {notes.questions.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="label">Open questions</span>
                      <span className="text-[10px] text-white/20">nothing here is a finding</span>
                    </div>
                    <ul className="mt-2.5 flex flex-col gap-2">
                      {notes.questions.map((q) => (
                        <li key={q.text} className="flex gap-2 text-[12px] leading-relaxed text-white/40">
                          {/* Which questions were found in the data and which
                              were thought up about it. Both are questions and
                              neither is a finding, but a reader is owed the
                              difference: one was measured, the other was
                              imagined by a model shown no numbers. */}
                          {q.source === 'model' && (
                            <span
                              title="Suggested by a language model, which was shown the column names and no values"
                              className="mt-[3px] shrink-0 rounded border border-white/10 px-1 text-[8px] font-bold uppercase tracking-[0.15em] text-white/25"
                            >
                              AI
                            </span>
                          )}
                          <span>{q.text}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {notes.edits.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="label">Edits made</span>
                      <span className="text-[10px] text-white/20">before you saw it — no number changed</span>
                    </div>
                    <ul className="mt-2.5 flex flex-col gap-2">
                      {notes.edits.map((e) => (
                        <li key={e.text} className="flex gap-2 text-[12px] leading-relaxed text-white/40">
                          {/* Which fixes were measured and which were written.
                              A donut of two slices is arithmetic; a shorter
                              heading is a judgement, and a reader deciding how
                              much to trust a change is owed the difference. */}
                          <span
                            title={
                              e.source === 'audit'
                                ? 'Found and fixed by a deterministic check — no model involved'
                                : "Made by a language model, which was shown the deck's structure and no values"
                            }
                            className="mt-[3px] shrink-0 rounded border border-white/10 px-1 text-[8px] font-bold uppercase tracking-[0.15em] text-white/25"
                          >
                            {e.source === 'audit' ? 'CHECK' : 'AI'}
                          </span>
                          <span className="text-white/45">
                            {e.text}
                            {e.count > 1 && (
                              <span className="ml-1.5 text-white/25">×{e.count}</span>
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <Scorecard
          icon={Target}
          tone="accent"
          label="Focus"
          text={summary.strategicScorecard.focus}
          editing={editing}
          onCommit={(text) => editSummary({ strategicScorecard: { focus: text } })}
        />
        <Scorecard
          icon={AlertTriangle}
          tone="rose"
          label="Risk"
          text={summary.strategicScorecard.risk}
          editing={editing}
          onCommit={(text) => editSummary({ strategicScorecard: { risk: text } })}
        />
        <Scorecard
          icon={TrendingUp}
          tone="emerald"
          label="Opportunity"
          text={summary.strategicScorecard.opportunity}
          editing={editing}
          onCommit={(text) => editSummary({ strategicScorecard: { opportunity: text } })}
        />
      </div>
    </div>
    </>
    )}
  </section>

      <NarrationNote narrated={analysis.narrated} className="mt-8" />
    </PageFrame>
  );
}

function Scorecard({ icon: Icon, tone, label, text, editing, onCommit }) {
  // The engine leaves a card empty when the data gives it nothing to say. An
  // empty card is dropped rather than shown as a dash — except while editing,
  // where it is the only way to write one yourself.
  if (!editing && !String(text || '').trim()) return null;

  const tones = {
    accent: 'border-accent-500/20 bg-accent-500/6 text-accent-400',
    rose: 'border-rose-500/20 bg-rose-500/6 text-rose-400',
    emerald: 'border-emerald-500/20 bg-emerald-500/6 text-emerald-400',
  };
  return (
    <div className={`rounded-2xl border p-4 ${tones[tone]}`}>
      <div className="flex items-center gap-2">
        <Icon size={14} />
        <span className="text-[9px] font-black uppercase tracking-[0.25em]">{label}</span>
      </div>
      <EditableText
        as="p"
        editing={editing}
        value={text}
        display={cleanFloatingPoints(text) || '—'}
        onCommit={onCommit}
        ariaLabel={label}
        placeholder={`What would you put under ${label.toLowerCase()}?`}
        multiline
        rows={3}
        className="mt-2 text-[13px] font-medium leading-relaxed text-white/80"
      />
    </div>
  );
}

function describeEdit(edit) {
  if (edit.op === 'retitle') return `Renamed a chart to "${edit.title}"`;
  if (edit.op === 'chart_type') return `Redrawn as a ${edit.chart_type} chart`;
  if (edit.op === 'colorBy') return 'Dropped one colour per bar';
  if (edit.op === 'remove_kpi') return 'Removed a repeated card';
  if (edit.op === 'set_text') return 'Replaced a repeated recommendation with a pointer';
  if (edit.op === 'clear_text') return 'Removed a claim its own numbers did not support';
  if (edit.op === 'reorder') return 'Reordered the deck';
  return 'Edited';
}
