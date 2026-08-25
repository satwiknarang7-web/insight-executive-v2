'use client';

/**
 * The visuals that are not really charts: cards, KPIs, tables and matrices.
 *
 * These are HTML rather than SVG, deliberately. A number on a card wants to be
 * selectable, a table wants to scroll and wrap, and a matrix wants sticky
 * headers — all of which are free in HTML and fought for in SVG. They share the
 * chart pipeline (same result rows, same resolver, same slide) but not its
 * rendering.
 *
 * Every one of them formats through the same helpers the charts use, so a
 * figure shown on a card matches the same figure on an axis.
 */
import { useMemo } from 'react';
import { formatNumber, formatValue } from '../../lib/format';
import { prettyLabel } from './axis';
import { cellKey, toMatrix } from '../../lib/pivot';
import { usePalette } from './palette';

/** Rows are already aggregated by the engine; this is the headline number. */
function headline(data, yKey) {
  const values = (data || []).map((r) => Number(r?.[yKey])).filter((v) => Number.isFinite(v));
  if (!values.length) return null;
  // One row is the value itself; many rows are a series, and the total is the
  // only summary that is true regardless of what the rows mean.
  return values.length === 1 ? values[0] : values.reduce((s, v) => s + v, 0);
}

const Empty = ({ children }) => (
  <div className="flex h-full items-center justify-center px-6 text-center text-[11px] font-black uppercase tracking-[0.2em] text-white/25">
    {children}
  </div>
);

/** One number, as large as the space allows. */
export function CardVisual({ data, xKey, yKey, label = null }) {
  const value = headline(data, yKey);
  if (value === null) return <Empty>No value</Empty>;

  const many = (data?.length || 0) > 1;
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
      <div className="text-[clamp(2rem,7vw,3.5rem)] font-black leading-none tracking-tight text-white">
        {formatValue(value, yKey)}
      </div>
      <div className="label">{label ?? prettyLabel(yKey)}</div>
      {many && (
        <div className="text-[11px] text-white/30">
          total across {data.length} {prettyLabel(xKey).toLowerCase() || 'rows'}
        </div>
      )}
    </div>
  );
}

/** A short list of related values — the same shape a card has, repeated. */
export function MultiRowCardVisual({ data, xKey, yKey, limit = 6 }) {
  if (!data?.length) return <Empty>No values</Empty>;
  const rows = data.slice(0, limit);

  return (
    <div className="flex h-full flex-col justify-center gap-2 overflow-y-auto px-2 py-2">
      {rows.map((row, i) => (
        <div
          key={i}
          className="flex items-baseline justify-between gap-4 border-b border-white/5 px-2 pb-2 last:border-0"
        >
          <span className="truncate text-[12px] font-bold text-white/55" title={String(row?.[xKey] ?? '')}>
            {String(row?.[xKey] ?? '—')}
          </span>
          <span className="shrink-0 font-mono text-lg font-black text-white">
            {formatValue(row?.[yKey], yKey)}
          </span>
        </div>
      ))}
      {data.length > limit && (
        <div className="px-2 text-[10px] font-bold uppercase tracking-[0.2em] text-white/25">
          +{data.length - limit} more
        </div>
      )}
    </div>
  );
}

/**
 * Value against target.
 *
 * With no explicit target the best available comparison is the series average,
 * which answers "is this one above or below par?" — and the card says which
 * comparison it used rather than implying a goal nobody set.
 */
export function KpiVisual({ data, xKey, yKey, target = null }) {
  const value = headline(data, yKey);
  if (value === null) return <Empty>No value</Empty>;

  const values = (data || []).map((r) => Number(r?.[yKey])).filter(Number.isFinite);
  const derivedTarget =
    target ?? (values.length > 1 ? values.reduce((s, v) => s + v, 0) / values.length : null);

  const delta = derivedTarget ? value - derivedTarget : null;
  const pct = derivedTarget ? (delta / Math.abs(derivedTarget)) * 100 : null;
  const good = delta !== null && delta >= 0;

  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
      <div className="label">{prettyLabel(yKey)}</div>
      <div className="text-[clamp(1.8rem,6vw,3rem)] font-black leading-none tracking-tight text-white">
        {formatValue(value, yKey)}
      </div>
      {derivedTarget !== null ? (
        <>
          <div
            className={`text-sm font-black ${good ? 'text-emerald-400' : 'text-rose-400'}`}
          >
            {good ? '▲' : '▼'} {formatNumber(Math.abs(delta))}
            {pct !== null && Number.isFinite(pct) ? ` (${Math.abs(pct).toFixed(1)}%)` : ''}
          </div>
          <div className="text-[11px] text-white/30">
            against {target ? 'target' : 'the average'} of {formatNumber(derivedTarget)}
          </div>
        </>
      ) : (
        <div className="text-[11px] text-white/30">no target to compare against</div>
      )}
    </div>
  );
}

/** The result rows, as rows. */
export function TableVisual({ data, columns = null }) {
  const cols = useMemo(() => {
    if (columns?.length) return columns;
    const first = data?.[0];
    return first ? Object.keys(first).filter((k) => k !== 'isAnomaly' && !k.startsWith('__')) : [];
  }, [data, columns]);

  if (!data?.length || !cols.length) return <Empty>No rows</Empty>;

  return (
    <div className="h-full overflow-auto rounded-lg border border-white/6">
      <table className="w-full border-collapse text-left text-[12px]">
        <thead className="sticky top-0 z-10 bg-surface">
          <tr>
            {cols.map((c) => (
              <th
                key={c}
                className="border-b border-white/8 px-3 py-2 text-[9px] font-black uppercase tracking-[0.15em] text-white/40"
              >
                {prettyLabel(c)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <tr key={i} className="hover:bg-white/[0.03]">
              {cols.map((c) => (
                <td
                  key={c}
                  className={`border-b border-white/4 px-3 py-1.5 ${
                    typeof row[c] === 'number' ? 'text-right font-mono text-white/75' : 'text-white/60'
                  }`}
                >
                  {typeof row[c] === 'number' ? formatValue(row[c], c) : String(row[c] ?? '—')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * A cross-tab: one dimension down the side, another across the top.
 *
 * Needs two dimensions to be a matrix at all. Given only one it says so rather
 * than rendering a table with a single column and pretending that is a pivot.
 */
export function MatrixVisual({ data, xKey, yKey, columnKey }) {
  const CHART_COLORS = usePalette();

  const pivot = useMemo(
    () => toMatrix(data, xKey, columnKey, yKey),
    [data, xKey, columnKey, yKey]
  );

  if (!pivot) return <Empty>A matrix needs two categories and a measure</Empty>;

  const { rowNames, colNames, cells, max } = pivot;
  const totalFor = (r) => colNames.reduce((s, c) => s + (cells.get(cellKey(r, c)) || 0), 0);

  return (
    <div className="h-full overflow-auto rounded-lg border border-white/6">
      <table className="w-full border-collapse text-left text-[12px]">
        <thead className="sticky top-0 z-10 bg-surface">
          <tr>
            <th className="border-b border-white/8 px-3 py-2 text-[9px] font-black uppercase tracking-[0.15em] text-white/40">
              {prettyLabel(xKey)}
            </th>
            {colNames.map((c) => (
              <th
                key={c}
                className="border-b border-white/8 px-3 py-2 text-right text-[9px] font-black uppercase tracking-[0.15em] text-white/40"
              >
                {c || '—'}
              </th>
            ))}
            <th className="border-b border-white/8 px-3 py-2 text-right text-[9px] font-black uppercase tracking-[0.15em] text-white/55">
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {rowNames.map((r) => (
            <tr key={r}>
              <td className="border-b border-white/4 px-3 py-1.5 font-bold text-white/70">{r || '—'}</td>
              {colNames.map((c) => {
                const v = cells.get(cellKey(r, c));
                // A faint wash proportional to the value: a heat map is what
                // makes a grid of numbers readable at a glance.
                const intensity = v ? Math.min(0.32, (Math.abs(v) / max) * 0.32) : 0;
                return (
                  <td
                    key={c}
                    className="border-b border-white/4 px-3 py-1.5 text-right font-mono text-white/75"
                    style={intensity ? { backgroundColor: hexWithAlpha(CHART_COLORS[0], intensity) } : undefined}
                  >
                    {v === undefined ? '—' : formatValue(v, yKey)}
                  </td>
                );
              })}
              <td className="border-b border-white/4 px-3 py-1.5 text-right font-mono font-black text-white/85">
                {formatValue(totalFor(r), yKey)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** `#rrggbb` plus an alpha channel, for the matrix heat wash. */
function hexWithAlpha(hex, alpha) {
  const clean = String(hex || '').replace('#', '');
  if (clean.length !== 6) return undefined;
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
    .toString(16)
    .padStart(2, '0');
  return `#${clean}${a}`;
}
