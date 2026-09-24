/**
 * The question card as a short questionnaire: five to ten multiple-choice
 * questions about this table, each with three answers and a fourth, "Other",
 * in the reader's own words.
 *
 * The suggestions it is built from are the ones the card always had — the
 * catalogue's (lib/questionCatalogue.js), or a model's merged in front of them
 * (lib/modelQuestions.js `mergeSuggestions`). What changes is how they are
 * put: not a checklist of thirty to tick, but one decision at a time — "what
 * should the report follow over time?", with the three trends this table can
 * draw as the answers. Each answer is one question the report is built from.
 *
 *   {
 *     id, stem,                 // "What should Revenue be compared across?"
 *     options: [question × 1–3],
 *     preferred,                // the option "Choose for me" takes
 *   }
 */

import { prettyColumn } from './aggregateNames.js';
import { compileQuestion } from './questionCompiler.js';
import { sampleOf } from './tableModel.js';

export const MIN_QUESTIONS = 5;
export const MAX_QUESTIONS = 10;
export const OPTIONS = 3;

const name = prettyColumn;

/** Which multiple-choice question a suggestion answers, and how it is asked. */
function topicOf(q) {
  // One quantity of a long table: which one is the choice.
  if (q.level != null && q.intent === 'trend') return { key: 'trend|level', stem: 'Which of these should the report follow over time?' };
  if (q.level != null && q.intent === 'compare') return { key: `compare|level|${q.by}`, stem: `What should each ${name(q.by).toLowerCase()} be compared on?` };
  switch (q.intent) {
    case 'trend':
      return { key: 'trend', stem: 'What should the report follow over time?' };
    case 'outcome-rate':
      return q.outcome?.column
        ? { key: `outcome|${q.outcome.column}`, stem: `What do you want to know about ${name(q.outcome.column)}?` }
        : null;
    case 'compare':
      return q.measure ? { key: `compare|${q.measure}`, stem: `What should ${name(q.measure)} be compared across?` } : null;
    case 'composition':
      return q.measure
        ? { key: `composition|${q.measure}`, stem: `Which breakdown of ${name(q.measure)} do you want to see?` }
        : { key: 'composition|rows', stem: 'How do you want the rows split?' };
    case 'relationship':
      return { key: 'relationship', stem: 'Which two measures should be checked against each other?' };
    case 'ratio':
      return { key: 'ratio', stem: 'Which conversion do you want to see?' };
    case 'tradeoff':
    case 'rank':
      return { key: 'rank', stem: 'Which ranking do you want?' };
    case 'items':
      return { key: 'items', stem: 'What do you want from the answers?' };
    default:
      return null;
  }
}

const lowerFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);

/**
 * Group suggestions into multiple-choice questions, best first.
 *
 * @param {object[]} suggestions  ranked, as the worker returns them
 * @returns {object[]} 0–10 questions, each with 1–3 options
 */
export function buildQuestionnaire(suggestions = []) {
  const groups = new Map();
  (suggestions || []).forEach((q, rank) => {
    if (!q || q.intent === 'custom') return;
    const topic = topicOf(q);
    if (!topic) return;
    if (!groups.has(topic.key)) groups.set(topic.key, { id: topic.key, stem: topic.stem, rank, all: [] });
    groups.get(topic.key).all.push(q);
  });

  // Ordered by the best suggestion each holds, so the first question asked is
  // about what the table most clearly answers.
  let list = [...groups.values()].sort((a, b) => a.rank - b.rank);

  // A topic with one answer is not a choice. Singles are asked together.
  const singles = list.filter((g) => g.all.length === 1);
  list = list.filter((g) => g.all.length > 1);
  // Threes, except that seven is 3 + 2 + 2 rather than 3 + 3 + 1.
  const sizes = [];
  for (let left = singles.length; left > 0; ) {
    const size = left === 4 ? 2 : Math.min(OPTIONS, left);
    sizes.push(size);
    left -= size;
  }
  let i = 0;
  for (const size of sizes) {
    const chunk = singles.slice(i, i + size);
    i += size;
    list.push({
      id: chunk.length === 1 ? chunk[0].id : `more|${i}`,
      stem: chunk.length === 1 ? chunk[0].stem : i === size ? 'What else should the report answer?' : 'Anything else?',
      rank: chunk[0].rank,
      all: chunk.map((g) => g.all[0]),
    });
  }
  list.sort((a, b) => a.rank - b.rank);

  // Too few questions: a topic with more than three answers is asked twice.
  const out = [];
  for (const g of list) out.push({ id: g.id, stem: g.stem, rank: g.rank, options: g.all.slice(0, OPTIONS), rest: g.all.slice(OPTIONS) });
  for (let i = 0; out.length < MIN_QUESTIONS && i < out.length; i++) {
    const g = out[i];
    if (!g.rest.length) continue;
    const options = g.rest.slice(0, OPTIONS);
    const second = { id: `${g.id}|2`, stem: `And one more — ${lowerFirst(g.stem)}`, rank: g.rank + 0.5, options, rest: g.rest.slice(OPTIONS) };
    g.rest = [];
    out.splice(i + 1, 0, second);
  }

  return out.slice(0, MAX_QUESTIONS).map(({ id, stem, options }) => ({
    id,
    stem,
    options,
    preferred: (options.find((o) => o.recommended) || options[0]).id,
  }));
}

/**
 * The suggestions an answer can be made of: those that draw something. A
 * split the measure's scope leaves with one group, or a count of rows in a
 * table where every row is one thing, compiles to nothing, and an answer that
 * builds no chart is a question wasted. An outcome's overall rate stays: it is
 * answered by a headline figure rather than a chart. Read on the same sample
 * the catalogue scores from, so a quarter of a million rows stays quick.
 */
export function answerable(suggestions, rows, model) {
  const sample = sampleOf(rows);
  return (suggestions || []).filter((q) => {
    if (q.intent === 'custom' || (q.intent === 'outcome-rate' && !q.by)) return true;
    try {
      return compileQuestion(q, sample, model).length > 0;
    } catch {
      return false;
    }
  });
}

/** The answers "Choose for me" gives: the preferred option of every question. */
export function preferredAnswers(questionnaire) {
  return Object.fromEntries(questionnaire.map((mcq) => [mcq.id, { choice: mcq.preferred }]));
}

/**
 * The report's questions from a set of answers. An answer is
 * `{ choice: optionId }`, `{ choice: 'other', question }` (the reader's own,
 * already read into a question), or absent — skipped.
 */
export function answeredQuestions(questionnaire, answers = {}) {
  const out = [];
  const seen = new Set();
  for (const mcq of questionnaire) {
    const a = answers[mcq.id];
    if (!a?.choice) continue;
    const q = a.choice === 'other' ? a.question : mcq.options.find((o) => o.id === a.choice);
    if (!q || seen.has(q.id)) continue;
    seen.add(q.id);
    out.push(q);
  }
  return out;
}
