/**
 * Every shape a file can hold a table in, read into rows.
 *
 * A CSV is a table already. A JSON export is an array of objects, or an
 * object with the array somewhere inside it; an API answers with `{ data: [...]
 * }` or `{ value: [...] }` or `{ results: { items: [...] } }`. NDJSON is one
 * object per line. XML is a root with a repeated child. An HTML page has
 * `<table>` elements, sometimes several. None of these needs a model to read,
 * and none of them should need a different upload path — so each becomes the
 * same thing here: a list of `{ name, columns, rows }`, which is exactly what
 * a workbook's sheets become, and the rest of the pipeline never learns the
 * difference.
 *
 * Pure. No DOM (a worker has none), no library: XML and HTML are read by a
 * tolerant tokenizer that handles the tables people actually export, not by a
 * conforming parser. A page that defeats it says so, rather than producing a
 * table of tag soup.
 */

/** How deep to look for the array a JSON document is really about. */
const MAX_DEPTH = 6;

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** One value as a cell: scalars as they are, nested objects flattened, arrays as text. */
function flatten(record, prefix = '', out = {}, depth = 0) {
  for (const [key, value] of Object.entries(record || {})) {
    const name = prefix ? `${prefix}.${key}` : key;
    if (value === null || value === undefined) out[name] = null;
    else if (isPlainObject(value) && depth < 2) flatten(value, name, out, depth + 1);
    else if (isPlainObject(value) || Array.isArray(value)) out[name] = JSON.stringify(value);
    else out[name] = value;
  }
  return out;
}

/** The columns a set of rows has, in the order they were first seen. */
export function columnsOf(rows) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        out.push(key);
      }
    }
  }
  return out;
}

/** Rows from an array of anything: objects flattened, scalars in one column, arrays as positional columns. */
function rowsFromArray(array) {
  if (!array.length) return [];
  if (array.every((v) => !isPlainObject(v) && !Array.isArray(v))) return array.map((v) => ({ value: v }));
  if (array.every((v) => Array.isArray(v))) {
    // A grid: the first row is the header when it is all text and unique.
    const [head, ...rest] = array;
    const headerish = head.every((h) => typeof h === 'string') && new Set(head).size === head.length && rest.length > 0;
    if (headerish) return rest.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? null])));
    return array.map((r) => Object.fromEntries(r.map((v, i) => [`column_${i + 1}`, v])));
  }
  return array.filter(isPlainObject).map((o) => flatten(o));
}

/**
 * Find the arrays of records inside a parsed JSON value.
 *
 * The whole document when it is an array. Otherwise every array of objects
 * reachable within a few levels, largest first — an API envelope has one such
 * array and some metadata beside it, and the array is the table.
 */
export function tablesInJson(value, name = 'data') {
  if (Array.isArray(value)) {
    const rows = rowsFromArray(value);
    return rows.length ? [{ name, columns: columnsOf(rows), rows }] : [];
  }
  if (!isPlainObject(value)) return [];

  const found = [];
  const walk = (node, path, depth) => {
    if (depth > MAX_DEPTH || !isPlainObject(node)) return;
    for (const [key, child] of Object.entries(node)) {
      if (Array.isArray(child) && child.length && child.some(isPlainObject)) {
        const rows = rowsFromArray(child);
        if (rows.length) found.push({ name: path.length ? `${path.join('_')}_${key}` : key, columns: columnsOf(rows), rows });
      } else if (isPlainObject(child)) {
        walk(child, [...path, key], depth + 1);
      }
    }
  };
  walk(value, [], 0);

  if (!found.length) {
    // A single object is a table of one row — a settings dump, a profile.
    const rows = rowsFromArray([value]);
    return rows.length && columnsOf(rows).length ? [{ name, columns: columnsOf(rows), rows }] : [];
  }
  return found.sort((a, b) => b.rows.length - a.rows.length);
}

export function parseJson(text, name = 'data') {
  const source = String(text || '').trim();
  if (!source) return [];
  let value;
  try {
    value = JSON.parse(source);
  } catch {
    // Not one document; perhaps one per line.
    return parseNdjson(source, name);
  }
  return tablesInJson(value, name);
}

/** One JSON object per line. Blank lines and a trailing comma are forgiven. */
export function parseNdjson(text, name = 'data') {
  const rows = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const trimmed = line.trim().replace(/,$/, '');
    if (!trimmed) continue;
    try {
      const value = JSON.parse(trimmed);
      if (isPlainObject(value)) rows.push(flatten(value));
    } catch {
      /* a line that is not JSON is skipped, and a file with none produces nothing */
    }
  }
  return rows.length ? [{ name, columns: columnsOf(rows), rows }] : [];
}

/* -- XML ------------------------------------------------------------------ */

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export function decodeEntities(s) {
  return String(s ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

/**
 * A minimal XML tree: elements with a name, attributes, children and text.
 * Comments, processing instructions, CDATA and doctype are handled; namespaces
 * are kept as part of the name.
 */
function parseXmlTree(text) {
  const src = String(text || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\?[\s\S]*?\?>/g, '')
    .replace(/<!DOCTYPE[^>]*>/gi, '');
  const root = { name: '#root', attrs: {}, children: [], text: '' };
  const stack = [root];
  const tag = /<!\[CDATA\[([\s\S]*?)\]\]>|<\/([^\s>]+)\s*>|<([^\s/>]+)((?:\s+[^\s=>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = tag.exec(src))) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) top.text += m[1];
    else if (m[2]) {
      const name = m[2];
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].name === name) {
          stack.length = i;
          break;
        }
      }
    } else if (m[3]) {
      const attrs = {};
      for (const a of m[4].matchAll(/([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
        attrs[a[1]] = decodeEntities(a[2] ?? a[3] ?? a[4] ?? '');
      }
      const node = { name: m[3], attrs, children: [], text: '' };
      top.children.push(node);
      if (!m[5]) stack.push(node);
    } else if (m[6]) top.text += decodeEntities(m[6]);
  }
  return root;
}

/** One element as a row: attributes, then simple children, then nested ones flattened. */
function recordOf(node, prefix = '', out = {}, depth = 0) {
  for (const [k, v] of Object.entries(node.attrs)) out[prefix ? `${prefix}.${k}` : k] = v;
  for (const child of node.children) {
    const name = prefix ? `${prefix}.${child.name}` : child.name;
    const text = child.text.trim();
    if (child.children.length && depth < 2) {
      recordOf(child, name, out, depth + 1);
      continue;
    }
    for (const [k, v] of Object.entries(child.attrs)) out[`${name}.${k}`] = v;
    if (text || !Object.keys(child.attrs).length) out[name] = text;
  }
  return out;
}

/**
 * The tables in an XML document: every element whose children repeat a name,
 * largest first. `<rows><row>…</row><row>…</row></rows>` is the common shape;
 * an RSS feed's `<item>`s, a SOAP response's repeated records, all read.
 */
export function parseXml(text, name = 'data') {
  const root = parseXmlTree(text);
  const found = [];
  const walk = (node, depth) => {
    if (depth > MAX_DEPTH) return;
    const counts = new Map();
    for (const c of node.children) counts.set(c.name, (counts.get(c.name) || 0) + 1);
    for (const [childName, count] of counts) {
      if (count < 2) continue;
      const rows = node.children.filter((c) => c.name === childName).map((c) => recordOf(c)).filter((r) => Object.keys(r).length);
      if (rows.length) found.push({ name: node.name === '#root' ? name : `${node.name}_${childName}`.replace(/^#root_/, ''), columns: columnsOf(rows), rows });
    }
    for (const c of node.children) walk(c, depth + 1);
  };
  walk(root, 0);
  // The nested repeats inside a record (a row's own <tag> list) are far
  // smaller than the record list itself; the largest is the table.
  return found.sort((a, b) => b.rows.length - a.rows.length).slice(0, 5);
}

/* -- HTML ----------------------------------------------------------------- */

const stripTags = (s) =>
  decodeEntities(
    String(s)
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Every `<table>` on a page, as a table.
 *
 * The header is the first row made of `<th>` cells, or the first row when no
 * row uses `<th>` at all. A page with several tables produces several, in
 * page order, each named by its caption or its position.
 */
export function parseHtmlTables(html, name = 'table') {
  const src = String(html || '').replace(/<!--[\s\S]*?-->/g, '').replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
  const tables = [];
  let index = 0;
  for (const t of src.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)) {
    index++;
    const body = t[1];
    const caption = stripTags((body.match(/<caption\b[^>]*>([\s\S]*?)<\/caption>/i) || [])[1] || '');
    const rows = [];
    for (const r of body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells = [...r[1].matchAll(/<(t[dh])\b([^>]*)>([\s\S]*?)<\/\1>/gi)].map((c) => ({
        header: c[1].toLowerCase() === 'th',
        span: Math.max(1, Number((c[2].match(/colspan\s*=\s*"?(\d+)/i) || [])[1] || 1)),
        text: stripTags(c[3]),
      }));
      if (cells.length) rows.push(cells);
    }
    if (rows.length < 2) continue;
    const headerIndex = rows.findIndex((r) => r.every((c) => c.header));
    const headerRow = headerIndex >= 0 ? rows[headerIndex] : rows[0];
    const columns = [];
    for (const c of headerRow) for (let i = 0; i < c.span; i++) columns.push(c.span > 1 ? `${c.text} ${i + 1}` : c.text);
    const seen = new Map();
    const unique = columns.map((c, i) => {
      const base = c || `column_${i + 1}`;
      const n = (seen.get(base) || 0) + 1;
      seen.set(base, n);
      return n === 1 ? base : `${base} ${n}`;
    });
    const dataRows = rows
      .filter((_, i) => i !== (headerIndex >= 0 ? headerIndex : 0))
      .filter((r) => !r.every((c) => c.header))
      .map((r) => {
        const values = [];
        for (const c of r) for (let i = 0; i < c.span; i++) values.push(c.text);
        return Object.fromEntries(unique.map((col, i) => [col, values[i] ?? null]));
      });
    if (!dataRows.length) continue;
    tables.push({ name: caption || (index === 1 ? name : `${name}_${index}`), columns: unique, rows: dataRows });
  }
  return tables;
}

/* -- dispatch ------------------------------------------------------------- */

/** The format a file name or content type says it is. */
export function formatOf(fileName = '', contentType = '') {
  const name = String(fileName || '').toLowerCase();
  const type = String(contentType || '').toLowerCase();
  if (/\.(ndjson|jsonl)$/.test(name) || /ndjson|jsonlines/.test(type)) return 'ndjson';
  if (/\.json$/.test(name) || /json/.test(type)) return 'json';
  if (/\.xml$/.test(name) || /\bxml\b/.test(type)) return 'xml';
  if (/\.(html?|xhtml)$/.test(name) || /text\/html/.test(type)) return 'html';
  if (/\.parquet$/.test(name) || /parquet/.test(type)) return 'parquet';
  if (/\.(sqlite3?|db)$/.test(name) || /sqlite/.test(type)) return 'sqlite';
  if (/\.(xlsx|xlsm|xlsb|xls|ods)$/.test(name) || /spreadsheet|ms-excel/.test(type)) return 'workbook';
  if (/\.(png|jpe?g|webp|pdf)$/.test(name) || /^image\/|application\/pdf/.test(type)) return 'document';
  return 'delimited';
}

/** Read text in one of the structured formats into tables. */
export function parseStructuredText(format, text, name = 'data') {
  switch (format) {
    case 'json':
      return parseJson(text, name);
    case 'ndjson':
      return parseNdjson(text, name);
    case 'xml':
      return parseXml(text, name);
    case 'html':
      return parseHtmlTables(text, name);
    default:
      return [];
  }
}
