import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (name) => readFileSync(new URL(`../components/charts/${name}`, import.meta.url), 'utf8');

/**
 * Recharts props that are read as *configuration* and not as render props.
 *
 * Handing one of these a function makes Recharts render whatever it returns as
 * a React child. A props object came back, React refused it with "Objects are
 * not valid as a React child", and the whole chart went down — taking the
 * dashboard and the PDF report with it. The mistake is invisible until the
 * chart is actually mounted, which is exactly the kind of thing worth pinning
 * in a file that reads the source.
 */
const CONFIG_ONLY_PROPS = ['labelLine', 'activeShape', 'background'];

const CHART_FILES = [
  'DonutChart.js',
  'BarChart.js',
  'HorizontalBarChart.js',
  'LineChart.js',
  'AreaChart.js',
  'RadialBarChart.js',
  'TreemapChart.js',
];

test('no chart passes a function to a configuration-only prop', () => {
  for (const file of CHART_FILES) {
    const source = read(file);
    for (const prop of CONFIG_ONLY_PROPS) {
      // `prop={(` or `prop={ (` — an arrow function or a call, either of which
      // means a function is being handed over.
      const asFunction = new RegExp(`${prop}=\\{\\s*\\(`, 'm');
      assert.ok(
        !asFunction.test(source),
        `${file}: ${prop} is being given a function. Recharts renders the result as a child, ` +
          'so a props object crashes the chart. Use a boolean or an object.'
      );
    }
  }
});

test('the donut decides leader lines with a value, not a callback', () => {
  const source = read('DonutChart.js');
  // The shape that broke: labelLine={({ index }) => ...}
  assert.ok(!/labelLine=\{\s*\(\{/.test(source));
  // What it should be: a ternary over a boolean and an object literal.
  assert.match(source, /labelLine=\{\s*\n?\s*everySliceLabelled/);
});

test('the label renderer stays a render prop, because that one really is one', () => {
  // `label` is the opposite case: Recharts does expect a function there, and it
  // is how a slice with no room gets no text. The two must not be confused.
  const source = read('DonutChart.js');
  assert.match(source, /label=\{\(\{[^}]*index[^}]*\}\) =>/);
  assert.match(source, /if \(!labelled\.has\(index\)\) return null;/);
});

// ---------------------------------------------------------------------------
// Chart chrome — checked against the data-visualisation anti-pattern catalog
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';

const chartSource = (file) =>
  fs.readFileSync(path.join(process.cwd(), 'components/charts', file), 'utf8');

test('gridlines are solid hairlines, not dashes', () => {
  // "Dashing adds visual noise and reads as 'projection' or 'threshold' when
  // it's just a grid." A dashed tooltip crosshair is conventional and stays;
  // this is about the grid itself.
  for (const file of fs.readdirSync(path.join(process.cwd(), 'components/charts'))) {
    if (!file.endsWith('.js')) continue;
    const src = chartSource(file);
    for (const tag of src.match(/<CartesianGrid[^>]*>/g) || []) {
      assert.doesNotMatch(tag, /strokeDasharray/, `${file} still dashes its grid`);
    }
  }
});

test('a single series of bars is one colour, not a ramp', () => {
  // Colouring each bar darker-where-bigger double-encodes bar length as hue and
  // burns the only free channel on information the chart already shows. The bar
  // fill ran slot 0 into slot 1, spending two categorical identities on one
  // series and reading as though height were encoded twice.
  const src = chartSource('BarChart.js');
  assert.doesNotMatch(src, /linearGradient/, 'bars are filled flat');
  assert.match(src, /fill=\{CHART_COLORS\[0\]\}/);
});

test('the area fill is one hue, and no mark wears a blur', () => {
  const src = chartSource('AreaChart.js');
  // A fade to transparent is the conventional area fill; the hue must not
  // change along the way, or one series wears three identities.
  const stops = src.match(/stopColor=\{CHART_COLORS\[(\d)\]\}/g) || [];
  assert.ok(stops.length > 0, 'the fill still has stops');
  assert.ok(
    stops.every((s) => s === stops[0]),
    `the fill mixes hues: ${[...new Set(stops)].join(', ')}`
  );
  assert.doesNotMatch(src, /feGaussianBlur/, 'a glow on a data mark is decoration');
});
