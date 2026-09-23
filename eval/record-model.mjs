/**
 * Record what a real model proposes for every corpus file, so the scorecard can
 * score the model path without calling a model.
 *
 * The prompt, the briefing and the call are the app's own: questionsPrompt and
 * QUESTIONS_SYSTEM from lib/modelQuestions.js, the value briefing the question
 * card sends, the catalogue the worker builds, and generateJson from
 * lib/llm.server.js with its model list. What is saved is the raw reply —
 * unchecked, exactly as the route would return it — in
 * tests/corpus/<name>.model.json. The scorecard puts it through
 * acceptModelQuestions, the gate the worker uses, so a recording is never
 * trusted either.
 *
 * Costs money: one model call per corpus file, on a key from the environment.
 *
 *     node --env-file=.env.local eval/record-model.mjs            every file
 *     node --env-file=.env.local eval/record-model.mjs gen_saas   one file
 *
 * Re-record when the prompt changes; the scorecard reports which prompt a
 * recording was made with.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import { ingest } from './chain.mjs';
import { profileColumns } from '../lib/chartResolver.js';
import { valueVocabulary, valuesBriefing } from '../lib/valueBriefing.js';
import { buildTableModel } from '../lib/tableModel.js';
import { outcomeVariable } from '../lib/measureSemantics.js';
import { suggestQuestions } from '../lib/questionCatalogue.js';
import { QUESTIONS_SYSTEM, questionsPrompt } from '../lib/modelQuestions.js';
import { generateJson, serverModelKey } from '../lib/llm.server.js';

const CORPUS = path.join(import.meta.dirname, '..', 'tests', 'corpus');

/** Everything the card would send for one file: the briefing, the grain, the list. */
export function cardInput(rows, fileName) {
  const profile = profileColumns(rows);
  const model = buildTableModel(rows, { temporal: profile.temporal || [] });
  const cardinality = Object.fromEntries(Object.entries(model.columns).map(([c, info]) => [c, info.distinct]));
  const outcome = outcomeVariable({ columns: Object.keys(model.columns), sample: rows.slice(0, 500), cardinality });
  const catalogue = suggestQuestions(rows, model, { outcome });
  const briefing = valuesBriefing({ vocabulary: valueVocabulary(rows, profile), profile });
  const prompt = questionsPrompt({
    ...briefing,
    fileName,
    rowCount: rows.length,
    grain: { kind: model.grain.kind, why: model.grain.why },
    catalogue: catalogue.map((q) => ({ id: q.id, text: q.text })),
  });
  return { model, catalogue, prompt };
}

/** Which prompt a recording was made with, so a stale one is visible. */
export const promptVersion = () => crypto.createHash('sha256').update(QUESTIONS_SYSTEM).digest('hex').slice(0, 12);

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const credential = serverModelKey();
  if (!credential) {
    console.error('No model key in the environment. Run with --env-file=.env.local.');
    process.exit(1);
  }
  const only = process.argv[2] || null;
  for (const file of fs.readdirSync(CORPUS).filter((f) => f.endsWith('.csv')).sort()) {
    const name = file.replace(/\.csv$/, '');
    if (only && !name.includes(only)) continue;
    const { rows } = ingest(fs.readFileSync(path.join(CORPUS, file), 'utf8'));
    const { prompt } = cardInput(rows, file);
    const started = Date.now();
    const proposal = await generateJson(prompt, QUESTIONS_SYSTEM, credential);
    const out = { provider: credential.provider, prompt: promptVersion(), recordedAt: new Date().toISOString().slice(0, 10), proposal };
    fs.writeFileSync(path.join(CORPUS, `${name}.model.json`), JSON.stringify(out, null, 2) + '\n');
    const picks = proposal?.pick?.length || 0;
    const added = proposal?.add?.length || 0;
    console.log(`${name.padEnd(28)} ${proposal ? `${picks} picks, ${added} added` : 'NO ANSWER'}  ${Date.now() - started}ms`);
  }
}
