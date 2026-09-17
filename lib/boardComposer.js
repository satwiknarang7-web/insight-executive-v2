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
import { CANVAS_WIDTH, cardBox } from './canvasLayout.js';
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
    });
  }

  // Then the numbers, because that is what a dashboard opens with, and because
  // they are the one row whose height never depends on shape.
  if (cards.length) {
    rows.push({ ids: cards.map((card) => String(card.id)), height: KPI_HEIGHT });
  }

  // Then the charts, gathered into rows by how much of one each asks for.
  let row = [];
  let claimed = 0;
  let tallest = 0;

  const flush = () => {
    if (!row.length) return;
    rows.push({ ids: row.map((c) => String(c.id)), height: tallest });
    row = [];
    claimed = 0;
    tallest = 0;
  };

  charts.forEach((chart, index) => {
    const shape = SHAPE[chart?.chart_type] || DEFAULT_SHAPE;
    // The lead finding is read first and from furthest away, so it takes a row
    // of its own — but only if its shape can use the width. A donut stretched
    // across a dashboard is a very large donut.
    const lead = index === 0 && LEADS_WIDE.has(chart?.chart_type);
    const share = lead ? 1 : shape.width;

    if (claimed + share > 1.001) flush();
    row.push(chart);
    claimed += share;
    tallest = Math.max(tallest, lead ? LEAD_HEIGHT : shape.height);
    if (claimed > 0.999) flush();
  });
  flush();

  // Laid out: each row full width, its cards equal, its gutters equal.
  let y = 0;
  for (const entry of rows) {
    const n = entry.ids.length;
    const each = Math.floor((width - GUTTER * (n - 1)) / n);
    entry.ids.forEach((id, i) => {
      // The last card in a row takes the rounding, so the row ends flush with
      // the edge rather than a pixel or two short of it.
      const w = i === n - 1 ? width - (each + GUTTER) * (n - 1) : each;
      boxes.set(id, cardBox({ x: i * (each + GUTTER), y, w, h: entry.height }));
    });
    y += entry.height + GUTTER;
  }

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
