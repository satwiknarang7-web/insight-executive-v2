/**
 * The two things a CSV export gets wrong before the first data row.
 *
 * A CSV is supposed to start with its header. Exports from finance systems
 * and reporting tools start with a title, a "Generated on" line, a blank row
 * and then the header — and a parser that trusts line one names every
 * column "Q1 Sales Report". Workbooks already solve this: `findHeaderRow`
 * scores the first rows and picks the one that is wide, textual and has data
 * under it. This applies the same judgement to delimited text.
 *
 * The second is duplicate or blank header cells. Papa keeps duplicates, so a
 * second "Amount" column silently overwrites the first in every row object.
 * `uniqueHeader` is the transform that stops that, one file at a time.
 */
import Papa from 'papaparse';
import { findHeaderRow } from '../workbook.js';

/** How many lines at the top are worth looking at for a header. */
const SCAN_LINES = 30;

/**
 * Drop the lines before the header, if the header is not the first line.
 *
 * Returns the text to parse and how many lines were removed. Conservative on
 * purpose: the header finder has to place the header past line one, within
 * the scan depth, and every line above it has to be narrower than the header
 * — a title, a stamp, a blank — before anything is cut.
 */
export function skipPreamble(text) {
  const source = String(text ?? '');
  const head = source.split(/\r?\n/, SCAN_LINES + 1).slice(0, SCAN_LINES).join('\n');
  const parsed = Papa.parse(head, { header: false, skipEmptyLines: false, dynamicTyping: false });
  // The finder scores a row by how textual it is, and a CSV arrives all text.
  // Number-shaped cells are typed here so a data row reads as data.
  const grid = (parsed.data || []).map((row) => row.map((cell) => (/^\s*[-+]?\d+(?:[.,]\d+)?\s*$/.test(cell) ? Number(cell) : cell)));
  if (grid.length < 3) return { text: source, skipped: 0 };

  const index = findHeaderRow(grid);
  if (index <= 0) return { text: source, skipped: 0 };

  const width = (row) => row.filter((v) => v !== null && v !== undefined && String(v).trim() !== '').length;
  const headerWidth = width(grid[index]);
  if (headerWidth < 2) return { text: source, skipped: 0 };
  for (let i = 0; i < index; i++) {
    // A line as wide as the header is data, not a title; leave the file alone.
    if (width(grid[i]) >= headerWidth) return { text: source, skipped: 0 };
  }

  // The character offset of the header line, counted in newlines. A quoted
  // newline above the header would make that count wrong — so a preamble with
  // a quote anywhere in it is left alone rather than cut in the wrong place.
  let offset = 0;
  for (let i = 0; i < index; i++) {
    const newline = source.indexOf('\n', offset);
    if (newline === -1) return { text: source, skipped: 0 };
    offset = newline + 1;
  }
  if (!offset || offset >= source.length || source.slice(0, offset).includes('"')) {
    return { text: source, skipped: 0 };
  }
  return { text: source.slice(offset), skipped: index };
}

/**
 * A header transform that makes every name non-empty and unique.
 *
 * Wraps the caller's own transform (the SQL-safe renaming) and adds the two
 * rules a workbook header already gets: a blank cell is `Column_N`, and a
 * repeat gets `_2`, `_3`.
 */
export function uniqueHeader(transform = (h) => h) {
  const taken = new Set();
  // Papa may run the header transform more than once for the same cell when
  // it re-reads the first chunk; the answer for a position is fixed on the
  // first call, or the second pass would rename "a" to "a_2".
  const byIndex = new Map();
  return (header, index) => {
    if (index !== undefined && byIndex.has(index)) return byIndex.get(index);
    const base = String(header ?? '').trim();
    let name = base ? transform(base, index) : `Column_${(index ?? taken.size) + 1}`;
    if (taken.has(name)) {
      let n = 2;
      while (taken.has(`${name}_${n}`)) n++;
      name = `${name}_${n}`;
    }
    taken.add(name);
    if (index !== undefined) byIndex.set(index, name);
    return name;
  };
}
