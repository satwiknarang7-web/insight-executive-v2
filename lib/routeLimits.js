/**
 * How often one person may call the routes that cost something to serve.
 *
 * Everything here is a *spend* control, not a security control. The routes below
 * already sit behind the sign-in check; what they lacked was any ceiling on how
 * often a signed-in caller could ask for work that bills a third party or ties
 * up a process:
 *
 *   /api/narrate            a model call, per analysis run
 *   /api/ask, /api/measure  a model call, per question
 *   /api/speech             ElevenLabs synthesis, per slide narrated
 *   /api/export/pdf         headless Chrome, up to 60 seconds
 *   share with notify       headless Chrome, then SMTP
 *   /api/connect            an outbound database connection and a query
 *
 * A loop in a browser tab could run any of them flat out, and the bill for the
 * first five is real money.
 *
 * The numbers are sized off real use rather than guessed, and deliberately sit
 * well above it — this exists to stop a runaway loop and casual abuse, not to
 * ration normal work. A deck is around nine slides and narrating one slide is
 * one call, so 120 speech calls is roughly thirteen full presentations inside a
 * quarter of an hour. Nobody presents like that; a stuck retry does.
 *
 * Pure, so the policy can be read and tested without a request, a session or a
 * clock. The mechanism it plugs into is `lib/auth/rateLimit.js`, and the glue
 * that needs a request lives in `./routeLimits.server.js`.
 */

const FIFTEEN_MINUTES = 15 * 60 * 1000;

/**
 * Calls allowed per window, per person.
 *
 * Read them against what one session plausibly does: a handful of analysis runs,
 * a few dozen questions, a couple of presentations, a few PDFs. The expensive
 * and slow ones are tightest, because one of them costs more than a hundred of
 * the cheap ones.
 */
export const LIMITS = {
  narrate: { limit: 20, windowMs: FIFTEEN_MINUTES },
  ask: { limit: 40, windowMs: FIFTEEN_MINUTES },
  measure: { limit: 40, windowMs: FIFTEEN_MINUTES },
  speech: { limit: 120, windowMs: FIFTEEN_MINUTES },
  pdf: { limit: 10, windowMs: FIFTEEN_MINUTES },
  shareNotify: { limit: 10, windowMs: FIFTEEN_MINUTES },
  connect: { limit: 120, windowMs: FIFTEEN_MINUTES },

  /**
   * Sharing costs nothing to serve. This one is here for a different reason.
   *
   * Sharing by email tells the caller whether an address has an account — the
   * message says so in as many words, deliberately (see `resolveRecipient`).
   * That is a membership oracle, and it stays one whatever the wording says: a
   * share that lands returns 200 and one that does not returns 400, so softening
   * the message would cost a real user clarity and buy nothing.
   *
   * What can be taken away is the rate. Thirty attempts a quarter of an hour is
   * far more sharing than anyone does by hand and far too slow to walk a list
   * with, and it costs an account to try at all.
   */
  share: { limit: 30, windowMs: FIFTEEN_MINUTES },
};

/**
 * The bucket one caller counts against.
 *
 * The session's user id is the honest key: it survives a changing address, it
 * cannot be set by a header, and every route above is behind the sign-in check
 * whenever accounts are configured. Where they are not — the app runs perfectly
 * well with no Supabase at all — there is no identity to use and the address is
 * the only thing left. That fallback is weaker, and it is the same weakness the
 * auth limiter already documents: `x-forwarded-for` is a throttling key and
 * never an authorisation input.
 *
 * The two are namespaced apart so a caller cannot slip from one to the other by
 * signing out mid-window and inherit an unused allowance.
 */
export function limitKey({ bucket, userId = null, ip = null }) {
  const who = userId ? `u:${userId}` : `ip:${ip || 'unknown'}`;
  return `${who}:${bucket}`;
}

/**
 * What to tell someone who has been refused.
 *
 * Says when to come back, because a 429 with no interval leaves a caller
 * guessing — and a client that guesses usually guesses "immediately".
 */
export function refusalMessage(retryAfterSeconds) {
  const seconds = Math.max(1, Math.ceil(Number(retryAfterSeconds) || 1));
  if (seconds < 90) return `That is a lot of requests at once. Try again in ${seconds} seconds.`;
  const minutes = Math.ceil(seconds / 60);
  return `That is a lot of requests at once. Try again in ${minutes} minutes.`;
}
