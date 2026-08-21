/**
 * Reading real-world spreadsheets.
 *
 * A CSV is a grid that starts at A1 with a header row. An Excel sheet almost
 * never is: there is a title, a blank row, maybe a "Generated 12/03" stamp, then
 * the real header, then the data, then a bold "Total" row that is not a record
 * at all. Feeding that straight into the profiler produces columns called
 * `__EMPTY_3` and a phantom outlier for every total.
 *
 * So the grid is located before it is parsed — and the grid-shaped work is kept
 * separate from SheetJS so it can be tested on plain arrays.
 */
import * as XLSX from 'xlsx';

/** Rows scanned when hunting for the header. */
const HEADER_SCAN_DEPTH = 25;
/** Trailing rows checked for a totals footer. */
const FOOTER_SCAN_DEPTH = 3;

const isBlank = (v) => v === null || v === undefined || String(v).trim() === '';
const filled = (row) => row.filter((v) => !isBlank(v)).length;

const TOTAL_RE = /^(grand\s+)?(total|totals|sum|subtotal)\b/i;

/**
 * Locate the header row in a grid of raw cells.
 *
 * Scored rather than guessed: a header is the row that is wide, textual, has no
 * repeated labels, and is followed by a row at least as wide as itself. That
 * last clause is what stops a two-cell title ("Q1 Sales Report") from winning.
 * Returns -1 when nothing in the sheet looks like a header.
 */
export function findHeaderRow(grid) {
  const limit = Math.min(grid.length, HEADER_SCAN_DEPTH);
  const widest = Math.max(0, ...grid.slice(0, limit).map(filled));
  if (widest === 0) return -1;

  let best = -1;
  let bestScore = -Infinity;

  for (let i = 0; i < limit; i++) {
    const row = grid[i];
    const width = filled(row);
    if (width < 2) continue;

    const cells = row.filter((v) => !isBlank(v));
    const textual = cells.filter((v) => typeof v !== 'number').length / cells.length;
    const distinct = new Set(cells.map((v) => String(v).trim().toLowerCase())).size / cells.length;
    const below = grid[i + 1] ? filled(grid[i + 1]) : 0;

    // A header is mostly words, never repeats a label, and has data under it.
    let score = (width / widest) * 2 + textual * 2.5 + distinct * 1.5;
    if (below >= width) score += 1.5;
    else if (below === 0) score -= 3;
    // Later rows are less likely to be the header; nudge earlier ones ahead.
    score -= i * 0.05;

    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

/** Turn a header row into unique, non-empty column names. */
export function headerNames(row) {
  const taken = new Set();
  const out = [];
  row.forEach((cell, i) => {
    let name = isBlank(cell) ? `Column_${i + 1}` : String(cell).trim().replace(/\s+/g, ' ');
    if (taken.has(name)) {
      let n = 2;
      while (taken.has(`${name}_${n}`)) n++;
      name = `${name}_${n}`;
    }
    taken.add(name);
    out.push(name);
  });
  return out;
}

/**
 * Convert one raw grid into `{ columns, rows, droppedRows, totalsRowsRemoved }`.
 *
 * Excel dates arrive as `Date` objects; they are flattened to ISO strings so a
 * sheet and a CSV of the same data profile identically downstream.
 */
export function gridToRows(grid) {
  const headerIndex = findHeaderRow(grid);
  if (headerIndex === -1) return { columns: [], rows: [], droppedRows: 0, totalsRowsRemoved: 0 };

  // Only keep columns the header actually names; a trailing run of blank header
  // cells is spillover, not data.
  const rawHeader = grid[headerIndex];
  let width = rawHeader.length;
  while (width > 0 && isBlank(rawHeader[width - 1])) width--;
  const columns = headerNames(rawHeader.slice(0, width));

  const body = grid.slice(headerIndex + 1);
  let droppedRows = 0;
  const kept = [];
  for (const row of body) {
    if (filled(row) === 0) {
      droppedRows++;
      continue;
    }
    kept.push(row);
  }

  // A totals footer is a summary of the data, not a record in it. Only the last
  // few rows are eligible, so a legitimate row about "Total Rewards Ltd" in the
  // middle of the sheet is untouched.
  let totalsRowsRemoved = 0;
  for (let i = 0; i < FOOTER_SCAN_DEPTH && kept.length > 1; i++) {
    const last = kept[kept.length - 1];
    const label = last.find((v) => !isBlank(v) && typeof v !== 'number');
    if (label && TOTAL_RE.test(String(label).trim())) {
      kept.pop();
      totalsRowsRemoved++;
    } else break;
  }

  const rows = kept.map((row) => {
    const obj = {};
    for (let c = 0; c < columns.length; c++) {
      const v = row[c];
      obj[columns[c]] =
        v instanceof Date
          ? isNaN(v.getTime())
            ? null
            : v.toISOString()
          : v === undefined
            ? null
            : v;
    }
    return obj;
  });

  return { columns, rows, droppedRows, totalsRowsRemoved };
}

/**
 * Read an .xlsx/.xls ArrayBuffer into one entry per usable sheet.
 *
 * Sheets that hold no tabular data at all (a cover page, a chart-only tab) are
 * returned in `skipped` rather than dropped silently — the user named those tabs
 * for a reason and should be told why they were left out.
 */
export function readWorkbook(buffer, { fileName = 'workbook.xlsx' } = {}) {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true, dense: false });
  const sheets = [];
  const skipped = [];

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws) {
      skipped.push({ sheetName, reason: 'empty sheet' });
      continue;
    }
    const grid = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, blankrows: true });
    const { columns, rows, droppedRows, totalsRowsRemoved } = gridToRows(grid);

    if (columns.length === 0 || rows.length === 0) {
      skipped.push({ sheetName, reason: 'no table found on this sheet' });
      continue;
    }
    sheets.push({ sheetName, sourceFile: fileName, columns, rows, droppedRows, totalsRowsRemoved });
  }

  return { sheets, skipped };
}

/** Does this filename look like a workbook rather than a delimited text file? */
export function isWorkbookFile(name) {
  return /\.(xlsx|xlsm|xlsb|xls)$/i.test(String(name || ''));
}
