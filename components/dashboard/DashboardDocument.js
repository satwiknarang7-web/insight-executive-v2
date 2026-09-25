'use client';

/**
 * The dashboard as a document: read top to bottom, printable, one chart per
 * block at full width with its sentence. Used by the Report page, the PDF
 * print page and saved analyses opened from the library — anywhere the
 * dashboard is read rather than worked on.
 */

import TileChart from './TileChart';
import KpiStrip from './KpiStrip';

export default function DashboardDocument({ board, measures = [], fields = [], fileName = '', rowCount = null, printing = false }) {
  if (!board) return null;
  const bullets = board.aiSummary?.length ? board.aiSummary : (board.findings || []).map((f) => f.text);
  const sections = board.sections || [];
  return (
    <article className={`space-y-6 ${printing ? 'text-[13px]' : ''}`} data-testid="dashboard-document">
      <header>
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/45">
          {fileName}
          {rowCount ? ` · ${Number(rowCount).toLocaleString()} rows` : ''}
        </p>
        <h1 className="display mt-1 text-[28px] leading-tight text-white/95">{board.subject || board.headline || 'What the data says'}</h1>
        {board.summary && <p className="mt-1 text-[13px] text-white/50">{board.summary}</p>}
      </header>
      {(board.headline || bullets.length > 0) && (
        <section className="card p-5 break-inside-avoid">
          <h2 className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-white/50">Key findings</h2>
          {board.headline && board.subject && <p className="mb-2 text-[15px] font-semibold text-white/90">{board.headline}</p>}
          <ul className="space-y-1.5">
            {bullets.slice(0, 5).map((b, i) => (
              <li key={i} className="flex gap-2 text-[13px] leading-relaxed text-white/75">
                <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-accent-400" aria-hidden="true" />
                <span>{b}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <KpiStrip kpis={board.kpis || []} />
      {sections.map((s) => (
        <section key={s.id} className="space-y-4">
          {s.title && <h2 className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/45">{s.title}</h2>}
          {s.tiles.map((t) => (
            <div key={t.id} className="card break-inside-avoid p-5">
              <h3 className="mb-3 text-[15px] font-semibold text-white/90">{t.title}</h3>
              <TileChart tile={t} measures={measures} fields={fields} height={printing ? 260 : 300} />
              {t.insight && <p className="mt-3 border-t border-white/6 pt-3 text-[13px] leading-relaxed text-white/75">{t.insight}</p>}
            </div>
          ))}
        </section>
      ))}
    </article>
  );
}
