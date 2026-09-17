'use client';

/**
 * The light / dark switch, and the script that applies an appearance before
 * anything paints.
 *
 * Both the mode and the material live on `<html>` as data attributes and are
 * decided by `lib/appearance.js`; this file is the button and the injection
 * point. The button only changes the mode — the material is a bigger choice
 * with three options and a preview, and belongs in settings rather than on a
 * toggle somebody presses in passing.
 *
 * It listens for `insight:appearance` so that changing the mode in settings
 * updates the icon here without a reload, and vice versa.
 */
import { useCallback, useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { APPEARANCE_SCRIPT, applyAppearance, currentAppearance } from '../../lib/appearance';

/**
 * Runs before first paint. Kept as a plain string so it can be injected with
 * `dangerouslySetInnerHTML` in the root layout — it must execute synchronously,
 * which a normal component cannot do. Anything decided after hydration shows
 * the wrong theme for a frame on every single load.
 */
export function AppearanceScript() {
  return <script dangerouslySetInnerHTML={{ __html: APPEARANCE_SCRIPT }} />;
}

export default function ThemeToggle({ compact = false }) {
  const [mode, setMode] = useState('dark');

  // Read back what the blocking script already applied, and follow any later
  // change made from the settings panel.
  useEffect(() => {
    setMode(currentAppearance().mode);
    const follow = (event) => setMode(event.detail?.mode || currentAppearance().mode);
    window.addEventListener('insight:appearance', follow);
    return () => window.removeEventListener('insight:appearance', follow);
  }, []);

  const toggle = useCallback(() => {
    const next = currentAppearance().mode === 'light' ? 'dark' : 'light';
    // The material is read from the document rather than assumed, so switching
    // the lights does not quietly put somebody back on glass.
    applyAppearance({ ...currentAppearance(), mode: next });
    setMode(next);
  }, []);

  const label = mode === 'light' ? 'Switch to dark mode' : 'Switch to light mode';

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className={
        compact
          ? 'flex h-11 w-11 items-center justify-center rounded-lg border border-white/10 text-white/45 transition-colors hover:bg-white/5 hover:text-white sm:h-auto sm:w-auto sm:p-2'
          : 'flex min-h-11 items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-white/45 transition-colors hover:bg-white/5 hover:text-white sm:min-h-0'
      }
    >
      {mode === 'light' ? <Moon size={14} /> : <Sun size={14} />}
      {!compact && <span>{mode === 'light' ? 'Dark' : 'Light'}</span>}
    </button>
  );
}
