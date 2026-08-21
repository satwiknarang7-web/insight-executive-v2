import test from 'node:test';
import assert from 'node:assert/strict';
import {
  updateSlide,
  removeSlide,
  createSlide,
  insertSlide,
  nextCustomId,
  reapplyEdits,
} from '../lib/storyboardEdits.js';

const board = () => [
  {
    id: 'slide_1',
    pageTitle: 'Revenue by Region',
    chart: { id: 'slide_1', title: 'Revenue by Region', chart_type: 'bar', xAxisKey: 'region', yAxisKey: 'Total' },
    edits: [],
  },
  {
    id: 'slide_2',
    pageTitle: 'Revenue Over Time',
    chart: { id: 'slide_2', title: 'Revenue Over Time', chart_type: 'line', xAxisKey: 'month', yAxisKey: 'Total' },
    edits: [],
  },
];

test('a saved chart type lands on the slide and is recorded as an edit', () => {
  const next = updateSlide(board(), 'slide_1', { chart: { chart_type: 'donut' } });
  assert.equal(next[0].chart.chart_type, 'donut');
  assert.ok(next[0].edits.includes('chart.chart_type'));
  assert.equal(next[1].chart.chart_type, 'line', 'other slides are untouched');
});

test('colours and notes are saved on the slide', () => {
  const next = updateSlide(board(), 'slide_1', {
    analystNotes: 'Watch the West region.',
    chart: { colors: ['#ff0000', '#00ff00'] },
  });
  assert.equal(next[0].analystNotes, 'Watch the West region.');
  assert.deepEqual(next[0].chart.colors, ['#ff0000', '#00ff00']);
  assert.deepEqual(next[0].edits.sort(), ['analystNotes', 'chart.colors']);
});

test('unknown fields are ignored rather than merged', () => {
  const next = updateSlide(board(), 'slide_1', { __proto__hack: 1, resultData: [], chart: { sql: 'DROP TABLE x' } });
  assert.equal(next[0].resultData, undefined);
  assert.equal(next[0].chart.sql, undefined, 'the query is not user-editable');
  assert.deepEqual(next[0].edits, []);
});

test('an unknown id changes nothing', () => {
  const before = board();
  assert.deepEqual(updateSlide(before, 'nope', { pageTitle: 'x' }), before);
  assert.deepEqual(removeSlide(before, 'nope'), before);
});

test('deleting a slide removes exactly that slide', () => {
  const next = removeSlide(board(), 'slide_1');
  assert.equal(next.length, 1);
  assert.equal(next[0].id, 'slide_2');
});

test('a custom slide carries the engine-verified findings', () => {
  const chart = { chart_type: 'bar', xAxisKey: 'tier', yAxisKey: 'Revenue', resultData: [{ tier: 'SMB', Revenue: 10 }] };
  const finding = {
    headline: 'SMB leads on revenue.',
    detail: 'It contributes 62% of the total.',
    recommendation: 'Check margin by tier.',
    verifiedFacts: ['SMB = 10', 'Total = 16'],
    metrics: { leader: 'SMB' },
  };
  const slide = createSlide({ storyboard: board(), chart, finding, title: 'Revenue by Tier' });

  assert.equal(slide.id, 'custom_1');
  assert.equal(slide.custom, true);
  assert.equal(slide.pageTitle, 'Revenue by Tier');
  assert.equal(slide.insight_anchor, 'SMB leads on revenue.');
  assert.deepEqual(slide.findings.verifiedFacts, ['SMB = 10', 'Total = 16']);
  assert.match(slide.markdownAnalysis, /Verified metrics/);
  assert.equal(slide.chart.id, 'custom_1', 'the chart id must match the slide id');
});

test('custom ids do not collide with existing ones', () => {
  const withCustom = [...board(), { id: 'custom_1' }, { id: 'custom_2' }];
  assert.equal(nextCustomId(withCustom), 'custom_3');
});

test('a slide can be inserted at a position or appended', () => {
  const slide = { id: 'custom_1' };
  assert.equal(insertSlide(board(), slide)[2].id, 'custom_1');
  assert.equal(insertSlide(board(), slide, 0)[0].id, 'custom_1');
  assert.equal(insertSlide(board(), slide, 99)[2].id, 'custom_1', 'out of range appends');
});

// ---------------------------------------------------------------------------
// The regression that matters most: Re-run must not undo saved work.
// ---------------------------------------------------------------------------

test('re-running the analysis keeps saved edits', () => {
  const edited = updateSlide(board(), 'slide_1', {
    pageTitle: 'Regional Performance',
    analystNotes: 'Board asked about this.',
    chart: { chart_type: 'treemap', colors: ['#123456'] },
  });

  // A fresh run produces the same slides with default styling and titles.
  const fresh = board();
  const merged = reapplyEdits(fresh, edited);

  assert.equal(merged[0].pageTitle, 'Regional Performance');
  assert.equal(merged[0].analystNotes, 'Board asked about this.');
  assert.equal(merged[0].chart.chart_type, 'treemap');
  assert.deepEqual(merged[0].chart.colors, ['#123456']);
  assert.equal(merged[1].chart.chart_type, 'line', 'untouched slides take the fresh version');
});

test('edits follow a slide whose id shifted, matched by chart title', () => {
  const edited = updateSlide(board(), 'slide_1', { chart: { chart_type: 'donut' } });
  // A changed dataset renumbers the slides.
  const fresh = [
    { id: 'slide_9', pageTitle: 'Revenue by Region', chart: { title: 'Revenue by Region', chart_type: 'bar' }, edits: [] },
  ];
  const merged = reapplyEdits(fresh, edited);
  assert.equal(merged[0].chart.chart_type, 'donut');
});

test('hand-built charts survive a re-run', () => {
  const custom = createSlide({ storyboard: board(), chart: { chart_type: 'bar' }, finding: null, title: 'Mine' });
  const merged = reapplyEdits(board(), [...board(), custom]);

  assert.equal(merged.length, 3);
  assert.equal(merged[2].id, 'custom_1');
  assert.equal(merged[2].pageTitle, 'Mine');
});

test('a fresh board with no prior edits passes through untouched', () => {
  const fresh = board();
  assert.deepEqual(reapplyEdits(fresh, null), fresh);
  assert.deepEqual(reapplyEdits(fresh, []), fresh);
});
