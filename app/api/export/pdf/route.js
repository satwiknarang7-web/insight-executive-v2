/**
 * Download the report as a PDF.
 *
 * The rendering itself lives in `lib/report/pdf.server.js`, because emailing a
 * report has to produce byte-for-byte the same document as downloading one —
 * two copies of the headless-Chrome setup would drift on page size, waits or
 * scale within a release, and a report that looks different depending on how it
 * left the building is one nobody can refer to in a meeting.
 */
import { NextResponse } from 'next/server';
import {
  ReportRendererUnavailable,
  cookiesOf,
  originOf,
  renderReportPdf,
  reportFilename,
} from '../../../../lib/report/pdf.server';
import { enforceLimit } from '../../../../lib/routeLimits.server';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request) {
  const refused = await enforceLimit(request, 'pdf');
  if (refused) return refused;

  let analysis;
  try {
    analysis = await request.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }

  if (!analysis) {
    return NextResponse.json({ error: 'No data provided for report generation' }, { status: 400 });
  }

  try {
    const pdf = await renderReportPdf(analysis, {
      origin: originOf(request),
      cookies: cookiesOf(request),
    });
    const filename = reportFilename(analysis?.slideZero?.title || 'Insight Executive Report');

    return new Response(pdf, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    // A host with no browser is a deployment fact, not a bug. The page offers
    // browser printing instead, which always works.
    if (error instanceof ReportRendererUnavailable) {
      console.error('[export/pdf]', error.message);
      return NextResponse.json({ error: error.message, rendererMissing: true }, { status: 503 });
    }
    console.error('[export/pdf]', error.message);
    return NextResponse.json({ error: 'Failed to generate PDF', details: error.message }, { status: 500 });
  }
}
