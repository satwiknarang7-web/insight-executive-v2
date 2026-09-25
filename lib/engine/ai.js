/**
 * What a language model adds to a dashboard, and the checks that keep it
 * honest. Two calls, both optional — without a key the engine builds the same
 * dashboard on its own reading.
 *
 *  1. understand  (before planning) — reads the columns (names, types, a few
 *     values each; never whole rows) and says what the table is about, which
 *     number matters most, which splits matter, which columns the rules
 *     misread, and which ratios an analyst would derive. `acceptReading`
 *     keeps only what names real columns in a way the values allow.
 *
 *  2. write       (after planning) — rewrites the summary and captions from
 *     the facts the engine computed. `acceptWriting` drops any sentence with
 *     a number that is not in those facts.
 */

import { fieldMeasure, countMeasure, ratioMeasure } from './measures.js';

/* ── 1. understand ─────────────────────────────────────────────────────── */

export const UNDERSTAND_SYSTEM = `You are a senior data analyst looking at an unfamiliar table before building its dashboard.
You see each column's name, type and a few of its values. Decide:
- subject: one short sentence, what one row is and what the table is for (e.g. "One row per online order; a sales log").
- primary: the column whose total or average the business watches most (a column name), or null.
- dimensions: up to 4 column names that are the most useful splits, best first.
- fixes: columns the automatic reading got wrong: [{"column": name, "role": "measure"|"dimension"|"id"|"time"|"ignore", "agg": "sum"|"avg"|null}]. Only when clearly wrong.
- measures: up to 3 ratios an analyst would add: [{"label": "Revenue per order", "numerator": column, "denominator": column or "rows", "format": "number"|"currency"|"percent"}]. Only when both parts exist and the ratio means something.
Reply with JSON only: {"subject": ..., "primary": ..., "dimensions": [...], "fixes": [...], "measures": [...]}.`;

/** The column briefing: shape and a few values, never rows. */
export function readingBriefing(ds, { fileName = '' } = {}) {
  return {
    fileName,
    rowCount: ds.rowCount,
    shape: ds.shape,
    columns: ds.fields.map((f) => ({
      name: f.name,
      type: f.kind,
      readAs: f.role,
      agg: f.agg || undefined,
      distinct: f.distinct ?? f.stats?.distinct,
      examples: (f.stats?.top || f.top || []).slice(0, 6).map(([v]) => String(v).slice(0, 40)),
      range: f.kind === 'number' ? [f.min ?? f.stats?.min, f.max ?? f.stats?.max] : undefined,
    })),
  };
}

export function understandPrompt(briefing) {
  return `Table: ${briefing.fileName || 'uploaded file'} (${briefing.rowCount} rows, read as "${briefing.shape}").
Columns:
${briefing.columns
  .map((c) => `- ${c.name} [${c.type}, read as ${c.readAs}${c.agg ? `/${c.agg}` : ''}, ${c.distinct} distinct${c.range ? `, ${c.range[0]}–${c.range[1]}` : ''}] e.g. ${c.examples.join(' | ')}`)
  .join('\n')}`;
}

const ROLES = new Set(['measure', 'dimension', 'id', 'time', 'ignore']);

/**
 * Keep what the table supports. Returns { subject, hints, overrides, custom }
 * ready for buildDashboard.
 */
export function acceptReading(proposal, ds) {
  const out = { subject: null, hints: { primary: null, dimensions: [] }, overrides: {}, custom: [], dropped: [] };
  if (!proposal || typeof proposal !== 'object') return out;
  const field = (n) => ds.fields.find((f) => f.name === n);

  if (typeof proposal.subject === 'string') out.subject = proposal.subject.slice(0, 160);

  const p = field(proposal.primary);
  if (p && (p.role === 'measure' || p.outcome)) out.hints.primary = p.name;
  else if (proposal.primary) out.dropped.push(`primary ${proposal.primary}`);

  for (const d of Array.isArray(proposal.dimensions) ? proposal.dimensions.slice(0, 4) : []) {
    const f = field(d);
    if (f && f.role === 'dimension') out.hints.dimensions.push(f.name);
    else out.dropped.push(`dimension ${d}`);
  }

  for (const fix of Array.isArray(proposal.fixes) ? proposal.fixes.slice(0, 10) : []) {
    const f = field(fix?.column);
    if (!f || !ROLES.has(fix.role)) continue;
    // A measure must hold numbers; a time column must hold dates or years.
    if (fix.role === 'measure' && f.kind !== 'number') continue;
    if (fix.role === 'time' && f.kind !== 'date' && !(f.kind === 'number' && (f.min ?? f.stats?.min) >= 1900)) continue;
    const agg = fix.agg === 'sum' || fix.agg === 'avg' ? fix.agg : undefined;
    if (fix.role === f.role && (!agg || agg === f.agg)) continue;
    out.overrides[f.name] = { role: fix.role, ...(agg ? { agg } : {}), ...(fix.role === 'time' && f.kind === 'number' ? { timeUnit: 'year' } : {}) };
  }

  for (const m of Array.isArray(proposal.measures) ? proposal.measures.slice(0, 3) : []) {
    const num = field(m?.numerator);
    const den = m?.denominator === 'rows' ? 'rows' : field(m?.denominator);
    if (!num || num.kind !== 'number' || !den || (den !== 'rows' && den.kind !== 'number') || den === num) {
      out.dropped.push(`measure ${m?.label}`);
      continue;
    }
    const label = String(m.label || `${num.label} per ${den === 'rows' ? 'row' : den.label}`).slice(0, 60);
    const format = ['number', 'currency', 'percent'].includes(m.format) ? m.format : num.format;
    const measure = ratioMeasure(
      fieldMeasure({ ...num, stats: num.stats || {} }, { agg: 'sum' }),
      den === 'rows' ? countMeasure(ds.noun) : fieldMeasure({ ...den, stats: den.stats || {} }, { agg: 'sum' }),
      label,
      { format }
    );
    out.custom.push({ ...measure, id: `ai:${measure.id}`, importance: 78 });
  }
  return out;
}

/* ── 2. write ──────────────────────────────────────────────────────────── */

export const WRITE_SYSTEM = `You write the text of a data dashboard for a busy executive.
You are given the facts an analysis engine computed. Write:
- headline: one sentence, the single most important thing in this data.
- summary: 2 to 4 bullets, each one finding with its number and why it matters. No filler, no advice you cannot back with the facts.
- captions: for each tile id, one or two sentences on what that chart shows, sharper than the draft.
Use ONLY numbers that appear in the facts, written the same way. Never invent causes. Reply with JSON only:
{"headline": "...", "summary": ["...", "..."], "captions": {"tileId": "..."}}`;

export function writingBriefing(board) {
  const tiles = (board.sections || []).flatMap((s) => s.tiles).filter((t) => t.insight);
  return {
    subject: board.subject || board.summary,
    kpis: (board.kpis || []).map((k) => ({ label: k.title, value: k.formatted, change: k.delta?.text || null, vs: k.delta?.vs || null })),
    tiles: tiles.map((t) => ({ id: t.id, title: t.title, draft: t.insight })),
  };
}

export function writePrompt(briefing) {
  return `About the data: ${briefing.subject}
Headline figures:
${briefing.kpis.map((k) => `- ${k.label}: ${k.value}${k.change ? ` (${k.change} ${k.vs})` : ''}`).join('\n')}
Charts (id — title: draft caption):
${briefing.tiles.map((t) => `- ${t.id} — ${t.title}: ${t.draft}`).join('\n')}`;
}

/** Every number-like token in a string, normalised ("1,240" → "1240", "−3%" → "3%"). */
export function numbersIn(text) {
  return (String(text).match(/[$€£₹¥]?\d[\d,]*(\.\d+)?\s?(%|pts|×|[KMBT]\b)?/g) || [])
    .map((t) => t.replace(/[,\s$€£₹¥]/g, '').replace(/pts$/, ''))
    .filter((t) => !/^(19|20)\d{2}$/.test(t) || true);
}

/** Keep only sentences whose every number appears in the briefing. */
export function acceptWriting(proposal, briefing) {
  const source = [briefing.subject, ...briefing.kpis.flatMap((k) => [k.value, k.change, k.vs]), ...briefing.tiles.flatMap((t) => [t.title, t.draft])].join(' ');
  const allowed = new Set(numbersIn(source));
  const ok = (s) => typeof s === 'string' && s.length > 0 && s.length < 600 && numbersIn(s).every((n) => allowed.has(n) || /^\d$/.test(n));
  const out = { headline: null, summary: [], captions: {} };
  if (!proposal || typeof proposal !== 'object') return out;
  if (ok(proposal.headline)) out.headline = proposal.headline.trim();
  if (Array.isArray(proposal.summary)) out.summary = proposal.summary.filter(ok).slice(0, 4).map((s) => s.trim());
  const ids = new Set(briefing.tiles.map((t) => t.id));
  for (const [id, text] of Object.entries(proposal.captions || {})) if (ids.has(id) && ok(text)) out.captions[id] = text.trim();
  return out;
}
