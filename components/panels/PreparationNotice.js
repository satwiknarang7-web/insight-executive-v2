'use client';

import Link from 'next/link';
import { Sparkles } from 'lucide-react';
import { describePreparation } from '../../lib/preparation';
import { describeTransform } from '../../lib/transforms';

/**
 * What the analyst did to the table before the charts were built, said on the
 * page where the charts are.
 *
 * A margin column that did not exist in the file is now in three findings, and
 * a reader who did not watch the progress panel has no way to know that unless
 * this says so. It says what was added, what was left for them to decide, and
 * where to go to change either.
 */
export default function PreparationNotice({ preparation, className = '' }) {
  if (!preparation) return null;
  const { applied = [], suggested = [], measures = [], summary = '' } = preparation;
  const line = describePreparation({ applied, suggested, measures });
  if (!line) return null;

  return (
    <div className={`mb-6 rounded-2xl border border-accent-500/20 bg-accent-500/[0.05] p-4 ${className}`}>
      <div className="flex items-start gap-3">
        <Sparkles size={15} className="mt-0.5 shrink-0 text-accent-400" />
        <div className="min-w-0 flex-1 text-[13px] leading-relaxed text-white/70">
          <span className="font-bold text-white/85">{line}</span>
          {summary && <span className="ml-1 text-white/50">{summary}</span>}
          {(applied.length > 0 || measures.length > 0) && (
            <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-white/50">
              {applied.map((s) => (
                <li key={s.id} title={s.why || ''}>
                  + {describeTransform(s)}
                </li>
              ))}
              {measures.map((m) => (
                <li key={m.id || m.name} title={m.explanation || ''}>
                  Σ {m.name}
                </li>
              ))}
            </ul>
          )}
          <div className="mt-2 text-[12px]">
            <Link href="/explore" className="font-bold text-accent-300 hover:text-accent-200">
              Review the steps in Explore
            </Link>
            <span className="text-white/35"> — every one shows the query it became, and any can be turned off.</span>
          </div>
        </div>
      </div>
    </div>
  );
}
