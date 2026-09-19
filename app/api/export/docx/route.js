/**
 * Download the analysis as a Word document.
 *
 * The rendering lives in `lib/report/docx.server.js` for the same reason the
 * other two do: so there is one definition of what the file looks like,
 * whatever asks for it.
 *
 * Like the deck and unlike the PDF, this needs no browser on the host — the
 * figures are drawn out of Word's own tables from numbers the findings already
 * carry — so it works on any deployment.
 */
import { NextResponse } from 'next/server';
import { docxFilename, renderAnalysisDocx } from '../../../../lib/report/docx.server';
import { enforceLimit } from '../../../../lib/routeLimits.server';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request) {
  const refused = await enforceLimit(request, 'docx');
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
    const buffer = await renderAnalysisDocx(analysis, {
      fileName: analysis?.fileName || null,
      rowCount: Number.isFinite(analysis?.rowCount) ? analysis.rowCount : null,
    });
    const filename = docxFilename(analysis?.slideZero?.title || 'Insight Executive');

    return new Response(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error('[export/docx]', error.message);
    return NextResponse.json({ error: 'The document could not be built.' }, { status: 500 });
  }
}
