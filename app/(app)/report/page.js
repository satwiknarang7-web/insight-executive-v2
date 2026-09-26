'use client';

/**
 * The dashboard as a report: printable here, or downloaded as PDF, Word or
 * PowerPoint. Every format is built from the same dashboard — the charts as
 * drawn, the same sentences — so the file says what the screen said.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { FileDown, FileText, Film, Loader2, Presentation, Printer } from 'lucide-react';
import PageFrame from '../../../components/shell/PageFrame';
import { useDataset } from '../../../lib/store/DatasetProvider';
import { useDashboard } from '../../../lib/store/DashboardProvider';
import { ChartPalette } from '../../../components/charts/palette';
import DashboardDocument from '../../../components/dashboard/DashboardDocument';
import { dashboardToDeck } from '../../../lib/engine/deck';
import { filteredReportBoard } from '../../../lib/engine/reportScope';
import { call } from '../../../lib/store/engineClient';

const baseName = (fileName) => String(fileName || 'insight').replace(/\.(csv|tsv|txt|xlsx?|xlsm|json|parquet)$/i, '');

export default function ReportPage() {
  const { dataset } = useDataset();
  const { board, engine, filters, settings, snapshotWithData } = useDashboard();
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const measures = useMemo(() => engine?.measures || board?.measures || [], [engine, board]);
  const fields = useMemo(() => engine?.ds?.fields || board?.ds?.fields || [], [engine, board]);
  // With filters on, the report can show the filtered view (what the
  // dashboard shows now) or all the rows.
  const filtered = (filters || []).length > 0;
  const [scope, setScope] = useState('filtered');
  const [unfiltered, setUnfiltered] = useState(null);
  useEffect(() => {
    if (!board || !filtered || scope !== 'all') return undefined;
    let live = true;
    const tiles = (board.sections || []).flatMap((s) => s.tiles).map(({ computed, error, ...t }) => ({ ...t, recaption: true }));
    Promise.all([call('computeTiles', { tiles, filters: [], ...settings }), call('computeKpis', { kpis: board.kpis || [], filters: [], ...settings })])
      .then(([t, k]) => {
        if (!live) return;
        const byId = new Map(t.tiles.map((x) => [x.id, x]));
        setUnfiltered({ ...board, kpis: k.kpis, sections: board.sections.map((s) => ({ ...s, tiles: s.tiles.map((x) => byId.get(x.id) || x) })) });
      })
      .catch((e) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [board, filtered, scope, settings]);
  const doc = useMemo(() => {
    if (!filtered) return board;
    if (scope === 'all') return unfiltered;
    return filteredReportBoard(board, filters, fields);
  }, [board, filtered, scope, unfiltered, filters, fields]);

  const download = useCallback(
    async (format) => {
      setBusy(format);
      setError(null);
      try {
        const deck = dashboardToDeck(doc, { measures, fields, fileName: dataset?.fileName, rowCount: dataset?.rowCount });
        const spec = {
          pdf: { route: '/api/export/pdf', body: { version: 2, dashboard: { ...snapshotWithData(), ...doc, filters: scope === 'all' ? [] : filters }, fileName: dataset?.fileName, rowCount: dataset?.rowCount }, suffix: '_report.pdf' },
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
    [doc, measures, fields, dataset, snapshotWithData, scope, filters]
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
              <button key={f} onClick={() => download(f)} disabled={!!busy || !doc} className={button}>
                {busy === f ? <Loader2 size={14} className="animate-spin" /> : <Icon size={14} />} {label}
              </button>
            ))}
            {/* Made from the slideshow, where the slides and the voice live. */}
            <Link href="/present?video=1" className={button}>
              <Film size={14} /> Video
            </Link>
          </div>
        }
      >
        {error && <p className="anim-pop mb-4 rounded-lg border border-rose-500/25 bg-rose-500/5 p-3 text-[13px] text-rose-300 print:hidden">{error}</p>}
        {filtered && (
          <div className="mx-auto mb-5 flex max-w-4xl flex-wrap items-center gap-3 print:hidden" role="radiogroup" aria-label="What the report covers">
            <span className="text-[12.5px] text-white/55">The dashboard has filters on. Report on:</span>
            <div className="flex rounded-lg border border-white/10 p-0.5">
              {[
                ['filtered', 'The filtered view'],
                ['all', 'All the data'],
              ].map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={scope === id}
                  onClick={() => setScope(id)}
                  className={`rounded-md px-3 py-1.5 text-[12px] font-semibold transition-colors ${scope === id ? 'bg-accent-500 text-on-accent' : 'text-white/60 hover:text-white'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="mx-auto max-w-4xl">
          {!doc ? <div className="ld-skeleton h-64 rounded-2xl" /> : <DashboardDocument board={doc} measures={measures} fields={fields} fileName={dataset?.fileName} rowCount={dataset?.rowCount} />}
        </div>
      </PageFrame>
    </ChartPalette>
  );
}
