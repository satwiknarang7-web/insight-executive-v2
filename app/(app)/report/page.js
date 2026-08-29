'use client';

import { useCallback, useState } from 'react';
import { Printer, FileDown, Loader2, Sparkles, Target, AlertTriangle, TrendingUp, ShieldCheck } from 'lucide-react';
import { useAnalysis, useDataset } from '../../../lib/store/DatasetProvider';
import PageFrame from '../../../components/shell/PageFrame';
import LazyChart from '../../../components/charts/LazyChart';
import ChartBoundary from '../../../components/charts/ChartBoundary';
import { cleanFloatingPoints } from '../../../lib/dataCleaner';

export default function ReportPage() {
  const { dataset } = useDataset();
  const { analysis } = useAnalysis();
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState(null);

  /**
   * Server-rendered PDF via headless Chrome. It needs a Chrome binary on the
   * host, so if it isn't available we say so and point at browser printing,
   * which always works.
   */
  const downloadPdf = useCallback(async () => {
    setPdfBusy(true);
    setPdfError(null);
    try {
      const res = await fetch('/api/export/pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(analysis),
      });
      if (!res.ok) throw new Error('The server could not render a PDF.');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${dataset.fileName.replace(/\.(csv|tsv|txt|xlsx?|xlsm)$/i, '')}_report.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setPdfError(`${e.message} Use “Print” instead — your browser can save the page as a PDF.`);
    } finally {
      setPdfBusy(false);
    }
  }, [analysis, dataset]);

  if (!analysis?.storyboard?.length) {
    return (
      <PageFrame title="Report">
        <p className="text-sm text-white/40">Run the analysis first — there is nothing to report on yet.</p>
      </PageFrame>
    );
  }

  const { slideZero, storyboard } = analysis;
  const generated = new Date(analysis.generatedAt || Date.now());

  return (
    <PageFrame
      title="Report"
      subtitle={`${storyboard.length} findings · ${dataset.rowCount.toLocaleString()} rows`}
      action={
        <div className="flex items-center gap-2 print:hidden">
          <button
            onClick={() => window.print()}
            className="flex items-center gap-2 rounded-lg bg-accent-500 px-4 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-on-accent transition-colors hover:bg-accent-400"
          >
            <Printer size={13} /> Print / Save PDF
          </button>
          <button
            onClick={downloadPdf}
            disabled={pdfBusy}
            className="flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-white/45 transition-colors enabled:hover:bg-white/5 enabled:hover:text-white disabled:opacity-40"
          >
            {pdfBusy ? <Loader2 size={13} className="animate-spin" /> : <FileDown size={13} />} Server PDF
          </button>
        </div>
      }
    >
      {pdfError && (
        <div className="mb-5 rounded-xl border border-amber-500/25 bg-amber-500/8 px-4 py-3 text-[13px] text-amber-200/80 print:hidden">
          {pdfError}
        </div>
      )}

      <article className="mx-auto max-w-4xl">
        {/* Cover */}
        <header className="mb-10 border-b border-white/10 pb-8">
          <div className="label">Analysis report</div>
          <h1 className="mt-2 text-4xl font-black tracking-tight">{slideZero.title}</h1>
          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-[12px] text-white/40">
            <span>Source: {dataset.fileName}</span>
            <span>{dataset.rowCount.toLocaleString()} rows analysed</span>
            <span>{storyboard.length} findings</span>
            <span>{generated.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}</span>
          </div>
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
            <h2 className="mt-1.5 text-2xl font-black leading-tight tracking-tight">{slide.pageTitle}</h2>

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

        <footer className="border-t border-white/8 pt-6 text-[11px] leading-relaxed text-white/30">
          Every figure in this report was computed from SQL queries run over the cleaned dataset in the
          browser. Where a language model was available it rephrased those computed findings; it never
          produced a number.
        </footer>
      </article>
    </PageFrame>
  );
}

function SectionTitle({ icon: Icon, children }) {
  return (
    <div className="flex items-center gap-3">
      <Icon size={14} className="text-accent-400" />
      <h2 className="text-xs font-black uppercase tracking-[0.28em] text-white/45">{children}</h2>
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
