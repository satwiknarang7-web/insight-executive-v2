import test from 'node:test';
import assert from 'node:assert/strict';
import { planCharts } from '../lib/analystPlanner.js';
import { analyzeChart } from '../lib/insightEngine.js';

/**
 * A monthly series with a total that barely moves, which is the shape that
 * produced two consecutive report pages carrying the same four sentences.
 */
function monthly(levels) {
  const rows = [];
  levels.forEach((level, i) => {
    const month = `2025-${String((i % 12) + 1).padStart(2, '0')}`;
    const day = `${2024 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}-15`;
    for (let n = 0; n < 40; n++) {
      rows.push({
        Order_Date: day,
        Month: month,
        Category: ['Electronics', 'Home', 'Sports'][n % 3],
        Total_Amount: level / 40,
      });
    }
  });
  return rows;
}

const FLAT = monthly([200, 202, 199, 201, 203, 198, 200, 202, 201, 199, 200, 202, 201, 200]);
const EVENT = monthly([200, 201, 120, 199, 202, 200, 201, 199, 200, 202, 201, 200, 199, 201]);

test('the waterfall does not re-tell the trend', () => {
  // Both charts are built from the same query, so the waterfall's labels are
  // dates and everything temporal routed to the trend analyzer. Two pages, two
  // pictures, one set of sentences.
  const series = FLAT.map((r, i) => ({ Month: r.Month, 'Total Amount': 200 + (i % 5) }));
  const line = analyzeChart({
    title: 'Total Amount Trend Over Month', chart_type: 'area',
    xAxisKey: 'Month', yAxisKey: 'Total Amount', resultData: series,
  });
  const bridge = analyzeChart({
    title: 'What Moved Total Amount by Month', chart_type: 'waterfall',
    xAxisKey: 'Month', yAxisKey: 'Total Amount', resultData: series,
  });
  assert.notEqual(line.headline, bridge.headline);
  assert.notEqual(line.recommendation, bridge.recommendation);
  assert.match(bridge.headline, /rose in \d+ of \d+ periods/);
});

test('a waterfall names the period that did the work', () => {
  const series = [200, 201, 120, 199, 202, 200, 201, 199].map((v, i) => ({
    Month: `2025-0${i + 1}`, 'Total Amount': v,
  }));
  const f = analyzeChart({
    title: 'What Moved Total Amount by Month', chart_type: 'waterfall',
    xAxisKey: 'Month', yAxisKey: 'Total Amount', resultData: series,
  });
  assert.equal(f.metrics.largestMover, '2025-03');
  assert.match(f.recommendation, /Start with 2025-03/);
});

test('a waterfall says so when nothing stands out', () => {
  // Refusing to name a culprit is the finding when the movement is drift.
  const series = [200, 202, 199, 201, 203, 198, 200, 202, 201, 199].map((v, i) => ({
    Month: `2025-${String(i + 1).padStart(2, '0')}`, 'Total Amount': v,
  }));
  const f = analyzeChart({
    title: 'What Moved Total Amount by Month', chart_type: 'waterfall',
    xAxisKey: 'Month', yAxisKey: 'Total Amount', resultData: series,
  });
  assert.match(f.recommendation, /no single period to investigate/i);
});

test('a waterfall never competes to be the trend finding', () => {
  // `metrics.direction` is how the synthesis picks THE trend. A waterfall of the
  // same series setting it is how one series gets reported twice.
  const series = [200, 201, 120, 199, 202, 200, 201, 199].map((v, i) => ({
    Month: `2025-0${i + 1}`, 'Total Amount': v,
  }));
  const f = analyzeChart({
    title: 'What Moved Total Amount by Month', chart_type: 'waterfall',
    xAxisKey: 'Month', yAxisKey: 'Total Amount', resultData: series,
  });
  assert.equal(f.metrics.direction, undefined);
});

test('a waterfall no longer rides the trend exemption past the floor', () => {
  // "Time always earns one slide" waives the score floor so a flat year still
  // gets its one chart of the time axis. The waterfall declared the same signal
  // kind and collected the same waiver, so on a flat series both shipped at
  // 0.07 — two dead charts, one of them a copy.
  const charts = planCharts(FLAT, { max: 8 });
  const bridge = charts.find((c) => c.chart_type === 'waterfall');
  if (bridge) {
    assert.notEqual(bridge.signal?.kind, 'trend', 'it must be scored as a contribution');
  }
  const line = charts.find((c) => /Trend Over/.test(c.title));
  assert.ok(line, 'the time axis still earns its slide on a flat series');
});

test('a concentrated move earns the waterfall its place', () => {
  const charts = planCharts(EVENT, { max: 8 });
  const bridge = charts.find((c) => c.chart_type === 'waterfall');
  assert.ok(bridge, 'one month taking the total down is what a waterfall is for');
  assert.ok(bridge.signalScore > 0.2, `scored ${bridge.signalScore}`);
});

// ---------------------------------------------------------------------------
// A percentage keeps its unit
// ---------------------------------------------------------------------------

const rateChart = (rows) => ({
  title: 'Shipping Cost Rate by Category', chart_type: 'bar',
  xAxisKey: 'Category', yAxisKey: 'Shipping Cost Rate', resultData: rows,
});

test('a rate is quoted with its unit, and its gap in points', () => {
  // "Books leads categories on shipping cost rate at 2.3" beside an average of
  // "0.58" and a multiplier of "3.9x": three numbers, one a ratio, no unit.
  const f = analyzeChart(rateChart([
    { Category: 'Books', 'Shipping Cost Rate': 2.3 },
    { Category: 'Grocery', 'Shipping Cost Rate': 1.49 },
    { Category: 'Beauty', 'Shipping Cost Rate': 0.2 },
    { Category: 'Fashion', 'Shipping Cost Rate': 0.1 },
    { Category: 'Home', 'Shipping Cost Rate': 0.05 },
    { Category: 'Electronics', 'Shipping Cost Rate': 0.02 },
    { Category: 'Sports', 'Shipping Cost Rate': 0.01 },
  ]));
  assert.match(f.headline, /at 2\.3%/);
  assert.match(f.detail, /percentage points above/);
  assert.doesNotMatch(f.detail, /291/, 'a percentage of a percentage is not the gap');
});

test('a measure that is not a percentage keeps its own wording', () => {
  const f = analyzeChart({
    title: 'Total Amount by Category', chart_type: 'bar',
    xAxisKey: 'Category', yAxisKey: 'Total Amount',
    resultData: [
      { Category: 'Electronics', 'Total Amount': 4.3e9 },
      { Category: 'Home', 'Total Amount': 7.2e8 },
      { Category: 'Sports', 'Total Amount': 3e8 },
    ],
  });
  assert.doesNotMatch(f.headline, /%,/, 'a total is not a percentage');
  assert.match(f.headline, /4\.3B/);
});
