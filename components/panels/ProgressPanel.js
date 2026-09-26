'use client';

import { Check } from 'lucide-react';

import { useProgress } from '../../lib/store/DatasetProvider';
import { stepIndexFor } from '../../lib/progressSteps';
import ChartPulse from '../loading/ChartPulse';

/**
 * Reads the progress context only. Because progress lives in its own context,
 * a re-render here does not touch the dashboard or any chart.
 *
 * The panel shows the engine's whole plan, not just the step it is on. One
 * stage name and a scrolling log told you the engine was alive and nothing
 * else — not which steps exist, not how many remain, not whether the slow one
 * had been passed. A file that spends twelve seconds cleaning rows looked
 * exactly like one that was stuck.
 *
 * The plan is handed over by the worker (see lib/progressSteps.js); nothing
 * about the pipeline is known here.
 */
export default function ProgressPanel({ title }) {
  const job = useProgress();
  if (!job.kind) return null;

  const steps = job.steps || [];
  const current = stepIndexFor(steps, job.stage);
  const done = job.percent >= 100;
  const active = steps[current];
  const headline = done ? 'Ready' : active?.label || job.stage || 'Working…';
  // The last few things the engine said, newest last. Keyed by position in the
  // whole log, so each new line animates in and the old ones stay put.
  const offset = Math.max(0, job.logs.length - 4);
  const feed = job.logs.slice(offset);

  return (
    <div className="card ld-rise w-full overflow-hidden p-0" role="status" aria-live="polite" aria-label={`${headline}, ${job.percent}%`}>
      <div className="flex items-center gap-5 border-b border-white/6 p-5 sm:p-6">
        <div className="hidden shrink-0 rounded-xl border border-white/6 bg-white/[0.02] p-3 text-white sm:block">
          <ChartPulse size={96} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="label mb-1.5">{title || (job.kind === 'ingest' ? 'Preparing your data' : 'Analysing')}</div>
          <div className="flex items-baseline justify-between gap-4">
            <p className="min-w-0 truncate font-display text-[22px] font-semibold leading-tight text-white/90">{headline}</p>
            <span className="shrink-0 font-mono text-[22px] font-semibold tabular-nums text-accent-400">
              {job.percent}
              <span className="text-[13px] text-white/40">%</span>
            </span>
          </div>
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/6">
            <div className="ld-progress h-full rounded-full bg-accent-500 transition-[width] duration-500 ease-out" style={{ width: `${Math.max(2, job.percent)}%` }} />
          </div>
        </div>
      </div>

      <div className="grid gap-0 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {steps.length > 0 && (
          <ol className="relative p-5 sm:p-6">
            {steps.map((step, i) => {
              const isDone = done || (current > -1 && i < current);
              const isActive = !done && i === current;
              return (
                <li key={step.id} className="relative flex items-center gap-3 py-1.5 text-[13px]">
                  {i < steps.length - 1 && (
                    <span aria-hidden="true" className={`absolute left-[7.5px] top-[22px] h-[calc(100%-10px)] w-px transition-colors duration-500 ${isDone ? 'bg-accent-400/50' : 'bg-white/10'}`} />
                  )}
                  <Marker done={isDone} active={isActive} />
                  <span className={`min-w-0 truncate transition-colors duration-300 ${isActive ? 'font-semibold text-white/90' : isDone ? 'text-white/55' : 'text-white/30'}`}>{step.label}</span>
                </li>
              );
            })}
          </ol>
        )}
        <div className={`min-w-0 border-white/6 p-5 sm:p-6 ${steps.length ? 'border-t sm:border-l sm:border-t-0' : ''}`}>
          <div className="label mb-2">Activity</div>
          {job.stage && !done && (
            <p className="mb-2 truncate font-mono text-[11.5px] text-accent-400/80">{job.stage}</p>
          )}
          <ul className="space-y-1 font-mono text-[11.5px] leading-relaxed">
            {feed.map((line, i) => (
              <li key={offset + i} className="ld-feed truncate text-white/50" style={{ opacity: 0.45 + (i / Math.max(1, feed.length - 1)) * 0.55 }}>
                <span className="text-accent-500/60">›</span> {line}
              </li>
            ))}
            {!feed.length && <li className="text-white/30">Starting…</li>}
          </ul>
        </div>
      </div>
    </div>
  );
}

/**
 * The bullet for one step: ticked, working, or waiting.
 *
 * All three are the same size and sit on the same centre line, so the labels do
 * not shift by a pixel as a step changes state — a list that twitches every
 * time something completes reads as less trustworthy than one that does not.
 */
function Marker({ done, active }) {
  if (done) {
    return (
      <span className="anim-zoom flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-accent-500/15 text-accent-400">
        <Check size={10} strokeWidth={3.5} />
      </span>
    );
  }
  if (active) {
    return (
      <span className="relative flex h-4 w-4 shrink-0 items-center justify-center">
        <span className="h-1.5 w-1.5 animate-ping rounded-full bg-accent-400 opacity-80" />
        <span className="absolute h-1.5 w-1.5 rounded-full bg-accent-400" />
      </span>
    );
  }
  return (
    <span className="flex h-4 w-4 shrink-0 items-center justify-center">
      <span className="h-1.5 w-1.5 rounded-full border border-white/20" />
    </span>
  );
}
