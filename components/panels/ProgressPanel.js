'use client';

import { Check } from 'lucide-react';

import { useProgress } from '../../lib/store/DatasetProvider';
import { stepIndexFor } from '../../lib/progressSteps';

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

  return (
    <div className="card w-full p-5">
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <span className="label">{title || (job.kind === 'ingest' ? 'Ingesting' : 'Analysing')}</span>
        <span className="font-mono text-xs font-bold tabular-nums text-accent-400">{job.percent}%</span>
      </div>

      <div className="h-1 w-full overflow-hidden rounded-full bg-white/6">
        <div
          className="h-full rounded-full bg-accent-500 transition-[width] duration-200 ease-out"
          style={{ width: `${job.percent}%` }}
        />
      </div>

      {steps.length > 0 ? (
        <ol className="mt-4 space-y-0.5">
          {steps.map((step, i) => {
            // Everything before the current step has been passed. Once the job
            // reports 100% the last step is finished too, so nothing is left
            // spinning on a panel that is about to be replaced.
            const isDone = done || (current > -1 && i < current);
            const isActive = !done && i === current;
            return (
              <li
                key={step.id}
                className={`flex items-center gap-2.5 rounded-md px-2 py-1 text-[12px] transition-colors ${
                  isActive ? 'bg-accent-500/8 font-bold text-white/90' : ''
                } ${isDone ? 'text-white/45' : ''} ${!isDone && !isActive ? 'text-white/25' : ''}`}
              >
                <Marker done={isDone} active={isActive} />
                <span className="min-w-0 truncate">{step.label}</span>
                {/*
                  * The engine's own words for what it is doing right now.
                  *
                  * The step label is written ahead of time and stays general;
                  * this is the live stage, which is where the detail lives —
                  * "Querying: Revenue by region" under "Run the queries". They
                  * are only worth showing together when they differ.
                  */}
                {isActive && job.stage && job.stage !== step.label && (
                  <span className="ml-auto min-w-0 shrink truncate font-mono text-[10px] font-normal text-accent-400/70">
                    {job.stage}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      ) : (
        // No plan announced — an older job, or one that reports stages without
        // declaring them. Falls back to the single line this panel used to show.
        <p className="mt-3 text-sm font-semibold text-white/70">{job.stage || 'Working…'}</p>
      )}

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
      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-accent-500/15 text-accent-400">
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
