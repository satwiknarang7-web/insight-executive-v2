'use client';

/**
 * The per-slide editor: chart type, palette, title and analyst notes.
 *
 * Everything here is staged locally and only written on Save. The previous
 * build let you cycle the chart type but threw the choice away on navigation,
 * so the deck you presented never matched the one you had been looking at.
 * Staging makes the Save button meaningful and makes Discard possible.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Palette, RotateCcw, Save, Trash2, Type } from 'lucide-react';
import { PALETTES } from '../charts/palette';
import { CHART_COLORS } from '../../lib/constants';

const TYPES = ['auto', 'bar', 'line', 'area', 'donut', 'radial', 'scatter', 'treemap', 'radar', 'composed'];

/** Which preset (if any) a saved colour list corresponds to. */
function matchPreset(colors) {
  if (!colors?.length) return 'default';
  const hit = PALETTES.find((p) => p.colors.slice(0, colors.length).join() === colors.join());
  return hit ? hit.key : 'custom';
}

export default function ChartStudio({ slide, onSave, onDelete, busy = false }) {
  const chart = slide.chart || {};
  const saved = useMemo(
    () => ({
      pageTitle: slide.pageTitle || '',
      analystNotes: slide.analystNotes || '',
      chartType: chart.chart_type || 'bar',
      colors: chart.colors || null,
    }),
    [slide.id, slide.pageTitle, slide.analystNotes, chart.chart_type, chart.colors]
  );

  const [draft, setDraft] = useState(saved);
  const [justSaved, setJustSaved] = useState(false);

  // Moving to another slide must not carry the previous slide's draft with it.
  useEffect(() => {
    setDraft(saved);
    setJustSaved(false);
  }, [saved]);

  const dirty =
    draft.pageTitle !== saved.pageTitle ||
    draft.analystNotes !== saved.analystNotes ||
    draft.chartType !== saved.chartType ||
    (draft.colors || []).join() !== (saved.colors || []).join();

  const set = useCallback((patch) => {
    setDraft((d) => ({ ...d, ...patch }));
    setJustSaved(false);
  }, []);

  const save = useCallback(() => {
    onSave({
      pageTitle: draft.pageTitle,
      analystNotes: draft.analystNotes,
      chart: { chart_type: draft.chartType, colors: draft.colors },
    });
    setJustSaved(true);
  }, [draft, onSave]);

  const activePreset = matchPreset(draft.colors);
  const swatches = draft.colors?.length ? draft.colors : CHART_COLORS;

  return (
    <div className="card flex flex-col gap-5 p-5">
      <div className="flex items-center gap-2">
        <Type size={13} className="text-accent-400" />
        <span className="label">Edit this finding</span>
        {dirty && (
          <span className="ml-auto rounded-full border border-amber-500/25 bg-amber-500/10 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.2em] text-amber-300">
            Unsaved
          </span>
        )}
        {!dirty && justSaved && (
          <span className="ml-auto flex items-center gap-1.5 text-[9px] font-black uppercase tracking-[0.2em] text-emerald-400">
            <Check size={11} /> Saved
          </span>
        )}
      </div>

      {/* Title */}
      <label className="flex flex-col gap-2">
        <span className="label">Title</span>
        <input
          value={draft.pageTitle}
          onChange={(e) => set({ pageTitle: e.target.value })}
          className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm font-bold text-white/85 outline-none focus:border-accent-500/50"
        />
      </label>

      {/* Chart type */}
      <label className="flex flex-col gap-2">
        <span className="label">Chart type</span>
        <select
          value={draft.chartType}
          onChange={(e) => set({ chartType: e.target.value })}
          className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm font-bold capitalize text-white/85 outline-none focus:border-accent-500/50"
        >
          {TYPES.filter((t) => t !== 'auto').map((t) => (
            <option key={t} value={t} className="bg-surface">
              {t}
            </option>
          ))}
        </select>
        <span className="text-[11px] leading-relaxed text-white/30">
          A type the data cannot support is downgraded automatically when it renders.
        </span>
      </label>

      {/* Palette */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Palette size={12} className="text-white/40" />
          <span className="label">Colours</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {PALETTES.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => set({ colors: p.key === 'default' ? null : p.colors })}
              className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 transition-colors ${
                activePreset === p.key
                  ? 'border-accent-500/50 bg-accent-500/10'
                  : 'border-white/10 hover:border-white/25 hover:bg-white/5'
              }`}
              title={p.name}
            >
              <span className="flex">
                {p.colors.slice(0, 4).map((c) => (
                  <span
                    key={c}
                    className="h-3.5 w-3.5 rounded-full ring-1 ring-black/40"
                    style={{ backgroundColor: c, marginLeft: -4 }}
                  />
                ))}
              </span>
              <span className="text-[10px] font-black uppercase tracking-[0.15em] text-white/60">{p.name}</span>
            </button>
          ))}
        </div>

        {/* Per-series overrides. The first few colours carry the most weight. */}
        <div className="mt-1 flex flex-wrap gap-2">
          {swatches.slice(0, 6).map((c, i) => (
            <label
              key={i}
              className="relative h-7 w-7 cursor-pointer overflow-hidden rounded-lg ring-1 ring-white/15"
              style={{ backgroundColor: c }}
              title={`Series ${i + 1}: ${c}`}
            >
              <input
                type="color"
                value={c}
                onChange={(e) => {
                  const next = [...swatches];
                  next[i] = e.target.value;
                  set({ colors: next });
                }}
                className="absolute inset-0 cursor-pointer opacity-0"
              />
            </label>
          ))}
        </div>
      </div>

      {/* Analyst notes */}
      <label className="flex flex-col gap-2">
        <span className="label">Analyst notes</span>
        <textarea
          rows={4}
          value={draft.analystNotes}
          placeholder="Context the numbers don't carry — why this happened, what was already tried, what to watch."
          onChange={(e) => set({ analystNotes: e.target.value })}
          className="resize-y rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[13px] leading-relaxed text-white/80 outline-none placeholder:text-white/20 focus:border-accent-500/50"
        />
      </label>

      {/* Actions */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={!dirty || busy}
          className="flex items-center gap-2 rounded-lg bg-accent-500 px-4 py-2.5 text-[10px] font-black uppercase tracking-[0.2em] text-on-accent transition-colors hover:bg-accent-400 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/30"
        >
          <Save size={13} /> Save
        </button>
        <button
          type="button"
          onClick={() => setDraft(saved)}
          disabled={!dirty}
          className="flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2.5 text-[10px] font-black uppercase tracking-[0.2em] text-white/45 transition-colors hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:text-white/15"
        >
          <RotateCcw size={13} /> Discard
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="ml-auto flex items-center gap-2 rounded-lg border border-rose-500/25 px-3 py-2.5 text-[10px] font-black uppercase tracking-[0.2em] text-rose-400 transition-colors hover:bg-rose-500/10"
        >
          <Trash2 size={13} /> Delete
        </button>
      </div>
    </div>
  );
}
