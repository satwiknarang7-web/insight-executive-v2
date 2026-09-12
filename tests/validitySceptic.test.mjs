import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checkValidity,
  passages,
  scepticQuestions,
  scepticRepairs,
  scepticBriefing,
  acceptScepticQuestions,
} from '../lib/validitySceptic.js';
import { applySceptic } from '../lib/deckRepair.js';

/**
 * A5, which asks what is overstated rather than what is missing.
 *
 * Both defects it was built for came off a real deck. A flat line was written
 * up as "current efforts are not moving the needle" — a claim about effort from
 * a table with no column about effort. And a category 3.7 standard deviations
 * clear of the field carried a recommendation to improve the categories BELOW
 * average, which is the finding's own statistic read backwards.
 *
 * Neither was caught by anything, because everything else checks arithmetic and
 * both sentences were arithmetically fine.
 */

const finding = (over = {}) => ({
  id: over.id || 'c1',
  title: over.title || 'Shipping Cost Rate by Category',
  type: over.type || 'bar',
  dimension: over.dimension || 'Category',
  measure: over.measure || 'Shipping Cost Rate',
  headline: over.headline || 'Books leads categories on shipping cost rate.',
  detail: over.detail || 'The gap is wide enough that the ordering is unlikely to reverse.',
  recommendation: over.recommendation || 'Start with Books, where the rate is highest.',
  metrics: { evidence: 'strong', leader: 'Books', leadOverFieldSd: 3.7, ...over.metrics },
});

// ---------------------------------------------------------------------------
// A cause nothing measured
// ---------------------------------------------------------------------------

test('the engine estimates no causes, so a sentence naming one is unsupported', () => {
  // Not "probably wrong" — claiming a kind of thing nothing here computed,
  // which is what makes it checkable rather than a matter of taste.
  const f = finding({ detail: 'This suggests current efforts are not moving the needle.' });
  const found = checkValidity({ findings: [f] });
  assert.ok(found.some((i) => i.kind === 'causal-claim'));
});

test('every shape of cause is caught, and a ranking is not one', () => {
  const causal = [
    'Revenue fell because of the change in mix.',
    'The drop was driven by Electronics.',
    'This indicates a lack of significant growth drivers.',
    'Higher discounts lead to more returns.',
  ];
  for (const detail of causal) {
    assert.ok(
      checkValidity({ findings: [finding({ detail })] }).some((i) => i.kind === 'causal-claim'),
      detail
    );
  }

  // "Leads" as a ranking verb is the whole reason the pattern is narrow.
  const innocent = [
    'Books leads categories on shipping cost rate at the top of the field.',
    'Electronics leads on total amount, the largest share of any category.',
    'The top two regions together carry most of the total.',
    // Arithmetic, not cause: a dominant component dominates. An earlier version
    // flagged this, and on a real deck that was one false positive in two hits.
    'A change in Electronics will directly dictate overall performance.',
  ];
  for (const detail of innocent) {
    assert.ok(
      !checkValidity({ findings: [finding({ detail })] }).some((i) => i.kind === 'causal-claim'),
      detail
    );
  }
});

test('a cause in a paragraph is disclosed; a cause in a recommendation is cleared', () => {
  // Clearing a discrete field costs a sentence. Cutting a clause out of prose
  // leaves a sentence nobody wrote, so those are left alone and disclosed.
  const prose = checkValidity({ findings: [finding({ detail: 'Revenue fell because of the mix.' })] });
  assert.equal(prose.find((i) => i.kind === 'causal-claim').repair, null);

  const advice = checkValidity({
    findings: [finding({ detail: 'A plain description.', recommendation: 'Fix the mix, which caused the fall.' })],
  });
  assert.equal(advice.find((i) => i.kind === 'causal-claim').repair.op, 'clear_text');
});

test('a repairable claim is not suppressed by an identical one in the prose', () => {
  // One entry per kind per finding, but the entry has to be the one that can be
  // acted on. Read in order, the paragraph comes first and can only be
  // disclosed; the recommendation comes last and is the one that can be cleared.
  const f = finding({
    detail: 'The fall was driven by Electronics.',
    recommendation: 'Address what is driven by Electronics.',
  });
  const item = checkValidity({ findings: [f] }).find((i) => i.kind === 'causal-claim');
  assert.ok(item.repair, 'the clearable one lost to the one that could only be disclosed');
});

test('attributing movement to a component is right where the engine decomposed it', () => {
  // `analyzeContribution` breaks a total's movement into the parts that moved
  // it. On that finding "driven by Electronics" IS the arithmetic; on a ranking
  // or a correlation the same words are a mechanism nobody measured.
  const waterfall = finding({
    title: 'What Moved Total Amount by Month',
    detail: 'The net fall was driven by Electronics.',
    metrics: { largestMoveSharePct: 11.5, grossMovement: 240000000 },
  });
  assert.ok(!checkValidity({ findings: [waterfall] }).some((i) => i.kind === 'causal-claim'));

  const ranking = finding({ detail: 'The net fall was driven by Electronics.' });
  assert.ok(checkValidity({ findings: [ranking] }).some((i) => i.kind === 'causal-claim'));
});

// ---------------------------------------------------------------------------
// A statistic read backwards
// ---------------------------------------------------------------------------

test('effort pointed away from the outlier its own metrics found', () => {
  const f = finding({
    recommendation: 'Improving the 5 categories below average could yield more impact than optimising Books.',
  });
  const item = checkValidity({ findings: [f] }).find((i) => i.kind === 'inverted-effort');
  assert.ok(item, 'the inversion was not noticed');
  assert.equal(item.repair.op, 'clear_text');
  assert.match(item.question, /Books/);
});

test('working on the field is fine when no leader is clear of it', () => {
  // The check is not "never mention the rest of the field" — it is that a
  // finding whose own metrics call one group an outlier must not then point
  // work elsewhere. With a bunched field there is no contradiction.
  const f = finding({
    recommendation: 'Improving the categories below average could yield more impact.',
    metrics: { leadOverFieldSd: 0.4 },
  });
  assert.ok(!checkValidity({ findings: [f] }).some((i) => i.kind === 'inverted-effort'));
});

test('clearing takes the claim off both surfaces it appears on', () => {
  // The recommendation lives twice — as its own field and inside the long
  // write-up under its own heading. Clearing one leaves it on the report page.
  const board = [
    {
      id: 'c1',
      pageTitle: 'Shipping Cost Rate by Category',
      insight_question: 'Improving the 5 categories below average could yield more impact.',
      markdownAnalysis:
        '### Shipping Cost Rate by Category\n\nBooks leads.\n\n**What to do with it**\n\nImproving the 5 categories below average could yield more impact.\n\n**Verified metrics**\n\n- Leader: Books',
      findings: { metrics: { leader: 'Books', leadOverFieldSd: 3.7 } },
      chart: { title: 'Shipping Cost Rate by Category' },
    },
  ];
  const items = checkValidity({ storyboard: board });
  const out = applySceptic({ storyboard: board, items });
  assert.equal(out.storyboard[0].insight_question, '');
  assert.ok(!out.storyboard[0].markdownAnalysis.includes('below average'));
  // And the verified figures it sat over are untouched — they were never in doubt.
  assert.ok(out.storyboard[0].markdownAnalysis.includes('Leader: Books'));
  assert.ok(out.storyboard[0].edits.includes('insight_question'));
});

// ---------------------------------------------------------------------------
// A share of the shown rows, and a correlation over groups
// ---------------------------------------------------------------------------

test('a share of what was shown is not a share of the business', () => {
  const f = finding({
    headline: 'Books accounts for 43% of the total.',
    metrics: { sharesMeasuredAgainst: 'the top 10 shown' },
  });
  assert.ok(checkValidity({ findings: [f] }).some((i) => i.kind === 'shown-as-whole'));
});

test('a share measured against everything may say so', () => {
  const f = finding({
    headline: 'Books accounts for 43% of the total.',
    metrics: { sharesMeasuredAgainst: 'all rows in the dataset' },
  });
  assert.ok(!checkValidity({ findings: [f] }).some((i) => i.kind === 'shown-as-whole'));
});

test('a correlation over group averages is not one over records', () => {
  // The arithmetic is identical, which is why the significance test cannot see
  // it: r over sixty group averages is computed exactly as r over sixty rows.
  const f = finding({ type: 'scatter', metrics: { correlation: 0.82, points: 60 } });
  const board = [{ id: 'c1', chart: { dimension: 'Region' } }];
  const item = checkValidity({ findings: [f], storyboard: board, rowCount: 250000 }).find(
    (i) => i.kind === 'ecological'
  );
  assert.ok(item, 'sixty averages were read as a quarter of a million records');
  assert.equal(item.repair, null, 'nothing here can fix it, so it is disclosed');
});

test('a correlation over the rows themselves is left alone', () => {
  const f = finding({ type: 'scatter', metrics: { correlation: 0.82, points: 900 } });
  assert.ok(!checkValidity({ findings: [f], rowCount: 900 }).some((i) => i.kind === 'ecological'));
});

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

test('both authors are held to the same standard', () => {
  // The engine writes one sentence from the statistics and the narrator rewrites
  // it to read well, which is exactly where a claim grows. One set of checks.
  const board = [{ id: 'c1', insight_implication: 'Revenue fell because of the mix.', chart: { title: 'X' }, findings: { metrics: {} } }];
  const flat = passages({ findings: [finding()], storyboard: board });
  assert.ok(flat.some((p) => p.author === 'engine'));
  assert.ok(flat.some((p) => p.author === 'narrator'));
  assert.ok(checkValidity({ storyboard: board }).some((i) => i.kind === 'causal-claim'));
});

test('one finding raises one of each kind, not one per sentence', () => {
  const f = finding({
    headline: 'Revenue fell because of the mix.',
    detail: 'The fall was driven by Electronics.',
  });
  assert.equal(checkValidity({ findings: [f] }).filter((i) => i.kind === 'causal-claim').length, 1);
});

test('a deck that says only what it measured raises nothing', () => {
  const clean = finding({
    headline: 'Books leads categories on shipping cost rate.',
    detail: 'The leader is clear of the rest of the field.',
    recommendation: 'Start with Books, where the rate is highest.',
    metrics: { evidence: 'strong', leader: 'Books', leadOverFieldSd: 3.7, sharesMeasuredAgainst: 'all rows' },
  });
  assert.deepEqual(checkValidity({ findings: [clean], rowCount: 900 }), []);
  assert.deepEqual(scepticQuestions([]), []);
  assert.deepEqual(scepticRepairs([]), []);
});

test('the questions are capped, and each one is a question', () => {
  const many = Array.from({ length: 12 }, (_, i) =>
    finding({ id: `c${i}`, title: `Finding ${i}`, detail: 'Revenue fell because of the mix.' })
  );
  const qs = scepticQuestions(checkValidity({ findings: many }));
  assert.ok(qs.length <= 5);
  assert.ok(qs.every((q) => q.question.endsWith('?')));
  assert.ok(qs.every((q) => q.source === 'sceptic'));
});

// ---------------------------------------------------------------------------
// The model half
// ---------------------------------------------------------------------------

test('the briefing carries the shape of each claim and none of its numbers', () => {
  const brief = scepticBriefing({
    findings: [finding({ metrics: { evidence: 'strong', leader: 'Books', leadOverFieldSd: 3.7, leaderValue: 2.3 } })],
    profile: { rowCount: 250000 },
  });
  // Statistic NAMES, never their values: "leadOverFieldSd" says a
  // standard-deviation lead was computed, not what it came out as.
  assert.ok(brief.claims[0].statistics.includes('leadOverFieldSd'));
  assert.doesNotMatch(JSON.stringify(brief.claims), /2\.3|3\.7|Books/);
});

test('a doubt with a figure in it was invented', () => {
  const out = acceptScepticQuestions(
    [
      'Is the 43% share measured against every row?',
      'Does this ranking hide a skewed distribution?',
      'This finding is overstated.',
    ],
    { titles: ['Shipping Cost Rate by Category'] }
  );
  assert.equal(out.length, 1);
  assert.match(out[0].question, /skewed/);
});

test('a doubt already on the deck is not asked twice', () => {
  const out = acceptScepticQuestions(['Does this ranking hide a skewed distribution?'], {
    titles: [],
    existing: [{ question: 'Does this ranking hide a skewed distribution?' }],
  });
  assert.deepEqual(out, []);
});

test('rubbish is survivable', () => {
  assert.deepEqual(acceptScepticQuestions(null, {}), []);
  assert.deepEqual(acceptScepticQuestions([null, 1, {}, '', 'not a question'], {}), []);
  assert.deepEqual(checkValidity({}), []);
  assert.deepEqual(applySceptic({}).applied, []);
});
