'use client';

/**
 * The per-slide editor: chart type, palette, category names, title and notes.
 *
 * Everything here is staged locally and only written on Save. The previous
 * build let you cycle the chart type but threw the choice away on navigation,
 * so the deck you presented never matched the one you had been looking at.
 * Staging makes the Save button meaningful and makes Discard possible.
 *
 * Staging is not the same as hiding, though: the draft is reported upward
 * through `onPreview` so the chart beside the panel redraws as you pick, and
 * Save is the moment the choice reaches the dashboard rather than the moment
 * you first get to see it.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, Palette, RotateCcw, Save, Tags, Trash2, Type } from 'lucide-react';
import { PALETTES } from '../charts/palette';
import { CHART_COLORS } from '../../lib/constants';
import { editableCategories } from '../../lib/chartLabels';
import { prettyLabel } from '../charts/axis';

// Everything DynamicChart can render. 'column' is the vertical bar under the
// name people expect from Power BI; the resolver maps it back to 'bar'.
const TYPES = ['auto', 'bar', 'hbar', 'column', 'line', 'area', 'ribbon', 'composed', 'pie', 'donut', 'treemap', 'funnel', 'waterfall', 'scatter', 'bubble', 'radial', 'gauge', 'radar', 'card', 'multicard', 'kpi', 'table', 'matrix', 'filledmap', 'bubblemap', 'shapemap'];

/** Names that read better than the internal key. */
const TYPE_LABEL = {
  hbar: 'bar (horizontal)',
  bar: 'column (vertical)',
  column: 'column (vertical)',
  multicard: 'multi-row card',
  composed: 'combo (line + column)',
  filledmap: 'filled map',
  bubblemap: 'bubble map',
  shapemap: 'shape map',
};

/**
 * Where the open/closed preference is kept.
 *
 * A panel this tall pushes the finding's own narrative below the fold on the
 * page whose job is to explain the finding — but collapsing it on every visit
 * would hide the editor from people who came to edit. So the choice is the
 * user's and it sticks, the same way the sidebar rail does.
 */
const OPEN_KEY = 'insight.studio.open';

/** Which preset (if any) a saved colour list corresponds to. */
function matchPreset(colors) {
  if (!colors?.length) return 'default';
  const hit = PALETTES.find((p) => p.colors.slice(0, colors.length).join() === colors.join());
  return hit ? hit.key : 'custom';
}

export default function ChartStudio({ slide, onSave, onDelete, onPreview, busy = false }) {
  const chart = slide.chart || {};
  const saved = useMemo(
    () => ({
      pageTitle: slide.pageTitle || '',
      analystNotes: slide.analystNotes || '',
      chartType: chart.chart_type || 'bar',
      colors: chart.colors || null,
      labels: chart.labels || null,
      colorBy: chart.colorBy || 'series',
      xAxisLabel: chart.xAxisLabel ?? '',
      yAxisLabel: chart.yAxisLabel ?? '',
    }),
    [
      slide.id,
      slide.pageTitle,
      slide.analystNotes,
      chart.chart_type,
      chart.colors,
      chart.labels,
      chart.colorBy,
      chart.xAxisLabel,
      chart.yAxisLabel,
    ]
  );

  const [draft, setDraft] = useState(saved);
  const [justSaved, setJustSaved] = useState(false);
  // Read after mount rather than during render: touching localStorage while
  // rendering makes the server and client disagree and React throws.
  const [open, setOpen] = useState(true);

  useEffect(() => {
    try {
      setOpen(localStorage.getItem(OPEN_KEY) !== '0');
    } catch {
      /* private mode, or storage disabled - the default stands */
    }
  }, []);

  const toggleOpen = useCallback(
    () =>
      setOpen((prev) => {
        const next = !prev;
        try {
          localStorage.setItem(OPEN_KEY, next ? '1' : '0');
        } catch {
          /* not worth failing a click over */
        }
        return next;
      }),
    []
  );

  // Moving to another slide must not carry the previous slide's draft with it.
  useEffect(() => {
    setDraft(saved);
    setJustSaved(false);
  }, [saved]);

  // What the chart beside this panel should draw right now. Stamped with the
  // slide it belongs to: moving to the next finding re-renders the chart before
  // this effect runs, and an unstamped draft would paint the previous slide's
  // palette onto it for that frame.
  useEffect(() => {
    onPreview?.({
      id: slide.id,
      chartType: draft.chartType,
      colors: draft.colors,
      labels: draft.labels,
      colorBy: draft.colorBy,
      xAxisLabel: draft.xAxisLabel,
      yAxisLabel: draft.yAxisLabel,
    });
  }, [draft, onPreview, slide.id]);

  const dirty =
    draft.pageTitle !== saved.pageTitle ||
    draft.analystNotes !== saved.analystNotes ||
    draft.chartType !== saved.chartType ||
    (draft.colors || []).join() !== (saved.colors || []).join() ||
    draft.colorBy !== saved.colorBy ||
    draft.xAxisLabel !== saved.xAxisLabel ||
    draft.yAxisLabel !== saved.yAxisLabel ||
    JSON.stringify(draft.labels || {}) !== JSON.stringify(saved.labels || {});

  const set = useCallback((patch) => {
    setDraft((d) => ({ ...d, ...patch }));
    setJustSaved(false);
  }, []);

  // A name typed back to the original is a rename undone, so it is removed from
  // the map rather than stored as a no-op the re-run logic would have to carry.
  const rename = useCallback(
    (from, to) => {
      setDraft((d) => {
        const next = { ...(d.labels || {}) };
        if (!to.trim() || to.trim() === from) delete next[from];
        else next[from] = to;
        return { ...d, labels: Object.keys(next).length ? next : null };
      });
      setJustSaved(false);
    },
    []
  );

  const save = useCallback(() => {
    onSave({
      pageTitle: draft.pageTitle,
      analystNotes: draft.analystNotes,
      chart: {
        chart_type: draft.chartType,
        colors: draft.colors,
        labels: draft.labels,
        colorBy: draft.colorBy,
        // Blank means "no override" — the chart falls back to naming the axis
        // after its column, rather than persisting an empty title.
        xAxisLabel: draft.xAxisLabel.trim() || null,
        yAxisLabel: draft.yAxisLabel.trim() || null,
      },
    });
    setJustSaved(true);
  }, [draft, onSave]);

  const activePreset = matchPreset(draft.colors);
  const swatches = draft.colors?.length ? draft.colors : CHART_COLORS;
  const categories = useMemo(
    () => editableCategories(chart.resultData, chart.xAxisKey),
    [chart.resultData, chart.xAxisKey]
  );

  // Colouring by category means one swatch per bar, so show exactly as many as
  // there are bars — six fixed swatches would strand the seventh bar's colour
  // out of reach and offer two that paint nothing.
  const perCategory = draft.chartType === 'bar' && draft.colorBy === 'category';
  const barCount = chart.resultData?.length || 0;
  const swatchCount = perCategory ? Math.min(Math.max(barCount, 1), swatches.length) : 6;

  return (
    <div className="card flex flex-col gap-5 p-5">
      {/* The header is the toggle. The badges stay on it while collapsed, so a
          panel folded away with unsaved work still says so. */}
      <button
        type="button"
        onClick={toggleOpen}
        aria-expanded={open}
        aria-controls="chart-studio-body"
        className="-m-1 flex items-center gap-2 rounded-lg p-1 text-left transition-colors hover:bg-white/[0.03]"
      >
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
        <ChevronDown
          size={15}
          className={`shrink-0 text-white/30 transition-transform ${dirty || justSaved ? '' : 'ml-auto'} ${
            open ? '' : '-rotate-90'
          }`}
        />
      </button>

      {/* Hidden, not unmounted. Collapsing the panel must not throw away an
          edit in progress, and the chart beside it keeps showing the draft. */}
      <div id="chart-studio-body" className={open ? 'flex flex-col gap-5' : 'hidden'}>

        {/* Title */}
        <label className="flex flex-col gap-2">
          <span className="label">Title</span>
          <input
            value={draft.pageTitle}
            onChange={(e) => set({ pageTitle: e.target.value })}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm font-bold text-white/85 outline-none focus:border-accent-500/50"
          />
        </label>

        {/* Axis names */}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-2">
            <span className="label">X axis name</span>
            <input
              value={draft.xAxisLabel}
              onChange={(e) => set({ xAxisLabel: e.target.value })}
              placeholder={prettyLabel(chart.xAxisKey) || 'Category'}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/85 outline-none placeholder:text-white/25 focus:border-accent-500/50"
            />
          </label>
          <label className="flex flex-col gap-2">
            <span className="label">Y axis name</span>
            <input
              value={draft.yAxisLabel}
              onChange={(e) => set({ yAxisLabel: e.target.value })}
              placeholder={prettyLabel(chart.yAxisKey) || 'Value'}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/85 outline-none placeholder:text-white/25 focus:border-accent-500/50"
            />
          </label>
        </div>

        {/* Chart type */}
        <label className="flex flex-col gap-2">
          <span className="label">Chart type</span>
          <select
            value={draft.chartType}
            onChange={(e) => set({ chartType: e.target.value })}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm font-bold capitalize text-white/85 outline-none focus:border-accent-500/50"
          >
            {TYPES.filter((t) => t !== 'auto' && t !== 'column').map((t) => (
              <option key={t} value={t} className="bg-surface">
                {TYPE_LABEL[t] || t}
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

          {/* Bar charts can spend the palette across the bars instead of across
              series, which is the only way to choose each bar's colour. */}
          {draft.chartType === 'bar' && (
            <label className="mt-1 flex items-center gap-2">
              <input
                type="checkbox"
                checked={draft.colorBy === 'category'}
                onChange={(e) => set({ colorBy: e.target.checked ? 'category' : 'series' })}
                className="h-3.5 w-3.5 accent-accent-500"
              />
              <span className="text-[11px] font-bold text-white/60">Colour each bar separately</span>
            </label>
          )}

          {/* Per-series overrides. The first few colours carry the most weight —
              or, when colouring by category, they are the bars left to right. */}
          <div className="mt-1 flex flex-wrap gap-2">
            {swatches.slice(0, swatchCount).map((c, i) => (
              <label
                key={i}
                className="relative h-7 w-7 cursor-pointer overflow-hidden rounded-lg ring-1 ring-white/15"
                style={{ backgroundColor: c }}
                title={perCategory ? `${categories[i] || `Bar ${i + 1}`}: ${c}` : `Series ${i + 1}: ${c}`}
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

        {/* Category names. The chart shows what the user calls things; the query
            underneath still shows what the data calls them. */}
        {categories.length > 0 && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Tags size={12} className="text-white/40" />
              <span className="label">Value names</span>
            </div>
            <div className="flex flex-col gap-1.5">
              {categories.map((name) => (
                <div key={name} className="flex items-center gap-2">
                  <span className="w-28 shrink-0 truncate text-[11px] text-white/30" title={name}>
                    {name}
                  </span>
                  <input
                    value={draft.labels?.[name] ?? name}
                    onChange={(e) => rename(name, e.target.value)}
                    aria-label={`Name shown for ${name}`}
                    className="min-w-0 flex-1 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-[13px] text-white/85 outline-none focus:border-accent-500/50"
                  />
                </div>
              ))}
            </div>
            <span className="text-[11px] leading-relaxed text-white/30">
              Only what the chart displays. The query and its verified numbers keep the original values.
            </span>
          </div>
        )}

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
    </div>
  );
}
