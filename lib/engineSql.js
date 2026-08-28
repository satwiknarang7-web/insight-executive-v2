/**
 * The guard on SQL a model wrote for the in-browser engine.
 *
 * `/api/ask` turns a question into one chart backed by one query. The query is
 * executed by AlaSQL, in the browser, over rows that never left the device — so
 * unlike the connector guard this is not standing in front of somebody's
 * production database, and the honest description of the risk is low. It is
 * still worth holding to the same standard: the check is stated in the code as
 * a guard, and a guard that does not hold is worse than none, because it reads
 * as protection.
 *
 * The route used to do this itself, with two holes:
 *
 *   sql.includes(';') && !/;\s*$/.test(sql)
 *
 * only rejected a semicolon that was not at the end, so `SELECT 1; SELECT 2;`
 * passed — and it rejected `WHERE note = 'a;b'`, which is a perfectly ordinary
 * query, because it never looked inside string literals. And `INTO` was absent
 * from the forbidden list, so `SELECT * INTO XLSX('out.xlsx') FROM SalesData`
 * passed, which in AlaSQL writes a file.
 *
 * Both are already solved, correctly and with tests, by `assertReadOnlySql` in
 * the connector guard — which strips comments and quoted text before matching,
 * so a semicolon or a keyword hiding in a literal cannot fool it. This composes
 * that rather than keeping a second, weaker copy.
 */
import { assertReadOnlySql, stripLiterals, UnsafeQuery } from './connectors/guards.js';

export { UnsafeQuery };

/**
 * AlaSQL verbs that no connector dialect has, matched only where a statement
 * could actually begin.
 *
 * `ATTACH` reaches localStorage and IndexedDB; `SOURCE` and `REQUIRE` load
 * script. None of them can start the statement — the leading-SELECT check below
 * refuses that — and none can follow a semicolon, because there are none. So
 * this is defence in depth rather than the control, and it is anchored on an
 * opening parenthesis for the same reason the connector guard anchors its write
 * verbs: matched anywhere, it would reject `SELECT source FROM feeds`, and
 * `source`, `assert` and `require` are all ordinary column names.
 */
const ENGINE_VERB_IN_STATEMENT_POSITION = /\(\s*(attach|detach|source|require|assert)\b/i;

/**
 * Accept exactly one read-only SELECT for the engine, and return it ready to run.
 *
 * Throws `UnsafeQuery` with a reason the caller can show. Returns the caller's
 * own text, minus a trailing semicolon — never the comment-stripped copy, which
 * would have had its bracketed identifiers and its filters gutted.
 */
export function assertEngineSelect(sql) {
  const cleaned = assertReadOnlySql(sql);
  const bare = stripLiterals(cleaned);

  // `assertReadOnlySql` also allows WITH, which is right for a real database and
  // wrong here: the engine does not support CTEs and the prompt says so, making
  // one a sign the model ignored its instructions rather than a query to run.
  if (!/^\s*select\b/i.test(bare)) {
    throw new UnsafeQuery('Only SELECT queries are allowed.');
  }

  const engineVerb = ENGINE_VERB_IN_STATEMENT_POSITION.exec(bare);
  if (engineVerb) {
    throw new UnsafeQuery(`"${engineVerb[1].toUpperCase()}" is not allowed here.`);
  }

  return cleaned;
}
