import { BRAND } from './brand.js';

// Transactional email. In production it sends through Resend's HTTP API
// (https://resend.com) when RESEND_API_KEY is set — no SDK dependency.
// Otherwise email is off: the app works without it, and anything that would
// have been sent is printed to the server log.

export function createMailer(config) {
  const { resendApiKey, from } = config.mail ?? {};
  if (resendApiKey) {
    if (!from) throw new Error('MAIL_FROM must be set when RESEND_API_KEY is set (e.g. "Moonshots Community <hello@yourdomain.com>").');
    return { send: (msg) => sendWithResend(resendApiKey, from, msg) };
  }
  // No email service configured: emails are only written to the server log.
  return {
    async send({ to, subject, text }) {
      console.log(`\n📧 Email to ${to}\n   Subject: ${subject}\n${text.replace(/^/gm, '   ')}\n`);
    },
  };
}

// In-memory mailer for tests.
export function memoryMailer() {
  const outbox = [];
  return { outbox, async send(msg) { outbox.push(msg); } };
}

async function sendWithResend(apiKey, from, { to, subject, text, html }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject, text, html }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    // Log the provider's status only — never the API key or the email body.
    throw new Error(`Email provider returned ${res.status}`);
  }
}

export const brandFooter = `— ${BRAND.name}`;
