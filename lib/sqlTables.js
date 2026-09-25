/**
 * The SQL side of the engine worker: the loaded tables mounted in alasql
 * under stable names, for the data table page, the SQL console, the
 * transforms (which are compiled to SQL) and the join model. The dashboard
 * itself does not use SQL — see lib/engine/query.js.
 */

import alasql from 'alasql';
import { registerEngineFunctions } from './engineFunctions.js';

// Every query the engine runs sees the same null-safe function set. Done once,
// here, because this is the one module everything that touches alasql imports.
registerEngineFunctions(alasql);

/**
 * The name the analysis view is always mounted under.
 *
 * Every planned and LLM-written query targets this one name. With a multi-sheet
 * workbook it is the joined view built by `lib/dataModel.js`; with a single
 * sheet it is that sheet. Keeping the name fixed is what lets the planner, the
 * insight engine and every previously saved analysis stay oblivious to joins.
 */
export const TABLE = 'SalesData';

/** Load rows into alasql under a stable table name. */
export function mountTable(rows, table = TABLE) {
  try {
    alasql(`DROP TABLE IF EXISTS [${table}]`);
  } catch {
    /* table did not exist */
  }
  alasql(`CREATE TABLE [${table}]`);
  alasql.tables[table].data = rows;
}

export function unmountTable(table = TABLE) {
  try {
    alasql(`DROP TABLE IF EXISTS [${table}]`);
  } catch {
    /* already gone */
  }
}

/**
 * Mount the whole model: every source sheet under its own name, plus the joined
 * analysis view under `TABLE`.
 *
 * The named sheets exist so the SQL console and the Ask page can write genuine
 * multi-table joins; the view exists so the automated pipeline doesn't have to.
 * Returns the list of mounted names so the caller can unmount exactly those.
 */
export function mountTables({ tables = {}, view = null, viewName = TABLE } = {}) {
  const mounted = [];
  for (const [name, rows] of Object.entries(tables)) {
    if (name === viewName) continue; // the view owns that name
    mountTable(rows, name);
    mounted.push(name);
  }
  if (view) {
    mountTable(view, viewName);
    mounted.push(viewName);
  }
  return mounted;
}

export function unmountTables(names = []) {
  for (const name of names) unmountTable(name);
}

/**
 * Run one SQL string against the mounted tables.
 *
 * This used to rewrite *every* occurrence of `SalesData` to the target table,
 * which was fine when only one table could ever be mounted but would corrupt a
 * real multi-table join. All that survives is normalising the case of the view
 * name, since generated SQL writes it inconsistently.
 */
export function runSql(sql, table = TABLE) {
  const cleaned = outsideLiterals(String(sql || ''), (part) =>
    part.replace(/\[?\bSalesData\b\]?/gi, `[${table}]`)
  );
  return alasql(cleaned) || [];
}

/**
 * Apply `fn` to the parts of a statement that are not inside quotes.
 *
 * The view-name rewrite used to run over the whole string, so `WHERE note =
 * 'SalesData'` was rewritten to `'[SalesData]'` and matched nothing, and
 * `SELECT 'SalesData'` returned the brackets. A name substitution has no
 * business inside quoted text.
 */
function outsideLiterals(sql, fn) {
  const parts = sql.split(/('(?:[^']|'')*'|"(?:[^"]|"")*")/);
  for (let i = 0; i < parts.length; i += 2) parts[i] = fn(parts[i]);
  return parts.join('');
}

