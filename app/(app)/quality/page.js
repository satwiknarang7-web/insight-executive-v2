'use client';

import { ShieldCheck, EyeOff, AlertTriangle, Wand2, Trash2, Code2, ChevronRight, Database } from 'lucide-react';
import { useAnalysis, useDataset } from '../../../lib/store/DatasetProvider';
import PageFrame from '../../../components/shell/PageFrame';

export default function QualityPage() {
  const { dataset } = useDataset();
  const { analysis } = useAnalysis();
  if (!dataset) return null;

  const m = dataset.metrics;
  const integrity = m.totalCells > 0 ? ((m.totalCells - m.totalAnomalies) / m.totalCells) * 100 : 100;
  const good = integrity >= 90;

  const columns = dataset.columns;
  const profile = dataset.profile?.columns || {};

  return (
    <PageFrame title="Data Quality" subtitle={`Cleaning report for ${dataset.fileName}`}>
      {/* Integrity headline */}
      <section className="card mb-6 p-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="label">Integrity score</div>
            <div className={`mt-1 text-4xl font-black tracking-tight ${good ? 'text-emerald-400' : 'text-amber-400'}`}>
              {integrity.toFixed(1)}%
            </div>
          </div>
          <p className="max-w-md text-[12px] leading-relaxed text-white/35">
            The share of cells that are present and not statistically extreme. Type coercion (turning
            &quot;$1,200&quot; into 1200) is normal cleaning and is not counted against the score.
          </p>
        </div>
        <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-white/6">
          <div
            className={`h-full rounded-full ${good ? 'bg-emerald-500' : 'bg-amber-500'}`}
            style={{ width: `${integrity}%` }}
          />
        </div>
      </section>

      {/* Ingestion metrics */}
      <section className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <Metric icon={Database} label="Rows read" value={m.totalRows} />
        <Metric icon={ShieldCheck} label="Rows kept" value={m.cleanRows ?? dataset.rowCount} tone="emerald" />
        <Metric icon={EyeOff} label="PII redacted" value={m.redactedPII} tone="accent" />
        <Metric icon={Wand2} label="Values coerced" value={m.typesCoerced} />
        <Metric icon={AlertTriangle} label="Blank cells" value={m.nullsFound} tone="amber" />
        <Metric icon={Trash2} label="Empty rows dropped" value={m.droppedRows} tone="rose" />
      </section>

      {/* What was done */}
      <section className="card mb-8 p-6">
        <div className="label mb-4">What the cleaner did</div>
        <ul className="grid gap-3 md:grid-cols-2">
          <Bullet title="Redacted personal data">
            Email addresses, phone numbers and SSN- or card-shaped identifiers were replaced with
            <code className="mx-1 rounded bg-white/6 px-1.5 py-0.5 font-mono text-[11px]">[REDACTED_*]</code>
            before anything else ran. {m.redactedPII.toLocaleString()} cells were affected.
          </Bullet>
          <Bullet title="Normalised types">
            Currency symbols, thousands separators, percentages and accounting negatives were parsed into
            numbers; date-shaped strings became ISO dates. {m.typesCoerced.toLocaleString()} values changed type.
          </Bullet>
          <Bullet title="Standardised blanks">
            Tokens like <code className="rounded bg-white/6 px-1 py-0.5 font-mono text-[11px]">N/A</code>,{' '}
            <code className="rounded bg-white/6 px-1 py-0.5 font-mono text-[11px]">null</code> and{' '}
            <code className="rounded bg-white/6 px-1 py-0.5 font-mono text-[11px]">-</code> became true blanks so
            they are excluded from averages instead of skewing them.
          </Bullet>
          <Bullet title="Flagged outliers">
            {m.outliersCount.toLocaleString()}{' '}
            rows sit more than 2.5 standard deviations from a numeric
            column&apos;s mean. They are kept, marked, and shown in red in Explore — never silently deleted.
          </Bullet>
        </ul>
      </section>

      {/* Column detail */}
      <section className="card mb-8 overflow-hidden">
        <div className="border-b border-white/7 px-5 py-3">
          <span className="label">Per column</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-[10px] font-black uppercase tracking-[0.15em] text-white/35">
                <th className="px-4 py-2.5">Column</th>
                <th className="px-4 py-2.5">Role</th>
                <th className="px-4 py-2.5">Type</th>
                <th className="px-4 py-2.5 text-right">Distinct</th>
                <th className="px-4 py-2.5 text-right">Blank</th>
                <th className="px-4 py-2.5 text-right">Redacted</th>
              </tr>
            </thead>
            <tbody>
              {columns.map((col) => {
                const p = profile[col] || {};
                const stat = m.columnStats?.[col] || {};
                const nullPct = dataset.rowCount ? ((p.nullCount || 0) / dataset.rowCount) * 100 : 0;
                return (
                  <tr key={col} className="border-t border-white/5">
                    <td className="max-w-[220px] truncate px-4 py-2.5 font-bold text-white/75" title={col}>
                      {col}
                    </td>
                    <td className="px-4 py-2.5 capitalize text-accent-300/70">{p.role || '—'}</td>
                    <td className="px-4 py-2.5 text-white/45">
                      {p.role === 'time' && p.type === 'string' ? 'date' : p.type || '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-white/55">
                      {(p.distinctCount || 0).toLocaleString()}
                      {p.distinctCapped ? '+' : ''}
                    </td>
                    <td className={`px-4 py-2.5 text-right font-mono ${nullPct > 10 ? 'text-amber-400' : 'text-white/45'}`}>
                      {nullPct > 0 ? `${nullPct.toFixed(1)}%` : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-white/45">
                      {stat.piiCount ? stat.piiCount.toLocaleString() : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Query audit */}
      {analysis?.storyboard?.length > 0 && (
        <section>
          <div className="mb-3 flex items-center gap-3">
            <Code2 size={14} className="text-accent-400" />
            <h2 className="text-xs font-black uppercase tracking-[0.28em] text-white/45">Query audit</h2>
            <div className="h-px flex-1 bg-gradient-to-r from-white/10 to-transparent" />
          </div>
          <p className="mb-4 max-w-2xl text-[12px] leading-relaxed text-white/35">
            Every chart on the dashboard is backed by one of these queries, run against your cleaned rows in
            the browser. Nothing on screen is generated without a query behind it.
          </p>

          <div className="flex flex-col gap-2">
            {analysis.storyboard.map((slide, i) => (
              <details key={slide.id || i} className="card group p-4">
                <summary className="flex cursor-pointer list-none items-center gap-3">
                  <span className="shrink-0 rounded-md bg-white/6 px-2 py-1 font-mono text-[10px] text-white/40">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-bold text-white/75">{slide.pageTitle}</span>
                  {slide.chart?.healed && (
                    <span className="shrink-0 rounded-full border border-amber-500/25 bg-amber-500/8 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-amber-300">
                      Fallback
                    </span>
                  )}
                  <span className="shrink-0 text-[10px] text-white/25">{slide.chart?.resultData?.length || 0} rows</span>
                  <ChevronRight size={14} className="shrink-0 text-white/25 transition-transform group-open:rotate-90" />
                </summary>
                <pre className="mt-3 overflow-x-auto rounded-lg code-surface border border-white/10 p-3 font-mono text-[11px] leading-relaxed">
                  {slide.chart?.sql || 'No query recorded.'}
                </pre>
                {slide.chart?.sqlError && (
                  <p className="mt-2 text-[11px] text-rose-300/70">Engine error: {slide.chart.sqlError}</p>
                )}
              </details>
            ))}
          </div>
        </section>
      )}
    </PageFrame>
  );
}

function Metric({ icon: Icon, label, value, tone }) {
  const colors = {
    emerald: 'text-emerald-400',
    accent: 'text-accent-400',
    amber: 'text-amber-400',
    rose: 'text-rose-400',
  };
  return (
    <div className="card p-4">
      <Icon size={14} className={colors[tone] || 'text-white/30'} />
      <div className="mt-2.5 text-xl font-black tracking-tight text-white">{(value || 0).toLocaleString()}</div>
      <div className="mt-0.5 text-[9px] font-black uppercase tracking-[0.18em] text-white/30">{label}</div>
    </div>
  );
}

function Bullet({ title, children }) {
  return (
    <li className="rounded-xl border border-white/6 bg-white/[0.02] p-4">
      <div className="text-sm font-bold text-white/80">{title}</div>
      <p className="mt-1.5 text-[12px] leading-relaxed text-white/40">{children}</p>
    </li>
  );
}
