/**
 * A small fixed-window rate limiter, in memory.
 *
 * Guards the endpoints that cost something to call: password checks (which hit
 * Supabase) and code emails (which hit Gmail's quota, and someone's inbox).
 * Without it, "resend code" is an open relay pointed at any address a stranger
 * types.
 *
 * In memory, so it is per server instance and resets on deploy. That is the
 * honest limit of it: it stops casual abuse and accidental loops, not a
 * distributed attacker. The database-backed attempt counter on each challenge —
 * which no restart clears — is what actually protects a specific account.
 *
 * Pure apart from the clock, which is injectable, so the window arithmetic can
 * be tested without waiting.
 */

const buckets = new Map();

/** Entries are dropped lazily; this caps the map if that never happens. */
const MAX_KEYS = 5000;

/**
 * Take one token for `key`.
 *
 * Returns `{ allowed, remaining, retryAfterSeconds }`. Callers should treat a
 * refusal as a 429 and say when to try again, rather than failing silently.
 */
export function take(key, { limit, windowMs, now = Date.now() } = {}) {
  if (!key || !limit || !windowMs) return { allowed: true, remaining: limit ?? 0, retryAfterSeconds: 0 };

  const bucket = buckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    if (buckets.size >= MAX_KEYS) sweep(now);
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 };
  }

  if (bucket.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    };
  }

  bucket.count += 1;
  return { allowed: true, remaining: limit - bucket.count, retryAfterSeconds: 0 };
}

/** Forget a key — used after a success, so a good login clears its own strikes. */
export function reset(key) {
  buckets.delete(key);
}

/** Drop every expired bucket. */
export function sweep(now = Date.now()) {
  for (const [key, bucket] of buckets) {
    if (now >= bucket.resetAt) buckets.delete(key);
  }
}

/** Test seam: empty the store. */
export function clearAll() {
  buckets.clear();
}

/**
 * The caller's address, as well as it can be known behind a proxy.
 *
 * `x-forwarded-for` is client-controllable when nothing trusted sets it, so this
 * is a throttling key and never an authorisation input.
 */
export function clientKey(request, suffix = '') {
  const forwarded = request.headers.get('x-forwarded-for') || '';
  const ip = forwarded.split(',')[0].trim() || request.headers.get('x-real-ip') || 'unknown';
  return `${ip}:${suffix}`;
}
