import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bubbleRadius, bucketOf, findLatLon, matchRegions,
  normalizeRegionName, quantileBreaks, regionKey, shadeRamp,
} from '../lib/geo.js';

test('place names fold past case, punctuation and accents', () => {
  assert.equal(normalizeRegionName("Côte d'Ivoire"), 'cote divoire');
  assert.equal(normalizeRegionName('  UNITED   KINGDOM '), 'united kingdom');
  assert.equal(normalizeRegionName('The Bahamas'), 'bahamas');
  assert.equal(normalizeRegionName('Trinidad & Tobago'), 'trinidad and tobago');
});

test('the abbreviations people actually type resolve', () => {
  for (const alias of ['USA', 'U.S.A.', 'us', 'United States']) {
    assert.equal(regionKey(alias), 'united states of america', alias);
  }
  assert.equal(regionKey('UK'), 'united kingdom');
  assert.equal(regionKey('Czech Republic'), 'czechia');
});

const FEATURES = ['United States of America', 'United Kingdom', 'India', 'France'];

test('rows are joined to map features, and misses are reported', () => {
  const rows = [
    { country: 'USA', sales: 10 },
    { country: 'india', sales: 4 },
    { country: 'Atlantis', sales: 99 },
  ];
  const { values, unmatched, matched } = matchRegions(rows, 'country', 'sales', FEATURES);
  assert.equal(matched, 2);
  assert.equal(values.get('United States of America'), 10);
  assert.equal(values.get('India'), 4);
  // The unmatched list is shown to the user, not swallowed.
  assert.deepEqual(unmatched, ['Atlantis']);
});

test('repeat rows for one region are summed', () => {
  const rows = [{ c: 'France', v: 3 }, { c: 'france', v: 7 }];
  const { values } = matchRegions(rows, 'c', 'v', FEATURES);
  assert.equal(values.get('France'), 10);
});

test('quantile breaks split skewed data instead of hiding it', () => {
  // One huge outlier: equal-width bins would put everything in bucket 0.
  const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 1000];
  const breaks = quantileBreaks(values, 5);
  assert.equal(breaks.length, 4);
  const buckets = new Set(values.map((v) => bucketOf(v, breaks)));
  assert.ok(buckets.size >= 4, `expected spread across buckets, got ${[...buckets]}`);
  assert.equal(bucketOf(1000, breaks), 4, 'the outlier lands in the top bucket');
});

test('bubbles scale by area, not radius', () => {
  // Four times the value must be twice the radius, or the chart exaggerates.
  const r1 = bubbleRadius(25, 100, 20);
  const r4 = bubbleRadius(100, 100, 20);
  assert.ok(Math.abs(r4 / r1 - 2) < 1e-9, `${r4} / ${r1} should be 2`);
  assert.equal(bubbleRadius(0, 100), 0);
  assert.equal(bubbleRadius(5, 0), 0);
});

test('the shade ramp runs light to dark and ends on the base colour', () => {
  const ramp = shadeRamp('#0f3057', 5);
  assert.equal(ramp.length, 5);
  assert.equal(ramp[4].toLowerCase(), '#0f3057');
  const lightness = (hex) => parseInt(hex.slice(1, 3), 16) + parseInt(hex.slice(3, 5), 16) + parseInt(hex.slice(5, 7), 16);
  assert.ok(lightness(ramp[0]) > lightness(ramp[4]), 'the first step is the lighter one');
});

test('latitude and longitude columns are recognised, or reported absent', () => {
  assert.deepEqual(findLatLon(['id', 'Latitude', 'Longitude']), { lat: 'Latitude', lon: 'Longitude' });
  assert.deepEqual(findLatLon(['lat', 'lng']), { lat: 'lat', lon: 'lng' });
  assert.equal(findLatLon(['region', 'sales']), null);
});
