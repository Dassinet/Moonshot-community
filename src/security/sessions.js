import { randomBytes, createHash } from 'node:crypto';
import { cookieName, setCookie, clearCookie } from './cookies.js';

const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

export function sessionMiddleware(db, config) {
  const name = cookieName('mc_sid', config.secure);
  const lookup = db.prepare(
    `SELECT s.id AS session_id, s.expires_at, u.id, u.email, u.display_name, u.role, u.status, u.verified,
            u.email_verified_at, u.totp_secret IS NOT NULL AS has_2fa
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = ?`,
  );
  const drop = db.prepare('DELETE FROM sessions WHERE id = ?');

  return (req, res, next) => {
    req.user = null;
    const token = req.cookies[name];
    if (token) {
      const row = lookup.get(sha256(token));
      if (row && row.expires_at > Date.now() && row.status === 'active' && row.email_verified_at) {
        req.sessionId = row.session_id;
        req.user = {
          id: row.id,
          email: row.email,
          displayName: row.display_name,
          role: row.role,
          verified: !!row.verified,
          has2fa: !!row.has_2fa,
        };
      } else {
        if (row) drop.run(row.session_id);
        clearCookie(res, name, config);
      }
    }
    next();
  };
}

// Always issue a brand-new session id on login (prevents session fixation).
export function startSession(db, config, res, userId) {
  const token = randomBytes(32).toString('base64url');
  const now = Date.now();
  db.prepare('INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
    sha256(token),
    userId,
    now,
    now + SESSION_TTL_MS,
  );
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
  setCookie(res, cookieName('mc_sid', config.secure), token, {
    secure: config.secure,
    maxAgeSeconds: SESSION_TTL_MS / 1000,
  });
}

export function endSession(db, config, req, res) {
  if (req.sessionId) db.prepare('DELETE FROM sessions WHERE id = ?').run(req.sessionId);
  clearCookie(res, cookieName('mc_sid', config.secure), config);
}

export function endAllSessions(db, userId) {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}
