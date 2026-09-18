/**
 * Where a `next` parameter is allowed to send somebody.
 *
 * Two places take this parameter and both hand out a session around it: the
 * sign-in page, which reads it so the middleware can return somebody to the
 * page it turned them away from, and the OAuth callback, which reads it after
 * exchanging a code for real session cookies. Each had its own copy of the
 * rule, which is one copy too many for a check whose failure mode is handing
 * a freshly authenticated person to whatever site asked for them.
 *
 * A relative path only. The case worth naming is the protocol-relative URL:
 * `//evil.example/x` passes any test that only asks whether the string starts
 * with a slash, and a browser resolves it to another origin.
 *
 * Deliberately not `new URL(raw, origin)` and a host comparison. That parses
 * far more shapes than this needs to accept, and every shape it accepts is one
 * more thing to be right about; a leading single slash is the whole of what a
 * route in this app looks like.
 */
export const DEFAULT_TARGET = '/home';

export function safeNext(raw, fallback = DEFAULT_TARGET) {
  if (typeof raw !== 'string') return fallback;
  if (!raw.startsWith('/')) return fallback;
  if (raw.startsWith('//')) return fallback;
  return raw;
}
