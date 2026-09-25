/**
 * Adds the maps that have no freely licensed @svg-maps package — the United
 * Kingdom, France and Australia — built from Natural Earth admin-1 (public
 * domain), dissolved to the level people report at and projected to a
 * viewBox like the other maps. Run after build-geo.mjs; it adds to
 * lib/geo/index.json.
 *
 *   node scripts/build-geo-ne.mjs <ne_10m_admin_1_states_provinces.geojson> <dir with topojson-server, topojson-simplify>
 *
 * UK counties (GBC): the 232 admin-1 units as Natural Earth draws them.
 * UK: the 12 ITL1 regions (9 English regions, Scotland, Wales, Northern
 * Ireland). France: the 13 metropolitan regions (overseas regions left out:
 * they would shrink the mainland to a corner). Australia: the 8 states and
 * territories (remote islands left out for the same reason).
 */
import fs from 'node:fs';
import path from 'node:path';
import { geoMercator, geoConicConformal, geoPath } from 'd3-geo';
import { feature, merge } from 'topojson-client';

const [SRC, LIBS] = process.argv.slice(2);
const { topology } = await import(path.join(LIBS, 'topojson-server/dist/topojson-server.js'));
const { presimplify, simplify, quantile } = await import(path.join(LIBS, 'topojson-simplify/dist/topojson-simplify.js'));
const OUT = path.join(import.meta.dirname, '../lib/geo/maps');
const all = JSON.parse(fs.readFileSync(SRC, 'utf8')).features;

const UK_ENGLAND = {
  'North East': ['NE', 'North East'], 'North West': ['NW', 'North West'], 'Yorkshire and the Humber': ['YH', 'Yorkshire and the Humber'],
  'East Midlands': ['EM', 'East Midlands'], 'West Midlands': ['WM', 'West Midlands'], East: ['EE', 'East of England'], Eastern: ['EE', 'East of England'],
  'Greater London': ['LDN', 'London'], 'South East': ['SE', 'South East'], 'South West': ['SW', 'South West'],
};
const UK_NATION = { Scotland: ['SCT', 'Scotland'], Wales: ['WLS', 'Wales'], 'Northern Ireland': ['NIR', 'Northern Ireland'] };
// Natural Earth misnames a few UK units; these are their ISO 3166-2 names.
const GBC_NAMES = {
  WRL: 'Wirral', SHN: 'St Helens', NAY: 'North Ayrshire', PKN: 'Perth and Kinross', LND: 'City of London', RCT: 'Rhondda Cynon Taf',
  ELS: 'Na h-Eileanan Siar', WNM: 'Windsor and Maidenhead',
};
const FR = {
  'Hauts-de-France': 'HDF', 'Grand Est': 'GES', "Provence-Alpes-Côte-d'Azur": 'PAC', 'Auvergne-Rhône-Alpes': 'ARA', 'Nouvelle-Aquitaine': 'NAQ',
  Occitanie: 'OCC', 'Bourgogne-Franche-Comté': 'BFC', 'Pays de la Loire': 'PDL', Bretagne: 'BRE', Normandie: 'NOR', Corse: 'COR',
  'Centre-Val de Loire': 'CVL', 'Île-de-France': 'IDF',
};

const MAPS = [
  {
    code: 'GB', name: 'United Kingdom', a3: 'GBR', projection: geoMercator(),
    group: (p) => (p.geonunit === 'England' ? UK_ENGLAND[p.region] : UK_NATION[p.geonunit]),
  },
  {
    // Counties, unitary authorities, London boroughs, Scottish and Welsh
    // council areas and Northern Irish districts, undissolved.
    code: 'GBC', name: 'United Kingdom (counties)', a3: 'GBR', projection: geoMercator(), simplify: 0.12,
    group: (p) => {
      const id = p.iso_3166_2.replace('GB-', '');
      return [id, GBC_NAMES[id] || p.name];
    },
    // Greater London as its 33 boroughs, so a London row can shade them.
    groups: (fs) => ({ 'greater london': fs.filter((f) => f.properties.region === 'Greater London').map((f) => f.properties.iso_3166_2.replace('GB-', '')) }),
  },
  {
    code: 'FR', name: 'France', a3: 'FRA', projection: geoConicConformal().parallels([44, 49]).rotate([-3, 0]),
    group: (p) => (FR[p.region] ? [FR[p.region], p.region] : null),
  },
  {
    code: 'AU', name: 'Australia', a3: 'AUS', projection: geoMercator(),
    group: (p) => (['Jervis Bay Territory', 'Macquarie Island', 'Lord Howe Island'].includes(p.name) ? null : [p.iso_3166_2.replace('AU-', ''), p.name]),
  },
];

const index = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '../lib/geo/index.json'), 'utf8'));
const round = (d) => d.replace(/(\d+\.\d)\d+/g, '$1');
const W = 600;

for (const m of MAPS) {
  const groups = new Map();
  const features = [];
  for (const f of all.filter((x) => x.properties.adm0_a3 === m.a3)) {
    const g = m.group(f.properties);
    if (!g) continue;
    if (!groups.has(g[0])) groups.set(g[0], g[1]);
    features.push({ ...f, properties: { g: g[0] } });
  }
  let topo = topology({ r: { type: 'FeatureCollection', features } }, 1e5);
  topo = presimplify(topo);
  topo = simplify(topo, quantile(topo, m.simplify || 0.06));
  const regions = [...groups].map(([id, name]) => ({
    id, name,
    geo: { type: 'Feature', properties: {}, geometry: merge(topo, topo.objects.r.geometries.filter((x) => x.properties.g === id)) },
  }));
  const fc = { type: 'FeatureCollection', features: regions.map((r) => r.geo) };
  const b0 = geoPath(m.projection.fitWidth(W, fc)).bounds(fc);
  const H = Math.ceil(b0[1][1]);
  const draw = geoPath(m.projection.fitSize([W, H], fc));
  const locations = regions.map((r) => ({ id: r.id, name: r.name, path: round(draw(r.geo) || '') })).filter((l) => l.path);
  fs.writeFileSync(path.join(OUT, `${m.code}.json`), JSON.stringify({ code: m.code, name: m.name, viewBox: `0 0 ${W} ${H}`, license: 'Public domain (Natural Earth)', source: 'Natural Earth', locations }));
  index[m.code] = { name: m.name, regions: locations.map((l) => [l.id, l.name]) };
  if (m.groups) index[m.code].groups = m.groups(all.filter((x) => x.properties.adm0_a3 === m.a3));
  console.log(m.code, locations.length, 'regions', `${(fs.statSync(path.join(OUT, `${m.code}.json`)).size / 1024).toFixed(0)} KB`);
}
fs.writeFileSync(path.join(import.meta.dirname, '../lib/geo/index.json'), JSON.stringify(index));
