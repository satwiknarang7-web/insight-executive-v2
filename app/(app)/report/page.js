'use client';

import { useCallback, useState } from 'react';
import { Printer, FileDown, FileText, Presentation, Loader2, Sparkles, Target, AlertTriangle, TrendingUp, ShieldCheck, Info } from 'lucide-react';
import { useAnalysis, useDataset } from '../../../lib/store/DatasetProvider';
import { findingsOnly } from '../../../lib/storyboard';
import PageFrame from '../../../components/shell/PageFrame';
import LazyChart from '../../../components/charts/LazyChart';
import ChartBoundary from '../../../components/charts/ChartBoundary';
import NarrationNote from '../../../components/panels/NarrationNote';
import { cleanFloatingPoints } from '../../../lib/dataCleaner';

/**
 * The three server-built exports, as data rather than as three functions.
 *
 * They differ only in the route, what goes in the body, the extension and one
 * sentence of failure copy — and written out longhand the copies had already
 * started to drift: only the PDF read the rate limiter's own message out of a
 * 429, so a deck refused for going too fast was reported as a deck that could
 * not be built, which is a different problem with a different fix.
 *
 * `advice` is the PDF's alone, because browser printing is the thing that still
 * works when the host has no Chrome. There is no equivalent sentence for the
 * other two: if those fail, they have simply failed.
 */
const EXPORTS = {
  pdf: {
    route: '/api/export/pdf',
    suffix: '_report.pdf',
    failure: 'The server could not render a PDF.',
    advice: 'Use \u201cPrint\u201d instead \u2014 your browser can save the page as a PDF.',
    payload: (analysis) => analysis,
  },
  pptx: {
    route: '/api/export/pptx',
    suffix: '_deck.pptx',
    failure: 'The deck could not be built.',
    payload: (analysis, dataset) => ({ ...analysis, fileName: dataset?.fileName || null }),
  },
  docx: {
    route: '/api/export/docx',
    suffix: '_report.docx',
    failure: 'The document could not be built.',
    // The row count travels with it because the Word cover states what the
    // figures are figures OF, and the renderer has no dataset to ask.
    payload: (analysis, dataset) => ({
      ...analysis,
      fileName: dataset?.fileName || null,
      rowCount: dataset?.rowCount ?? null,
    }),
  },
};

const baseName = (fileName) => String(fileName || 'insight').replace(/\.(csv|tsv|txt|xlsx?|xlsm)$/i, '');

export default function ReportPage() {
  const { dataset } = useDataset();
  const { analysis } = useAnalysis();
  // Which export is running, rather than a flag each: only one can be, and the
  // buttons should not all spin because one of them was pressed.
  const [busy, setBusy] = useState(null);
  const [exportError, setExportError] = useState(null);

  /**
   * Ask the server for one of the formats above and save what comes back.
   *
   * The PDF is the only one that needs a browser on the host, so it is the only
   * one that can fail for a reason the reader can do something about — hence
   * the extra sentence pointing at Print, which renders here and always works.
   */
  const download = useCallback(
    async (format) => {
      const spec = EXPORTS[format];
      setBusy(format);
      setExportError(null);
      try {
        const res = await fetch(spec.route, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(spec.payload(analysis, dataset)),
        });
        if (!res.ok) {
          const info = await res.json().catch(() => null);
          // The rate limiter answers with a sentence that already names the
          // wait, and throwing a fixed string discarded it — so someone who was
          // thirty seconds from succeeding was told the host had no Chrome. A
          // refusal is also not a reason to reach for Print, so it is reported
          // on its own.
          if (res.status === 429 && info?.error) {
            setExportError(info.error);
            return;
          }
          throw new Error(info?.error || spec.failure);
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${baseName(dataset?.fileName)}${spec.suffix}`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } catch (e) {
        setExportError(spec.advice ? `${e.message} ${spec.advice}` : e.message);
      } finally {
        setBusy(null);
      }
    },
    [analysis, dataset]
  );

  if (!analysis?.storyboard?.length) {
    return (
      <PageFrame title="Report">
        <p className="text-sm text-white/40">Run the analysis first — there is nothing to report on yet.</p>
      </PageFrame>
    );
  }

  const { slideZero } = analysis;
  // A report is read in sequence, so the filter tiles are not part of it — see
  // `findingsOnly`. They belong to the board, which is a different thing.
  const storyboard = findingsOnly(analysis.storyboard);
  const generated = new Date(analysis.generatedAt || Date.now());

  return (
    <PageFrame
      title="Report"
      subtitle={`${storyboard.length} findings · ${dataset.rowCount.toLocaleString()} rows`}
      action={
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <button
            onClick={() => window.print()}
            title="Renders in this browser. Nothing is sent anywhere."
            className="flex items-center gap-2 rounded-lg bg-accent-500 min-h-11 px-4 py-2 text-[10px] font-black uppercase tracking-[0.2em] sm:min-h-0 text-on-accent transition-colors hover:bg-accent-400"
          >
            <Printer size={13} /> Print / Save PDF
          </button>
          <ExportButton
            format="pdf"
            busy={busy}
            onClick={download}
            icon={FileDown}
            title="Sends this report — the computed chart results and the wording, not your raw rows — to the host to be rendered. Print keeps everything in the browser."
          >
            Server PDF
          </ExportButton>
          <ExportButton
            format="docx"
            busy={busy}
            onClick={download}
            icon={FileText}
            title="A Word document you can edit: headings Word can navigate, the numbers as real tables you can copy, and the query behind each figure."
          >
            Word
          </ExportButton>
          <ExportButton
            format="pptx"
            busy={busy}
            onClick={download}
            icon={Presentation}
            title="A PowerPoint deck: one finding per slide, with a real PowerPoint chart you can edit, its evidence tier, and the query behind it."
          >
            PowerPoint
          </ExportButton>
        </div>
      }
    >
      {exportError && (
        <div className="mb-5 rounded-xl border border-amber-500/25 bg-amber-500/8 px-4 py-3 text-[13px] text-amber-200/80 print:hidden">
          {exportError}
        </div>
      )}

      <article className="mx-auto max-w-4xl">
        {/* Cover */}
        <header className="mb-10 border-b border-white/10 pb-8">
          <div className="label">Analysis report</div>
          <h1 className="mt-2 text-4xl font-black tracking-tight">{slideZero.title}</h1>
          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-[12px] text-white/40">
            <span>Source: {dataset.fileName}</span>
            <span>
              {(analysis.filter ? analysis.filter.rowCount : dataset.rowCount).toLocaleString()} rows analysed
            </span>
            <span>{storyboard.length} findings</span>
            <span>{generated.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}</span>
          </div>
          {/* A report of a slice says so on its cover. Everything below was
              computed over these rows, and a reader who is handed the file
              tomorrow has no other way to find that out. */}
          {analysis.filter?.description && (
            <p className="mt-3 rounded-xl border border-amber-500/25 bg-amber-500/[0.06] px-3 py-2 text-[12px] leading-relaxed text-amber-200/80">
              Filtered: {analysis.filter.description} — {analysis.filter.rowCount.toLocaleString()} of{' '}
              {dataset.rowCount.toLocaleString()} rows.
            </p>
          )}
        </header>

        {/* Summary */}
        <section className="mb-10">
          <SectionTitle icon={Sparkles}>Executive summary</SectionTitle>
          <ul className="mt-4 flex flex-col gap-3">
            {slideZero.macroInsights.map((line, i) => (
              <li key={i} className="flex gap-3">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-500" />
                <p className="text-[15px] leading-relaxed text-white/75">{cleanFloatingPoints(line)}</p>
              </li>
            ))}
          </ul>

          {/* The sentences that stop a truncated share being read as a market
              share. This is the copy that gets forwarded, so it is the copy
              that most needs them. */}
          {slideZero.caveats?.length > 0 && (
            <ul className="mt-5 flex flex-col gap-1.5 border-t border-white/8 pt-4">
              {slideZero.caveats.map((line, i) => (
                <li key={i} className="flex gap-2 text-[12px] leading-relaxed text-white/45">
                  <Info size={12} className="mt-0.5 shrink-0 text-amber-400/70" />
                  {line}
                </li>
              ))}
            </ul>
          )}

          <div className="mt-6 grid gap-3 md:grid-cols-3">
            <Card icon={Target} label="Focus" text={slideZero.strategicScorecard.focus} />
            <Card icon={AlertTriangle} label="Risk" text={slideZero.strategicScorecard.risk} />
            <Card icon={TrendingUp} label="Opportunity" text={slideZero.strategicScorecard.opportunity} />
          </div>
        </section>

        {/* Findings */}
        {storyboard.map((slide, i) => (
          <section key={slide.id || i} className="mb-10 break-inside-avoid border-t border-white/8 pt-8">
            <div className="label">Finding {i + 1}</div>
            <h2 className="display mt-1.5 text-[27px] leading-snug">{slide.pageTitle}</h2>

            <div className="mt-5 h-72 w-full rounded-2xl border border-white/7 bg-white/[0.02] p-3">
              <ChartBoundary resetKey={slide.id}>
                <LazyChart
                  data={slide.chart?.resultData}
                  type={slide.chart?.chart_type}
                  xKey={slide.chart?.xAxisKey}
                  yKey={slide.chart?.yAxisKey}
                  secondaryYKey={slide.chart?.secondaryYAxisKey}
                  seriesKey={slide.chart?.seriesKey}
                  seriesSort={slide.chart?.seriesSort}
                  colors={slide.chart?.colors}
                  labels={slide.chart?.labels}
                  colorBy={slide.chart?.colorBy}
                  xLabel={slide.chart?.xAxisLabel}
                  yLabel={slide.chart?.yAxisLabel}
                  eager
                />
              </ChartBoundary>
            </div>

            <div className="mt-5 flex flex-col gap-3">
              {slide.insight_anchor && (
                <p className="text-[15px] font-medium leading-relaxed text-white/85">
                  {cleanFloatingPoints(slide.insight_anchor)}
                </p>
              )}
              {slide.insight_implication && (
                <p className="text-[14px] leading-relaxed text-white/55">{cleanFloatingPoints(slide.insight_implication)}</p>
              )}
              {slide.insight_question && (
                <p className="rounded-xl border-l-2 border-accent-500 bg-white/[0.02] px-4 py-3 text-[14px] italic leading-relaxed text-white/60">
                  {cleanFloatingPoints(slide.insight_question)}
                </p>
              )}
            </div>

            {slide.findings?.verifiedFacts?.length > 0 && (
              <div className="mt-4">
                <div className="mb-2 flex items-center gap-2">
                  <ShieldCheck size={12} className="text-emerald-400" />
                  <span className="label !text-emerald-400/70">Verified metrics</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {slide.findings.verifiedFacts.map((f, k) => (
                    <span key={k} className="rounded-lg bg-white/[0.04] px-2.5 py-1 font-mono text-[10px] text-white/50">
                      {f}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </section>
        ))}

        <footer className="flex flex-col gap-2 border-t border-white/8 pt-6 text-[11px] leading-relaxed text-white/30">
          <p>
            Every figure in this report was computed from SQL queries run over the cleaned dataset in the
            browser.
          </p>
          <NarrationNote narrated={analysis.narrated} />
        </footer>
      </article>
    </PageFrame>
  );
}

/**
 * One of the three download buttons.
 *
 * Only the pressed one spins: `busy` holds the format being fetched rather than
 * a boolean, so a slow PDF does not make the Word button look like it is
 * working too. The others are disabled while it runs, because two exports at
 * once is two requests against the same rate limit for one document.
 */
function ExportButton({ format, busy, onClick, icon: Icon, title, children }) {
  const running = busy === format;
  return (
    <button
      onClick={() => onClick(format)}
      disabled={busy !== null}
      title={title}
      className="flex items-center gap-2 rounded-lg border border-white/10 min-h-11 px-3 py-2 text-[10px] font-black uppercase tracking-[0.2em] sm:min-h-0 text-white/45 transition-colors enabled:hover:bg-white/5 enabled:hover:text-white disabled:opacity-40"
    >
      {running ? <Loader2 size={13} className="animate-spin" /> : <Icon size={13} />} {children}
    </button>
  );
}

function SectionTitle({ icon: Icon, children }) {
  return (
    <div className="flex items-center gap-3">
      <Icon size={14} className="text-accent-400" />
      <h2 className="label">{children}</h2>
      <div className="h-px flex-1 bg-gradient-to-r from-white/10 to-transparent" />
    </div>
  );
}

function Card({ icon: Icon, label, text }) {
  // Empty means the engine found nothing to say under this heading. Printing a
  // dash under "Risk" in a report reads as an unanswered question.
  if (!String(text || '').trim()) return null;

  return (
    <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-4">
      <div className="flex items-center gap-2 text-accent-400">
        <Icon size={13} />
        <span className="text-[9px] font-black uppercase tracking-[0.25em]">{label}</span>
      </div>
      <p className="mt-2 text-[13px] leading-relaxed text-white/70">{cleanFloatingPoints(text) || '—'}</p>
    </div>
  );
}
