/**
 * Saved analyses: list what you can open, and keep the current one.
 *
 * Nothing is written here unless the user asks. That is the feature: the
 * library holds what somebody chose to keep, not a log of every file opened.
 */
import { NextResponse } from 'next/server';
import { isSupabaseConfigured } from '../../../lib/vault/supabase.server';
import { Invalid, LibraryUnavailable, NotFound, listAnalyses, saveAnalysis } from '../../../lib/analyses.server';

export const runtime = 'nodejs';

function fail(error) {
  if (error instanceof Invalid) return NextResponse.json({ error: error.message }, { status: 400 });
  if (error instanceof NotFound) return NextResponse.json({ error: error.message }, { status: 404 });
  if (error instanceof LibraryUnavailable) {
    console.error('[analyses]', error.message);
    return NextResponse.json({ error: error.message, setupRequired: true }, { status: 503 });
  }
  console.error('[analyses]', error.message);
  // The reason goes to the caller too. "That did not work." told a user nothing
  // and told whoever they reported it to even less.
  return NextResponse.json({ error: `That did not work: ${error.message}` }, { status: 500 });
}

export async function GET() {
  if (!isSupabaseConfigured()) return NextResponse.json({ mine: [], shared: [] });
  try {
    return NextResponse.json(await listAnalyses());
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Saving is not configured on this deployment.' }, { status: 501 });
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }
  try {
    const saved = await saveAnalysis({
      id: body?.id || null,
      title: body?.title,
      datasetName: body?.datasetName,
      rowCount: body?.rowCount,
      payload: body?.payload,
    });
    return NextResponse.json({ analysis: saved }, { status: body?.id ? 200 : 201 });
  } catch (error) {
    return fail(error);
  }
}
