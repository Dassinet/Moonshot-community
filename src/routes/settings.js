import { createHmac, timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { html, timeAgo } from '../views/html.js';
import { csrfField, errorList } from '../views/layout.js';
import { requireAuth } from '../middleware.js';
import { RateLimiter, limit } from '../security/rateLimit.js';
import { hashPassword, verifyPassword, passwordProblems, PASSWORD_MIN } from '../security/passwords.js';
import { startSession, endAllSessions, endSession } from '../security/sessions.js';
import { generateSecret, verifyCode, otpauthUri } from '../security/totp.js';
import { audit } from '../db.js';

const router = Router();
// Re-authentication attempts (password confirmations) are rate limited too.
const sensitiveLimiter = new RateLimiter({ windowMs: 15 * 60 * 1000, max: 10 });
const sensitive = limit(sensitiveLimiter, (req) => `sensitive:${req.user.id}`);

// A 2FA secret being set up lives only in the form until confirmed. It is
// HMAC-bound to the user so it can't be swapped for another value.
const bindSecret = (config, uid, secret) => createHmac('sha256', config.secret).update(`totp-setup:${uid}:${secret}`).digest('base64url');

function settingsPage(req, { errors = [], setupSecret } = {}) {
  const { db, config } = req.app.locals;
  const uid = req.user.id;
  const sessions = db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ? AND expires_at > ?').get(uid, Date.now()).n;
  const account = db.prepare('SELECT created_at FROM users WHERE id = ?').get(uid);
  const blocked = db
    .prepare('SELECT u.id, u.display_name FROM blocks b JOIN users u ON u.id = b.blocked_id WHERE b.blocker_id = ? ORDER BY u.display_name')
    .all(uid);

  return {
    title: 'Security & settings',
    body: html`<h1>Security &amp; settings</h1>
      ${errorList(errors)}
      <section class="card">
        <h2>Account</h2>
        <p>Signed in as <strong>${req.user.email}</strong> (only visible to you and moderators). Member since ${timeAgo(account.created_at)}.</p>
      </section>

      <section class="card">
        <h2>Two-factor authentication</h2>
        ${req.user.has2fa
          ? html`<p>✅ Two-factor authentication is <strong>on</strong>.</p>
              <form method="post" action="/settings/2fa/disable" class="stack">${csrfField(req)}
                <label>Confirm your password to turn it off <input type="password" name="password" required autocomplete="current-password"></label>
                <button class="btn ghost small">Turn off 2FA</button></form>`
          : setupSecret
            ? html`<ol>
                <li>Open your authenticator app (1Password, Google Authenticator, Authy…) and add an account manually.</li>
                <li>Enter this key: <code class="secret">${setupSecret.match(/.{1,4}/g).join(' ')}</code>
                  <br><small class="muted">Or use this setup URI: <code>${otpauthUri(setupSecret, req.user.email)}</code></small></li>
                <li>Enter the 6-digit code the app shows.</li></ol>
              <form method="post" action="/settings/2fa/enable" class="stack">${csrfField(req)}
                <input type="hidden" name="secret" value="${setupSecret}">
                <input type="hidden" name="binding" value="${bindSecret(config, uid, setupSecret)}">
                <label>Code <input name="code" inputmode="numeric" maxlength="7" autocomplete="one-time-code" required></label>
                <button class="btn small">Confirm and turn on</button></form>`
            : html`<p>Protect your account with a code from an authenticator app. Strongly recommended for investors and founders.</p>
              <form method="post" action="/settings/2fa/setup">${csrfField(req)}<button class="btn small">Set up 2FA</button></form>`}
      </section>

      <section class="card">
        <h2>Change password</h2>
        <form method="post" action="/settings/password" class="stack">${csrfField(req)}
          <label>Current password <input type="password" name="current" required autocomplete="current-password"></label>
          <label>New password <input type="password" name="password" required minlength="${PASSWORD_MIN}" maxlength="200" autocomplete="new-password"></label>
          <button class="btn small">Change password</button>
        </form>
      </section>

      <section class="card">
        <h2>Sessions</h2>
        <p>You are signed in on ${sessions} device${sessions === 1 ? '' : 's'}.</p>
        <form method="post" action="/settings/sessions/revoke">${csrfField(req)}<button class="btn ghost small">Sign out everywhere else</button></form>
      </section>

      <section class="card">
        <h2>Blocked members</h2>
        ${blocked.length
          ? html`<ul class="plain">${blocked.map(
              (b) => html`<li>${b.display_name} <form class="inline" method="post" action="/members/${b.id}/unblock">${csrfField(req)}<button class="linklike">Unblock</button></form></li>`,
            )}</ul>`
          : html`<p class="muted">You haven't blocked anyone.</p>`}
      </section>

      <section class="card danger-zone">
        <h2>Delete account</h2>
        <p>This permanently deletes your profile, posts, comments, messages and connections. It cannot be undone.</p>
        <form method="post" action="/settings/delete" class="stack">${csrfField(req)}
          <label>Confirm your password <input type="password" name="password" required autocomplete="current-password"></label>
          <label class="check"><input type="checkbox" name="confirm" value="yes" required> I understand this is permanent</label>
          <button class="btn danger small">Delete my account</button>
        </form>
      </section>`,
  };
}

const passwordOk = async (db, uid, password) => {
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(uid);
  return typeof password === 'string' && password.length <= 200 && verifyPassword(password, row.password_hash);
};

router.get('/settings', requireAuth, (req, res) => res.page(settingsPage(req)));

router.post('/settings/password', requireAuth, sensitive, async (req, res) => {
  const { db, config } = req.app.locals;
  const uid = req.user.id;
  if (!(await passwordOk(db, uid, req.body.current))) {
    return res.status(400).page(settingsPage(req, { errors: ['Your current password is incorrect.'] }));
  }
  const problems = passwordProblems(req.body.password, { email: req.user.email, name: req.user.displayName });
  if (problems.length) return res.status(400).page(settingsPage(req, { errors: problems }));
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(req.body.password), uid);
  // Changing the password signs out every session, then starts a fresh one here.
  endAllSessions(db, uid);
  req.rotateCsrf();
  startSession(db, config, res, uid);
  audit(db, uid, 'auth.password_changed', `user:${uid}`);
  res.flash('password-changed');
  res.redirect(303, '/settings');
});

router.post('/settings/sessions/revoke', requireAuth, (req, res) => {
  const { db } = req.app.locals;
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').run(req.user.id, req.sessionId);
  audit(db, req.user.id, 'auth.sessions_revoked', `user:${req.user.id}`);
  res.flash('sessions-revoked');
  res.redirect(303, '/settings');
});

router.post('/settings/2fa/setup', requireAuth, (req, res) => {
  if (req.user.has2fa) return res.redirect(303, '/settings');
  res.page(settingsPage(req, { setupSecret: generateSecret() }));
});

router.post('/settings/2fa/enable', requireAuth, sensitive, (req, res) => {
  const { db, config } = req.app.locals;
  const uid = req.user.id;
  const secret = typeof req.body.secret === 'string' ? req.body.secret : '';
  const binding = typeof req.body.binding === 'string' ? req.body.binding : '';
  const expected = bindSecret(config, uid, secret);
  if (!/^[A-Z2-7]{32}$/.test(secret) || binding.length !== expected.length || !timingSafeEqual(Buffer.from(binding), Buffer.from(expected))) {
    return res.redirect(303, '/settings');
  }
  const step = verifyCode(secret, req.body.code);
  if (step === null) {
    return res.status(400).page(settingsPage(req, { setupSecret: secret, errors: ["That code didn't match. Check the key and your device clock."] }));
  }
  db.prepare('UPDATE users SET totp_secret = ?, totp_last_step = ? WHERE id = ?').run(secret, step, uid);
  audit(db, uid, 'auth.2fa_enabled', `user:${uid}`);
  res.flash('2fa-enabled');
  res.redirect(303, '/settings');
});

router.post('/settings/2fa/disable', requireAuth, sensitive, async (req, res) => {
  const { db } = req.app.locals;
  const uid = req.user.id;
  if (!(await passwordOk(db, uid, req.body.password))) {
    return res.status(400).page(settingsPage(req, { errors: ['Password is incorrect.'] }));
  }
  db.prepare('UPDATE users SET totp_secret = NULL, totp_last_step = 0 WHERE id = ?').run(uid);
  audit(db, uid, 'auth.2fa_disabled', `user:${uid}`);
  res.flash('2fa-disabled');
  res.redirect(303, '/settings');
});

router.post('/settings/delete', requireAuth, sensitive, async (req, res) => {
  const { db, config } = req.app.locals;
  const uid = req.user.id;
  if (req.body.confirm !== 'yes' || !(await passwordOk(db, uid, req.body.password))) {
    return res.status(400).page(settingsPage(req, { errors: ['Please confirm with your password and tick the box to delete your account.'] }));
  }
  endSession(db, config, req, res);
  // ON DELETE CASCADE removes profile, interests, memberships, posts, comments,
  // connections, messages, blocks and sessions.
  db.prepare('DELETE FROM users WHERE id = ?').run(uid);
  audit(db, null, 'user.deleted', `user:${uid}`);
  req.rotateCsrf();
  res.flash('account-deleted');
  res.redirect(303, '/');
});

export default router;
