import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  ANALYZE,
  INGEST_FILES,
  INGEST_REMOTE,
  stepIndexFor,
} from '../lib/progressSteps.js';

/* Keeping the panel's plan and the engine's stages in step.
 *
 * The failure this guards against is silent: rename a stage in the worker,
 * leave the plan alone, and the checklist simply stops advancing at that point.
 * Nothing throws, no chart is wrong, and the panel keeps showing a plausible
 * screen — it just stays on step two for the rest of the job.
 *
 * So rather than restate the strings here, this reads the two files that emit
 * them and asserts every stage is claimed by exactly one step. */

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

/**
 * Stage names the worker emits.
 *
 * `progress(id, 'X', …)` and `unitProgress(fraction, 'X', …)`, both of which
 * appear wrapped across lines, so the whitespace is matched loosely.
 */
function workerStages() {
  const src = read('../app/workers/engine.worker.js');
  const found = new Set();
  for (const m of src.matchAll(/\bprogress\(\s*id,\s*'([^']+)'/g)) found.add(m[1]);
  for (const m of src.matchAll(/\bunitProgress\([^,]+,\s*'([^']+)'/g)) found.add(m[1]);
  return [...found];
}

/** Stage names the analysis pipeline emits, including the templated one. */
function pipelineStages() {
  const src = read('../lib/pipeline.js');
  const found = new Set();
  for (const m of src.matchAll(/stage:\s*'([^']+)'/g)) found.add(m[1]);
  // `stage: `Querying: ${title}`` — keep the literal prefix, drop the hole.
  for (const m of src.matchAll(/stage:\s*`([^${`]*)\$\{/g)) found.add(`${m[1]}<title>`);
  return [...found];
}

/* Stages that deliberately belong to no plan.
 *
 * `Sanitizing & redacting` comes from the cleaner's own progress channel, which
 * reports row batches to the caller rather than steps to the panel. It is
 * listed by name so that adding a genuinely unclaimed stage still fails. */
const UNPLANNED = new Set(['Sanitizing & redacting']);

const ALL_PLANS = [INGEST_FILES, INGEST_REMOTE, ANALYZE];

test('every stage the worker emits belongs to a step of some plan', () => {
  const stages = workerStages();
  // If the regexes ever stop matching, the test would pass vacuously.
  assert.ok(stages.length >= 8, `only found ${stages.length} worker stages — the scan is broken`);

  for (const stage of stages) {
    if (UNPLANNED.has(stage)) continue;
    const claimed = ALL_PLANS.some((plan) => stepIndexFor(plan, stage) > -1);
    assert.ok(claimed, `no step claims the worker stage "${stage}"`);
  }
});

test('every stage the analysis pipeline emits belongs to a step', () => {
  const stages = pipelineStages();
  assert.ok(stages.length >= 4, `only found ${stages.length} pipeline stages — the scan is broken`);

  for (const stage of stages) {
    if (UNPLANNED.has(stage)) continue;
    const claimed = ALL_PLANS.some((plan) => stepIndexFor(plan, stage) > -1);
    assert.ok(claimed, `no step claims the pipeline stage "${stage}"`);
  }
});

test('the templated query stage is matched by its prefix, whatever the title', () => {
  // The one stage whose text is not known ahead of time.
  for (const title of ['Revenue by region', 'Churn vs tenure', '']) {
    assert.equal(stepIndexFor(ANALYZE, `Querying: ${title}`), 1);
  }
});

test('no stage is claimed by two steps of the same plan', () => {
  for (const plan of ALL_PLANS) {
    const seen = new Map();
    for (const step of plan) {
      for (const stage of step.stages || []) {
        assert.equal(seen.get(stage), undefined, `"${stage}" is claimed by two steps`);
        seen.set(stage, step.id);
      }
    }
  }
});

test('an unknown stage leaves the checklist where it was', () => {
  // The panel treats -1 as "keep the step you were on". A stage nobody planned
  // for must not reset the list to the beginning, which is what a 0 would do.
  assert.equal(stepIndexFor(INGEST_FILES, 'Sanitizing & redacting'), -1);
  assert.equal(stepIndexFor(INGEST_FILES, 'Something new'), -1);
  assert.equal(stepIndexFor(INGEST_FILES, ''), -1);
  assert.equal(stepIndexFor(undefined, 'Reading data'), -1);
});

test('every plan ends on Ready, and every step is uniquely identified', () => {
  for (const plan of ALL_PLANS) {
    assert.deepEqual(plan.at(-1).stages, ['Ready']);
    const ids = plan.map((s) => s.id);
    assert.equal(new Set(ids).size, ids.length, `duplicate step id in ${ids.join(',')}`);
    for (const step of plan) {
      assert.ok(step.label && step.label.length > 2, `step ${step.id} has no label`);
    }
  }
});

test('a remote ingest does not show a file-reading step it will never run', () => {
  // The rows arrive already parsed from the database driver; there is nothing
  // to read or delimit, and a step that can never light up is worse than absent.
  assert.equal(stepIndexFor(INGEST_REMOTE, 'Reading data'), -1);
  assert.equal(stepIndexFor(INGEST_FILES, 'Reading data'), 0);
});
