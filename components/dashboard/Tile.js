'use client';

/**
 * One tile on the dashboard: a title that says what the chart shows, the
 * chart, and one or two sentences on what it means. In edit mode it grows a
 * small toolbar; the full editor opens in a side panel.
 */

import { ArrowDown, ArrowUp, Columns2, Maximize2, Pencil, Sparkles, Trash2 } from 'lucide-react';
import TileChart from './TileChart';

const HEIGHTS = { 3: 220, 4: 280, 5: 340, 6: 420 };

export default function Tile({ tile, measures, fields, editing, selectedIds = [], onEdit, onRemove, onMove, onResize, onSelect, filters = [], first = false, last = false }) {
  const height = HEIGHTS[tile.h] || 280;
  const selected = filters.find((f) => f.field === tile.dim && Array.isArray(f.values))?.values || [];
  const span = tile.w >= 12 ? 'lg:col-span-12' : 'lg:col-span-6';
  return (
    <article
      className={`card col-span-12 flex min-w-0 flex-col p-4 sm:p-5 ${span} ${selectedIds.includes(tile.id) ? 'ring-2 ring-accent-500/50' : ''}`}
      data-testid="tile"
      data-viz={tile.viz}
    >
      <header className="mb-3 flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-semibold leading-snug text-white/90">{tile.title}</h3>
          {tile.subtitle && <p className="mt-0.5 text-[12px] text-white/45">{tile.subtitle}</p>}
        </div>
        {editing && (
          <div className="flex shrink-0 items-center gap-0.5">
            <IconButton label="Edit chart" onClick={() => onEdit?.(tile.id)}>
              <Pencil size={14} />
            </IconButton>
            <IconButton label={tile.w >= 12 ? 'Make half width' : 'Make full width'} onClick={() => onResize?.(tile.id, { w: tile.w >= 12 ? 6 : 12 })}>
              {tile.w >= 12 ? <Columns2 size={14} /> : <Maximize2 size={14} />}
            </IconButton>
            <IconButton label="Move up" disabled={first} onClick={() => onMove?.(tile.id, -1)}>
              <ArrowUp size={14} />
            </IconButton>
            <IconButton label="Move down" disabled={last} onClick={() => onMove?.(tile.id, 1)}>
              <ArrowDown size={14} />
            </IconButton>
            <IconButton label="Remove chart" onClick={() => onRemove?.(tile.id)} danger>
              <Trash2 size={14} />
            </IconButton>
          </div>
        )}
      </header>
      <div className="min-w-0 flex-1">
        <TileChart tile={tile} measures={measures} fields={fields} height={height} onSelect={onSelect} selected={selected} />
      </div>
      {tile.insight && (
        <p className="mt-3 border-t border-white/6 pt-3 text-[13px] leading-relaxed text-white/70">
          {tile.aiCaption && <Sparkles size={12} className="mr-1 inline -translate-y-px text-accent-400" aria-label="Written by the model" />}
          {tile.insight}
        </p>
      )}
    </article>
  );
}

function IconButton({ children, label, onClick, disabled, danger }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-md p-1.5 text-white/40 transition-colors hover:bg-white/5 disabled:opacity-25 ${danger ? 'hover:text-rose-400' : 'hover:text-white'}`}
    >
      {children}
    </button>
  );
}
