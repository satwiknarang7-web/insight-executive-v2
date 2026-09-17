/**
 * How much of a dashboard row a finding takes.
 *
 * This was four named sizes, and four names is not a size control. A card now
 * carries a width in grid columns and a height in pixels, both dragged. What is
 * pinned here: the decks saved under the old names still open at the size they
 * were made at, the bounds hold whatever a save contains, and a size survives a
 * re-run — which it only does because it is on the whitelist `reapplyEdits`
 * reads.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_LAYOUT,
  GRID_COLUMNS,
  MAX_HEIGHT,
  MIN_HEIGHT,
  columnsForWidth,
  describeLayout,
  resizeLayout,
  slideLayout,
  slideStyle,
} from '../lib/slideSize.js';
import { reapplyEdits, updateSlide } from '../lib/storyboardEdits.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

test('a slide that sets no size lays out as it always did', () => {
  assert.deepEqual(DEFAULT_LAYOUT, { cols: 3, height: 192 }, 'half of a six-column row');
  assert.deepEqual(slideLayout(undefined), DEFAULT_LAYOUT);
  assert.deepEqual(slideLayout(null), DEFAULT_LAYOUT);
  assert.deepEqual(slideLayout('enormous'), DEFAULT_LAYOUT, 'a size nothing defines is the default, not a crash');
});

test('the decks saved under the old names open at the size they were made at', () => {
  assert.equal(slideLayout('small').cols, 2);
  assert.equal(slideLayout('medium').cols, 3);
  assert.equal(slideLayout('large').cols, 4);
  assert.equal(slideLayout('full').cols, GRID_COLUMNS);
  // Each of them had its own height, and a full-width card left at a
  // third-width height is the letterbox that sizing existed to avoid.
  const heights = ['small', 'medium', 'large', 'full'].map((id) => slideLayout(id).height);
  assert.deepEqual(heights, [...heights].sort((a, b) => a - b), 'wider cards were taller');
  assert.equal(new Set(heights).size, heights.length);
});

test('a stored size that has drifted out of range is brought back', () => {
  assert.equal(slideLayout({ cols: 99, height: 200 }).cols, GRID_COLUMNS);
  assert.equal(slideLayout({ cols: 0, height: 200 }).cols, 1);
  assert.equal(slideLayout({ cols: 3, height: 10 }).height, MIN_HEIGHT);
  assert.equal(slideLayout({ cols: 3, height: 99999 }).height, MAX_HEIGHT);
  assert.equal(slideLayout({ cols: 'three', height: 'tall' }).cols, 1, 'nonsense is clamped, not passed through');
});

test('one edge moves and the other stays', () => {
  const from = { cols: 3, height: 200 };
  assert.deepEqual(resizeLayout(from, { cols: 5 }), { cols: 5, height: 200 });
  assert.deepEqual(resizeLayout(from, { height: 320 }), { cols: 3, height: 320 });
  assert.deepEqual(resizeLayout(from, {}), from);
  assert.deepEqual(resizeLayout('full', { height: 400 }), { cols: 6, height: 400 });
});

test('the width travels as two numbers, one per breakpoint', () => {
  // An inline style has no media queries, so JS writes the cap for each one.
  assert.deepEqual(slideStyle({ cols: 5, height: 200 }), { '--span-md': 2, '--span-xl': 5 });
  assert.deepEqual(slideStyle({ cols: 1, height: 200 }), { '--span-md': 1, '--span-xl': 1 });
});

test('dragging an edge lands on the column it covers', () => {
  // Six tracks and five 16px gaps in a 1000px grid: a track is 153.3px.
  const grid = { gridWidth: 1000, columns: 6, gap: 16 };
  assert.equal(columnsForWidth(153, grid), 1);
  assert.equal(columnsForWidth(322, grid), 2, 'two tracks and the gap between them');
  assert.equal(columnsForWidth(1000, grid), 6);
  assert.equal(columnsForWidth(4000, grid), 6, 'past the last column is the last column');
  assert.equal(columnsForWidth(-50, grid), 1, 'and past the first is the first');
  // A grid that has not been measured yet must not produce a zero-column card.
  assert.equal(columnsForWidth(500, { gridWidth: 0, columns: 6 }), 1);
});

test('the size says what it is, for the control that cannot be seen', () => {
  assert.equal(describeLayout({ cols: 3, height: 192 }), '3 of 6 columns · 192px tall');
});

test('the tile class is styled, at more than one width', () => {
  const css = read('../app/globals.css');
  assert.ok(css.includes('.slide-tile'), 'the tile has no rule');
  const block = css.slice(css.indexOf('.slide-tile'));
  assert.match(block, /@media \(min-width: 768px\)/);
  assert.match(block, /@media \(min-width: 1280px\)/);
  assert.match(block, /var\(--span-md/);
  assert.match(block, /var\(--span-xl/);
});

test("a size set on a slide is kept, and marked as the reader's own edit", () => {
  const board = [{ id: 's1', pageTitle: 'A finding', chart: { title: 'A finding' } }];
  const [slide] = updateSlide(board, 's1', { size: { cols: 6, height: 400 } });
  assert.deepEqual(slide.size, { cols: 6, height: 400 });
  assert.ok(slide.edits.includes('size'));
});

test('a size survives a re-run, which is the whole reason it is on the whitelist', () => {
  const previous = [
    {
      id: 's1',
      pageTitle: 'Revenue by region',
      chart: { title: 'Revenue by region' },
      size: { cols: 6, height: 420 },
      edits: ['size'],
    },
  ];
  // A re-run rebuilds every slide from scratch, with a new id.
  const fresh = [{ id: 's9', pageTitle: 'Revenue by region', chart: { title: 'Revenue by region' } }];
  const [merged] = reapplyEdits(fresh, previous);
  assert.deepEqual(merged.size, { cols: 6, height: 420 }, 'the re-run threw away the size the reader chose');
});

test('a field that is not on the whitelist still cannot be set', () => {
  const board = [{ id: 's1', pageTitle: 'A finding' }];
  const [slide] = updateSlide(board, 's1', { size: { cols: 4, height: 300 }, resultData: [{ hacked: true }] });
  assert.deepEqual(slide.size, { cols: 4, height: 300 });
  assert.equal(slide.resultData, undefined, 'the whitelist stopped meaning anything');
});
