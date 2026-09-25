import { Router } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { html } from '../views/html.js';
import { csrfField, errorList } from '../views/layout.js';
import { hashPassword, verifyPassword, burnPasswordCheck, passwordProblems, PASSWORD_MIN } from '../security/passwords.js';
import { startSession, endSession, endAllSessions } from '../security/sessions.js';
import { issueToken, peekToken, consumeToken, canIssue } from '../security/tokens.js';
import { activationEmail, alreadyRegisteredEmail, resetEmail, passwordChangedEmail } from '../views/emails.js';
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

  if (errors.length) return res.status(400).page(signupPage(req, { values: { ...values, email: req.body.email }, errors }));

  // Hash before checking for an existing account so both paths take the same
  // time, and respond identically either way — the signup form must not reveal
  // who is a member. The owner of an existing account gets a heads-up email.
  const hash = await hashPassword(password);
  const existing = db.prepare('SELECT id, display_name FROM users WHERE email = ?').get(values.email);
  const { mailer } = req.app.locals;
  try {
    if (existing) {
      await mailer.send({
        to: values.email,
        ...alreadyRegisteredEmail({ name: existing.display_name, loginUrl: `${config.appUrl}/login`, resetUrl: `${config.appUrl}/forgot` }),
      });
    } else {
      const now = Date.now();
      const { lastInsertRowid } = db
        .prepare('INSERT INTO users (email, password_hash, display_name, coc_accepted_at, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(values.email, hash, values.display_name, now, now);
      const userId = Number(lastInsertRowid);
      db.prepare('INSERT INTO profiles (user_id, member_type, city, country, updated_at) VALUES (?, ?, ?, ?, ?)').run(
        userId, values.member_type, values.city, values.country, now,
      );
      db.prepare(
        "INSERT OR IGNORE INTO hub_members (hub_id, user_id, joined_at) SELECT id, ?, ? FROM hubs WHERE slug = 'global-online'",
      ).run(userId, now);
      audit(db, userId, 'user.signup', `user:${userId}`);
      await sendActivation(req, { id: userId, display_name: values.display_name, email: values.email });
    }
  } catch (err) {
    console.error('signup email failed:', err.message);
    return res.status(503).page(signupPage(req, {
      values: { ...values, email: req.body.email },
      errors: ["We couldn't send your activation email just now. Please try again in a few minutes."],
    }));
  }
  res.redirect(303, '/signup/check-email');
});

async function sendActivation(req, user) {
  const { db, config, mailer } = req.app.locals;
  const token = issueToken(db, user.id, 'verify');
  await mailer.send({ to: user.email, ...activationEmail({ name: user.display_name, url: `${config.appUrl}/verify?token=${token}` }) });
}

function checkEmailPage(title, message) {
  return {
    title,
    body: html`<section class="narrow card center">
      <div class="big-icon" aria-hidden="true">📬</div>
      <h1>${title}</h1>
      <p>${message}</p>
      <p class="muted small">Can't find it? Check your spam folder, or <a href="/verify/resend">send a new activation link</a>.</p>
    </section>`,
  };
}

router.get('/signup/check-email', (req, res) => {
  res.page(checkEmailPage('Check your email', "If that address can be used, we've sent it a link to activate your account. The link expires in 24 hours."));
});

// --- Email activation -------------------------------------------------------
// Opening the link shows a confirm button rather than activating immediately:
// corporate email scanners pre-fetch links, and a GET must never change state.

function badLinkPage(req, what) {
  return {
    title: 'Link expired',
    body: html`<section class="narrow card center">
      <h1>This link has expired or was already used</h1>
      <p class="muted">For your security, ${what} links only work once and expire after a while.</p>
      <p><a class="btn" href="${what === 'activation' ? '/verify/resend' : '/forgot'}">Get a new link</a></p>
    </section>`,
  };
}

router.get('/verify', (req, res) => {
  const { db } = req.app.locals;
  const token = typeof req.query.token === 'string' ? req.query.token : '';
  if (!peekToken(db, token, 'verify')) return res.status(400).page(badLinkPage(req, 'activation'));
  res.page({
    title: 'Activate your account',
    body: html`<section class="narrow card center">
      <div class="big-icon" aria-hidden="true">🚀</div>
      <h1>One last step</h1>
      <p>Confirm your email address to activate your account.</p>
      <form method="post" action="/verify">${csrfField(req)}<input type="hidden" name="token" value="${token}">
        <button class="btn">Activate my account</button></form>
    </section>`,
  });
});

router.post('/verify', (req, res) => {
  const { db, config } = req.app.locals;
  const userId = consumeToken(db, req.body.token, 'verify');
  if (!userId) return res.status(400).page(badLinkPage(req, 'activation'));
  const user = db.prepare('SELECT id, status, email_verified_at FROM users WHERE id = ?').get(userId);
  if (!user || user.status !== 'active') return res.redirect(303, '/login');
  if (!user.email_verified_at) db.prepare('UPDATE users SET email_verified_at = ? WHERE id = ?').run(Date.now(), userId);
  audit(db, userId, 'user.email_verified', `user:${userId}`);
  endSession(db, config, req, res);
  req.rotateCsrf();
  startSession(db, config, res, userId);
  res.flash('welcome');
  res.redirect(303, '/profile/edit');
});

function emailFormPage(req, { title, intro, action, button }) {
  return {
    title,
    body: html`<section class="narrow card">
      <h1>${title}</h1>
      <p class="muted">${intro}</p>
      <form method="post" action="${action}" class="stack">${csrfField(req)}
        <label>Email <input type="email" name="email" required autocomplete="email"></label>
        <button class="btn">${button}</button></form>
    </section>`,
  };
}

const emailLimiter = new RateLimiter({ windowMs: 60 * 60 * 1000, max: 10 });

router.get('/verify/resend', (req, res) =>
  res.page(emailFormPage(req, { title: 'Resend activation link', intro: "Enter the email you signed up with and we'll send a fresh activation link.", action: '/verify/resend', button: 'Send link' })),
);

router.post('/verify/resend', limit(emailLimiter, (req) => `email:${req.ip}`), async (req, res) => {
  const { db } = req.app.locals;
  const email = v.email(req.body.email);
  const user = email && db.prepare("SELECT id, email, display_name FROM users WHERE email = ? AND status = 'active' AND email_verified_at IS NULL").get(email);
  if (user && canIssue(db, user.id, 'verify')) {
    await sendActivation(req, user).catch((err) => console.error('resend email failed:', err.message));
  }
  res.page(checkEmailPage('Check your email', "If there's an account waiting to be activated for that address, we've sent a new link."));
});

// --- Password reset ---------------------------------------------------------

router.get('/forgot', (req, res) =>
  res.page(emailFormPage(req, { title: 'Reset your password', intro: "Enter your account email and we'll send you a link to choose a new password.", action: '/forgot', button: 'Send reset link' })),
);

router.post('/forgot', limit(emailLimiter, (req) => `email:${req.ip}`), async (req, res) => {
  const { db, config, mailer } = req.app.locals;
  const email = v.email(req.body.email);
  const user = email && db.prepare("SELECT id, email, display_name FROM users WHERE email = ? AND status = 'active'").get(email);
  if (user && canIssue(db, user.id, 'reset')) {
    const token = issueToken(db, user.id, 'reset');
    await mailer
      .send({ to: user.email, ...resetEmail({ name: user.display_name, url: `${config.appUrl}/reset?token=${token}` }) })
      .catch((err) => console.error('reset email failed:', err.message));
    audit(db, null, 'auth.reset_requested', `user:${user.id}`);
  }
  res.page(checkEmailPage('Check your email', "If there's an account for that address, we've sent it a link to reset your password. It expires in 1 hour."));
});

function resetPage(req, token, errors = []) {
  return {
    title: 'Choose a new password',
    body: html`<section class="narrow card">
      <h1>Choose a new password</h1>
      ${errorList(errors)}
      <form method="post" action="/reset" class="stack">${csrfField(req)}
        <input type="hidden" name="token" value="${token}">
        <label>New password <input type="password" name="password" required minlength="${PASSWORD_MIN}" maxlength="200" autocomplete="new-password">
          <small>At least ${PASSWORD_MIN} characters.</small></label>
        <button class="btn">Save new password</button></form>
    </section>`,
  };
}

router.get('/reset', (req, res) => {
  const token = typeof req.query.token === 'string' ? req.query.token : '';
  if (!peekToken(req.app.locals.db, token, 'reset')) return res.status(400).page(badLinkPage(req, 'password reset'));
  res.page(resetPage(req, token));
});

router.post('/reset', limit(emailLimiter, (req) => `reset:${req.ip}`), async (req, res) => {
  const { db, config, mailer } = req.app.locals;
  const token = typeof req.body.token === 'string' ? req.body.token : '';
  const userId = peekToken(db, token, 'reset');
  if (!userId) return res.status(400).page(badLinkPage(req, 'password reset'));
  const user = db.prepare('SELECT id, email, display_name FROM users WHERE id = ?').get(userId);
  const problems = passwordProblems(req.body.password, { email: user.email, name: user.display_name });
  if (problems.length) return res.status(400).page(resetPage(req, token, problems));
  if (consumeToken(db, token, 'reset') !== userId) return res.status(400).page(badLinkPage(req, 'password reset'));

  const now = Date.now();
  // A working reset link also proves the member owns the address.
  db.prepare(
    'UPDATE users SET password_hash = ?, failed_logins = 0, locked_until = 0, email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?',
  ).run(await hashPassword(req.body.password), now, userId);
  endAllSessions(db, userId);
  audit(db, userId, 'auth.password_reset', `user:${userId}`);
  await mailer
    .send({ to: user.email, ...passwordChangedEmail({ name: user.display_name, resetUrl: `${config.appUrl}/forgot` }) })
    .catch((err) => console.error('notice email failed:', err.message));
  req.rotateCsrf();
  res.flash('password-reset');
  res.redirect(303, '/login');
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
      <p class="muted"><a href="/forgot">Forgot your password?</a> · New here? <a href="/signup">Create an account</a></p>
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

  // Only revealed after a correct password, so it doesn't leak who has signed up.
  if (!user.email_verified_at) {
    if (canIssue(db, user.id, 'verify')) {
      await sendActivation(req, user).catch((err) => console.error('activation email failed:', err.message));
    }
    return res.status(403).page(checkEmailPage('Activate your account first',
      "Your account isn't activated yet. We've sent a fresh activation link to your email — click it to finish joining."));
  }

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
