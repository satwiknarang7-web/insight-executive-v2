/**
 * Can this domain receive mail at all?
 *
 * The check a sign-up form can actually make. Asking whether a *mailbox* exists
 * means opening an SMTP session against someone else's server and reading its
 * answer to `RCPT TO`, and the large providers deliberately answer that with
 * "yes" for everything — partly to defeat address harvesting — while
 * blocklisting whoever keeps asking. So that question is left to the
 * verification code the user has to type back, which settles it properly.
 *
 * What DNS *can* settle is whether mail could ever reach the domain, and that
 * catches the failure people actually hit: a typo in the domain.
 * `sam@gmial.com` and `sam@company.con` are not addresses anyone will ever
 * read, and saying so while they are still looking at the form is worth far
 * more than a verification email that vanishes.
 *
 * **It fails open, and that is the most important rule here.** A DNS timeout, a
 * sandbox with no resolver, a provider having a bad day — none of those are
 * evidence that an address is wrong. Refusing to create accounts because our
 * own lookup broke would be a much worse failure than letting a bad address
 * through to the code that is about to reject it anyway.
 *
 * The resolver is injected rather than imported so this file stays free of
 * `node:dns` and can be tested — the same split, and for the same reason, as
 * `lookup.js` beside it.
 */

/** Long enough for a slow resolver, short enough not to hang a sign-up. */
export const TIMEOUT_MS = 3000;

/** Answers are cached briefly: a burst of sign-ups from one company is one lookup. */
export const TTL_MS = 10 * 60 * 1000;

const cache = new Map();

function cached(domain, now) {
  const hit = cache.get(domain);
  if (!hit || hit.expires < now) {
    cache.delete(domain);
    return null;
  }
  return hit.value;
}

function remember(domain, value, now) {
  // A bounded cache: this is a long-lived server process, and an unbounded map
  // keyed by anything a stranger can type is a slow leak.
  if (cache.size > 500) cache.clear();
  cache.set(domain, { value, expires: now + TTL_MS });
  return value;
}

/** Reject rather than hang when a resolver never answers. */
function withTimeout(promise, ms) {
  if (!ms) return promise;
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('DNS_TIMEOUT')), ms)),
  ]);
}

const isMissing = (error) => error?.code === 'ENOTFOUND' || error?.code === 'NXDOMAIN';
const isEmpty = (error) => error?.code === 'ENODATA';

/**
 * Does `domain` have somewhere for mail to go?
 *
 * Returns `{ deliverable, reason }`. `deliverable` is false only when DNS says
 * positively that it is not — the name does not exist, or exists with no mail
 * route. Anything else, including our own failure to look, is true.
 */
export async function mailRoute(domain, { resolveMx, lookup, timeoutMs = TIMEOUT_MS, now = Date.now() } = {}) {
  const name = String(domain || '').trim().toLowerCase();
  if (!name) return { deliverable: false, reason: 'no domain' };
  if (!resolveMx || !lookup) return { deliverable: true, reason: 'no resolver' };

  const hit = cached(name, now);
  if (hit) return hit;

  try {
    const mx = await withTimeout(resolveMx(name), timeoutMs);
    if (Array.isArray(mx) && mx.some((r) => r?.exchange)) {
      return remember(name, { deliverable: true, reason: 'mx' }, now);
    }
  } catch (error) {
    if (isMissing(error)) return remember(name, { deliverable: false, reason: 'no such domain' }, now);
    // ENODATA means the name resolves but publishes no MX, which is not a
    // rejection: RFC 5321 says fall back to the address record. Anything else
    // is our problem, and our problems do not block sign-ups.
    if (!isEmpty(error)) return { deliverable: true, reason: `lookup failed: ${error.message}` };
  }

  // No MX. A domain with an address record still accepts mail — an implicit MX,
  // and how plenty of small self-hosted domains are set up.
  try {
    await withTimeout(lookup(name), timeoutMs);
    return remember(name, { deliverable: true, reason: 'implicit mx' }, now);
  } catch (error) {
    if (isMissing(error) || isEmpty(error)) {
      return remember(name, { deliverable: false, reason: 'no mail route' }, now);
    }
    return { deliverable: true, reason: `lookup failed: ${error.message}` };
  }
}

/** Drop every cached answer. Tests, and anything that needs a clean slate. */
export function forgetMailDomains() {
  cache.clear();
}
