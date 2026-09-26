'use client';

/**
 * Whether the app may animate right now, for motion that JavaScript drives.
 *
 * CSS animations stop on their own under reduced motion (globals.css), but a
 * chart that draws itself or a number that counts up is decided in script,
 * and has to ask. Two things say no: the operating system's reduced-motion
 * setting, and the app's own (Settings → Display → Motion), which lives on
 * <html> as `data-motion="reduced"` (lib/preferences.js). The print page sets
 * the same attribute, so a PDF never catches a chart half drawn.
 *
 * The answer is a store rather than a one-off read, because both can change
 * while a page is open and a chart should stop animating the moment either
 * does.
 */

import { useSyncExternalStore } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

export function motionAllowed() {
  if (typeof document === 'undefined') return false;
  if (document.documentElement.getAttribute('data-motion') === 'reduced') return false;
  try {
    return !window.matchMedia?.(QUERY).matches;
  } catch {
    return true;
  }
}

function subscribe(onChange) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-motion'] });
  let media = null;
  try {
    media = window.matchMedia?.(QUERY) || null;
    media?.addEventListener?.('change', onChange);
  } catch {
    media = null;
  }
  return () => {
    observer.disconnect();
    media?.removeEventListener?.('change', onChange);
  };
}

/**
 * False on the server and during hydration — nothing animates before the page
 * is interactive, and the first client render matches the server's.
 */
export function useMotionAllowed() {
  return useSyncExternalStore(subscribe, motionAllowed, () => false);
}
