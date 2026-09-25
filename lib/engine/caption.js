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
      if (tile.series) return seriesTrendInsight(computed, m, { grain, seriesLabel: field(tile.series)?.label || tile.series });
      if (['hourOfDay', 'weekday', 'monthOfYear'].includes(grain)) return null;
      return trendInsight(computed, m, { grain });
    }
    case 'breakdown':
      if (!m || tile.series || (tile.measures || []).length > 1) return null;
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
