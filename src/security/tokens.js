import { randomBytes, createHash } from 'node:crypto';

// Single-use tokens for emailed links. The raw token only ever exists in the
// email; the database stores its SHA-256, so a database leak can't be used to
// activate accounts or reset passwords.

export const TTL = { verify: 24 * 60 * 60 * 1000, reset: 60 * 60 * 1000 };
// At most this many emails of each kind per account per hour (anti-mailbombing).
export const MAX_PER_HOUR = 3;

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

export async function canIssue(db, userId, purpose) {
  const since = Date.now() - 60 * 60 * 1000;
  return (await db.get('SELECT COUNT(*) AS n FROM email_tokens WHERE user_id = ? AND purpose = ? AND created_at > ?', userId, purpose, since)).n < MAX_PER_HOUR;
}

export async function issueToken(db, userId, purpose) {
  const token = randomBytes(32).toString('base64url');
  const now = Date.now();
  (await db.run('DELETE FROM email_tokens WHERE expires_at < ?', now));
  (await db.run('INSERT INTO email_tokens (id, user_id, purpose, created_at, expires_at) VALUES (?, ?, ?, ?, ?)', sha256(token), userId, purpose, now, now + TTL[purpose]));
  return token;
}

// Returns the user id a valid token belongs to, without using it up.
export async function peekToken(db, token, purpose) {
  if (typeof token !== 'string' || token.length < 40 || token.length > 60) return null;
  const row = (await db.get('SELECT user_id, expires_at FROM email_tokens WHERE id = ? AND purpose = ?', sha256(token), purpose));
  return row && row.expires_at > Date.now() ? row.user_id : null;
}

// Validates and burns the token — plus every other outstanding token of the
// same kind for that user, so older links stop working too.
export async function consumeToken(db, token, purpose) {
  const userId = (await peekToken(db, token, purpose));
  if (userId) (await db.run('DELETE FROM email_tokens WHERE user_id = ? AND purpose = ?', userId, purpose));
  return userId;
}
