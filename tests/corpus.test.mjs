import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Papa from 'papaparse';

import { profileColumns } from '../lib/chartResolver.js';
import { acceptBrief } from '../lib/datasetBrief.js';
import { gateRatios } from '../lib/preparation.js';
import { runAnalysis } from '../lib/pipeline.js';

/* Whether a report is about its own dataset.
 *
 * Every other test in this suite checks a unit: does this function return that
 * number. None of them could fail on the thing that actually went wrong, which
 * is that a whole report came out arithmetically perfect and about nothing —
 * 3,000 rows of occupations scored for automation risk, summarised as a
 * histogram of salary divided by years of experience.
 *
 * That failure had no single broken function to point at. The planner, the
 * scorer, the SQL and the prose were all doing exactly what they were written
 * to do; what was missing was any representation of what the file was FOR. A
 * bug of that shape can only be caught end to end, on real files, by asserting
 * about the finished deck.
 *
 * So this is a corpus rather than a unit test. Each `<name>.csv` sits beside a
 * `<name>.expect.json` saying what a correct report on it must and must not
 * contain, and the two are read as data — adding a dataset means adding two
 * files, not writing a test.
 *
 * No model is called. The expectation file carries the brief a correct model
 * would return, so what is under test is the deterministic half: that a right
 * brief produces a report about the right thing, that a wrong claim inside it
 * is caught by `acceptBrief` rather than believed, and that with no brief at
 * all the analysis still degrades to something rather than to nothing.
 *
 * ADDING A DATASET, when a report comes out wrong on one:
 *   1. drop the csv in `tests/corpus/` (subsample it if it is large)
 *   2. write `<name>.expect.json` describing the report it should have produced
 *   3. watch this fail, then fix the engine rather than the expectation
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CORPUS = path.join(HERE, 'corpus');

/** Every dataset in the corpus, as `{ name, rows, expectation }`. */
function corpus() {
  return fs
    .readdirSync(CORPUS)
    .filter((f) => f.endsWith('.csv'))
    .map((file) => {
      const name = file.replace(/\.csv$/, '');
      const expectPath = path.join(CORPUS, `${name}.expect.json`);
      assert.ok(fs.existsSync(expectPath), `${name}.csv has no ${name}.expect.json beside it`);
      const parsed = Papa.parse(fs.readFileSync(path.join(CORPUS, file), 'utf8'), {
        header: true,
        dynamicTyping: true,
        skipEmptyLines: true,
      });
      return {
        name,
        rows: parsed.data,
        spec: JSON.parse(fs.readFileSync(expectPath, 'utf8')),
      };
    });
}

const titles = (result) => (result.charts || []).map((c) => String(c.title || '').toLowerCase());
const labels = (result) => (result.kpis || []).map((k) => String(k.label || '').toLowerCase());

/** The charts that carry real findings, as opposed to the filter tiles. */
const findingTitles = (result) =>
  (result.charts || [])
    .filter((c) => c.chart_type !== 'slicer')
    .map((c) => String(c.title || '').toLowerCase());

for (const { name, rows, spec } of corpus()) {
  const expect = spec.expect || {};

  test(`${name}: the brief survives verification against the rows`, () => {
    const profile = profileColumns(rows);
    const brief = acceptBrief(spec.brief, { rows, profile });

    if (expect.outcome) {
      assert.ok(brief.outcomes.length > 0, 'no outcome survived the gate');
      assert.equal(brief.outcomes[0].column, expect.outcome.column);
      assert.equal(brief.outcomes[0].kind, expect.outcome.kind);
    } else {
      assert.equal(brief.outcomes.length, 0, 'an outcome survived where none should have');
    }

    // And the claims that were supposed to be caught were caught — with the
    // right reason. A claim dropped for the wrong reason is a gate that happens
    // to be right today.
    for (const [claim, because] of Object.entries(expect.dropsClaim || {})) {
      const found = brief.dropped.find((d) => d.claim === claim);
      assert.ok(found, `${claim} should have been dropped and was not`);
      assert.match(found.reason, new RegExp(because, 'i'));
    }
  });

  test(`${name}: the report is about what the dataset is about`, () => {
    const profile = profileColumns(rows);
    const brief = acceptBrief(spec.brief, { rows, profile });
    const result = runAnalysis(rows, { brief });

    assert.ok((result.charts || []).length > 0, 'no charts at all');

    if (expect.leadChartMatches) {
      // The lead is the first chart that states a finding. A slicer is a
      // control, not a claim, and it sorts first on some decks.
      const lead = findingTitles(result)[0] || '';
      assert.match(lead, new RegExp(expect.leadChartMatches, 'i'), `lead chart was "${lead}"`);
    }

    if (expect.kpiMatches) {
      const found = labels(result).some((l) => new RegExp(expect.kpiMatches, 'i').test(l));
      assert.ok(found, `no KPI matched ${expect.kpiMatches}; got ${JSON.stringify(labels(result))}`);
    }

    /* Charts that must not exist. These are the specific wrong answers this
       corpus was built from, named so a regression says which one came back. */
    for (const forbidden of expect.chartsMustNotMatch || []) {
      const re = new RegExp(forbidden, 'i');
      const offender = titles(result).find((t) => re.test(t));
      assert.equal(offender, undefined, `"${offender}" is the finding this corpus exists to prevent`);
    }

    /* And pairs that must not appear in one title: an outcome charted against a
       column computed FROM it is a definition with a chart around it, and it
       arrives tagged as strong evidence because the separation really is total. */
    for (const [a, b] of expect.chartsMustNotPair || []) {
      const offender = titles(result).find((t) => new RegExp(a, 'i').test(t) && new RegExp(b, 'i').test(t));
      assert.equal(offender, undefined, `"${offender}" charts an outcome against its own restatement`);
    }
  });

  if (expect.withoutBriefMustStillChart) {
    test(`${name}: with no model available the analysis still produces a deck`, () => {
      // The deployment as it ships holds no key. Every gain above has to be an
      // addition to this path rather than a replacement for it, or the free
      // deployment silently becomes the broken one.
      const result = runAnalysis(rows, { brief: null });
      assert.ok((result.charts || []).length > 0, 'no charts without a brief');
      assert.ok((result.kpis || []).length > 0, 'no KPIs without a brief');
    });
  }

  for (const ratio of spec.ratioGate || []) {
    test(`${name}: "${ratio.name}" is refused — ${ratio.rejectedBecause}`, () => {
      const step = { kind: 'derive', name: ratio.name, expr: ratio.expr, source: 'model' };
      const { steps, skipped } = gateRatios([step], rows);
      assert.equal(steps.length, 0, 'the unsupported ratio was accepted');
      assert.equal(skipped.length, 1);
      // The reason is asserted, not just the refusal. A ratio rejected for the
      // wrong reason is a gate that happens to be right on this file.
      assert.match(skipped[0].reason, new RegExp(ratio.rejectedBecause, 'i'));
    });

    test(`${name}: "${ratio.name}" typed by a person is left alone`, () => {
      // The gate judges what a model volunteered. A formula somebody wrote is
      // theirs, and a dropped suggestion is invisible where a dropped formula
      // is a bug report.
      const typed = { kind: 'derive', name: ratio.name, expr: ratio.expr, source: 'user' };
      const { steps, skipped } = gateRatios([typed], rows);
      assert.equal(steps.length, 1);
      assert.equal(skipped.length, 0);
    });
  }
}

test('the corpus covers more than one domain', () => {
  // The point of the corpus is that it is not one dataset. A single entry
  // passing proves only that the engine was fixed for that file, which is the
  // treadmill the brief mechanism exists to get off.
  assert.ok(corpus().length >= 2, 'a corpus of one dataset is a fixture, not a corpus');
});
