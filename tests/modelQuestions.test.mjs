import test from 'node:test';
import assert from 'node:assert/strict';

import { buildTableModel } from '../lib/tableModel.js';
import { suggestQuestions } from '../lib/questionCatalogue.js';
import { compileQuestion } from '../lib/questionCompiler.js';
import { acceptModelQuestions, mergeSuggestions, questionsPrompt, QUESTIONS_SYSTEM } from '../lib/modelQuestions.js';
import { modelCredential, serverModelKey } from '../lib/llm.server.js';

/* A model's questions, phase 4 of docs/design/question-first-reports.md.
 * Nothing a model proposes reaches the card without passing
 * acceptModelQuestions against the rows; these are the proposals it must
 * refuse, and why, and the ones it must keep. */

const range = (n, f) => Array.from({ length: n }, (_, i) => f(i));

// A priced table with a scoped price: per-user and per-instance plans.
const plans = () =>
  range(24, (i) => ({
    provider: `P${i % 4}`,
    plan: `T${Math.floor(i / 4)}`,
    buyer_unit: i % 3 ? 'user' : 'instance',
    audience: i % 2 ? 'Individual' : 'Business',
    price_usd: i % 3 ? 20 + i : 2500 + i,
    score: 40 + (i % 9),
    sso: i % 2 ? 'Yes' : 'No',
  }));

const setup = (rows) => {
  const model = buildTableModel(rows);
  return { rows, model, catalogue: suggestQuestions(rows, model) };
};

test('a pick must be a question that was on the list', () => {
  const ctx = setup(plans());
  const real = ctx.catalogue[0].id;
  const out = acceptModelQuestions({ pick: [real, 'made|up|id'] }, ctx);
  assert.deepEqual(out.picks.map((q) => q.id), [real]);
  assert.match(out.dropped[0].reason, /not a question on the list/);
});

test('a new question naming a column the table does not have is refused by name', () => {
  const ctx = setup(plans());
  const out = acceptModelQuestions({ add: [{ text: 'Revenue by region', intent: 'compare', measure: 'revenue', by: 'region' }] }, ctx);
  assert.equal(out.added.length, 0);
  assert.match(out.dropped[0].reason, /"revenue" is not a column/);
});

test('a column of the wrong kind for the intent is refused', () => {
  const ctx = setup(plans());
  // A price is never summed, so it cannot be the total a composition splits.
  const out = acceptModelQuestions({ add: [{ text: 'Where does price come from', intent: 'composition', measure: 'price_usd', by: 'provider' }] }, ctx);
  assert.equal(out.added.length, 0);
  assert.match(out.dropped[0].reason, /wrong kind/);
});

test('an outcome must be a two-level column and the event one of its values', () => {
  const ctx = setup(plans());
  const out = acceptModelQuestions(
    {
      add: [
        { text: 'a', intent: 'outcome-rate', outcome: { column: 'provider', event: 'P1' }, by: 'audience' },
        { text: 'b', intent: 'outcome-rate', outcome: { column: 'sso', event: 'Maybe' }, by: 'audience' },
        { text: 'c', intent: 'nonsense' },
      ],
    },
    ctx
  );
  assert.equal(out.added.length, 0);
  assert.match(out.dropped[0].reason, /4 values, not two/);
  assert.match(out.dropped[1].reason, /"Maybe" is not a value of sso/);
  assert.match(out.dropped[2].reason, /not one the engine answers/);
});

test('a well-formed question the table cannot draw is refused', () => {
  // Every name is right and every kind fits — but within per-user plans every
  // audience is Individual, so "price by audience, like for like" has one
  // group, and the compiler draws nothing. The compiler is the last word.
  const rows = plans().map((r) => ({ ...r, audience: r.buyer_unit === 'user' ? 'Individual' : 'Business' }));
  const ctx = setup(rows);
  const out = acceptModelQuestions({ add: [{ text: 'Price by audience', intent: 'compare', measure: 'price_usd', by: 'audience' }] }, ctx);
  assert.equal(out.added.length, 0);
  assert.equal(out.picks.length, 0);
  assert.match(out.dropped[0].reason, /nothing this table can draw/);
});

test('a valid new question is kept, and still compiles under the rules', () => {
  const ctx = setup(plans());
  const out = acceptModelQuestions(
    { add: [{ text: 'Which audience pays more, like for like?', intent: 'compare', measure: 'price_usd', by: 'provider' }] },
    ctx
  );
  // The catalogue may already offer price by provider; either way the model's
  // question arrives, as a pick or as its own.
  const q = out.added[0] || out.picks.find((p) => p.intent === 'compare' && p.measure === 'price_usd');
  assert.ok(q, JSON.stringify(out.dropped));
  // The model did not ask for a scope. The compiler adds it: a per-user price
  // is never averaged with a per-instance one, whoever asked.
  const [spec] = compileQuestion(q, ctx.rows, ctx.model);
  assert.match(spec.sql, /WHERE \[buyer_unit\] = 'user'/);
});

test('a re-proposal of a listed question is a pick, however it is worded', () => {
  const ctx = setup(plans());
  const listed = ctx.catalogue.find((q) => q.intent === 'compare');
  const out = acceptModelQuestions({ add: [{ text: 'Reworded', intent: 'compare', measure: listed.measure, by: listed.by }] }, ctx);
  assert.equal(out.added.length, 0);
  assert.ok(out.picks.some((q) => q.id === listed.id));
});

test('the model’s questions lead the card, ticked; with nothing usable the card is the catalogue', () => {
  const ctx = setup(plans());
  const pick = ctx.catalogue[ctx.catalogue.length - 1];
  const merged = mergeSuggestions(ctx.catalogue, acceptModelQuestions({ pick: [pick.id] }, ctx));
  assert.equal(merged[0].id, pick.id);
  assert.equal(merged[0].source, 'model');
  assert.equal(merged[0].recommended, true);
  assert.ok(merged.slice(1).every((q) => !q.recommended), 'the catalogue ticks nothing once a model has chosen');
  assert.equal(merged.length, ctx.catalogue.length);

  assert.equal(mergeSuggestions(ctx.catalogue, acceptModelQuestions({ pick: ['nope'] }, ctx)), ctx.catalogue);
  assert.equal(mergeSuggestions(ctx.catalogue, acceptModelQuestions(null, ctx)), ctx.catalogue);
});

test('the prompt shows the table and the list, and asks for the typed form', () => {
  const prompt = questionsPrompt({
    columns: [{ name: 'price_usd', kind: 'number', range: { min: 1, max: 9, median: 5 } }],
    sample: [{ price_usd: 3 }],
    catalogue: [{ id: 'compare|price_usd|provider', text: 'How does price compare?' }],
  });
  assert.match(prompt, /- price_usd \(number\)/);
  assert.match(prompt, /- compare\|price_usd\|provider: How does price compare\?/);
  assert.match(QUESTIONS_SYSTEM, /"intent"/);
  assert.match(QUESTIONS_SYSTEM, /you never state a number/);
});

/* ── Whose key ─────────────────────────────────────────────────────────── */

const request = (headers = {}) => ({ headers: { get: (k) => headers[k.toLowerCase()] || '' } });
const env = { ANTHROPIC_API_KEY: `sk-ant-${'a'.repeat(40)}`, GEMINI_API_KEY: `AIza${'b'.repeat(35)}` };

test('a reader’s own key always wins, on any plan', async () => {
  const own = request({ 'x-gemini-key': `AIza${'c'.repeat(35)}` });
  for (const plan of ['free', 'pro', null]) {
    const c = await modelCredential(own, { plan, env });
    assert.equal(c?.source, 'reader', `plan ${plan}`);
  }
});

test('the deployment’s key serves Pro, and nobody else', async () => {
  assert.deepEqual(await modelCredential(request(), { plan: 'pro', env }), { provider: 'anthropic', key: env.ANTHROPIC_API_KEY, source: 'server' });
  assert.equal(await modelCredential(request(), { plan: 'free', env }), null);
  // No accounts on this deployment: no plan to be Pro on, so never.
  assert.equal(await modelCredential(request(), { plan: null, env }), null);
  assert.equal(await modelCredential(request(), { plan: 'pro', env: {} }), null);
});

test('SERVER_MODEL_PROVIDER chooses among configured keys; an empty one is no key', () => {
  assert.equal(serverModelKey({ ...env, SERVER_MODEL_PROVIDER: 'google' }).provider, 'google');
  assert.equal(serverModelKey({ ANTHROPIC_API_KEY: '', GEMINI_API_KEY: env.GEMINI_API_KEY }).provider, 'google');
  assert.equal(serverModelKey({ ANTHROPIC_API_KEY: '' }), null);
});
