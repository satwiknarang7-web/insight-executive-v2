import 'server-only';

/**
 * The real resolver behind `mailDomain.js`.
 *
 * Nothing but wiring: the decisions — what counts as undeliverable, what counts
 * as our own failure, how long to wait — all live in the pure module beside
 * this one, where they can be tested without a network. The `server-only`
 * import is what keeps `node:dns` from being pulled into a client bundle by an
 * accidental import; it makes that a build failure rather than a runtime one.
 */
import { promises as dns } from 'node:dns';
import { mailRoute } from './mailDomain.js';

export { forgetMailDomains } from './mailDomain.js';

export function domainAcceptsMail(domain) {
  return mailRoute(domain, {
    resolveMx: (name) => dns.resolveMx(name),
    lookup: (name) => dns.lookup(name, { all: true }),
  });
}
