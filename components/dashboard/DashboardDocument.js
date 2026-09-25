'use client';

/**
 * The dashboard as a document: a cover with the contents, the executive
 * summary, the headline numbers, then numbered chapters with numbered
 * figures. Read top to bottom and printable. Used by the Report page, the PDF
 * print page and saved analyses opened from the library — anywhere the
 * dashboard is read rather than worked on.
 */

import TileChart from './TileChart';
import KpiStrip from './KpiStrip';

export default function DashboardDocument({ board, measures = [], fields = [], fileName = '', rowCount = null, printing = false }) {
  if (!board) return null;
  const bullets = board.aiSummary?.length ? board.aiSummary : (board.findings || []).map((f) => f.text);
  const sections = (board.sections || []).filter((s) => s.tiles?.length);
  const date = new Date(board.generatedAt || Date.now()).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  let figure = 0;
  return (
    <article className={`space-y-8 ${printing ? 'text-[13px]' : ''}`} data-testid="dashboard-document">
      {/* Cover */}
      <header className="card relative overflow-hidden p-0 break-inside-avoid">
        <div aria-hidden="true" className="h-1.5 bg-gradient-to-r from-accent-400 via-[var(--accent-2)] to-transparent" />
        <div className="relative p-7 md:p-9">
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(50%_80%_at_100%_0%,var(--wash-a),transparent_70%)]" />
          <div className="relative">
            <p className="label">
              Analysis report · {date}
            </p>
            <h1 className="display mt-3 text-[30px] leading-[1.1] text-white/95 md:text-[38px]">{board.subject || board.headline || 'What the data says'}</h1>
            {board.summary && <p className="mt-3 max-w-2xl text-[14px] leading-relaxed text-white/55">{board.summary}</p>}
            <div className="mt-6 flex flex-wrap gap-x-8 gap-y-3 border-t border-white/8 pt-5 text-[12.5px]">
              <div>
                <div className="label">Source</div>
                <div className="mt-1 font-medium text-white/80">{fileName || 'Uploaded data'}</div>
              </div>
              {rowCount ? (
                <div>
                  <div className="label">Rows</div>
                  <div className="figure mt-1 font-medium text-white/80">{Number(rowCount).toLocaleString()}</div>
                </div>
              ) : null}
              <div>
                <div className="label">Figures</div>
                <div className="figure mt-1 font-medium text-white/80">{sections.reduce((n, s) => n + s.tiles.length, 0)}</div>
              </div>
            </div>
            {sections.length > 1 && (
              <nav className="mt-6" aria-label="Contents">
                <div className="label mb-2">Contents</div>
                <ol className="grid gap-x-8 gap-y-1.5 sm:grid-cols-2">
                  {sections.map((s, i) => (
                    <li key={s.id} className="flex items-baseline gap-3 text-[13px] text-white/70">
                      <span className="font-mono text-[11.5px] text-accent-400">{String(i + 1).padStart(2, '0')}</span>
                      <span>{s.title || 'The main picture'}</span>
                    </li>
                  ))}
                </ol>
              </nav>
            )}
          </div>
        </div>
      </header>

      {(board.headline || bullets.length > 0) && (
        <section className="card p-6 md:p-7 break-inside-avoid">
          <h2 className="label mb-3">Executive summary</h2>
          {board.headline && board.subject && <p className="display mb-4 text-[19px] leading-snug text-white/90">{board.headline}</p>}
          <ol className="space-y-2.5">
            {bullets.slice(0, 5).map((b, i) => (
              <li key={i} className="flex gap-3 text-[14px] leading-relaxed text-white/80">
                <span className="figure mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-accent-400/12 text-[11px] font-semibold text-accent-300">{i + 1}</span>
                <span>{b}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {(board.kpis || []).length > 0 && (
        <section className="break-inside-avoid">
          <h2 className="label mb-3">Headline numbers</h2>
          <KpiStrip kpis={board.kpis} />
        </section>
      )}

      {sections.map((s, si) => (
        <section key={s.id} className="flex flex-col gap-4">
          <div className="flex items-center gap-4 pt-2 break-after-avoid">
            <span className="figure text-[28px] font-semibold text-accent-400/80">{String(si + 1).padStart(2, '0')}</span>
            <h2 className="text-[18px] font-semibold text-white/90">{s.title || 'The main picture'}</h2>
            <span className="h-px flex-1 bg-gradient-to-r from-white/15 to-transparent" />
          </div>
          {s.tiles.map((t) => {
            figure += 1;
            return (
              <figure key={t.id} className="card m-0 break-inside-avoid p-5 md:p-6">
                <figcaption className="mb-4 flex items-baseline gap-3">
                  <span className="shrink-0 font-mono text-[11px] uppercase tracking-[0.08em] text-white/40">Fig. {figure}</span>
                  <span className="text-[15px] font-semibold text-white/90">{t.title}</span>
                </figcaption>
                <TileChart tile={t} measures={measures} fields={fields} height={printing ? 260 : 300} />
                {t.insight && <p className="mt-4 border-l-2 border-accent-400/60 pl-3 text-[13.5px] leading-relaxed text-white/75">{t.insight}</p>}
              </figure>
            );
          })}
        </section>
      ))}

      <footer className="border-t border-white/8 pt-4 text-[12px] text-white/40">
        Generated {date} by Insight Executive. Every figure is computed from the uploaded rows.
      </footer>
    </article>
  );
}
