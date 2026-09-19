import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import JSZip from 'jszip';

/**
 * The Word export, checked by opening the file it produces.
 *
 * A .docx is a zip of XML, so these tests unzip it and read `word/document.xml`
 * rather than trusting the builder's return value. That matters here more than
 * it usually would: the figures are drawn out of table shading and cell widths,
 * and every one of those is a piece of XML that is either right or silently
 * absent — a bar chart with no `w:shd` renders as an empty table and nothing
 * throws.
 *
 * The loader below is what lets this be a behavioural test rather than a source
 * reading. `lib/report/docx.server.js` opens with `import 'server-only'`, a
 * build-time tripwire Next resolves and plain Node has never heard of; the
 * loader answers that one specifier with an empty module. See
 * `tests/support/serverOnlyLoader.mjs`.
 */
register('./support/serverOnlyLoader.mjs', import.meta.url);
const { renderAnalysisDocx, docxFilename } = await import('../lib/report/docx.server.js');

/**
 * The bars, read back off the nested table grids.
 *
 * A bar is a one-row table of one or two columns — the filled part and, unless
 * it fills the track, the empty remainder — and it is the only table in the
 * document whose cells carry the accent or the negative fill. The summary and
 * scorecard tables are also two columns wide, so the fill is what tells them
 * apart, not the shape.
 */
function barWidths(xml) {
  return [...xml.matchAll(/<w:tblGrid>((?:<w:gridCol w:w="\d+"\/>)+)<\/w:tblGrid>/g)]
    .filter((m) => /w:fill="(0E9F8E|E05252)"/.test(xml.slice(m.index, m.index + 600)))
    .map((m) => [...m[1].matchAll(/w:w="(\d+)"/g)].map((g) => Number(g[1])))
    .map(([filled, rest = 0]) => ({ filled, rest, share: filled / (filled + rest) }));
}

/** Unzip the document and hand back the part that holds the text. */
async function openDocx(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const names = Object.keys(zip.files);
  const xml = await zip.file('word/document.xml').async('string');
  return { names, xml, text: xml.replace(/<[^>]+>/g, '') };
}

const analysis = {
  generatedAt: '2026-01-15T10:00:00.000Z',
  slideZero: {
    title: 'Revenue concentrates in two regions',
    headline: 'North and West carry 71% of billings.',
    macroInsights: ['North bills 2.4x the median region.', 'Churn is flat everywhere except South.'],
    caveats: ['Shares are of the top ten regions, not of the business.'],
    strategicScorecard: { focus: 'Protect North.', risk: 'South is thinning.', opportunity: 'West is under-served.' },
  },
  kpis: [
    { label: 'Total revenue', value: '$4.2M' },
    { label: 'Regions', value: '12' },
  ],
  storyboard: [
    {
      id: 'c1',
      pageTitle: 'Revenue by region',
      markdownAnalysis: 'Long prose about regions.',
      insight_anchor: 'North bills more than South and East combined.',
      insight_implication: 'One account team carries the quarter.',
      insight_question: 'What happens if North slips?',
      findings: {
        headline: 'North leads by a wide margin.',
        verifiedFacts: ['SUM(revenue) WHERE region = North = 1,840,000'],
        metrics: { evidence: 'strong', evidenceNotes: ['n = 4,120', 'stable across quarters'] },
      },
      chart: {
        chart_type: 'bar',
        xAxisKey: 'region',
        yAxisKey: 'revenue',
        sql: 'SELECT region, SUM(revenue) AS revenue FROM t GROUP BY region',
        resultData: [
          { region: 'North', revenue: 1840000 },
          { region: 'West', revenue: 1130000 },
          { region: 'South', revenue: -220000 },
        ],
      },
    },
  ],
};

test('produces a real .docx with the parts Word needs', async () => {
  const { names, text } = await openDocx(await renderAnalysisDocx(analysis, { fileName: 'sales.csv', rowCount: 4120 }));

  assert.ok(names.includes('[Content_Types].xml'), 'no content-types part');
  assert.ok(names.includes('word/document.xml'), 'no document part');
  assert.ok(names.includes('word/styles.xml'), 'no styles part');

  assert.match(text, /Revenue concentrates in two regions/);
  assert.match(text, /sales\.csv/);
  assert.match(text, /4,120 rows analysed/);
});

test('carries the summary, the caveats and the scorecard', async () => {
  const { text } = await openDocx(await renderAnalysisDocx(analysis, { fileName: 'sales.csv', rowCount: 4120 }));

  assert.match(text, /North bills 2\.4x the median region/);
  // The caveat is the sentence that stops a truncated share being read as a
  // market share, so its absence is a correctness bug, not a cosmetic one.
  assert.match(text, /Shares are of the top ten regions/);
  assert.match(text, /Protect North/);
  assert.match(text, /South is thinning/);
});

test('carries each finding with its evidence tier and its query', async () => {
  const { text } = await openDocx(await renderAnalysisDocx(analysis, { fileName: 'sales.csv', rowCount: 4120 }));

  assert.match(text, /1\. Revenue by region/);
  assert.match(text, /North leads by a wide margin/);
  assert.match(text, /What happens if North slips\?/);
  assert.match(text, /Strong evidence/);
  assert.match(text, /n = 4,120; stable across quarters/);
  assert.match(text, /SELECT region, SUM\(revenue\)/);
});

test('draws a bar chart out of shaded cells, scaled to the largest value', async () => {
  const { xml, text } = await openDocx(await renderAnalysisDocx(analysis, { fileName: 'sales.csv', rowCount: 4120 }));

  // The accent fill is the bar itself. No shading means an empty table where a
  // chart should be, which renders without error and says nothing.
  assert.ok(xml.includes('w:fill="0E9F8E"'), 'no accent-shaded bar cells');
  // A negative value is drawn at its magnitude in red rather than as no bar.
  assert.ok(xml.includes('w:fill="E05252"'), 'negative value was not drawn in red');

  // Widths are a share of the largest magnitude, not of the total. This reads
  // them back off the nested grids rather than off the source, because the
  // failure it exists to catch was exactly that: percentage widths inside a
  // nested table were dropped on the way out, every bar below the largest came
  // out the same length, and nothing threw.
  const bars = barWidths(xml);
  assert.equal(bars.length, 3, `expected three bars, found ${bars.length}`);

  const [north, west, south] = bars;
  assert.equal(north.rest, 0, 'the peak bar does not fill its track');
  assert.ok(
    Math.abs(west.share - 1130000 / 1840000) < 0.01,
    `West is ${(west.share * 100).toFixed(0)}% of the track, expected 61%`
  );
  // A negative value is drawn at its magnitude, not at zero.
  assert.ok(
    Math.abs(south.share - 220000 / 1840000) < 0.01,
    `South is ${(south.share * 100).toFixed(0)}% of the track, expected 12%`
  );

  assert.match(text, /1,840,000/);
  assert.match(text, /North/);
});

test('shows a scatter as its numbers rather than as bars', async () => {
  const scatter = {
    ...analysis,
    storyboard: [
      {
        ...analysis.storyboard[0],
        chart: {
          chart_type: 'scatter',
          xAxisKey: 'spend',
          yAxisKey: 'revenue',
          resultData: [
            { spend: 10, revenue: 100 },
            { spend: 20, revenue: 260 },
          ],
        },
      },
    ],
  };
  const { text } = await openDocx(await renderAnalysisDocx(scatter, { fileName: 'sales.csv', rowCount: 10 }));

  assert.match(text, /SCATTER/);
  assert.match(text, /a bar would say something this chart does not/);
});

test('a line chart keeps its own order instead of being ranked', async () => {
  const line = {
    ...analysis,
    storyboard: [
      {
        ...analysis.storyboard[0],
        chart: {
          chart_type: 'line',
          xAxisKey: 'month',
          yAxisKey: 'revenue',
          resultData: [
            { month: 'Jan', revenue: 10 },
            { month: 'Feb', revenue: 90 },
            { month: 'Mar', revenue: 40 },
          ],
        },
      },
    ],
  };
  const { text } = await openDocx(await renderAnalysisDocx(line, { fileName: 'sales.csv', rowCount: 3 }));

  assert.ok(text.indexOf('Jan') < text.indexOf('Feb'), 'months were reordered');
  assert.ok(text.indexOf('Feb') < text.indexOf('Mar'), 'months were reordered');
  assert.match(text, /drawn as bars, in the chart’s own order/);
});

test('a filter tile is not a finding', async () => {
  const withSlicer = {
    ...analysis,
    storyboard: [{ id: 'f1', kind: 'filter', chart: { chart_type: 'slicer' } }, ...analysis.storyboard],
  };
  const { text } = await openDocx(await renderAnalysisDocx(withSlicer, { fileName: 'sales.csv', rowCount: 4120 }));

  assert.match(text, /1 finding\b/);
  assert.match(text, /1\. Revenue by region/);
  assert.ok(!/2\. /.test(text), 'the slicer was numbered as a finding');
});

test('says on the cover when the report is of a slice', async () => {
  const filtered = { ...analysis, filter: { description: 'Region = North', rowCount: 900 } };
  const { text } = await openDocx(await renderAnalysisDocx(filtered, { fileName: 'sales.csv', rowCount: 4120 }));

  assert.match(text, /Filtered: Region = North — 900 of 4,120 rows\./);
});

test('names the file something a reader will recognise', () => {
  assert.match(docxFilename('Q3 revenue: north/south'), /^Q3 revenue north south \d{4}-\d{2}-\d{2}\.docx$/);
  assert.match(docxFilename('sales.csv'), /^sales \d{4}-\d{2}-\d{2}\.docx$/);
  assert.match(docxFilename(''), /^Insight Executive \d{4}-\d{2}-\d{2}\.docx$/);
});
