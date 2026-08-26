import test from 'node:test';
import assert from 'node:assert/strict';
import { exampleMeasurePhrases, parseMeasurePhrase } from '../lib/measureLanguage.js';

/** A profile shaped the way the worker builds one. */
function profileOf(spec) {
  const columns = {};
  const measures = [];
  const dimensions = [];
  const temporal = [];
  for (const [name, meta] of Object.entries(spec)) {
    columns[name] = { name, role: meta.role, distinctCount: meta.distinct ?? 0, type: meta.type ?? 'text' };
    if (meta.role === 'measure') measures.push(name);
    if (meta.role === 'dimension') dimensions.push(name);
    if (meta.role === 'time') temporal.push(name);
  }
  return { columns, measures, dimensions, temporal };
}

const sales = profileOf({
  Order_ID: { role: 'identifier', distinct: 5000 },
  Order_Date: { role: 'time', distinct: 365 },
  Region: { role: 'dimension', distinct: 4 },
  Customer: { role: 'dimension', distinct: 1800 },
  Revenue: { role: 'measure', type: 'number' },
  Cost: { role: 'measure', type: 'number' },
  Unit_Price: { role: 'measure', type: 'number' },
  Year: { role: 'measure', type: 'number' },
});

const preview = [{ Region: 'West', Customer: 'Acme', Revenue: 120, Cost: 80 }];

test('every suggestion actually parses against the dataset it was built from', () => {
  const columns = Object.keys(sales.columns);
  const phrases = exampleMeasurePhrases(sales, { sample: preview });
  assert.ok(phrases.length >= 4, 'there is something to suggest');
  for (const phrase of phrases) {
    const parsed = parseMeasurePhrase(phrase, { columns, profile: sales, measures: [] });
    assert.ok(parsed.ok, `"${phrase}" should parse — ${parsed.error || ''}`);
  }
});

test('suggestions name this dataset, not an imaginary one', () => {
  const phrases = exampleMeasurePhrases(sales, { sample: preview });
  const joined = phrases.join(' | ').toLowerCase();
  assert.ok(joined.includes('revenue'), 'the headline column leads');
  // The fixed list this replaced offered these regardless of what was loaded.
  assert.ok(!joined.includes('order value'));
  assert.ok(!joined.includes('discount'));
});

test('a numeric column that is really a date is never suggested as a total', () => {
  const phrases = exampleMeasurePhrases(sales, { sample: preview });
  assert.ok(!phrases.some((p) => /\byear\b/i.test(p)), '"total year" is not a metric');
});

test('the column worth adding up wins over the one that only looks numeric', () => {
  // Unit_Price is a measure and comes before Revenue in nothing but luck; a
  // total of a per-unit price is a number with no interpretation.
  const [first] = exampleMeasurePhrases(sales, { sample: preview });
  assert.equal(first, 'total revenue');
});

test('a per-something example divides by a population, not by more money', () => {
  const per = exampleMeasurePhrases(sales, { sample: preview }).find((p) => / per /.test(p));
  assert.ok(per, 'there is a ratio example');
  assert.match(per, /per customer/i, 'the denominator is the thing there are many of');
});

test('a filter example names a value that is really in the column', () => {
  const filtered = exampleMeasurePhrases(sales, { sample: preview }).find((p) => / where /.test(p));
  assert.ok(filtered, 'there is a filter example');
  assert.match(filtered, /where region is West/i);
  assert.ok(!filtered.includes('…'), 'a placeholder is not an example');
});

test('with no preview rows the filter example is dropped rather than templated', () => {
  const phrases = exampleMeasurePhrases(sales, { sample: [] });
  assert.ok(!phrases.some((p) => / where /.test(p)));
});

test('a dataset with no obvious money column still gets usable suggestions', () => {
  const sensors = profileOf({
    Reading_ID: { role: 'identifier', distinct: 900 },
    Station: { role: 'dimension', distinct: 12 },
    Temperature: { role: 'measure', type: 'number' },
    Humidity: { role: 'measure', type: 'number' },
  });
  const columns = Object.keys(sensors.columns);
  const phrases = exampleMeasurePhrases(sensors, { sample: [{ Station: 'Alpha' }] });
  assert.ok(phrases.length > 0);
  for (const phrase of phrases) {
    assert.ok(parseMeasurePhrase(phrase, { columns, profile: sensors, measures: [] }).ok, phrase);
  }
});

test('a dataset with no numeric column at all suggests nothing rather than nonsense', () => {
  const text = profileOf({ Notes: { role: 'dimension', distinct: 400 } });
  for (const phrase of exampleMeasurePhrases(text, { sample: [] })) {
    assert.ok(
      parseMeasurePhrase(phrase, { columns: Object.keys(text.columns), profile: text, measures: [] }).ok,
      phrase
    );
  }
});

test('an empty profile is handled without throwing', () => {
  assert.deepEqual(exampleMeasurePhrases(null), []);
  assert.deepEqual(exampleMeasurePhrases({}), []);
});
