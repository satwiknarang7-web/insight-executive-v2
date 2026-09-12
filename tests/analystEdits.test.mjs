import test from 'node:test';
import assert from 'node:assert/strict';
import {
  alternativeTypes,
  editBriefing,
  acceptEdits,
  applyEdits,
  reorderStoryboard,
} from '../lib/analystEdits.js';

/**
 * The agent that edits the deck rather than describing it.
 *
 * Every other model pass here writes text over numbers somebody else verified.
 * This one changes the artefact, so the tests are mostly about what it CANNOT
 * do: invent a chart type, invent a figure, or lose a slide.
 */

const slide = (over = {}) => ({
  id: over.id || 'c1',
  pageTitle: over.title || 'Sum of Amount by Region',
  findings: { metrics: { evidence: 'strong' } },
  chart: {
    title: over.title || 'Sum of Amount by Region',
    chart_type: over.chart_type || 'bar',
    dimension: over.dimension || 'Region',
    xAxisKey: over.dimension || 'Region',
    yAxisKey: 'Total_Amount',
    resultData: new Array(over.drawn ?? 5),
    sql: over.sql || 'SELECT Region, SUM(Total_Amount) FROM t GROUP BY Region',
  },
});

const profile = { dimensions: ['Region', 'Year'], measures: ['Total_Amount'], temporal: ['Year'] };

// ---------------------------------------------------------------------------
// What a chart is allowed to become
// ---------------------------------------------------------------------------

test('a category is never drawn as a path', () => {
  // A line between two bars asserts that the gap between them means something.
  // Between January and February it does; between North and South it does not.
  const types = alternativeTypes(slide().chart, profile);
  assert.ok(!types.includes('line'));
  assert.ok(!types.includes('area'));
  assert.ok(types.includes('hbar'));
});

test('a series over time may become a line', () => {
  const chart = slide({ dimension: 'Year', drawn: 12 }).chart;
  const types = alternativeTypes(chart, profile);
  assert.ok(types.includes('line'));
  assert.ok(types.includes('area'));
  // But periods are not slices of one whole.
  assert.ok(!types.includes('donut'));
  assert.ok(!types.includes('pie'));
});

test('a truncated ranking is never a share of anything', () => {
  // The top ten of a distribution do not add up to the distribution, so a
  // reader shown them as slices is shown a whole that does not exist.
  const chart = slide({ sql: 'SELECT Region, SUM(x) FROM t GROUP BY Region LIMIT 10' }).chart;
  assert.ok(!alternativeTypes(chart, profile).some((t) => ['pie', 'donut', 'treemap'].includes(t)));
});

test('a wheel of forty slices is not a reading of anything', () => {
  const many = slide({ drawn: 40 }).chart;
  assert.ok(!alternativeTypes(many, profile).includes('donut'));
  const few = slide({ drawn: 5 }).chart;
  assert.ok(alternativeTypes(few, profile).includes('donut'));
});

test('a chart whose type IS the finding has no alternatives', () => {
  // Swapping a waterfall or a map does not restyle the chart, it changes what
  // the chart claims — so those are simply not on the menu.
  for (const chart_type of ['waterfall', 'scatter', 'filledmap', 'matrix', 'funnel']) {
    assert.deepEqual(alternativeTypes(slide({ chart_type }).chart, profile), [], chart_type);
  }
});

// ---------------------------------------------------------------------------
// The briefing
// ---------------------------------------------------------------------------

test('the briefing carries the shape and none of the numbers', () => {
  const brief = editBriefing({ storyboard: [slide(), slide({ id: 'c2', dimension: 'Year' })], profile });
  assert.equal(brief.slides.length, 2);
  assert.equal(brief.slides[0].title, 'Sum of Amount by Region');
  assert.ok(Array.isArray(brief.slides[0].alternatives));
  // `drawn` is a count of rows, not a row. Nothing else numeric goes across.
  const sent = JSON.stringify(brief);
  assert.ok(!sent.includes('resultData'));
  assert.ok(!sent.includes('sql'));
});

// ---------------------------------------------------------------------------
// What survives validation
// ---------------------------------------------------------------------------

const brief = (storyboard) => editBriefing({ storyboard, profile }).slides;

test('a better heading is accepted', () => {
  const board = [slide()];
  const ops = acceptEdits([{ op: 'retitle', id: 'c1', title: 'Where the money comes from', why: 'names the subject' }], {
    slides: brief(board),
    profile,
  });
  assert.equal(ops.length, 1);
  assert.equal(ops[0].title, 'Where the money comes from');
});

test('a heading with a figure in it is dropped', () => {
  // It was shown no values, so the number came from nowhere. This is the one
  // failure the project will not ship, and it is checkable rather than asked for.
  const board = [slide()];
  const ops = acceptEdits(
    [
      { op: 'retitle', id: 'c1', title: 'Region drives 62% of revenue' },
      { op: 'retitle', id: 'c1', title: 'x'.repeat(200) },
    ],
    { slides: brief(board), profile }
  );
  assert.deepEqual(ops, []);
});

test('a digit that is part of a real column name is not an invention', () => {
  const p = { ...profile, measures: ['Q4_Revenue'] };
  const board = [slide()];
  const ops = acceptEdits([{ op: 'retitle', id: 'c1', title: 'Q4_Revenue by region' }], {
    slides: editBriefing({ storyboard: board, profile: p }).slides,
    profile: p,
  });
  assert.equal(ops.length, 1);
});

test('two slides cannot end up under one heading', () => {
  const board = [slide(), slide({ id: 'c2', title: 'Revenue by year', dimension: 'Year' })];
  const ops = acceptEdits([{ op: 'retitle', id: 'c1', title: 'Revenue by year' }], {
    slides: brief(board),
    profile,
  });
  assert.deepEqual(ops, []);
});

test('a chart type off that slide\'s menu was never a legal move', () => {
  const board = [slide()];
  const ops = acceptEdits(
    [
      { op: 'chart_type', id: 'c1', chart_type: 'line' }, // a category, not a series
      { op: 'chart_type', id: 'c1', chart_type: 'sunburst' }, // not a type at all
      { op: 'chart_type', id: 'nope', chart_type: 'donut' }, // not a slide
    ],
    { slides: brief(board), profile }
  );
  assert.deepEqual(ops, []);
});

test('a legal type swap is accepted, once per slide', () => {
  const board = [slide({ dimension: 'Year', drawn: 12 })];
  const ops = acceptEdits(
    [
      { op: 'chart_type', id: 'c1', chart_type: 'line', why: 'a series over time' },
      { op: 'chart_type', id: 'c1', chart_type: 'area' },
    ],
    { slides: brief(board), profile }
  );
  assert.equal(ops.length, 1);
  assert.equal(ops[0].chart_type, 'line');
});

test('rubbish is survivable', () => {
  assert.deepEqual(acceptEdits(null, { slides: [] }), []);
  assert.deepEqual(acceptEdits([null, 'x', {}, { op: 'delete', id: 'c1' }], { slides: brief([slide()]) }), []);
});

test('a flood is capped', () => {
  const board = Array.from({ length: 30 }, (_, i) => slide({ id: `c${i}` }));
  const many = board.map((s, i) => ({ op: 'retitle', id: `c${i}`, title: `Heading ${'x'.repeat(i + 1)}` }));
  assert.ok(acceptEdits(many, { slides: brief(board), profile }).length <= 8);
});

// ---------------------------------------------------------------------------
// Applying them
// ---------------------------------------------------------------------------

test('an edit lands the way a person\'s edit lands', () => {
  // Through `updateSlide`, recorded in `slide.edits` — which is what makes it
  // show as modified, survive a re-run, and be undoable by hand.
  const board = applyEdits([slide()], [{ op: 'retitle', id: 'c1', title: 'Where the money comes from' }]);
  assert.equal(board[0].pageTitle, 'Where the money comes from');
  assert.equal(board[0].chart.title, 'Where the money comes from');
  assert.deepEqual([...board[0].edits].sort(), ['chart.title', 'pageTitle']);
});

test('no operation can reach a number', () => {
  const before = slide();
  const board = applyEdits(
    [before],
    [
      { op: 'retitle', id: 'c1', title: 'Revenue by region' },
      { op: 'chart_type', id: 'c1', chart_type: 'hbar' },
    ]
  );
  // The rows and the query that produced them are untouched, because the
  // whitelist in storyboardEdits has no key that reaches them.
  assert.equal(board[0].chart.sql, before.chart.sql);
  assert.equal(board[0].chart.resultData, before.chart.resultData);
  assert.deepEqual(board[0].findings, before.findings);
});

test('reordering cannot lose a slide', () => {
  const board = ['c1', 'c2', 'c3', 'c4'].map((id) => slide({ id }));
  // A partial order is honoured: the named ones move up, the rest hold station.
  const out = reorderStoryboard(board, ['c3', 'c1']);
  assert.deepEqual(out.map((s) => s.id), ['c3', 'c1', 'c2', 'c4']);
  assert.equal(out.length, board.length);
});

test('an order naming one slide is not an order', () => {
  const board = ['c1', 'c2'].map((id) => slide({ id }));
  assert.deepEqual(acceptEdits([{ op: 'reorder', order: ['c1'] }], { slides: brief(board), profile }), []);
  // Unknown ids are dropped, and what is left has to still be a reordering.
  assert.deepEqual(acceptEdits([{ op: 'reorder', order: ['c1', 'zz'] }], { slides: brief(board), profile }), []);
});

test('an empty answer leaves the deck exactly as the engine built it', () => {
  const board = [slide(), slide({ id: 'c2' })];
  assert.deepEqual(applyEdits(board, []), board);
  assert.deepEqual(applyEdits(board, acceptEdits([], { slides: brief(board), profile })), board);
});
