/**
 * Usernames, and what someone typed into a "share with" box.
 *
 * Kept apart from `analyses.server.js` for the same reason `auth/lookup.js` is
 * kept apart from `accounts.server.js`: that file imports `server-only` and so
 * cannot be loaded by the test runner, and these rules are exactly the kind
 * that should be tested directly rather than inferred from a failing share.
 *
 * Pure: no database, no session, no imports.
 */

/** A username is lower-case, short, and unambiguous to type. */
export function normalizeHandle(raw) {
  const value = String(raw ?? '')
    .trim()
    .replace(/^@/, '')
    .toLowerCase();
  return /^[a-z0-9_]{3,24}$/.test(value) ? value : null;
}

/**
 * Suggest a username from an email address.
 *
 * Only ever a starting point shown in a form — never assigned silently, because
 * a username is how other people will refer to you and that should be a choice.
 */
export function suggestHandle(email) {
  const base = String(email || '')
    .split('@')[0]
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 24);
  return base.length >= 3 ? base : `user_${Math.random().toString(36).slice(2, 8)}`;
}

/** Does this read as an email address rather than a username? */
export function isEmailAddress(raw) {
  const value = String(raw ?? '').trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/**
 * Work out what the person typed into the share box.
 *
 * Both are legitimate ways to name someone: a username is the public name they
 * chose, an email address is what you already have in your contacts and the
 * only thing you can use for a colleague who has not picked a username yet.
 * Deciding which is which here means no caller has to guess — and, importantly,
 * an address that is nearly-but-not-quite valid is refused as an address rather
 * than being mangled into an invalid username and reported as one, which is a
 * confusing thing to be told when you clearly typed an address.
 */
export function parseRecipient(raw) {
  const value = String(raw ?? '').trim();
  if (!value) return { kind: 'none' };
  if (isEmailAddress(value)) return { kind: 'email', value: value.toLowerCase() };
  // An @ that survived the username rules is a half-typed address.
  if (value.replace(/^@/, '').includes('@')) return { kind: 'bad-email', value };
  const handle = normalizeHandle(value);
  return handle ? { kind: 'handle', value: handle } : { kind: 'bad-handle', value };
}
