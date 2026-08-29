/**
 * Matching the names in a spreadsheet to the names on a map.
 *
 * This is the whole difficulty of a map visual, and it is a data problem rather
 * than a drawing one. A column says "USA", "U.S.A.", "United States" or "us";
 * the boundary file says "United States of America". Any of those mismatches
 * silently produces a blank map, which reads as "no data" rather than "I could
 * not find your regions" — so the matcher is deliberate about aliases and the
 * component always reports how many regions it actually matched.
 *
 * Pure and free of any rendering, so the matching rules can be tested directly
 * rather than inferred from pixels.
 */

/**
 * Fold a place name to a comparable key.
 *
 * Case, punctuation, diacritics and a leading "the" all vary between sources
 * and none of them carry meaning: "Côte d'Ivoire", "Cote D Ivoire" and "COTE
 * DIVOIRE" are one country.
 */
export function normalizeRegionName(name) {
  return String(name ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/^the\s+/, '')
    .replace(/[.'’`]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Names that will not fold together on their own.
 *
 * Kept small on purpose: every entry is a claim about the world that could be
 * wrong, so this covers the abbreviations and short forms people actually type
 * rather than attempting a gazetteer.
 */
const ALIASES = {
  usa: 'united states of america',
  us: 'united states of america',
  'u s a': 'united states of america',
  'united states': 'united states of america',
  america: 'united states of america',
  uk: 'united kingdom',
  'great britain': 'united kingdom',
  britain: 'united kingdom',
  england: 'united kingdom',
  uae: 'united arab emirates',
  'south korea': 'south korea',
  'republic of korea': 'south korea',
  korea: 'south korea',
  'north korea': 'north korea',
  russia: 'russia',
  'russian federation': 'russia',
  'czech republic': 'czechia',
  holland: 'netherlands',
  burma: 'myanmar',
  'ivory coast': 'cote divoire',
  'cote d ivoire': 'cote divoire',
  vietnam: 'vietnam',
  'viet nam': 'vietnam',
  'hong kong sar': 'hong kong',
  'macau sar': 'macao',
  turkey: 'turkiye',
  swaziland: 'eswatini',
  'cape verde': 'cabo verde',
  'east timor': 'timor leste',
  'democratic republic of the congo': 'dem rep congo',
  drc: 'dem rep congo',
  'republic of the congo': 'congo',
  'bosnia': 'bosnia and herz',
  'bosnia and herzegovina': 'bosnia and herz',
  'dominican rep': 'dominican republic',
  'central african republic': 'central african rep',
  'south sudan': 's sudan',
  'equatorial guinea': 'eq guinea',
  'solomon islands': 'solomon is',
};

/** The comparable key for a name, aliases applied. */
export function regionKey(name) {
  const base = normalizeRegionName(name);
  return ALIASES[base] || base;
}

/**
 * Join the rows to the map's features.
 *
 * Returns a lookup from feature name to value, plus the names that could not be
 * placed. The unmatched list is not diagnostics — it is shown to the user,
 * because "Scotland is not a country in this boundary file" is something only
 * they can resolve.
 */
export function matchRegions(rows, nameKey, valueKey, featureNames) {
  const byKey = new Map();
  for (const feature of featureNames || []) byKey.set(regionKey(feature), feature);

  const values = new Map();
  const unmatched = [];

  for (const row of rows || []) {
    const raw = row?.[nameKey];
    if (raw === null || raw === undefined || raw === '') continue;
    const feature = byKey.get(regionKey(raw));
    const value = Number(row?.[valueKey]);
    if (!feature) {
      if (!unmatched.includes(String(raw))) unmatched.push(String(raw));
      continue;
    }
    // Duplicate rows for one region are summed, the way a pivot would.
    values.set(feature, (values.get(feature) || 0) + (Number.isFinite(value) ? value : 0));
  }

  return { values, unmatched, matched: values.size };
}

/**
 * How many of a column's values this map could place, before one is drawn.
 *
 * `matchRegions` answers the same question, but only once a chart exists — and
 * that is too late to be useful. A column called `region` holding "North",
 * "South", "East", "West" passes every name-based test for a geographic column
 * and matches nothing at all in the boundary file, so the builder would offer a
 * filled map, run the query, and draw an empty world. The value the map reports
 * afterwards ("0 of 4 placed") is the right fact at the wrong moment.
 *
 * Taking plain values rather than rows lets the chart builder ask the question
 * from a sample, while the choice is still being made.
 */
export function placeableRegions(values, featureNames) {
  const byKey = new Set((featureNames || []).map((f) => regionKey(f)));
  const seen = new Set();
  const matched = [];
  const unmatched = [];

  for (const raw of values || []) {
    if (raw === null || raw === undefined || raw === '') continue;
    const text = String(raw);
    if (seen.has(text)) continue;
    seen.add(text);
    (byKey.has(regionKey(text)) ? matched : unmatched).push(text);
  }

  const total = matched.length + unmatched.length;
  return { matched, unmatched, total, share: total ? matched.length / total : 0 };
}

/**
 * Quantile break points for a choropleth.
 *
 * Quantiles rather than equal-width bins: real geographic data is almost always
 * skewed, and equal-width bins put every country in the lightest bucket with
 * one outlier in the darkest, which is a map that says nothing.
 */
export function quantileBreaks(values, bucketCount = 5) {
  const sorted = [...values].filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return [];

  const breaks = [];
  for (let i = 1; i < bucketCount; i++) {
    const at = (sorted.length - 1) * (i / bucketCount);
    const lo = Math.floor(at);
    const hi = Math.ceil(at);
    breaks.push(sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo));
  }
  return breaks;
}

/** Which bucket a value falls in, given the break points. */
export function bucketOf(value, breaks) {
  if (!Number.isFinite(value)) return -1;
  let i = 0;
  while (i < breaks.length && value > breaks[i]) i++;
  return i;
}

/**
 * A light-to-dark ramp from one base colour.
 *
 * Generated rather than hard-coded so a chart palette the user picked drives the
 * map too, instead of every map looking the same regardless of the deck.
 */
export function shadeRamp(hex, steps = 5) {
  const clean = String(hex || '#0f3057').replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  if ([r, g, b].some(Number.isNaN)) return Array(steps).fill('#0f3057');

  const out = [];
  for (let i = 0; i < steps; i++) {
    // Mix toward white for the light end; the darkest step is the base colour.
    const t = 0.75 - (0.75 * i) / Math.max(1, steps - 1);
    out.push(
      `#${[r, g, b]
        .map((c) => Math.round(c + (255 - c) * t).toString(16).padStart(2, '0'))
        .join('')}`
    );
  }
  return out;
}

/**
 * Radius for a bubble, scaled by AREA.
 *
 * Mapping a value to radius makes a bubble of twice the value look four times
 * as large — the classic way a chart misleads without anyone touching the data.
 */
export function bubbleRadius(value, maxValue, maxRadius = 26) {
  if (!Number.isFinite(value) || value <= 0 || !Number.isFinite(maxValue) || maxValue <= 0) return 0;
  return Math.sqrt(value / maxValue) * maxRadius;
}

/** Column names that look like latitude / longitude, for a point map. */
export function findLatLon(columns) {
  const find = (patterns) =>
    (columns || []).find((c) => patterns.some((p) => p.test(String(c).toLowerCase())));
  const lat = find([/^lat$/, /^latitude$/, /_lat$/, /^y$/]);
  const lon = find([/^lon$/, /^lng$/, /^long$/, /^longitude$/, /_lon$/, /_lng$/, /^x$/]);
  return lat && lon ? { lat, lon } : null;
}
