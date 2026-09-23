/**
 * Questions a model proposes for a table — checked against the table before
 * the reader sees one.
 *
 * Phase 4 of docs/design/question-first-reports.md. The catalogue
 * (lib/questionCatalogue.js) asks what a table's SHAPE permits; it cannot know
 * that a file of plans exists to compare capability per dollar, or that the
 * jobs file is about automation risk. A model can guess that from the column
 * names, the values and twenty rows (the summary the reader authorised). So it
 * is shown the table and the catalogue's own list, and asked two things: which
 * of the listed questions matter, best first, and which questions are missing.
 *
 * **Nothing it says is believed.** A pick must be the id of a question on the
 * list. A new question must be in the same typed form the catalogue uses, name
 * columns that exist and are the right kind for its intent, and compile — here,
 * against the rows — into at least one chart through lib/questionCompiler.js,
 * the same compiler every other question goes through. So a model-proposed
 * question is held to the same rules as any other: it cannot average across a
 * scope, add budget to actual or chart a measure by bands of itself, because
 * the compiler does not write those queries for anyone. What fails is dropped
 * with the reason, and a model that proposed nothing usable leaves the card as
 * the catalogue made it.
 *
 * Pure: the prompt is built here and sent by app/api/questions, the proposal
 * is checked by the worker (which has the rows), and eval/scorecard.mjs runs
 * the same check over recorded answers.
 */

import { prettyColumn } from './aggregateNames.js';
import { compileQuestion } from './questionCompiler.js';

const MAX_PICKS = 6;
const MAX_ADDED = 4;
const RECOMMENDED = 8;
const INTENTS = new Set(['trend', 'composition', 'compare', 'rank', 'tradeoff', 'outcome-rate', 'ratio', 'relationship']);

/* ── The prompt ────────────────────────────────────────────────────────── */

export const QUESTIONS_SYSTEM = `You are helping a reader decide what a report on a table should answer.

You are shown the table — its columns, their values or ranges, and some whole
rows — and a numbered list of questions an engine can already answer about it.
Charts and figures are computed by the engine from the reader's rows; you do not
compute anything and you never state a number.

Do two things.

1. PICK: which listed questions a person opening this file most wants answered,
   best first, at most ${MAX_PICKS}. Think about what the file was made to show:
   a table of priced plans is for comparing value for money; a table of
   customers with a churn flag is for what drives churn. Skip questions about
   identifiers, bookkeeping columns, or splits nobody would ask for.

2. ADD: questions that matter and are not on the list, at most ${MAX_ADDED}. Each
   must be in this exact form, using column names EXACTLY as given:

   { "text": "<the question, in plain words>",
     "intent": "<one of the intents below>",
     ...the fields that intent needs }

   Intents and their fields:
   - "trend": "measure" (a number column, or null to count rows), "over" (a date column)
   - "composition": "measure" (a number column that adds up), "by" (a category column)
   - "compare": "measure" (a number column), "by" (a category column)
   - "rank": "measure" (a number column) — which rows have the most
   - "tradeoff": "measure" (what you get), "cost" (a price) — the most per unit of cost
   - "outcome-rate": "outcome": {"column": <a two-level column>, "event": <one of its two values>}, "by" (a column)
   - "ratio": "measure" (a count), "other" (the larger count it is part of), "by" (a category column)
   - "relationship": "measure" and "other" (two number columns)

Rules:
- Use only columns you were shown, spelled exactly. A question naming a column
  that does not exist is discarded.
- Do not re-add a question that is already on the list — pick it instead.
- Silence is better than a question the table cannot answer.

Reply as JSON:
{
  "subject": "<one short phrase for what one row is>",
  "pick": ["<id from the list>"],
  "add": [ { "text": "...", "intent": "...", ... } ]
}`;

/** One line per column: its kind, and its values or its range. */
export function describeColumns(columns = []) {
  return columns
    .map((c) => {
      const head = `- ${c.name} (${c.kind}${c.levels ? `, ${c.levels} distinct` : ''})`;
      if (Array.isArray(c.values) && c.values.length) {
        return `${head}\n    values: ${c.values.map((v) => `${v.value} (${v.sharePct}%)`).join(', ')}`;
      }
      if (c.range) {
        return `${head}\n    range: ${c.range.min} to ${c.range.max}, median ${c.range.median}${c.range.negatives ? ', goes below zero' : ''}`;
      }
      return head;
    })
    .join('\n');
}

/**
 * The prompt for one table. `columns` and `sample` are the briefing the app
 * already sends (lib/valueBriefing.js); `catalogue` is the question list.
 */
export function questionsPrompt({ columns = [], sample = [], fileName = null, rowCount = null, grain = null, catalogue = [] } = {}) {
  return [
    fileName ? `The file is called "${fileName}".` : '',
    Number.isFinite(rowCount) ? `It has ${rowCount} rows.` : '',
    grain?.why ? `The engine read it as: ${grain.why}.` : '',
    '',
    'The table has these columns:',
    '',
    describeColumns(columns),
    sample.length ? `\nSome whole rows, taken across the table:\n${JSON.stringify(sample.slice(0, 20))}` : '',
    '',
    'Questions the engine can already answer:',
    ...catalogue.map((q) => `- ${q.id}: ${q.text}`),
    '',
    'Which of these matter most, and what is missing?',
  ]
    .filter((line) => line !== null)
    .join('\n');
}

/* ── The gate ──────────────────────────────────────────────────────────── */

/** The same id the catalogue gives a question, so a re-proposal is recognised. */
export function questionKey(q) {
  return [q.intent, q.outcome?.column, q.measure, q.cost, q.other, q.by, q.over, ...(q.items || [])].filter(Boolean).join('|');
}

const present = (v) => v !== null && v !== undefined && v !== '';

function checkColumn(model, col, kinds, role) {
  if (!present(col)) return `no ${role} given`;
  const info = model.columns[col];
  if (!info) return `${role} "${col}" is not a column of this table`;
  if (kinds && !kinds(info, col)) return `${role} "${col}" is the wrong kind of column (${info.type})`;
  return null;
}

/**
 * Check a model's proposal against the table.
 *
 * @param {object} raw        the model's JSON reply
 * @param {object} context
 * @param {object[]} context.rows
 * @param {object} context.model       from buildTableModel
 * @param {object[]} context.catalogue the questions the model was shown
 * @returns {{ subject: string|null, picks: object[], added: object[], dropped: {claim: string, reason: string}[] }}
 */
export function acceptModelQuestions(raw, { rows = [], model, catalogue = [] } = {}) {
  const out = { subject: null, picks: [], added: [], dropped: [] };
  if (!raw || typeof raw !== 'object' || !model) return out;
  const byId = new Map(catalogue.map((q) => [q.id, q]));
  const drop = (claim, reason) => out.dropped.push({ claim: String(claim).slice(0, 120), reason });

  if (typeof raw.subject === 'string' && raw.subject.trim()) out.subject = raw.subject.trim().slice(0, 120);

  for (const id of Array.isArray(raw.pick) ? raw.pick : []) {
    const q = byId.get(String(id));
    if (!q) drop(id, 'not a question on the list');
    else if (!out.picks.includes(q) && out.picks.length < MAX_PICKS) out.picks.push(q);
  }

  const measure = (info, col) => !!model.measures[col];
  const splits = (info) => ['category', 'flag'].includes(info.type) || (info.type === 'number' && info.distinct <= 20);
  const time = (info) => info.type === 'time';

  for (const p of (Array.isArray(raw.add) ? raw.add : []).slice(0, MAX_ADDED * 2)) {
    if (out.added.length >= MAX_ADDED) break;
    const text = typeof p?.text === 'string' ? p.text.trim().slice(0, 160) : '';
    const claim = text || JSON.stringify(p);
    if (!p || typeof p !== 'object' || !INTENTS.has(p.intent)) {
      drop(claim, `intent "${p?.intent}" is not one the engine answers`);
      continue;
    }
    const q = { intent: p.intent, text };
    const problems = [];
    const need = (field, kinds, role = field, optional = false) => {
      if (optional && !present(p[field])) return;
      const problem = checkColumn(model, p[field], kinds, role);
      if (problem) problems.push(problem);
      else q[field] = p[field];
    };

    switch (p.intent) {
      case 'trend':
        need('measure', measure, 'measure', true);
        need('over', time, 'time column');
        break;
      case 'composition':
        need('measure', (info, col) => measure(info, col) && model.measures[col].sum, 'measure that adds up');
        need('by', splits, 'split');
        break;
      case 'compare':
        need('measure', measure);
        need('by', splits, 'split');
        q.mean = true;
        break;
      case 'rank':
        need('measure', measure);
        break;
      case 'tradeoff':
        need('measure', measure);
        need('cost', measure, 'cost');
        break;
      case 'ratio':
        need('measure', measure);
        need('other', measure, 'larger count');
        need('by', splits, 'split');
        break;
      case 'relationship':
        need('measure', measure);
        need('other', measure, 'second measure');
        break;
      case 'outcome-rate': {
        const col = p.outcome?.column;
        const levels = [...new Set(rows.map((r) => r?.[col]).filter(present).map(String))];
        if (!model.columns[col]) problems.push(`outcome "${col}" is not a column of this table`);
        else if (levels.length !== 2) problems.push(`outcome "${col}" has ${levels.length} values, not two`);
        else if (!levels.includes(String(p.outcome?.event))) problems.push(`"${p.outcome?.event}" is not a value of ${col}`);
        else {
          const other = levels.find((l) => l !== String(p.outcome.event));
          q.outcome = { column: col, event: String(p.outcome.event), other, levels, kind: 'binary', highIsGood: false, source: 'model' };
        }
        need('by', (info) => ['category', 'flag', 'number'].includes(info.type), 'split');
        if (q.by && model.columns[q.by]?.type === 'number' && model.columns[q.by].distinct > 10) q.band = true;
        if (q.by && q.by === col) problems.push('an outcome cannot be split by itself');
        break;
      }
      default:
        break;
    }

    if (!q.text) q.text = `${prettyColumn(q.measure || q.outcome?.column || '')} (${q.intent})`;
    if (problems.length) {
      drop(claim, problems.join('; '));
      continue;
    }
    q.id = questionKey(q);
    const existing = byId.get(q.id);
    if (existing) {
      // A question already on the list: a pick, however it was phrased.
      if (!out.picks.includes(existing)) out.picks.push(existing);
      continue;
    }
    // The last word: the compiler, which writes only queries that keep the
    // rules. A question it cannot turn into a chart here is not a question the
    // report can answer.
    let specs = [];
    try {
      specs = compileQuestion(q, rows, model);
    } catch {
      specs = [];
    }
    if (!specs.length) {
      drop(claim, 'nothing this table can draw answers it');
      continue;
    }
    out.added.push({ ...q, source: 'model' });
  }
  return out;
}

/**
 * The card's list, with the model's reading on top: its picks and its own
 * questions first and ticked, then the rest of the catalogue unticked. With
 * nothing usable from the model, the catalogue's list exactly as it was.
 */
export function mergeSuggestions(catalogue = [], accepted = null) {
  const lead = [...(accepted?.picks || []), ...(accepted?.added || [])];
  if (!lead.length) return catalogue;
  const leadIds = new Set(lead.map((q) => q.id));
  return [
    ...lead.map((q, i) => ({ ...q, source: 'model', recommended: i < RECOMMENDED })),
    ...catalogue.filter((q) => !leadIds.has(q.id)).map((q) => ({ ...q, recommended: false })),
  ];
}
