'use client';

import { useProgress } from '../../lib/store/DatasetProvider';

/**
 * Reads the progress context only. Because progress lives in its own context,
 * a re-render here does not touch the dashboard or any chart.
 */
export default function ProgressPanel({ title }) {
  const job = useProgress();
  if (!job.kind) return null;

  return (
    <div className="card w-full p-5">
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <span className="label">{title || (job.kind === 'ingest' ? 'Ingesting' : 'Analysing')}</span>
        <span className="font-mono text-xs font-bold text-accent-400">{job.percent}%</span>
      </div>

      <div className="h-1 w-full overflow-hidden rounded-full bg-white/6">
        <div
          className="h-full rounded-full bg-accent-500 transition-[width] duration-200 ease-out"
          style={{ width: `${job.percent}%` }}
        />
      </div>

      <p className="mt-3 text-sm font-semibold text-white/70">{job.stage || 'Working…'}</p>

      {job.logs.length > 0 && (
        <div className="mt-4 max-h-32 overflow-y-auto rounded-lg border border-white/6 code-surface p-3 font-mono text-[11px] leading-relaxed">
          {job.logs.map((line, i) => (
            <div key={i}>
              <span className="text-accent-500/60">›</span> {line}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
