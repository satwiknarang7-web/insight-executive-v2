import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildKpiSql,
  readKpiValue,
  formatKpiValue,
  defaultKpiLabel,
  metricNeedsColumn,
  KPI_METRICS,
} from '../lib/kpiMetrics.js';
import { updateKpi, addKpi } from '../lib/storyboardEdits.js';

test('every offered metric builds a runnable query', () => {
  for (const m of KPI_METRICS) {
    const sql = buildKpiSql({ metric: m.key, column: 'monthly_charge' });
    assert.ok(sql, `${m.key} produced no query`);
    assert.match(sql, /^SELECT .+ AS \[Value\] FROM SalesData$/);
  }
});

test('count needs no column; the others refuse without one', () => {
  assert.equal(metricNeedsColumn('COUNT'), false);
  assert.equal(buildKpiSql({ metric: 'COUNT' }), 'SELECT COUNT(*) AS [Value] FROM SalesData');

  assert.equal(buildKpiSql({ metric: 'AVG' }), null);
  assert.equal(buildKpiSql({ metric: 'SUM' }), null);
  assert.equal(buildKpiSql({ metric: 'NONSENSE', column: 'x' }), null);
  assert.equal(buildKpiSql(), null);
});

test('column names with spaces and dots survive into the query', () => {
  const sql = buildKpiSql({ metric: 'AVG', column: 'orders.unit price' });
  assert.match(sql, /AVG\(\[orders\.unit price\]\)/);
});

test('the value is read from the aliased column', () => {
  assert.equal(readKpiValue([{ Value: 900 }]), 900);
  assert.equal(readKpiValue([{ 'AVG(x)': 84.3 }]), 84.3, 'an unaliased result still yields its number');
  assert.equal(readKpiValue([]), null);
  assert.equal(readKpiValue(null), null);
  assert.equal(readKpiValue([{ Value: 0 }]), 0, 'zero is a value, not an absence');
});

test('computed values are compacted the way generated cards are', () => {
  assert.equal(formatKpiValue(900), '900');
  assert.equal(formatKpiValue(75800.42), '75.8K');
  assert.equal(formatKpiValue(2_400_000), '2.4M');
  assert.equal(formatKpiValue(84.3271), '84.3');
  assert.equal(formatKpiValue(0), '0');
});

test('a card is named after its metric until the user names it', () => {
  assert.equal(defaultKpiLabel({ metric: 'COUNT' }), 'Record count');
  assert.equal(defaultKpiLabel({ metric: 'AVG', column: 'monthly_charge' }), 'Average of monthly charge');
  assert.equal(defaultKpiLabel({ metric: 'NOPE' }), '');
});

test('a value that averaged to nothing is refused, not shown as NaN', () => {
  assert.equal(readKpiValue([{ Value: NaN }]), null);
  assert.equal(readKpiValue([{ Value: Infinity }]), null);
  assert.equal(readKpiValue([{ Value: null }]), null);
});

test('a generated label follows its metric; a typed one is never overwritten', () => {
  // The reported case: a card auto-named "Sum of Age" kept that name after the
  // metric was switched, so it announced a sum of ages over an average of
  // something else entirely.
  let list = updateKpi(addKpi([]), 0, {
    label: defaultKpiLabel({ metric: 'SUM', column: 'age' }),
    autoLabel: true,
    value: '3.8K',
    source: { metric: 'SUM', column: 'age' },
  });
  assert.equal(list[0].label, 'Sum of age');
  assert.equal(list[0].autoLabel, true);

  list = updateKpi(list, 0, {
    label: defaultKpiLabel({ metric: 'AVG', column: 'cereal_yield' }),
    autoLabel: true,
    value: '3.8K',
    source: { metric: 'AVG', column: 'cereal_yield' },
  });
  assert.equal(list[0].label, 'Average of cereal yield', 'the generated name tracks the metric');

  // Once the user names it, it is theirs.
  list = updateKpi(list, 0, { label: 'Yield per hectare' });
  assert.equal('autoLabel' in list[0], false);
  assert.equal(list[0].label, 'Yield per hectare');
});

test('a computed card records what it was computed from', () => {
  const list = addKpi([]);
  const computed = updateKpi(list, 0, {
    value: '84.3',
    source: { metric: 'AVG', column: 'monthly_charge' },
  });
  assert.deepEqual(computed[0].source, { metric: 'AVG', column: 'monthly_charge' });

  // Typing over the value is an assertion, so the provenance is dropped.
  const typed = updateKpi(computed, 0, { value: '90', source: null });
  assert.equal(typed[0].value, '90');
  assert.equal('source' in typed[0], false);
});
