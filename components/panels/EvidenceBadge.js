'use client';

import { ShieldCheck, ShieldAlert, ShieldQuestion, Shield } from 'lucide-react';

/**
 * How much a finding rests on, in the reader's words rather than the engine's.
 *
 * `lib/insightEngine.js` has always computed a tier and the reasons behind it,
 * and nothing rendered either — so the one claim the product makes, that this
 * is an analysis you can defend, was the one thing a reader could not see.
 * The internal tokens never reach the page: "thin" is a judgement about the
 * data, and "Not enough data yet" is what that judgement means.
 */

export const EVIDENCE_TIERS = {
  strong: { label: 'Strong evidence', tone: 'emerald' },
  moderate: { label: 'Moderate evidence', tone: 'accent' },
  indicative: { label: 'Indicative only', tone: 'amber' },
  thin: { label: 'Not enough data yet', tone: 'rose' },
};

// The 200 step, not the 300: light mode re-points these tokens at dark ink, and
// only the 200s clear 4.5:1 on the pale tint the badge sits on. In dark mode
// they are the palest shade of each hue, which is what a chip wants anyway.
const TONES = {
  emerald: 'border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-200',
  accent: 'border-accent-500/30 bg-accent-500/[0.06] text-accent-200',
  amber: 'border-amber-500/30 bg-amber-500/[0.06] text-amber-200',
  rose: 'border-rose-500/30 bg-rose-500/[0.06] text-rose-200',
};

const ICONS = { emerald: ShieldCheck, accent: Shield, amber: ShieldQuestion, rose: ShieldAlert };

export function evidenceTier(tier) {
  return EVIDENCE_TIERS[tier] || null;
}

/** The reasons as one sentence, for a `title` tooltip or a line of prose. */
export function evidenceReason(notes) {
  const list = (Array.isArray(notes) ? notes : []).filter(Boolean);
  if (list.length === 0) return '';
  return `${list.join('; ')}.`.replace(/^./, (c) => c.toUpperCase());
}

/** The compact form, for a card. */
export default function EvidenceBadge({ tier, notes, className = '' }) {
  const meta = evidenceTier(tier);
  if (!meta) return null;
  const Icon = ICONS[meta.tone];
  const reason = evidenceReason(notes);

  return (
    <span
      title={reason || undefined}
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.12em] ${TONES[meta.tone]} ${className}`}
    >
      <Icon size={10} />
      {meta.label}
    </span>
  );
}

/** The labelled form, for a page that has room to say why. */
export function EvidenceRow({ tier, notes }) {
  const meta = evidenceTier(tier);
  if (!meta) return null;
  const reason = evidenceReason(notes);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/35">Evidence</span>
      <EvidenceBadge tier={tier} notes={notes} />
      {reason && <span className="min-w-0 text-[12px] leading-relaxed text-white/45">{reason}</span>}
    </div>
  );
}
