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
    blurb: 'Comma, tab or semicolon separated. Streamed and cleaned in your browser.',
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
    id: 'paste',
    label: 'Paste text',
    blurb: 'Rows copied from a spreadsheet, a terminal or a document, pasted straight in.',
    keywords: 'paste clipboard copy text type',
    kind: 'paste',
  },
];

/**
 * A mark for each source: two letters and the colour the thing is known by.
 *
 * Not the logos themselves. Shipping thirty companies' trademarks means
 * shipping thirty licences, and a wrong or stale mark is worse than none —
 * so this is the shape a brand is recognised by, in its own colour, drawn by
 * us. A source with no entry falls back to its initials in the accent, which
 * is why adding a connector needs nothing here.
 */
export const BRANDS = {
  // Files
  file: { mark: 'CS', color: '#4a8f7b' },
  excel: { mark: 'XL', color: '#217346' },
  json: { mark: '{ }', color: '#7c8aa5' },
  xml: { mark: '</>', color: '#8a7ca5' },
  html: { mark: 'HT', color: '#e34c26' },
  parquet: { mark: 'PQ', color: '#50abf1' },
  sqlite: { mark: 'SL', color: '#4a90b8' },
  paste: { mark: '¶', color: '#8a8f98' },
  // Web
  url: { mark: '↗', color: '#7c8aa5' },
  googlesheets: { mark: 'GS', color: '#0f9d58' },
  restapi: { mark: 'API', color: '#6aa9d8' },
  odata: { mark: 'OD', color: '#5b8def' },
  webpage: { mark: 'WW', color: '#6aa9d8' },
  // Databases
  postgres: { mark: 'Pg', color: '#5a8db8' },
  neon: { mark: 'Ne', color: '#00e599' },
  supabase: { mark: 'Sb', color: '#3ecf8e' },
  mysql: { mark: 'My', color: '#00758f' },
  mariadb: { mark: 'Ma', color: '#8a6d4f' },
  sqlserver: { mark: 'MS', color: '#cc2927' },
  azuresql: { mark: 'Az', color: '#0078d4' },
  oracle: { mark: 'Or', color: '#c74634' },
  redshift: { mark: 'Rs', color: '#c8511b' },
  cockroachdb: { mark: 'CR', color: '#8a63f5' },
  timescale: { mark: 'Ts', color: '#fdb515' },
  alloydb: { mark: 'Al', color: '#4285f4' },
  'rds-postgres': { mark: 'RP', color: '#6f8fd8' },
  'rds-mysql': { mark: 'RM', color: '#6f8fd8' },
  tidb: { mark: 'Ti', color: '#e63d3d' },
  planetscale: { mark: 'PS', color: '#9b8cff' },
  singlestore: { mark: 'S2', color: '#aa4bff' },
  // Warehouses
  snowflake: { mark: 'Sn', color: '#29b5e8' },
  databricks: { mark: 'Db', color: '#ff3621' },
  clickhouse: { mark: 'CH', color: '#e0b400' },
  trino: { mark: 'Tr', color: '#dd00a1' },
  fabric: { mark: 'Fb', color: '#0078d4' },
  // Platforms
  tableau: { mark: 'Tb', color: '#e97627' },
  mongodb: { mark: 'Mg', color: '#00ed64' },
  airtable: { mark: 'At', color: '#fcb400' },
};

/** The mark for a source, or its initials when nothing has been chosen for it. */
export function brandFor(item) {
  const known = BRANDS[item?.id];
  if (known) return known;
  const words = String(item?.label || '?').replace(/[^A-Za-z ]/g, '').trim().split(/\s+/);
  const mark = (words[0]?.[0] || '?') + (words[1]?.[0] || words[0]?.[1] || '');
  return { mark: mark.toUpperCase(), color: null };
}

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
