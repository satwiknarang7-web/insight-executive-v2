'use client';

import { useState } from 'react';
import { AlertTriangle, Scissors, Layers, GitBranch, Sigma, Calculator, Minus, Filter, X, Eraser, Columns3, SpellCheck } from 'lucide-react';

/**
 * What the ingest decided on the user's behalf, said out loud.
 *
 * The worker has always pushed these — a skipped sheet, a stripped totals row,
 * an ambiguous relationship, a capped table — onto `dataset.notices`, and
 * nothing on the client ever read the array. That is the worst kind of silence:
 * the app knew the number on screen was partial and let it be read as whole.
 */

const ICONS = {
  truncated: Scissors,
  'sheet-skipped': Layers,
  'totals-removed': Sigma,
  'many-to-many': GitBranch,
  'measure-excluded': Calculator,
  'negative-values': Minus,
  'rows-excluded': Filter,
  'rows-included': AlertTriangle,
  'preamble-skipped': Eraser,
  'columns-empty': Columns3,
  'values-unified': SpellCheck,
};

const HEADINGS = {
  truncated: 'Only part of this table was read',
  'sheet-skipped': 'A sheet was skipped',
  'totals-removed': 'Totals rows were removed',
  'many-to-many': 'A relationship is ambiguous',
  'measure-excluded': 'Some columns are never totalled',
  'negative-values': 'A quantity goes below zero',
  'rows-excluded': 'Some rows are left out of every figure',
  'rows-included': 'Void rows are counted in every figure',
  'preamble-skipped': 'Lines above the header were skipped',
  'columns-empty': 'Empty columns were removed',
  'values-unified': 'Spellings of a category were folded together',
};

const noticeIcon = (kind) => ICONS[kind] || AlertTriangle;

export default function DatasetNotices({ notices, dismissible = true, className = '' }) {
  // Dismissal is per-mount and applies only to the quiet ones. A capped table
  // is never dismissible: hiding it would put every total below back into the
  // state this component exists to end.
  const [dismissed, setDismissed] = useState(false);

  const list = Array.isArray(notices) ? notices.filter((n) => n && n.message) : [];
  if (list.length === 0) return null;

  // The loud block is for notices that change what a figure MEANS: a table read
  // only in part, and void rows counted as revenue because somebody asked. Both
  // are states where a number on screen is not the number its label claims, so
  // neither can be dismissed out of the way.
  const LOUD = new Set(['truncated', 'rows-included']);
  const capped = list.filter((n) => LOUD.has(n.kind));
  const rest = list.filter((n) => !LOUD.has(n.kind));

  return (
    <div className={className}>
      {capped.length > 0 && (
        <div className="mb-4 rounded-2xl border border-amber-500/40 bg-amber-500/[0.10] p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-400" />
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-black uppercase tracking-[0.2em] text-amber-300">
                {capped.length === 1 ? HEADINGS[capped[0].kind] || HEADINGS.truncated : 'Read this before quoting a figure'}
              </div>
              <ul className="mt-2 flex flex-col gap-1.5">
                {capped.map((n, i) => (
                  <li key={i} className="text-[13px] leading-relaxed text-white/80">
                    {n.message}
                    <NoticeAction action={n.action} />
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {rest.length > 0 && !dismissed && (
        <div className="mb-4 rounded-2xl border border-amber-500/25 bg-amber-500/[0.06] p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-400" />
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-black uppercase tracking-[0.2em] text-amber-300">
                {rest.length === 1 ? 'One decision was made while reading your data' : `${rest.length} decisions were made while reading your data`}
              </div>
              <ul className="mt-2 flex flex-col gap-1.5">
                {rest.map((n, i) => {
                  const Icon = noticeIcon(n.kind);
                  return (
                    <li key={i} className="flex gap-2 text-[13px] leading-relaxed text-white/70">
                      <Icon size={13} className="mt-1 shrink-0 text-amber-400/70" />
                      <span className="min-w-0">
                        <span className="sr-only">{HEADINGS[n.kind] || 'Notice'}: </span>
                        {n.message}
                        <NoticeAction action={n.action} />
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
            {dismissible && (
              <button
                type="button"
                onClick={() => setDismissed(true)}
                aria-label="Hide these notices"
                title="Hide these notices"
                className="-m-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-white/30 transition-colors hover:bg-white/5 hover:text-white/70"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The way out of a decision the app made for you.
 *
 * A notice that states a choice without offering the other one is not a
 * disclosure, it is an apology. Rendered inline after the sentence it belongs
 * to, so the explanation and the control are one thing rather than a message
 * here and a setting three screens away.
 */
function NoticeAction({ action }) {
  if (!action?.label || typeof action.onClick !== 'function') return null;
  return (
    <button
      type="button"
      onClick={action.onClick}
      disabled={!!action.busy}
      className="ml-2 inline-flex min-h-[32px] items-center rounded-lg border border-amber-400/40 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-amber-200 transition-colors hover:bg-amber-400/10 disabled:opacity-40"
    >
      {action.busy ? 'Re-running…' : action.label}
    </button>
  );
}
