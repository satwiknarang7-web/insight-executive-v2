import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTableModel } from '../lib/tableModel.js';
import { suggestQuestions } from '../lib/questionCatalogue.js';
import { compileQuestion } from '../lib/questionCompiler.js';
import { MAX_QUESTIONS, MIN_QUESTIONS, OPTIONS, answeredQuestions, buildQuestionnaire, preferredAnswers } from '../lib/questionnaire.js';

/* The question card asks five to ten multiple-choice questions, each with up
   to three answers from the table (the card adds "Other"), instead of a
   checklist of every suggestion. */

function sales() {
  let s = 7;
  const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  return Array.from({ length: 600 }, (_, i) => ({
    order_id: `O${i}`,
    order_date: `2026-${String(1 + (i % 12)).padStart(2, '0')}-${String(1 + (i % 27)).padStart(2, '0')}`,
    region: ['North', 'South', 'East', 'West'][i % 4],
    category: ['Home', 'Toys', 'Garden', 'Books', 'Sport'][i % 5],
    channel: ['Web', 'Store', 'Phone'][i % 3],
    revenue: Math.round(50 + rand() * 900),
    units_sold: 1 + Math.floor(rand() * 9),
    discount_pct: Math.round(rand() * 30),
  }));
}

test('a table with several measures and splits is asked five to ten questions of three answers', () => {
  const rows = sales();
  const suggestions = suggestQuestions(rows, buildTableModel(rows, { temporal: ['order_date'] }));
  const mcqs = buildQuestionnaire(suggestions);
  assert.ok(mcqs.length >= MIN_QUESTIONS && mcqs.length <= MAX_QUESTIONS, `${mcqs.length} questions`);
  for (const m of mcqs) {
    assert.ok(m.options.length >= 1 && m.options.length <= OPTIONS, m.stem);
    assert.ok(m.options.some((o) => o.id === m.preferred), m.stem);
  }
  // Most offer the full three.
  assert.ok(mcqs.filter((m) => m.options.length === OPTIONS).length >= MIN_QUESTIONS - 1);
  // No stem is asked twice, and no answer appears under two questions.
  assert.equal(new Set(mcqs.map((m) => m.stem)).size, mcqs.length);
  const ids = mcqs.flatMap((m) => m.options.map((o) => o.id));
  assert.equal(new Set(ids).size, ids.length);
});

test('every answer compiles into a chart', () => {
  const rows = sales();
  const model = buildTableModel(rows, { temporal: ['order_date'] });
  const mcqs = buildQuestionnaire(suggestQuestions(rows, model));
  for (const q of mcqs.flatMap((m) => m.options)) {
    assert.ok(compileQuestion(q, rows, model).length >= 1, q.text);
  }
});

test('never more than ten, however many suggestions there are', () => {
  const many = Array.from({ length: 60 }, (_, i) => ({ id: `compare|m${i % 20}|d${i}`, intent: 'compare', measure: `m${i % 20}`, by: `d${i}`, text: `q${i}` }));
  assert.equal(buildQuestionnaire(many).length, MAX_QUESTIONS);
});

test('a topic with one answer is asked together with others, not alone', () => {
  const qs = [
    { id: 'a', intent: 'relationship', measure: 'x', other: 'y', text: 'rel' },
    { id: 'b', intent: 'ratio', measure: 'x', other: 'y', by: 'd', text: 'ratio' },
    { id: 'c', intent: 'items', items: ['q1', 'q2', 'q3'], text: 'items' },
  ];
  const mcqs = buildQuestionnaire(qs);
  assert.equal(mcqs.length, 1);
  assert.deepEqual(mcqs[0].options.map((o) => o.id), ['a', 'b', 'c']);
});

test('answers become the report questions: a choice, an Other, or a skip', () => {
  const rows = sales();
  const mcqs = buildQuestionnaire(suggestQuestions(rows, buildTableModel(rows, { temporal: ['order_date'] })));
  const own = { id: 'custom|average revenue by channel', intent: 'custom', text: 'average revenue by channel' };
  const answers = { [mcqs[0].id]: { choice: mcqs[0].options[1].id }, [mcqs[1].id]: { choice: 'other', question: own } };
  assert.deepEqual(answeredQuestions(mcqs, answers).map((q) => q.id), [mcqs[0].options[1].id, own.id]);
  assert.equal(answeredQuestions(mcqs, preferredAnswers(mcqs)).length, mcqs.length);
  assert.deepEqual(answeredQuestions(mcqs, {}), []);
});
