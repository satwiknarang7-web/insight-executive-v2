/**
 * Download the analysis as a PowerPoint deck.
 *
 * The rendering lives in `lib/report/pptx.server.js` for the same reason the
 * PDF's does: so there is one definition of what the file looks like, whatever
 * asks for it.
 *
 * Unlike the PDF this needs no browser, so it works on any host — which also
 * makes it the export that still works when the PDF renderer is unavailable.
 */
import { NextResponse } from 'next/server';
import { pptxFilename, renderAnalysisPptx } from '../../../../lib/report/pptx.server';
import { enforceLimit } from '../../../../lib/routeLimits.server';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request) {
  const refused = await enforceLimit(request, 'pptx');
  if (refused) return refused;

  let analysis;
  try {
    analysis = await request.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }

  if (!analysis?.storyboard?.length && !analysis?.slideZero) {
    return NextResponse.json({ error: 'There is no analysis to export yet.' }, { status: 400 });
  }

  try {
    const buffer = await renderAnalysisPptx(analysis, { fileName: analysis?.fileName || null });
    const filename = pptxFilename(analysis?.slideZero?.title || 'Insight Executive');

    return new Response(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error('[export/pptx]', error.message);
    return NextResponse.json({ error: 'The deck could not be built.' }, { status: 500 });
  }
}
