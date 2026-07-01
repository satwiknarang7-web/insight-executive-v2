/**
 * The single authoritative chart resolver.
 *
 * Given the rows returned by a query and a (possibly fuzzy / unsuitable)
 * requested chart spec, it returns one canonical, data-validated spec:
 *   { type, xKey, yKey, secondaryKey, profile }
 *
 * Both the backend (after SQL execution) and the frontend (DynamicChart) call
 * this same function, so type/axis decisions can no longer disagree between
 * layers. All type-suitability rules, scatter demotion and value-domain guards
 * live here and nowhere else.
 */

// Columns that are identifiers, not measures or meaningful categories.
const ID_RE = /(^id$|_id$|^id_|key$|code$|guid|uuid|index|^row$|^sr$|^sno$|serial)/i;
// camelCase / PascalCase ID suffixes (customerID, userId) — case-sensitive so we
// don't misfire on words ending in lowercase "id" like "valid" or "paid".
const CAMEL_ID_RE = /(Id|ID)$/;

// Is this column name an identifier rather than a measure/dimension?
export function isIdentifier(name) {
  return ID_RE.test(name) || CAMEL_ID_RE.test(name);
}
// Column-name hints that a field is temporal.
const TEMPORAL_KEY_RE = /(date|time|year|month|day|quarter|qtr|week)/i;

const ADVANCED_TYPES = ['area', 'scatter', 'radar', 'treemap', 'radial', 'composed'];

export function isTemporalValue(val) {
  if (typeof val === 'number') return false;
  const s = String(val ?? '').toLowerCase();
  return (
    /\d{4}-\d{2}/.test(s) ||
    /\d{1,2}\/\d{1,2}/.test(s) ||
    /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/.test(s) ||
    /^q[1-4]\b/.test(s) ||
    /^(19|20)\d{2}$/.test(s)
  );
}

// Resolve a (possibly fuzzy) AI-supplied chart type into a canonical name.
export function canonicalType(type) {
  const t = (type || '').toLowerCase();
  if (!t || t === 'auto') return 'auto';
  if (t.includes('radial')) return 'radial';
  if (t.includes('scatter') || t.includes('distribution') || t.includes('correlation')) return 'scatter';
  if (t.includes('composed') || t.includes('dual') || t.includes('multi')) return 'composed';
  if (t.includes('radar')) return 'radar';
  if (t.includes('treemap')) return 'treemap';
  if (t.includes('line') || t.includes('trend')) return 'line';
  if (t.includes('area') || t.includes('volume')) return 'area';
  if (t.includes('donut') || t.includes('pie') || t.includes('proportion')) return 'donut';
  if (t.includes('bar') || t.includes('column')) return 'bar';
  return 'bar';
}

// Build a structural profile of the result set used by every downstream decision.
export function profileColumns(rows) {
  const sample = rows[0] || {};
  const keys = Object.keys(sample);
  const numeric = [];
  const categorical = [];
  const temporal = [];
  const cardinality = {};
  let hasNegatives = false;

  for (const key of keys) {
    if (key.startsWith('Projected')) continue; // defensive: ignore any derived/overlay columns
    const values = rows.map(r => r[key]).filter(v => v !== null && v !== undefined && v !== '');
    cardinality[key] = new Set(values).size;

    const isNum = values.length > 0 && values.every(v => typeof v === 'number' && isFinite(v));
    if (isNum) {
      numeric.push(key);
      if (values.some(v => v < 0)) hasNegatives = true;
    } else {
      const looksTemporal =
        TEMPORAL_KEY_RE.test(key) ||
        (values.length > 0 && values.slice(0, 5).every(isTemporalValue));
      if (looksTemporal) temporal.push(key);
      else categorical.push(key);
    }
  }

  // Measures are numeric columns that aren't identifiers.
  const measures = numeric.filter(k => !isIdentifier(k));
  // Dimensions are categorical/temporal columns that aren't identifiers.
  const dimensions = [...temporal, ...categorical].filter(k => !isIdentifier(k));

  return {
    keys,
    numeric,
    categorical,
    temporal,
    measures,
    dimensions,
    cardinality,
    hasNegatives,
    rowCount: rows.length,
  };
}

// Pick a sensible type when none was requested. Scatter is intentionally
// demoted: it is reserved for genuine high-cardinality correlation, not used
// as the default for any 2-measure result.
function inferType({ measureCount, rowCount, hasTimeX }) {
  if (hasTimeX) return rowCount > 12 ? 'area' : 'line';
  if (measureCount >= 3 && rowCount >= 3 && rowCount <= 8) return 'radar';
  if (measureCount >= 2) return rowCount >= 15 ? 'scatter' : 'composed';
  if (rowCount > 12) return 'treemap';
  if (rowCount <= 5) return 'radial';
  if (rowCount <= 10) return 'donut';
  return 'bar';
}

// Downgrade a requested type to one the data can actually support.
function validateAgainstData(type, ctx) {
  const { measureCount, numericCount, rowCount, hasNegatives } = ctx;
  // Part-to-whole charts cannot represent negative values; fall back to bar.
  const safePartToWhole = (t) => (measureCount >= 1 && !hasNegatives ? t : 'bar');

  switch (type) {
    case 'scatter':
      if (numericCount >= 2) return 'scatter';
      return rowCount <= 8 && !hasNegatives ? 'donut' : 'bar';
    case 'composed':
      return measureCount >= 2 ? 'composed' : 'bar';
    case 'radar':
      if (measureCount >= 3 && rowCount >= 3 && rowCount <= 12) return 'radar';
      return rowCount <= 8 && !hasNegatives ? 'donut' : 'bar';
    case 'treemap':
      return safePartToWhole('treemap');
    case 'donut':
      return safePartToWhole('donut');
    case 'radial':
      return safePartToWhole('radial');
    case 'line':
    case 'area':
      return measureCount >= 1 ? type : 'bar';
    case 'bar':
    default:
      return 'bar';
  }
}

/**
 * Resolve a final, renderable chart spec from result rows + a requested spec.
 */
export function resolveChart(rows, requested = {}) {
  if (!rows || rows.length === 0) {
    return { type: 'bar', xKey: null, yKey: null, secondaryKey: null, profile: null };
  }

  const p = profileColumns(rows);
  const { measures, dimensions, numeric } = p;
  const rowCount = p.rowCount;

  let xKey = requested.xKey;
  let yKey = requested.yKey;
  let secondaryKey = requested.secondaryKey || requested.secondaryYAxisKey || requested.secondaryYKey || null;

  // 1. Default axes from the profile.
  const defaultX = p.temporal[0] || dimensions[0] || p.categorical[0] || p.keys[0];
  if (!xKey || !p.keys.includes(xKey)) xKey = defaultX;

  const defaultY =
    measures.find(k => k !== xKey) ||
    measures[0] ||
    numeric.find(k => k !== xKey) ||
    p.keys.find(k => k !== xKey) ||
    p.keys[0];
  if (!yKey || !p.keys.includes(yKey) || yKey === xKey) yKey = defaultY;

  // 2. Resolve / infer the type.
  let type = canonicalType(requested.type);
  const hasTimeX = p.temporal.includes(xKey) || isTemporalValue(rows[0]?.[xKey]);
  if (type === 'auto') {
    type = inferType({ measureCount: measures.length, rowCount, hasTimeX });
  }

  // 3. Validate the type against the data and downgrade if unsupportable.
  type = validateAgainstData(type, {
    measureCount: measures.length,
    numericCount: numeric.length,
    rowCount,
    hasNegatives: p.hasNegatives,
  });

  // 4. Repair axes for the chosen type.
  if (type === 'scatter') {
    const axisPool = numeric.length >= 2 ? numeric : p.keys;
    if (!axisPool.includes(xKey) || typeof rows[0][xKey] !== 'number') xKey = numeric[0];
    if (!axisPool.includes(yKey) || typeof rows[0][yKey] !== 'number' || yKey === xKey) {
      yKey = numeric.find(k => k !== xKey) || numeric[1] || numeric[0];
    }
  } else if (type === 'composed') {
    if (!secondaryKey || secondaryKey === yKey || !p.keys.includes(secondaryKey)) {
      secondaryKey = measures.find(k => k !== yKey && k !== xKey) || null;
    }
  } else {
    // Single-measure types: X is a category/time, Y is a measure.
    if (!measures.includes(yKey) && !numeric.includes(yKey)) {
      yKey = measures[0] || numeric[0] || yKey;
    }
    if (numeric.includes(xKey)) {
      const cat = dimensions[0] || p.categorical[0];
      if (cat) xKey = cat;
    }
  }

  return { type, xKey, yKey, secondaryKey, profile: p };
}

// Heuristic: does this SQL actually aggregate? Used to force a fallback when the
// engineer produced a raw, un-aggregated query (rather than waiting to see a
// noisy row count).
export function isAggregatedSql(sql) {
  if (!sql) return false;
  const s = String(sql).toLowerCase();
  return /\bgroup\s+by\b/.test(s) || /\b(count|sum|avg|min|max)\s*\(/.test(s);
}

export { ADVANCED_TYPES };
