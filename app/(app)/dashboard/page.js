'use client';

/**
 * The dashboard: what the engine built from the uploaded table
 * (lib/engine/planner.js), and where it is edited.
 *
 * Top to bottom, the way an analyst lays one out: what the data is and the few
 * findings that matter, the filters, the headline numbers, then sections of
 * charts — the trend, what drives the outcome, where the total comes from,
 * how things compare — and a detail table. Each chart says in a sentence what
 * it shows. Edit mode adds a toolbar to every chart, an "Add chart" button and
 * the fields panel; nothing is ever drawn in a way the data cannot support.
 */

import Link from 'next/link';
import { createPortal } from 'react-dom';
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Check, Columns3, Loader2, Pencil, Plus, RefreshCw, UploadCloud } from 'lucide-react';
import PageFrame from '../../../components/shell/PageFrame';
import { useDataset } from '../../../lib/store/DatasetProvider';
import { useDashboard } from '../../../lib/store/DashboardProvider';
import { usePlan } from '../../../lib/store/PlanProvider';
import { keySnapshot, serverKeySnapshot, subscribeToKey } from '../../../lib/geminiKey';
import { ChartPalette } from '../../../components/charts/palette';
import KpiStrip from '../../../components/dashboard/KpiStrip';
import ChartPulse from '../../../components/loading/ChartPulse';
import Tile from '../../../components/dashboard/Tile';
import DashboardFilters from '../../../components/dashboard/DashboardFilters';
import TileEditor, { defaultSpec } from '../../../components/dashboard/TileEditor';
import FieldsPanel from '../../../components/dashboard/FieldsPanel';
import SaveDashboard from '../../../components/dashboard/SaveDashboard';
import { ACTION_ICON, ACTIVE_ACTION, PRIMARY_ACTION, SECONDARY_ACTION } from '../../../components/dashboard/actionStyles';

/**
 * While the dashboard is planned: the shape of what is coming (KPI cards and
 * chart tiles, sheened) beside the steps, so the real thing lands where the
 * reader is already looking instead of replacing a spinner.
 */
function Building({ stage, useModel }) {
  const steps = ['Reading the columns', ...(useModel ? ['Asking the model what this table is'] : []), 'Choosing the charts'];
  const at = Math.max(0, steps.indexOf(stage));
  return (
    <div className="space-y-5" data-testid="building" role="status" aria-live="polite" aria-label={`Building your dashboard: ${stage || steps[0]}`}>
      <div className="card ld-rise flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:p-6">
        <div className="shrink-0 self-start rounded-xl border border-white/6 bg-white/[0.02] p-3 text-white">
          <ChartPulse size={88} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="label mb-1.5">Building your dashboard</div>
          <p className="font-display text-[21px] font-semibold leading-tight text-white/90">{steps[at]}…</p>
          <ol className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
            {steps.map((s, i) => (
              <li key={s} className={`flex items-center gap-1.5 text-[12px] transition-colors duration-300 ${i < at ? 'text-white/50' : i === at ? 'font-semibold text-accent-400' : 'text-white/25'}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${i < at ? 'bg-accent-400/60' : i === at ? 'animate-pulse bg-accent-400' : 'bg-white/15'}`} aria-hidden="true" />
                {s}
              </li>
            ))}
          </ol>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="card ld-rise space-y-3 p-4" style={{ animationDelay: `${80 + i * 60}ms` }}>
            <div className="ld-skeleton h-2.5 w-1/2" />
            <div className="ld-skeleton h-7 w-2/3" />
            <div className="ld-skeleton h-8 w-full" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-12 gap-4" aria-hidden="true">
        {[7, 5, 5, 7].map((span, i) => (
          <div key={i} className={`card ld-rise col-span-12 p-4 ${span === 7 ? 'lg:col-span-7' : 'lg:col-span-5'}`} style={{ animationDelay: `${320 + i * 80}ms` }}>
            <div className="ld-skeleton mb-2 h-3 w-2/5" />
            <div className="ld-skeleton mb-4 h-2.5 w-3/5" />
            <div className="flex h-36 items-end gap-2">
              {[0.5, 0.8, 0.35, 0.65, 0.9, 0.45, 0.7].map((v, k) => (
                <div key={k} className="ld-skeleton flex-1 rounded-b-none" style={{ height: `${v * 100}%` }} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Findings({ board }) {
  const bullets = board.aiSummary?.length ? board.aiSummary : (board.findings || []).map((f) => f.text);
  if (!bullets.length && !board.headline) return null;
  return (
    <section className="card p-5" data-testid="findings" aria-labelledby="key-findings">
      <div className="mb-2 flex items-center gap-2">
        <h2 id="key-findings" className="text-[11px] font-bold uppercase tracking-[0.12em] text-white/50">Key findings</h2>
      </div>
      {board.headline && <p className="mb-2 text-[16px] font-semibold leading-snug text-white/90">{board.headline}</p>}
      <ul className="stagger space-y-1.5">
        {bullets.slice(0, 5).map((b, i) => (
          <li key={i} className="flex gap-2 text-[13px] leading-relaxed text-white/75">
            <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-accent-400" aria-hidden="true" />
            <span>{b}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function DashboardPage() {
  const { dataset, status: dataStatus } = useDataset();
  const dash = useDashboard();
  const { board, status, stage, error, engine, filters } = dash;
  const { serverModel } = usePlan();
  const ownKey = !!useSyncExternalStore(subscribeToKey, keySnapshot, serverKeySnapshot);
  const useModel = ownKey || !!serverModel;
  const [editing, setEditing] = useState(false);
  const [panel, setPanel] = useState(null); // { type: 'edit', id } | { type: 'add', tile } | { type: 'fields' }

  // Upload → dashboard: build as soon as there is a table and no dashboard for it.
  useEffect(() => {
    if (!dataset || dataStatus === 'ingesting') return;
    if (status === 'idle' && !board) dash.build({ useModel });
  }, [dataset, dataStatus, status, board, dash, useModel]);

  const measures = engine?.measures || board?.measures || [];
  const fields = engine?.ds?.fields || board?.ds?.fields || [];
  const tiles = useMemo(() => (board?.sections || []).flatMap((s) => s.tiles), [board]);
  const editTile = panel?.type === 'edit' ? tiles.find((t) => t.id === panel.id) : null;

  const openAdd = useCallback(() => {
    if (!engine) return;
    const spec = defaultSpec('breakdown', null, { measures: engine.measures, fields: engine.ds.fields });
    setPanel({ type: 'add', tile: { ...spec, viz: 'hbar', w: 6, h: 4 } });
  }, [engine]);

  const readOnly = !!board?.readOnly;
  if (!dataset && !readOnly) {
    return (
      <PageFrame title="Dashboard" subtitle="Upload a table and the dashboard builds itself.">
        <div className="card flex flex-col items-center gap-3 p-10 text-center">
          <UploadCloud size={28} className="anim-float text-accent-400" />
          <p className="text-[14px] text-white/70">No data loaded yet.</p>
          <Link href="/home" className="rounded-lg bg-accent-500 px-4 py-2 text-[12px] font-black uppercase tracking-[0.12em] text-on-accent hover:bg-accent-400">
            Get data
          </Link>
        </div>
      </PageFrame>
    );
  }

  const title = board?.subject || (dataset?.fileName || board?.ds?.name || 'Dashboard').replace(/\.[a-z0-9]+$/i, '');
  const subtitle = readOnly
    ? `Saved dashboard · ${board.summary || ''} Load the same file to filter and edit it.`
    : board
      ? [board.summary, board.ds?.shape && `read as ${describeShape(board.ds)}`].filter(Boolean).join(' · ')
      : `${dataset.rowCount.toLocaleString()} rows`;

  const actions = board && !readOnly && (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => {
          setEditing((e) => !e);
          if (editing) setPanel(null);
        }}
        className={PRIMARY_ACTION}
        aria-pressed={editing}
      >
        {editing ? <Check size={15} /> : <Pencil size={15} />} {editing ? 'Done' : 'Edit'}
      </button>
      {editing && (
        <button type="button" onClick={openAdd} aria-pressed={panel?.type === 'add'} className={`anim-zoom ${panel?.type === 'add' ? ACTIVE_ACTION : SECONDARY_ACTION}`}>
          <Plus size={15} className={ACTION_ICON} /> Add chart
        </button>
      )}
      <button type="button" onClick={() => setPanel(panel?.type === 'fields' ? null : { type: 'fields' })} className={panel?.type === 'fields' ? ACTIVE_ACTION : SECONDARY_ACTION} aria-pressed={panel?.type === 'fields'}>
        <Columns3 size={15} className={ACTION_ICON} /> Fields & measures
      </button>
      <SaveDashboard />
      <button
        type="button"
        title="Rebuild the dashboard from the data"
        onClick={() => {
          setPanel(null);
          dash.build({ useModel });
        }}
        className={`group ${SECONDARY_ACTION}`}
      >
        <RefreshCw size={15} className={`${ACTION_ICON} transition-transform duration-500 group-hover:rotate-180`} /> Rebuild
      </button>
    </div>
  );

  return (
    <ChartPalette>
      {/* The whole page makes room for the side panel — header and toolbar
          included, so the buttons that opened it never slide underneath it. */}
      <div className={`transition-[padding] duration-300 ${panel ? 'lg:pr-[400px]' : ''}`}>
      <PageFrame title={title} subtitle={subtitle} action={actions}>
        {status === 'building' && !board && <Building stage={stage} useModel={useModel} />}
        {status === 'error' && (
          <div className="card p-5 text-[13px] text-rose-300">
            {error}{' '}
            <button type="button" className="ml-2 underline" onClick={() => dash.build({ useModel: false })}>
              Try again
            </button>
          </div>
        )}
        {board && (
          <div className="flex gap-5">
            <div className="ld-rise min-w-0 flex-1 space-y-5 pb-4" data-testid="dashboard">
              {status === 'building' && (
                <div className="flex items-center gap-2 text-[12px] text-white/50">
                  <Loader2 size={13} className="animate-spin" /> {stage || 'Updating'}…
                </div>
              )}
              <Findings board={board} />
              {!readOnly && <DashboardFilters board={board} fields={fields} />}
              <KpiStrip kpis={board.kpis} editing={editing} onRemove={dash.removeKpi} />
              {board.sections.length === 0 && !readOnly && (
                <div className="card flex flex-col items-center gap-3 p-10 text-center">
                  <p className="text-[14px] text-white/70">An empty dashboard. Add the charts you want.</p>
                  <button type="button" onClick={() => { setEditing(true); openAdd(); }} className="flex items-center gap-1.5 rounded-lg bg-accent-500 px-4 py-2 text-[12px] font-black uppercase tracking-[0.12em] text-on-accent hover:bg-accent-400">
                    <Plus size={14} /> Add a chart
                  </button>
                </div>
              )}
              {board.sections.map((s, si) => (
                <section key={s.id} aria-label={s.title || 'Main chart'} className="ld-rise" style={{ animationDelay: `${120 + si * 90}ms` }}>
                  {s.title && (
                    <h2 className="mb-2.5 mt-1 flex items-center gap-3 text-[11px] font-bold uppercase tracking-[0.12em] text-white/50">
                      {s.title}
                      <span aria-hidden="true" className="anim-grow-x h-px flex-1 bg-gradient-to-r from-white/10 to-transparent" style={{ animationDelay: `${240 + si * 90}ms` }} />
                    </h2>
                  )}
                  <div className="stagger grid grid-cols-12 gap-4">
                    {s.tiles.map((t, i) => (
                      <Tile
                        key={t.id}
                        tile={t}
                        measures={measures}
                        fields={fields}
                        editing={editing && !readOnly}
                        filters={filters}
                        first={i === 0}
                        last={i === s.tiles.length - 1}
                        selectedIds={panel?.type === 'edit' ? [panel.id] : []}
                        onEdit={(id) => setPanel({ type: 'edit', id })}
                        onRemove={(id) => {
                          dash.removeTile(id);
                          if (panel?.id === id) setPanel(null);
                        }}
                        onMove={dash.moveTile}
                        onResize={dash.patchTileLayout}
                        onSelect={readOnly ? null : (field, value) => dash.toggleFilterValue(field, value)}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
            {panel && createPortal(
              // A full-height panel docked to the right edge, like an
              // inspector: top to bottom of the window, flush to the side,
              // with the board making room for it on a wide screen. It was a
              // floating card that started a fifth of the way down.
              <div className="anim-fade fixed inset-0 z-[65] flex justify-end bg-black/40 lg:inset-y-0 lg:left-auto lg:right-0 lg:w-[400px] lg:bg-transparent" onClick={(e) => e.target === e.currentTarget && setPanel(null)}>
                {/* Keyed on what it holds, so switching from one chart's editor
                    to another's slides the new one in rather than swapping. */}
                <div key={panel.type === 'edit' ? panel.id : panel.type} className="anim-slide-right flex h-full w-full max-w-[400px] flex-col border-l border-white/10 bg-surface shadow-[-24px_0_48px_-24px_rgba(0,0,0,0.6)]">
                  {panel.type === 'fields' && <FieldsPanel onClose={() => setPanel(null)} />}
                  {panel.type === 'edit' && editTile && (
                    <TileEditor
                      mode="edit"
                      tile={editTile}
                      engine={engine}
                      onClose={() => setPanel(null)}
                      onApply={async (draft) => {
                        await dash.updateTile(editTile.id, draft);
                        setPanel(null);
                      }}
                    />
                  )}
                  {panel.type === 'add' && (
                    <TileEditor
                      mode="add"
                      tile={panel.tile}
                      engine={engine}
                      onClose={() => setPanel(null)}
                      onApply={async (draft) => {
                        await dash.addTile(draft);
                        setPanel(null);
                      }}
                    />
                  )}
                </div>
              </div>,
              document.body
            )}
          </div>
        )}
      </PageFrame>
      </div>
    </ChartPalette>
  );
}

function describeShape(ds) {
  const noun = ds.noun?.one || 'record';
  switch (ds.shape) {
    case 'events':
      return `one row per ${noun}, over time`;
    case 'entities':
      return `one row per ${noun}`;
    case 'panel':
      return 'one row per thing per period';
    case 'series':
      return 'a time series';
    case 'long':
      return 'several quantities in one column';
    case 'survey':
      return 'survey responses';
    default:
      return ds.shape;
  }
}
