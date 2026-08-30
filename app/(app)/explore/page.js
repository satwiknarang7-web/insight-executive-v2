'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Search,
  ChevronLeft,
  ChevronRight,
  ArrowUp,
  ArrowDown,
  AlertTriangle,
  Loader2,
  Hash,
  Type,
  Calendar,
  Fingerprint,
} from 'lucide-react';
import { useActions, useDataset, useMeasures } from '../../../lib/store/DatasetProvider';
import PageFrame from '../../../components/shell/PageFrame';
import { formatExact, formatNumber } from '../../../lib/format';
import { formatMeasureValue } from '../../../lib/measures';

const PAGE_SIZE = 50;

const ROLE_ICON = { measure: Hash, dimension: Type, time: Calendar, identifier: Fingerprint };

export default function ExplorePage() {
  const { dataset } = useDataset();
  const { fetchPage, evaluateMeasuresOverView } = useActions();
  const measures = useMeasures();

  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [sortBy, setSortBy] = useState(null);
  const [sortDir, setSortDir] = useState('asc');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('');
  const [anomaliesOnly, setAnomaliesOnly] = useState(false);
  // null means the joined analysis view — the table every chart and measure
  // runs against. The source sheets are browsable in their own right, which
  // they were not: with three files loaded this page showed the view and gave
  // no way to look at the other two at all.
  const [table, setTable] = useState(null);
  const [loading, setLoading] = useState(true);
  const [measureValues, setMeasureValues] = useState({});
  const [measuresBusy, setMeasuresBusy] = useState(false);

  // Debounce the search box: every keystroke otherwise scans every row.
  const timerRef = useRef(0);
  useEffect(() => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setFilter(search.trim());
      setOffset(0);
    }, 250);
    return () => clearTimeout(timerRef.current);
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchPage({ offset, limit: PAGE_SIZE, sortBy, sortDir, filter, anomaliesOnly, table })
      .then((res) => {
        if (cancelled) return;
        setRows(res.rows);
        setTotal(res.total);
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [fetchPage, offset, sortBy, sortDir, filter, anomaliesOnly, table]);

  // Measures follow the filter, not the page: paging through the same selection
  // must not recompute them, and narrowing the selection must.
  useEffect(() => {
    if (!measures.length) {
      setMeasureValues({});
      return undefined;
    }
    let cancelled = false;
    setMeasuresBusy(true);
    evaluateMeasuresOverView({ filter, anomaliesOnly })
      .then((results) => {
        if (cancelled) return;
        setMeasureValues(Object.fromEntries(results.map((r) => [r.id, r])));
      })
      .catch(() => !cancelled && setMeasureValues({}))
      .finally(() => !cancelled && setMeasuresBusy(false));
    return () => {
      cancelled = true;
    };
  }, [evaluateMeasuresOverView, measures, filter, anomaliesOnly]);

  const toggleSort = useCallback(
    (col) => {
      if (sortBy === col) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      } else {
        setSortBy(col);
        setSortDir('asc');
      }
      setOffset(0);
    },
    [sortBy]
  );

  if (!dataset) return null;

  // The columns belong to whatever is being shown: the view has the joined set,
  // a source sheet has its own.
  const sourceTable = (dataset.tables || []).find((t) => t.name === table) || null;
  const columns = sourceTable ? sourceTable.columns : dataset.columns;
  const profile = dataset.profile?.columns || {};
  const pageStart = total === 0 ? 0 : offset + 1;
  const pageEnd = Math.min(offset + PAGE_SIZE, total);

  return (
    <PageFrame
      title="Explore"
      subtitle={`${dataset.rowCount.toLocaleString()} cleaned rows · ${columns.length} columns`}
      action={
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/25" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search all columns…"
              title={'Every word has to match somewhere in the row, in any column. Put "quotes" around a phrase to keep it together.'}
              aria-label="Search all columns"
              className="w-56 rounded-lg border border-white/10 bg-white/5 py-2 pl-9 pr-3 text-xs font-medium outline-none placeholder:text-white/25 focus:border-accent-500/50 md:w-72"
            />
          </div>
          <button
            onClick={() => {
              setAnomaliesOnly((a) => !a);
              setOffset(0);
            }}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[10px] font-black uppercase tracking-[0.2em] transition-colors ${
              anomaliesOnly
                ? 'border-rose-500/35 bg-rose-500/12 text-rose-300'
                : 'border-white/10 text-white/45 hover:bg-white/5 hover:text-white'
            }`}
          >
            <AlertTriangle size={13} /> Outliers
          </button>
        </div>
      }
    >
      {/* Which table is on screen.
          The analysis view is the default because it is what every chart and
          measure runs against — but it is fact-grain, so a dimension sheet's
          own rows are only visible here. Shown only when there is more than one
          table, since a single upload has nothing to switch between. */}
      {dataset.multiTable && (dataset.tables || []).length > 1 && (
        <section className="mb-6">
          <div className="label mb-2">Table</div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => { setTable(null); setOffset(0); setSortBy(null); }}
              className={`rounded-lg border px-3 py-1.5 text-[11px] font-bold transition-colors ${
                table === null
                  ? 'border-accent-500/40 bg-accent-500/10 text-accent-300'
                  : 'border-white/10 text-white/50 hover:bg-white/5 hover:text-white'
              }`}
            >
              Analysis view
              <span className="ml-1.5 text-white/30">{dataset.rowCount.toLocaleString()} rows</span>
            </button>
            {(dataset.tables || []).map((t) => (
              <button
                key={t.name}
                type="button"
                onClick={() => { setTable(t.name); setOffset(0); setSortBy(null); }}
                title={`${t.role === 'fact' ? 'Fact table' : 'Dimension table'} · ${t.sourceFile || t.name}`}
                className={`rounded-lg border px-3 py-1.5 text-[11px] font-bold transition-colors ${
                  table === t.name
                    ? 'border-accent-500/40 bg-accent-500/10 text-accent-300'
                    : 'border-white/10 text-white/50 hover:bg-white/5 hover:text-white'
                }`}
              >
                {t.name}
                <span className="ml-1.5 text-white/30">{t.rowCount.toLocaleString()} rows</span>
              </button>
            ))}
          </div>
          {table && (
            <p className="mt-2 text-[11px] leading-relaxed text-white/30">
              These are the rows of {table} itself. Charts and measures run against the analysis
              view, which joins them onto the fact table.
            </p>
          )}
        </section>
      )}

      {/* Measures, over whatever the filter has selected */}
      {measures.length > 0 && table === null && (
        <section className="mb-6">
          <div className="label mb-3">
            Measures {filter || anomaliesOnly ? '· over the filtered rows' : '· over all rows'}
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {measures.map((m) => {
              const result = measureValues[m.id];
              return (
                <div key={m.id} className="card p-3">
                  <div className="truncate text-[11px] font-bold text-white/50" title={m.name}>
                    {m.name}
                  </div>
                  <div className="mt-1 truncate text-lg font-black text-white/90">
                    {result?.error ? (
                      <span className="text-[12px] font-bold text-amber-400" title={result.error}>
                        Not available
                      </span>
                    ) : result && result.value !== null && result.value !== undefined ? (
                      formatMeasureValue(result.value, m.format)
                    ) : measuresBusy ? (
                      <span className="text-[12px] text-white/30">…</span>
                    ) : (
                      <span className="text-[12px] text-white/30">—</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Column profile */}
      <section className="mb-6">
        <div className="label mb-3">Columns</div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {columns.map((col) => {
            const p = profile[col] || {};
            const Icon = ROLE_ICON[p.role] || Type;
            const nullPct = dataset.rowCount ? ((p.nullCount || 0) / dataset.rowCount) * 100 : 0;
            return (
              <div key={col} className="card p-3">
                <div className="flex items-center gap-2">
                  <Icon size={12} className="shrink-0 text-accent-400/70" />
                  <span className="truncate text-xs font-bold text-white/80" title={col}>
                    {col}
                  </span>
                  <span className="ml-auto shrink-0 text-[9px] font-black uppercase tracking-[0.15em] text-white/25">
                    {p.role || 'text'}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-white/35">
                  <span>
                    {(p.distinctCount || 0).toLocaleString()}
                    {p.distinctCapped ? '+' : ''} distinct
                  </span>
                  {nullPct > 0 && <span className="text-amber-400/70">{nullPct.toFixed(1)}% blank</span>}
                  {p.type === 'number' && p.min !== null && (
                    <span>
                      {formatNumber(p.min)} – {formatNumber(p.max)}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Table */}
      <section className="card overflow-hidden">
        <div className="flex items-center justify-between gap-4 border-b border-white/7 px-4 py-3">
          <div className="flex items-center gap-2 text-xs text-white/40">
            {loading && <Loader2 size={13} className="animate-spin text-accent-400" />}
            <span>
              {pageStart.toLocaleString()}–{pageEnd.toLocaleString()} of {total.toLocaleString()}
              {(filter || anomaliesOnly) && ' matching'}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
              disabled={offset === 0}
              aria-label="Previous page"
              className="rounded-lg border border-white/10 p-1.5 text-white/50 transition-colors enabled:hover:bg-white/5 enabled:hover:text-white disabled:opacity-25"
            >
              <ChevronLeft size={14} />
            </button>
            <button
              onClick={() => setOffset((o) => (o + PAGE_SIZE < total ? o + PAGE_SIZE : o))}
              disabled={offset + PAGE_SIZE >= total}
              aria-label="Next page"
              className="rounded-lg border border-white/10 p-1.5 text-white/50 transition-colors enabled:hover:bg-white/5 enabled:hover:text-white disabled:opacity-25"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead className="sticky top-0 bg-canvas-raised">
              <tr>
                {columns.map((col) => (
                  <th key={col} className="whitespace-nowrap border-b border-white/7 px-3 py-2.5">
                    <button
                      onClick={() => toggleSort(col)}
                      className="flex items-center gap-1 text-[10px] font-black uppercase tracking-[0.15em] text-white/45 transition-colors hover:text-accent-300"
                    >
                      {col}
                      {sortBy === col &&
                        (sortDir === 'asc' ? <ArrowUp size={10} /> : <ArrowDown size={10} />)}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr
                  key={offset + i}
                  className={`border-b border-white/4 transition-colors hover:bg-white/[0.03] ${
                    row.isAnomaly ? 'bg-rose-500/[0.04]' : ''
                  }`}
                >
                  {columns.map((col) => (
                    <td key={col} className="max-w-[240px] truncate px-3 py-2 text-white/65" title={String(row[col] ?? '')}>
                      {renderCell(row[col], col)}
                    </td>
                  ))}
                </tr>
              ))}
              {rows.length === 0 && !loading && (
                <tr>
                  <td colSpan={columns.length} className="px-4 py-12 text-center text-white/30">
                    No rows match those filters.
                    {filter && (
                      <span className="mt-1 block text-[11px]">
                        Every word has to appear somewhere in the row. Try fewer of them.
                      </span>
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </PageFrame>
  );
}

function renderCell(v, column) {
  if (v === null || v === undefined || v === '') {
    return <span className="text-white/15">—</span>;
  }
  // Exact, not abbreviated. This is a table of rows: a PIN code of 505800 is
  // not usefully "505.8K", and neither is an order value the reader came here
  // to check against their own records.
  if (typeof v === 'number') return <span className="font-mono">{formatExact(v, column)}</span>;
  const s = String(v);
  if (s.startsWith('[REDACTED')) {
    return <span className="rounded bg-accent-500/10 px-1.5 py-0.5 font-mono text-[10px] text-accent-300/70">{s}</span>;
  }
  // ISO timestamps read better as plain dates in a table.
  const iso = s.match(/^(\d{4}-\d{2}-\d{2})T/);
  return iso ? iso[1] : s;
}
