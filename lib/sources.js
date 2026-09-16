/**
 * Everything the app can load data from, in one catalog.
 *
 * Power BI's "Get data" dialog is the shape people know: a searchable grid of
 * sources, grouped by what they are. This is that list. Each entry says what
 * kind of thing it is — a file dropped in the browser, a link fetched by the
 * server, a database driven through the connection vault, text pasted in —
 * and the Home page renders the right form for the kind. Nothing here loads
 * anything; it is the menu, not the kitchen.
 *
 * The database entries come from the connector registry, so a driver added
 * there appears here without a second list to update.
 */
import { availableConnectors } from './connectors/registry.js';
import { WEB_SOURCES } from './webSources.js';

/** Files the browser reads on its own. `accept` is what the file picker offers. */
const FILE_SOURCES = [
  {
    id: 'file',
    label: 'CSV, TSV or text',
    blurb: 'Comma, tab or semicolon separated. Streamed and cleaned in your browser; nothing leaves the device.',
    keywords: 'csv tsv txt delimited comma text flat file',
    accept: '.csv,.tsv,.txt,text/csv,text/plain',
  },
  {
    id: 'excel',
    label: 'Excel workbook',
    blurb: 'Every sheet with a table on it becomes a table, and the sheets are related to each other.',
    keywords: 'xlsx xls xlsm xlsb ods spreadsheet workbook sheet',
    accept: '.xlsx,.xlsm,.xlsb,.xls,.ods',
  },
  {
    id: 'json',
    label: 'JSON or NDJSON',
    blurb: 'An array of records, an API reply with the records inside it, or one object per line.',
    keywords: 'json ndjson jsonl api export records',
    accept: '.json,.jsonl,.ndjson,application/json',
  },
  {
    id: 'xml',
    label: 'XML',
    blurb: 'A root element with a repeated child — an export, a feed, a SOAP reply.',
    keywords: 'xml rss atom feed soap',
    accept: '.xml,text/xml,application/xml',
  },
  {
    id: 'html',
    label: 'HTML page',
    blurb: 'A saved web page. Every table on it is read.',
    keywords: 'html htm web page table saved',
    accept: '.html,.htm,text/html',
  },
  {
    id: 'parquet',
    label: 'Parquet',
    blurb: 'A columnar file from Spark, pandas, DuckDB or a lake. Read in the browser.',
    keywords: 'parquet columnar spark pandas arrow lake',
    accept: '.parquet',
  },
  {
    id: 'sqlite',
    label: 'SQLite database',
    blurb: 'A .sqlite or .db file. Every table and view in it is loaded and related.',
    keywords: 'sqlite db database file local',
    accept: '.sqlite,.sqlite3,.db',
  },
  {
    id: 'document',
    label: 'PDF or photo of a table',
    blurb: 'A scanned statement, a screenshot, a photographed page — read by a model on your own key.',
    keywords: 'pdf image photo scan picture screenshot png jpg ocr',
    accept: '.pdf,.png,.jpg,.jpeg,.webp,image/*,application/pdf',
    needs: 'model',
  },
  {
    id: 'paste',
    label: 'Paste text',
    blurb: 'Rows copied from a spreadsheet, a terminal or a document, pasted straight in.',
    keywords: 'paste clipboard copy text type',
    kind: 'paste',
  },
];

/** Which group a connector belongs in, by id. Anything unlisted is a database. */
const WAREHOUSES = new Set(['snowflake', 'databricks', 'clickhouse', 'trino', 'redshift', 'fabric']);
const SERVICES = new Set(['tableau', 'airtable', 'mongodb']);
/** Words a search should also find a connector by. */
const CONNECTOR_KEYWORDS = {
  postgres: 'postgresql pg rds cloud sql',
  neon: 'serverless postgres',
  supabase: 'postgres pooler',
  mysql: 'mariadb',
  sqlserver: 'mssql microsoft tsql azure',
  azuresql: 'microsoft mssql managed instance',
  snowflake: 'warehouse',
  oracle: 'autonomous thin',
  fabric: 'microsoft lakehouse warehouse onelake entra',
  tableau: 'published datasource',
  clickhouse: 'olap http cloud',
  databricks: 'lakehouse sql warehouse delta spark',
  trino: 'presto starburst athena federated',
  mongodb: 'atlas documentdb cosmos nosql collection',
  airtable: 'base records no-code',
  redshift: 'amazon aws warehouse',
  cockroachdb: 'distributed postgres',
  timescale: 'time series postgres',
  alloydb: 'google postgres',
  'rds-postgres': 'amazon aws aurora',
  'rds-mysql': 'amazon aws aurora',
  tidb: 'mysql distributed',
  planetscale: 'mysql vitess',
  singlestore: 'memsql mysql',
  mariadb: 'mysql',
};

function connectorItems() {
  return availableConnectors().map((c) => ({
    id: c.id,
    label: c.label,
    blurb: c.blurb,
    keywords: `${c.id} ${CONNECTOR_KEYWORDS[c.id] || ''} database`,
    kind: 'connector',
    connector: c.id,
  }));
}

/** The catalog, grouped the way the Home page shows it. */
export function sourceGroups() {
  const connectors = connectorItems();
  return [
    { id: 'files', label: 'Files', items: FILE_SOURCES.map((f) => ({ kind: 'file', ...f })) },
    { id: 'web', label: 'Web & APIs', items: WEB_SOURCES.map((w) => ({ id: w.id, label: w.label, blurb: w.blurb, keywords: `${w.id} web url link online http`, kind: 'web', web: w.id })) },
    { id: 'databases', label: 'Databases', items: connectors.filter((c) => !WAREHOUSES.has(c.id) && !SERVICES.has(c.id)) },
    { id: 'warehouses', label: 'Warehouses & lakehouses', items: connectors.filter((c) => WAREHOUSES.has(c.id)) },
    { id: 'services', label: 'Platforms & services', items: connectors.filter((c) => SERVICES.has(c.id)) },
  ].filter((g) => g.items.length);
}

/** Every source, flat. */
export function allSources() {
  return sourceGroups().flatMap((g) => g.items.map((i) => ({ ...i, group: g.label })));
}

export function sourceById(id) {
  return allSources().find((s) => s.id === id) || null;
}

const norm = (s) => String(s || '').toLowerCase();

/**
 * Sources matching a query, best first: a label match ahead of a keyword
 * match ahead of a blurb match. An empty query is everything, in order.
 */
export function searchSources(query) {
  const q = norm(query).trim();
  const all = allSources();
  if (!q) return all;
  const words = q.split(/\s+/).filter(Boolean);
  const score = (s) => {
    const label = norm(s.label);
    const keys = norm(s.keywords);
    const blurb = norm(s.blurb);
    let total = 0;
    for (const w of words) {
      if (label.includes(w)) total += 3;
      else if (keys.includes(w)) total += 2;
      else if (blurb.includes(w)) total += 1;
      else return 0;
    }
    return total;
  };
  return all
    .map((s) => ({ s, n: score(s) }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n)
    .map((x) => x.s);
}

/** The file-picker accept list for a file source, or every file kind for the drop zone. */
export function acceptFor(id = null) {
  const item = id ? FILE_SOURCES.find((f) => f.id === id) : null;
  if (item?.accept) return item.accept;
  return FILE_SOURCES.filter((f) => f.accept)
    .map((f) => f.accept)
    .join(',');
}
