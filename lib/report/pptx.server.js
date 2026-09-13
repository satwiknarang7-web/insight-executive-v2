/**
 * The analysis as a PowerPoint deck.
 *
 * A deck rather than a document, because it is going to a meeting: one finding
 * per slide, the headline as the title, the prose beneath it, and — the part
 * that makes it worth exporting from here rather than screenshotting — the
 * evidence tier and the query on the slide itself.
 *
 * That last decision is the whole character of the file. Every other tool
 * produces a slide with a number on it; the argument for this one is that the
 * number can be defended in the room, and it cannot be if the SQL stayed in the
 * browser. So the query goes on the slide, small and grey, where somebody who
 * asks "where does that come from" can be answered by pointing rather than by
 * promising to check.
 *
 * Charts are **native PowerPoint charts**, not pictures of them. The screen
 * draws with Recharts and the obvious route would have been to photograph that,
 * which would have meant a headless browser per slide and a blurred bitmap at
 * the end of it. It was never necessary: by the time a finding exists its
 * numbers have already been computed, and those numbers are what a .pptx chart
 * is made of. So the deck carries real chart objects — clickable, editable,
 * recolourable by whoever receives them, and a few kilobytes rather than a few
 * megabytes.
 *
 * Some of this app's chart types have no PowerPoint equivalent. A treemap, a
 * funnel, a waterfall and a radial bar are all one value per category underneath,
 * so they are drawn as bars and the slide says so rather than pretending. The
 * ones that are not charts at all — tables, cards, matrices — become a table of
 * the same rows.
 */
import PptxGenJS from 'pptxgenjs';

/** Grey enough to read as a footnote, dark enough to actually read. */
const INK = '1A1D21';
const MUTED = '6B7280';
const ACCENT = '0E9F8E';
const RULE = 'E5E7EB';

const TIER_LABEL = {
  strong: 'Strong evidence',
  moderate: 'Moderate evidence',
  indicative: 'Indicative',
  thin: 'Thin evidence',
};

const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

/** Long prose has to stop somewhere, and a slide is not a document. */
function trim(text, max) {
  const s = clean(text);
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf(' '));
  return `${cut.slice(0, stop > max * 0.6 ? stop : max)}…`;
}

function addFooter(slide, index, total) {
  slide.addText(`${index} / ${total}`, {
    x: 8.6, y: 5.0, w: 0.8, h: 0.3, align: 'right',
    fontSize: 9, color: MUTED,
  });
}

/**
 * How each of this app's chart types is drawn in PowerPoint.
 *
 * `null` means there is no chart to draw — a table, a card, a KPI strip — and
 * the slide gets a table of the rows instead, which is what those were showing
 * anyway.
 *
 * The approximations are deliberate and are named on the slide. A treemap, a
 * funnel, a waterfall and a radial bar all encode one value per category; drawn
 * as bars they say the same thing in a form PowerPoint can render natively, and
 * claiming otherwise would be the dishonest option. What is not approximated is
 * anything whose shape carries meaning a bar cannot hold — a map is not a
 * ranking, so it falls through to its numbers.
 */
const CHART_KIND = {
  bar: { type: 'bar', barDir: 'col' },
  hbar: { type: 'bar', barDir: 'bar' },
  line: { type: 'line' },
  area: { type: 'area' },
  pie: { type: 'pie' },
  donut: { type: 'doughnut' },
  radar: { type: 'radar' },
  scatter: { type: 'bar', barDir: 'col', approximated: true },
  bubble: { type: 'bar', barDir: 'col', approximated: true },
  composed: { type: 'bar', barDir: 'col', approximated: true },
  treemap: { type: 'bar', barDir: 'bar', approximated: true },
  funnel: { type: 'bar', barDir: 'bar', approximated: true },
  waterfall: { type: 'bar', barDir: 'col', approximated: true },
  radial: { type: 'bar', barDir: 'bar', approximated: true },
  gauge: { type: 'bar', barDir: 'bar', approximated: true },
  ribbon: { type: 'bar', barDir: 'col', approximated: true },
};

/** Charts wider than this stop being readable at slide size. */
const MAX_POINTS = 14;

const asNumber = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = Number(String(v ?? '').replace(/[^0-9.eE+-]/g, ''));
  return Number.isFinite(n) ? n : null;
};

/**
 * The points a chart is made of, taken from its own computed results.
 *
 * No recomputation and no second opinion: these are the rows the query
 * returned and the engine analysed, so the slide cannot disagree with the
 * finding printed beside it.
 */
function chartSeries(chart) {
  const rows = Array.isArray(chart?.resultData) ? chart.resultData : [];
  const xKey = chart?.xAxisKey;
  const yKey = chart?.yAxisKey;
  if (!rows.length || !xKey || !yKey) return null;

  const labels = [];
  const values = [];
  for (const row of rows.slice(0, MAX_POINTS)) {
    const value = asNumber(row?.[yKey]);
    if (value === null) continue;
    labels.push(trim(String(row?.[xKey] ?? ''), 28) || '—');
    values.push(value);
  }
  if (values.length < 2) return null;

  return {
    labels,
    values,
    name: trim(String(yKey), 40),
    truncated: rows.length > MAX_POINTS,
  };
}

/**
 * Draw the finding, or show its numbers.
 *
 * Returns what the slide should say about the picture, so the caption is
 * written by whatever actually happened rather than by what was intended.
 */
function addFigure(pptx, slide, chart, box) {
  const series = chartSeries(chart);
  const kind = CHART_KIND[String(chart?.chart_type || '').toLowerCase()];

  if (series && kind) {
    slide.addChart(
      kind.type,
      [{ name: series.name, labels: series.labels, values: series.values }],
      {
        ...box,
        barDir: kind.barDir,
        chartColors: [ACCENT, '4C6EF5', 'F59E0B', 'EF4444', '8B5CF6', '14B8A6'],
        showLegend: kind.type === 'pie' || kind.type === 'doughnut',
        legendPos: 'b',
        legendFontSize: 8,
        showValue: false,
        catAxisLabelFontSize: 8,
        valAxisLabelFontSize: 8,
        catAxisLabelRotate: kind.barDir === 'col' && series.labels.length > 6 ? 45 : 0,
        dataBorder: { pt: 0, color: 'FFFFFF' },
        holeSize: kind.type === 'doughnut' ? 55 : undefined,
      }
    );
    return { drawn: true, approximated: kind.approximated === true, truncated: series.truncated };
  }

  // No chart PowerPoint can draw, or nothing numeric to draw. The rows are
  // what the reader wanted either way.
  const rows = Array.isArray(chart?.resultData) ? chart.resultData.slice(0, 8) : [];
  if (!rows.length) return { drawn: false };

  const keys = Object.keys(rows[0]).slice(0, 4);
  slide.addTable(
    [
      keys.map((k) => ({ text: trim(k, 24), options: { bold: true, color: INK, fill: 'F3F4F6' } })),
      ...rows.map((row) => keys.map((k) => ({ text: trim(String(row?.[k] ?? ''), 24), options: { color: MUTED } }))),
    ],
    { ...box, fontSize: 8, border: { type: 'solid', color: RULE, pt: 0.5 }, autoPage: false }
  );
  return { drawn: true, asTable: true };
}

/**
 * Build the deck.
 *
 * Returns a Node Buffer, so the route can hand it straight back with a
 * Content-Disposition and nothing in between.
 */
export async function renderAnalysisPptx(analysis, { fileName = null } = {}) {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_16x9';
  pptx.author = 'Insight Executive';
  pptx.company = 'Insight Executive';

  const summary = analysis?.slideZero || {};
  const storyboard = Array.isArray(analysis?.storyboard) ? analysis.storyboard : [];
  const kpis = Array.isArray(analysis?.kpis) ? analysis.kpis : [];
  const total = storyboard.length + 1;

  // ---- Title ------------------------------------------------------------
  const title = pptx.addSlide();
  title.addText(clean(summary.title) || 'Executive Summary', {
    x: 0.6, y: 1.6, w: 8.8, h: 0.9, fontSize: 34, bold: true, color: INK,
  });
  if (clean(summary.headline)) {
    title.addText(trim(summary.headline, 260), {
      x: 0.6, y: 2.5, w: 8.8, h: 1.2, fontSize: 15, color: MUTED, lineSpacingMultiple: 1.3,
    });
  }
  if (fileName) {
    title.addText(clean(fileName), { x: 0.6, y: 4.7, w: 8.8, h: 0.3, fontSize: 10, color: MUTED });
  }

  // The KPI strip, if there is one, as the title slide's evidence that
  // something was actually measured.
  const shown = kpis.filter((k) => clean(k?.label) && clean(k?.value)).slice(0, 4);
  shown.forEach((kpi, i) => {
    const x = 0.6 + i * 2.2;
    title.addText(clean(kpi.value), { x, y: 3.7, w: 2.0, h: 0.4, fontSize: 20, bold: true, color: ACCENT });
    title.addText(clean(kpi.label).toUpperCase(), { x, y: 4.1, w: 2.0, h: 0.3, fontSize: 8, color: MUTED });
  });

  // ---- Findings ---------------------------------------------------------
  storyboard.forEach((entry, i) => {
    const slide = pptx.addSlide();
    const findings = entry?.findings || {};
    const metrics = findings?.metrics || {};

    slide.addText(clean(entry?.pageTitle) || `Finding ${i + 1}`, {
      x: 0.6, y: 0.45, w: 8.8, h: 0.5, fontSize: 20, bold: true, color: INK,
    });

    if (clean(findings.headline)) {
      slide.addText(trim(findings.headline, 220), {
        x: 0.6, y: 1.0, w: 8.8, h: 0.8, fontSize: 14, color: INK, lineSpacingMultiple: 1.25,
      });
    }

    const figure = addFigure(pptx, slide, entry?.chart, { x: 0.55, y: 1.75, w: 5.3, h: 2.3 });

    // What the picture is, and — when it is not the picture the screen drew —
    // what was done about it. A reader comparing the deck to the app should
    // find the difference explained rather than have to notice it.
    const chartType = clean(entry?.chart?.chart_type);
    const caption = [
      chartType ? chartType.toUpperCase() : null,
      figure.asTable ? 'shown as a table' : null,
      figure.approximated ? 'drawn as bars — PowerPoint has no such chart' : null,
      figure.truncated ? `top ${MAX_POINTS}` : null,
    ]
      .filter(Boolean)
      .join(' · ');
    if (caption) {
      slide.addText(caption, {
        x: 0.55, y: 4.05, w: 5.3, h: 0.25, fontSize: 8, bold: true, color: ACCENT,
      });
    }

    // The prose moves beside the chart when there is one, and keeps the full
    // width when there is not.
    if (clean(entry?.markdownAnalysis)) {
      const beside = figure.drawn;
      slide.addText(trim(entry.markdownAnalysis, beside ? 460 : 700), {
        x: beside ? 6.1 : 0.6,
        y: 1.75,
        w: beside ? 3.3 : 8.8,
        h: 2.3,
        fontSize: beside ? 10 : 11,
        color: MUTED,
        lineSpacingMultiple: 1.25,
        valign: 'top',
      });
    }

    slide.addShape(pptx.ShapeType.line, { x: 0.6, y: 4.15, w: 8.8, h: 0, line: { color: RULE, width: 1 } });

    // The tier, and why. Both, because the tier alone is a label and the
    // reasons are what let somebody disagree with it.
    const tier = TIER_LABEL[metrics.evidence] || '';
    const notes = Array.isArray(metrics.evidenceNotes) ? metrics.evidenceNotes.filter(Boolean) : [];
    if (tier || notes.length) {
      slide.addText(
        [
          tier ? { text: tier, options: { bold: true, color: ACCENT } } : null,
          notes.length ? { text: `  ${trim(notes.join('; '), 240)}`, options: { color: MUTED } } : null,
        ].filter(Boolean),
        { x: 0.6, y: 4.25, w: 8.8, h: 0.35, fontSize: 9 }
      );
    }

    // The query. The reason this deck is different from any other deck.
    const sql = clean(entry?.chart?.sql);
    if (sql) {
      slide.addText(trim(sql, 300), {
        x: 0.6, y: 4.6, w: 7.8, h: 0.35, fontSize: 7, color: MUTED, fontFace: 'Consolas',
      });
    }

    addFooter(slide, i + 2, total);
  });

  // `nodebuffer` rather than a base64 string: the route streams it straight out
  // and a 3MB deck does not need to pass through a 4MB string on the way.
  return pptx.write({ outputType: 'nodebuffer' });
}

/** A filename someone can find again, without the characters Windows refuses. */
export function pptxFilename(title) {
  const base = clean(title) || 'Insight Executive';
  const safe = base.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  const day = new Date().toISOString().slice(0, 10);
  return `${safe || 'Insight Executive'} ${day}.pptx`;
}
