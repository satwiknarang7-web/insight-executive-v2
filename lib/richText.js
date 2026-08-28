/**
 * The one piece of markdown the report renders by hand.
 *
 * Everywhere else prose goes through `ReactMarkdown`, which escapes what it is
 * given. The printed summary cards did their own `**bold**` pass instead, with
 * a string replace into `dangerouslySetInnerHTML` — which is not a markdown
 * renderer, it is an HTML renderer that happens to also handle asterisks.
 *
 * That mattered because the text is not ours. A summary takeaway is editable on
 * the dashboard, and it travels inside the analysis payload when the analysis is
 * shared. So the author of the markup and the person whose browser runs it are
 * different people: open an analysis someone shared, export it to PDF, and the
 * renderer executes their markup on your origin carrying your session cookies.
 *
 * This splits the text instead of rewriting it. The caller turns the segments
 * into React nodes, and React escapes every one of them — including the parts
 * that are not bold, which is where anything hostile would actually sit.
 *
 * Pure and free of React, so the parsing can be tested on its own.
 */

/**
 * A `**bold**` run. Requires at least one character between the markers, so a
 * stray `****` stays literal text rather than becoming an empty emphasis.
 * `[\s\S]` rather than `.` so a marker pair spanning a line break still pairs.
 */
const BOLD = /\*\*([\s\S]+?)\*\*/g;

/**
 * Split text into `{ text, bold }` segments in source order.
 *
 * Joining every segment's `text` always reconstructs the input minus the `**`
 * markers, so nothing is dropped and nothing is invented — the segments are a
 * partition of the original, not a rewrite of it.
 *
 * @param {string} text
 * @returns {Array<{ text: string, bold: boolean }>}
 */
export function boldSegments(text) {
  const source = String(text ?? '');
  const segments = [];
  let cursor = 0;
  let match;

  BOLD.lastIndex = 0;
  while ((match = BOLD.exec(source)) !== null) {
    if (match.index > cursor) segments.push({ text: source.slice(cursor, match.index), bold: false });
    segments.push({ text: match[1], bold: true });
    cursor = match.index + match[0].length;
  }
  if (cursor < source.length) segments.push({ text: source.slice(cursor), bold: false });

  return segments;
}
