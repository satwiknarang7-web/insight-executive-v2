'use client';

/**
 * Colour theme, text size and motion — the preferences in lib/preferences.js.
 * Each choice applies at once and is kept in this browser.
 */

import { useCallback, useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { ACCENTS, MOTIONS, SCALES, applyPreferences, currentPreferences, normalizePreferences } from '../../lib/preferences';

function usePreferences() {
  const [prefs, setPrefs] = useState(() => normalizePreferences({}));
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setPrefs(currentPreferences());
    setReady(true);
    const follow = (e) => setPrefs(normalizePreferences(e.detail || currentPreferences()));
    window.addEventListener('insight:preferences', follow);
    return () => window.removeEventListener('insight:preferences', follow);
  }, []);
  const choose = useCallback((patch) => setPrefs(applyPreferences({ ...currentPreferences(), ...patch })), []);
  return { prefs, ready, choose };
}

/** Six colour themes, each shown as its own gradient and a tiny chart. */
export function ColorThemes() {
  const { prefs, ready, choose } = usePreferences();
  return (
    <div className="stagger grid grid-cols-2 gap-3 sm:grid-cols-3">
      {ACCENTS.map((a) => {
        const active = ready && prefs.accent === a.id;
        const [c1, c2] = a.swatch;
        return (
          <button
            key={a.id}
            type="button"
            onClick={() => choose({ accent: a.id })}
            aria-pressed={active}
            className={`lift group relative overflow-hidden rounded-2xl border p-3 text-left ${
              active ? 'border-accent-400/60 bg-accent-400/[0.06] shadow-[var(--glow)]' : 'border-white/10 hover:border-white/25 hover:bg-white/[0.03]'
            }`}
          >
            <span className="relative block h-16 overflow-hidden rounded-xl" style={{ background: `linear-gradient(135deg, ${c1}33, ${c2}22)` }}>
              <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden="true">
                <defs>
                  <linearGradient id={`sw-${a.id}`} x1="0" x2="1">
                    <stop offset="0" stopColor={c1} />
                    <stop offset="1" stopColor={c2} />
                  </linearGradient>
                </defs>
                {[10, 22, 16, 28, 20, 32].map((h, i) => (
                  <rect key={i} x={8 + i * 15} y={38 - h} width="8" height={h} rx="2" fill={`url(#sw-${a.id})`} opacity="0.55" />
                ))}
                <polyline points="4,30 20,24 36,27 52,16 68,19 84,9 96,11" fill="none" stroke={`url(#sw-${a.id})`} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <span className="mt-2.5 flex items-center gap-2">
              <span className="h-3 w-3 rounded-full" style={{ background: `linear-gradient(135deg, ${c1}, ${c2})` }} />
              <span className="text-[13px] font-semibold text-white/90">{a.label}</span>
              {active && <Check size={13} className="anim-zoom ml-auto text-accent-400" />}
            </span>
            <span className="mt-0.5 block text-[11.5px] text-white/45">{a.blurb}</span>
          </button>
        );
      })}
    </div>
  );
}

function Segmented({ options, value, onChange, ready }) {
  return (
    <div className="inline-flex rounded-xl border border-white/10 bg-white/[0.02] p-1">
      {options.map((o) => {
        const active = ready && value === o.id;
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id)}
            aria-pressed={active}
            title={o.blurb}
            className={`rounded-lg px-4 py-1.5 text-[12.5px] font-semibold transition-colors ${active ? 'bg-accent-500 text-on-accent' : 'text-white/55 hover:text-white/85'}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Text size and motion. */
export function DisplayPrefs() {
  const { prefs, ready, choose } = usePreferences();
  return (
    <div className="divide-y divide-white/6">
      <div className="flex flex-wrap items-center gap-4 pb-5">
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold text-white/85">Text and spacing size</div>
          <p className="mt-0.5 text-[12.5px] text-white/45">Scales the whole interface, charts included.</p>
        </div>
        <Segmented options={SCALES} value={prefs.scale} onChange={(scale) => choose({ scale })} ready={ready} />
      </div>
      <div className="flex flex-wrap items-center gap-4 pt-5">
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold text-white/85">Motion</div>
          <p className="mt-0.5 text-[12.5px] text-white/45">Reduced turns off transitions, loading animations and chart drawing.</p>
        </div>
        <Segmented options={MOTIONS} value={prefs.motion} onChange={(motion) => choose({ motion })} ready={ready} />
      </div>
    </div>
  );
}
