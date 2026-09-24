/**
 * Which chart this result set should be drawn as, decided from the values.
 *
 * ## Why this exists
 *
 * The resolver used to choose a type from three numbers: how many measures,
 * how many rows, and whether the x-axis looked like a date. That is enough to
 * avoid drawing something impossible and nowhere near enough to draw the right
 * thing. Twelve months of revenue and twelve product categories are the same
 * three numbers and are not the same chart. Four shares of one whole and four
 * unrelated averages are the same three numbers and are not the same chart. A
 * ranking whose categories are `< 10`, `10–100`, `100+` is not a ranking at
 * all — sorting it by value destroys the only thing it had to say.
 *
 * So this module reads the rows themselves and ranks every chart type the data
 * can honestly carry, each with the reason it earned.
 *
 * ## Data-agnostic, and that is a rule rather than an aspiration
 *
 * Nothing here reads a column *name*. Not to find the date column, not to find
 * the geography, not to decide what is a measure. A file whose columns are
 * called `f1`…`f7`, or are in Turkish, or are the twelve months written in
 * Japanese, gets the same treatment as one whose columns are called
 * `order_date` and `revenue`, because the evidence is in the values either
 * way: a date column holds dates, a share column sums to a hundred, a
 * geographic column holds names that match a map. Name-based hints are a
 * lexicon, and a lexicon is a list of the languages and conventions somebody
 * remembered. The values are the evidence.
 *
 * The one exception is deliberate and is the caller's: `placeNames` may be
 * passed in so a map can be offered, and even that is decided by matching the
 * column's *values* against the boundary file rather than by the column being
 * called "country".
 *
 * ## What a recommendation is
 *
 * `{ type, score, why }` — the type, how well the data supports it (0–1), and
 * one sentence a person can disagree with. `chooseChart` takes the top one;
 * the chart dialog shows the list; the Ask page uses it when a question does
 * not name a shape. A type that is merely *possible* is not recommended: the
 * list contains what the data supports, in order, and nothing else.
 */

const isNum = (v) => typeof v === 'number' && isFinite(v);
const present = (v) => v !== null && v !== undefined && v !== '';

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

/**
 * Is this value *shaped* like a point in time?
 *
 * Deliberately separate from parsing one. A label of `2026-13` is not a month
 * anybody has lived through, and a reader still reads that axis as time — as
 * does a synthetic series, a fiscal period numbered past twelve, or a date the
 * source wrote slightly wrong. So the axis is called temporal on its shape,
 * and only the labels that genuinely parse are used to measure the spacing
 * between them.
 */
function temporalShape(v) {
  if (v instanceof Date) return true;
  if (typeof v === 'number') return Number.isInteger(v) && v >= 1900 && v <= 2200;
  const s = String(v ?? '').trim();
  if (!s) return false;
  return /^\d{4}-\d{1,2}(-\d{1,2})?([T ]|$)/.test(s) || /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(s) || /^(19|20)\d{2}$/.test(s);
}

/** A date, from a value, without asking what the column is called. */
function asDate(v) {
  if (v instanceof Date) return isNaN(v) ? null : v;
  if (typeof v === 'number') return v >= 1900 && v <= 2200 && Number.isInteger(v) ? new Date(Date.UTC(v, 0, 1)) : null;
  const s = String(v ?? '').trim();
  if (!s) return null;
  // Only shapes that are unambiguously a calendar point. "12" is not a date;
  // "2024-03" is; "Q1 2024" is handled as a cycle rather than an instant.
  if (!/^\d{4}(-\d{2}(-\d{2})?)?([T ]|$)/.test(s) && !/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(s)) return null;
  const d = new Date(/^\d{4}-\d{2}$/.test(s) ? `${s}-01T00:00:00Z` : s);
  return isNaN(d) ? null : d;
}

/** Where in its cycle a label sits — month 0–11, weekday 0–6 — or null. */
function cyclePosition(value) {
  const s = String(value ?? '').trim().toLowerCase();
  if (!s) return null;
  const month = MONTHS.indexOf(s.slice(0, 3));
  if (month >= 0 && /^[a-z]+\.?$/.test(s)) return { cycle: 'month', at: month, of: 12 };
  const day = DAYS.indexOf(s.slice(0, 3));
  if (day >= 0 && /^[a-z]+\.?$/.test(s)) return { cycle: 'weekday', at: day, of: 7 };
  const quarter = s.match(/^q([1-4])$/);
  if (quarter) return { cycle: 'quarter', at: +quarter[1] - 1, of: 4 };
  return null;
}

/**
 * Is this label one end of an ordered band?
 *
 * `< 10`, `10–100`, `100+`, `0-9`, `18 to 30`. These are what a banding step
 * produces and what an age or size bracket looks like in any language that
 * writes its numbers in digits — which is the point: the digits carry the
 * order, so the words around them need not be understood.
 */
function bandStart(value) {
  const s = String(value ?? '').trim();
  if (!s) return null;
  let m = s.match(/^[<≤]\s*([-+]?[\d.,]+)/);
  if (m) return { at: -Infinity, open: 'low' };
  m = s.match(/^([-+]?[\d.,]+)\s*\+$/) || s.match(/^[>≥]\s*([-+]?[\d.,]+)/);
  if (m) return { at: parseFloat(m[1].replace(/,/g, '')), open: 'high' };
  m = s.match(/^([-+]?[\d.,]+)\s*(?:[-–—]|to)\s*([-+]?[\d.,]+)$/i);
  if (m) return { at: parseFloat(m[1].replace(/,/g, '')), open: null };
  return null;
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** Pearson's r, for deciding whether two measures belong on a scatter. */
function correlation(xs, ys) {
  const n = Math.min(xs.length, ys.length);
  if (n < 4) return 0;
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (!sxx || !syy) return 0;
  return sxy / Math.sqrt(sxx * syy);
}

/** How straight a series is, 0–1: R² of the fitted line. */
function straightness(ys) {
  const n = ys.length;
  if (n < 4) return 0;
  const xs = ys.map((_, i) => i);
  const r = correlation(xs, ys);
  return r * r;
}

/**
 * Everything worth knowing about a result set, read from its values.
 *
 * The caller says which column is the axis and which are the measures — that
 * much comes from the query that produced the rows. Everything else is
 * measured here.
 */
export function readShape(rows = [], { xKey = null, yKeys = [], placeNames = null } = {}) {
  const sample = rows[0] || {};
  const keys = Object.keys(sample);

  // Which columns hold numbers, decided by counting, not by naming.
  const numericKeys = keys.filter((k) => {
    const values = rows.map((r) => r[k]).filter(present);
    if (!values.length) return false;
    return values.filter(isNum).length / values.length >= 0.95;
  });

  const x = xKey && keys.includes(xKey) ? xKey : keys.find((k) => !numericKeys.includes(k)) || keys[0] || null;
  const measures = (yKeys.length ? yKeys : numericKeys).filter((k) => k !== x && keys.includes(k));
  const primary = measures[0] || null;

  const labels = x ? rows.map((r) => r[x]) : [];
  const values = primary ? rows.map((r) => r[primary]).filter(isNum) : [];

  // --- what the axis is -----------------------------------------------------
  const dated = labels.map(asDate);
  const datedCount = dated.filter(Boolean).length;
  const shapedLikeTime = labels.filter(temporalShape).length;
  const isTemporal = labels.length > 0 && shapedLikeTime / labels.length >= 0.9;

  const cycles = labels.map(cyclePosition);
  const isCyclical = labels.length > 1 && cycles.every(Boolean) && new Set(cycles.map((c) => c.cycle)).size === 1;

  // Bands only where the axis is not already time: `2026-01` reads as a range
  // from 2026 to 1 to a pattern that has not been told it is a month.
  const bands = labels.map(bandStart);
  const isBanded = !isTemporal && labels.length > 1 && bands.every(Boolean);

  const xIsNumeric = !!x && numericKeys.includes(x);
  const distinctLabels = new Set(labels.map((l) => String(l ?? ''))).size;

  // Evenly spaced in time? A monthly series is; a series of the four dates
  // something happened on is not, and drawing that as a line invents the gaps.
  let evenlySpaced = false;
  if (isTemporal && datedCount >= 3) {
    const times = dated.filter(Boolean).map((d) => d.getTime()).sort((a, b) => a - b);
    const gaps = times.slice(1).map((t, i) => t - times[i]);
    const m = mean(gaps);
    evenlySpaced = m > 0 && gaps.every((g) => Math.abs(g - m) <= m * 0.34);
  }

  // --- what the values are --------------------------------------------------
  const total = values.reduce((a, b) => a + b, 0);
  const hasNegatives = values.some((v) => v < 0);
  const allNonNegative = values.length > 0 && !hasNegatives;
  const sorted = [...values].sort((a, b) => b - a);
  const topShare = total > 0 ? sorted.slice(0, Math.min(3, sorted.length)).reduce((a, b) => a + b, 0) / total : 0;
  // How far from an even split, 0 (even) to 1 (one category has everything).
  const unevenness =
    total > 0 && values.length > 1
      ? values.reduce((s, v) => s + Math.abs(v / total - 1 / values.length), 0) / 2
      : 0;

  // Shares of one whole announce themselves: they add up to a hundred, or to
  // one. Nothing about the column's name is needed to see it.
  const looksLikeShares =
    values.length > 1 && allNonNegative && (Math.abs(total - 100) <= 1 || Math.abs(total - 1) <= 0.01);

  const monotoneDown = values.length >= 3 && values.every((v, i) => i === 0 || v <= values[i - 1]);
  const strictlyDown = monotoneDown && values[0] > values[values.length - 1];
  // How much is left at the end. A funnel loses most of what entered it; a
  // ranking sorted high to low is monotone too and usually does not.
  const fallRatio = strictlyDown && values[0] > 0 ? values[values.length - 1] / values[0] : 1;

  // --- labels ---------------------------------------------------------------
  const labelLengths = labels.map((l) => String(l ?? '').length).filter((n) => n > 0);
  const longestLabel = labelLengths.reduce((m, n) => Math.max(m, n), 0);
  const medianLabel = labelLengths.length
    ? [...labelLengths].sort((a, b) => a - b)[Math.floor(labelLengths.length / 2)]
    : 0;

  // --- geography, by matching values against a map --------------------------
  let placeable = 0;
  if (placeNames && placeNames.size && labels.length) {
    const named = labels.filter(present).map((l) => String(l).trim().toLowerCase());
    const hits = named.filter((l) => placeNames.has(l)).length;
    placeable = named.length ? hits / named.length : 0;
  }

  // --- several measures -----------------------------------------------------
  const pairs = measures.slice(0, 3).map((k) => rows.map((r) => r[k]).filter(isNum));
  const pairCorrelation = measures.length >= 2 && pairs[0].length === pairs[1].length ? correlation(pairs[0], pairs[1]) : 0;
  const magnitudes = pairs.map((vs) => (vs.length ? mean(vs.map(Math.abs)) : 0));
  const magnitudeRatio =
    measures.length >= 2 && Math.min(magnitudes[0], magnitudes[1]) > 0
      ? Math.max(magnitudes[0], magnitudes[1]) / Math.min(magnitudes[0], magnitudes[1])
      : 1;

  // A second dimension: another non-numeric column beside the axis.
  const otherDimensions = keys.filter((k) => k !== x && !numericKeys.includes(k));

  return {
    rowCount: rows.length,
    keys,
    xKey: x,
    measures,
    measureCount: measures.length,
    numericKeys,
    otherDimensions,
    distinctLabels,
    isTemporal,
    evenlySpaced,
    isCyclical,
    cycle: isCyclical ? cycles[0].cycle : null,
    isBanded,
    xIsNumeric,
    /** The axis has an order of its own that sorting by value would destroy. */
    isOrdered: isTemporal || isCyclical || isBanded,
    hasNegatives,
    allNonNegative,
    total,
    topShare,
    unevenness,
    looksLikeShares,
    monotoneDown,
    strictlyDown,
    fallRatio,
    longestLabel,
    medianLabel,
    placeable,
    trend: straightness(values),
    correlation: pairCorrelation,
    magnitudeRatio,
  };
}

/** Long names read across, not rotated under a bar. */
function wantsHorizontal(shape) {
  if (shape.isOrdered) return false;
  return shape.medianLabel > 14 || shape.longestLabel > 24 || (shape.rowCount > 10 && shape.medianLabel > 6);
}

/**
 * Every chart this data supports, best first.
 *
 * Scores are comparable within one result set and are not a probability. Each
 * carries the reason it scored, which is what makes a recommendation arguable
 * rather than magic.
 */
export function recommendCharts(rows = [], options = {}) {
  const shape = options.shape || readShape(rows, options);
  const out = [];
  const add = (type, score, why) => {
    if (score > 0) out.push({ type, score: Math.min(1, score), why });
  };

  const { rowCount, measureCount } = shape;
  if (!rowCount || !measureCount) {
    return { shape, recommendations: [{ type: 'table', score: 1, why: 'There is nothing here to plot, so the rows are the answer.' }] };
  }

  // One number is a number, not a chart.
  if (rowCount === 1) {
    add('card', 1, 'One row and one figure — a card says it without a shape around it.');
    if (measureCount > 1) add('multicard', 0.9, `One row with ${measureCount} figures on it.`);
    add('table', 0.3, 'The row itself.');
    return { shape, recommendations: out.sort((a, b) => b.score - a.score) };
  }

  // --- time -----------------------------------------------------------------
  if (shape.isTemporal && shape.rowCount >= 3) {
    const even = shape.evenlySpaced;
    if (even) {
      const strong = 0.72 + shape.trend * 0.2;
      if (rowCount > 12) {
        // The house rule, kept: a long dense series is an area, a short one a
        // line rather than a mostly-empty area. Both stay on the list.
        add('area', strong, `${rowCount} points in order over time — the filled series carries the size as well as the direction.`);
        add('line', strong - 0.05, 'The same series as a line, when only the direction matters.');
      } else {
        add('line', strong, `${rowCount} periods in order — a line reads as one movement rather than separate bars.`);
        add('bar', strong - 0.18, 'Columns, if each period is to be compared rather than followed.');
      }
      if (shape.hasNegatives && measureCount === 1) {
        add('waterfall', 0.7, 'The values rise and fall, so a waterfall shows what each period added or took away.');
      }
    } else {
      add('bar', 0.6, 'Dated, but unevenly spaced — columns do not invent the gaps a line would draw.');
      add('line', 0.35, 'A line, if the gaps between these dates can be ignored.');
    }
    add('table', 0.2, 'The periods and their figures.');
  }

  // --- a cycle: months, weekdays, quarters ----------------------------------
  if (shape.isCyclical) {
    add('bar', 0.8, `A ${shape.cycle} cycle — columns in ${shape.cycle} order, never sorted by size.`);
    add('line', 0.55, `The ${shape.cycle} shape as one line.`);
    if (shape.cycle !== 'weekday' && shape.allNonNegative && rowCount <= 12) {
      add('radar', 0.4, `A ${shape.cycle} cycle closes on itself, which a radar shows and a bar does not.`);
    }
  }

  // --- bands: a distribution ------------------------------------------------
  if (shape.isBanded) {
    add('bar', 0.85, 'Ordered bands — columns left to right show the shape of the distribution.');
    add('table', 0.2, 'The bands and their counts.');
  }

  // --- two or three measures ------------------------------------------------
  if (measureCount >= 2 && !shape.isOrdered) {
    const r = Math.abs(shape.correlation);
    if (rowCount >= 8 && shape.numericKeys.length >= 2) {
      add('scatter', 0.45 + r * 0.45, r >= 0.5
        ? `The two measures move together (r ≈ ${shape.correlation.toFixed(2)}), which a scatter shows and a bar cannot.`
        : 'Two measures per row — a scatter shows whether they are related at all.');
    }
    if (measureCount >= 3 && rowCount >= 6 && shape.numericKeys.length >= 3) {
      add('bubble', 0.5, 'Three measures per row: two positions and a size.');
    }
    if (shape.magnitudeRatio > 20) {
      add('composed', 0.7, 'The two measures are orders of magnitude apart, so they need an axis each.');
    } else {
      add('composed', 0.5, 'Two measures over the same categories, drawn together.');
    }
    if (measureCount >= 3 && rowCount >= 3 && rowCount <= 8) {
      add('radar', 0.55, `${measureCount} measures across ${rowCount} groups — a radar compares the profiles.`);
    }
  }
  if (measureCount >= 2 && shape.isTemporal && shape.magnitudeRatio > 20) {
    add('composed', 0.75, 'Two series over time, orders of magnitude apart, so each needs its own axis.');
  }

  // --- one measure over categories -----------------------------------------
  if (measureCount === 1 && !shape.isOrdered) {
    const horizontal = wantsHorizontal(shape);
    const ranking = 0.6 + shape.unevenness * 0.25;

    if (shape.looksLikeShares) {
      if (rowCount <= 7) add('donut', 0.88, 'The values add up to the whole, and there are few enough slices to read.');
      else add('treemap', 0.72, `${rowCount} parts of one whole — a treemap keeps the small ones visible.`);
    }

    if (horizontal) add('hbar', ranking + 0.08, 'The category names are long; sideways they read straight across.');
    add('bar', ranking, shape.unevenness > 0.3
      ? 'The categories are far apart in size, which a ranking shows plainly.'
      : `${rowCount} categories compared on one measure.`);

    if (shape.allNonNegative && rowCount >= 2 && rowCount <= 7 && shape.topShare >= 0.8 && !shape.looksLikeShares) {
      add('donut', 0.55, `The top ${Math.min(3, rowCount)} cover ${Math.round(shape.topShare * 100)}% of the total, so the split is worth showing as parts.`);
    }
    if (shape.allNonNegative && rowCount > 7 && rowCount <= 40) {
      add('treemap', 0.45, `${rowCount} categories — a treemap fits them all where a ranking would need scrolling.`);
    }
    if (shape.allNonNegative && rowCount >= 2 && rowCount <= 5) {
      add('radial', 0.35, 'A few non-negative values, drawn as arcs.');
    }
    // A funnel is stages, not a sorted list. Every ranking ordered high to low
    // is monotone, so that alone earns nothing: what marks a funnel is that
    // most of what entered is gone by the end, and that the order is the
    // data's own rather than one the query imposed.
    const sortedByValue = options.orderedByValue === true;
    if (shape.strictlyDown && rowCount >= 3 && rowCount <= 8 && shape.allNonNegative && shape.fallRatio <= 0.5 && !sortedByValue) {
      add('funnel', 0.6, `Each step keeps less than the one before it, ending at ${Math.round(shape.fallRatio * 100)}% of the first — that is a funnel.`);
    }
    if (shape.hasNegatives) {
      add('waterfall', 0.55, 'Some values are negative, so a waterfall shows what each takes away.');
    }
  }

  // --- geography ------------------------------------------------------------
  if (shape.placeable >= 0.6 && measureCount >= 1) {
    add('filledmap', 0.6 + shape.placeable * 0.25, `${Math.round(shape.placeable * 100)}% of these names match places on the map, so they can be shaded.`);
    add('bubblemap', 0.5, 'The same places, sized rather than shaded.');
  }

  // --- two dimensions -------------------------------------------------------
  if (shape.otherDimensions.length >= 1 && measureCount >= 1) {
    add('matrix', 0.5, 'Two categories and a measure — a matrix shows every combination.');
  }

  // Always available, never recommended over something that says more.
  add('table', 0.15, 'The numbers themselves.');

  // One entry per type: the highest score it earned, with that reason.
  const best = new Map();
  for (const item of out) {
    const current = best.get(item.type);
    if (!current || item.score > current.score) best.set(item.type, item);
  }
  return {
    shape,
    recommendations: [...best.values()].sort((a, b) => b.score - a.score),
  };
}

/**
 * The chart to draw, and what else would have worked.
 *
 * `preferred` is honoured when the data supports it — a person who asked for a
 * donut gets a donut if a donut is honest here — and is otherwise replaced,
 * with the reason recorded so the change can be explained rather than just
 * happening.
 */
export function chooseChart(rows = [], options = {}) {
  const { recommendations, shape } = recommendCharts(rows, options);
  const top = recommendations[0] || { type: 'bar', score: 0, why: '' };

  const preferred = options.preferred ? recommendations.find((r) => r.type === options.preferred) : null;
  if (preferred) {
    return { type: preferred.type, why: preferred.why, replaced: false, alternatives: recommendations, shape };
  }

  return {
    type: top.type,
    why: top.why,
    replaced: !!options.preferred && options.preferred !== top.type,
    alternatives: recommendations,
    shape,
  };
}

/**
 * Should these rows keep the order they arrived in?
 *
 * True whenever the axis carries an order of its own — a date, a month name, a
 * band. Sorting those by value is the single most common way a correct query
 * becomes a misleading chart.
 */
export function keepsOwnOrder(rows = [], options = {}) {
  return readShape(rows, options).isOrdered;
}
