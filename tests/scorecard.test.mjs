import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { BASELINE, scorecard, summarise } from '../eval/scorecard.mjs';
import { ingest } from '../eval/chain.mjs';
import { RULES } from '../eval/audit.mjs';

/* The scorecard as a ratchet.
 *
 * `eval/scorecard.mjs` measures two things on every corpus file and every fuzz
 * table: which of the file's questions the report answers, and how many times
 * it breaks one of the rules in `eval/audit.mjs`. `eval/scorecard.baseline.json`
 * is the last measurement someone accepted.
 *
 * This fails when the engine gets worse on either — a question that used to be
 * answered no longer is, or a rule is broken more often — and ALSO when it gets
 * better without the baseline being moved. The second is what makes it a
 * ratchet: a gain nobody locked in is a gain the next change can quietly give
 * back. Either way the fix is one command:
 *
 *     npm run eval:baseline
 *
 * and the baseline diff goes in the same commit as the change that earned it.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CORPUS = path.join(HERE, 'corpus');
const GRAINS = new Set(['entity', 'event', 'entityPeriod', 'long', 'response', 'observation']);

const baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
const current = summarise(scorecard());

function compare(group) {
  const worse = [];
  const better = [];
  const now = current[group];
  const then = baseline[group] || {};
  for (const name of new Set([...Object.keys(now), ...Object.keys(then)])) {
    if (!then[name]) {
      better.push(`${name} is new`);
      continue;
    }
    if (!now[name]) {
      worse.push(`${name} is no longer scored`);
      continue;
    }
    for (const p of new Set([...Object.keys(now[name]), ...Object.keys(then[name])])) {
      const a = then[name][p];
      const b = now[name][p];
      const where = `${name} · ${p}`;
      if (!a || !b) {
        (b ? better : worse).push(`${where} ${b ? 'added' : 'removed'}`);
        continue;
      }
      if (b.error && !a.error) worse.push(`${where} now throws: ${b.error}`);
      for (const id of a.answered) if (!b.answered.includes(id)) worse.push(`${where}: no longer answers "${id}"`);
      for (const id of b.answered) if (!a.answered.includes(id)) better.push(`${where}: now answers "${id}"`);
      for (const rule of Object.keys(RULES)) {
        const was = a.rules[rule] || 0;
        const is = b.rules[rule] || 0;
        if (is > was) worse.push(`${where}: ${rule} ${was} → ${is} (${RULES[rule]})`);
        if (is < was) better.push(`${where}: ${rule} ${was} → ${is}`);
      }
    }
  }
  return { worse, better };
}

for (const group of ['corpus', 'fuzz']) {
  test(`scorecard (${group}): nothing got worse than the baseline`, () => {
    const { worse } = compare(group);
    assert.deepEqual(worse, [], `regressions against eval/scorecard.baseline.json:\n  ${worse.join('\n  ')}`);
  });

  test(`scorecard (${group}): every gain is locked into the baseline`, () => {
    const { better } = compare(group);
    assert.deepEqual(
      better,
      [],
      `the engine improved — run \`npm run eval:baseline\` and commit the baseline with the change:\n  ${better.join('\n  ')}`
    );
  });
}

/* An expectation that names a column the file does not have can never be met,
 * and it fails quietly — the question just reads as unanswered forever. So the
 * names are checked against the columns the app's ingest actually produces. */
for (const file of fs.readdirSync(CORPUS).filter((f) => f.endsWith('.csv')).sort()) {
  const name = file.replace(/\.csv$/, '');
  test(`corpus expectation for ${name} names real columns`, () => {
    const spec = JSON.parse(fs.readFileSync(path.join(CORPUS, `${name}.expect.json`), 'utf8'));
    assert.ok(spec.report, `${name}.expect.json has no report section`);
    const { rows } = ingest(fs.readFileSync(path.join(CORPUS, file), 'utf8'));
    const columns = new Set(Object.keys(rows[0] || {}));
    const report = spec.report;
    const named = [
      report.time,
      ...(report.outcomes || []),
      ...Object.keys(report.measures || {}),
      ...Object.values(report.measures || {}).flatMap((m) => [...(m.scope || []), ...(m.noSumAcross || [])]),
      report.long?.value,
      report.long?.by,
      ...(report.questions || []).flatMap((q) => [...(q.answeredBy || []).flat(), ...(q.by || []), ...(q.over || []), ...(q.scope || [])]),
    ].filter((c) => c && c !== 'COUNT(*)');
    const missing = [...new Set(named.filter((c) => !columns.has(c)))];
    assert.deepEqual(missing, [], `not columns of ${name} after ingest`);

    assert.ok(GRAINS.has(report.grain), `grain "${report.grain}" is not one of ${[...GRAINS].join(', ')}`);
    const ids = (report.questions || []).map((q) => q.id);
    assert.equal(new Set(ids).size, ids.length, 'question ids repeat');
    assert.ok(ids.length > 0, 'a report with no questions measures nothing');
  });
}
