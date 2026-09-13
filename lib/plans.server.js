/**
 * The account plan, read and written on the server.
 *
 * Two rules hold everything else up:
 *
 *   1. **A plan is only ever read from the database.** Never from the request.
 *      The browser sends what it likes; if the gate believed it, the gate would
 *      be a suggestion. `currentPlan` goes to `account_plans` every time.
 *
 *   2. **A plan is only ever written by the service role**, through
 *      `svc_set_account_plan`. `account_plans` has no write policy for
 *      `authenticated`, so there is no other way in — not from the browser, and
 *      not by accident from here.
 *
 * A deployment with no Supabase configured has no accounts, and therefore no
 * plans. Nothing is gated there: it is somebody running this for themselves,
 * the same configuration `middleware.js` already treats as unlocked, and a paywall
 * on a single-user install would be a paywall against its owner.
 */
import { FREE, normalizePlan, planAllows } from './plans.js';
import { currentUser, isSupabaseConfigured, serviceClient, userClient } from './vault/supabase.server';

/**
 * Does this deployment have plans at all?
 *
 * False when there are no accounts. Callers use it to tell "free" apart from
 * "there is no such thing as a plan here", which want opposite behaviour.
 */
export function plansEnforced() {
  return isSupabaseConfigured();
}

/**
 * The signed-in user's plan, or null when plans do not apply here.
 *
 * Null means unenforced, not free. A missing row for a real account *is* free:
 * an account that predates this table, or one whose write failed, gets the
 * lesser thing rather than the greater one.
 */
export async function currentPlan() {
  if (!plansEnforced()) return null;

  const user = await currentUser();
  if (!user) return FREE;

  const supabase = await userClient();
  const { data, error } = await supabase
    .from('account_plans')
    .select('plan')
    .eq('user_id', user.id)
    .maybeSingle();

  if (error) {
    // A read that failed is not permission to proceed.
    console.warn('[plans] could not read the plan, treating as free:', error.message);
    return FREE;
  }
  return normalizePlan(data?.plan);
}

/**
 * Write a plan for a user.
 *
 * The one door, and the place a payment webhook will call when there is one.
 * Takes a user id rather than reading the session, because the caller that
 * matters most — verifying a new account — has the id before it has a session.
 */
export async function setPlan(userId, plan) {
  if (!plansEnforced()) return null;
  if (!userId) throw new Error('setPlan needs a user id.');

  const supabase = serviceClient();
  const { data, error } = await supabase.rpc('svc_set_account_plan', {
    p_user_id: userId,
    p_plan: normalizePlan(plan),
  });
  if (error) throw new Error(error.message);
  return normalizePlan(data);
}

/**
 * Is this request allowed to use `capability`?
 *
 * Returns null when it is, and a reason when it is not, so a route can do:
 *
 *     const denied = await refusedFor('model');
 *     if (denied) return NextResponse.json(denied, { status: 402 });
 */
export async function refusedFor(capability) {
  const plan = await currentPlan();
  if (plan === null) return null;
  if (planAllows(plan, capability)) return null;

  return {
    error:
      capability === 'autoAnalysis'
        ? 'Building a dashboard for you is part of the Pro plan.'
        : 'This uses a language model, which is part of the Pro plan.',
    plan,
    upgrade: true,
  };
}
