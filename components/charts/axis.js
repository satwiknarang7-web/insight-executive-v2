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
import { formatDateLabel, formatNumber } from '../../lib/format.js';
import { prettyColumn } from '../../lib/aggregateNames.js';
import { legendRows } from '../../lib/sliceLabels.js';

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
 * X-axis geometry for a categorical or temporal axis.
 *
 * Returns props to spread onto `<XAxis>`, the `bottom` margin the chart should
 * reserve so rotated labels have somewhere to go, and the props for an optional
 * axis title.
 */
export function xAxisGeometry(data, xKey, { fontSize = 12, compact = false, title = null } = {}) {
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
  const titleProps = compact ? null : axisTitleProps(title, { axis: 'x' });
  const height =
    Math.min(compact ? 54 : 130, Math.max(fontSize + 14, projected + 14)) +
    (titleProps ? AXIS_TITLE_SPACE : 0);

  return {
    title: titleProps,
    props: {
      dataKey: xKey,
      axisLine: false,
      tickLine: false,
      tick: { fill: 'var(--chart-axis, #94a3b8)', fontSize, fontWeight: 700 },
      tickFormatter: (v) => clip(formatDateLabel(v), HARD_MAX),
      interval: count > 24 ? 'preserveStartEnd' : 0,
      angle,
      textAnchor: angle ? 'end' : 'middle',
      height,
      dy: angle ? 4 : 8,
      minTickGap: angle ? 0 : 6,
    },
    bottom: height,
    rotated: !!angle,
  };
}

/**
 * Y-axis geometry sized to the widest tick the formatter will actually produce,
 * so "1234.5M" and "$12,345" are never clipped by a fixed gutter.
 */
export function yAxisGeometry(
  data,
  yKey,
  { fontSize = 12, formatter = formatNumber, title = null, compact = false } = {}
) {
  // A split chart has one key per series rather than one y column, and the
  // gutter has to fit the widest number across all of them.
  const keys = Array.isArray(yKey) ? yKey : [yKey];
  const values = (data || [])
    .flatMap((row) => keys.map((key) => row?.[key]))
    .filter((v) => typeof v === 'number');
  const widest = values.reduce((max, v) => Math.max(max, String(formatter(v) ?? '').length), 3);
  // Same on the vertical: a rotated title is what "Coupon Discou" was, clipped
  // against the edge of a tile too small to hold it.
  const titleProps = compact ? null : axisTitleProps(title, { axis: 'y' });
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
export function legendProps({ seriesCount = 1, compact = false } = {}) {
  if (seriesCount < 2 || compact) return null;

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
export const LEGEND_H = 26;

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
