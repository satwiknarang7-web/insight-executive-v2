import test from 'node:test';
import assert from 'node:assert/strict';

import { acceptBrief, briefIsUseful } from '../lib/datasetBrief.js';
import { determines, isBandingOf, outcomeGroups, outcomeSpread } from '../lib/chartSignals.js';
import { outcomeAggregate, outcomeVariable } from '../lib/measureSemantics.js';
import { profileColumns } from '../lib/chartResolver.js';

/* The gate between what a model says a dataset is about and what the planner
   is allowed to believe.

   `tests/corpus.test.mjs` proves the whole thing works on real files. This
   proves the individual refusals are the refusals they claim to be, on rows
   built to trigger exactly one each — because a gate that rejects everything
   passes an end-to-end test about the one thing it should reject. */

/** Occupations with a real relationship between title and automation risk. */
function jobs(n = 600) {
  let seed = 11;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const titles = ['Retail Worker', 'Driver', 'Teacher', 'Surgeon', 'Researcher'];
  const risk = { 'Retail Worker': 0.85, Driver: 0.78, Teacher: 0.3, Surgeon: 0.12, Researcher: 0.15 };
  const rows = [];
  for (let i = 0; i < n; i++) {
    const title = titles[Math.floor(rnd() * titles.length)];
    const p = Math.min(0.99, Math.max(0.01, risk[title] + (rnd() - 0.5) * 0.12));
    rows.push({
      Job_Title: title,
      Education: ['School', 'Bachelor', 'Master', 'PhD'][Math.floor(rnd() * 4)],
      Salary: Math.round(30000 + rnd() * 120000),
      Automation_Probability: Math.round(p * 1000) / 1000,
      // Banded from the probability, which makes it a restatement of it.
      Risk_Band: p >= 0.6 ? 'High' : p >= 0.25 ? 'Medium' : 'Low',
    });
  }
  return rows;
}

const rows = jobs();
const profile = profileColumns(rows);
const accept = (raw) => acceptBrief(raw, { rows, profile });

test('a continuous outcome is accepted where the flag lexicon finds nothing', () => {
  // The whole failure in one assertion: no list of English nouns contains
  // "automation probability", and the column is not a two-level flag, so the
  // pre-existing detector returns null on a file that plainly has an outcome.
  const lexical = outcomeVariable({ columns: Object.keys(rows[0]), sample: rows, cardinality: profile.cardinality });
  assert.equal(lexical, null, 'the lexicon should still find nothing here');

  const brief = accept({
    outcomes: [{ column: 'Automation_Probability', kind: 'continuous', high_is_good: false }],
  });
  assert.equal(brief.outcomes.length, 1);
  assert.equal(brief.outcomes[0].kind, 'continuous');

  const found = outcomeVariable({ brief });
  assert.equal(found.column, 'Automation_Probability');
  assert.equal(found.source, 'brief');
});

test('a column that does not exist is dropped, not guessed at', () => {
  const brief = accept({ outcomes: [{ column: 'Automation_Risk_Score', kind: 'continuous' }] });
  assert.equal(brief.outcomes.length, 0);
  assert.match(brief.dropped[0].reason, /no column by that name/i);
});

test('a column name spelled with spaces still resolves', () => {
  // The one difference models reliably get wrong, and it is unambiguous to undo.
  const brief = accept({ outcomes: [{ column: 'automation probability', kind: 'continuous' }] });
  assert.equal(brief.outcomes[0]?.column, 'Automation_Probability');
});

test('a claimed shape the rows contradict is dropped', () => {
  const brief = accept({ outcomes: [{ column: 'Automation_Probability', kind: 'binary', event: 'Yes' }] });
  assert.equal(brief.outcomes.length, 0);
  assert.match(brief.dropped[0].reason, /not 2/i);
});

test('a category wearing numbers is not a continuous outcome', () => {
  const ratings = Array.from({ length: 400 }, (_, i) => ({ Rating: (i % 5) + 1, Region: i % 2 ? 'N' : 'S' }));
  const brief = acceptBrief(
    { outcomes: [{ column: 'Rating', kind: 'continuous' }] },
    { rows: ratings, profile: profileColumns(ratings) }
  );
  assert.equal(brief.outcomes.length, 0);
  assert.match(brief.dropped[0].reason, /category, not a quantity/i);
});

test('but few distinct values in a small table is still a measurement', () => {
  // Nine scores across forty-four rows is a real measurement. A flat cut at
  // twelve rejected it, and that rejection lost the column a comparison table
  // exists to rank on.
  const plans = Array.from({ length: 44 }, (_, i) => ({
    Plan: `P${i}`,
    Score: 30 + (i % 9) * 3,
  }));
  const brief = acceptBrief(
    { outcomes: [{ column: 'Score', kind: 'continuous' }] },
    { rows: plans, profile: profileColumns(plans) }
  );
  assert.equal(brief.outcomes.length, 1, brief.dropped[0]?.reason);
});

test('an outcome another column merely bands is refused', () => {
  const brief = accept({
    outcomes: [{ column: 'Risk_Band', kind: 'ordinal', event: 'High', high_is_good: false }],
  });
  assert.equal(brief.outcomes.length, 0);
  assert.match(brief.dropped[0].reason, /determines it/i);
});

test('a level the column does not hold is refused rather than substituted', () => {
  const brief = accept({
    outcomes: [{ column: 'Education', kind: 'multiclass', event: 'Doctorate' }],
  });
  assert.equal(brief.outcomes.length, 0);
  assert.match(brief.dropped[0].reason, /is not one of its values/i);
});

test('a driver that does not move the outcome is dropped however sure the model was', () => {
  const brief = accept({
    outcomes: [{ column: 'Automation_Probability', kind: 'continuous' }],
    roles: { Job_Title: 'driver', Salary: 'driver', Education: 'attribute' },
  });
  assert.equal(brief.roles.Job_Title, 'driver', 'job title genuinely moves it');
  assert.equal(brief.roles.Salary, undefined, 'salary is random here and should not survive');
  assert.equal(brief.roles.Education, 'attribute', 'a non-driver role is not measured against anything');
});

test('an empty brief is the same thing as no brief', () => {
  const brief = accept({ outcomes: [], roles: {}, questions: [] });
  assert.equal(briefIsUseful(brief), false);
  assert.equal(outcomeVariable({ brief, columns: [], sample: [], cardinality: {} }), null);
});

test('nothing at all is handled rather than thrown at', () => {
  for (const junk of [null, undefined, 'not an object', 42, []]) {
    const brief = acceptBrief(junk, { rows, profile });
    assert.equal(brief.outcomes.length, 0);
  }
});

/* ------------------------------------------------------------------ */

test('a banding is recognised whatever the sample size', () => {
  // Cramer's V answers this correctly on the full table and incorrectly on a
  // subsample of it, which is how the tautology reached a deck as its lead
  // slide. The interval test does not depend on how much was sampled.
  assert.equal(isBandingOf(rows, 'Risk_Band', 'Automation_Probability'), true);
  assert.equal(isBandingOf(rows.slice(0, 120), 'Risk_Band', 'Automation_Probability'), true);
  assert.equal(determines(rows.slice(0, 120), 'Risk_Band', 'Automation_Probability'), true);

  // And a category that genuinely differs on a measure is not a banding of it:
  // its ranges overlap, which is what makes the chart worth drawing.
  assert.equal(isBandingOf(rows, 'Job_Title', 'Automation_Probability'), false);
  assert.equal(determines(rows, 'Job_Title', 'Automation_Probability'), false);
});

test('a continuous outcome is aggregated as a mean and named as one', () => {
  const agg = outcomeAggregate({ column: 'Automation_Probability', kind: 'continuous' });
  assert.match(agg.expr, /^AVG\(/);
  assert.match(agg.name, /^Average /);
  assert.equal(agg.format, 'number');
});

test('a level outcome is aggregated as a share and named for the level', () => {
  const agg = outcomeAggregate({
    column: 'Risk_Band',
    kind: 'ordinal',
    event: 'High',
    valueType: 'string',
  });
  assert.match(agg.expr, /SUM\(CASE WHEN/);
  assert.equal(agg.format, 'percent');
  // Named for the answer, not the question: "Risk Band Rate" does not say which
  // of Low, Medium and High the bars are counting.
  assert.match(agg.name, /high/i);
});

test('group means are scored, where a share expression would score zero', () => {
  const asShares = outcomeGroups(rows, 'Job_Title', 'Automation_Probability', null);
  assert.equal(outcomeSpread(asShares), 0, 'counting equality against a probability matches nothing');

  const asMeans = outcomeGroups(rows, 'Job_Title', 'Automation_Probability', null, { kind: 'continuous' });
  assert.ok(asMeans.length >= 2);
  assert.ok(asMeans.every((g) => Number.isFinite(g.sd)), 'a mean needs its own spread to be judged');
  assert.ok(outcomeSpread(asMeans) > 0.2, 'a real difference across job titles should score');
});

test('a continuous outcome that is the same everywhere scores nothing', () => {
  const flat = rows.map((r) => ({ ...r, Automation_Probability: 0.5 }));
  const groups = outcomeGroups(flat, 'Job_Title', 'Automation_Probability', null, { kind: 'continuous' });
  assert.equal(outcomeSpread(groups), 0);
});

test('a blank outcome value is not counted as a zero', () => {
  // Counting blanks as zeros drags a group's mean toward the origin in
  // proportion to how much of the column is missing, which reads as a real
  // difference between segments and is an artefact of the gaps.
  const withGaps = rows.map((r, i) => (i % 3 ? r : { ...r, Automation_Probability: '' }));
  const groups = outcomeGroups(withGaps, 'Job_Title', 'Automation_Probability', null, { kind: 'continuous' });
  for (const g of groups) assert.ok(g.rate > 0.05, `${g.label} collapsed toward zero`);
});
