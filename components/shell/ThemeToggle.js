'use client';

/**
 * Light / dark switching.
 *
 * The theme is a single `data-theme` attribute on <html>; everything else is CSS
 * variables (see globals.css). Dark is the default and carries no attribute, so
 * a first-time visitor gets the original look with nothing applied.
 *
 * The preference is written to localStorage and re-applied by a blocking script
 * in the document head — see `ThemeScript`. Doing it in a React effect instead
 * would paint the dark theme first and then snap to light, which is the flash
 * every themed app is judged by.
 */
import { useCallback, useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';

const STORAGE_KEY = 'insight.theme';

/**
 * Runs before first paint. Kept as a plain string so it can be injected with
 * `dangerouslySetInnerHTML` in the root layout — it must execute synchronously,
 * which a normal component cannot do.
 */
export const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem('${STORAGE_KEY}');if(t==='light'){document.documentElement.setAttribute('data-theme','light');}}catch(e){}})();`;

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />;
}

export default function ThemeToggle({ compact = false }) {
  const [theme, setTheme] = useState('dark');

  // Read back what the blocking script already applied, so the button's icon
  // matches the page it is sitting on.
  useEffect(() => {
    setTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark');
  }, []);

  const toggle = useCallback(() => {
    setTheme((prev) => {
      const next = prev === 'light' ? 'dark' : 'light';
      if (next === 'light') document.documentElement.setAttribute('data-theme', 'light');
      else document.documentElement.removeAttribute('data-theme');
      try {
        window.localStorage.setItem(STORAGE_KEY, next);
      } catch {
        /* private browsing — the choice just won't persist */
      }
      return next;
    });
  }, []);

  const label = theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode';

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className={
        compact
          ? 'rounded-lg border border-white/10 p-2 text-white/45 transition-colors hover:bg-white/5 hover:text-white'
          : 'flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-white/45 transition-colors hover:bg-white/5 hover:text-white'
      }
    >
      {theme === 'light' ? <Moon size={14} /> : <Sun size={14} />}
      {!compact && <span>{theme === 'light' ? 'Dark' : 'Light'}</span>}
    </button>
  );
}
