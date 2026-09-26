import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { INTERESTS, REGION_HUBS } from './taxonomy.js';

// Database layer with one async interface and two interchangeable backends:
//
//  - a local SQLite file (Node's built-in node:sqlite) for development, tests
//    and hosts with a persistent disk;
//  - Turso (hosted SQLite, https://turso.tech) when TURSO_DATABASE_URL is set,
//    which is what makes data permanent on serverless hosts like Vercel.
//
// Both speak the same SQLite dialect, so schema and queries are identical.
// All queries use bound parameters. Never build SQL by concatenating user input.

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id              INTEGER PRIMARY KEY,
  email           TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash   TEXT NOT NULL,
  display_name    TEXT NOT NULL,
  role            TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member','moderator','admin')),
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  verified        INTEGER NOT NULL DEFAULT 0,
  failed_logins   INTEGER NOT NULL DEFAULT 0,
  locked_until    INTEGER NOT NULL DEFAULT 0,
  totp_secret     TEXT,
  totp_last_step  INTEGER NOT NULL DEFAULT 0,
  email_verified_at INTEGER,             -- NULL until the member clicks their activation link
  coc_accepted_at INTEGER NOT NULL,
  created_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS profiles (
  user_id        INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  member_type    TEXT NOT NULL DEFAULT 'builder',
  headline       TEXT NOT NULL DEFAULT '',
  bio            TEXT NOT NULL DEFAULT '',
  city           TEXT NOT NULL DEFAULT '',
  country        TEXT NOT NULL DEFAULT '',
  seeking        TEXT NOT NULL DEFAULT '',
  looking_for    TEXT NOT NULL DEFAULT '',
  website        TEXT NOT NULL DEFAULT '',
  visibility     TEXT NOT NULL DEFAULT 'members' CHECK (visibility IN ('members','connections')),
  in_directory   INTEGER NOT NULL DEFAULT 1,
  open_to_intros INTEGER NOT NULL DEFAULT 1,
  updated_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS interests (
  id   INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_interests (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  interest_id INTEGER NOT NULL REFERENCES interests(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, interest_id)
);

CREATE TABLE IF NOT EXISTS hubs (
  id          INTEGER PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('region','interest')),
  description TEXT NOT NULL DEFAULT '',
  interest_id INTEGER REFERENCES interests(id),
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS hub_members (
  hub_id    INTEGER NOT NULL REFERENCES hubs(id) ON DELETE CASCADE,
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (hub_id, user_id)
);

CREATE TABLE IF NOT EXISTS posts (
  id         INTEGER PRIMARY KEY,
  hub_id     INTEGER NOT NULL REFERENCES hubs(id) ON DELETE CASCADE,
  author_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  hidden     INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS posts_hub ON posts(hub_id, created_at DESC);

CREATE TABLE IF NOT EXISTS comments (
  id         INTEGER PRIMARY KEY,
  post_id    INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  author_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  hidden     INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS connections (
  id           INTEGER PRIMARY KEY,
  requester_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  addressee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined')),
  note         TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  responded_at INTEGER,
  UNIQUE (requester_id, addressee_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id           INTEGER PRIMARY KEY,
  sender_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body         TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  read_at      INTEGER
);
CREATE INDEX IF NOT EXISTS messages_pair ON messages(sender_id, recipient_id, created_at);

CREATE TABLE IF NOT EXISTS blocks (
  blocker_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (blocker_id, blocked_id)
);

CREATE TABLE IF NOT EXISTS reports (
  id              INTEGER PRIMARY KEY,
  reporter_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  target_type     TEXT NOT NULL CHECK (target_type IN ('user','post','comment','message')),
  target_id       INTEGER NOT NULL,
  reason          TEXT NOT NULL,
  details         TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','actioned','dismissed')),
  resolved_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  resolution_note TEXT NOT NULL DEFAULT '',
  created_at      INTEGER NOT NULL,
  resolved_at     INTEGER
);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,           -- SHA-256 of the cookie token; the raw token is never stored
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

-- Single-use email tokens (activation, password reset). Only the SHA-256 of
-- the token is stored, like sessions.
CREATE TABLE IF NOT EXISTS email_tokens (
  id         TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose    TEXT NOT NULL CHECK (purpose IN ('verify','reset')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS email_tokens_user ON email_tokens(user_id, purpose, created_at);

CREATE TABLE IF NOT EXISTS events (
  id          INTEGER PRIMARY KEY,
  hub_id      INTEGER NOT NULL REFERENCES hubs(id) ON DELETE CASCADE,
  host_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  starts_at   INTEGER NOT NULL,          -- UTC milliseconds
  ends_at     INTEGER NOT NULL,
  timezone    TEXT NOT NULL,             -- IANA zone the times are shown in
  venue       TEXT NOT NULL DEFAULT '',  -- in-person address, if any
  online_url  TEXT NOT NULL DEFAULT '',  -- only shown to people who are going
  capacity    INTEGER,
  cancelled   INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS events_start ON events(starts_at);

CREATE TABLE IF NOT EXISTS event_rsvps (
  event_id   INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status     TEXT NOT NULL CHECK (status IN ('going','interested')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (event_id, user_id)
);

CREATE TABLE IF NOT EXISTS app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY,
  actor_id   INTEGER,
  action     TEXT NOT NULL,
  target     TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
`;

const toNumber = (v) => (typeof v === 'bigint' ? Number(v) : v);

class SqliteBackend {
  constructor(path) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    this.cache = new Map();
  }
  stmt(sql) {
    let s = this.cache.get(sql);
    if (!s) this.cache.set(sql, (s = this.db.prepare(sql)));
    return s;
  }
  async get(sql, args) { return this.stmt(sql).get(...args); }
  async all(sql, args) { return this.stmt(sql).all(...args); }
  async run(sql, args) {
    const r = this.stmt(sql).run(...args);
    return { changes: toNumber(r.changes), lastInsertRowid: toNumber(r.lastInsertRowid) };
  }
  async exec(sql) { this.db.exec(sql); }
  async batch(stmts) {
    this.db.exec('BEGIN');
    try {
      const out = stmts.map(([sql, args = []]) => this.stmt(sql).run(...args));
      this.db.exec('COMMIT');
      return out.map((r) => ({ changes: toNumber(r.changes), lastInsertRowid: toNumber(r.lastInsertRowid) }));
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }
  async close() { this.db.close(); }
}

// Turso / libSQL over HTTPS (works on serverless). Rows are converted to plain
// objects so both backends return identical shapes.
class LibsqlBackend {
  constructor(client) { this.client = client; }
  static rows(rs) { return rs.rows.map((row) => Object.fromEntries(rs.columns.map((c, i) => [c, toNumber(row[i])]))); }
  async get(sql, args) { return LibsqlBackend.rows(await this.client.execute({ sql, args }))[0]; }
  async all(sql, args) { return LibsqlBackend.rows(await this.client.execute({ sql, args })); }
  async run(sql, args) {
    const r = await this.client.execute({ sql, args });
    return { changes: r.rowsAffected, lastInsertRowid: toNumber(r.lastInsertRowid) };
  }
  async exec(sql) { await this.client.executeMultiple(sql); }
  async batch(stmts) {
    const rs = await this.client.batch(stmts.map(([sql, args = []]) => ({ sql, args })), 'write');
    return rs.map((r) => ({ changes: r.rowsAffected, lastInsertRowid: toNumber(r.lastInsertRowid) }));
  }
  async close() { this.client.close(); }
}

export class Database {
  constructor(backend, kind) {
    this.backend = backend;
    this.kind = kind; // 'sqlite' | 'turso'
  }
  get persistent() { return this.kind === 'turso' || this.path !== ':memory:'; }
  get(sql, ...args) { return this.backend.get(sql, args); }
  all(sql, ...args) { return this.backend.all(sql, args); }
  run(sql, ...args) { return this.backend.run(sql, args); }
  exec(sql) { return this.backend.exec(sql); }
  // Runs [sql, args] pairs atomically: all succeed or none do.
  batch(stmts) { return this.backend.batch(stmts); }
  close() { return this.backend.close(); }
}

// options: { path } for a local file, or { url, authToken } for Turso, or
// { client } to pass a ready libSQL client (used by tests).
export async function openDb(options = {}) {
  const opts = typeof options === 'string' ? { path: options } : options;
  let db;
  if (opts.client) {
    db = new Database(new LibsqlBackend(opts.client), 'turso');
  } else if (opts.url) {
    const { createClient } = await import('@libsql/client/web');
    db = new Database(new LibsqlBackend(createClient({ url: opts.url, authToken: opts.authToken })), 'turso');
  } else {
    db = new Database(new SqliteBackend(opts.path ?? ':memory:'), 'sqlite');
    db.path = opts.path ?? ':memory:';
  }
  await db.exec(SCHEMA);
  await migrate(db);
  await seedTaxonomy(db);
  return db;
}

// Upgrades databases created by earlier versions.
async function migrate(db) {
  const cols = (await db.all('PRAGMA table_info(users)')).map((c) => c.name);
  if (!cols.includes('email_verified_at')) {
    // Accounts that existed before email activation are treated as activated.
    await db.batch([['ALTER TABLE users ADD COLUMN email_verified_at INTEGER'], ['UPDATE users SET email_verified_at = created_at']]);
  }
}

async function seedTaxonomy(db) {
  const now = Date.now();
  const stmts = [];
  for (const [slug, name] of INTERESTS) {
    stmts.push(['INSERT OR IGNORE INTO interests (slug, name) VALUES (?, ?)', [slug, name]]);
    stmts.push([
      `INSERT OR IGNORE INTO hubs (slug, name, kind, description, interest_id, created_at)
       VALUES (?, ?, 'interest', ?, (SELECT id FROM interests WHERE slug = ?), ?)`,
      [`topic-${slug}`, name, `Everyone working on or curious about ${name.toLowerCase()}.`, slug, now],
    ]);
  }
  for (const [slug, name, description] of REGION_HUBS) {
    stmts.push(["INSERT OR IGNORE INTO hubs (slug, name, kind, description, interest_id, created_at) VALUES (?, ?, 'region', ?, NULL, ?)", [slug, name, description, now]]);
  }
  await db.batch(stmts);
}

// A random secret generated once and kept in the database, for deployments
// that don't set SESSION_SECRET. Shared by every server instance.
export async function storedSecret(db) {
  await db.run("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('secret', ?)", randomBytes(32).toString('hex'));
  return (await db.get("SELECT value FROM app_settings WHERE key = 'secret'")).value;
}

export function audit(db, actorId, action, target = '') {
  return db.run('INSERT INTO audit_log (actor_id, action, target, created_at) VALUES (?, ?, ?, ?)', actorId ?? null, action, String(target), Date.now());
}

// Is there a block in either direction between two users?
export async function isBlocked(db, a, b) {
  return !!(await db.get('SELECT 1 FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)', a, b, b, a));
}

export function connectionBetween(db, a, b) {
  return db.get(
    `SELECT * FROM connections
      WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)
      ORDER BY id DESC LIMIT 1`,
    a, b, b, a,
  );
}

export async function areConnected(db, a, b) {
  return (await connectionBetween(db, a, b))?.status === 'accepted';
}

// Deletes a member and everything that belongs to them. Done explicitly
// (rather than relying on ON DELETE CASCADE) because hosted SQLite doesn't
// guarantee foreign-key enforcement inside batches.
export function deleteUser(db, uid) {
  return db.batch([
    ['DELETE FROM event_rsvps WHERE user_id = ? OR event_id IN (SELECT id FROM events WHERE host_id = ?)', [uid, uid]],
    ['DELETE FROM events WHERE host_id = ?', [uid]],
    ['DELETE FROM comments WHERE author_id = ? OR post_id IN (SELECT id FROM posts WHERE author_id = ?)', [uid, uid]],
    ['DELETE FROM posts WHERE author_id = ?', [uid]],
    ['DELETE FROM messages WHERE sender_id = ? OR recipient_id = ?', [uid, uid]],
    ['DELETE FROM connections WHERE requester_id = ? OR addressee_id = ?', [uid, uid]],
    ['DELETE FROM blocks WHERE blocker_id = ? OR blocked_id = ?', [uid, uid]],
    ['DELETE FROM hub_members WHERE user_id = ?', [uid]],
    ['DELETE FROM user_interests WHERE user_id = ?', [uid]],
    ['DELETE FROM email_tokens WHERE user_id = ?', [uid]],
    ['DELETE FROM sessions WHERE user_id = ?', [uid]],
    ['DELETE FROM profiles WHERE user_id = ?', [uid]],
    ['UPDATE reports SET reporter_id = NULL WHERE reporter_id = ?', [uid]],
    ['UPDATE reports SET resolved_by = NULL WHERE resolved_by = ?', [uid]],
    ['DELETE FROM users WHERE id = ?', [uid]],
  ]);
}
