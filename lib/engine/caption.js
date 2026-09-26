/**
 * The caption for any tile, from its computed data — used when a tile is
 * edited or the dashboard is filtered, so the sentence under a chart is always
 * about the chart as it is now.
 */

import { chooseGrain } from './tiles.js';
import {
  breakdownInsight,
  compareInsight,
  distributionInsight,
  relationshipInsight,
  seriesTrendInsight,
  tableInsight,
  trendInsight,
} from './insights.js';
import { runQuery } from './query.js';
import { formatPeriod, formatValue, lower, plural } from './format.js';

/**
 * A waterfall's caption: what the parts add up to and which moves it most.
 *
 * The chart shows a running total, so a caption about the change from the
 * first period to the last ("Revenue fell 28%") describes a different chart —
 * the bars climb while the sentence says "fell".
 */
function waterfallInsight(computed, m, { grain = null, dimLabel = '' } = {}) {
  const y = computed?.ys?.[0];
  const x = computed?.x;
  const steps = (computed?.data || []).filter((d) => typeof d[y] === 'number');
  if (!y || steps.length < 2) return null;
  const fv = (v) => formatValue(v, m);
  const name = (d) => (grain ? formatPeriod(d[x], grain) : String(d[x]));
  const total = steps.reduce((t, d) => t + d[y], 0);
  const up = steps.filter((d) => d[y] > 0).sort((a, b) => b[y] - a[y])[0];
  const down = steps.filter((d) => d[y] < 0).sort((a, b) => a[y] - b[y])[0];
  const lead = grain
    ? `${m.label} builds to ${fv(total)} over ${steps.length} ${plural(grain)}`
    : `The ${steps.length} ${plural(lower(dimLabel || 'part'))} add up to ${fv(total)}`;
  const biggest = !up ? '' : grain ? `the biggest step up is ${name(up)} (+${fv(up[y])})` : `${name(up)} adds the most (+${fv(up[y])})`;
  const back = down ? `${name(down)} takes away ${fv(-down[y])}` : '';
  const text = `${lead}${biggest ? `; ${biggest}` : ''}${back ? `, and ${back}` : ''}.`;
  return {
    text,
    score: 0.5,
    facts: { total: fv(total), ...(up ? { top: name(up), topValue: fv(up[y]) } : {}), ...(down ? { drop: name(down), dropValue: fv(-down[y]) } : {}) },
  };
}

/** The lead sentence of a caption, so two can sit side by side. */
const firstSentence = (text) => String(text || '').split(/\.\s+(?=[A-Z])/)[0].replace(/\.?$/, '.');

/**
 * A combo's caption covers both of its measures: the columns, then the line.
 * Each is read by the same insight the chart would get on its own.
 */
function comboInsight(computed, ms, read) {
  const [a, b] = ms;
  const one = read({ ...computed, ys: [computed.ys[0]] }, a);
  const two = read({ ...computed, ys: [computed.ys[1]] }, b);
  if (!one && !two) return null;
  if (!one || !two) return one || two;
  return { text: `${firstSentence(one.text)} ${firstSentence(two.text)}`, score: Math.max(one.score || 0, two.score || 0), facts: { ...two.facts, ...one.facts } };
}

export function tileInsight(rows, tile, computed, ds, measures, filters = []) {
  if (!computed) return null;
  const all = [...(filters || []), ...(tile.filters || [])];
  const byId = (id) => measures.find((m) => m.id === id);
  const m = byId(tile.measures?.[0]);
  const field = (name) => ds.byName?.[name] || ds.fields?.find((f) => f.name === name);
  const dimLabel = field(tile.dim)?.label || tile.dim;
  switch (tile.kind) {
    case 'trend': {
      if (!m) return null;
      const grain = tile.grain || chooseGrain(field(tile.dim));
      if (tile.viz === 'waterfall' && !tile.series) return waterfallInsight(computed, m, { grain });
      if (tile.viz === 'combo' && (tile.measures || []).length === 2 && computed?.ys?.length === 2) {
        return comboInsight(computed, tile.measures.map(byId), (c, mm) => (mm ? trendInsight(c, mm, { grain }) : null));
      }
      if (tile.series) return seriesTrendInsight(computed, m, { grain, seriesLabel: field(tile.series)?.label || tile.series });
      if (['hourOfDay', 'weekday', 'monthOfYear'].includes(grain)) return null;
      return trendInsight(computed, m, { grain });
    }
    case 'breakdown':
      if (!m || tile.series) return null;
      if (tile.viz === 'waterfall' && (tile.measures || []).length === 1) return waterfallInsight(computed, m, { dimLabel });
      if (tile.viz === 'combo' && (tile.measures || []).length === 2 && computed?.ys?.length === 2) {
        const opts = { rows, filters: all, dimLabel, ds, numericDim: field(tile.dim)?.kind === 'number' };
        return comboInsight(computed, tile.measures.map(byId), (c, mm) => (mm ? breakdownInsight(c, mm, opts) : null));
      }
      if ((tile.measures || []).length > 1) return null;
      return breakdownInsight(computed, m, { rows, filters: all, dimLabel, ds, numericDim: field(tile.dim)?.kind === 'number' });
    case 'compare':
      return compareInsight(computed, (tile.measures || []).map(byId).filter(Boolean));
    case 'distribution': {
      const f = field(tile.field);
      return f ? distributionInsight(computed, f, m || { format: f.format, scale: f.scale }) : null;
    }
    case 'relationship': {
      const fx = field(tile.x);
      const fy = field(tile.y);
      if (!fx || !fy) return null;
      const mx = measures.find((x) => x.field === fx.name) || { format: fx.format, scale: fx.scale };
      const my = measures.find((x) => x.field === fy.name) || { format: fy.format, scale: fy.scale };
      return relationshipInsight(computed, fx, fy, mx, my);
    }
    case 'table': {
      if (!m) return null;
      const totals = runQuery(rows, { measures: [m], by: [], filters: all }).totals;
      return tableInsight(computed, m, { dimLabel, totals });
    }
    default:
      return null;
  }
}
