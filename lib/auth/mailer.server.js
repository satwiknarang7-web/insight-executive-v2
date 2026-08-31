import 'server-only';

/**
 * Outbound email, over Gmail's SMTP.
 *
 * Gmail refuses an account password over SMTP; what goes in `SMTP_PASSWORD` is
 * the 16-character *app password* generated under a Google account with 2-Step
 * Verification switched on. It is written here without spaces, though the
 * clipboard usually carries them in groups of four, so they are stripped rather
 * than failing an authentication the user cannot see.
 *
 * The transport is created once and reused: Gmail throttles connection churn,
 * and a fresh TLS handshake per code is both slower and more likely to be
 * rate-limited than a pooled one.
 *
 * `server-only` is load-bearing — it makes the build fail rather than quietly
 * bundling the SMTP password into client JavaScript.
 */
import nodemailer from 'nodemailer';

const HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
const PORT = Number(process.env.SMTP_PORT || 465);

let transport = null;

/** Gmail shows the app password in groups of four; the protocol wants none. */
function appPassword() {
  return String(process.env.SMTP_PASSWORD || '').replace(/\s+/g, '');
}

export function isMailerConfigured() {
  return !!(process.env.SMTP_USER && appPassword());
}

function transporter() {
  if (transport) return transport;
  transport = nodemailer.createTransport({
    host: HOST,
    port: PORT,
    // 465 is implicit TLS; 587 upgrades with STARTTLS. Getting this wrong is
    // the single most common cause of a hang rather than an error.
    secure: PORT === 465,
    auth: { user: process.env.SMTP_USER, pass: appPassword() },
    pool: true,
    maxConnections: 3,
  });
  return transport;
}

/** Prove the credentials work, without sending anything. Used by the health check. */
export async function verifyMailer() {
  if (!isMailerConfigured()) return { ok: false, reason: 'not_configured' };
  try {
    await transporter().verify();
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: scrubSmtpError(error) };
  }
}

/**
 * Send a one-time code.
 *
 * Returns `{ ok }` rather than throwing: a failure here must not leave the
 * caller unable to tell an SMTP problem from a bad password, and the route
 * needs to decide what the user sees.
 */
export async function sendCodeEmail({ to, code, purpose }) {
  if (!isMailerConfigured()) return { ok: false, reason: 'not_configured' };

  const signingUp = purpose === 'signup';
  const heading = signingUp ? 'Confirm your email' : 'Your sign-in code';
  const lead = signingUp
    ? 'Use this code to finish creating your Insight Executive account.'
    : 'Use this code to finish signing in to Insight Executive.';

  try {
    await transporter().sendMail({
      from: process.env.SMTP_FROM || `Insight Executive <${process.env.SMTP_USER}>`,
      to,
      subject: `${code} is your Insight Executive code`,
      text: `${heading}\n\n${lead}\n\nCode: ${code}\n\nIt expires in 10 minutes. If you did not request it, ignore this email and nothing will happen.`,
      html: codeEmailHtml({ heading, lead, code }),
    });
    return { ok: true };
  } catch (error) {
    console.error('[mail]', scrubSmtpError(error));
    return { ok: false, reason: scrubSmtpError(error) };
  }
}

/** Tell the account holder their account is gone, and that it was deliberate. */
export async function sendAccountDeletedEmail({ to }) {
  if (!isMailerConfigured()) return { ok: false, reason: 'not_configured' };
  try {
    await transporter().sendMail({
      from: process.env.SMTP_FROM || `Insight Executive <${process.env.SMTP_USER}>`,
      to,
      subject: 'Your Insight Executive account has been deleted',
      text:
        'Your Insight Executive account, and every database connection stored under it, have been permanently deleted.\n\n' +
        'If this was not you, reply to this email immediately.',
    });
    return { ok: true };
  } catch (error) {
    console.error('[mail]', scrubSmtpError(error));
    return { ok: false, reason: scrubSmtpError(error) };
  }
}


/**
 * Send someone the report itself.
 *
 * This used to send a link. A link is the cheaper thing to build and the worse
 * thing to receive: it only works if the recipient has an account, remembers
 * which one, and is willing to sign in before they can see whether the thing
 * was worth opening. The report is what they actually wanted, so the report is
 * what gets sent — a PDF, attached, readable on a phone in a corridor.
 *
 * In-app sharing still happens alongside this and still matters: it is what
 * lets them open the live analysis, present it and see later edits. The email
 * is the copy that needs nothing.
 *
 * Attachments have limits. Most providers reject a message over about 25MB, and
 * a report with many charts can approach that, so the caller checks the size
 * before handing it over — a bounce with a provider's own wording is a much
 * worse answer than being told up front.
 */
export async function sendReportEmail({ to, sharedBy, title, pdf, filename }) {
  if (!isMailerConfigured()) return { ok: false, reason: 'not_configured' };
  if (!to) return { ok: false, reason: 'no_address' };

  const who = sharedBy || 'Someone';
  const what = title || 'an analysis';
  const attachments = pdf
    ? [{ filename: filename || 'Insight report.pdf', content: pdf, contentType: 'application/pdf' }]
    : [];

  try {
    await transporter().sendMail({
      from: process.env.SMTP_FROM || `Insight Executive <${process.env.SMTP_USER}>`,
      to,
      subject: `${who} sent you "${what}"`,
      text:
        `${who} sent you a report from Insight Executive.\n\n` +
        `${what}\n\n` +
        (attachments.length
          ? 'The full report is attached as a PDF.\n\n'
          : 'The report could not be attached to this message.\n\n') +
        'Every figure in it was computed from a query over the source data, not written by a language model.',
      html: reportEmailHtml({ who, what, attached: attachments.length > 0 }),
      attachments,
    });
    return { ok: true };
  } catch (error) {
    console.error('[mail]', scrubSmtpError(error));
    return { ok: false, reason: scrubSmtpError(error) };
  }
}

function reportEmailHtml({ who, what, attached }) {
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f6f8fb;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f8fb;padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:16px;padding:32px;">
        <tr><td style="font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:#8a94a6;font-weight:700;padding-bottom:12px;">Insight Executive</td></tr>
        <tr><td style="font-size:20px;font-weight:800;color:#0f1729;padding-bottom:8px;">${escapeHtml(who)} sent you a report</td></tr>
        <tr><td style="font-size:15px;color:#485060;padding-bottom:20px;">${escapeHtml(what)}</td></tr>
        <tr><td style="font-size:14px;color:#485060;line-height:1.6;padding-bottom:8px;">
          ${attached
            ? 'The full report is attached to this email as a PDF.'
            : 'The report could not be attached to this message.'}
        </td></tr>
        <tr><td style="font-size:12px;color:#8a94a6;padding-top:20px;line-height:1.6;">
          Every figure in it was computed from a query over the source data, not written by a language model.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

/** Anything that reaches an HTML email from a user goes through here first. */
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * An SMTP error, with the credentials taken out.
 *
 * nodemailer puts the full command it attempted — including the base64 of the
 * password on an AUTH line — into some failure messages, and those end up in
 * server logs.
 */
function scrubSmtpError(error) {
  const text = String(error?.message || error);
  return text.replace(/AUTH\s+\S+\s+\S+/gi, 'AUTH [redacted]').slice(0, 300);
}

function codeEmailHtml({ heading, lead, code }) {
  // Inline styles and a table: every email client strips a stylesheet, and half
  // of them still lay out with tables.
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f6f8fb;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f8fb;padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;padding:32px;">
        <tr><td>
          <div style="font-size:11px;font-weight:800;letter-spacing:3px;text-transform:uppercase;color:#0f3057;">Insight Executive</div>
          <h1 style="margin:16px 0 8px;font-size:20px;color:#0b2545;">${heading}</h1>
          <p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:#475569;">${lead}</p>
          <div style="font-size:34px;font-weight:800;letter-spacing:10px;color:#0f3057;background:#f1f5f9;border-radius:12px;padding:18px;text-align:center;">${code}</div>
          <p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#64748b;">This code expires in 10 minutes. If you did not request it, ignore this email — nothing will happen and no one can use it.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}
