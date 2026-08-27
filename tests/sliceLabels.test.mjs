import test from 'node:test';
import assert from 'node:assert/strict';
import { MIN_LABEL_GAP, labelledSlices, legendRows } from '../lib/sliceLabels.js';

test('a few slices are all labelled', () => {
  assert.deepEqual([...labelledSlices([50, 30, 20])].sort(), [0, 1, 2]);
  assert.deepEqual([...labelledSlices([60, 40])].sort(), [0, 1]);
});

test('a sliver too thin to letter is left unlabelled', () => {
  // 1% of a circle is under four degrees. Its label is the least interesting
  // number on the chart and the most likely to land on its neighbour's.
  const keep = labelledSlices([50, 46, 1, 1, 1, 1]);
  assert.ok(keep.has(0));
  assert.ok(keep.has(1));
  assert.ok(!keep.has(2));
  assert.ok(!keep.has(5));
});

test('the reported case: a long tail no longer overprints', () => {
  // What a real categorical breakdown looks like past ten categories — a few
  // that matter and a tail of slivers. Twelve *equal* slices are evenly spread
  // around the circle and never collided; it is the tail that bunches up.
  const values = [420, 210, 150, 90, 60, 20, 12, 9, 7, 5, 4, 3];
  const keep = labelledSlices(values, { radius: 100 });

  assert.ok(keep.size > 0, 'something is still labelled');
  assert.ok(keep.size < values.length, 'the tail is not');
  assert.ok(keep.has(0) && keep.has(1), 'the categories worth reading keep their numbers');
  assert.ok(!keep.has(11), 'a 0.3% sliver does not');
});

test('no distribution produces a collision', () => {
  // The invariant, over shapes that actually turn up: even, long-tailed,
  // one-dominant, and a pile of near-identical slivers.
  const shapes = [
    Array.from({ length: 12 }, () => 100),
    [420, 210, 150, 90, 60, 20, 12, 9, 7, 5, 4, 3],
    [900, 20, 18, 16, 14, 12, 10, 8, 6, 4],
    Array.from({ length: 25 }, (_, i) => 100 - i * 3),
    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  ];

  for (const values of shapes) {
    const radius = 100;
    const keep = labelledSlices(values, { radius });
    const total = values.reduce((a, b) => a + b, 0);
    const sides = { left: [], right: [] };
    let swept = 0;
    values.forEach((value, i) => {
      const share = value / total;
      const mid = 90 - (swept + (share * 360) / 2);
      swept += share * 360;
      if (!keep.has(i)) return;
      const rad = (mid * Math.PI) / 180;
      sides[Math.cos(rad) >= 0 ? 'right' : 'left'].push(-radius * Math.sin(rad));
    });

    for (const ys of Object.values(sides)) {
      const sorted = [...ys].sort((a, b) => a - b);
      for (let i = 1; i < sorted.length; i++) {
        assert.ok(
          sorted[i] - sorted[i - 1] >= MIN_LABEL_GAP,
          `${values.length} slices: labels ${sorted[i - 1].toFixed(1)} and ${sorted[i].toFixed(1)} collide`
        );
      }
    }
  }
});

test('no two kept labels sit on top of each other', () => {
  const values = [30, 25, 20, 8, 6, 4, 3, 2, 1, 1];
  const radius = 100;
  const keep = labelledSlices(values, { radius });

  // Recompute where each kept label lands and check the gaps, per side.
  const total = values.reduce((a, b) => a + b, 0);
  const left = [];
  const right = [];
  let swept = 0;
  values.forEach((value, i) => {
    const share = value / total;
    const mid = 90 - (swept + (share * 360) / 2);
    swept += share * 360;
    if (!keep.has(i)) return;
    const rad = (mid * Math.PI) / 180;
    (Math.cos(rad) >= 0 ? right : left).push(-radius * Math.sin(rad));
  });

  for (const side of [left, right]) {
    const sorted = [...side].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) {
      assert.ok(
        sorted[i] - sorted[i - 1] >= MIN_LABEL_GAP,
        `labels ${sorted[i - 1]} and ${sorted[i]} are too close`
      );
    }
  }
});

test('the biggest slice keeps its number when two compete for the space', () => {
  const keep = labelledSlices([40, 30, 15, 7.5, 7.5]);
  assert.ok(keep.has(0), 'the largest is always worth reading');
});

test('a busy right-hand side does not thin out the left', () => {
  // The two halves cannot collide with each other, so they are budgeted apart.
  // Six equal slices puts three on each side with room for all of them.
  const keep = labelledSlices([100, 100, 100, 100, 100, 100], { radius: 120 });
  assert.equal(keep.size, 6);
});

test('degenerate input does not throw', () => {
  assert.equal(labelledSlices([]).size, 0);
  assert.equal(labelledSlices(null).size, 0);
  assert.equal(labelledSlices([0, 0, 0]).size, 0);
  assert.equal(labelledSlices(['nonsense', undefined, null]).size, 0);
});

test('a legend earns a second row and never a third', () => {
  assert.equal(legendRows(2), 1);
  assert.equal(legendRows(4), 1, 'one row while one row is enough');
  assert.equal(legendRows(6), 2);
  assert.equal(legendRows(12), 2);
  assert.equal(legendRows(40), 2, 'past two rows it scrolls rather than eating the plot');
});
