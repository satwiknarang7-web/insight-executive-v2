/**
 * Identifier quoting, per SQL dialect.
 *
 * Table and column names cannot be passed as query parameters — only values
 * can — so they have to be interpolated, which makes correct quoting the thing
 * standing between a schema name and an injected statement. That is worth
 * having in one tested place rather than duplicated across three drivers.
 *
 * Every dialect below escapes its own closing delimiter by doubling it, which
 * is what makes a name containing that character inert rather than a way out of
 * the quotes.
 */

const DIALECTS = {
  // Postgres and friends: "double quotes", embedded " doubled.
  postgres: { open: '"', close: '"', escape: /"/g, escaped: '""' },
  supabase: { open: '"', close: '"', escape: /"/g, escaped: '""' },
  // Snowflake: "double quotes", embedded " doubled. Quoting also preserves
  // case, which matters — Snowflake folds unquoted identifiers to upper case,
  // so a table created as "Orders" is only reachable when quoted.
  snowflake: { open: '"', close: '"', escape: /"/g, escaped: '""' },
  // Oracle: "double quotes", embedded " doubled. Folds unquoted identifiers to
  // upper case, so quoting is what makes a mixed-case table reachable.
  oracle: { open: '"', close: '"', escape: /"/g, escaped: '""' },
  // MySQL: `backticks`, embedded ` doubled.
  mysql: { open: '`', close: '`', escape: /`/g, escaped: '``' },
  // SQL Server: [brackets], embedded ] doubled. The opening bracket needs no
  // escaping — only the closing one can end the identifier.
  sqlserver: { open: '[', close: ']', escape: /]/g, escaped: ']]' },
};

export function quoteIdent(dialect, name) {
  const rules = DIALECTS[dialect];
  if (!rules) throw new Error(`No quoting rules for dialect "${dialect}".`);

  const raw = String(name ?? '');
  if (raw === '') throw new Error('An identifier cannot be empty.');
  // A NUL byte terminates the string for some client libraries, which would
  // truncate the statement at that point.
  if (raw.includes('\u0000')) throw new Error('An identifier cannot contain a null byte.');

  return `${rules.open}${raw.replace(rules.escape, rules.escaped)}${rules.close}`;
}

/** A schema-qualified name, both halves quoted. */
export function quoteQualified(dialect, schema, name) {
  return `${quoteIdent(dialect, schema)}.${quoteIdent(dialect, name)}`;
}
