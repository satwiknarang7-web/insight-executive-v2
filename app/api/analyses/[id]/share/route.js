/**
 * Share a saved analysis with another user, by username or by email address.
 *
 * The name is resolved server-side; a caller cannot share with a user id they
 * guessed, only with someone who has published a username or holds the address
 * they typed.
 */
import { NextResponse } from 'next/server';
import { isSupabaseConfigured } from '../../../../../lib/vault/supabase.server';
import {
  Invalid,
  LibraryUnavailable,
  NotFound,
  getAnalysis,
  listShares,
  myProfile,
  shareAnalysis,
  unshareAnalysis,
} from '../../../../../lib/analyses.server';
import { currentUser } from '../../../../../lib/vault/supabase.server';
import { findUserById } from '../../../../../lib/auth/accounts.server';
import { isMailerConfigured, sendReportEmail } from '../../../../../lib/auth/mailer.server';
import {
  ReportRendererUnavailable,
  cookiesOf,
  originOf,
  renderReportPdf,
  reportFilename,
} from '../../../../../lib/report/pdf.server';
import { enforceLimit } from '../../../../../lib/routeLimits.server';

export const runtime = 'nodejs';
// Rendering the report runs a headless browser over the print page, which is
// seconds rather than milliseconds. The default limit would cut it off.
export const maxDuration = 60;

/**
 * The largest report worth attaching.
 *
 * Providers reject a message somewhere around 25MB and base64 inflates an
 * attachment by about a third on the way out, so the real ceiling is lower
 * than it looks. Being told the report is too large to send beats a bounce in
 * a provider's own wording an hour later.
 */
const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;

function fail(error) {
  if (error instanceof Invalid) return NextResponse.json({ error: error.message }, { status: 400 });
  if (error instanceof NotFound) return NextResponse.json({ error: error.message }, { status: 404 });
  if (error instanceof LibraryUnavailable) {
    return NextResponse.json({ error: error.message, setupRequired: true }, { status: 503 });
  }
  console.error('[analyses/share]', error.message);
  return NextResponse.json({ error: `That did not work: ${error.message}` }, { status: 500 });
}

export async function GET(request, { params }) {
  const { id } = await params;
  try {
    return NextResponse.json({ shares: await listShares(id) });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request, { params }) {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'Not configured.' }, { status: 501 });
  const { id } = await params;
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }
  try {
    // `handle` is the older field name. Kept so a page served before this
    // deploy does not start failing against the route served after it.
    const shared = await shareAnalysis(id, body?.recipient ?? body?.handle);
    const shares = await listShares(id);

    // The email is a separate, optional step and never decides whether the
    // share succeeded. It has: the row is written, the recipient can already
    // open it, and a report that failed to render must not read as a failed
    // share.
    let notified = null;
    if (body?.notify) notified = await emailReport({ request, analysisId: id, shared });

    return NextResponse.json({ shared, shares, notified });
  } catch (error) {
    return fail(error);
  }
}

/**
 * Send the person the report itself, as a PDF.
 *
 * Not a link. A link only works if the recipient has an account, remembers
 * which one, and signs in before they can see whether the thing was worth
 * opening; the report is what they actually wanted. In-app sharing has already
 * happened by the time this runs and still matters — it is what lets them open
 * the live analysis and see later edits — but this is the copy that needs
 * nothing.
 *
 * The address comes from their account rather than from the request, so this
 * cannot be used to post a report to an arbitrary inbox: only to the one
 * belonging to the user who was granted access a moment ago.
 *
 * Every failure here is reported rather than thrown. The share succeeded; a
 * missing browser or an oversized PDF is a reason the email did not go, not a
 * reason to tell someone their share did not work.
 */
async function emailReport({ request, analysisId, shared }) {
  if (!isMailerConfigured()) return { sent: false, reason: 'email is not configured on this deployment.' };

  // Only this branch is rate limited, not sharing itself. Writing a share row is
  // cheap and people do it in bursts; rendering a PDF in headless Chrome and
  // putting it through SMTP is neither, and it is the half someone could point
  // at an inbox. Reported as a refusal rather than returned as a 429, because
  // the share has already succeeded and did not fail.
  const refused = await enforceLimit(request, 'shareNotify');
  if (refused) {
    return { sent: false, reason: 'too many reports have been emailed just now — try again shortly.' };
  }

  // The id of the person the share was just written for, taken from the write
  // itself.
  //
  // This used to search the refreshed share list for a row whose handle or
  // label matched, which quietly picked the wrong person. A recipient who has
  // not chosen a username has `handle: null`, so `s.handle === shared.handle`
  // was `null === null` against every other handle-less recipient — and the
  // list is ordered oldest first, so the earliest one won and short-circuited
  // before the label clause that would have been right. Share with alice, then
  // share with bob and ask to notify, and the report went to alice.
  if (!shared?.userId) return { sent: false, reason: 'we could not work out where to send it.' };

  const account = await findUserById(shared.userId);
  if (!account?.email) return { sent: false, reason: 'that account has no email address on file.' };

  const [me, analysis] = await Promise.all([
    myProfile().catch(() => null),
    getAnalysis(analysisId).catch(() => null),
  ]);
  if (!analysis?.payload) return { sent: false, reason: 'the saved analysis could not be read back.' };

  const sharer = await currentUser();
  const sharedBy = me?.display_name || (me?.handle ? `@${me.handle}` : null) || sharer?.email || 'Someone';

  let pdf;
  try {
    pdf = await renderReportPdf(analysis.payload, {
      origin: originOf(request),
      cookies: cookiesOf(request),
    });
  } catch (error) {
    console.error('[analyses/share] report render failed:', error.message);
    if (error instanceof ReportRendererUnavailable) {
      return {
        sent: false,
        reason: error.cause
          ? `the browser that renders the report could not start (${error.cause}).`
          : 'this server has no browser available to render the report.',
      };
    }
    // The reason, not a shrug. "The report could not be rendered" sends whoever
    // reads it to a server log; the actual message says what broke.
    return { sent: false, reason: error.message || 'the report could not be rendered.' };
  }

  if (pdf.length > MAX_ATTACHMENT_BYTES) {
    const mb = (pdf.length / (1024 * 1024)).toFixed(1);
    return { sent: false, reason: `the report is ${mb}MB, which is too large to email.` };
  }

  const result = await sendReportEmail({
    to: account.email,
    sharedBy,
    title: analysis.title || 'an analysis',
    pdf,
    filename: reportFilename(analysis.title),
  });

  return result.ok ? { sent: true } : { sent: false, reason: result.reason };
}

export async function DELETE(request, { params }) {
  const { id } = await params;
  const userId = new URL(request.url).searchParams.get('user');
  if (!userId) return NextResponse.json({ error: 'A user is required.' }, { status: 400 });
  try {
    await unshareAnalysis(id, userId);
    return NextResponse.json({ shares: await listShares(id) });
  } catch (error) {
    return fail(error);
  }
}
