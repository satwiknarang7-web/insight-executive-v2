'use client';

import { useCallback, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  Code2,
  Loader2,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  Wand2,
  X,
} from 'lucide-react';
import { useActions, useDataset, useMeasures } from '../../lib/store/DatasetProvider';
import { usePlan } from '../../lib/store/PlanProvider';
import {
  BLANKS,
  BUCKET,
  CONDITIONAL,
  DATEPART,
  DATE_PARTS,
  DEDUPE,
  DERIVE,
  DROP,
  FILL,
  FILTER,
  GROUP,
  GROUP_FUNCTIONS,
  INDEX,
  KEEP,
  LIMIT,
  MERGE,
  PIVOT,
  RENAME,
  REPLACE,
  RETYPE,
  RETYPE_TARGETS,
  SORT,
  SPLIT,
  TEXT,
  TEXT_OPS,
  UNPIVOT,
  describeTransform,
  planTransforms,
  validateTransform,
} from '../../lib/transforms';
import { exampleTransformPhrases } from '../../lib/transformLanguage';
import { FUNCTION_NAMES } from '../../lib/engineFunctions';

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
 * Three ways in. A form, one per kind of step, for people who know what they
 * want. A sentence, for people who know what they want and not what it is
 * called — read by a parser first and a model second. And the analyst's own
 * suggestions, each with its reason, for the steps a person would not have
 * thought to ask for.
 *
 * Steps are staged and applied together rather than one at a time. They refer
 * to each other, so a half-applied list is a list in a state its author never
 * asked for; and rebuilding the view costs a pass over every row, which is not
 * something to spend on each keystroke.
 */

const GROUPS = [
  {
    label: 'Columns',
    kinds: [
      { id: DERIVE, label: 'Add a column (formula)' },
      { id: CONDITIONAL, label: 'Add a conditional column' },
      { id: BUCKET, label: 'Band a number into ranges' },
      { id: DATEPART, label: 'Extract part of a date' },
      { id: SPLIT, label: 'Split a column' },
      { id: MERGE, label: 'Combine columns' },
      { id: RENAME, label: 'Rename' },
      { id: RETYPE, label: 'Change type' },
      { id: KEEP, label: 'Keep only some columns' },
      { id: DROP, label: 'Drop a column' },
      { id: INDEX, label: 'Add a row number' },
    ],
  },
  {
    label: 'Values',
    kinds: [
      { id: TEXT, label: 'Tidy text (trim, case)' },
      { id: REPLACE, label: 'Replace values' },
      { id: FILL, label: 'Fill blanks' },
    ],
  },
  {
    label: 'Rows',
    kinds: [
      { id: FILTER, label: 'Keep or remove rows where…' },
      { id: BLANKS, label: 'Remove blank rows' },
      { id: DEDUPE, label: 'Remove duplicates' },
      { id: SORT, label: 'Sort' },
      { id: LIMIT, label: 'Keep the top N rows' },
    ],
  },
  {
    label: 'Table',
    kinds: [
      { id: GROUP, label: 'Group by and summarise' },
      { id: UNPIVOT, label: 'Unpivot columns into rows' },
      { id: PIVOT, label: 'Pivot values into columns' },
    ],
  },
];

const titled = (s) =>
  String(s || '')
    .replace(/[_.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** A fresh draft for a kind, in the shape the editor holds it. */
function blank(kind, columns) {
  const first = columns[0] || '';
  switch (kind) {
    case DERIVE:
      return { kind, name: '', expr: '' };
    case CONDITIONAL:
      return { kind, name: 'Category', rules: [{ when: '', then: '' }], otherwise: '' };
    case BUCKET:
      return { kind, name: `${titled(first)} band`, column: first, edgesText: '', labelsText: '' };
    case DATEPART:
      return { kind, name: `${titled(first)} ${DATE_PARTS.year_month.suffix}`, column: first, part: 'year_month' };
    case SPLIT:
      return { kind, column: first, separator: ',', intoText: `${titled(first)} 1, ${titled(first)} 2`, dropOriginal: false };
    case MERGE:
      return { kind, name: 'Combined', columns: [], separator: ' ' };
    case RENAME:
      return { kind, column: first, to: '' };
    case RETYPE:
      return { kind, column: first, to: 'number' };
    case KEEP:
      return { kind, columns: [...columns] };
    case DROP:
      return { kind, column: first };
    case INDEX:
      return { kind, name: 'Row' };
    case TEXT:
      return { kind, column: first, op: 'trim' };
    case REPLACE:
      return { kind, column: first, find: '', replacement: '', mode: 'value' };
    case FILL:
      return { kind, column: first, value: '' };
    case FILTER:
      return { kind, mode: 'keep', expr: '' };
    case BLANKS:
      return { kind, columns: [] };
    case DEDUPE:
      return { kind, columns: [] };
    case SORT:
      return { kind, by: [{ column: first, direction: 'asc' }] };
    case LIMIT:
      return { kind, count: 100, by: '', direction: 'desc' };
    case GROUP:
      return { kind, by: [first], aggregates: [{ fn: 'COUNT', column: '', name: 'Rows' }] };
    case UNPIVOT:
      return { kind, columns: [], nameColumn: 'Attribute', valueColumn: 'Value' };
    case PIVOT:
      return { kind, column: first, measure: '', fn: 'SUM', valuesText: '' };
    default:
      return { kind };
  }
}

const splitList = (text) =>
  String(text || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/** The editor's draft as the step the engine plans. */
function toOp(draft) {
  const { editing, ...rest } = draft;
  void editing;
  switch (rest.kind) {
    case BUCKET: {
      const { edgesText, labelsText, ...op } = rest;
      const labels = splitList(labelsText);
      return { ...op, edges: splitList(edgesText).map(Number), ...(labels.length ? { labels } : {}) };
    }
    case SPLIT: {
      const { intoText, ...op } = rest;
      return { ...op, into: splitList(intoText) };
    }
    case PIVOT: {
      const { valuesText, ...op } = rest;
      return { ...op, values: splitList(valuesText) };
    }
    case LIMIT:
      return { ...rest, count: Number(rest.count), by: rest.by || undefined };
    case GROUP:
      return { ...rest, aggregates: (rest.aggregates || []).map((a) => ({ ...a, column: a.column || undefined })) };
    default:
      return rest;
  }
}

/** A saved step, back into the editor's shape. */
function toDraft(op, index) {
  const base = { ...op, editing: index };
  switch (op.kind) {
    case BUCKET:
      return { ...base, edgesText: (op.edges || []).join(', '), labelsText: (op.labels || []).join(', ') };
    case SPLIT:
      return { ...base, intoText: (op.into || []).join(', ') };
    case PIVOT:
      return { ...base, valuesText: (op.values || []).join(', ') };
    case LIMIT:
      return { ...base, by: op.by || '' };
    default:
      return base;
  }
}

const FIELD =
  'min-w-0 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-[12px] text-white/85 outline-none focus:border-accent-500/50';
const SMALL_BUTTON =
  'rounded border border-white/10 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.15em] text-white/45 transition-colors hover:bg-white/5 hover:text-white';

export default function TransformPanel() {
  const { dataset, preparation } = useDataset();
  const { setTransforms, draftTransform, suggestPreparation, saveMeasure } = useActions();
  const measures = useMeasures();
  const { can } = usePlan();

  const columns = useMemo(() => dataset?.columns || [], [dataset]);
  // The applied list is the dataset's; the staged list is what is being edited.
  const applied = useMemo(() => dataset?.transforms || [], [dataset]);
  const [steps, setSteps] = useState(null);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [showSql, setShowSql] = useState(false);

  // The sentence box.
  const [phrase, setPhrase] = useState('');
  const [reading, setReading] = useState(false);

  // The analyst's proposal, asked for from here.
  const [proposal, setProposal] = useState(null);
  const [suggesting, setSuggesting] = useState(false);
  const [notice, setNotice] = useState(null);

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
  const examples = useMemo(() => exampleTransformPhrases(dataset?.profile, available), [dataset, available]);
  const vocabulary = dataset?.vocabulary?.dimensions || {};

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

  /** Stage a step at the end, or in place of the one being edited. */
  const stage = useCallback(
    (op, at = null) => {
      const withId = { ...op, id: op.id || `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}` };
      setSteps(at === null ? [...list, withId] : list.map((s, i) => (i === at ? { ...withId, id: s.id } : s)));
    },
    [list]
  );

  const commitDraft = useCallback(() => {
    const op = toOp(draft);
    // Validated against the columns as they stand BEFORE the step being
    // edited, which for a new step is the end of the list.
    const before = draft.editing === null || draft.editing === undefined
      ? available
      : planTransforms(list.slice(0, draft.editing), dataset?.baseColumns || columns).columns;
    const checked = validateTransform(op, before);
    if (!checked.ok) {
      setError(checked.error);
      return;
    }
    stage(op, draft.editing ?? null);
    setDraft(null);
    setError(null);
  }, [draft, available, list, dataset, columns, stage]);

  const readPhrase = useCallback(async () => {
    const text = phrase.trim();
    if (!text) return;
    setReading(true);
    setError(null);
    try {
      const found = await draftTransform(text, { columns: available });
      let next = list;
      for (const step of found) {
        next = [...next, { ...step, id: `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}` }];
      }
      setSteps(next);
      setPhrase('');
    } catch (e) {
      setError(e.message);
    } finally {
      setReading(false);
    }
  }, [phrase, draftTransform, available, list]);

  const suggest = useCallback(async () => {
    setSuggesting(true);
    setError(null);
    setNotice(null);
    try {
      const result = await suggestPreparation();
      if (!result) {
        setNotice('The analyst could not be reached. Check the model key on your profile.');
      } else if (!result.steps.length && !result.measures.length) {
        setNotice(result.summary ? `${result.summary} Nothing to add.` : 'The analyst had nothing to add to this table.');
      } else {
        setProposal(result);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setSuggesting(false);
    }
  }, [suggestPreparation]);

  const move = (i, delta) => {
    const j = i + delta;
    if (j < 0 || j >= list.length) return;
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
    setSteps(next);
  };

  if (!dataset) return null;

  const staged = new Set(list.map((s) => s.id));
  const savedMeasureNames = new Set(measures.map((m) => m.name.toLowerCase()));
  // The suggestions on offer: what was asked for here, else what the analyst
  // left for a person to decide before the analysis ran.
  const suggestedSteps = (proposal?.steps || preparation?.suggested || []).filter((s) => !staged.has(s.id));
  const suggestedMeasures = (proposal?.measures || []).filter((m) => !savedMeasureNames.has(m.name.toLowerCase()));
  const summary = proposal?.summary || preparation?.summary || '';

  return (
    <div className="card p-4">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <Wand2 size={14} className="text-accent-400" />
        <span className="label">Transform data</span>
        <div className="ml-auto flex items-center gap-3">
          {can('model') && (
            <button
              onClick={suggest}
              disabled={suggesting}
              className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.15em] text-accent-400/80 transition-colors hover:text-accent-300 disabled:opacity-50"
              title="Ask the analyst what it would do to this table before charting it"
            >
              {suggesting ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />} Suggest steps
            </button>
          )}
          {plan.steps.length > 0 && (
            <button
              onClick={() => setShowSql((v) => !v)}
              className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.15em] text-white/30 transition-colors hover:text-accent-400"
            >
              <Code2 size={11} /> {showSql ? 'Hide' : 'Show'} SQL
            </button>
          )}
        </div>
      </div>
      <p className="mb-3 text-[12px] leading-relaxed text-white/40">
        Each step is one query over the result of the one before it. Applied before anything is
        analysed, so the charts and the findings see the shape you made.
      </p>

      {/* What the analyst read, and what it left for a person to decide. */}
      {(summary || suggestedSteps.length > 0 || suggestedMeasures.length > 0 || preparation?.applied?.length > 0) && (
        <div className="mb-3 rounded-lg border border-accent-500/20 bg-accent-500/[0.04] p-3">
          <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.15em] text-accent-300/80">
            <Sparkles size={11} /> The analyst
          </div>
          {summary && <p className="mt-1 text-[12px] leading-relaxed text-white/60">{summary}</p>}
          {preparation?.applied?.length > 0 && !proposal && (
            <p className="mt-1 text-[11px] text-white/40">
              Added {preparation.applied.length} column{preparation.applied.length === 1 ? '' : 's'} before the analysis ran — they are
              in the list below, marked. Anything that would remove or change data is offered here instead.
            </p>
          )}
          {preparation?.failure && !proposal && (
            <p className="mt-1 text-[11px] text-amber-300/80">A suggested step would not run: {preparation.failure}</p>
          )}
          {suggestedSteps.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1.5">
              {suggestedSteps.map((s) => (
                <li key={s.id} className="flex items-start gap-2 rounded-md border border-white/6 bg-black/10 px-2.5 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-[12px] text-white/80">{describeTransform(s)}</div>
                    {s.why && <div className="mt-0.5 text-[11px] leading-snug text-white/40">{s.why}</div>}
                  </div>
                  <button onClick={() => stage(s)} className={`${SMALL_BUTTON} shrink-0`}>
                    <Plus size={10} className="mr-1 inline" />
                    Add
                  </button>
                </li>
              ))}
            </ul>
          )}
          {suggestedMeasures.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1.5">
              {suggestedMeasures.map((m) => (
                <li key={m.name} className="flex items-start gap-2 rounded-md border border-white/6 bg-black/10 px-2.5 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-[12px] text-white/80">
                      Measure: {m.name} <span className="font-mono text-[10px] text-white/35">= {m.expr}</span>
                    </div>
                    {m.explanation && <div className="mt-0.5 text-[11px] leading-snug text-white/40">{m.explanation}</div>}
                  </div>
                  <button
                    onClick={() => {
                      try {
                        saveMeasure(m);
                        setNotice(`${m.name} saved as a measure.`);
                      } catch (e) {
                        setError(e.message);
                      }
                    }}
                    className={`${SMALL_BUTTON} shrink-0`}
                  >
                    <Plus size={10} className="mr-1 inline" />
                    Save
                  </button>
                </li>
              ))}
            </ul>
          )}
          {proposal && (
            <button onClick={() => setProposal(null)} className="mt-2 text-[10px] font-bold uppercase tracking-[0.15em] text-white/30 hover:text-white/60">
              Dismiss
            </button>
          )}
        </div>
      )}

      {list.length === 0 && !draft && (
        <p className="rounded-lg border border-white/6 bg-white/[0.02] px-3 py-2.5 text-[12px] text-white/35">
          No steps. The data is being analysed exactly as it was read.
        </p>
      )}

      <ul className="flex flex-col gap-1.5">
        {list.map((op, i) => {
          const step = plan.steps.find((s) => s.id === op.id);
          const failed = plan.skipped.find((s) => s.id === op.id && s.reason !== 'turned off');
          const off = op.enabled === false;
          return (
            <li
              key={op.id || i}
              className={`rounded-lg border px-3 py-2 ${
                failed ? 'border-amber-500/30 bg-amber-500/[0.05]' : 'border-white/7 bg-white/[0.02]'
              }`}
            >
              <div className="flex items-start gap-2">
                <span className="mt-0.5 w-4 shrink-0 text-[10px] font-black tabular-nums text-white/25">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className={`text-[12px] ${off ? 'text-white/25 line-through' : 'text-white/75'}`}>
                    {describeTransform(op)}
                    {/* Both sources are the analyst to a reader: one is a
                        rule reading the values, one is a model reading them,
                        and the badge is about who decided rather than how. */}
                    {(op.source === 'model' || op.source === 'derived') && (
                      <span
                        title={op.why || 'Added by the analyst'}
                        className="ml-2 rounded-full border border-accent-500/30 bg-accent-500/10 px-1.5 py-px text-[9px] font-black uppercase tracking-[0.15em] text-accent-300/90"
                      >
                        analyst
                      </span>
                    )}
                  </div>
                  {(op.source === 'model' || op.source === 'derived') && op.why && (
                    <div className="mt-0.5 text-[11px] leading-snug text-white/35">{op.why}</div>
                  )}
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
                <div className="flex shrink-0 items-center">
                  <IconButton title="Move up" onClick={() => move(i, -1)} disabled={i === 0}>
                    <ArrowUp size={12} />
                  </IconButton>
                  <IconButton title="Move down" onClick={() => move(i, 1)} disabled={i === list.length - 1}>
                    <ArrowDown size={12} />
                  </IconButton>
                  <IconButton
                    title="Edit this step"
                    onClick={() => {
                      setDraft(toDraft(op, i));
                      setError(null);
                    }}
                  >
                    <Pencil size={12} />
                  </IconButton>
                  <IconButton
                    title={off ? 'Turn this step on' : 'Turn this step off'}
                    onClick={() => setSteps(list.map((s, j) => (j === i ? { ...s, enabled: off } : s)))}
                  >
                    <Check size={13} className={off ? 'opacity-40' : ''} />
                  </IconButton>
                  <IconButton title="Remove this step" tone="rose" onClick={() => setSteps(list.filter((_, j) => j !== i))}>
                    <Trash2 size={13} />
                  </IconButton>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {draft ? (
        <StepEditor
          draft={draft}
          setDraft={setDraft}
          columns={
            draft.editing === null || draft.editing === undefined
              ? available
              : planTransforms(list.slice(0, draft.editing), dataset?.baseColumns || columns).columns
          }
          vocabulary={vocabulary}
          profile={dataset.profile}
          onCommit={commitDraft}
          onCancel={() => {
            setDraft(null);
            setError(null);
          }}
        />
      ) : (
        <div className="mt-2 flex flex-col gap-2">
          {/* The sentence box: what you want, in words. */}
          <div className="flex items-center gap-2">
            <input
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') readPhrase();
              }}
              placeholder="Describe a step — “split City on the comma into Town and State”"
              aria-label="Describe a step in plain English"
              className={`${FIELD} flex-1`}
            />
            <button
              onClick={readPhrase}
              disabled={reading || !phrase.trim()}
              className="flex items-center gap-1.5 rounded-lg bg-accent-500 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.15em] text-on-accent transition-colors hover:bg-accent-400 disabled:opacity-40"
            >
              {reading ? <Loader2 size={11} className="animate-spin" /> : <Wand2 size={11} />} Add
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {examples.map((ex) => (
              <button
                key={ex}
                onClick={() => setPhrase(ex)}
                className="rounded-full border border-white/8 px-2 py-0.5 text-[10px] text-white/35 transition-colors hover:border-accent-500/30 hover:text-accent-300"
              >
                {ex}
              </button>
            ))}
            <button
              onClick={() => {
                setDraft(blank(DERIVE, available));
                setError(null);
              }}
              className="ml-auto flex items-center gap-1.5 rounded-lg border border-dashed border-white/12 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.15em] text-white/40 transition-colors hover:border-accent-500/30 hover:text-accent-300"
            >
              <Plus size={11} /> Build a step
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="mt-2 rounded-lg border border-rose-500/25 bg-rose-500/8 px-3 py-2 text-[12px] leading-relaxed text-rose-200">
          {error}
        </p>
      )}
      {notice && !error && (
        <p className="mt-2 rounded-lg border border-accent-500/25 bg-accent-500/[0.06] px-3 py-2 text-[12px] text-accent-200">{notice}</p>
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

function IconButton({ title, onClick, disabled = false, tone = 'default', children }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className={`rounded p-1 text-white/25 transition-colors disabled:opacity-20 ${
        tone === 'rose' ? 'hover:bg-rose-500/12 hover:text-rose-300' : 'hover:bg-white/8 hover:text-white/70'
      }`}
    >
      {children}
    </button>
  );
}

/* -- the form, one per kind ------------------------------------------------ */

function ColumnSelect({ value, onChange, columns, allowNone = false, label }) {
  return (
    <select value={value || ''} onChange={(e) => onChange(e.target.value)} className={FIELD} aria-label={label}>
      {allowNone && (
        <option value="" className="bg-surface">
          (none)
        </option>
      )}
      {columns.map((c) => (
        <option key={c} value={c} className="bg-surface">
          {c}
        </option>
      ))}
    </select>
  );
}

/** Pick several columns: every one a chip, chosen ones lit. */
function ColumnChips({ value = [], onChange, columns, hint }) {
  const chosen = new Set(value);
  return (
    <div className="flex flex-wrap items-center gap-1">
      {hint && <span className="mr-1 text-[10px] text-white/30">{hint}</span>}
      {columns.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(chosen.has(c) ? value.filter((v) => v !== c) : [...value, c])}
          className={`rounded border px-1.5 py-0.5 font-mono text-[10px] transition-colors ${
            chosen.has(c)
              ? 'border-accent-500/50 bg-accent-500/15 text-accent-200'
              : 'border-white/8 bg-white/[0.03] text-white/40 hover:border-accent-500/30 hover:text-accent-300'
          }`}
        >
          {c}
        </button>
      ))}
    </div>
  );
}

function Text({ value, onChange, placeholder, mono = false, label, className = '' }) {
  return (
    <input
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label={label || placeholder}
      spellCheck={false}
      className={`${FIELD} ${mono ? 'font-mono' : ''} ${className}`}
    />
  );
}

/** The columns a formula may mention, and the functions it may call. */
function FormulaHelp({ columns, onInsert }) {
  const [functions, setFunctions] = useState(false);
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1">
      {columns.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onInsert(`[${c}]`)}
          className="rounded border border-white/8 bg-white/[0.03] px-1.5 py-0.5 font-mono text-[10px] text-white/40 transition-colors hover:border-accent-500/30 hover:text-accent-300"
        >
          {c}
        </button>
      ))}
      <button
        type="button"
        onClick={() => setFunctions((v) => !v)}
        className="ml-1 text-[10px] font-bold uppercase tracking-[0.15em] text-white/30 hover:text-accent-400"
      >
        {functions ? 'Hide functions' : 'Functions'}
      </button>
      {functions && (
        <div className="mt-1 w-full font-mono text-[10px] leading-relaxed text-white/35">
          {FUNCTION_NAMES.map((f) => (
            <button key={f} type="button" onClick={() => onInsert(`${f}(`)} className="mr-2 hover:text-accent-300">
              {f}
            </button>
          ))}
          <div className="mt-1 font-sans text-white/30">
            Also CASE WHEN … THEN … ELSE … END, AND, OR, NOT, LIKE, IN, IS NULL. Text in single quotes.
          </div>
        </div>
      )}
    </div>
  );
}

function StepEditor({ draft, setDraft, columns, vocabulary, profile, onCommit, onCancel }) {
  const set = (patch) => setDraft({ ...draft, ...patch });
  const numeric = profile?.measures?.length ? columns.filter((c) => profile.measures.includes(c)) : columns;
  const dates = columns.filter((c) => profile?.columns?.[c]?.role === 'time' || /date|time/i.test(c));
  const kindColumns = draft.kind === DATEPART && dates.length ? dates : draft.kind === BUCKET && numeric.length ? numeric : columns;

  return (
    <div className="mt-2 rounded-lg border border-accent-500/25 bg-accent-500/[0.04] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={draft.kind}
          onChange={(e) => setDraft({ ...blank(e.target.value, columns), editing: draft.editing })}
          className={FIELD}
          aria-label="Kind of step"
          disabled={draft.editing !== null && draft.editing !== undefined}
        >
          {GROUPS.map((g) => (
            <optgroup key={g.label} label={g.label} className="bg-surface">
              {g.kinds.map((k) => (
                <option key={k.id} value={k.id} className="bg-surface">
                  {k.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>

        {/* One column in, one of something out. */}
        {[RENAME, RETYPE, DROP, TEXT, REPLACE, FILL, SPLIT, BUCKET, DATEPART, PIVOT].includes(draft.kind) && (
          <ColumnSelect
            label="Column"
            value={draft.column}
            columns={kindColumns}
            onChange={(column) => {
              const patch = { column };
              if (draft.kind === DATEPART) patch.name = `${titled(column)} ${DATE_PARTS[draft.part]?.suffix || ''}`.trim();
              if (draft.kind === BUCKET) patch.name = `${titled(column)} band`;
              if (draft.kind === SPLIT) patch.intoText = `${titled(column)} 1, ${titled(column)} 2`;
              if (draft.kind === PIVOT && vocabulary[column]) patch.valuesText = vocabulary[column].map((v) => v.value).join(', ');
              set(patch);
            }}
          />
        )}

        {draft.kind === RENAME && <Text value={draft.to} onChange={(to) => set({ to })} placeholder="New name" className="flex-1" />}

        {draft.kind === RETYPE && (
          <select value={draft.to} onChange={(e) => set({ to: e.target.value })} className={FIELD} aria-label="Read as">
            {Object.entries(RETYPE_TARGETS).map(([id, t]) => (
              <option key={id} value={id} className="bg-surface">
                {t.label}
              </option>
            ))}
          </select>
        )}

        {draft.kind === TEXT && (
          <select value={draft.op} onChange={(e) => set({ op: e.target.value })} className={FIELD} aria-label="Operation">
            {Object.entries(TEXT_OPS).map(([id, t]) => (
              <option key={id} value={id} className="bg-surface">
                {t.label}
              </option>
            ))}
          </select>
        )}

        {draft.kind === REPLACE && (
          <>
            <Text value={draft.find} onChange={(find) => set({ find })} placeholder="Find" />
            <Text value={draft.replacement} onChange={(replacement) => set({ replacement })} placeholder="Replace with (blank to clear)" />
            <select value={draft.mode} onChange={(e) => set({ mode: e.target.value })} className={FIELD} aria-label="Match">
              <option value="value" className="bg-surface">
                whole value
              </option>
              <option value="text" className="bg-surface">
                text inside the value
              </option>
            </select>
          </>
        )}

        {draft.kind === FILL && <Text value={draft.value} onChange={(value) => set({ value })} placeholder="Value for blanks" />}

        {(draft.kind === DERIVE || draft.kind === CONDITIONAL || draft.kind === BUCKET || draft.kind === DATEPART || draft.kind === MERGE || draft.kind === INDEX) && (
          <Text value={draft.name} onChange={(name) => set({ name })} placeholder="New column name" label="New column name" />
        )}

        {draft.kind === DATEPART && (
          <select
            value={draft.part}
            onChange={(e) => set({ part: e.target.value, name: `${titled(draft.column)} ${DATE_PARTS[e.target.value].suffix}` })}
            className={FIELD}
            aria-label="Part of the date"
          >
            {Object.entries(DATE_PARTS).map(([id, p]) => (
              <option key={id} value={id} className="bg-surface">
                {p.label}
              </option>
            ))}
          </select>
        )}

        {draft.kind === FILTER && (
          <select value={draft.mode} onChange={(e) => set({ mode: e.target.value })} className={FIELD} aria-label="Keep or remove">
            <option value="keep" className="bg-surface">
              Keep rows where
            </option>
            <option value="remove" className="bg-surface">
              Remove rows where
            </option>
          </select>
        )}

        {(draft.kind === DERIVE || draft.kind === FILTER) && (
          <Text
            value={draft.expr}
            onChange={(expr) => set({ expr })}
            placeholder={draft.kind === FILTER ? "[Status] <> 'Cancelled'" : 'SAFE_DIVIDE([Revenue], [Units])'}
            mono
            className="flex-1"
            label="Formula"
          />
        )}

        {draft.kind === SPLIT && (
          <>
            <Text value={draft.separator} onChange={(separator) => set({ separator })} placeholder="Split on" className="w-20" label="Split on" />
            <Text value={draft.intoText} onChange={(intoText) => set({ intoText })} placeholder="Into: Town, State" className="flex-1" label="New columns" />
            <label className="flex items-center gap-1.5 text-[11px] text-white/45">
              <input type="checkbox" checked={!!draft.dropOriginal} onChange={(e) => set({ dropOriginal: e.target.checked })} />
              drop the original
            </label>
          </>
        )}

        {draft.kind === MERGE && <Text value={draft.separator} onChange={(separator) => set({ separator })} placeholder="Between them" className="w-24" label="Separator" />}

        {draft.kind === BUCKET && (
          <>
            <Text value={draft.edgesText} onChange={(edgesText) => set({ edgesText })} placeholder="Boundaries: 100, 500, 1000" className="flex-1" label="Boundaries" />
            <Text value={draft.labelsText} onChange={(labelsText) => set({ labelsText })} placeholder="Labels (optional): Small, Medium, Large, Huge" className="flex-1" label="Labels" />
          </>
        )}

        {draft.kind === LIMIT && (
          <>
            <Text value={String(draft.count)} onChange={(count) => set({ count })} placeholder="How many" className="w-20" label="How many rows" />
            <span className="text-[11px] text-white/35">by</span>
            <ColumnSelect label="Rank by" value={draft.by} columns={columns} allowNone onChange={(by) => set({ by })} />
            <select value={draft.direction} onChange={(e) => set({ direction: e.target.value })} className={FIELD} aria-label="Direction">
              <option value="desc" className="bg-surface">
                highest first
              </option>
              <option value="asc" className="bg-surface">
                lowest first
              </option>
            </select>
          </>
        )}

        {draft.kind === UNPIVOT && (
          <>
            <Text value={draft.nameColumn} onChange={(nameColumn) => set({ nameColumn })} placeholder="Name column" label="Name column" />
            <Text value={draft.valueColumn} onChange={(valueColumn) => set({ valueColumn })} placeholder="Value column" label="Value column" />
          </>
        )}

        {draft.kind === PIVOT && (
          <>
            <select value={draft.fn} onChange={(e) => set({ fn: e.target.value })} className={FIELD} aria-label="Aggregate">
              {['SUM', 'AVG', 'MIN', 'MAX', 'COUNT'].map((f) => (
                <option key={f} value={f} className="bg-surface">
                  {f}
                </option>
              ))}
            </select>
            <span className="text-[11px] text-white/35">of</span>
            <ColumnSelect label="Measure" value={draft.measure} columns={numeric.filter((c) => c !== draft.column)} allowNone onChange={(measure) => set({ measure })} />
            <Text value={draft.valuesText} onChange={(valuesText) => set({ valuesText })} placeholder="Values that become columns: North, South" className="flex-1" label="Values" />
          </>
        )}
      </div>

      {/* Multi-column pickers, on their own line. */}
      {draft.kind === KEEP && <div className="mt-2"><ColumnChips value={draft.columns} columns={columns} onChange={(v) => set({ columns: v })} hint="Keep:" /></div>}
      {draft.kind === MERGE && <div className="mt-2"><ColumnChips value={draft.columns} columns={columns} onChange={(v) => set({ columns: v })} hint="Combine, in order:" /></div>}
      {draft.kind === UNPIVOT && <div className="mt-2"><ColumnChips value={draft.columns} columns={columns} onChange={(v) => set({ columns: v })} hint="Columns that become rows:" /></div>}
      {draft.kind === BLANKS && <div className="mt-2"><ColumnChips value={draft.columns} columns={columns} onChange={(v) => set({ columns: v })} hint="Blank in any of (none = the whole row):" /></div>}
      {draft.kind === DEDUPE && <div className="mt-2"><ColumnChips value={draft.columns} columns={columns} onChange={(v) => set({ columns: v })} hint="Same in all of (none = whole row):" /></div>}
      {draft.kind === GROUP && <div className="mt-2"><ColumnChips value={draft.by} columns={columns} onChange={(v) => set({ by: v })} hint="Group by:" /></div>}

      {(draft.kind === DERIVE || draft.kind === FILTER) && (
        <FormulaHelp columns={columns} onInsert={(text) => set({ expr: `${draft.expr || ''}${text}` })} />
      )}

      {draft.kind === CONDITIONAL && (
        <div className="mt-2 flex flex-col gap-1.5">
          {draft.rules.map((rule, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <span className="w-10 text-[11px] text-white/35">{i === 0 ? 'when' : 'else when'}</span>
              <Text value={rule.when} onChange={(when) => set({ rules: draft.rules.map((r, j) => (j === i ? { ...r, when } : r)) })} placeholder="[Revenue] >= 1000" mono className="flex-1" label={`Rule ${i + 1} condition`} />
              <span className="text-[11px] text-white/35">then</span>
              <Text value={rule.then} onChange={(then) => set({ rules: draft.rules.map((r, j) => (j === i ? { ...r, then } : r)) })} placeholder="'Large'" mono className="w-36" label={`Rule ${i + 1} value`} />
              <IconButton title="Remove rule" tone="rose" onClick={() => set({ rules: draft.rules.filter((_, j) => j !== i) })} disabled={draft.rules.length === 1}>
                <X size={12} />
              </IconButton>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-10 text-[11px] text-white/35">else</span>
            <Text value={draft.otherwise} onChange={(otherwise) => set({ otherwise })} placeholder="'Other' (optional)" mono className="w-36" label="Otherwise" />
            <button type="button" onClick={() => set({ rules: [...draft.rules, { when: '', then: '' }] })} className={SMALL_BUTTON}>
              <Plus size={10} className="mr-1 inline" />
              Rule
            </button>
          </div>
          <FormulaHelp columns={columns} onInsert={(text) => set({ rules: draft.rules.map((r, j) => (j === draft.rules.length - 1 ? { ...r, when: `${r.when || ''}${text}` } : r)) })} />
        </div>
      )}

      {draft.kind === SORT && (
        <div className="mt-2 flex flex-col gap-1.5">
          {draft.by.map((s, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <ColumnSelect label={`Sort column ${i + 1}`} value={s.column} columns={columns} onChange={(column) => set({ by: draft.by.map((x, j) => (j === i ? { ...x, column } : x)) })} />
              <select value={s.direction} onChange={(e) => set({ by: draft.by.map((x, j) => (j === i ? { ...x, direction: e.target.value } : x)) })} className={FIELD} aria-label="Direction">
                <option value="asc" className="bg-surface">
                  ascending
                </option>
                <option value="desc" className="bg-surface">
                  descending
                </option>
              </select>
              <IconButton title="Remove" tone="rose" onClick={() => set({ by: draft.by.filter((_, j) => j !== i) })} disabled={draft.by.length === 1}>
                <X size={12} />
              </IconButton>
            </div>
          ))}
          <button type="button" onClick={() => set({ by: [...draft.by, { column: columns[0], direction: 'asc' }] })} className={`${SMALL_BUTTON} self-start`}>
            <Plus size={10} className="mr-1 inline" />
            Then by
          </button>
        </div>
      )}

      {draft.kind === GROUP && (
        <div className="mt-2 flex flex-col gap-1.5">
          {draft.aggregates.map((a, i) => {
            const def = GROUP_FUNCTIONS[a.fn] || GROUP_FUNCTIONS.SUM;
            return (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <select
                  value={a.fn}
                  onChange={(e) => set({ aggregates: draft.aggregates.map((x, j) => (j === i ? { ...x, fn: e.target.value } : x)) })}
                  className={FIELD}
                  aria-label="Calculation"
                >
                  {Object.entries(GROUP_FUNCTIONS).map(([id, g]) => (
                    <option key={id} value={id} className="bg-surface">
                      {g.label}
                    </option>
                  ))}
                </select>
                {def.needsColumn && (
                  <ColumnSelect label="Of column" value={a.column} columns={columns} allowNone onChange={(column) => set({ aggregates: draft.aggregates.map((x, j) => (j === i ? { ...x, column, name: x.name || `${def.label} ${titled(column)}` } : x)) })} />
                )}
                <span className="text-[11px] text-white/35">as</span>
                <Text value={a.name} onChange={(name) => set({ aggregates: draft.aggregates.map((x, j) => (j === i ? { ...x, name } : x)) })} placeholder="Column name" label="Result name" />
                <IconButton title="Remove" tone="rose" onClick={() => set({ aggregates: draft.aggregates.filter((_, j) => j !== i) })} disabled={draft.aggregates.length === 1}>
                  <X size={12} />
                </IconButton>
              </div>
            );
          })}
          <button type="button" onClick={() => set({ aggregates: [...draft.aggregates, { fn: 'SUM', column: numeric[0] || '', name: '' }] })} className={`${SMALL_BUTTON} self-start`}>
            <Plus size={10} className="mr-1 inline" />
            Calculation
          </button>
        </div>
      )}

      <div className="mt-2.5 flex items-center gap-2">
        <button
          onClick={onCommit}
          className="rounded-lg bg-accent-500 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.15em] text-on-accent transition-colors hover:bg-accent-400"
        >
          {draft.editing !== null && draft.editing !== undefined ? 'Save step' : 'Add step'}
        </button>
        <button onClick={onCancel} className="rounded-lg border border-white/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.15em] text-white/45 transition-colors hover:bg-white/5" aria-label="Cancel">
          <X size={12} />
        </button>
      </div>
    </div>
  );
}
