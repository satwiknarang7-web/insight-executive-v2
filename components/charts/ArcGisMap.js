'use client';

/**
 * ArcGIS: basemaps and spatial layers from Esri.
 *
 * The one visual here that cannot be drawn offline. It renders against Esri's
 * hosted basemaps, which means two things worth stating plainly rather than
 * burying: it needs an API key from an ArcGIS account, and using it sends map
 * requests (including the viewport you are looking at) to Esri. Every other
 * chart in this product draws from data that never leaves the browser, so this
 * one is opt-in and inert until a key is configured.
 *
 * **The SDK is loaded from Esri's CDN, not bundled.** `@arcgis/core` is 49MB of
 * several thousand small modules, and installing it took this project's build
 * from about 25 seconds to over ten minutes — every build, for everyone,
 * whether or not they use maps. Since the component already cannot work without
 * contacting Esri, fetching the library from Esri too costs nothing extra in
 * privacy and gives the build back. The script is injected on first use, so a
 * deck without an ArcGIS map never requests it.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { usePalette } from './palette';
import { prettyLabel } from './axis';
import { findLatLon } from '../../lib/geo';

const KEY = process.env.NEXT_PUBLIC_ARCGIS_API_KEY;
const SDK_VERSION = process.env.NEXT_PUBLIC_ARCGIS_VERSION || '4.31';
const SDK_BASE = `https://js.arcgis.com/${SDK_VERSION}`;

/**
 * Load the Esri AMD bundle once per page.
 *
 * Esri publishes the CDN build as AMD, so the loader it installs on `window`
 * is what resolves `esri/*` module ids. Kept as a module-level promise so two
 * maps on one dashboard share a single download.
 */
let sdkPromise = null;
function loadEsri() {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));

  sdkPromise ||= new Promise((resolve, reject) => {
    // `toUrl` distinguishes Esri's AMD loader from any other `require` shim a
    // bundler might have left on the page.
    if (window.require?.toUrl) return resolve(window.require);

    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = `${SDK_BASE}/esri/themes/light/main.css`;
    document.head.appendChild(css);

    const script = document.createElement('script');
    script.src = `${SDK_BASE}/`;
    script.async = true;
    script.onload = () => resolve(window.require);
    script.onerror = () => reject(new Error('The ArcGIS SDK could not be downloaded.'));
    document.head.appendChild(script);
  });
  return sdkPromise;
}

/** Promise wrapper over the AMD loader's callback form. */
function amdRequire(loader, ids) {
  return new Promise((resolve, reject) => {
    try {
      loader(ids, (...mods) => resolve(mods));
    } catch (e) {
      reject(e);
    }
  });
}

export default function ArcGisMap({ data, xKey, yKey }) {
  const CHART_COLORS = usePalette();
  const containerRef = useRef(null);
  const [status, setStatus] = useState(KEY ? 'loading' : 'unconfigured');

  // Points come from real coordinates when the data has them; ArcGIS is a
  // spatial tool, and geocoding names would be a second external service.
  const coords = useMemo(() => {
    const columns = data?.length ? Object.keys(data[0]) : [];
    const pair = findLatLon(columns);
    if (!pair) return null;
    return (data || [])
      .map((row) => ({
        lat: Number(row[pair.lat]),
        lon: Number(row[pair.lon]),
        label: String(row[xKey] ?? ''),
        value: Number(row[yKey]) || 0,
      }))
      .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
  }, [data, xKey, yKey]);

  useEffect(() => {
    if (!KEY || !coords?.length || !containerRef.current) return undefined;

    let view;
    let cancelled = false;

    loadEsri()
      .then((loader) =>
        amdRequire(loader, [
          'esri/config',
          'esri/Map',
          'esri/views/MapView',
          'esri/layers/GraphicsLayer',
          'esri/Graphic',
        ])
      )
      .then(([esriConfig, EsriMap, MapView, GraphicsLayer, Graphic]) => {
        if (cancelled || !containerRef.current) return;
        esriConfig.apiKey = KEY;

        const layer = new GraphicsLayer();
        const max = Math.max(...coords.map((c) => c.value), 1);
        for (const point of coords) {
          layer.add(
            new Graphic({
              geometry: { type: 'point', longitude: point.lon, latitude: point.lat },
              symbol: {
                type: 'simple-marker',
                color: CHART_COLORS[0],
                outline: { color: '#ffffff', width: 0.6 },
                // Area-proportional, so a value twice as large is not drawn
                // four times as big.
                size: 6 + Math.sqrt(point.value / max) * 22,
              },
              attributes: { label: point.label, value: point.value },
              popupTemplate: { title: '{label}', content: `${prettyLabel(yKey)}: {value}` },
            })
          );
        }

        const map = new EsriMap({ basemap: 'arcgis/navigation', layers: [layer] });
        view = new MapView({ container: containerRef.current, map, zoom: 2 });
        view.when(
          () => !cancelled && setStatus('ready'),
          () => !cancelled && setStatus('failed')
        );
      })
      .catch(() => !cancelled && setStatus('failed'));

    return () => {
      cancelled = true;
      view?.destroy?.();
    };
  }, [coords, CHART_COLORS, yKey]);

  if (status === 'unconfigured') {
    return (
      <Note>
        <strong className="text-white/70">ArcGIS is not configured.</strong> This visual renders against
        Esri&rsquo;s hosted basemaps, so it needs an ArcGIS API key in{' '}
        <code className="rounded bg-white/5 px-1 py-0.5">NEXT_PUBLIC_ARCGIS_API_KEY</code>, and it sends map
        requests to Esri. Every other map here is drawn offline from a bundled boundary file.
      </Note>
    );
  }
  if (!coords?.length) {
    return (
      <Note>
        An ArcGIS map plots real coordinates, so it needs latitude and longitude columns. This result set
        has none — a filled or bubble map will plot by region name instead.
      </Note>
    );
  }

  return (
    <div className="relative h-full w-full overflow-hidden rounded-lg">
      <div ref={containerRef} className="h-full w-full" />
      {status !== 'ready' && (
        <div className="absolute inset-0 flex items-center justify-center text-center text-[11px] font-black uppercase tracking-[0.2em] text-white/25">
          {status === 'failed' ? 'The Esri map could not be loaded' : 'Loading Esri basemap…'}
        </div>
      )}
    </div>
  );
}

const Note = ({ children }) => (
  <div className="flex h-full items-center justify-center p-6">
    <p className="max-w-md text-center text-[12px] leading-relaxed text-white/45">{children}</p>
  </div>
);
