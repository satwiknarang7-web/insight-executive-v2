/**
 * Prove the SMTP credentials work, before anything depends on them.
 *
 * Sign-up stores a code and then emails it, so a bad app password surfaces to
 * the user as "the email never arrived" — indistinguishable from a typo in the
 * address, a spam filter, or a Gmail outage. This asks the server directly:
 *
 *   npm run mail:check                 -- authenticate only, send nothing
 *   npm run mail:check you@gmail.com   -- also send one real test message
 *
 * `verify()` completes the TLS handshake and the AUTH exchange without queuing
 * a message, which is the fastest way to tell a credentials problem from a
 * delivery problem. Nothing here prints the password, and an SMTP error is
 * scrubbed before it is shown — nodemailer puts the base64 of the AUTH line
 * into some failure messages.
 */
import nodemailer from 'nodemailer';

const user = process.env.SMTP_USER;
const pass = String(process.env.SMTP_PASSWORD || '').replace(/\s+/g, '');
const host = process.env.SMTP_HOST || 'smtp.gmail.com';
const port = Number(process.env.SMTP_PORT || 465);

const scrub = (e) => String(e?.message || e).replace(/AUTH\s+\S+\s+\S+/gi, 'AUTH [redacted]').slice(0, 300);

/** Gmail's own wording is terse; these are the two failures people actually hit. */
function explain(error) {
  const text = String(error?.message || '').toLowerCase();
  if (text.includes('invalid login') || text.includes('username and password not accepted')) {
    return (
      'Gmail rejected the credentials. An app password is 16 characters and requires\n' +
      '2-Step Verification on the account — an ordinary account password is always\n' +
      'refused over SMTP, however correct it is.'
    );
  }
  if (text.includes('timeout') || text.includes('etimedout') || text.includes('econnrefused')) {
    return `Could not reach ${host}:${port}. Port 465 is implicit TLS and 587 is STARTTLS;\nmixing them up hangs rather than erroring, and some networks block both.`;
  }
  return null;
}

async function main() {
  if (!user || !pass) {
    console.error('SMTP_USER and SMTP_PASSWORD must both be set in .env.local.');
    process.exit(2);
  }

  console.log(`Authenticating ${user} against ${host}:${port} …`);
  const transport = nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } });

  try {
    await transport.verify();
    console.log('Credentials accepted.');
  } catch (error) {
    console.error(`\nRejected: ${scrub(error)}`);
    const hint = explain(error);
    if (hint) console.error(`\n${hint}`);
    process.exit(1);
  }

  const to = process.argv[2];
  if (!to) {
    console.log('No address given, so nothing was sent. Pass one to send a test message.');
    return;
  }

  const info = await transport.sendMail({
    from: process.env.SMTP_FROM || `Insight Analytics <${user}>`,
    to,
    subject: 'Insight Analytics: SMTP test',
    text: 'If you are reading this, two-factor codes will reach this inbox.',
  });
  console.log(`Sent to ${to} (${info.messageId}).`);
}

main().catch((error) => {
  console.error(`\nFailed: ${scrub(error)}`);
  process.exit(1);
});
