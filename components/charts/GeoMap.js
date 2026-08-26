'use client';

/**
 * Maps: filled (choropleth), bubble, and shape.
 *
 * One component for all three because they differ only in what is drawn on top
 * of the same projected boundaries — shading, circles, or a normalised subset.
 * Splitting them would triple the atlas loading, the name matching and the
 * projection code for no gain.
 *
 * The boundary file is ~110KB and is imported dynamically, so a deck with no
 * map never downloads it. Everything is drawn from a local file: there are no
 * tile servers and no requests, which keeps a map consistent with the promise
 * the rest of the product makes about data staying put.
 *
 * When regions cannot be matched the map says so. A blank country reads as
 * "zero" to everyone who looks at it, and silently dropping "Scotland" because
 * the boundary file only knows "United Kingdom" is the difference between a
 * chart that is wrong and one that is honest.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { usePalette } from './palette';
import { formatNumber } from '../../lib/format';
import { prettyLabel } from './axis';
import {
  bubbleRadius,
  bucketOf,
  matchRegions,
  quantileBreaks,
  shadeRamp,
} from '../../lib/geo';

const W = 900;
const H = 480;

/** Loaded once per page, then shared by every map on it. */
let atlasPromise = null;
function loadAtlas() {
  atlasPromise ||= Promise.all([
    import('world-atlas/countries-110m.json'),
    import('topojson-client'),
    import('d3-geo'),
  ]).then(([topoMod, topojson, d3geo]) => {
    const topo = topoMod.default || topoMod;
    const collection = topojson.feature(topo, topo.objects.countries);
    return { features: collection.features, d3geo };
  });
  return atlasPromise;
}

export default function GeoMap({ data, xKey, yKey, variant = 'filled', xLabel, yLabel }) {
  const CHART_COLORS = usePalette();
  const [atlas, setAtlas] = useState(null);
  const [failed, setFailed] = useState(false);
  const [hover, setHover] = useState(null);
  const wrapRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    loadAtlas()
      .then((a) => !cancelled && setAtlas(a))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, []);

  const model = useMemo(() => {
    if (!atlas || !data?.length) return null;

    const names = atlas.features.map((f) => f.properties.name);
    const { values, unmatched, matched } = matchRegions(data, xKey, yKey, names);
    if (!matched) return { empty: true, unmatched, values, matched };

    // A shape map compares only the regions in the data, so the projection is
    // fitted to those and the rest of the world is not drawn at all. That is
    // what makes it a relative comparison rather than a world map with a few
    // countries coloured in.
    const drawn =
      variant === 'shape'
        ? atlas.features.filter((f) => values.has(f.properties.name))
        : atlas.features;

    const { geoNaturalEarth1, geoMercator, geoPath } = atlas.d3geo;
    const projection = variant === 'shape' ? geoMercator() : geoNaturalEarth1();
    projection.fitExtent(
      [
        [14, 14],
        [W - 14, H - 14],
      ],
      { type: 'FeatureCollection', features: drawn.length ? drawn : atlas.features }
    );
    const path = geoPath(projection);

    const numbers = [...values.values()];
    const breaks = quantileBreaks(numbers, 5);
    const ramp = shadeRamp(CHART_COLORS[0], 5);
    const maxValue = Math.max(...numbers, 0);

    const points =
      variant === 'bubble'
        ? [...values.entries()]
            .map(([name, value]) => {
              const feature = atlas.features.find((f) => f.properties.name === name);
              const centroid = feature ? path.centroid(feature) : null;
              if (!centroid || Number.isNaN(centroid[0])) return null;
              return { name, value, x: centroid[0], y: centroid[1], r: bubbleRadius(value, maxValue) };
            })
            .filter(Boolean)
            .sort((a, b) => b.r - a.r) // big circles first, so small ones stay clickable
        : [];

    return { drawn, path, values, breaks, ramp, unmatched, matched, maxValue, points };
  }, [atlas, data, xKey, yKey, variant, CHART_COLORS]);

  if (failed) {
    return <Message>The map boundaries could not be loaded.</Message>;
  }
  if (!atlas || !model) {
    return <Message>Loading the map…</Message>;
  }
  if (model.empty) {
    return (
      <Message>
        None of the {model.unmatched.length} values in {prettyLabel(xKey)} matched a country on the map
        {model.unmatched.length ? ` — for example “${model.unmatched[0]}”` : ''}.
      </Message>
    );
  }

  const { drawn, path, values, breaks, ramp, points } = model;

  return (
    <div ref={wrapRef} className="relative flex h-full w-full flex-col">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full" role="img" aria-label={`Map of ${prettyLabel(yKey)} by ${prettyLabel(xKey)}`}>
        {drawn.map((f) => {
          const name = f.properties.name;
          const value = values.get(name);
          const has = value !== undefined;
          const fill =
            variant === 'bubble'
              ? 'var(--chart-grid)'
              : has
              ? ramp[bucketOf(value, breaks)] || ramp[0]
              : 'var(--chart-grid)';

          return (
            <path
              key={f.id ?? name}
              d={path(f) || undefined}
              fill={fill}
              fillOpacity={variant === 'bubble' ? 0.16 : has ? 1 : 0.12}
              stroke="var(--chart-stroke)"
              strokeWidth={0.4}
              onMouseEnter={() => has && setHover({ name, value })}
              onMouseLeave={() => setHover(null)}
            >
              {has && <title>{`${name}: ${formatNumber(value)}`}</title>}
            </path>
          );
        })}

        {points.map((p) => (
          <circle
            key={p.name}
            cx={p.x}
            cy={p.y}
            r={p.r}
            fill={CHART_COLORS[0]}
            fillOpacity={0.55}
            stroke={CHART_COLORS[0]}
            strokeWidth={1}
            onMouseEnter={() => setHover({ name: p.name, value: p.value })}
            onMouseLeave={() => setHover(null)}
          >
            <title>{`${p.name}: ${formatNumber(p.value)}`}</title>
          </circle>
        ))}
      </svg>

      {/* Legend + honesty about what was matched */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-wrap items-end justify-between gap-2 p-2">
        {variant !== 'bubble' && (
          <div className="flex items-center gap-1.5 rounded-lg bg-surface/80 px-2 py-1 backdrop-blur-sm">
            <span className="text-[9px] font-black uppercase tracking-[0.15em] text-white/40">Low</span>
            {ramp.map((c) => (
              <span key={c} className="h-2.5 w-5 rounded-sm" style={{ backgroundColor: c }} />
            ))}
            <span className="text-[9px] font-black uppercase tracking-[0.15em] text-white/40">High</span>
          </div>
        )}
        <div className="rounded-lg bg-surface/80 px-2 py-1 text-[10px] font-bold text-white/40 backdrop-blur-sm">
          {model.matched} {model.matched === 1 ? 'region' : 'regions'} mapped
          {model.unmatched.length > 0 && (
            <span className="text-amber-400"> · {model.unmatched.length} unmatched</span>
          )}
        </div>
      </div>

      {hover && (
        <div className="pointer-events-none absolute left-2 top-2 rounded-lg border border-white/10 bg-surface/95 px-3 py-2 shadow-xl backdrop-blur-sm">
          <div className="text-[11px] font-black text-white/85">{hover.name}</div>
          <div className="font-mono text-[11px] text-white/60">{formatNumber(hover.value)}</div>
        </div>
      )}
    </div>
  );
}

const Message = ({ children }) => (
  <div className="flex h-full items-center justify-center px-6 text-center text-[11px] font-black uppercase tracking-[0.2em] text-white/25">
    {children}
  </div>
);
