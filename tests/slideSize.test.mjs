/**
 * How much of a dashboard row a finding takes.
 *
 * The model is four sizes and a default, and the default is load-bearing: a
 * deck made before sizing existed, and one the analyst builds without setting
 * a size, has to lay out exactly as it always did. The rest of this file pins
 * that a size survives being set, and survives a re-run — which it only does
 * because it is on the whitelist `reapplyEdits` reads.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_SLIDE_SIZE,
  SLIDE_SIZES,
  isSlideSize,
  nextSlideSize,
  slideSize,
} from '../lib/slideSize.js';
import { reapplyEdits, updateSlide } from '../lib/storyboardEdits.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

test('four sizes, each with a span, a height and something to call it', () => {
  assert.deepEqual(SLIDE_SIZES.map((s) => s.id), ['small', 'medium', 'large', 'full']);
  for (const s of SLIDE_SIZES) {
    assert.ok(s.label && s.blurb, `${s.id} has nothing to call it`);
    assert.match(s.span, /^slide-/, `${s.id} has no span class`);
    assert.match(s.height, /^h-/, `${s.id} has no height`);
  }
  // Distinct spans, or two sizes are the same size.
  const spans = SLIDE_SIZES.map((s) => s.span);
  assert.equal(new Set(spans).size, spans.length);
});

test('a slide that sets no size lays out as it always did', () => {
  assert.equal(DEFAULT_SLIDE_SIZE, 'medium');
  assert.equal(slideSize(undefined).id, 'medium');
  assert.equal(slideSize(null).id, 'medium');
  assert.equal(slideSize('enormous').id, 'medium', 'a size nothing defines is the default, not a crash');
  assert.equal(isSlideSize('full'), true);
  assert.equal(isSlideSize('Full'), false);
});

test('the cycle goes round', () => {
  assert.equal(nextSlideSize('small'), 'medium');
  assert.equal(nextSlideSize('full'), 'small', 'it wraps rather than stopping');
  assert.equal(nextSlideSize('nonsense'), 'large', 'from the default');
});

test('every span class the model names is styled, at more than one width', () => {
  const css = read('../app/globals.css');
  for (const s of SLIDE_SIZES) {
    assert.ok(css.includes(`.${s.span}`), `${s.span} has no rule`);
  }
  // A grid that never changes column count is a grid that is wrong on a phone.
  const block = css.slice(css.indexOf('.slide-small'));
  assert.match(block, /@media \(min-width: 1280px\)/);
});

test('a size set on a slide is kept, and marked as the reader\'s own edit', () => {
  const board = [{ id: 's1', pageTitle: 'A finding', chart: { title: 'A finding' } }];
  const [slide] = updateSlide(board, 's1', { size: 'full' });
  assert.equal(slide.size, 'full');
  assert.ok(slide.edits.includes('size'));
});

test('a size survives a re-run, which is the whole reason it is on the whitelist', () => {
  const previous = [
    { id: 's1', pageTitle: 'Revenue by region', chart: { title: 'Revenue by region' }, size: 'full', edits: ['size'] },
  ];
  // A re-run rebuilds every slide from scratch, with a new id.
  const fresh = [{ id: 's9', pageTitle: 'Revenue by region', chart: { title: 'Revenue by region' } }];
  const [merged] = reapplyEdits(fresh, previous);
  assert.equal(merged.size, 'full', 'the re-run threw away the size the reader chose');
});

test('a field that is not on the whitelist still cannot be set', () => {
  const board = [{ id: 's1', pageTitle: 'A finding' }];
  const [slide] = updateSlide(board, 's1', { size: 'large', resultData: [{ hacked: true }] });
  assert.equal(slide.size, 'large');
  assert.equal(slide.resultData, undefined, 'the whitelist stopped meaning anything');
});
