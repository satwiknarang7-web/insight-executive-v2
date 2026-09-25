/**
 * Builds the map shapes in lib/geo/maps from their sources.
 *
 *   node scripts/build-geo.mjs <dir of extracted @svg-maps packages>
 *
 * Subnational maps: @svg-maps/* 2.0.0 (CC BY 4.0; the US one is public
 * domain), unpacked with `npm pack` into <dir>/svg-maps-<name>-2.0.0/package.
 * World: world-atlas countries-110m (Natural Earth, public domain), projected
 * here with d3-geo so every map is the same shape of data: a viewBox and one
 * SVG path per region. lib/geo/index.json holds only the region names, small
 * enough for the engine to read when it looks for a geographic column.
 */
import fs from 'node:fs';
import path from 'node:path';
import { geoNaturalEarth1, geoPath } from 'd3-geo';
import { feature } from 'topojson-client';

const SRC = process.argv[2];
const OUT = path.join(import.meta.dirname, '../lib/geo/maps');
const COUNTRIES = {
  india: ['IN', 'India'], 'usa.states-territories': ['US', 'United States'], canada: ['CA', 'Canada'], brazil: ['BR', 'Brazil'],
  germany: ['DE', 'Germany'], japan: ['JP', 'Japan'], italy: ['IT', 'Italy'], ukraine: ['UA', 'Ukraine'], mexico: ['MX', 'Mexico'],
  china: ['CN', 'China'], 'south-korea': ['KR', 'South Korea'], nigeria: ['NG', 'Nigeria'], spain: ['ES', 'Spain'], sweden: ['SE', 'Sweden'],
  austria: ['AT', 'Austria'], netherlands: ['NL', 'Netherlands'], indonesia: ['ID', 'Indonesia'], thailand: ['TH', 'Thailand'],
  'saudi-arabia': ['SA', 'Saudi Arabia'], colombia: ['CO', 'Colombia'], 'new-zealand': ['NZ', 'New Zealand'], denmark: ['DK', 'Denmark'],
  'sri-lanka': ['LK', 'Sri Lanka'], uae: ['AE', 'United Arab Emirates'], greece: ['GR', 'Greece'], vietnam: ['VN', 'Vietnam'],
  israel: ['IL', 'Israel'], moldova: ['MD', 'Moldova'], uzbekistan: ['UZ', 'Uzbekistan'],
};
const index = {};
const round = (d) => d.replace(/(\d+\.\d{2})\d+/g, '$1');

for (const [pkg, [code, name]] of Object.entries(COUNTRIES)) {
  const dir = path.join(SRC, `svg-maps-${pkg}-2.0.0/package`);
  const mod = (await import(path.join(dir, 'index.js'))).default;
  const pj = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const locations = mod.locations.map((l) => ({ id: l.id, name: l.name, path: round(l.path) }));
  fs.writeFileSync(path.join(OUT, `${code}.json`), JSON.stringify({ code, name, viewBox: mod.viewBox, license: pj.license, source: `@svg-maps/${pkg}`, locations }));
  index[code] = { name, regions: locations.map((l) => [l.id, l.name]) };
}

const topo = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '../node_modules/world-atlas/countries-110m.json'), 'utf8'));
const geo = feature(topo, topo.objects.countries);
geo.features = geo.features.filter((f) => f.properties.name !== 'Antarctica');
const W = 960;
const H = 500;
const projection = geoNaturalEarth1().fitSize([W, H], geo);
const draw = geoPath(projection);
const world = geo.features.map((f) => ({ id: String(f.id ?? f.properties.name), name: f.properties.name, path: round(draw(f) || '') })).filter((l) => l.path);
fs.writeFileSync(path.join(OUT, 'WORLD.json'), JSON.stringify({ code: 'WORLD', name: 'World', viewBox: `0 0 ${W} ${H}`, license: 'Public domain (Natural Earth)', source: 'world-atlas', locations: world }));
index.WORLD = { name: 'World', regions: world.map((l) => [l.id, l.name]) };

fs.writeFileSync(path.join(import.meta.dirname, '../lib/geo/index.json'), JSON.stringify(index));
console.log(Object.keys(index).length, 'maps');
