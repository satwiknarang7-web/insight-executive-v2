import 'server-only';

/**
 * The one line each expensive route runs before doing any work.
 *
 * Split from `./routeLimits.js` for the reason the rest of this codebase splits
 * `.server` files out: the policy — the numbers, the key, the wording — is worth
 * testing, and it cannot be if reading it drags in `next/headers` and a Supabase
 * client.
 *
 * The honest limit of this, stated plainly because it decides how much to trust
 * it: the counter lives in `lib/auth/rateLimit.js`, which is in memory and per
 * instance. On a serverless host a determined caller spread across warm
 * instances gets the limit times however many are warm. That turns "unbounded"
 * into "bounded by a small multiple", which is the whole of what it claims and
 * enough for a runaway loop or a curious user. A ceiling that holds across
 * instances needs the counter in Postgres — the `svc_challenge_*` functions are
 * the pattern to follow — and that is a migration and a deployment step, not a
 * line in a route.
 */
import { NextResponse } from 'next/server';
import { currentUser } from './vault/supabase.server';
import { clientIp, take } from './auth/rateLimit';
import { LIMITS, limitKey, refusalMessage } from './routeLimits.js';

/**
 * Charge this request against its bucket.
 *
 * Returns `null` when the caller may proceed, or the 429 to return when they
 * may not — so a route reads:
 *
 *     const refused = await enforceLimit(request, 'narrate');
 *     if (refused) return refused;
 *
 * Identifying the caller costs one `getUser()` round trip. That is worth it
 * here and nowhere else: every route this guards then spends seconds in a model,
 * a browser or a database, so the check is noise against the work it protects —
 * and keying on a session rather than an address is what makes the limit mean
 * anything at all.
 *
 * A deployment with no Supabase has no session to read. `currentUser` throws
 * there rather than returning null, so it is caught and the address is used
 * instead: an unconfigured deployment is still limited, just less precisely.
 */
export async function enforceLimit(request, bucket) {
  const policy = LIMITS[bucket];
  // A typo'd bucket name must not silently mean "no limit".
  if (!policy) throw new Error(`No rate limit is defined for "${bucket}".`);

  const user = await currentUser().catch(() => null);
  const key = limitKey({ bucket, userId: user?.id ?? null, ip: clientIp(request) });

  const result = take(key, policy);
  if (result.allowed) return null;

  return NextResponse.json(
    { error: refusalMessage(result.retryAfterSeconds), retryAfterSeconds: result.retryAfterSeconds },
    { status: 429, headers: { 'retry-after': String(result.retryAfterSeconds) } }
  );
}
