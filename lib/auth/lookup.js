/**
 * Finding one user in a paginated admin API.
 *
 * GoTrue's admin interface has no get-by-email and no server-side filter, so
 * the only way to answer "is there an account for this address" is to walk the
 * pages. That walk is the whole of this module, kept apart from
 * `accounts.server.js` because that file cannot be imported outside Next — and
 * an off-by-one here is invisible until a project passes its first page of
 * users, which is exactly the kind of bug a test should be catching instead.
 */

/** How many users one admin page holds. The API's maximum. */
export const PAGE_SIZE = 200;

/** A ceiling on the walk, so one lookup cannot turn into a crawl. */
export const MAX_PAGES = 50;

/**
 * Walk `api.listUsers` until the address turns up.
 *
 * Stops early on a short page — that is the last page, and asking for the next
 * one costs a round trip to learn nothing. Returns null on any API error rather
 * than throwing, because every caller treats "not found" and "could not look"
 * the same way: refuse, and say nothing that distinguishes the two to a
 * stranger typing addresses into the form.
 */
export async function findUserInPages(api, email, { pageSize = PAGE_SIZE, maxPages = MAX_PAGES } = {}) {
  const needle = String(email || '').trim().toLowerCase();
  if (!needle || !api?.listUsers) return null;

  for (let page = 1; page <= maxPages; page++) {
    const { data, error } = await api.listUsers({ page, perPage: pageSize });
    if (error) return null;

    const users = data?.users || [];
    const match = users.find((u) => String(u.email || '').toLowerCase() === needle);
    if (match) return match;
    if (users.length < pageSize) return null;
  }
  return null;
}
