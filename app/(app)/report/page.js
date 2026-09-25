'use client';

/**
 * The dashboard as a report: printable here, or downloaded as PDF, Word or
 * PowerPoint. Every format is built from the same dashboard — the charts as
 * drawn, the same sentences — so the file says what the screen said.
 */

import { useCallback, useState } from 'react';
import { FileDown, FileText, Loader2, Presentation, Printer } from 'lucide-react';
import PageFrame from '../../../components/shell/PageFrame';
import { useDataset } from '../../../lib/store/DatasetProvider';
import { useDashboard } from '../../../lib/store/DashboardProvider';
import { ChartPalette } from '../../../components/charts/palette';
import DashboardDocument from '../../../components/dashboard/DashboardDocument';
import { dashboardToDeck } from '../../../lib/engine/deck';

const baseName = (fileName) => String(fileName || 'insight').replace(/\.(csv|tsv|txt|xlsx?|xlsm|json|parquet)$/i, '');

export default function ReportPage() {
  const { dataset } = useDataset();
  const { board, engine, snapshotWithData } = useDashboard();
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const measures = engine?.measures || board?.measures || [];
  const fields = engine?.ds?.fields || board?.ds?.fields || [];

  const download = useCallback(
    async (format) => {
      setBusy(format);
      setError(null);
      try {
        const deck = dashboardToDeck(board, { measures, fields, fileName: dataset?.fileName, rowCount: dataset?.rowCount });
        const spec = {
          pdf: { route: '/api/export/pdf', body: { version: 2, dashboard: snapshotWithData(), fileName: dataset?.fileName, rowCount: dataset?.rowCount }, suffix: '_report.pdf' },
          docx: { route: '/api/export/docx', body: deck, suffix: '_report.docx' },
          pptx: { route: '/api/export/pptx', body: deck, suffix: '_deck.pptx' },
        }[format];
        const res = await fetch(spec.route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(spec.body) });
        if (!res.ok) {
          const info = await res.json().catch(() => null);
          throw new Error(info?.error || `The ${format.toUpperCase()} could not be built.${format === 'pdf' ? ' Use Print instead — your browser can save the page as a PDF.' : ''}`);
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
        setError(e.message);
      } finally {
        setBusy(null);
      }
    },
    [board, measures, fields, dataset, snapshotWithData]
  );

  if (!board) {
    return (
      <PageFrame title="Report">
        <p className="text-sm text-white/40">Load a dataset first — the report is the dashboard, written out.</p>
      </PageFrame>
    );
  }

  const button = 'flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-[12px] font-bold text-white/65 hover:bg-white/5 hover:text-white disabled:opacity-40';
  return (
    <ChartPalette>
      <PageFrame
        title="Report"
        subtitle="The dashboard, written out to read, print or send."
        action={
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            <button onClick={() => window.print()} className="flex items-center gap-2 rounded-lg bg-accent-500 px-3 py-2 text-[12px] font-bold text-on-accent hover:bg-accent-400">
              <Printer size={14} /> Print
            </button>
            {[
              { f: 'pdf', label: 'PDF', icon: FileDown },
              { f: 'docx', label: 'Word', icon: FileText },
              { f: 'pptx', label: 'PowerPoint', icon: Presentation },
            ].map(({ f, label, icon: Icon }) => (
              <button key={f} onClick={() => download(f)} disabled={!!busy} className={button}>
                {busy === f ? <Loader2 size={14} className="animate-spin" /> : <Icon size={14} />} {label}
              </button>
            ))}
          </div>
        }
      >
        {error && <p className="mb-4 rounded-lg border border-rose-500/25 bg-rose-500/5 p-3 text-[13px] text-rose-300 print:hidden">{error}</p>}
        <div className="mx-auto max-w-4xl">
          <DashboardDocument board={board} measures={measures} fields={fields} fileName={dataset?.fileName} rowCount={dataset?.rowCount} />
        </div>
      </PageFrame>
    </ChartPalette>
  );
}
