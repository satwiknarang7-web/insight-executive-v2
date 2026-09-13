'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import { FREE, PLANS, PRO, planAllows } from '../plans.js';

const PlanContext = createContext(null);

/**
 * What this account is allowed to be offered.
 *
 * The emphasis is on *offered*. Every gate is enforced on the server, where the
 * plan is read from the database; this exists so the interface does not present
 * a button that will come back 402. A client that lied to itself here would
 * change nothing about what it can actually do.
 *
 * Three states, and they are not two:
 *
 *   - `enforced: false` — no accounts on this deployment, so no plans. Nothing
 *     is hidden. A self-hosted install must not paywall its own owner.
 *   - `enforced: true, signedIn: false` — treat as free until we know better.
 *   - `enforced: true, signedIn: true` — whatever the database says.
 *
 * Until the first answer arrives, `loading` is true and callers should not draw
 * an upgrade prompt: flashing a paywall at a paying customer for 300ms is worse
 * than showing nothing for 300ms.
 */
export function PlanProvider({ children }) {
  const pathname = usePathname();
  const [state, setState] = useState({
    loading: true,
    enforced: true,
    signedIn: false,
    plan: FREE,
    capabilities: PLANS[FREE].capabilities,
  });

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/plan', { cache: 'no-store' });
      if (!response.ok) throw new Error(String(response.status));
      const body = await response.json();
      setState({
        loading: false,
        enforced: body.enforced !== false,
        signedIn: body.signedIn === true,
        plan: body.plan || FREE,
        capabilities: body.capabilities || PLANS[FREE].capabilities,
      });
    } catch {
      // A plan we could not read is not a plan we may assume. Free is the
      // lesser grant, and the server refuses anything beyond it anyway.
      setState((prev) => ({ ...prev, loading: false, plan: FREE, capabilities: PLANS[FREE].capabilities }));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * Re-read the plan while we believe nobody is signed in.
   *
   * This provider sits in the root layout and mounts once. Signing in is a
   * client navigation — the layout does not remount — so a plan read before a
   * session existed was believed for the rest of the visit: a Pro account that
   * signed in saw the locked Pro button and an upgrade screen telling it to
   * sign in, until a hard reload. Both session boundaries now call `refresh`,
   * and this is the net under them, in case some future one forgets.
   *
   * Only in that direction. Believing Pro while actually signed out costs
   * nothing, because every gate is enforced again on the server — it is the
   * opposite mistake that locks a paying customer out of what they paid for.
   */
  useEffect(() => {
    if (state.loading || state.signedIn || !state.enforced) return;
    load();
    // `state.signedIn` is read, not depended on: including it would re-run this
    // the moment it flips true, which is the exact case it must stop for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, load]);

  /** Ask for a plan. Resolves to the plan actually in force afterwards. */
  const choose = useCallback(async (plan) => {
    const response = await fetch('/api/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body?.error || 'Your plan could not be changed.');
    setState({
      loading: false,
      enforced: body.enforced !== false,
      signedIn: body.signedIn === true,
      plan: body.plan || FREE,
      capabilities: body.capabilities || PLANS[FREE].capabilities,
    });
    return body.plan;
  }, []);

  const value = useMemo(() => {
    // An unenforced deployment can do everything; it has no plan to speak of.
    const effective = state.enforced ? state.plan : PRO;
    return {
      ...state,
      plan: effective,
      isPro: effective === PRO,
      /** The question everything else asks. Never true while still loading. */
      can: (capability) => !state.loading && planAllows(effective, capability),
      refresh: load,
      choose,
    };
  }, [state, load, choose]);

  return <PlanContext.Provider value={value}>{children}</PlanContext.Provider>;
}

export function usePlan() {
  const ctx = useContext(PlanContext);
  if (!ctx) throw new Error('usePlan must be inside PlanProvider');
  return ctx;
}
