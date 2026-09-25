import { Router } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { html } from '../views/html.js';
import { csrfField, errorList } from '../views/layout.js';
import { hashPassword, verifyPassword, burnPasswordCheck, passwordProblems, PASSWORD_MIN } from '../security/passwords.js';
import { startSession, endSession } from '../security/sessions.js';
import { RateLimiter, limit } from '../security/rateLimit.js';
import { setCookie, clearCookie, cookieName } from '../security/cookies.js';
import { verifyCode } from '../security/totp.js';
import * as v from '../security/validate.js';
import { audit } from '../db.js';
import { MEMBER_TYPES, MEMBER_TYPE_KEYS } from '../taxonomy.js';
import { codeOfConduct } from '../views/content.js';

const router = Router();

const LOCK_AFTER = 5;
const LOCK_MS = 15 * 60 * 1000;

const loginLimiter = new RateLimiter({ windowMs: 15 * 60 * 1000, max: 20 });
const signupLimiter = new RateLimiter({ windowMs: 60 * 60 * 1000, max: 10 });
const twoFactorLimiter = new RateLimiter({ windowMs: 15 * 60 * 1000, max: 10 });

function signupPage(req, { values = {}, errors = [] } = {}) {
  return {
    title: 'Join',
    body: html`<section class="narrow card">
      <h1>Join the Moonshots Community</h1>
      <p class="muted">Connect with founders, investors, builders and researchers near you and across the topics you care about.</p>
      ${errorList(errors)}
      <form method="post" action="/signup" class="stack">
        ${csrfField(req)}
        <label>Your name <input name="display_name" required maxlength="60" autocomplete="name" value="${values.display_name ?? ''}"></label>
        <label>Email <input type="email" name="email" required maxlength="254" autocomplete="email" value="${values.email ?? ''}">
          <small>Never shown to other members.</small></label>
        <label>Password <input type="password" name="password" required minlength="${PASSWORD_MIN}" maxlength="200" autocomplete="new-password">
          <small>At least ${PASSWORD_MIN} characters. A passphrase works well.</small></label>
        <label>I am primarily a…
          <select name="member_type">${MEMBER_TYPES.map(
            (t) => html`<option value="${t.key}" ${values.member_type === t.key ? 'selected' : ''}>${t.label}</option>`,
          )}</select></label>
        <div class="row">
          <label>City <input name="city" maxlength="60" value="${values.city ?? ''}" autocomplete="address-level2"></label>
          <label>Country <input name="country" maxlength="60" value="${values.country ?? ''}" autocomplete="country-name"></label>
        </div>
        <small class="muted">City-level only — we never ask for or show your exact location.</small>
        <label class="hp" aria-hidden="true">Leave this empty <input name="company_url" tabindex="-1" autocomplete="off"></label>
        <label class="check"><input type="checkbox" name="accept_coc" value="yes" required>
          I agree to the <a href="/code-of-conduct">code of conduct</a>, including no unsolicited pitching, spam or harassment.</label>
        <button class="btn">Create account</button>
      </form>
      <p class="muted">Already a member? <a href="/login">Sign in</a></p>
    </section>`,
  };
}

router.get('/signup', (req, res) => {
  if (req.user) return res.redirect(303, '/');
  res.page(signupPage(req));
});

router.post('/signup', limit(signupLimiter, (req) => `signup:${req.ip}`), async (req, res) => {
  const { db, config } = req.app.locals;
  const values = {
    display_name: v.text(req.body.display_name, { max: 60 }),
    email: v.email(req.body.email),
    member_type: v.oneOf(req.body.member_type, MEMBER_TYPE_KEYS, 'builder'),
    city: v.text(req.body.city, { max: 60 }),
    country: v.text(req.body.country, { max: 60 }),
  };
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const errors = [];

  // Honeypot: real people never see this field.
  if (req.body.company_url) return res.redirect(303, '/');

  if (values.display_name.length < 2) errors.push('Please enter your name.');
  if (!values.email) errors.push('Please enter a valid email address.');
  if (req.body.accept_coc !== 'yes') errors.push('You need to accept the code of conduct to join.');
  errors.push(...passwordProblems(password, { email: values.email, name: values.display_name }));

  if (!errors.length && db.prepare('SELECT 1 FROM users WHERE email = ?').get(values.email)) {
    errors.push("We couldn't create an account with that email. If you already have one, sign in instead.");
  }
  if (errors.length) return res.status(400).page(signupPage(req, { values: { ...values, email: req.body.email }, errors }));

  const now = Date.now();
  const hash = await hashPassword(password);
  const { lastInsertRowid: userId } = db
    .prepare('INSERT INTO users (email, password_hash, display_name, coc_accepted_at, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(values.email, hash, values.display_name, now, now);
  db.prepare('INSERT INTO profiles (user_id, member_type, city, country, updated_at) VALUES (?, ?, ?, ?, ?)').run(
    userId,
    values.member_type,
    values.city,
    values.country,
    now,
  );
  db.prepare(
    "INSERT OR IGNORE INTO hub_members (hub_id, user_id, joined_at) SELECT id, ?, ? FROM hubs WHERE slug = 'global-online'",
  ).run(userId, now);
  audit(db, userId, 'user.signup', `user:${userId}`);

  req.rotateCsrf();
  startSession(db, config, res, Number(userId));
  res.flash('welcome');
  res.redirect(303, '/profile/edit');
});

function loginPage(req, { email = '', error } = {}) {
  return {
    title: 'Sign in',
    body: html`<section class="narrow card">
      <h1>Sign in</h1>
      ${error ? errorList([error]) : ''}
      <form method="post" action="/login" class="stack">
        ${csrfField(req)}
        <label>Email <input type="email" name="email" required autocomplete="username" value="${email}"></label>
        <label>Password <input type="password" name="password" required autocomplete="current-password"></label>
        <button class="btn">Sign in</button>
      </form>
      <p class="muted">New here? <a href="/signup">Create an account</a></p>
    </section>`,
  };
}

router.get('/login', (req, res) => {
  if (req.user) return res.redirect(303, '/');
  res.page(loginPage(req));
});

router.post('/login', limit(loginLimiter, (req) => `login:${req.ip}`), async (req, res) => {
  const { db, config } = req.app.locals;
  const email = v.email(req.body.email);
  const password = typeof req.body.password === 'string' ? req.body.password.slice(0, 200) : '';
  const generic = 'Email or password is incorrect.';
  const user = email ? db.prepare('SELECT * FROM users WHERE email = ?').get(email) : null;

  if (!user) {
    await burnPasswordCheck(password);
    return res.status(401).page(loginPage(req, { email: req.body.email, error: generic }));
  }
  const now = Date.now();
  if (user.locked_until > now) {
    await burnPasswordCheck(password);
    return res.status(429).page(
      loginPage(req, { email, error: 'Too many failed attempts. This account is temporarily locked — try again in 15 minutes.' }),
    );
  }
  if (!(await verifyPassword(password, user.password_hash))) {
    const failed = user.failed_logins + 1;
    db.prepare('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?').run(
      failed >= LOCK_AFTER ? 0 : failed,
      failed >= LOCK_AFTER ? now + LOCK_MS : 0,
      user.id,
    );
    audit(db, null, failed >= LOCK_AFTER ? 'auth.locked' : 'auth.failed', `user:${user.id}`);
    return res.status(401).page(loginPage(req, { email, error: generic }));
  }
  if (user.status !== 'active') {
    return res.status(403).page(
      loginPage(req, { email, error: 'This account is suspended. Contact the moderation team if you think this is a mistake.' }),
    );
  }
  db.prepare('UPDATE users SET failed_logins = 0, locked_until = 0 WHERE id = ?').run(user.id);

  if (user.totp_secret) {
    setPending2fa(res, config, user.id);
    return res.redirect(303, '/login/2fa');
  }
  completeLogin(req, res, user.id);
});

function completeLogin(req, res, userId) {
  const { db, config } = req.app.locals;
  audit(db, userId, 'auth.login', `user:${userId}`);
  req.rotateCsrf();
  startSession(db, config, res, userId);
  res.flash('signed-in');
  res.redirect(303, '/');
}

// --- Two-factor step --------------------------------------------------------
// After a correct password we set a short-lived, HMAC-signed cookie naming the
// user; only a valid TOTP code turns it into a real session.

const PENDING_MS = 5 * 60 * 1000;
const pendingName = (config) => cookieName('mc_2fa', config.secure);
const sign = (config, payload) => createHmac('sha256', config.secret).update(`2fa:${payload}`).digest('base64url');

function setPending2fa(res, config, userId) {
  const payload = `${userId}.${Date.now() + PENDING_MS}`;
  setCookie(res, pendingName(config), `${payload}.${sign(config, payload)}`, {
    secure: config.secure,
    maxAgeSeconds: PENDING_MS / 1000,
    sameSite: 'Strict',
  });
}

function readPending2fa(req, config) {
  const raw = req.cookies[pendingName(config)];
  if (!raw) return null;
  const [uid, exp, mac] = raw.split('.');
  if (!uid || !exp || !mac) return null;
  const expected = sign(config, `${uid}.${exp}`);
  if (mac.length !== expected.length || !timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  if (Number(exp) < Date.now()) return null;
  return v.id(uid);
}

function twoFactorPage(req, error) {
  return {
    title: 'Two-factor authentication',
    body: html`<section class="narrow card">
      <h1>Enter your 6-digit code</h1>
      <p class="muted">Open your authenticator app and enter the current code for Moonshots Community.</p>
      ${error ? errorList([error]) : ''}
      <form method="post" action="/login/2fa" class="stack">
        ${csrfField(req)}
        <label>Code <input name="code" inputmode="numeric" pattern="[0-9 ]{6,7}" maxlength="7" autocomplete="one-time-code" required></label>
        <button class="btn">Verify</button>
      </form>
    </section>`,
  };
}

router.get('/login/2fa', (req, res) => {
  if (!readPending2fa(req, req.app.locals.config)) return res.redirect(303, '/login');
  res.page(twoFactorPage(req));
});

router.post('/login/2fa', limit(twoFactorLimiter, (req) => `2fa:${req.ip}`), (req, res) => {
  const { db, config } = req.app.locals;
  const userId = readPending2fa(req, config);
  if (!userId) return res.redirect(303, '/login');
  const user = db.prepare('SELECT id, status, totp_secret, totp_last_step FROM users WHERE id = ?').get(userId);
  if (!user || user.status !== 'active' || !user.totp_secret) return res.redirect(303, '/login');

  const step = verifyCode(user.totp_secret, req.body.code, { lastStep: user.totp_last_step });
  if (step === null) {
    audit(db, null, 'auth.2fa_failed', `user:${user.id}`);
    return res.status(401).page(twoFactorPage(req, 'That code is not valid. Check your device clock and try again.'));
  }
  db.prepare('UPDATE users SET totp_last_step = ? WHERE id = ?').run(step, user.id);
  clearCookie(res, pendingName(config), config);
  completeLogin(req, res, user.id);
});

router.post('/logout', (req, res) => {
  const { db, config } = req.app.locals;
  endSession(db, config, req, res);
  req.rotateCsrf();
  res.flash('signed-out');
  res.redirect(303, '/');
});

router.get('/code-of-conduct', (req, res) => {
  res.page({ title: 'Code of conduct', body: codeOfConduct() });
});

export default router;
