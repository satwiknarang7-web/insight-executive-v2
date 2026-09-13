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
 * **Charts are not drawn.** They are rendered in the browser by Recharts and
 * there is no honest way to get them into a .pptx from here without running a
 * headless browser per slide. A slide that quietly dropped its chart would look
 * finished and be missing the evidence, so each one says what it is a picture
 * of and what the numbers under it were, and the PDF export — which does render
 * them — stays the way to get the visuals.
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

    // What the picture would have shown, named rather than drawn.
    const chartType = clean(entry?.chart?.chart_type);
    if (chartType) {
      slide.addText(`${chartType.toUpperCase()} · ${clean(entry?.chart?.title) || 'chart'}`, {
        x: 0.6, y: 1.85, w: 8.8, h: 0.3, fontSize: 9, bold: true, color: ACCENT,
      });
    }

    if (clean(entry?.markdownAnalysis)) {
      slide.addText(trim(entry.markdownAnalysis, 700), {
        x: 0.6, y: 2.2, w: 8.8, h: 1.9, fontSize: 11, color: MUTED, lineSpacingMultiple: 1.3, valign: 'top',
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
