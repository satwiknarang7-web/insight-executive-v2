'use client';

/**
 * The dashboard in words: the headline, the key findings, the headline
 * numbers, and what each chart says — for someone who wants the answer
 * without the charts.
 */

import Link from 'next/link';
import { LayoutDashboard } from 'lucide-react';
import PageFrame from '../../../components/shell/PageFrame';
import { useDataset } from '../../../lib/store/DatasetProvider';
import { useDashboard } from '../../../lib/store/DashboardProvider';

export default function SummaryPage() {
  const { dataset } = useDataset();
  const { board } = useDashboard();

  if (!board) {
    return (
      <PageFrame title="Summary">
        <p className="text-sm text-white/40">{dataset ? 'The dashboard is still being built.' : 'Load a dataset and its summary appears here.'}</p>
      </PageFrame>
    );
  }
  const bullets = board.aiSummary?.length ? board.aiSummary : (board.findings || []).map((f) => f.text);
  return (
    <PageFrame
      title="Summary"
      subtitle={board.subject || board.summary}
      action={
        <Link href="/dashboard" className="flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-[12px] font-bold text-white/65 hover:bg-white/5 hover:text-white">
          <LayoutDashboard size={14} /> Dashboard
        </Link>
      }
    >
      <div className="mx-auto max-w-3xl space-y-8" data-testid="summary">
        {board.headline && <p className="display text-[24px] leading-snug text-white/90">{board.headline}</p>}
        {bullets.length > 0 && (
          <section>
            <h2 className="mb-3 text-[11px] font-bold uppercase tracking-[0.14em] text-white/45">Key findings</h2>
            <ol className="space-y-3">
              {bullets.map((b, i) => (
                <li key={i} className="flex gap-3 text-[15px] leading-relaxed text-white/80">
                  <span className="mt-0.5 font-mono text-[13px] text-accent-400">{i + 1}.</span>
                  <span>{b}</span>
                </li>
              ))}
            </ol>
          </section>
        )}
        {board.kpis?.length > 0 && (
          <section>
            <h2 className="mb-3 text-[11px] font-bold uppercase tracking-[0.14em] text-white/45">Headline numbers</h2>
            <dl className="grid grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-2">
              {board.kpis.map((k) => (
                <div key={k.id} className="flex items-baseline justify-between gap-3 border-b border-white/6 py-2">
                  <dt className="text-[13px] text-white/60">{k.title}</dt>
                  <dd className="text-right font-mono text-[14px] text-white/90">
                    {k.formatted}
                    {k.delta && <span className="ml-2 text-[12px] text-white/45">{k.delta.text} {k.delta.vs}</span>}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        )}
        {board.sections.map((s) => (
          <section key={s.id}>
            <h2 className="mb-3 text-[11px] font-bold uppercase tracking-[0.14em] text-white/45">{s.title || 'The main picture'}</h2>
            <ul className="space-y-4">
              {s.tiles
                .filter((t) => t.insight)
                .map((t) => (
                  <li key={t.id}>
                    <h3 className="text-[14px] font-semibold text-white/85">{t.title}</h3>
                    <p className="mt-1 text-[14px] leading-relaxed text-white/70">{t.insight}</p>
                  </li>
                ))}
            </ul>
          </section>
        ))}
      </div>
    </PageFrame>
  );
}
