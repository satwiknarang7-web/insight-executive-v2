/**
 * Which map a column's values belong to, and which shape each value is.
 *
 * Pure and synchronous: it reads only lib/geo/index.json (region names), so
 * the engine can ask it while reading the table. The shapes themselves are
 * loaded by the chart when it draws (lib/geo/load.js).
 *
 * A column is geographic when nearly all of its rows name regions of one map:
 * countries of the world, or the states / provinces of one country. Names are
 * compared after normalising case, accents, punctuation, "&", abbreviations
 * and words like "state of", plus common alternatives (USA, UK, Orissa).
 */
import INDEX from './index.json' with { type: 'json' };

const ABBR = [
  [/\bdem\b/g, 'democratic'],
  [/\brep\b/g, 'republic'],
  [/\bis\b/g, 'islands'],
  [/\beq\b/g, 'equatorial'],
  [/\bherz\b/g, 'herzegovina'],
  [/\bfr\b/g, 'french'],
  [/\bst\b/g, 'saint'],
];

export function normalize(value) {
  let s = String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  // "W. Sahara", "S. Sudan", "N. Cyprus" in the world names.
  s = s.replace(/^w (?=\w)/, 'western ').replace(/^s (?=\w{3})/, 'south ').replace(/^n (?=\w{3})/, 'north ');
  for (const [re, to] of ABBR) s = s.replace(re, to);
  s = s
    .replace(/^(the|state of|province of|republic of)\s+/, '')
    .replace(/\s+(state|province|prefecture|region|territory|ut)$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  return s;
}

/** Names people write that differ from the map's own. Keyed by map code. */
const ALIASES = {
  WORLD: {
    usa: 'united states of america', us: 'united states of america', 'united states': 'united states of america', america: 'united states of america',
    uk: 'united kingdom', 'great britain': 'united kingdom', britain: 'united kingdom', 'u k': 'united kingdom', 'u s': 'united states of america', 'u s a': 'united states of america',
    uae: 'united arab emirates', 'russian federation': 'russia', 'korea republic': 'south korea', 'korea republic of': 'south korea', korea: 'south korea',
    'democratic people s republic of korea': 'north korea', 'czech republic': 'czechia', 'ivory coast': 'cote d ivoire', swaziland: 'eswatini',
    'north macedonia': 'macedonia', drc: 'democratic republic congo', 'democratic republic of congo': 'democratic republic congo', 'democratic republic of the congo': 'democratic republic congo',
    'congo kinshasa': 'democratic republic congo', 'congo brazzaville': 'congo', 'republic of congo': 'congo', 'viet nam': 'vietnam', turkiye: 'turkey', burma: 'myanmar',
    'lao pdr': 'laos', 'lao people s democratic republic': 'laos', 'iran islamic republic of': 'iran', 'syrian arab republic': 'syria', holland: 'netherlands',
    'bosnia and herzegovina': 'bosnia and herzegovina', 'timor leste': 'timor leste', 'east timor': 'timor leste', 'cabo verde': 'cape verde',
    'central african republic': 'central african republic', 'dominican republic': 'dominican republic', 'south sudan': 'south sudan', 'solomon islands': 'solomon islands',
    'equatorial guinea': 'equatorial guinea', 'western sahara': 'western sahara', 'falkland islands': 'falkland islands', 'palestinian territories': 'palestine',
    'tanzania united republic of': 'tanzania', 'united republic of tanzania': 'tanzania', 'venezuela bolivarian republic of': 'venezuela', 'bolivia plurinational state of': 'bolivia',
    gbr: 'united kingdom', ind: 'india', chn: 'china', deu: 'germany', fra: 'france', jpn: 'japan', bra: 'brazil', can: 'canada',
    aus: 'australia', rus: 'russia', mex: 'mexico', ita: 'italy', esp: 'spain', kor: 'south korea', idn: 'indonesia', nld: 'netherlands', che: 'switzerland',
    swe: 'sweden', nor: 'norway', dnk: 'denmark', fin: 'finland', pol: 'poland', tur: 'turkey', sau: 'saudi arabia', are: 'united arab emirates', zaf: 'south africa',
    nga: 'nigeria', egy: 'egypt', arg: 'argentina', col: 'colombia', chl: 'chile', per: 'peru', pak: 'pakistan', bgd: 'bangladesh', vnm: 'vietnam', tha: 'thailand',
    mys: 'malaysia', phl: 'philippines', sgp: 'singapore', nzl: 'new zealand', irl: 'ireland', prt: 'portugal', bel: 'belgium', aut: 'austria', grc: 'greece', isr: 'israel',
  },
  IN: {
    ladakh: 'jammu and kashmir', 'jammu kashmir': 'jammu and kashmir', 'j and k': 'jammu and kashmir', orissa: 'odisha', pondicherry: 'puducherry', uttaranchal: 'uttarakhand',
    'nct of delhi': 'delhi', 'delhi nct': 'delhi', 'new delhi': 'delhi', 'national capital territory of delhi': 'delhi', 'andaman and nicobar island': 'andaman and nicobar islands',
    'andaman and nicobar': 'andaman and nicobar islands', 'dadra and nagar haveli and daman and diu': ['dadra and nagar haveli', 'daman and diu'], chattisgarh: 'chhattisgarh',
    telengana: 'telangana', 'tamilnadu': 'tamil nadu',
  },
  DE: {
    bayern: 'bavaria', hessen: 'hesse', sachsen: 'saxony', niedersachsen: 'lower saxony', 'nordrhein westfalen': 'north rhine westphalia', thuringen: 'thuringia',
    thueringen: 'thuringia', 'rheinland pfalz': 'rhineland palatinate', 'sachsen anhalt': 'saxony anhalt', 'baden wuerttemberg': 'baden wurttemberg',
    'mecklenburg western pomerania': 'mecklenburg vorpommern',
  },
  GB: {
    england: ['north east', 'north west', 'yorkshire and the humber', 'east midlands', 'west midlands', 'east of england', 'london', 'south east', 'south west'],
    'greater london': 'london', 'east anglia': 'east of england', eastern: 'east of england', east: 'east of england', 'yorkshire and humber': 'yorkshire and the humber',
    yorkshire: 'yorkshire and the humber', 'n ireland': 'northern ireland', ni: 'northern ireland', cymru: 'wales', 'north east england': 'north east',
    'north west england': 'north west', 'south east england': 'south east', 'south west england': 'south west',
  },
  FR: {
    paris: 'ile de france', 'paris region': 'ile de france', brittany: 'bretagne', normandy: 'normandie', corsica: 'corse', paca: 'provence alpes cote d azur',
    provence: 'provence alpes cote d azur', 'sud': 'provence alpes cote d azur', 'burgundy franche comte': 'bourgogne franche comte', 'centre': 'centre val de loire',
    'hauts de france': 'hauts de france', 'grand est': 'grand est', 'auvergne rhone alpes': 'auvergne rhone alpes', 'new aquitaine': 'nouvelle aquitaine',
    occitania: 'occitanie',
  },
  AU: {
    nsw: 'new south wales', vic: 'victoria', qld: 'queensland', wa: 'western australia', sa: 'south australia', tas: 'tasmania',
    act: 'australian capital territory', nt: 'northern territory', canberra: 'australian capital territory',
  },
  US: { 'washington dc': 'district of columbia', 'washington d c': 'district of columbia', dc: 'district of columbia', 'd c': 'district of columbia' },
};

let tables = null;
/** name → region ids, per map. */
function lookup() {
  if (tables) return tables;
  tables = {};
  for (const [code, map] of Object.entries(INDEX)) {
    const t = new Map();
    for (const [id, name] of map.regions) {
      const key = normalize(name);
      t.set(key, [...(t.get(key) || []), id]);
      // US states by postal code (the map's own ids).
      if (code === 'US') t.set(id.toLowerCase(), [id]);
    }
    for (const [alias, to] of Object.entries(ALIASES[code] || {})) {
      const ids = (Array.isArray(to) ? to : [to]).flatMap((n) => t.get(normalize(n)) || []);
      if (ids.length) t.set(normalize(alias), ids);
    }
    tables[code] = t;
  }
  return tables;
}

let regionNames = null;
function isoName(value) {
  const s = String(value ?? '').trim();
  if (!/^[A-Za-z]{2}$/.test(s)) return null;
  try {
    regionNames ||= new Intl.DisplayNames(['en'], { type: 'region' });
    const name = regionNames.of(s.toUpperCase());
    return name && name !== s.toUpperCase() ? name : null;
  } catch {
    return null;
  }
}

/** The region ids of one map that a value names, or []. */
export function regionIds(code, value) {
  const t = lookup()[code];
  if (!t) return [];
  const direct = t.get(normalize(value));
  if (direct) return direct;
  if (code === 'WORLD') {
    const iso = isoName(value);
    if (iso) return t.get(normalize(iso)) || t.get(normalize(ALIASES.WORLD[normalize(iso)] || '')) || [];
  }
  return [];
}

const COMPASS = /^(north|south|east|west|central)( ?(north|south|east|west))?( of england| england)?$/;

/**
 * The map a column belongs to, from its values and counts ([[value, n]]).
 * Needs 4+ matched regions and 85%+ of rows matched; the subnational map
 * wins a tie with the world (Georgia is a state and a country).
 */
export function detectMap(top, { minRegions = 4, minShare = 0.85 } = {}) {
  const total = top.reduce((s, [, n]) => s + n, 0);
  if (!total) return null;
  let best = null;
  for (const code of Object.keys(INDEX)) {
    let rows = 0;
    const regions = new Set();
    for (const [value, n] of top) {
      const ids = regionIds(code, value);
      if (ids.length) {
        rows += n;
        // "North East", "South West": sales territories as often as places,
        // so they never make a column a map on their own.
        if (!COMPASS.test(normalize(value))) ids.forEach((id) => regions.add(id));
      }
    }
    const share = rows / total;
    if (regions.size < minRegions || share < minShare) continue;
    const score = share + (code === 'WORLD' ? 0 : 0.001);
    if (!best || score > best.score) best = { code, name: INDEX[code].name, share, regions: regions.size, score };
  }
  return best && { code: best.code, name: best.name, share: best.share, regions: best.regions };
}

export const MAP_CODES = Object.keys(INDEX);
export const mapName = (code) => INDEX[code]?.name || code;
