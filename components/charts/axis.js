/**
 * Shared axis sizing for every chart.
 *
 * Charts previously hard-coded `height={50}`, `width={55}` and a fixed bottom
 * margin, then truncated every x label to 16 characters. On real data that meant
 * "Enterprise - North America" rendered as "Enterprise - No…", y ticks like
 * "1234.5M" ran into the plot, and a legend sat on top of the tallest bar.
 *
 * The fix is to measure the labels that will actually be drawn and size the
 * gutters to fit them: rotate long categorical labels rather than cutting them,
 * widen the y gutter for wide numbers, and only fall back to truncation when a
 * label is long enough that no reasonable gutter would hold it.
 */
import { formatDateLabel, formatNumber, formatPercent, isPercentKey } from '../../lib/format.js';
import { prettyColumn } from '../../lib/aggregateNames.js';
import { legendRows } from '../../lib/sliceLabels.js';

export const LEGEND_H = 26;

/** Rough width of a string at a given font size, in px. */
const textWidth = (s, fontSize = 12) => String(s ?? '').length * fontSize * 0.58;

/** Labels beyond this stay truncated even when rotated — nothing fits them. */
const HARD_MAX = 28;

/**
 * A human name for a column key: `total_revenue` -> `Total Revenue`.
 *
 * The same function the query planner names its aggregates with, and that is
 * the point: an axis reading "Total Daily Streams" and an alias built as
 * "Total DailyStreams" would be two names for one number. It lives in a tiny
 * pure module rather than in the analysis engine, so a chart component does not
 * pull the engine into the client bundle for one string transform.
 */
export const prettyLabel = prettyColumn;

/**
 * Props for an axis title, or null when there is nothing worth saying.
 *
 * Callers pass `skip` when they want a deliberately bare axis (a sparkline, a
 * thumbnail). Small charts are NOT skipped by default: a cramped chart is
 * exactly where an unnamed axis is hardest to read.
 */
export function axisTitleProps(title, { axis = 'x', fontSize = 11, skip = false } = {}) {
  const text = String(title ?? '').trim();
  if (!text || skip) return null;

  const common = {
    value: text,
    fill: 'var(--chart-axis, #94a3b8)',
    fontSize,
    fontWeight: 800,
    letterSpacing: '0.08em',
  };

  return axis === 'y'
    ? { ...common, angle: -90, position: 'insideLeft', style: { textAnchor: 'middle' } }
    : { ...common, position: 'insideBottom', offset: 0 };
}

/** Extra gutter an axis title needs, in px. */
export const AXIS_TITLE_SPACE = 22;

/**
 * What a category axis costs on a tile with no height to spare.
 *
 * One flat line and the gap above it. Small enough that a 110px tile can afford
 * it, which is the whole point: the alternative was an unlabelled axis.
 */
export const DENSE_AXIS_HEIGHT = 18;
export const DENSE_FONT_SIZE = 9;

/** Past this many categories a single flat line has to start dropping them. */
export const DENSE_MAX_TICKS = 7;

/** And each one is clipped to about what fits under a bar at this size. */
export const DENSE_MAX_CHARS = 9;

/**
 * X-axis geometry for a categorical or temporal axis.
 *
 * Returns props to spread onto `<XAxis>`, the `bottom` margin the chart should
 * reserve so rotated labels have somewhere to go, and the props for an optional
 * axis title.
 */
export function xAxisGeometry(
  data,
  xKey,
  { fontSize = 12, compact = false, title = null, dense = false } = {}
) {
  const labels = (data || []).map((row) => String(formatDateLabel(row?.[xKey]) ?? ''));
  const longest = labels.reduce((max, l) => Math.max(max, l.length), 0);
  const count = labels.length;

  // Space each label can occupy before neighbours collide, assuming a typical
  // plot width. Below ~9 characters everything fits flat at any sane count.
  const crowded = count > 8 || longest > (compact ? 8 : 11);

  const angle = crowded ? -35 : 0;
  const shown = longest > HARD_MAX ? HARD_MAX : longest;
  // A rotated label projects cos(35°)≈0.82 of its width onto the vertical axis.
  const projected = crowded ? Math.ceil(textWidth(''.padEnd(shown, 'M'), fontSize) * 0.6) : fontSize + 6;
  /**
   * No axis titles on a thumbnail, and a tighter gutter.
   *
   * On the closing slide of a deck a chart gets a third of a row. The gutter
   * could take 92 pixels of it and an axis title another 22, so a tile of 180
   * had 40 left to draw in — which is how nine charts came out as nine sets of
   * axis labels with nothing between them. The axis title is the duplication to
   * cut first: the card above it already says "Total Amount by Category", so
   * repeating "Category" underneath buys nothing at any size.
   */
  const titleProps = compact || dense ? null : axisTitleProps(title, { axis: 'x' });
  /**
   * A tile too short to hold both an axis and a plot spends a line on the axis.
   *
   * It used to drop the categories entirely below about two hundred pixels, on
   * the reasoning that the card above is titled "Average Monthly Charge by Plan
   * Tier" and so already names them. It names the *dimension*. It does not say
   * which bar is Basic and which is Enterprise, and four anonymous bars over an
   * unlabelled axis is not a chart anybody can read — which is what the deck's
   * board slide was showing.
   *
   * So a dense axis is a cheap one rather than no one: flat, small, and clipped
   * hard. Fifty-four pixels went on rotated labels, and rotation is the
   * expensive part; one flat line of nine-point text costs eighteen and tells
   * the reader what they are looking at.
   */
  const denseHeight = DENSE_AXIS_HEIGHT;
  const height = dense
    ? denseHeight
    : Math.min(compact ? 54 : 130, Math.max(fontSize + 14, projected + 14)) +
      (titleProps ? AXIS_TITLE_SPACE : 0);

  return {
    title: titleProps,
    // Nothing is hidden any more; the caller still reads this so a future
    // surface with truly no room has somewhere to say so.
    hidden: false,
    props: {
      dataKey: xKey,
      axisLine: false,
      tickLine: false,
      tick: {
        fill: 'var(--chart-axis, #94a3b8)',
        fontSize: dense ? DENSE_FONT_SIZE : fontSize,
        fontWeight: 700,
      },
      // Clipped much harder when dense: a name that does not fit is better as
      // its first few letters than as a smear across its neighbour's.
      tickFormatter: (v) => clip(formatDateLabel(v), dense ? DENSE_MAX_CHARS : HARD_MAX),
      /*
       * Every category, unless there are more than a row can hold.
       *
       * `preserveStartEnd` keeps the two that bound the axis and drops the
       * middle, which is the right answer for a histogram — the range is the
       * information — and the only answer that avoids overprinting when a dozen
       * names share one flat line.
       */
      interval: count > (dense ? DENSE_MAX_TICKS : 24) ? 'preserveStartEnd' : 0,
      // Rotation needs room to project into, and a dense axis has none.
      angle: dense ? 0 : angle,
      textAnchor: dense || !angle ? 'middle' : 'end',
      height,
      dy: dense ? 6 : angle ? 4 : 8,
      minTickGap: dense ? 2 : angle ? 0 : 6,
    },
    bottom: height,
    rotated: !dense && !!angle,
  };
}

/**
 * Y-axis geometry sized to the widest tick the formatter will actually produce,
 * so "1234.5M" and "$12,345" are never clipped by a fixed gutter.
 */
export function yAxisGeometry(
  data,
  yKey,
  { fontSize = 12, formatter = formatNumber, title = null, compact = false, dense = false } = {}
) {
  // A split chart has one key per series rather than one y column, and the
  // gutter has to fit the widest number across all of them.
  const keys = Array.isArray(yKey) ? yKey : [yKey];
  // An axis of percentages says so. The prose has carried the unit since rates
  // started being reported in points; the axis beside it still read "9 18 27
  // 36", which is a medal rate with nothing to say what it is a rate of.
  const asPercent = keys.some((k) => isPercentKey(k));
  if (formatter === formatNumber && asPercent) {
    formatter = formatPercent;
  }
  const values = (data || [])
    .flatMap((row) => keys.map((key) => row?.[key]))
    .filter((v) => typeof v === 'number');
  const widest = values.reduce((max, v) => Math.max(max, String(formatter(v) ?? '').length), 3);
  // Same on the vertical: a rotated title is what "Coupon Discou" was, clipped
  // against the edge of a tile too small to hold it. The ticks themselves stay
  // where the x labels go — a chart with no scale at all is a decoration, and
  // the numbers up the side are what keep a thumbnail readable as data.
  const titleProps = compact || dense ? null : axisTitleProps(title, { axis: 'y' });
  // A rotated title needs its own column beside the ticks.
  const width =
    Math.min(96, Math.max(40, Math.ceil(textWidth(''.padEnd(widest, '0'), fontSize)) + 14)) +
    (titleProps ? AXIS_TITLE_SPACE : 0);

  return {
    title: titleProps,
    props: {
      axisLine: false,
      tickLine: false,
      tick: { fill: 'var(--chart-axis, #94a3b8)', fontSize, fontWeight: 700 },
      tickFormatter: formatter,
      width,
    },
    width,
  };
}

/**
 * Legend props that reserve their own row instead of eating the plot.
 *
 * Every chart used to hand-roll its own `<Legend>`, and a vertical one aligned
 * to the right had no width cap — on a dashboard card the radial chart's legend
 * grew to 144px and squeezed the plot down to EIGHT pixels. Recharts reserves
 * space from the legend's measured box, so the only reliable fix is to give it
 * a shape that cannot grow: one horizontal row, of fixed height, along the top.
 *
 * Returns `null` when a legend would be noise or would not fit — a single
 * series names itself, and a small card has no room for one at all. Callers
 * render `{legend && <Legend {...legend} />}`.
 */
export function legendProps({ seriesCount = 1, compact = false, required = false } = {}) {
  if (seriesCount < 2) return null;

  /*
   * A compact tile drops its legend, except where the legend IS the chart.
   *
   * On a bar chart the categories are written along the axis and the legend
   * repeats them, so a small tile loses nothing by dropping it. On a donut the
   * colours are the only thing tying an arc to a name: dropped, it becomes a
   * ring of anonymous colours with a few numbers around it, which is what a
   * board of small tiles was showing. Where it is required it is kept, and kept
   * to one row — the room is the reason it was being dropped.
   */
  if (compact) {
    if (!required) return null;
    return {
      verticalAlign: 'bottom',
      align: 'center',
      layout: 'horizontal',
      height: LEGEND_H,
      iconType: 'circle',
      iconSize: 7,
      wrapperStyle: {
        paddingTop: 2,
        lineHeight: '14px',
        maxHeight: LEGEND_H,
        overflow: 'hidden',
        fontSize: 10,
      },
    };
  }

  // A legend is allowed a second row, and no more. Clipping it to one hid
  // entries past the first, which left colours in the chart that nothing on
  // screen named; letting it grow freely squeezed the plot, which is why it was
  // pinned in the first place. Past two rows the entries scroll.
  const rows = legendRows(seriesCount);
  const height = LEGEND_H * rows;

  return {
    verticalAlign: 'top',
    align: 'right',
    layout: 'horizontal',
    height,
    iconType: 'circle',
    iconSize: 8,
    wrapperStyle: {
      paddingBottom: 6,
      paddingRight: 4,
      lineHeight: '16px',
      maxHeight: height,
      overflowY: rows > 1 ? 'auto' : 'hidden',
      overflowX: 'hidden',
    },
  };
}

/** The height of one row of legend entries. */

/** Truncate only as a last resort, and only past `max`. */
export function clip(value, max = HARD_MAX) {
  const s = typeof value === 'string' ? value : String(value ?? '');
  return s.length > max ? `${s.slice(0, max - 1)}…` : value;
}

/**
 * Standard chart margins — breathing room only, never axis space.
 */
export function chartMargin({ legend = false, right = 16 } = {}) {
  // `bottom` is deliberately NOT derived from the x-axis gutter any more.
  //
  // Recharts reserves the axis gutter from `<XAxis height>` AND the margin on
  // top of it, so passing the gutter here counted it twice: a rotated axis with
  // a title reserved ~150px of a 224px card through the axis, then another
  // ~128px through the margin. That is what pushed labels out of their box and
  // left a band of dead space under every chart. The margin is now just
  // breathing room; the axis owns its own gutter.
  return { top: legend ? 4 : 12, right, left: 4, bottom: 6 };
}
