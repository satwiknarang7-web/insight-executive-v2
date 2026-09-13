/**
 * Turning a picture of a table into rows.
 *
 * Everything here is pure: the instructions a model is given, the schema its
 * answer must fit, the tidying that answer needs, and the conversion into the
 * shape the ingest path already accepts. No network, no keys, no browser.
 *
 * The prompt is the interesting part and most of it is scar tissue — every
 * numbered rule below is a way a real document was read wrongly. Totals
 * silently becoming data rows is the one that matters most: a total is
 * recomputable from the entries it sums, and a row containing one corrupts
 * every average, every share and every ranking built on the column.
 *
 * Ported from the vendor-portal project. What is deliberately not ported is its
 * continuation-block unstacking — a code pass that folds side-by-side blocks of
 * a handwritten ledger back into one list. Rule 9 below asks the model to do it,
 * which is the primary defence; the backstop is a hundred lines that can
 * misalign real data when it guesses wrong, and it wants its own evidence
 * before it earns a place here.
 */

/** What the model is told it is doing. */
export const EXTRACTION_SYSTEM_PROMPT = `You are an expert document digitization system. Extract ALL tabular data from the provided document into structured JSON.

Rules:
1. Detect column headers automatically from the document.
2. Extract every row of data, preserving the exact values shown.
3. For each cell, assess your confidence:
   - "verified": clearly readable, no ambiguity
   - "uncertain": partially readable, smudged, ambiguous, or could be misread
4. Mark cells as uncertain when handwriting is hard to read or values seem unusual. Being honest here is more useful than appearing confident: an uncertain cell is shown to the reader as one, and a wrong cell marked verified is not.
5. Preserve original formatting: numbers, dates, currency symbols, units. Do not convert or reformat anything — a later pass cleans these, and it can only do that correctly if it sees what the document actually said.
6. If a cell is empty, use null for the value.
7. For column IDs, use lowercase snake_case derived from the header name. Never emit two columns with the same header name — if a header genuinely repeats, the columns are the same column.
8. Infer column types from the data content (text, number, currency, date, boolean).
9. Handwritten ledgers are often written as several side-by-side blocks on one page to save paper. When a block to the right repeats the same structure as the block on the left, it is a CONTINUATION of the same list, not a new set of columns. Emit ONE set of columns and append the right-hand block's entries as further rows, in reading order (left block first, then right). Do not create "Date 1 / Amount 1 / Date 2 / Amount 2" style parallel columns for this.
10. Only create separate columns for blocks that are genuinely different fields, i.e. blocks with different headers, or entries that share a row because they describe the same item.
11. Totals, subtotals and grand totals are not data rows. Leave them out of "rows" entirely — a total is recomputable from the entries and a row containing one corrupts sorting, averages and every share computed from the column.
12. Never write a label such as "TOTAL", "SUM" or "-" into a date or numeric column as if it were a value.
13. The "rows" array must contain ONLY actual data rows. Never include the column header row as a data row — the header text belongs exclusively in the "columns" array.

Return ONLY valid JSON matching the schema you were given.`;

/** The response schema, in the form Google's SDK expects. */
export const EXTRACTION_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'Title or heading of the table, if visible. Empty string if none.' },
    columns: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Machine-friendly column key in lowercase snake_case' },
          name: { type: 'string', description: 'Header text as it appears in the document' },
          type: { type: 'string', enum: ['text', 'number', 'currency', 'date', 'boolean'] },
        },
        required: ['id', 'name', 'type'],
      },
    },
    rows: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          values: { type: 'object', description: 'column id -> cell value, or null when empty' },
          confidence: { type: 'object', description: 'column id -> "verified" or "uncertain"' },
        },
        required: ['values'],
      },
    },
  },
  required: ['columns', 'rows'],
};

/** What a document may be read from. Anything else is refused before a key is spent. */
export const EXTRACTABLE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/pdf',
]);

export const MAX_DOCUMENT_BYTES = 12 * 1024 * 1024;

export function isExtractable(file) {
  const type = String(file?.type || '').toLowerCase();
  if (EXTRACTABLE_TYPES.has(type)) return true;
  return /\.(png|jpe?g|webp|heic|heif|pdf)$/i.test(file?.name || '');
}

const isEmpty = (v) => v === undefined || v === null || v === '';

/** Header text reduced to a comparable key: case, spacing and punctuation don't count. */
function nameKey(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Fold columns that are the same column wearing two ids.
 *
 * Models sometimes uniquify an id ("final_rate", "final_rate_2") while leaving
 * the display name identical, then fill only one of them — so the table arrives
 * with two columns under one header, one of them empty.
 *
 * They are folded only when they cannot disagree. If any row has both filled
 * with different values they are genuinely different columns that happen to
 * share a heading, so the later one is kept and its header disambiguated
 * instead. Merging those would destroy data; renaming them only looks untidy.
 */
export function normalizeExtraction(columns, rows) {
  const safeRows = Array.isArray(rows) ? rows : [];
  if (!Array.isArray(columns) || columns.length === 0) {
    return { columns: columns || [], rows: safeRows, mergedIds: [] };
  }

  const firstByName = new Map();
  const seenByName = new Map();
  const kept = [];
  const aliases = new Map();

  for (const col of columns) {
    const key = nameKey(col?.name) || col?.id;
    const first = firstByName.get(key);

    if (!first) {
      firstByName.set(key, col);
      seenByName.set(key, 1);
      kept.push(col);
      continue;
    }

    const conflicts = safeRows.some((row) => {
      const a = row?.values?.[first.id];
      const b = row?.values?.[col?.id];
      return !isEmpty(a) && !isEmpty(b) && String(a) !== String(b);
    });

    if (conflicts) {
      const n = (seenByName.get(key) || 1) + 1;
      seenByName.set(key, n);
      kept.push({ ...col, name: `${col.name} (${n})` });
    } else {
      aliases.set(col.id, first.id);
    }
  }

  if (aliases.size === 0) return { columns: kept, rows: safeRows, mergedIds: [] };

  const merged = safeRows.map((row) => {
    const values = { ...(row?.values || {}) };
    const confidence = { ...(row?.confidence || {}) };

    for (const [dupId, keptId] of aliases) {
      if (!(dupId in values) && !(dupId in confidence)) continue;
      // The survivor takes the value from whichever twin actually has one.
      if (isEmpty(values[keptId]) && !isEmpty(values[dupId])) {
        values[keptId] = values[dupId];
        if (confidence[dupId]) confidence[keptId] = confidence[dupId];
      }
      delete values[dupId];
      delete confidence[dupId];
    }

    return { ...row, values, confidence };
  });

  return { columns: kept, rows: merged, mergedIds: [...aliases.keys()] };
}

/**
 * Turn an extraction into the table the ingest path already accepts.
 *
 * Two things come out of this: ordinary rows keyed by header name, which then
 * take exactly the same cleaning, profiling and analysis as a CSV — and the
 * list of cells the model said it was unsure of, which becomes the seed of the
 * confidence store. That second half is the whole point of extracting through
 * this app rather than any other: the doubt survives into the findings, instead
 * of a smudged digit becoming a confident number the moment it is typed out.
 *
 * Rows with nothing in them are dropped **here**, before cleaning, so that the
 * row indices the uncertain cells refer to are the indices the cleaner will
 * see. The cleaner drops empty rows too, and a seed recorded against a position
 * it then shifts would mark an innocent cell.
 */
export function extractionToTable(extraction, { label = 'Document' } = {}) {
  const { columns, rows } = normalizeExtraction(extraction?.columns, extraction?.rows);

  const headers = [];
  const byId = new Map();
  const taken = new Set();
  for (const col of columns) {
    if (!col?.id) continue;
    // Two different ids can still want the same header once punctuation is
    // stripped; the ingest path keys rows by header, so they have to be unique.
    let header = String(col.name || col.id).trim() || col.id;
    let n = 2;
    while (taken.has(header)) header = `${col.name || col.id} (${n++})`;
    taken.add(header);
    headers.push(header);
    byId.set(col.id, header);
  }

  const out = [];
  const uncertain = [];

  for (const row of rows) {
    const values = row?.values || {};
    const record = {};
    let filled = 0;

    for (const [id, header] of byId) {
      const value = values[id];
      record[header] = isEmpty(value) ? '' : String(value);
      if (!isEmpty(value)) filled++;
    }

    if (filled === 0) continue;
    const index = out.length;
    out.push(record);

    const confidence = row?.confidence || {};
    for (const [id, header] of byId) {
      if (confidence[id] === 'uncertain' && !isEmpty(values[id])) {
        uncertain.push({ row: index, column: header });
      }
    }
  }

  return {
    label: String(extraction?.title || '').trim() || label,
    columns: headers,
    rows: out,
    uncertain,
  };
}
