import 'server-only';

/**
 * The analysis as a Word document.
 *
 * The third export, and the one with a different job from the other two. The
 * PDF is the report exactly as the screen drew it, fixed; the deck is the
 * findings cut up for a meeting. Word is for the report that gets *edited* —
 * pasted into a board pack, cut down to three findings, argued with in tracked
 * changes, and sent back. So this file optimises for a document somebody can
 * take apart: real heading styles so the navigation pane works, real tables so
 * the numbers can be copied into a cell, and no image anywhere.
 *
 * **Nothing here is a picture of a chart, and that is deliberate.** The obvious
 * way to put a chart in a .docx is to screenshot the Recharts render and embed
 * a PNG, which would mean a headless browser on the host — the one dependency
 * the PDF has and the reason the PDF is the export that fails first. It would
 * also produce the one thing an editable document must not contain: a figure
 * nobody downstream can change, at a fixed resolution, carrying numbers that
 * cannot be selected.
 *
 * What is drawn instead is a bar built out of Word's own table shading: a row
 * per category, a shaded cell whose width is the value's share of the largest
 * one, and the number beside it. It is a real bar chart to look at and a real
 * table to work with, it renders identically in Word, Pages, LibreOffice and
 * Google Docs, and the whole document is a few tens of kilobytes. The charts
 * this cannot honestly reduce to one value per category — a scatter, a bubble,
 * a two-measure composed chart — are not squeezed into bars; they get their
 * numbers, and the caption says which happened.
 *
 * Like the deck, every finding carries its evidence tier and the SQL behind it,
 * because the argument for this whole application is that a number can be
 * defended in the room, and it cannot be if the query stayed in the browser.
 */
import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  LineRuleType,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from 'docx';
import { findingsOnly } from '../storyboard.js';

/** The palette, as Word wants it: six hex digits, no hash. */
const INK = '1A1D21';
const MUTED = '6B7280';
const ACCENT = '0E9F8E';
const NEGATIVE = 'E05252';
const TRACK = 'F1F3F5';
const RULE = 'E5E7EB';
const PANEL = 'F8FAFB';

const TIER_LABEL = {
  strong: 'Strong evidence',
  moderate: 'Moderate evidence',
  indicative: 'Indicative',
  thin: 'Thin evidence',
};

/**
 * The chart types that are one value per category underneath.
 *
 * These become the shaded-bar table. Everything else — a scatter, a bubble, a
 * composed chart with two measures, a map, a matrix, a card — encodes something
 * a single bar cannot hold, so it falls through to its numbers rather than being
 * redrawn as a chart that says something different from the one on screen.
 */
const AS_BARS = new Set([
  'bar', 'hbar', 'line', 'area', 'pie', 'donut', 'radar',
  'treemap', 'funnel', 'waterfall', 'radial', 'gauge', 'ribbon',
]);

/** A document has more room than a slide, but not unlimited room. */
const MAX_BARS = 20;
const MAX_TABLE_ROWS = 12;
const MAX_TABLE_COLS = 5;

/**
 * Column widths in twips, absolute, because percentages do not survive nesting.
 *
 * The bar is a table inside a table cell, and a percentage width on a nested
 * table is resolved against something Word and LibreOffice do not agree about —
 * in practice the inner widths were dropped altogether and the two cells split
 * the track evenly, so every bar below the largest came out the same length.
 * A chart where a tenth and a half look identical is worse than no chart, and it
 * fails silently: the document opens, the table is there, and only the numbers
 * beside it show that the picture is wrong.
 *
 * Twips are exact and nest without argument. A4 is 11906 twips wide and the
 * margins take 1000 each side, so the text column is 9906, divided below.
 */
const TEXT_WIDTH = 9906;
const COL_LABEL = 3100;
const COL_TRACK = 5000;
const COL_VALUE = TEXT_WIDTH - COL_LABEL - COL_TRACK;

/** Short enough to read as "nearly nothing", long enough to be visible. */
const MIN_BAR = 60;

const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

/** Long prose has to stop somewhere, even in a document. */
function trim(text, max) {
  const s = clean(text);
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf(' '));
  return `${cut.slice(0, stop > max * 0.6 ? stop : max)}…`;
}

const asNumber = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = Number(String(v ?? '').replace(/[^0-9.eE+-]/g, ''));
  return Number.isFinite(n) ? n : null;
};

/** Numbers as a reader writes them, not as JavaScript prints them. */
function showNumber(n) {
  const abs = Math.abs(n);
  const digits = abs >= 100 ? 0 : abs >= 1 ? 1 : 3;
  return n.toLocaleString('en-US', { maximumFractionDigits: digits });
}

const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const NO_BORDERS = {
  top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER,
  insideHorizontal: NO_BORDER, insideVertical: NO_BORDER,
};
const HAIRLINE = { style: BorderStyle.SINGLE, size: 2, color: RULE };
const RULED = {
  top: HAIRLINE, bottom: HAIRLINE, left: HAIRLINE, right: HAIRLINE,
  insideHorizontal: HAIRLINE, insideVertical: HAIRLINE,
};
const TIGHT = { top: 20, bottom: 20, left: 80, right: 80 };

/** A paragraph of plain body text, or nothing when there is nothing to say. */
function body(text, { size = 21, color = INK, italics = false, after = 120 } = {}) {
  const s = clean(text);
  if (!s) return null;
  return new Paragraph({
    spacing: { after, line: 300, lineRule: LineRuleType.AUTO },
    children: [new TextRun({ text: s, size, color, italics })],
  });
}

/**
 * A gap between two blocks.
 *
 * Word tables carry no spacing of their own, so a paragraph that follows one
 * sits flush against its bottom border. An empty paragraph is the only thing
 * that separates them — and it has to be genuinely empty rather than a space,
 * because a space is text and inherits the line height of whatever follows.
 */
const spacer = (after = 120) => new Paragraph({ spacing: { before: 0, after }, children: [] });

/** The small grey all-caps line this app uses as a section label. */
function label(text, color = MUTED) {
  return new Paragraph({
    spacing: { after: 60 },
    children: [new TextRun({ text: clean(text).toUpperCase(), size: 15, bold: true, color, characterSpacing: 30 })],
  });
}

/** A cell, since every one of them wants the same four overrides. */
function cell(children, { width, fill, valign = VerticalAlign.CENTER, columnSpan } = {}) {
  return new TableCell({
    children,
    columnSpan,
    verticalAlign: valign,
    margins: TIGHT,
    width: width ? { size: width, type: WidthType.DXA } : undefined,
    shading: fill ? { type: ShadingType.CLEAR, color: 'auto', fill } : undefined,
  });
}

/** Text inside a cell, which needs its own paragraph in Word. */
function cellText(text, { bold = false, size = 18, color = INK, align = AlignmentType.START, mono = false } = {}) {
  return new Paragraph({
    alignment: align,
    spacing: { before: 0, after: 0 },
    children: [new TextRun({ text: clean(text) || ' ', bold, size, color, font: mono ? 'Consolas' : undefined })],
  });
}

/**
 * One bar, as two shaded cells in a nested single-row table.
 *
 * Word has no bar primitive, but it does have cell shading and percentage
 * widths, and those are enough: the filled cell *is* the bar. The empty cell
 * behind it is shaded a pale grey so a short bar still reads as a short bar
 * rather than as a missing one.
 *
 * The width is a share of the largest magnitude in the chart, not of the total,
 * so the longest bar fills the track and the rest are read against it — which
 * is how the chart on screen is read too. A negative value is drawn at its
 * magnitude in red, because the alternative is a bar of length zero for the
 * number the reader most wants to see.
 */
function barCells(share, negative) {
  const inner = COL_TRACK - TIGHT.left - TIGHT.right;
  const filled = Math.max(MIN_BAR, Math.min(inner, Math.round(share * inner)));
  const rest = inner - filled;
  const blank = [new Paragraph({ spacing: { before: 0, after: 0 }, children: [new TextRun({ text: ' ', size: 12 })] })];

  const widths = rest > 0 ? [filled, rest] : [filled];
  const cells = [cellFlush(blank, filled, negative ? NEGATIVE : ACCENT)];
  if (rest > 0) cells.push(cellFlush(blank, rest, TRACK));

  return new Table({
    layout: TableLayoutType.FIXED,
    width: { size: inner, type: WidthType.DXA },
    columnWidths: widths,
    borders: NO_BORDERS,
    rows: [new TableRow({ children: cells })],
  });
}

/**
 * A bar segment: no padding, so the shading is the length and nothing else.
 *
 * The ordinary cell margins would add about a millimetre of unshaded space to
 * each end of every bar, which is a constant error on a varying quantity — the
 * shortest bars would be proportionally most wrong.
 */
function cellFlush(children, width, fill) {
  return new TableCell({
    children,
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
    width: { size: width, type: WidthType.DXA },
    shading: { type: ShadingType.CLEAR, color: 'auto', fill },
  });
}

/**
 * The points a chart is made of, taken from its own computed results.
 *
 * No recomputation: these are the rows the query returned and the engine
 * analysed, so the document cannot disagree with the finding printed beside it.
 * The order is the chart's own — a line over twelve months stays in month
 * order, because sorting it by size would turn a trend into a ranking.
 */
function chartSeries(chart) {
  const rows = Array.isArray(chart?.resultData) ? chart.resultData : [];
  const xKey = chart?.xAxisKey;
  const yKey = chart?.yAxisKey;
  if (!rows.length || !xKey || !yKey) return null;

  const points = [];
  for (const row of rows.slice(0, MAX_BARS)) {
    const value = asNumber(row?.[yKey]);
    if (value === null) continue;
    points.push({ label: trim(String(row?.[xKey] ?? ''), 40) || '—', value });
  }
  if (points.length < 2) return null;

  const peak = Math.max(...points.map((p) => Math.abs(p.value)));
  return {
    points,
    peak,
    measure: clean(yKey),
    dimension: clean(xKey),
    truncated: rows.length > MAX_BARS,
  };
}

/** The chart as a bar table: category, bar, number. */
function barChart(series) {
  const header = new TableRow({
    tableHeader: true,
    children: [
      cell([cellText(series.dimension, { bold: true, size: 16, color: MUTED })], { width: COL_LABEL, fill: PANEL }),
      cell([cellText(' ', { size: 16 })], { width: COL_TRACK, fill: PANEL }),
      cell([cellText(series.measure, { bold: true, size: 16, color: MUTED, align: AlignmentType.END })], { width: COL_VALUE, fill: PANEL }),
    ],
  });

  const rows = series.points.map((point) => {
    const share = series.peak > 0 ? Math.abs(point.value) / series.peak : 0;
    return new TableRow({
      children: [
        cell([cellText(point.label)], { width: COL_LABEL }),
        cell([barCells(share, point.value < 0)], { width: COL_TRACK }),
        cell([cellText(showNumber(point.value), { align: AlignmentType.END, bold: true })], { width: COL_VALUE }),
      ],
    });
  });

  return new Table({
    layout: TableLayoutType.FIXED,
    width: { size: TEXT_WIDTH, type: WidthType.DXA },
    columnWidths: [COL_LABEL, COL_TRACK, COL_VALUE],
    borders: { ...RULED, insideVertical: NO_BORDER },
    rows: [header, ...rows],
  });
}

/** The chart as its numbers, for the shapes a bar would misrepresent. */
function dataTable(chart) {
  const rows = Array.isArray(chart?.resultData) ? chart.resultData.slice(0, MAX_TABLE_ROWS) : [];
  if (!rows.length) return null;

  const keys = Object.keys(rows[0]).slice(0, MAX_TABLE_COLS);
  if (!keys.length) return null;
  const width = Math.floor(TEXT_WIDTH / keys.length);

  const header = new TableRow({
    tableHeader: true,
    children: keys.map((key) =>
      cell([cellText(trim(key, 28), { bold: true, size: 16, color: MUTED })], { width, fill: PANEL })
    ),
  });

  const lines = rows.map(
    (row) =>
      new TableRow({
        children: keys.map((key) => {
          const raw = row?.[key];
          const n = asNumber(raw);
          const text = typeof raw === 'number' && n !== null ? showNumber(n) : trim(String(raw ?? ''), 40);
          return cell([cellText(text, { align: typeof raw === 'number' ? AlignmentType.END : AlignmentType.START })], { width });
        }),
      })
  );

  return new Table({
    layout: TableLayoutType.FIXED,
    width: { size: width * keys.length, type: WidthType.DXA },
    columnWidths: keys.map(() => width),
    borders: RULED,
    rows: [header, ...lines],
  });
}

/**
 * Draw the finding, and say what was drawn.
 *
 * The caption is written from what actually happened rather than from what was
 * intended — a reader holding this next to the screen should find the
 * difference explained instead of having to notice it.
 */
function figure(chart) {
  const type = clean(chart?.chart_type).toLowerCase();
  const series = AS_BARS.has(type) ? chartSeries(chart) : null;

  if (series) {
    // A caption that only says "BAR" above a bar chart tells the reader nothing
    // they cannot see. It appears when the picture is not the one the screen
    // drew, or not all of it — which is the only time it is worth the line.
    const notes = [
      type === 'bar' || type === 'hbar' ? null : `${type.toUpperCase()} · drawn as bars, in the chart’s own order`,
      series.truncated ? `first ${MAX_BARS} of ${chart.resultData.length}` : null,
    ].filter(Boolean);
    return { block: barChart(series), caption: notes.join(' · ') };
  }

  const table = dataTable(chart);
  if (table) {
    const rowCount = chart?.resultData?.length || 0;
    const notes = [
      type ? type.toUpperCase() : null,
      AS_BARS.has(type) ? 'shown as its numbers' : 'shown as its numbers — a bar would say something this chart does not',
      rowCount > MAX_TABLE_ROWS ? `first ${MAX_TABLE_ROWS} of ${rowCount}` : null,
    ].filter(Boolean);
    return { block: table, caption: notes.join(' · ') };
  }

  return { block: null, caption: '' };
}

/** The KPI strip, as a row of figures under the title. */
function kpiTable(kpis) {
  const shown = kpis.filter((k) => clean(k?.label) && clean(k?.value)).slice(0, 4);
  if (!shown.length) return null;
  const width = Math.floor(TEXT_WIDTH / shown.length);

  return new Table({
    layout: TableLayoutType.FIXED,
    width: { size: width * shown.length, type: WidthType.DXA },
    columnWidths: shown.map(() => width),
    borders: NO_BORDERS,
    rows: [
      new TableRow({
        children: shown.map((kpi) =>
          cell(
            [
              cellText(kpi.value, { bold: true, size: 32, color: ACCENT }),
              cellText(clean(kpi.label).toUpperCase(), { size: 14, color: MUTED }),
            ],
            { width, fill: PANEL, valign: VerticalAlign.TOP }
          )
        ),
      }),
    ],
  });
}

/** Focus / Risk / Opportunity, when the engine had something to put in them. */
function scorecard(card) {
  const entries = [
    ['Focus', card?.focus],
    ['Risk', card?.risk],
    ['Opportunity', card?.opportunity],
  ].filter(([, text]) => clean(text));
  if (!entries.length) return null;

  const heads = 2200;
  return new Table({
    layout: TableLayoutType.FIXED,
    width: { size: TEXT_WIDTH, type: WidthType.DXA },
    columnWidths: [heads, TEXT_WIDTH - heads],
    borders: RULED,
    rows: entries.map(
      ([heading, text]) =>
        new TableRow({
          children: [
            cell([cellText(heading.toUpperCase(), { bold: true, size: 15, color: ACCENT })], { width: heads, fill: PANEL, valign: VerticalAlign.TOP }),
            cell([cellText(trim(text, 400))], { width: TEXT_WIDTH - heads, valign: VerticalAlign.TOP }),
          ],
        }),
    ),
  });
}

/**
 * Build the document.
 *
 * Returns a Node Buffer, so the route can hand it straight back with a
 * Content-Disposition and nothing in between.
 */
export async function renderAnalysisDocx(analysis, { fileName = null, rowCount = null } = {}) {
  const summary = analysis?.slideZero || {};
  // A section per finding, and a filter tile is not one — see `findingsOnly`.
  const storyboard = findingsOnly(Array.isArray(analysis?.storyboard) ? analysis.storyboard : []);
  const kpis = Array.isArray(analysis?.kpis) ? analysis.kpis : [];
  const generated = new Date(analysis?.generatedAt || Date.now());

  const children = [];
  const push = (block) => {
    if (block) children.push(block);
  };

  // ---- Cover ------------------------------------------------------------
  push(label('Analysis report'));
  push(
    new Paragraph({
      heading: HeadingLevel.TITLE,
      spacing: { after: 160 },
      children: [new TextRun({ text: clean(summary.title) || 'Executive Summary', size: 52, bold: true, color: INK })],
    })
  );
  push(body(summary.headline, { size: 24, color: MUTED, after: 220 }));

  const meta = [
    fileName ? `Source: ${clean(fileName)}` : null,
    Number.isFinite(rowCount) ? `${rowCount.toLocaleString()} rows analysed` : null,
    `${storyboard.length} finding${storyboard.length === 1 ? '' : 's'}`,
    generated.toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' }),
  ].filter(Boolean);
  push(body(meta.join('  ·  '), { size: 17, color: MUTED, after: 200 }));

  // A report of a slice says so on its cover. Everything below was computed
  // over those rows, and a reader handed the file tomorrow has no other way
  // to find that out.
  if (clean(analysis?.filter?.description)) {
    push(
      new Table({
        layout: TableLayoutType.FIXED,
        width: { size: TEXT_WIDTH, type: WidthType.DXA },
        columnWidths: [TEXT_WIDTH],
        borders: RULED,
        rows: [
          new TableRow({
            children: [
              cell(
                [
                  cellText(
                    `Filtered: ${clean(analysis.filter.description)} — ${Number(analysis.filter.rowCount || 0).toLocaleString()} of ${Number(rowCount || 0).toLocaleString()} rows.`,
                    { size: 18 }
                  ),
                ],
                { width: TEXT_WIDTH, fill: PANEL }
              ),
            ],
          }),
        ],
      })
    );
    push(spacer(120));
  }

  const strip = kpiTable(kpis);
  if (strip) {
    push(strip);
    push(spacer(120));
  }

  // ---- Executive summary ------------------------------------------------
  const insights = Array.isArray(summary.macroInsights) ? summary.macroInsights.filter((x) => clean(x)) : [];
  const caveats = Array.isArray(summary.caveats) ? summary.caveats.filter((x) => clean(x)) : [];

  if (insights.length || caveats.length || scorecard(summary.strategicScorecard)) {
    push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: 'Executive summary' })] }));
  }

  for (const line of insights) {
    push(
      new Paragraph({
        bullet: { level: 0 },
        spacing: { after: 80, line: 300 },
        children: [new TextRun({ text: clean(line), size: 21, color: INK })],
      })
    );
  }

  // The sentences that stop a truncated share being read as a market share.
  // This is the copy that gets forwarded, so it is the copy that most needs
  // them — and in an editable document it is also the copy most likely to be
  // deleted, which is exactly why it is not a footnote.
  if (caveats.length) {
    push(spacer(160));
    push(label('What these figures do and do not cover', ACCENT));
    for (const line of caveats) {
      push(body(line, { size: 18, color: MUTED, italics: true, after: 60 }));
    }
  }

  const card = scorecard(summary.strategicScorecard);
  if (card) {
    push(spacer(160));
    push(card);
  }

  // ---- Findings ---------------------------------------------------------
  storyboard.forEach((entry, i) => {
    const findings = entry?.findings || {};
    const metrics = findings?.metrics || {};

    push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        pageBreakBefore: true,
        children: [new TextRun({ text: `${i + 1}. ${clean(entry?.pageTitle) || `Finding ${i + 1}`}` })],
      })
    );

    push(body(findings.headline, { size: 23, after: 180 }));

    const drawn = figure(entry?.chart);
    push(drawn.block);
    if (drawn.caption) {
      push(
        new Paragraph({
          spacing: { before: 80, after: 200 },
          children: [new TextRun({ text: drawn.caption, size: 15, bold: true, color: ACCENT })],
        })
      );
    } else if (drawn.block) {
      push(spacer(200));
    }

    push(body(entry?.insight_anchor, { size: 21 }));
    push(body(entry?.insight_implication, { size: 20, color: MUTED }));
    if (clean(entry?.insight_question)) {
      push(
        new Paragraph({
          spacing: { before: 60, after: 140, line: 300, lineRule: LineRuleType.AUTO },
          border: { left: { style: BorderStyle.SINGLE, size: 12, color: ACCENT, space: 8 } },
          indent: { left: 160 },
          children: [new TextRun({ text: clean(entry.insight_question), size: 20, italics: true, color: MUTED })],
        })
      );
    }

    // The metrics the engine checked, stated as it checked them.
    const facts = Array.isArray(findings.verifiedFacts) ? findings.verifiedFacts.filter(Boolean) : [];
    if (facts.length) {
      push(label('Verified metrics'));
      for (const fact of facts) {
        push(
          new Paragraph({
            spacing: { after: 40 },
            children: [new TextRun({ text: clean(fact), size: 17, color: MUTED, font: 'Consolas' })],
          })
        );
      }
      push(spacer(60));
    }

    // The tier, and why. Both, because the tier alone is a label and the
    // reasons are what let somebody disagree with it.
    const tier = TIER_LABEL[metrics.evidence] || '';
    const notes = Array.isArray(metrics.evidenceNotes) ? metrics.evidenceNotes.filter(Boolean) : [];
    if (tier || notes.length) {
      push(
        new Paragraph({
          spacing: { before: 60, after: 80 },
          children: [
            tier ? new TextRun({ text: tier, size: 17, bold: true, color: ACCENT }) : null,
            notes.length ? new TextRun({ text: `  ${trim(notes.join('; '), 400)}`, size: 17, color: MUTED }) : null,
          ].filter(Boolean),
        })
      );
    }

    // The query. The reason this document is different from any other document.
    const sql = clean(entry?.chart?.sql);
    if (sql) {
      push(label('Query'));
      push(
        new Paragraph({
          spacing: { after: 60 },
          children: [new TextRun({ text: trim(sql, 600), size: 15, color: MUTED, font: 'Consolas' })],
        })
      );
    }
  });

  // ---- Footer note ------------------------------------------------------
  push(
    new Paragraph({
      spacing: { before: 320 },
      border: { top: { style: BorderStyle.SINGLE, size: 2, color: RULE, space: 10 } },
      children: [
        new TextRun({
          text: 'Every figure in this report was computed from SQL queries run over the cleaned dataset in the browser.',
          size: 15,
          color: MUTED,
        }),
      ],
    })
  );

  const doc = new Document({
    creator: 'Insight Executive',
    title: clean(summary.title) || 'Insight Executive report',
    description: clean(summary.headline) || undefined,
    styles: {
      default: {
        /**
         * `lineRule: AUTO` makes `line` a multiple of the font size (300/240 =
         * 1.25 lines). Left at Word's default of `exact` it is a fixed 15pt,
         * which is shorter than the 26pt title — so the title's two lines were
         * drawn on top of each other and on top of the label above them.
         */
        document: {
          run: { font: 'Calibri', size: 21, color: INK },
          paragraph: { spacing: { line: 300, lineRule: LineRuleType.AUTO } },
        },
        title: { run: { font: 'Calibri', size: 52, bold: true, color: INK } },
        heading1: {
          run: { font: 'Calibri', size: 30, bold: true, color: INK },
          paragraph: { spacing: { before: 320, after: 160 } },
        },
        heading2: {
          run: { font: 'Calibri', size: 24, bold: true, color: INK },
          paragraph: { spacing: { before: 240, after: 120 } },
        },
      },
    },
    sections: [
      {
        properties: { page: { margin: { top: 1000, right: 1000, bottom: 1000, left: 1000 } } },
        children,
      },
    ],
  });

  return Packer.toBuffer(doc);
}

/** A filename someone can find again, without the characters Windows refuses. */
export function docxFilename(title) {
  const base = clean(title) || 'Insight Executive';
  const safe = base
    .replace(/\.(csv|tsv|txt|xlsx?|xlsm)$/i, '')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  const day = new Date().toISOString().slice(0, 10);
  return `${safe || 'Insight Executive'} ${day}.docx`;
}
