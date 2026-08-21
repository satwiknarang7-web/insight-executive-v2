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

/** Rough width of a string at a given font size, in px. */
const textWidth = (s, fontSize = 12) => String(s ?? '').length * fontSize * 0.58;

/** Labels beyond this stay truncated even when rotated — nothing fits them. */
const HARD_MAX = 28;

/**
 * X-axis geometry for a categorical or temporal axis.
 *
 * Returns props to spread onto `<XAxis>` plus the `bottom` margin the chart
 * should reserve, so the rotated labels have somewhere to go.
 */
export function xAxisGeometry(data, xKey, { fontSize = 12, compact = false } = {}) {
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
  const height = Math.min(compact ? 92 : 130, Math.max(fontSize + 14, projected + 14));

  return {
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
export function yAxisGeometry(data, yKey, { fontSize = 12, formatter = formatNumber } = {}) {
  const values = (data || []).map((row) => row?.[yKey]).filter((v) => typeof v === 'number');
  const widest = values.reduce((max, v) => Math.max(max, String(formatter(v) ?? '').length), 3);
  const width = Math.min(96, Math.max(40, Math.ceil(textWidth(''.padEnd(widest, '0'), fontSize)) + 14));

  return {
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
 * Legend props that reserve their own row instead of overlapping the plot.
 * Returns `null` for a single series, where a legend is pure noise.
 */
export function legendGeometry(seriesCount = 1) {
  if (seriesCount < 2) return null;
  return {
    verticalAlign: 'top',
    align: 'right',
    height: 28,
    iconType: 'circle',
    iconSize: 8,
    wrapperStyle: { paddingBottom: 8, paddingRight: 4, lineHeight: '18px' },
  };
}

/** Truncate only as a last resort, and only past `max`. */
export function clip(value, max = HARD_MAX) {
  const s = typeof value === 'string' ? value : String(value ?? '');
  return s.length > max ? `${s.slice(0, max - 1)}…` : value;
}

/**
 * Standard chart margins. `bottom` comes from the x geometry so rotated labels
 * always have room; the top gap leaves space for a legend row.
 */
export function chartMargin({ bottom = 40, legend = false, right = 16 } = {}) {
  return { top: legend ? 8 : 16, right, left: 4, bottom: Math.max(8, bottom - 24) };
}
