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
