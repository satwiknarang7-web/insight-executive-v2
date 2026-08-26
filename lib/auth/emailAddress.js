/**
 * Is this an address a message could actually reach?
 *
 * Three questions, and it matters that they are separate, because only two of
 * them can be answered here:
 *
 *   1. **Is it a well-formed address?** Answered below, strictly. The regex the
 *      app used before — something, an @, something with a dot — accepts
 *      `..@a.b`, `a@-x.com` and `a@b.123`, none of which any mail server will
 *      take. A form that accepts them tells the user their address was fine and
 *      then silently never delivers.
 *   2. **Can that domain receive mail at all?** Answered by DNS, in
 *      `mailDomain.server.js`, because it needs the network.
 *   3. **Does the mailbox exist?** Cannot honestly be answered by either. The
 *      only way to ask is to open an SMTP session against the recipient's
 *      server, and mail providers deliberately lie in response to that (and
 *      blocklist whoever keeps asking). What answers it here is the thing that
 *      was already in place: a code is emailed and has to be typed back, so an
 *      address nobody can read never becomes an account.
 *
 * So this module's job is to reject what provably cannot work and to catch the
 * typo that causes almost all of the rest, before an account is created and a
 * code is sent into the void.
 *
 * Pure: no imports, no network, no side effects.
 */

/** RFC 5321: the local part is at most 64 octets, the whole address 254. */
const MAX_LOCAL = 64;
const MAX_TOTAL = 254;

/** Characters RFC 5322 allows unquoted in a local part. */
const LOCAL_CHARS = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~.-]+$/;

/** One domain label: letters, digits and inner hyphens, up to 63 characters. */
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * What is wrong with this address, in a sentence, or null when nothing is.
 *
 * Deliberately specific. "Enter a valid email address" is what the form said
 * before, and it is the least useful thing it could say to someone staring at
 * an address that looks right to them.
 */
export function emailProblem(email) {
  const value = String(email ?? '').trim();
  if (!value) return 'Enter your email address.';
  if (/\s/.test(value)) return 'An email address cannot contain spaces.';
  if (value.length > MAX_TOTAL) return 'That address is too long to be real.';

  const at = value.lastIndexOf('@');
  if (at < 0) return 'An email address needs an @ — for example name@company.com.';
  if (value.indexOf('@') !== at) return 'An email address has only one @.';

  const local = value.slice(0, at);
  const domain = value.slice(at + 1).toLowerCase();

  if (!local) return 'There is nothing before the @.';
  if (local.length > MAX_LOCAL) return 'The part before the @ is too long.';
  if (!LOCAL_CHARS.test(local)) return 'The part before the @ contains a character that is not allowed.';
  if (local.startsWith('.') || local.endsWith('.')) return 'The part before the @ cannot start or end with a dot.';
  if (local.includes('..')) return 'The part before the @ has two dots in a row.';

  if (!domain) return 'There is nothing after the @.';
  if (domain.includes('..')) return 'The domain has two dots in a row.';
  if (domain.startsWith('.') || domain.endsWith('.')) return 'The domain cannot start or end with a dot.';

  const labels = domain.split('.');
  if (labels.length < 2) return `“${domain}” is not a complete domain — it needs a suffix, like .com.`;
  for (const label of labels) {
    if (!LABEL.test(label)) return `“${domain}” is not a valid domain name.`;
  }

  const tld = labels[labels.length - 1];
  if (tld.length < 2) return `“${domain}” is not a valid domain name.`;
  if (!/^[a-z]{2,}$/.test(tld)) return `“.${tld}” is not a real domain suffix.`;

  return null;
}

/** The domain half of an address, lower-cased, or null when there is not one. */
export function domainOf(email) {
  const value = String(email ?? '').trim().toLowerCase();
  const at = value.lastIndexOf('@');
  return at > 0 && at < value.length - 1 ? value.slice(at + 1) : null;
}

/**
 * Domains people mistype often enough to be worth catching.
 *
 * Kept to the handful that carry most consumer sign-ups. Every entry is a claim
 * about what someone meant, so the list stays short: a wrong guess here is more
 * annoying than no guess at all, which is why this only ever *suggests*.
 */
const COMMON_DOMAINS = [
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'yahoo.com',
  'yahoo.co.uk',
  'icloud.com',
  'me.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
  'msn.com',
  'gmx.com',
  'zoho.com',
];

/**
 * Damerau–Levenshtein distance: edits, including a transposition as one.
 *
 * Transpositions matter more than the extra code costs — "gmial.com" is two
 * substitutions to plain Levenshtein and one swap to a human, and it is the
 * single most common way the word is mistyped.
 */
export function editDistance(a, b) {
  const s = String(a);
  const t = String(b);
  if (s === t) return 0;
  if (!s.length) return t.length;
  if (!t.length) return s.length;

  const rows = [];
  for (let i = 0; i <= s.length; i++) rows.push(new Array(t.length + 1).fill(0));
  for (let i = 0; i <= s.length; i++) rows[i][0] = i;
  for (let j = 0; j <= t.length; j++) rows[0][j] = j;

  for (let i = 1; i <= s.length; i++) {
    for (let j = 1; j <= t.length; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && s[i - 1] === t[j - 2] && s[i - 2] === t[j - 1]) {
        rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + cost);
      }
    }
  }
  return rows[s.length][t.length];
}

/**
 * "Did you mean …?" for an address whose domain is nearly a common one.
 *
 * Returns the corrected address, or null when the domain is already one of
 * them, is nothing like one of them, or is ambiguous between two. Never a
 * rejection: plenty of real domains sit one character from a famous one, and a
 * company called `gmai.com` should be able to sign up.
 */
export function suggestEmail(email) {
  const domain = domainOf(email);
  if (!domain || COMMON_DOMAINS.includes(domain)) return null;

  // Only worth guessing when the shape is already close; "acme.com" is four
  // edits from "gmail.com" and means nothing of the sort.
  const tolerance = domain.length <= 8 ? 1 : 2;
  let best = null;
  let bestDistance = Infinity;
  let tied = false;

  for (const candidate of COMMON_DOMAINS) {
    const distance = editDistance(domain, candidate);
    if (distance > tolerance) continue;
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
      tied = false;
    } else if (distance === bestDistance) {
      tied = true;
    }
  }

  if (!best || tied) return null;
  const local = String(email).trim().slice(0, String(email).trim().lastIndexOf('@'));
  return `${local}@${best}`;
}
