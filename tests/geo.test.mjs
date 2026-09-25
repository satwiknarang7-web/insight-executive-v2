import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { detectMap, regionIds, MAP_CODES } from '../lib/geo/match.js';
import { buildDashboard } from '../lib/engine/planner.js';

const t = (vals) => detectMap(vals.map((v) => [v, 10]));

test('state names, spelt the way people spell them, find their country', () => {
  assert.equal(t(['Assam', 'Gujarat', 'Jammu & Kashmir', 'Andaman & Nicobar Island', 'Ladakh', 'Orissa', 'Delhi'])?.code, 'IN');
  assert.equal(t(['California', 'Texas', 'New York', 'Florida', 'Washington DC'])?.code, 'US');
  assert.equal(t(['CA', 'NY', 'TX', 'FL'])?.code, 'US');
  assert.equal(t(['Bayern', 'Berlin', 'Hamburg', 'Hessen'])?.code, 'DE');
  assert.deepEqual(regionIds('IN', 'Dadra and Nagar Haveli and Daman and Diu').sort(), ['dd', 'dn']);
});

test('countries find the world map, by name or code', () => {
  assert.equal(t(['USA', 'UK', 'India', 'Germany', 'DRC', "Côte d'Ivoire"])?.code, 'WORLD');
  assert.equal(t(['US', 'GB', 'IN', 'DE', 'FR'])?.code, 'WORLD');
  assert.equal(t(['Georgia', 'Armenia', 'Azerbaijan', 'Turkey'])?.code, 'WORLD');
});

test('things that are not places are not a map', () => {
  assert.equal(t(['North', 'South', 'East', 'West', 'Central']), null);
  assert.equal(t(['Basic', 'Pro', 'Enterprise', 'Free']), null);
  // Mostly places, but not enough of them to trust.
  assert.equal(t(['India', 'Germany', 'Online', 'Retail', 'Wholesale', 'Other']), null);
});

test('every map in the index has its shapes, and every shape a path', () => {
  for (const code of MAP_CODES) {
    const map = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, `../lib/geo/maps/${code}.json`), 'utf8'));
    assert.ok(map.viewBox && map.locations.length > 3 && map.license, code);
    assert.ok(map.locations.every((l) => l.id && l.path), `${code} has an empty shape`);
  }
});

test('a dashboard of places draws them on a map', () => {
  const places = ['Assam', 'Gujarat', 'Haryana', 'Kerala', 'Punjab', 'Bihar', 'Goa', 'Delhi'];
  const rows = Array.from({ length: 800 }, (_, i) => ({ state: places[i % places.length], units: 1 + (i % 5) }));
  const board = buildDashboard(rows);
  const map = board.sections.flatMap((s) => s.tiles).find((x) => x.viz === 'map');
  assert.ok(map, 'no map tile');
  assert.equal(board.ds.fields.find((f) => f.name === 'state').map.code, 'IN');
});

test('UK, France and Australia regions find their maps', () => {
  assert.equal(t(['London', 'Scotland', 'Wales', 'Northern Ireland', 'South East', 'Yorkshire and the Humber'])?.code, 'GB');
  assert.equal(regionIds('GB', 'England').length, 9);
  assert.equal(t(['Île-de-France', 'Brittany', 'Normandy', 'Occitanie', 'PACA', 'Corsica'])?.code, 'FR');
  assert.equal(t(['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'])?.code, 'AU');
  assert.equal(t(['New South Wales', 'Victoria', 'Queensland', 'Tasmania'])?.code, 'AU');
});

test('compass sales territories are not the UK', () => {
  assert.equal(t(['North East', 'North West', 'South East', 'South West']), null);
  assert.equal(t(['North East', 'North West', 'South East', 'South West', 'East', 'West']), null);
});

test('UK counties and council areas find the county map', () => {
  assert.equal(t(['Kent', 'Essex', 'Surrey', 'Devon', 'Cornwall', 'Lancashire', 'Norfolk'])?.code, 'GBC');
  assert.equal(t(['Greater Manchester', 'West Yorkshire', 'Merseyside', 'Tyne and Wear', 'London', 'Kent'])?.code, 'GBC');
  assert.equal(t(['Glasgow City', 'City of Edinburgh', 'Fife', 'Highland', 'Perth and Kinross', 'North Ayrshire'])?.code, 'GBC');
  assert.equal(t(['Wirral', 'St Helens', 'Liverpool', 'Sefton', 'Knowsley'])?.code, 'GBC');
  assert.equal(regionIds('GBC', 'London').length, 33);
  // Regions still find the region map, not the county one.
  assert.equal(t(['London', 'Scotland', 'Wales', 'West Midlands', 'North West', 'South East'])?.code, 'GB');
});
