/**
 * The app's real ingest chain, callable from Node.
 *
 * The worker module itself cannot be imported here — it touches `self` at load
 * — so the four calls it makes are made here in the same order with the same
 * options. Anything this reports is therefore the product's cleaning, not a
 * paraphrase of it. The calls, from app/workers/engine.worker.js:
 *
 *   Papa.parse(header, transformHeader: uniqueHeader(sqlSafeName),
 *              skipEmptyLines: 'greedy', dynamicTyping: false)
 *   -> sanitizeChunk(...)        per chunk
 *   -> finalizeMetrics(...)      which runs the comma, suffix and category passes
 *   -> dropEmptyColumns(...)
 */
import Papa from 'papaparse';
import {
  createMetrics,
  sanitizeChunk,
  finalizeMetrics,
  dropEmptyColumns,
} from '../lib/dataCleaner.js';
import { uniqueHeader, skipPreamble } from '../lib/ingest/delimited.js';

/** The same header transform the worker uses. */
function sqlSafeName(header) {
  return String(header ?? '')
    .replace(/[[\]'"`]/g, '')
    .trim();
}

export function ingest(csvText) {
  // The worker calls this first, through `withoutPreamble`.
  const { text, skipped } = skipPreamble(csvText);
  const parsed = Papa.parse(text, {
    header: true,
    transformHeader: uniqueHeader(sqlSafeName),
    skipEmptyLines: 'greedy',
    dynamicTyping: false,
  });
  const columns = (parsed.meta.fields || []).filter((f) => f && f.trim() !== '');
  const metrics = createMetrics(columns, 0);
  const cleaned = [];
  sanitizeChunk(parsed.data, columns, metrics, cleaned);
  metrics.totalRows = parsed.data.length;
  metrics.totalCells = parsed.data.length * columns.length;
  finalizeMetrics(cleaned, columns, metrics);
  metrics.preambleRows = skipped;
  dropEmptyColumns(cleaned, columns, metrics);
  return { columns, rows: cleaned, metrics, parseErrors: parsed.errors || [] };
}
