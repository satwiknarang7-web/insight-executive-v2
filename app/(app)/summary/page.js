'use client';

/**
 * The dashboard as an executive brief: the headline, the numbers, the key
 * findings each beside the chart that shows it, then what every chart says,
 * chapter by chapter — for someone who wants the answer in two minutes.
 */

import Link from 'next/link';
import { ArrowRight, BarChart3, CalendarRange, FileText, Filter, LayoutDashboard, Rows3 } from 'lucide-react';
import PageFrame from '../../../components/shell/PageFrame';
import { useDataset } from '../../../lib/store/DatasetProvider';
import { useDashboard } from '../../../lib/store/DashboardProvider';
import { filteredReportBoard } from '../../../lib/engine/reportScope';
import { ChartPalette } from '../../../components/charts/palette';
import KpiStrip from '../../../components/dashboard/KpiStrip';
import TileChart from '../../../components/dashboard/TileChart';

export default function SummaryPage() {
  const { dataset } = useDataset();
  const { board: live, engine, filters } = useDashboard();

  const fieldList = engine?.ds?.fields || live?.ds?.fields || [];
  // Filters on: the brief is about the filtered rows, like the dashboard.
  const board = filteredReportBoard(live, filters, fieldList);

  if (!board) {
    return (
      <PageFrame title="Summary">
        <p className="text-sm text-white/40">{dataset ? 'The dashboard is still being built.' : 'Load a dataset and its summary appears here.'}</p>
      </PageFrame>
    );
  }
  const measures = engine?.measures || board.measures || [];
  const fields = engine?.ds?.fields || board.ds?.fields || [];
  const tiles = (board.sections || []).flatMap((s) => s.tiles);
  const byId = new Map(tiles.map((t) => [t.id, t]));
  const findings = board.aiSummary?.length ? board.aiSummary.map((text) => ({ text })) : board.findings || [];
  const headline = board.headline || findings[0]?.text || board.summary;
  const facts = [
    board.filterNote ? [Filter, `Filtered to ${board.filterNote}`] : null,
    [Rows3, `${Number(board.ds?.rowCount || dataset?.rowCount || 0).toLocaleString()} rows${board.filterNote ? ' in the file' : ''}`],
    [BarChart3, `${tiles.length} charts`],
    [FileText, `${(board.ds?.fields || []).length} columns`],
    !board.filterNote && /\bfrom\b.+\bto\b/i.test(board.summary || '') ? [CalendarRange, board.summary.replace(/\.\s*$/, '').replace(/^.*?\bfrom\b/i, 'From')] : null,
  ].filter(Boolean);

  return (
    <ChartPalette>
      <PageFrame
        title="Summary"
        subtitle="The dashboard as an executive brief."
        action={
          <div className="flex gap-2">
            <Link href="/report" className="flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-[12px] font-semibold text-white/65 hover:bg-white/5 hover:text-white">
              <FileText size={14} /> Report
            </Link>
            <Link href="/dashboard" className="flex items-center gap-2 rounded-lg bg-accent-500 px-3 py-2 text-[12px] font-semibold text-on-accent hover:bg-accent-400">
              <LayoutDashboard size={14} /> Dashboard
            </Link>
          </div>
        }
      >
        <div className="mx-auto max-w-5xl space-y-6" data-testid="summary">
          {/* The answer first. */}
          <section className="card card-glow ld-rise relative overflow-hidden p-6 md:p-8">
            <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_90%_at_0%_0%,var(--wash-a),transparent_70%)]" />
            <div className="relative">
              <span className="eyebrow">Executive brief · {board.subject || dataset?.fileName || 'your data'}</span>
              <p className="display mt-5 max-w-3xl text-[26px] leading-[1.2] text-white/95 md:text-[32px]">{headline}</p>
              <div className="mt-6 flex flex-wrap gap-2">
                {facts.map(([Icon, text]) => (
                  <span key={text} className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[12px] text-white/65">
                    <Icon size={13} className="text-accent-400" /> {text}
                  </span>
                ))}
              </div>
            </div>
          </section>

          {board.kpis?.length > 0 && (
            <section className="ld-rise" style={{ animationDelay: '80ms' }}>
              <h2 className="label mb-3">Headline numbers</h2>
              <KpiStrip kpis={board.kpis} />
            </section>
          )}

          {findings.length > 0 && (
            <section className="ld-rise" style={{ animationDelay: '160ms' }}>
              <h2 className="label mb-3">Key findings</h2>
              <ol className="grid gap-4 md:grid-cols-2">
                {findings.slice(0, 6).map((f, i) => {
                  const t = f.tileId ? byId.get(f.tileId) : null;
                  return (
                    <li key={i} className="card flex flex-col p-5">
                      <div className="flex gap-3">
                        <span className="figure flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-accent-400/30 bg-accent-400/10 text-[13px] font-semibold text-accent-300">{i + 1}</span>
                        <p className="text-[14.5px] leading-relaxed text-white/85">{f.text}</p>
                      </div>
                      {t && t.viz !== 'table' && t.viz !== 'heatmap' && (
                        <div className="mt-4 border-t border-white/6 pt-3">
                          <div className="mb-1 truncate text-[11px] font-medium text-white/40">{t.title}</div>
                          <TileChart tile={t} measures={measures} fields={fields} height={150} />
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
            </section>
          )}

          <section className="space-y-5">
            {board.sections.map((s, si) => {
              const items = s.tiles.filter((t) => t.insight);
              if (!items.length) return null;
              return (
                <div key={s.id} className="card overflow-hidden p-0">
                  <div className="flex items-center gap-3 border-b border-white/6 px-5 py-3.5">
                    <span className="font-mono text-[12px] text-accent-400">{String(si + 1).padStart(2, '0')}</span>
                    <h2 className="text-[14px] font-semibold text-white/90">{s.title || 'The main picture'}</h2>
                  </div>
                  <ul className="divide-y divide-white/6">
                    {items.map((t) => (
                      <li key={t.id} className="grid gap-4 px-5 py-4 md:grid-cols-[minmax(0,1fr)_320px] md:items-center">
                        <div className="min-w-0">
                          <h3 className="text-[14px] font-semibold text-white/85">{t.title}</h3>
                          <p className="mt-1 text-[13.5px] leading-relaxed text-white/60">{t.insight}</p>
                        </div>
                        {t.viz !== 'table' && t.viz !== 'heatmap' && (
                          <div className="hidden md:block">
                            <TileChart tile={t} measures={measures} fields={fields} height={120} />
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </section>

          <Link href="/report" className="card group flex items-center gap-4 p-5 transition-colors hover:border-accent-400/40">
            <FileText size={18} className="text-accent-400" />
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-semibold text-white/90">Need to send this on?</span>
              <span className="block text-[12.5px] text-white/50">The report has every chart, ready to print or download as PDF, Word or PowerPoint.</span>
            </span>
            <ArrowRight size={16} className="text-white/40 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>
      </PageFrame>
    </ChartPalette>
  );
}
