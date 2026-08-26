import test from 'node:test';
import assert from 'node:assert/strict';
import { xAxisGeometry, yAxisGeometry, legendProps, chartMargin, LEGEND_H, clip } from '../components/charts/axis.js';

const rows = (labels, key = 'region', value = 'Total') =>
  labels.map((l, i) => ({ [key]: l, [value]: (i + 1) * 1000 }));

test('short labels stay flat and keep a shallow gutter', () => {
  const geo = xAxisGeometry(rows(['N', 'S', 'E', 'W']), 'region');
  assert.equal(geo.rotated, false);
  assert.equal(geo.props.angle, 0);
  assert.ok(geo.bottom < 40, `expected a shallow gutter, got ${geo.bottom}`);
});

test('long labels rotate instead of being cut off', () => {
  const geo = xAxisGeometry(rows(['Enterprise - North America', 'SMB - EMEA', 'Mid-Market - APAC']), 'region');
  assert.equal(geo.rotated, true);
  assert.equal(geo.props.angle, -35);
  assert.equal(geo.props.textAnchor, 'end');
  // The reserved gutter has to actually grow, or rotating just moves the clipping.
  assert.ok(geo.bottom > 60, `expected a deep gutter for long labels, got ${geo.bottom}`);
});

test('many short labels still rotate, because they collide', () => {
  const geo = xAxisGeometry(rows(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct']), 'region');
  assert.equal(geo.rotated, true);
});

test('the gutter is capped so a chart is never all axis', () => {
  const monster = 'A'.repeat(200);
  const geo = xAxisGeometry(rows([monster, 'B', 'C']), 'region');
  assert.ok(geo.bottom <= 130, `gutter must be capped, got ${geo.bottom}`);
});

test('every tick is labelled until the axis is genuinely crowded', () => {
  assert.equal(xAxisGeometry(rows(['A', 'B', 'C']), 'region').props.interval, 0);
  const many = rows(Array.from({ length: 40 }, (_, i) => `L${i}`));
  assert.equal(xAxisGeometry(many, 'region').props.interval, 'preserveStartEnd');
});

test('truncation is a last resort, not the default', () => {
  const label = 'Enterprise - North America'; // 26 chars
  const geo = xAxisGeometry(rows([label]), 'region');
  assert.equal(geo.props.tickFormatter(label), label, 'a 26-character label must survive intact');
  // The old behaviour cut everything at 16 characters.
  assert.notEqual(geo.props.tickFormatter(label), 'Enterprise - No…');
});

test('only genuinely unrenderable labels are clipped', () => {
  assert.equal(clip('short'), 'short');
  assert.equal(clip('B'.repeat(40)), `${'B'.repeat(27)}…`);
});

test('the y gutter grows to fit the widest formatted tick', () => {
  const small = yAxisGeometry(rows(['A', 'B']).map((r) => ({ ...r, Total: 5 })), 'Total');
  const large = yAxisGeometry(rows(['A', 'B']).map((r) => ({ ...r, Total: 1234567890 })), 'Total');
  assert.ok(large.width > small.width, 'wide numbers need a wider gutter');
  assert.ok(large.width <= 96, 'but never an absurd one');
  assert.ok(small.width >= 40, 'and never so narrow the ticks clip');
});

test('a single series gets no legend', () => {
  assert.equal(legendProps({ seriesCount: 1 }), null);
  const two = legendProps({ seriesCount: 2 });
  assert.equal(two.height, LEGEND_H);
  // The old legend reserved 40px of *padding* and still overlapped the plot.
  assert.ok(two.wrapperStyle.paddingBottom <= 12);
});

test('a legend is never taller than one row, however many series', () => {
  // A vertical legend with no cap grew to 144px on a 224px card and squeezed
  // the plot into what was left.
  const many = legendProps({ seriesCount: 12 });
  assert.equal(many.layout, 'horizontal');
  assert.equal(many.height, LEGEND_H);
  assert.equal(many.wrapperStyle.maxHeight, LEGEND_H);
  assert.equal(many.wrapperStyle.overflow, 'hidden');
});

test('a small card gets no legend at all', () => {
  assert.equal(legendProps({ seriesCount: 6, compact: true }), null);
});

test('the margin never reserves axis space', () => {
  // The axis reserves its own gutter through `<XAxis height>`; adding it to the
  // margin counted it twice and pushed labels out of the container.
  const m = chartMargin();
  assert.ok(m.bottom <= 12, `bottom margin should stay small, got ${m.bottom}`);
  assert.ok(m.top <= 16);
  // And it must not vary with the axis gutter any more.
  assert.deepEqual(chartMargin(), chartMargin({ bottom: 130 }));
});

test('empty data does not throw', () => {
  assert.doesNotThrow(() => xAxisGeometry([], 'region'));
  assert.doesNotThrow(() => yAxisGeometry(null, 'Total'));
});
