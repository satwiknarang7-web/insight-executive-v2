/**
 * The dashboard's toolbar buttons: Edit, Add chart, Fields & measures, Save
 * and Rebuild.
 *
 * They were drawn as 65% text in a 10% outline with no fill, which is how this
 * app draws a button it wants to recede — and on Clay, which removes faint
 * outlines, they were barely there at all. These are the controls a person
 * comes to the dashboard to use, so they read as buttons: Edit, the way in,
 * is solid accent; the rest carry a fill, an outline strong enough to survive
 * every material, full-strength text and an accent icon.
 */
const BASE =
  'flex h-9 items-center gap-2 rounded-lg px-3.5 text-[13px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50';

export const PRIMARY_ACTION = `${BASE} bg-accent-500 text-on-accent shadow-[var(--glow)] hover:bg-accent-400`;

export const SECONDARY_ACTION = `${BASE} border border-white/20 bg-white/[0.06] text-white/90 hover:border-accent-400/50 hover:bg-white/[0.1] hover:text-white`;

/** A secondary action that is switched on — a panel it opened is showing. */
export const ACTIVE_ACTION = `${BASE} border border-accent-400/60 bg-accent-400/15 text-accent-300`;

/** The icon inside a secondary action. */
export const ACTION_ICON = 'shrink-0 text-accent-400';
