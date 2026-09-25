/**
 * The viewer's preferences beyond lighting and material (lib/appearance.js):
 * a colour theme, a text size, and how much motion the app uses.
 *
 * Same shape as appearance: kept in this browser only, applied as attributes
 * on <html> by a blocking head script so the first paint is already right,
 * and styled entirely in CSS from those attributes. The defaults carry no
 * attribute at all.
 */

export const ACCENTS = [
  { id: 'aurora', label: 'Aurora', blurb: 'Emerald into teal. The default.', swatch: ['#34d399', '#2dd4bf'] },
  { id: 'cyan', label: 'Midnight', blurb: 'Electric cyan into indigo.', swatch: ['#22d3ee', '#818cf8'] },
  { id: 'nebula', label: 'Nebula', blurb: 'Violet into pink.', swatch: ['#a78bfa', '#f472b6'] },
  { id: 'solar', label: 'Solar', blurb: 'Amber into coral.', swatch: ['#fbbf24', '#fb7185'] },
  { id: 'crimson', label: 'Crimson', blurb: 'Rose into orange.', swatch: ['#fb7185', '#fb923c'] },
  { id: 'cobalt', label: 'Cobalt', blurb: 'Blue into lavender.', swatch: ['#60a5fa', '#a78bfa'] },
];

export const SCALES = [
  { id: 'small', label: 'Compact', blurb: 'More on screen.' },
  { id: 'default', label: 'Default', blurb: 'As designed.' },
  { id: 'large', label: 'Large', blurb: 'Easier to read.' },
];

export const MOTIONS = [
  { id: 'full', label: 'Full', blurb: 'Transitions and chart animations.' },
  { id: 'reduced', label: 'Reduced', blurb: 'Everything appears at once.' },
];

export const DEFAULTS = { accent: 'aurora', scale: 'default', motion: 'full' };
export const ACCENT_KEY = 'insight.accent';
export const SCALE_KEY = 'insight.scale';
export const MOTION_KEY = 'insight.motion';

const valid = (list, v, fallback) => (list.some((x) => x.id === v) ? v : fallback);

export function normalizePreferences({ accent, scale, motion } = {}) {
  return {
    accent: valid(ACCENTS, accent, DEFAULTS.accent),
    scale: valid(SCALES, scale, DEFAULTS.scale),
    motion: valid(MOTIONS, motion, DEFAULTS.motion),
  };
}

/** Attributes on <html>; null means "remove", which is how every default is written. */
export function preferenceAttributes(prefs = {}) {
  const p = normalizePreferences(prefs);
  return {
    'data-accent': p.accent === DEFAULTS.accent ? null : p.accent,
    'data-scale': p.scale === DEFAULTS.scale ? null : p.scale,
    'data-motion': p.motion === DEFAULTS.motion ? null : p.motion,
  };
}

const list = (xs, def) => xs.filter((x) => x.id !== def).map((x) => `'${x.id}'`).join(',');

/** Runs in <head> before paint. Storage can throw, so it is all in a try. */
export const PREFERENCES_SCRIPT = `(function(){try{
var d=document.documentElement,g=function(k){return localStorage.getItem(k)};
var a=g('${ACCENT_KEY}'),s=g('${SCALE_KEY}'),m=g('${MOTION_KEY}');
if([${list(ACCENTS, DEFAULTS.accent)}].indexOf(a)>=0)d.setAttribute('data-accent',a);
if([${list(SCALES, DEFAULTS.scale)}].indexOf(s)>=0)d.setAttribute('data-scale',s);
if([${list(MOTIONS, DEFAULTS.motion)}].indexOf(m)>=0)d.setAttribute('data-motion',m);
}catch(e){}})();`;

export function currentPreferences() {
  if (typeof document === 'undefined') return normalizePreferences({});
  const root = document.documentElement;
  return normalizePreferences({
    accent: root.getAttribute('data-accent'),
    scale: root.getAttribute('data-scale'),
    motion: root.getAttribute('data-motion'),
  });
}

export function applyPreferences(next) {
  const p = normalizePreferences(next);
  if (typeof document !== 'undefined') {
    const root = document.documentElement;
    for (const [attr, value] of Object.entries(preferenceAttributes(p))) {
      if (value === null) root.removeAttribute(attr);
      else root.setAttribute(attr, value);
    }
  }
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(ACCENT_KEY, p.accent);
      window.localStorage.setItem(SCALE_KEY, p.scale);
      window.localStorage.setItem(MOTION_KEY, p.motion);
    } catch {
      /* private browsing: the choice just will not persist */
    }
    window.dispatchEvent(new CustomEvent('insight:preferences', { detail: p }));
  }
  return p;
}
