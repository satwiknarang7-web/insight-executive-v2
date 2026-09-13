'use client';

import { ArrowRight, Check, Loader2, Minus } from 'lucide-react';
import { FREE, PLAN_IDS, PLANS, PRO } from '../../lib/plans.js';

/**
 * The two plans, side by side, as a choice rather than a pitch.
 *
 * Used twice: once in sign-up, where it is the first question asked, and once
 * on the upgrade screen, where it is the only one. Both read the same
 * `lib/plans.js`, so what a plan claims here and what the server actually
 * allows cannot drift apart.
 *
 * What Free does *not* include is listed as plainly as what it does. A plan
 * card that only lists upsides leaves the reader to discover the limit later,
 * which is the moment they stop trusting the rest of the page.
 */
export default function PlanChoice({
  value = FREE,
  onChange,
  onContinue,
  busy = false,
  currentPlan = null,
  ctaLabel = 'Continue',
}) {
  return (
    <div className="mt-6 flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {PLAN_IDS.map((id) => {
          const plan = PLANS[id];
          const selected = value === id;
          const isCurrent = currentPlan === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onChange?.(id)}
              aria-pressed={selected}
              className={`flex flex-col rounded-xl border p-4 text-left transition-colors ${
                selected
                  ? 'border-accent-500/60 bg-accent-500/[0.07]'
                  : 'border-white/10 bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.04]'
              }`}
            >
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-black text-white/90">{plan.name}</span>
                {id === PRO && (
                  <span className="rounded-full border border-accent-500/30 bg-accent-500/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.15em] text-accent-400">
                    AI
                  </span>
                )}
                {isCurrent && (
                  <span className="rounded-full border border-white/12 bg-white/[0.04] px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.15em] text-white/40">
                    Current
                  </span>
                )}
                <span className="ml-auto shrink-0 text-sm font-black tabular-nums text-white/85">
                  {plan.price}
                  <span className="text-[11px] font-bold text-white/35">{plan.cadence}</span>
                </span>
              </div>

              <p className="mt-1.5 text-[12px] leading-relaxed text-white/45">{plan.tagline}</p>

              <ul className="mt-3 flex flex-col gap-1.5">
                {plan.includes.map((line) => (
                  <li key={line} className="flex gap-2 text-[12px] leading-relaxed text-white/60">
                    <Check size={13} className="mt-0.5 shrink-0 text-accent-400" />
                    <span>{line}</span>
                  </li>
                ))}
                {plan.excludes.map((line) => (
                  <li key={line} className="flex gap-2 text-[12px] leading-relaxed text-white/25">
                    <Minus size={13} className="mt-0.5 shrink-0 text-white/20" />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </button>
          );
        })}
      </div>

      {onContinue && (
        <button
          type="button"
          onClick={onContinue}
          disabled={busy}
          className="mt-1 flex items-center justify-center gap-2 rounded-xl bg-accent-500 px-4 py-3 text-xs font-black uppercase tracking-[0.2em] text-on-accent transition-colors hover:bg-accent-400 disabled:opacity-40"
        >
          {busy && <Loader2 size={14} className="animate-spin" />}
          {ctaLabel} <ArrowRight size={14} />
        </button>
      )}

      {/* Said on the screen where someone decides, not in a footnote after. */}
      <p className="text-center text-[11px] leading-relaxed text-white/25">
        Pro is not charged yet while billing is being set up — choosing it here enables the AI
        features on your account.
      </p>
    </div>
  );
}
