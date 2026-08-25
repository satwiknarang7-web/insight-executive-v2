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
    ? 'Use this code to finish creating your Insight Analytics account.'
    : 'Use this code to finish signing in to Insight Analytics.';

  try {
    await transporter().sendMail({
      from: process.env.SMTP_FROM || `Insight Analytics <${process.env.SMTP_USER}>`,
      to,
      subject: `${code} is your Insight Analytics code`,
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
      from: process.env.SMTP_FROM || `Insight Analytics <${process.env.SMTP_USER}>`,
      to,
      subject: 'Your Insight Analytics account has been deleted',
      text:
        'Your Insight Analytics account, and every database connection stored under it, have been permanently deleted.\n\n' +
        'If this was not you, reply to this email immediately.',
    });
    return { ok: true };
  } catch (error) {
    console.error('[mail]', scrubSmtpError(error));
    return { ok: false, reason: scrubSmtpError(error) };
  }
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
          <div style="font-size:11px;font-weight:800;letter-spacing:3px;text-transform:uppercase;color:#0f3057;">Insight Analytics</div>
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
