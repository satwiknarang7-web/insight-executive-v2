import test from 'node:test';
import assert from 'node:assert/strict';
import {
  updateSummary,
  reapplySummaryEdits,
  updateKpi,
  removeKpi,
  addKpi,
  reapplyKpiEdits,
} from '../lib/storyboardEdits.js';

const summary = () => ({
  title: 'Executive Summary',
  headline: 'The dominant story is concentration.',
  macroInsights: ['Electronics leads at 42%.', 'Growth is flat.'],
  strategicScorecard: { focus: 'Diversify', risk: 'One category', opportunity: 'West region' },
});

test('rewriting the summary records which fields the user touched', () => {
  const next = updateSummary(summary(), { headline: 'Growth stalled in Q3.' });
  assert.equal(next.headline, 'Growth stalled in Q3.');
  assert.deepEqual(next.edits, ['headline']);
  // Untouched fields are left exactly as generated.
  assert.equal(next.title, 'Executive Summary');
});

test('a scorecard card is edited without disturbing its siblings', () => {
  const next = updateSummary(summary(), { strategicScorecard: { risk: 'Thin evidence' } });
  assert.equal(next.strategicScorecard.risk, 'Thin evidence');
  assert.equal(next.strategicScorecard.focus, 'Diversify');
  assert.ok(next.edits.includes('strategicScorecard.risk'));
});

test('unknown summary fields are dropped rather than merged', () => {
  const next = updateSummary(summary(), { rowsAnalyzed: 9, macroInsights: ['One point.'] });
  assert.equal(next.rowsAnalyzed, undefined);
  assert.deepEqual(next.macroInsights, ['One point.']);
});

test('a late-arriving narrative does not overwrite edited summary text', () => {
  const edited = updateSummary(summary(), {
    headline: 'My wording.',
    strategicScorecard: { focus: 'My focus.' },
  });

  const fromLlm = {
    ...summary(),
    title: 'What the numbers say',
    headline: 'Model wording.',
    strategicScorecard: { focus: 'Model focus', risk: 'Model risk', opportunity: 'Model upside' },
  };

  const merged = reapplySummaryEdits(fromLlm, edited);
  assert.equal(merged.headline, 'My wording.');
  assert.equal(merged.strategicScorecard.focus, 'My focus.');
  // Anything the user never touched takes the better wording.
  assert.equal(merged.title, 'What the numbers say');
  assert.equal(merged.strategicScorecard.risk, 'Model risk');
});

test('an unedited summary passes through untouched', () => {
  const fresh = summary();
  assert.deepEqual(reapplySummaryEdits(fresh, null), fresh);
  assert.deepEqual(reapplySummaryEdits(fresh, summary()), fresh);
});

const kpis = () => [
  { label: 'Total Revenue', value: '$1.2M' },
  { label: 'Orders', value: '4,300' },
];

test('a renamed KPI remembers what it was generated as', () => {
  const next = updateKpi(kpis(), 0, { label: 'Net revenue' });
  assert.equal(next[0].label, 'Net revenue');
  assert.equal(next[0].origLabel, 'Total Revenue');
  assert.equal(next[0].edited, true);
  assert.deepEqual(next[1], kpis()[1]);
});

test('an out-of-range KPI index is a no-op', () => {
  assert.deepEqual(updateKpi(kpis(), 5, { label: 'x' }), kpis());
  assert.deepEqual(updateKpi(undefined, 0, { label: 'x' }), []);
});

test('a re-run keeps renamed KPIs and honours deleted ones', () => {
  const edited = removeKpi(updateKpi(kpis(), 0, { label: 'Net revenue', value: '$1.3M' }), 1);
  assert.equal(edited.length, 1);

  const merged = reapplyKpiEdits(kpis(), edited);
  assert.equal(merged.length, 1, 'the deleted card stays deleted');
  assert.equal(merged[0].label, 'Net revenue');
  assert.equal(merged[0].value, '$1.3M');
});

test('a different dataset keeps its own KPIs rather than being emptied', () => {
  const previous = removeKpi(kpis(), 1);
  const fresh = [{ label: 'Units shipped', value: '900' }];
  assert.deepEqual(reapplyKpiEdits(fresh, previous), fresh);
});

test('a card can be added to the strip, blank or filled', () => {
  const next = addKpi(kpis());
  assert.equal(next.length, 3);
  assert.deepEqual(next.slice(0, 2), kpis());
  assert.equal(next[2].label, '');
  assert.equal(next[2].value, '');
  assert.equal(next[2].custom, true);

  const filled = addKpi([], { label: 'Churn', value: '4.2%' });
  assert.deepEqual(filled, [{ label: 'Churn', value: '4.2%', custom: true }]);
  assert.equal(addKpi(undefined).length, 1, 'an absent strip is still addable');
});

test('a re-run keeps cards the user added', () => {
  const previous = updateKpi(addKpi(kpis()), 2, { label: 'Churn', value: '4.2%' });
  const merged = reapplyKpiEdits(kpis(), previous);

  assert.equal(merged.length, 3);
  assert.deepEqual(merged.slice(0, 2), kpis(), 'generated cards are regenerated');
  assert.equal(merged[2].label, 'Churn');
  assert.equal(merged[2].custom, true);
});

test('an added card never claims a generated one, or resurrects a deleted one', () => {
  // The user deletes "Orders", then adds their own card and calls it "Orders".
  const previous = updateKpi(addKpi(removeKpi(kpis(), 1)), 1, { label: 'Orders', value: 'by hand' });
  const merged = reapplyKpiEdits(kpis(), previous);

  assert.equal(merged.length, 2, 'the deleted card stays deleted');
  assert.equal(merged[0].label, 'Total Revenue');
  assert.equal(merged[1].value, 'by hand');
  assert.equal(merged[1].custom, true);
});
