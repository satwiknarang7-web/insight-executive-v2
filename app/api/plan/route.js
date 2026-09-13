/**
 * The signed-in account's plan: what it is, and how it changes.
 *
 * GET is what the browser asks on load so it knows which controls to draw. It
 * returns the plan and the capabilities that follow from it, so the client never
 * has to reimplement the rules — and never becomes the place they are decided.
 * Every gate is also enforced server-side; this is for what the UI *offers*, not
 * for what it is allowed to do.
 *
 * POST is the upgrade. Today it grants Pro outright, because nothing charges
 * yet — this route is the seam where a payment provider goes, and the comment
 * on the write path says so. Downgrading to free is always allowed: nobody
 * should need a support ticket to stop paying.
 */
import { NextResponse } from 'next/server';
import { FREE, PRO, normalizePlan, planInfo } from '../../../lib/plans.js';
import { currentPlan, plansEnforced, setPlan } from '../../../lib/plans.server';
import { currentUser } from '../../../lib/vault/supabase.server';

export const runtime = 'nodejs';

function describe(plan) {
  const info = planInfo(plan);
  return { plan: info.id, capabilities: info.capabilities };
}

export async function GET() {
  // No accounts on this deployment means no plans, and nothing gated. Say so
  // explicitly rather than returning "free", which the UI would paywall.
  if (!plansEnforced()) {
    return NextResponse.json({ enforced: false, ...describe(PRO) });
  }

  const user = await currentUser();
  if (!user) return NextResponse.json({ enforced: true, ...describe(FREE), signedIn: false });

  const plan = await currentPlan();
  return NextResponse.json({ enforced: true, signedIn: true, ...describe(plan) });
}

export async function POST(request) {
  if (!plansEnforced()) {
    return NextResponse.json({ error: 'Accounts are not configured on this deployment.' }, { status: 501 });
  }

  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }

  const wanted = normalizePlan(body?.plan);

  // ---------------------------------------------------------------------
  // Where payment goes.
  //
  // When there is a payment provider, an upgrade stops happening here: this
  // route creates a checkout session and returns its URL, and the provider's
  // webhook — the only party that knows money actually moved — calls
  // `setPlan(userId, PRO)`. Until then the upgrade screen is honest about
  // being free, and this grants what it asks for.
  // ---------------------------------------------------------------------
  try {
    const plan = await setPlan(user.id, wanted);
    return NextResponse.json({ enforced: true, signedIn: true, ...describe(plan) });
  } catch (error) {
    console.error('[plan]', error.message);
    return NextResponse.json({ error: 'Your plan could not be changed.' }, { status: 500 });
  }
}
