/**
 * How the app looks: the ground it is lit from, and what its surfaces are made of.
 *
 * Two independent choices, and keeping them independent is the point.
 *
 *   **Mode** — dark or light. This decides the ground and the ink, and it is
 *   the one people change for their room rather than their taste.
 *
 *   **Surface** — glass, clay or neumorphic. This decides what a card is made
 *   of: something you see through, something moulded, or something pressed out
 *   of the page itself. It is the same information either way; only the
 *   material changes.
 *
 * A single enum of six combinations would have been simpler to write and wrong
 * to use: somebody who likes clay and moves to a dark room wants dark clay, not
 * to lose their material. So both live on `<html>` as their own attribute —
 * `data-theme` and `data-surface` — and `globals.css` reads them separately.
 *
 * Everything here is pure: the attribute names, the storage keys, the reading
 * and writing. It is imported by the blocking script that runs before first
 * paint, by the settings panel, and by the tests, and none of those can afford
 * a second opinion about what "clay" means.
 */

/** Dark carries no attribute: it is the default, and a first paint with no
 *  attribute set is the design as drawn. */
export const MODES = [
  { id: 'dark', label: 'Dark', blurb: 'Near-black ground, for a dim room and a long session.' },
  { id: 'light', label: 'Light', blurb: 'White page, navy ink, for daylight and for printing.' },
];

/**
 * The three materials, and what each is actually for.
 *
 * The descriptions are not decoration. Each of these trades something real, and
 * a person choosing between them should be told what, rather than picking from
 * three words they have to look up.
 */
export const SURFACES = [
  {
    id: 'glass',
    label: 'Glass',
    blurb: 'Translucent panels over a lit ground. Sharpest text, strongest sense of depth.',
    detail: 'Frosted surfaces that let the ground show through, with a hairline edge and a soft lift.',
  },
  {
    id: 'clay',
    label: 'Clay',
    blurb: 'Solid, rounded, softly shadowed. The friendliest of the three, and the calmest to read.',
    detail: 'Opaque moulded panels with a wide radius and a soft drop, lit from above.',
  },
  {
    id: 'neu',
    label: 'Neumorphic',
    blurb: 'Panels pressed out of the page itself. Quietest, and the least tolerant of a busy screen.',
    detail: 'One ground, extruded and inset by light and shadow rather than by lines.',
  },
];

export const DEFAULT_MODE = 'dark';
export const DEFAULT_SURFACE = 'glass';

/** The key the mode has always lived under. Kept, so nobody loses their choice. */
export const MODE_KEY = 'insight.theme';
export const SURFACE_KEY = 'insight.surface';

export const isMode = (value) => MODES.some((m) => m.id === value);
export const isSurface = (value) => SURFACES.some((s) => s.id === value);

export const surfaceInfo = (id) => SURFACES.find((s) => s.id === id) || SURFACES[0];

/** Whatever was stored, as something the rest of the app can rely on. */
export function normalizeAppearance({ mode, surface } = {}) {
  return {
    mode: isMode(mode) ? mode : DEFAULT_MODE,
    surface: isSurface(surface) ? surface : DEFAULT_SURFACE,
  };
}

/**
 * The attributes `<html>` should carry for an appearance.
 *
 * `null` means remove the attribute rather than set it to a value — dark and
 * glass are the defaults the stylesheet is written against, so a page with
 * neither attribute is already correct. That is what lets the blocking script
 * do nothing at all in the common case.
 */
export function appearanceAttributes({ mode, surface } = {}) {
  const settled = normalizeAppearance({ mode, surface });
  return {
    'data-theme': settled.mode === 'light' ? 'light' : null,
    'data-surface': settled.surface === DEFAULT_SURFACE ? null : settled.surface,
  };
}

/**
 * Runs before first paint, as a string.
 *
 * It has to execute synchronously in the document head: deciding this in a
 * React effect paints the default and then snaps to the stored choice, which is
 * the flash every themed app is judged by. Written against the same constants
 * as everything else so a renamed key cannot silently stop applying.
 */
export const APPEARANCE_SCRIPT = `(function(){try{
var d=document.documentElement;
var m=localStorage.getItem('${MODE_KEY}');
var s=localStorage.getItem('${SURFACE_KEY}');
if(m==='light')d.setAttribute('data-theme','light');
if(s==='clay'||s==='neu')d.setAttribute('data-surface',s);
}catch(e){}})();`;

/** What is stored right now. Safe on the server, and in a browser that refuses storage. */
export function readAppearance() {
  if (typeof window === 'undefined') return normalizeAppearance({});
  try {
    return normalizeAppearance({
      mode: window.localStorage.getItem(MODE_KEY),
      surface: window.localStorage.getItem(SURFACE_KEY),
    });
  } catch {
    return normalizeAppearance({});
  }
}

/** What the document is currently showing, which is the truth the button follows. */
export function currentAppearance() {
  if (typeof document === 'undefined') return normalizeAppearance({});
  const root = document.documentElement;
  return normalizeAppearance({
    mode: root.getAttribute('data-theme'),
    surface: root.getAttribute('data-surface'),
  });
}

/**
 * Put an appearance into effect and remember it.
 *
 * The attributes go on first and the write to storage is allowed to fail: a
 * private window that refuses localStorage should still get the look it asked
 * for, just not keep it.
 */
export function applyAppearance(next) {
  const settled = normalizeAppearance(next);
  if (typeof document !== 'undefined') {
    const root = document.documentElement;
    for (const [attribute, value] of Object.entries(appearanceAttributes(settled))) {
      if (value === null) root.removeAttribute(attribute);
      else root.setAttribute(attribute, value);
    }
  }
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(MODE_KEY, settled.mode);
      window.localStorage.setItem(SURFACE_KEY, settled.surface);
    } catch {
      /* private browsing — the choice just will not persist */
    }
    // So a second copy of the app in another tab, and the sidebar toggle beside
    // the settings panel, both follow without a reload.
    window.dispatchEvent(new CustomEvent('insight:appearance', { detail: settled }));
  }
  return settled;
}
