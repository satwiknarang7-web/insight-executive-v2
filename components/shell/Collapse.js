'use client';

import { ChevronRight } from 'lucide-react';

/**
 * Show or hide a section, without pretending to be a heading.
 *
 * Lived in the dashboard until Explore grew two sections of its own. A page
 * that holds the columns, the shaping, the measures and the rows needs every
 * one of them to get out of the way, and three copies of this button would
 * have drifted apart on the label or the rotation.
 */
export default function Collapse({ open, onToggle, label }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-label={`${open ? 'Hide' : 'Show'} ${label}`}
      className="flex min-h-11 shrink-0 items-center gap-1 rounded-lg border border-white/10 px-3 py-1 text-[9px] font-black uppercase tracking-[0.18em] text-white/35 transition-colors hover:bg-white/5 hover:text-white/70 sm:min-h-0 sm:px-2"
    >
      {open ? 'Hide' : 'Show'}
      <ChevronRight size={12} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
    </button>
  );
}
