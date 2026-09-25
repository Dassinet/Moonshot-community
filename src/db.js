import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { INTERESTS, REGION_HUBS } from './taxonomy.js';

// All queries in this codebase use prepared statements with bound parameters.
// Never build SQL by concatenating user input.

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

CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY,
  actor_id   INTEGER,
  action     TEXT NOT NULL,
  target     TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
`;

export function openDb(path = ':memory:') {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  seedTaxonomy(db);
  return db;
}

function seedTaxonomy(db) {
  const now = Date.now();
  const addInterest = db.prepare('INSERT OR IGNORE INTO interests (slug, name) VALUES (?, ?)');
  const addHub = db.prepare(
    'INSERT OR IGNORE INTO hubs (slug, name, kind, description, interest_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  );
  const interestId = db.prepare('SELECT id FROM interests WHERE slug = ?');
  for (const [slug, name] of INTERESTS) {
    addInterest.run(slug, name);
    const { id } = interestId.get(slug);
    addHub.run(`topic-${slug}`, name, 'interest', `Everyone working on or curious about ${name.toLowerCase()}.`, id, now);
  }
  for (const [slug, name, description] of REGION_HUBS) {
    addHub.run(slug, name, 'region', description, null, now);
  }
}

export function audit(db, actorId, action, target = '') {
  db.prepare('INSERT INTO audit_log (actor_id, action, target, created_at) VALUES (?, ?, ?, ?)').run(
    actorId ?? null,
    action,
    String(target),
    Date.now(),
  );
}

// Is there a block in either direction between two users?
export function isBlocked(db, a, b) {
  return !!db
    .prepare(
      'SELECT 1 FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)',
    )
    .get(a, b, b, a);
}

export function connectionBetween(db, a, b) {
  return db
    .prepare(
      `SELECT * FROM connections
        WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)
        ORDER BY id DESC LIMIT 1`,
    )
    .get(a, b, b, a);
}

export function areConnected(db, a, b) {
  return connectionBetween(db, a, b)?.status === 'accepted';
}
