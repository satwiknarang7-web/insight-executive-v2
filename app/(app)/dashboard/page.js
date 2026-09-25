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
import { Check, Columns3, Loader2, Pencil, Plus, RefreshCw, Sparkles, UploadCloud } from 'lucide-react';
import PageFrame from '../../../components/shell/PageFrame';
import { useDataset } from '../../../lib/store/DatasetProvider';
import { useDashboard } from '../../../lib/store/DashboardProvider';
import { usePlan } from '../../../lib/store/PlanProvider';
import { keySnapshot, serverKeySnapshot, subscribeToKey } from '../../../lib/geminiKey';
import { ChartPalette } from '../../../components/charts/palette';
import KpiStrip from '../../../components/dashboard/KpiStrip';
import Tile from '../../../components/dashboard/Tile';
import DashboardFilters from '../../../components/dashboard/DashboardFilters';
import TileEditor, { defaultSpec } from '../../../components/dashboard/TileEditor';
import FieldsPanel from '../../../components/dashboard/FieldsPanel';
import SaveDashboard from '../../../components/dashboard/SaveDashboard';

function Building({ stage }) {
  return (
    <div className="card flex items-center gap-3 p-6 text-[14px] text-white/70" data-testid="building">
      <Loader2 size={18} className="animate-spin text-accent-400" />
      <div>
        <div className="font-semibold text-white/85">Building your dashboard…</div>
        <div className="text-[12px] text-white/45">{stage || 'Reading the table'}</div>
      </div>
    </div>
  );
}

function Findings({ board, ai }) {
  const bullets = board.aiSummary?.length ? board.aiSummary : (board.findings || []).map((f) => f.text);
  if (!bullets.length && !board.headline) return null;
  return (
    <section className="card p-5" data-testid="findings" aria-labelledby="key-findings">
      <div className="mb-2 flex items-center gap-2">
        <h2 id="key-findings" className="text-[11px] font-bold uppercase tracking-[0.12em] text-white/50">Key findings</h2>
        {ai?.written && (
          <span className="flex items-center gap-1 rounded-full border border-accent-500/30 bg-accent-500/10 px-2 py-0.5 text-[10px] font-bold text-accent-300">
            <Sparkles size={10} /> Written by a model, numbers checked
          </span>
        )}
      </div>
      {board.headline && <p className="mb-2 text-[16px] font-semibold leading-snug text-white/90">{board.headline}</p>}
      <ul className="space-y-1.5">
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
  const { board, status, stage, error, engine, filters, ai } = dash;
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
          <UploadCloud size={28} className="text-accent-400" />
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
        className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[12px] font-bold ${editing ? 'border-accent-500/50 bg-accent-500/10 text-accent-300' : 'border-white/10 text-white/65 hover:bg-white/5 hover:text-white'}`}
        aria-pressed={editing}
      >
        {editing ? <Check size={14} /> : <Pencil size={14} />} {editing ? 'Done' : 'Edit'}
      </button>
      {editing && (
        <button type="button" onClick={openAdd} className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-[12px] font-bold text-white/65 hover:bg-white/5 hover:text-white">
          <Plus size={14} /> Add chart
        </button>
      )}
      <button type="button" onClick={() => setPanel(panel?.type === 'fields' ? null : { type: 'fields' })} className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-[12px] font-bold text-white/65 hover:bg-white/5 hover:text-white">
        <Columns3 size={14} /> Fields & measures
      </button>
      <SaveDashboard />
      <button
        type="button"
        title="Rebuild the dashboard from the data"
        onClick={() => {
          setPanel(null);
          dash.build({ useModel });
        }}
        className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-[12px] font-bold text-white/65 hover:bg-white/5 hover:text-white"
      >
        <RefreshCw size={14} /> Rebuild
      </button>
    </div>
  );

  return (
    <ChartPalette>
      <PageFrame title={title} subtitle={subtitle} action={actions}>
        {status === 'building' && !board && <Building stage={stage} />}
        {status === 'error' && (
          <div className="card p-5 text-[13px] text-rose-300">
            {error}{' '}
            <button type="button" className="ml-2 underline" onClick={() => dash.build({ useModel: false })}>
              Try again
            </button>
          </div>
        )}
        {board && (
          <div className={`flex gap-5 ${panel ? 'lg:pr-[380px]' : ''}`}>
            <div className="min-w-0 flex-1 space-y-5" data-testid="dashboard">
              {status === 'building' && (
                <div className="flex items-center gap-2 text-[12px] text-white/50">
                  <Loader2 size={13} className="animate-spin" /> {stage || 'Updating'}…
                </div>
              )}
              <Findings board={board} ai={ai} />
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
              {board.sections.map((s) => (
                <section key={s.id} aria-label={s.title || 'Main chart'}>
                  {s.title && <h2 className="mb-2.5 mt-1 text-[11px] font-bold uppercase tracking-[0.14em] text-white/45">{s.title}</h2>}
                  <div className="grid grid-cols-12 gap-4">
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
              <p className="pb-4 text-[11px] text-white/35">
                {ai?.used ? 'A model helped read this table; every chart and number was computed from your rows.' : 'Built from your rows by the built-in analyst. No language model saw this data.'}
              </p>
            </div>
            {panel && createPortal(
              <div className="fixed inset-0 z-50 flex justify-end bg-black/40 p-2 lg:inset-y-0 lg:left-auto lg:right-0 lg:w-[380px] lg:bg-transparent lg:p-4" onClick={(e) => e.target === e.currentTarget && setPanel(null)}>
                <div className="max-h-full w-full max-w-[380px] overflow-y-auto lg:mt-20 lg:max-h-[calc(100%-5rem)]">
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
