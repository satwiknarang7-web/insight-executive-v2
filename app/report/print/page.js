'use client';

/**
 * The page the PDF export prints (lib/report/pdf.server.js): the dashboard as
 * a document, in the light theme, from `window.PRINT_DATA` (set by the
 * renderer) or the copy the Report page left in localStorage.
 *
 * `.print-container-rendered` is the sentinel the renderer waits for — set
 * only once there is a dashboard on the page, so a PDF of a sign-in screen or
 * an empty page is refused rather than produced.
 */

import { useEffect, useState } from 'react';
import { ChartPalette } from '../../../components/charts/palette';
import DashboardDocument from '../../../components/dashboard/DashboardDocument';

export default function PrintReport() {
  const [data, setData] = useState(null);

  useEffect(() => {
    const root = document.documentElement;
    const previous = root.getAttribute('data-theme');
    root.setAttribute('data-theme', 'light');
    return () => {
      if (previous) root.setAttribute('data-theme', previous);
      else root.removeAttribute('data-theme');
    };
  }, []);

  useEffect(() => {
    let found = typeof window !== 'undefined' ? window.PRINT_DATA : null;
    if (!found) {
      try {
        found = JSON.parse(localStorage.getItem('reportData') || 'null');
      } catch {
        found = null;
      }
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read once from the page the renderer prepared
    if (found) setData(found);
  }, []);

  const board = data?.version === 2 ? data.dashboard : null;
  if (!board) {
    return <div className="p-20 text-center font-mono text-[12px] uppercase tracking-[0.3em] text-white/30">{data ? 'This report was saved by an older version; open it and rebuild to print.' : 'Preparing the report…'}</div>;
  }

  return (
    <ChartPalette>
      <div className="print-container-rendered mx-auto max-w-[760px] bg-canvas px-8 py-10">
        <DashboardDocument board={board} measures={board.measures || []} fields={board.ds?.fields || []} fileName={data.fileName || board.ds?.name} rowCount={data.rowCount || board.ds?.rowCount} printing />
        <p className="mt-8 text-[10px] text-white/35">Generated {new Date(board.generatedAt || Date.now()).toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' })} · every figure computed from the uploaded rows.</p>
      </div>
    </ChartPalette>
  );
}
