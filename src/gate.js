import { Router } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { html } from './views/html.js';
import { csrfField, errorList } from './views/layout.js';
import { cookieName, setCookie } from './security/cookies.js';
import { RateLimiter, limit } from './security/rateLimit.js';

// Optional private gate. When SITE_PASSWORD is set, every page shows only a
// plain, unbranded "Private preview" screen until the visitor enters that
// shared password. No accounts or email involved. Leave it unset for a public
// site.

const PASS_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const OPEN_PATHS = new Set(['/private', '/robots.txt']);
const attemptLimiter = new RateLimiter({ windowMs: 15 * 60 * 1000, max: 10 });

const mac = (config, value) => createHmac('sha256', config.secret).update(value).digest('base64url');
const same = (a, b) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const passName = (config) => cookieName('mc_private', config.secure);

// The pass is tied to the current password, so changing SITE_PASSWORD locks
// everyone out again until they enter the new one.
function passValue(config, exp) {
  const version = mac(config, `site-password:${config.sitePassword}`).slice(0, 16);
  return `${exp}.${mac(config, `site-pass:${version}:${exp}`)}`;
}

function hasPass(config, raw) {
  const [exp] = String(raw ?? '').split('.');
  return Number(exp) > Date.now() && same(String(raw), passValue(config, exp));
}

export function gateMiddleware(config) {
  return (req, res, next) => {
    if (!config.sitePassword || OPEN_PATHS.has(req.path) || hasPass(config, req.cookies[passName(config)])) return next();
    if (req.method === 'GET' || req.method === 'HEAD') return res.redirect(303, '/private');
    res.status(403).type('text').send('Private preview. Enter the password first.');
  };
}

// Deliberately generic page: no community name, logo or brand styling.
function gatePage(req, res, errors = [], status = 200) {
  res.status(status).type('html').send(
    html`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><meta name="referrer" content="no-referrer">
<title>Private preview</title><link rel="stylesheet" href="/static/styles.css"></head>
<body class="gate"><main><section class="narrow card gate-card">
  <h1>Private preview</h1>
  <p class="muted">This site is private. Enter the password you were given.</p>
  ${errorList(errors)}
  <form method="post" action="/private" class="stack">${csrfField(req)}
    <label>Password <input type="password" name="password" required autocomplete="current-password" autofocus></label>
    <button class="btn">Enter</button>
  </form>
</section></main></body></html>`.toString(),
  );
}

const router = Router();

router.get('/private', (req, res) => {
  const { config } = req.app.locals;
  if (!config.sitePassword || hasPass(config, req.cookies[passName(config)])) return res.redirect(303, '/');
  gatePage(req, res);
});

router.post('/private', limit(attemptLimiter, (req) => `private:${req.ip}`), (req, res) => {
  const { config } = req.app.locals;
  if (!config.sitePassword) return res.redirect(303, '/');
  const given = typeof req.body.password === 'string' ? req.body.password : '';
  // Compare fixed-length HMACs so the check takes the same time whatever is typed.
  if (!same(mac(config, `try:${given}`), mac(config, `try:${config.sitePassword}`))) {
    return gatePage(req, res, ['That password is incorrect.'], 401);
  }
  setCookie(res, passName(config), passValue(config, Date.now() + PASS_TTL_MS), {
    secure: config.secure,
    maxAgeSeconds: PASS_TTL_MS / 1000,
  });
  res.redirect(303, '/');
});

export default router;
