'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Check } from 'lucide-react';
import Logo from '../../components/shell/Logo';
import ThemeToggle from '../../components/shell/ThemeToggle';
import PlanChoice from '../../components/panels/PlanChoice';
import { usePlan } from '../../lib/store/PlanProvider';
import { PRO } from '../../lib/plans.js';

/**
 * Change the plan on this account.
 *
 * The same two cards as sign-up, for the same reason: someone deciding whether
 * to pay should be looking at the thing they saw when they decided not to.
 * Downgrading is offered here too — a plan you cannot leave from the screen you
 * joined it on is a plan people are right to be wary of.
 */
export default function UpgradePage() {
  const router = useRouter();
  const { plan, enforced, signedIn, loading, choose } = usePlan();
  const [wanted, setWanted] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  // Nobody arrives here to pick Free; Pro is the default and Free is one click.
  const selected = wanted ?? PRO;

  const apply = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await choose(selected);
      setDone(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }, [choose, selected]);

  return (
    <div className="relative min-h-screen">
      <div className="ambient-wash" />
      <div className="grid-veil" />

      <div className="relative z-10 mx-auto flex min-h-screen max-w-3xl flex-col px-6 py-8 md:px-10">
        <header className="flex items-center gap-3">
          <Link href="/" className="flex w-fit items-center gap-3">
            <Logo size="md" />
          </Link>
          <div className="ml-auto">
            <ThemeToggle />
          </div>
        </header>

        <div className="flex flex-1 flex-col justify-center py-10">
          <button
            onClick={() => router.back()}
            className="mb-6 flex w-fit items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-white/30 transition-colors hover:text-white/60"
          >
            <ArrowLeft size={13} /> Back
          </button>

          <h1 className="display anim-rise text-[27px] leading-[1.12] text-white/95 md:text-[34px]">Your plan</h1>

          {!enforced ? (
            <p className="mt-3 text-[13px] leading-relaxed text-white/45">
              This deployment has no accounts configured, so there are no plans and nothing is
              gated. Everything is available.
            </p>
          ) : !signedIn && !loading ? (
            <p className="mt-3 text-[13px] leading-relaxed text-white/45">
              <Link href="/sign-in" className="font-bold text-accent-400 hover:opacity-80">
                Sign in
              </Link>{' '}
              to see or change your plan.
            </p>
          ) : done ? (
            <div className="mt-6 flex items-start gap-3 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] p-4">
              <Check size={16} className="mt-0.5 shrink-0 text-emerald-400" />
              <div className="min-w-0">
                <div className="text-sm font-bold text-white/85">
                  You are on the {selected === PRO ? 'Pro' : 'Free'} plan.
                </div>
                <p className="mt-1 text-[12px] leading-relaxed text-white/45">
                  {selected === PRO
                    ? 'The AI features are enabled on this account. Add your own model key, load a dataset and build a report.'
                    : 'The AI features are switched off on this account. Everything the engine computes itself still works.'}
                </p>
                <Link
                  href="/"
                  className="mt-3 inline-flex items-center gap-1.5 text-[12px] font-bold text-accent-400 transition-opacity hover:opacity-80"
                >
                  Back to your data
                </Link>
              </div>
            </div>
          ) : (
            <>
              <p className="mt-3 text-[13px] leading-relaxed text-white/45">
                Everything the engine computes itself is free. What Pro adds is the analyst: the
                dashboard built for you, questions in plain English, and the writing.
              </p>
              <PlanChoice
                value={selected}
                onChange={setWanted}
                onContinue={apply}
                busy={busy}
                currentPlan={loading ? null : plan}
                ctaLabel={selected === plan ? 'Keep this plan' : 'Switch to this plan'}
              />
              {error && (
                <p className="mt-3 rounded-lg border border-rose-500/25 bg-rose-500/8 px-3 py-2 text-[12px] leading-relaxed text-rose-200">
                  {error}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
