/**
 * Statements that need more than one finding to be true.
 *
 * Every sentence in a deck was written from one chart. That is why the summary
 * reads as a list: revenue fell 43%, Electronics is 72% of revenue, the North is
 * the biggest region — three facts, no story, and the reader left to notice that
 * the first two are probably the same sentence.
 *
 * A senior analyst's summary is mostly the joins. Not "revenue fell" but
 * "revenue fell and four fifths of the fall is one category"; not "Electronics
 * leads and the North is largest" but "Electronics is a third weaker in the
 * North than everywhere else, and the North is where most of the revenue is".
 * None of those can be written from a single chart, and none of them are
 * inferences either — each is arithmetic over the rows, computed here and
 * handed to the sentence rather than guessed at by it.
 *
 * Everything in this module works from the analysis rows, so a claim it makes
 * is checkable against the same data the charts were drawn from.
 */

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const num = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * The raw column an axis alias came from.
 *
 * Charts are labelled with aliases — "Total Amount" for `SUM([Total_Amount])`,
 * "Month" for a substring of `Order_Date` — and the joins below need the column
 * underneath. Matched on the letters alone, so `Total Amount`, `total_amount`
 * and `TotalAmount` are one name.
 */
export function resolveColumn(alias, columns = []) {
  if (!alias) return null;
  const bare = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
  const stripped = bare(String(alias).replace(/^(total|average|avg|sum|count|median|min|max|share of)\s+/i, ''));
  if (!stripped) return null;

  let best = null;
  for (const column of columns) {
    const c = bare(column);
    if (c === stripped) return column;
    // A containment match, longest first, so `Total_Amount` beats `Amount`.
    if (c.includes(stripped) || stripped.includes(c)) {
      if (!best || column.length > best.length) best = column;
    }
  }
  return best;
}

/**
 * Who moved the total.
 *
 * A trend chart says the total fell by a third. The question every reader has
 * next is which part of the business fell, and it is not answerable from the
 * trend — it needs the same rows split by a dimension and compared across the
 * period. The first and last thirds are compared rather than the endpoints,
 * because a single first and last month makes the answer depend on two months.
 *
 * @returns {{ segment, change, share, totalChange, direction, segments }|null}
 *   `share` is the fraction of the total movement this one segment accounts
 *   for; it can exceed 1 when other segments moved the other way, which is
 *   itself the finding.
 */
export function attributeChange(rows, { timeColumn, measureColumn, dimension } = {}) {
  if (!rows?.length || !timeColumn || !measureColumn || !dimension) return null;

  const periods = [...new Set(rows.map((r) => String(r?.[timeColumn] ?? '')).filter(Boolean))].sort();
  if (periods.length < 4) return null;

  const cut = Math.max(1, Math.floor(periods.length / 3));
  const early = new Set(periods.slice(0, cut));
  const late = new Set(periods.slice(-cut));

  const first = new Map();
  const last = new Map();
  for (const row of rows) {
    const period = String(row?.[timeColumn] ?? '');
    const value = num(row?.[measureColumn]);
    const segment = row?.[dimension];
    if (value === null || segment === null || segment === undefined || segment === '') continue;
    const key = String(segment);
    if (early.has(period)) first.set(key, (first.get(key) || 0) + value);
    else if (late.has(period)) last.set(key, (last.get(key) || 0) + value);
  }
  if (!first.size || !last.size) return null;

  const segments = [...new Set([...first.keys(), ...last.keys()])].map((key) => ({
    segment: key,
    change: (last.get(key) || 0) - (first.get(key) || 0),
  }));
  const totalChange = segments.reduce((sum, s) => sum + s.change, 0);
  if (!totalChange) return null;

  // The segment that moved furthest in the direction the total moved.
  const sameWay = segments.filter((s) => Math.sign(s.change) === Math.sign(totalChange));
  if (!sameWay.length) return null;
  const biggest = sameWay.reduce((a, b) => (Math.abs(b.change) > Math.abs(a.change) ? b : a));

  return {
    segment: biggest.segment,
    change: biggest.change,
    share: biggest.change / totalChange,
    totalChange,
    direction: totalChange < 0 ? 'fall' : 'rise',
    segments: segments.length,
  };
}

/**
 * The cell of a cross-tab that least resembles what its edges predict.
 *
 * A grid's marginals already say Electronics is the biggest category and the
 * North the biggest region. Multiply those two shares and you have what the
 * Electronics-in-the-North cell would hold if the two were independent. Where
 * the real cell is far from that, the two dimensions are interacting — the
 * leader is weak in the biggest region, or one pairing carries far more than
 * its share — and that is the only thing in the grid a pair of bar charts
 * could not have told the reader.
 *
 * @returns {{ row, column, actual, expected, ratio, share }|null}
 */
export function interactionResidual(cells, { rowKey, columnKey, valueKey } = {}) {
  if (!cells?.length || !rowKey || !columnKey || !valueKey) return null;

  const rowTotals = new Map();
  const colTotals = new Map();
  let grand = 0;
  for (const cell of cells) {
    const v = num(cell?.[valueKey]);
    if (v === null || v < 0) continue;
    const r = String(cell?.[rowKey] ?? '');
    const c = String(cell?.[columnKey] ?? '');
    if (!r || !c) continue;
    rowTotals.set(r, (rowTotals.get(r) || 0) + v);
    colTotals.set(c, (colTotals.get(c) || 0) + v);
    grand += v;
  }
  if (!grand || rowTotals.size < 2 || colTotals.size < 2) return null;

  let worst = null;
  for (const cell of cells) {
    const actual = num(cell?.[valueKey]);
    if (actual === null) continue;
    const r = String(cell?.[rowKey] ?? '');
    const c = String(cell?.[columnKey] ?? '');
    const expected = ((rowTotals.get(r) || 0) * (colTotals.get(c) || 0)) / grand;
    if (!expected) continue;
    // Weighted by how much of the whole the cell is, so a rounding artefact in
    // a cell worth a thousandth of the total cannot be the headline.
    const weight = expected / grand;
    const departure = Math.abs(actual - expected) / expected;
    const score = departure * Math.sqrt(weight);
    if (!worst || score > worst.score) {
      worst = { row: r, column: c, actual, expected, ratio: actual / expected, share: actual / grand, score };
    }
  }
  if (!worst || Math.abs(worst.ratio - 1) < 0.25) return null;
  return worst;
}

/**
 * Are the two segments that stand out the same records?
 *
 * A churn deck reports month-to-month customers leaving fastest and first-year
 * customers leaving fastest, in two charts, as though they were two problems.
 * Usually they are one: month-to-month customers are the new ones. Measured as
 * how much of one segment sits inside the other against how much would if the
 * two were unrelated.
 *
 * @returns {{ overlap, expected, lift }|null} `lift` above 1 means the two
 *   segments coincide more than chance; below 1, that they are distinct groups.
 */
export function segmentOverlap(rows, { columnA, valueA, columnB, valueB } = {}) {
  if (!rows?.length || !columnA || !columnB) return null;

  let inA = 0;
  let inB = 0;
  let inBoth = 0;
  let total = 0;
  for (const row of rows) {
    if (!row) continue;
    total++;
    const a = String(row[columnA]) === String(valueA);
    const b = String(row[columnB]) === String(valueB);
    if (a) inA++;
    if (b) inB++;
    if (a && b) inBoth++;
  }
  if (!total || !inA || !inB) return null;

  const overlap = inBoth / inA;
  const expected = inB / total;
  if (!expected) return null;
  return { overlap, expected, lift: overlap / expected };
}
