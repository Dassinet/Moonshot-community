import { Router } from 'express';
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { html } from './views/html.js';
import { csrfField, errorList } from './views/layout.js';
import { cookieName, setCookie, clearCookie } from './security/cookies.js';
import { RateLimiter, limit } from './security/rateLimit.js';
import { accessCodeEmail } from './views/emails.js';
import * as v from './security/validate.js';
import { audit } from './db.js';

// Private site gate. Until a visitor proves they control an email address (by
// entering a 6-digit code we email them), every page shows only a plain,
// unbranded "private preview" screen. Signed-in members skip the gate.
//
// With GATE_ALLOWED set, only listed emails/@domains ever receive a code, which
// makes the whole site invite-only.

const CODE_TTL_MS = 10 * 60 * 1000;
const PASS_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 5;          // wrong guesses per code
const MAX_CODES_PER_WINDOW = 3;  // codes per email per 15 minutes
const OPEN_PATHS = new Set(['/gate', '/gate/verify', '/robots.txt']);

const sendLimiter = new RateLimiter({ windowMs: 15 * 60 * 1000, max: 10 });
const verifyLimiter = new RateLimiter({ windowMs: 15 * 60 * 1000, max: 20 });

const mac = (config, purpose, value) => createHmac('sha256', config.secret).update(`${purpose}:${value}`).digest('base64url');
const same = (a, b) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

// Signed cookie holding an email and an expiry: "<b64 email>.<exp>.<mac>".
function signCookie(config, purpose, email, ttl) {
  const payload = `${Buffer.from(email).toString('base64url')}.${Date.now() + ttl}`;
  return `${payload}.${mac(config, purpose, payload)}`;
}
function readCookie(config, purpose, raw) {
  const [e, exp, sig] = String(raw ?? '').split('.');
  if (!e || !exp || !sig || !same(sig, mac(config, purpose, `${e}.${exp}`)) || Number(exp) < Date.now()) return null;
  return Buffer.from(e, 'base64url').toString();
}

const passName = (config) => cookieName('mc_gate', config.secure);
const pendingName = (config) => cookieName('mc_gate_pending', config.secure);

export function isAllowed(config, email) {
  if (!config.gateAllowed.length) return true;
  const domain = `@${email.split('@')[1]}`;
  return config.gateAllowed.includes(email) || config.gateAllowed.includes(domain);
}

export function gateMiddleware(config) {
  return (req, res, next) => {
    if (!config.gate) return next();
    req.gateEmail = readCookie(config, 'gate-pass', req.cookies[passName(config)]);
    // Invite list edits take effect immediately, even for existing passes.
    if (req.gateEmail && !isAllowed(config, req.gateEmail)) req.gateEmail = null;
    if (req.user || req.gateEmail || OPEN_PATHS.has(req.path)) return next();
    if (req.method === 'GET' || req.method === 'HEAD') return res.redirect(303, '/gate');
    res.status(403).type('text').send('Private preview. Request an access code first.');
  };
}

// Deliberately generic page: no community name, logo or brand styling.
function gatePage(req, res, { title, body, status = 200 }) {
  res
    .status(status)
    .type('html')
    .send(
      html`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><meta name="referrer" content="no-referrer">
<title>${title}</title><link rel="stylesheet" href="/static/styles.css"></head>
<body class="gate"><main><section class="narrow card gate-card">${body}</section></main></body></html>`.toString(),
    );
}

const router = Router();

router.get('/gate', (req, res) => {
  if (req.user || req.gateEmail) return res.redirect(303, '/');
  gatePage(req, res, { title: 'Private preview', body: requestForm(req) });
});

function requestForm(req, errors = []) {
  return html`<h1>Private preview</h1>
    <p class="muted">This site is private. Enter your email and we'll send you a one-time access code.</p>
    ${errorList(errors)}
    <form method="post" action="/gate" class="stack">${csrfField(req)}
      <label>Email <input type="email" name="email" required autocomplete="email" maxlength="254"></label>
      <button class="btn">Send me a code</button>
    </form>`;
}

router.post('/gate', limit(sendLimiter, (req) => `gate-send:${req.ip}`), async (req, res) => {
  const { db, config, mailer } = req.app.locals;
  const email = v.email(req.body.email);
  if (!email) return gatePage(req, res, { title: 'Private preview', status: 400, body: requestForm(req, ['Please enter a valid email address.']) });

  const since = Date.now() - 15 * 60 * 1000;
  const recent = db.prepare('SELECT COUNT(*) AS n FROM gate_codes WHERE email = ? AND created_at > ?').get(email, since).n;
  // Addresses not on the invite list get the same response but no email, so
  // the list itself can't be probed.
  if (isAllowed(config, email) && recent < MAX_CODES_PER_WINDOW) {
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const now = Date.now();
    db.prepare('DELETE FROM gate_codes WHERE expires_at < ?').run(now);
    db.prepare('INSERT INTO gate_codes (email, code_hash, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
      email, mac(config, 'gate-code', `${email}:${code}`), now, now + CODE_TTL_MS,
    );
    try {
      await mailer.send({ to: email, ...accessCodeEmail({ code }) });
    } catch (err) {
      console.error('gate email failed:', err.message);
      return gatePage(req, res, { title: 'Private preview', status: 503, body: requestForm(req, ["We couldn't send the email just now. Please try again in a few minutes."]) });
    }
  }
  setCookie(res, pendingName(config), signCookie(config, 'gate-pending', email, CODE_TTL_MS), {
    secure: config.secure, maxAgeSeconds: CODE_TTL_MS / 1000, sameSite: 'Strict',
  });
  res.redirect(303, '/gate/verify');
});

function maskEmail(email) {
  const [local, domain] = email.split('@');
  return `${local.slice(0, 2)}${'•'.repeat(Math.max(1, local.length - 2))}@${domain}`;
}

function codeForm(req, email, errors = []) {
  return html`<h1>Check your email</h1>
    <p class="muted">If ${maskEmail(email)} has access, we've sent it a 6-digit code. It expires in 10 minutes.</p>
    ${errorList(errors)}
    <form method="post" action="/gate/verify" class="stack">${csrfField(req)}
      <label>Access code <input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 ]{6,7}" maxlength="7" required autofocus></label>
      <button class="btn">Enter</button>
    </form>
    <p class="small muted"><a href="/gate">Use a different email or send a new code</a></p>`;
}

router.get('/gate/verify', (req, res) => {
  const { config } = req.app.locals;
  if (req.user || req.gateEmail) return res.redirect(303, '/');
  const email = readCookie(config, 'gate-pending', req.cookies[pendingName(config)]);
  if (!email) return res.redirect(303, '/gate');
  gatePage(req, res, { title: 'Enter your code', body: codeForm(req, email) });
});

router.post('/gate/verify', limit(verifyLimiter, (req) => `gate-verify:${req.ip}`), (req, res) => {
  const { db, config } = req.app.locals;
  const email = readCookie(config, 'gate-pending', req.cookies[pendingName(config)]);
  if (!email) return res.redirect(303, '/gate');
  const code = String(req.body.code ?? '').replace(/\s/g, '');
  const row = db
    .prepare('SELECT * FROM gate_codes WHERE email = ? AND expires_at > ? ORDER BY id DESC LIMIT 1')
    .get(email, Date.now());
  const wrong = () =>
    gatePage(req, res, { title: 'Enter your code', status: 401, body: codeForm(req, email, ['That code is incorrect or has expired.']) });

  if (!row || row.attempts >= MAX_ATTEMPTS || !/^\d{6}$/.test(code)) {
    if (row) db.prepare('UPDATE gate_codes SET attempts = attempts + 1 WHERE id = ?').run(row.id);
    return wrong();
  }
  if (!same(mac(config, 'gate-code', `${email}:${code}`), row.code_hash)) {
    db.prepare('UPDATE gate_codes SET attempts = attempts + 1 WHERE id = ?').run(row.id);
    return wrong();
  }
  db.prepare('DELETE FROM gate_codes WHERE email = ?').run(email);
  audit(db, null, 'gate.pass', `@${email.split('@')[1]}`);
  clearCookie(res, pendingName(config), config);
  setCookie(res, passName(config), signCookie(config, 'gate-pass', email, PASS_TTL_MS), {
    secure: config.secure, maxAgeSeconds: PASS_TTL_MS / 1000,
  });
  res.redirect(303, '/');
});

export default router;
