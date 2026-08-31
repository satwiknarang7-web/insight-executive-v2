import 'server-only';

/**
 * What the root portal reports.
 *
 * Counting accounts is not a single query here. GoTrue's admin interface only
 * paginates — there is no `count` endpoint and no server-side filter — which is
 * the same constraint `lookup.js` works around for finding one user by address.
 * So the pages are walked and the rows are counted, with a ceiling so one
 * request cannot turn into a crawl over an enormous project.
 *
 * Everything derived here comes from that single walk. Confirmed-versus-pending
 * and the last-seven-days figure cost nothing extra once the rows are in hand,
 * and they are the two numbers that make the total mean something: a total with
 * no split hides whether people are signing up and finishing, or signing up and
 * giving up at the code.
 */
import { serviceClient } from '../vault/supabase.server';

/** The admin API's maximum page size. */
const PAGE_SIZE = 1000;

/** A ceiling on the walk. A million accounts is not this product's problem yet. */
const MAX_PAGES = 50;

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Count the accounts, and say how the total breaks down.
 *
 * `capped` is true when the walk hit its ceiling, so the caller can say the
 * total is a floor rather than presenting a wrong number as a right one.
 */
export async function countUsers({ now = Date.now() } = {}) {
  const admin = serviceClient().auth.admin;

  let total = 0;
  let confirmed = 0;
  let recent = 0;
  let newest = null;
  let capped = false;

  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data, error } = await admin.listUsers({ page, perPage: PAGE_SIZE });
    if (error) throw new Error(error.message);

    const users = data?.users || [];
    for (const user of users) {
      total++;
      if (user.email_confirmed_at || user.confirmed_at) confirmed++;
      const created = Date.parse(user.created_at || '');
      if (Number.isFinite(created)) {
        if (now - created <= WEEK_MS) recent++;
        if (!newest || created > newest) newest = created;
      }
    }

    // A short page is the last page; asking for the next costs a round trip to
    // learn nothing.
    if (users.length < PAGE_SIZE) break;
    if (page === MAX_PAGES) capped = true;
  }

  return {
    total,
    confirmed,
    pending: total - confirmed,
    recent,
    newestAt: newest ? new Date(newest).toISOString() : null,
    capped,
  };
}
