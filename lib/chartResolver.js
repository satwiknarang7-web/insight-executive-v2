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

import { chooseChart } from './chartAdvisor.js';
import { spanOf } from './extent.js';

// Columns that are identifiers, not measures or meaningful categories.
const ID_RE = /(^id$|_id$|^id_|code$|guid|uuid|^row$|^sr$|^sno$|serial)/i;
// camelCase / PascalCase ID suffixes (customerID, userId) — case-sensitive so we
// don't misfire on words ending in lowercase "id" like "valid" or "paid".
const CAMEL_ID_RE = /(Id|ID)$/;

/**
 * Names that MIGHT be identifiers, and cannot be decided from the name.
 *
 * `index` and `key` used to sit in the list above, unanchored, and the cost of
 * that was not small: every column called `... Index` was deleted from the
 * analysis before it began. On a comparison of AI subscription plans the
 * deleted column was `Intelligence Index` — the benchmark score the whole file
 * exists to weigh against price, gone, so the report never mentioned how good
 * any of the models were. `Price Index`, `Body Mass Index` and `Consumer
 * Confidence Index` went the same way, and `key$` quietly took `Turkey` with
 * them.
 *
 * "Row Index" is an identifier and "Intelligence Index" is a measure, and no
 * amount of reading the name will separate them. The data will: an identifier
 * identifies, so it has a distinct value on (nearly) every row. `Intelligence
 * Index` has ten values across forty-four rows and identifies nothing.
 *
 * Applied in `profileColumns`, which is where the values are.
 */
const MAYBE_ID_RE = /(^index$|[_\s-]index$|^key$|[_\s-]key$)/i;

/** A column whose NAME alone settles it. */
export function isIdentifier(name) {
  return ID_RE.test(name) || CAMEL_ID_RE.test(name);
}

/**
 * Does this column identify its rows, rather than measure them?
 *
 * The extra test for the ambiguous names. A numeric one has to look like a row
 * number — whole, near-unique, and running through a dense range — so a CPI
 * series of two hundred distinct decimals stays a measure while a column of
 * 0..n does not. A categorical one only has to be near-unique, which is what a
 * key is.
 */
function looksLikeIdentifierData(values, rowCount) {
  const distinct = new Set(values).size;
  if (rowCount < 8 || distinct < rowCount * 0.9) return false;
  const nums = values.filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (nums.length !== values.length) return true; // a near-unique text key
  if (!nums.every(Number.isInteger)) return false;
  return spanOf(nums) <= distinct * 1.25;
}
// Column-name hints that a field is temporal.
const TEMPORAL_KEY_RE = /(date|time|year|month|day|quarter|qtr|week)/i;

/**
 * The share of a column's non-blank values that must be numbers for it to count
 * as a measure. High enough that a genuinely mixed column (a "size" of S/M/L
 * with a few numeric codes) stays a category; forgiving enough that a handful
 * of "unknown" cells in a real export does not disqualify a real number.
 */
const NUMERIC_PURITY = 0.95;

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

  // Exact names first — several of these contain words the fuzzy rules below
  // would otherwise claim ("horizontal bar" is not a bar; "bubble" is not a
  // bar; "pie" is its own chart now that the donut has a solid variant).
  // Maps first: "filled map" and "bubble map" both contain words the chart
  // rules below would claim. 'arcgis' is not a type any more — the hosted Esri
  // visual is gone — but decks saved while it existed still name it, and a
  // stored slide should redraw as the nearest offline map rather than as a bar.
  if (t.includes('arcgis') || t.includes('esri')) return 'filledmap';
  if (t.includes('filled map') || t === 'filledmap' || t.includes('choropleth')) return 'filledmap';
  if (t.includes('bubble map') || t === 'bubblemap') return 'bubblemap';
  if (t.includes('shape map') || t === 'shapemap') return 'shapemap';
  if (t === 'map' || t.includes('geo')) return 'filledmap';

  // A filter tile is a list of a column's values, not a drawing of them, so
  // nothing below it applies: it has no axis to validate and no shape to
  // downgrade to. Matched exactly, because "slicer" is the only thing that is
  // one and a chart titled "…filter…" is not.
  if (t === 'slicer') return 'slicer';

  if (t === 'hbar' || t.includes('horizontal')) return 'hbar';
  if (t.includes('waterfall')) return 'waterfall';
  if (t.includes('funnel')) return 'funnel';
  if (t.includes('bubble')) return 'bubble';
  if (t.includes('ribbon')) return 'ribbon';
  if (t.includes('gauge')) return 'gauge';
  if (t.includes('matrix') || t.includes('pivot') || t.includes('cross')) return 'matrix';
  if (t.includes('multicard') || t.includes('multi-row') || t.includes('multirow')) return 'multicard';
  if (t.includes('kpi')) return 'kpi';
  if (t.includes('card')) return 'card';
  if (t.includes('table') || t.includes('grid')) return 'table';
  if (t === 'pie') return 'pie';

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
  const magnitude = {};
  let hasNegatives = false;

  for (const key of keys) {
    if (key.startsWith('Projected')) continue; // defensive: ignore any derived/overlay columns
    /**
     * The cleaner's own outlier marker is not data.
     *
     * `isAnomaly` is set only on the rows that ARE outliers, and the column
     * list above is read from `rows[0]` — so whether the flag became a
     * chartable dimension depended on whether the first row happened to be an
     * outlier. One evaluation dataset charted it and another, with more
     * outliers, did not. `lib/dataModel.js` already excluded it; the profile
     * did not, and the profile is what the planner reads.
     */
    if (key === 'isAnomaly') continue;
    const values = rows.map(r => r[key]).filter(v => v !== null && v !== undefined && v !== '');
    cardinality[key] = new Set(values).size;

    // A measure is a column that is *essentially* numeric, not a perfectly
    // clean one. Requiring every value to be a number meant a single stray
    // "unknown" among 200,000 heights reclassified the whole column as a
    // category — so it vanished from the measure lists, could not be averaged,
    // and the planner tried to group by it instead. Real exports always carry
    // a few of those, and one bad cell should not outvote the other 199,999.
    const numericCount = values.reduce((n, v) => n + (typeof v === 'number' && isFinite(v) ? 1 : 0), 0);
    const isNum = values.length > 0 && numericCount / values.length >= NUMERIC_PURITY;
    if (isNum) {
      numeric.push(key);
      // How big this column's numbers are, for the shapes that put several
      // measures on one axis. Mean of the absolute values rather than the max,
      // so a single outlier does not decide whether a column is comparable to
      // its neighbours.
      const nums = values.filter((v) => typeof v === 'number' && isFinite(v));
      magnitude[key] = nums.length
        ? nums.reduce((s, v) => s + Math.abs(v), 0) / nums.length
        : 0;
      if (values.some(v => v < 0)) hasNegatives = true;
    } else {
      /**
       * A name hint needs the values to back it up.
       *
       * `TEMPORAL_KEY_RE` matched the NAME alone, so any column with "month",
       * "day" or "time" in it became the time axis whatever it held. The
       * planner's own banding step names its output after the column it bands,
       * so bucketing `monthly_charge` produced `Monthly Charge Band` — values
       * `< 50`, `50–100`, `100+` — which matched on "month" and was drawn as a
       * date. The deck reported "Total Monthly Charge **Trend** Over Monthly
       * Charge Band" and a waterfall of what moved it between the bands.
       *
       * So the hint now has to be corroborated by at least one value that
       * reads as a date. A genuinely dated column always has one; a set of
       * numeric range labels never does. The value-only path below is
       * unchanged, so a date column nobody named helpfully is still found.
       */
      const sample = values.slice(0, 20);
      const looksTemporal =
        (TEMPORAL_KEY_RE.test(key) && sample.some(isTemporalValue)) ||
        (values.length > 0 && values.slice(0, 5).every(isTemporalValue));
      if (looksTemporal) temporal.push(key);
      else categorical.push(key);
    }
  }

  /**
   * An ambiguously named column is judged on its values, not its name.
   *
   * `isIdentifier` settles the names that settle themselves. This settles
   * `... Index` and `... Key`, where the name says nothing and the column does.
   */
  const identifies = (key) => {
    if (isIdentifier(key)) return true;
    if (!MAYBE_ID_RE.test(key)) return false;
    const values = rows.map((r) => r[key]).filter((v) => v !== null && v !== undefined && v !== '');
    return looksLikeIdentifierData(values, rows.length);
  };

  /**
   * An hour of the day is a label, not a magnitude.
   *
   * The preparation step pulls the time out of a timestamp so something can be
   * grouped by it, and names the result after the column it came from:
   * `reading_ts` becomes `Reading Ts Hour`. It is a whole number, so the
   * profile called it a measure and a 50,000-row sensor stream opened with
   * "Average Reading Ts Hour 11.5" — the mean hour of the day, which is a fact
   * about the clock. The temperature the file exists to record was not on the
   * dashboard at all.
   *
   * Grouping BY the hour is the point of the column, so it becomes a category.
   * Matched on the suffix this app writes itself AND on the prefix naming a
   * column that exists, so a reader's own "Delivery Hour" — with no "Delivery"
   * column beside it — is untouched.
   */
  /**
   * A column of numbers the cleaner could not read is not a set of categories.
   *
   * `amount` on one evaluation file held both comma conventions — `2,345.00`
   * and `1.234,56` — which cannot both be right, so the cleaner refused to
   * guess and left every comma-bearing value as text. That is the correct
   * call. What followed was not: the column fell below the numeric-purity bar,
   * became a dimension, and the deck charted "Total Qty **by Amount**" and
   * offered `Amount` as a slicer. Money as an axis of categories.
   *
   * Recognised from the values rather than from the reason: a categorical
   * column whose levels are mostly number-shaped — digits, separators,
   * currency marks, signs, brackets and nothing else — is a measure that
   * failed to parse, whatever made it fail. A column of `A123` product codes
   * is not number-shaped, and a column of plain digits would already have been
   * parsed as a number, so a CATEGORICAL column of number-shaped values means
   * the cleaner declined it.
   *
   * Neither charted nor grouped by, and named on `unparsed` so the caller can
   * say so rather than let the column vanish.
   */
  const NUMBER_SHAPED = /^[\s(]*[-+]?[$€£¥₹]?\s*[\d.,\u00a0\s]*\d[\d.,\u00a0\s]*\s?[%$€£¥₹]?[\s)]*$/;
  const unparsed = categorical.filter((key) => {
    // A flag is not a refused number. Two or three levels is a category by
    // any reading — `Yes`/`No`, `1`/`0`, a three-way status — and a numeric
    // column that failed to parse has as many distinct values as it has
    // numbers, which is what made it numeric in the first place.
    if ((cardinality[key] || 0) < 4) return false;
    const values = rows.map((r) => r[key]).filter((v) => v !== null && v !== undefined && v !== '');
    if (values.length < 8) return false;
    const shaped = values.reduce((n, v) => n + (NUMBER_SHAPED.test(String(v)) ? 1 : 0), 0);
    return shaped / values.length >= 0.6;
  });
  const refused = new Set(unparsed);

  const norm = (n) => String(n).toLowerCase().replace(/[\s_-]+/g, '');
  const present = new Set(keys.map(norm));
  const isClockPart = (key) => {
    const stripped = String(key).replace(/\s+(Hour|Minute|Second)$/i, '');
    return stripped !== String(key) && present.has(norm(stripped));
  };

  // Measures are numeric columns that aren't identifiers.
  const measures = numeric.filter((k) => !identifies(k) && !isClockPart(k));
  // Dimensions are categorical/temporal columns that aren't identifiers.
  const dimensions = [...temporal, ...categorical, ...numeric.filter(isClockPart)].filter(
    (k) => !identifies(k) && !refused.has(k)
  );

  return {
    keys,
    numeric,
    categorical,
    temporal,
    measures,
    dimensions,
    cardinality,
    magnitude,
    hasNegatives,
    // Columns that look like numbers and are not usable as either — see above.
    unparsed,
    rowCount: rows.length,
  };
}

// Pick a sensible type when none was requested. Scatter is intentionally
// demoted: it is reserved for genuine high-cardinality correlation, not used
// as the default for any 2-measure result.
/**
 * The fallback shape, from three counts.
 *
 * Kept as the floor under `chartAdvisor`, which reads the values themselves
 * and is what actually decides an `auto` chart now. This runs only when the
 * advisor has nothing to read — no rows, or no column it can measure — where
 * a crude answer still beats none.
 */
function inferType({ measureCount, rowCount, hasTimeX }) {
  if (hasTimeX) return rowCount > 12 ? 'area' : 'line';
  if (measureCount >= 3 && rowCount >= 3 && rowCount <= 8) return 'radar';
  if (measureCount >= 2) return rowCount >= 15 ? 'scatter' : 'composed';
  if (rowCount > 12) return 'treemap';
  if (rowCount <= 5) return 'radial';
  if (rowCount <= 10) return 'donut';
  return 'bar';
}

/**
 * Can these measures share one axis?
 *
 * A radar has a single radial axis and draws every measure against it, so it
 * only works while the measures are the same order of size. The retail deck
 * put total revenue (~718,000), units sold (~2,100) and unit price (~127) on
 * one: revenue filled the web and the other two collapsed into a dot at the
 * centre. Three metrics were plotted, one was visible, and the sentence
 * underneath — correctly — said leadership was split between them. A reader
 * sees one dominant shape and a caption describing a split that is nowhere on
 * the chart, and the chart is what they stop trusting.
 *
 * Ten times is the line. Within one order of magnitude the smaller polygon is
 * still a polygon; past it the chart has a legible measure and some decoration.
 * This is the rule the README already states for two measures on a cartesian
 * plot — "two measures orders of magnitude apart: an axis each" — and a radar
 * is the one shape that cannot give them one each.
 */
const RADAR_SCALE_RATIO = 10;

function comparableScales({ measures, magnitude }) {
  const sizes = (measures || [])
    .map((m) => Math.abs(magnitude?.[m] ?? 0))
    .filter((v) => v > 0);
  if (sizes.length < 2) return true;
  return Math.max(...sizes) / Math.min(...sizes) <= RADAR_SCALE_RATIO;
}

// Downgrade a requested type to one the data can actually support.
function validateAgainstData(type, ctx) {
  const { measureCount, numericCount, rowCount, hasNegatives } = ctx;
  /**
   * Part-to-whole charts cannot represent negative values; fall back to bar.
   *
   * Nor can one of them represent a whole made of one part. A donut of a single
   * row is a filled circle labelled 100%, a treemap of one is a rectangle the
   * size of the frame, and a radial of one is a ring: each claims a comparison
   * against the rest of a total that the query never returned. A waterfall and
   * a funnel have refused a single row since they were written, and these are
   * the same objection — a query that came back with one group has one number
   * in it, which is a bar.
   */
  const safePartToWhole = (t) => (measureCount >= 1 && rowCount >= 2 && !hasNegatives ? t : 'bar');

  /**
   * Nothing numeric came back at all.
   *
   * A measure column that is null in every row profiles as a category, so the
   * result has names and no numbers in it — and every shape below draws a
   * height, an angle or an area from a number. Falling back to a bar drew an
   * axis with nothing on it. A card and a KPI have always answered this by
   * showing the rows instead; so does everything else now.
   */
  if (numericCount === 0 && type !== 'matrix') return 'table';

  switch (type) {
    case 'scatter':
      if (numericCount >= 2) return 'scatter';
      return rowCount >= 2 && rowCount <= 8 && !hasNegatives ? 'donut' : 'bar';
    case 'composed':
      return measureCount >= 2 ? 'composed' : 'bar';
    case 'radar':
      if (measureCount >= 3 && rowCount >= 3 && rowCount <= 12 && comparableScales(ctx)) return 'radar';
      return rowCount >= 2 && rowCount <= 8 && !hasNegatives ? 'donut' : 'bar';
    case 'treemap':
      return safePartToWhole('treemap');
    case 'donut':
      return safePartToWhole('donut');
    case 'radial':
      return safePartToWhole('radial');
    // A line is the segment between two points. With one row there is no
    // segment, and the chart draws an empty frame — Recharts has nothing to
    // join and no dot to leave behind. One number is a bar.
    case 'line':
    case 'area':
      return measureCount >= 1 && rowCount >= 2 ? type : 'bar';

    // Same data requirements as a bar, drawn sideways.
    case 'hbar':
      return measureCount >= 1 ? 'hbar' : 'bar';

    // A pie is a donut, so it inherits the part-to-whole restriction: neither
    // can represent a negative share.
    case 'pie':
      return safePartToWhole('pie');

    // A waterfall needs a sequence to walk along; with one row there is no
    // running total to show.
    case 'waterfall':
      return measureCount >= 1 && rowCount >= 2 ? 'waterfall' : 'bar';

    // A funnel is stages that shrink. Negative values have no meaning in one.
    case 'funnel':
      return measureCount >= 1 && rowCount >= 2 && !hasNegatives ? 'funnel' : 'bar';

    // Size is the third dimension; without a third number it is just a scatter.
    case 'bubble':
      return numericCount >= 3 ? 'bubble' : numericCount >= 2 ? 'scatter' : 'bar';

    // A ribbon needs a category tracked across periods: two dimensions and a
    // measure. Its own component says so when the shape is wrong.
    case 'ribbon':
      return measureCount >= 1 && rowCount >= 4 ? 'ribbon' : 'bar';

    case 'gauge':
      return measureCount >= 1 && !hasNegatives ? 'gauge' : 'bar';

    // The non-chart visuals impose almost nothing: a table can render whatever
    // came back, and a card reduces it to one number.
    case 'card':
    case 'kpi':
      return measureCount >= 1 ? type : 'table';
    case 'multicard':
      return measureCount >= 1 ? 'multicard' : 'table';
    case 'matrix':
      return 'matrix';
    case 'table':
      return 'table';

    // A map needs a name to place and a number to shade; the component itself
    // reports how many of those names it could actually find on the map.
    case 'filledmap':
    case 'bubblemap':
    case 'shapemap':
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
    // Read the values rather than count the columns: twelve months of revenue
    // and twelve product categories have the same three counts and are not the
    // same chart. `inferType` stays as the floor for a result set the advisor
    // finds nothing measurable in.
    const advice = chooseChart(rows, { xKey, placeNames: requested.placeNames || null });
    type = advice.type && advice.type !== 'table'
      ? advice.type
      : inferType({ measureCount: measures.length, rowCount, hasTimeX });
  }

  // A slicer is never downgraded. Every rule below is about whether a shape can
  // be drawn from these numbers, and this one draws no shape.
  if (type === 'slicer') {
    return { type, xKey, yKey, secondaryKey, profile: p };
  }

  // 3. Validate the type against the data and downgrade if unsupportable.
  type = validateAgainstData(type, {
    measureCount: measures.length,
    numericCount: numeric.length,
    rowCount,
    hasNegatives: p.hasNegatives,
    // Which measures, and how big their numbers are: a radar shares one radial
    // axis between all of them, so the counts alone cannot say whether it will
    // draw more than one of them visibly.
    measures,
    magnitude: p.magnitude,
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

/**
 * Types whose second axis is another CATEGORY rather than another measure.
 *
 * A matrix's columns and a ribbon's series are both a second dimension, and both
 * arrive as a second string column in the result. Everything else that sees two
 * string columns treats them as one composite label, which is right for a bar
 * chart broken out two ways and destroys exactly the two visuals that needed the
 * split kept.
 */
const TWO_DIMENSION_TYPES = new Set(['matrix', 'ribbon']);

export function usesSecondDimension(type) {
  return TWO_DIMENSION_TYPES.has(canonicalType(type));
}

export { ADVANCED_TYPES };
