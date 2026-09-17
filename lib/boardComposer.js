/**
 * The dashboard as a layout, decided by the analyst rather than by the grid.
 *
 * Planning which charts to build was only ever half of building a dashboard.
 * The other half is the arrangement: what leads, what sits beside it, what is a
 * footnote in the corner — and which filters the reader will reach for first.
 * That half used to be done by a CSS grid, which knows the order the charts
 * were planned in and nothing else, so the strongest finding in the deck got
 * the same rectangle as the two-slice donut beside it.
 *
 * Two decisions, both made from what the planner already worked out.
 *
 * **What each chart is worth.** The planner returns its charts in score order,
 * so the first is the finding it would lead with; it gets the top of the board
 * and the width to be read across a room. After that, size follows shape, not
 * rank: a card is one number and needs a corner, a trend needs width or its
 * periods bunch up, a donut is square whatever else is true, a table wants room
 * for its columns. A chart given a box its shape cannot use is a chart nobody
 * reads, however important it was.
 *
 * **Which filters to offer.** A slicer earns its place by being a column the
 * deck is already about: one the charts break their numbers down by, with few
 * enough values to tick and more than one to choose between. Two at most, down
 * the side, because a filter rail wider than that is a form.
 *
 * Pure: charts and a profile in, boxes and specs out. Nothing is executed here.
 */
import { CANVAS_HEIGHT, CANVAS_WIDTH, cardBox } from './canvasLayout.js';
import { buildChartSpec } from './chartSpecs.js';
import { prettyColumn } from './aggregateNames.js';

/** The space between cards, which is also the margin at the edges. */
const GUTTER = 16;

/** At most this many filter tiles. */
export const MAX_SLICERS = 2;

/** A column with more values than this is a list to scroll, not one to tick. */
const MAX_SLICER_VALUES = 12;

/**
 * What each kind of chart wants, as a share of the canvas and a height.
 *
 * Widths are fractions so the arrangement survives a change to the canvas; the
 * heights are pixels because a plot's usable height does not scale with how
 * wide the board is.
 */
const SHAPE = {
  card: { width: 0.25, height: 180 },
  kpi: { width: 0.25, height: 180 },
  gauge: { width: 0.25, height: 240 },
  multicard: { width: 0.25, height: 280 },

  donut: { width: 0.25, height: 260 },
  pie: { width: 0.25, height: 260 },
  radial: { width: 0.25, height: 260 },
  radar: { width: 0.25, height: 280 },
  funnel: { width: 0.25, height: 280 },

  treemap: { width: 0.33, height: 280 },
  bar: { width: 0.33, height: 280 },
  hbar: { width: 0.33, height: 300 },
  scatter: { width: 0.33, height: 280 },
  bubble: { width: 0.33, height: 300 },
  waterfall: { width: 0.33, height: 280 },

  line: { width: 0.5, height: 300 },
  area: { width: 0.5, height: 300 },
  composed: { width: 0.5, height: 300 },
  ribbon: { width: 0.5, height: 320 },
  matrix: { width: 0.5, height: 320 },
  table: { width: 0.5, height: 320 },
  filledmap: { width: 0.5, height: 320 },
  bubblemap: { width: 0.5, height: 320 },
  shapemap: { width: 0.5, height: 320 },

  slicer: { width: 0.2, height: 300 },
};

/**
 * The height the lead finding gets, and the ceiling everything is tuned to.
 *
 * A board is read in two places: on this page, where it scrolls, and on the
 * closing slide of the deck, where it does not. That second one is the binding
 * constraint — a slide is far wider than it is tall, so an arrangement that
 * runs 1500px down a 1440 canvas is shown at a third of its size when it is
 * projected. Every height above is set so that an ordinary deck lands near the
 * shape of a slide, which is the difference between a board somebody can read
 * from the back of a room and one they cannot.
 */
const LEAD_HEIGHT = 340;

/** A number and its name. One line of each, so it needs no more than this. */
const KPI_HEIGHT = 110;

/** Under this a chart is an axis and no plot, however many rows are asking. */
const MIN_ROW = 120;

/**
 * How many rows of charts a page can hold and still be read.
 *
 * Three, because the page is fixed: the filters and the numbers take their
 * share off the top, and what is left divides between these. A fourth row is
 * what turned every chart into a hundred and twenty pixels of axis.
 */
const MAX_CHART_ROWS = 3;

/** What a row of charts looks like when the page can afford it. */
const PREFERRED_PER_ROW = 3;

/** And the most it will hold before each of them is a thumbnail. */
const MAX_PER_ROW = 6;

/** A filter's title, its search box when it has one, and a row per value. */
const SLICER_CHROME = 76;
const SLICER_ROW = 26;
const railHeight = (values) => Math.max(160, SLICER_CHROME + SLICER_ROW * Math.min(Number(values) || 4, 12));

const DEFAULT_SHAPE = { width: 0.5, height: 360 };

/** The shapes that are worth the top of the board when they lead. */
const LEADS_WIDE = new Set(['line', 'area', 'composed', 'ribbon', 'waterfall', 'matrix', 'table', 'hbar', 'bar']);

/**
 * Where every card goes.
 *
 * A grid, and strictly: every row spans the full width of the board, every card
 * in a row is the same height, and every gutter is the same. The packer this
 * replaces placed cards left to right at whatever width their shape asked for
 * and started a new row when one would not fit — which is how a shelf is
 * stocked, not how a board is laid out. It left a ragged right edge, rows of
 * three different heights, and a last row holding one small card in a corner.
 *
 * Shape still decides how much of a row a card claims — a card is a quarter, a
 * trend is a half, the lead finding is all of it — but once a row is settled
 * its cards share the width equally and take the tallest height any of them
 * asked for. A row of one is a card across the whole board rather than a small
 * card with a gap beside it.
 *
 * Three kinds of row, in the order a dashboard is read: the filters, the
 * numbers, then the charts. The filters were a rail down the left, which is the
 * other common arrangement and the wrong one here — a column 240 wide beside a
 * board 1400 tall has to either stretch two filters over the whole height or
 * stop somewhere up the side, and both of those are the raggedness this is
 * meant to remove.
 *
 * @param {object[]} charts   in the order they should be read
 * @param {object[]} slicers  filter tiles, across the top
 * @param {object[]} cards    KPI tiles, under them
 * @returns {Map<string, {x,y,w,h}>} keyed by tile id
 */
export function composeBoard(charts = [], slicers = [], cards = []) {
  const boxes = new Map();
  const width = CANVAS_WIDTH;
  /** One row of the grid: the ids in it and the height they share. */
  const rows = [];

  // The filters first, because they govern everything under them.
  const rail = slicers.slice(0, MAX_SLICERS);
  if (rail.length) {
    rows.push({
      ids: rail.map((slicer) => String(slicer.id)),
      height: Math.max(...rail.map((slicer) => railHeight(slicer.values))),
      fixed: true,
    });
  }

  // Then the numbers, because that is what a dashboard opens with, and because
  // they are the one row whose height never depends on shape.
  if (cards.length) {
    rows.push({ ids: cards.map((card) => String(card.id)), height: KPI_HEIGHT, fixed: true });
  }

  /*
   * Then the charts, in as few rows as the page can read.
   *
   * Shape used to decide this alone — a card a quarter of a row, a trend a
   * half — and on a page of fixed height that produced four and five rows of
   * charts, each of them a hundred and twenty pixels tall, which is an axis
   * with no plot. The row COUNT is the thing a page can afford, so it is
   * decided first: the lead finding takes one, and everything else divides
   * between the two that are left.
   *
   * Four across is the floor on legibility. Past that a chart is a thumbnail
   * whatever height it is given, and a fourth row costs less than a fifth
   * column.
   */
  const lead = charts.length && LEADS_WIDE.has(charts[0]?.chart_type) ? charts[0] : null;
  const rest = lead ? charts.slice(1) : charts;

  if (lead) {
    rows.push({ ids: [String(lead.id)], height: LEAD_HEIGHT });
  }

  if (rest.length) {
    const spare = Math.max(1, MAX_CHART_ROWS - (lead ? 1 : 0));
    // Three across is the shape to aim for; the rows available decide whether
    // it can be had. Two charts do not become two rows of one, and ten do not
    // become four rows of a hundred and twenty pixels.
    const count = Math.min(spare, Math.ceil(rest.length / PREFERRED_PER_ROW));
    const perRow = Math.min(MAX_PER_ROW, Math.ceil(rest.length / Math.max(1, count)));
    for (let i = 0; i < rest.length; i += perRow) {
      const group = rest.slice(i, i + perRow);
      rows.push({
        ids: group.map((chart) => String(chart.id)),
        // The tallest thing in the row still sets its share of the page, so a
        // row holding a matrix is taller than a row of donuts.
        height: Math.max(...group.map((chart) => (SHAPE[chart?.chart_type] || DEFAULT_SHAPE).height)),
      });
    }
  }

  /*
   * Fitted to the page, which is fixed.
   *
   * The heights above are what each row would like; the page is what there is.
   * Scaling them all by the same factor keeps their proportions — the lead
   * finding stays twice the height of the row under it — and lands the last row
   * exactly on the bottom edge, so the board fills its page instead of stopping
   * short of it or running off it.
   *
   * The filters and the cards are left out of the scaling: a list of values and
   * a number with a label need what they need, and stretching them would spend
   * on whitespace the height the charts are short of.
   */
  const fixed = rows.filter((r) => r.fixed).reduce((sum, r) => sum + r.height, 0);
  const flexible = rows.filter((r) => !r.fixed).reduce((sum, r) => sum + r.height, 0);
  const gutters = GUTTER * Math.max(0, rows.length - 1);
  const room = CANVAS_HEIGHT - gutters - fixed;
  const scale = flexible > 0 && room > 0 ? room / flexible : 1;

  let y = 0;
  rows.forEach((entry, index) => {
    const n = entry.ids.length;
    const each = Math.floor((width - GUTTER * (n - 1)) / n);
    const last = index === rows.length - 1;
    // The last row takes the rounding, the way the last card in a row does.
    const h = entry.fixed
      ? entry.height
      : last
        ? Math.max(MIN_ROW, CANVAS_HEIGHT - y)
        : Math.max(MIN_ROW, Math.round(entry.height * scale));

    entry.ids.forEach((id, i) => {
      const w = i === n - 1 ? width - (each + GUTTER) * (n - 1) : each;
      boxes.set(id, cardBox({ x: i * (each + GUTTER), y, w, h }));
    });
    y += h + GUTTER;
  });

  return boxes;
}

/**
 * The filters this deck is worth offering.
 *
 * Read off the charts rather than off the table: a column the deck never breaks
 * a number down by is a column nobody looking at this dashboard wants to filter
 * on, however tidy its values are. Ordered by how many of the charts use it,
 * because the filter that changes the most of the board is the one to offer
 * first.
 *
 * @returns {object[]} chart specs, ready to execute, with ids and titles
 */
export function planSlicers(charts = [], { profile = null, columns = [], sample = [], max = MAX_SLICERS } = {}) {
  if (!profile) return [];

  const cardinality = profile.cardinality || {};
  const temporal = new Set(profile.temporal || []);

  const uses = new Map();
  for (const chart of charts) {
    const column = chart?.dimension;
    if (!column) continue;
    uses.set(column, (uses.get(column) || 0) + 1);
  }

  const wanted = [...uses.entries()]
    .filter(([column]) => {
      if (temporal.has(column)) return false; // a date is a range, not a list of boxes
      const values = cardinality[column];
      return Number.isFinite(values) && values >= 2 && values <= MAX_SLICER_VALUES;
    })
    // Most used first; ties to the column with fewer values, which is the
    // easier one to read and the more likely to be a real segmentation.
    .sort((a, b) => b[1] - a[1] || (cardinality[a[0]] || 0) - (cardinality[b[0]] || 0))
    .slice(0, max);

  const specs = [];
  for (const [column] of wanted) {
    const built = buildChartSpec(
      { type: 'slicer', dims: { dimension: column }, vals: {}, limit: MAX_SLICER_VALUES },
      { columns, profile, sample, measures: [] }
    );
    if (built.error || !built.spec) continue;
    specs.push({
      ...built.spec,
      id: `filter_${specs.length + 1}`,
      // How many boxes this tile will hold, so the board can give it the room
      // it needs rather than a share of the column.
      values: cardinality[column],
      // Named for what it filters, not for what it counts: "Record Count by
      // Contract Type" is a true description of the query and a poor label for
      // a box of tick-boxes.
      title: prettyColumn(column),
      dimension: column,
    });
  }
  return specs;
}
