// Loads the fictional sample community (src/demoData.js). Used by
// `npm run seed` and by demo deployments (DEMO_MODE=true) to populate an empty
// database on startup.
import { hashPassword } from './security/passwords.js';
import { INTERESTS, HUB_TIMEZONES } from './taxonomy.js';
import { zonedToUtc, utcToZoned } from './time.js';
import { MEMBERS, REGION_FOR_CITY, POSTS, EVENTS, CONNECTIONS, MESSAGES } from './demoData.js';

const INTEREST_NAMES = Object.fromEntries(INTERESTS);
export const DEFAULT_DEMO_PASSWORD = 'moonshot-demo-pass';
const HOUR = 3600_000;
const DAY = 24 * HOUR;

// Returns the number of members created, or 0 if the database already had users.
export async function seedDemo(db, password = DEFAULT_DEMO_PASSWORD) {
  if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0) return 0;
  const hash = await hashPassword(password);
  const now = Date.now();

  const hubId = (slug) => db.prepare('SELECT id FROM hubs WHERE slug = ?').get(slug)?.id;
  const join = db.prepare('INSERT OR IGNORE INTO hub_members (hub_id, user_id, joined_at) VALUES (?, ?, ?)');
  const ids = new Map();
  const cityOf = new Map();
  const id = (name) => {
    const v = ids.get(name);
    if (!v) throw new Error(`demo data refers to unknown member "${name}"`);
    return v;
  };

  db.exec('BEGIN');
  try {
    MEMBERS.forEach(([name, role, type, headline, city, country, interests, seeking, verified, about, lookingFor], i) => {
      const email = `${name.split(' ')[0].toLowerCase()}@example.com`;
      const created = now - (90 - i) * DAY;
      const { lastInsertRowid } = db
        .prepare(
          'INSERT INTO users (email, password_hash, display_name, role, verified, email_verified_at, coc_accepted_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(email, hash, name, role, verified, created, created, created);
      const uid = Number(lastInsertRowid);
      ids.set(name, uid);
      cityOf.set(name, city);
      const topics = interests.map((slug) => INTEREST_NAMES[slug]).join(', ');
      db.prepare(
        `INSERT INTO profiles (user_id, member_type, headline, bio, city, country, seeking, looking_for, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(uid, type, headline, `${about}\n\nHappy to chat about ${topics}.`, city, country, seeking, lookingFor, created);
      for (const slug of interests) {
        db.prepare('INSERT INTO user_interests (user_id, interest_id) SELECT ?, id FROM interests WHERE slug = ?').run(uid, slug);
        join.run(hubId(`topic-${slug}`), uid, created);
      }
      for (const slug of ['global-online', REGION_FOR_CITY[city]].filter(Boolean)) join.run(hubId(slug), uid, created);
    });

    for (const [from, to, status, note] of CONNECTIONS) {
      db.prepare('INSERT INTO connections (requester_id, addressee_id, status, note, created_at, responded_at) VALUES (?, ?, ?, ?, ?, ?)').run(
        id(from), id(to), status, note, now - 6 * DAY, status === 'pending' ? null : now - 5 * DAY,
      );
    }

    for (const [from, to, body, hoursAgo] of MESSAGES) {
      db.prepare('INSERT INTO messages (sender_id, recipient_id, body, created_at, read_at) VALUES (?, ?, ?, ?, ?)').run(
        id(from), id(to), body, now - hoursAgo * HOUR, hoursAgo > 24 ? now - (hoursAgo - 1) * HOUR : null,
      );
    }

    for (const [author, hub, kind, title, body, hoursAgo, comments] of POSTS) {
      const hid = hubId(hub);
      join.run(hid, id(author), now - 100 * DAY);
      const { lastInsertRowid: postId } = db
        .prepare('INSERT INTO posts (hub_id, author_id, kind, title, body, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(hid, id(author), kind, title, body, now - hoursAgo * HOUR);
      for (const [by, text, ago] of comments) {
        join.run(hid, id(by), now - 100 * DAY);
        db.prepare('INSERT INTO comments (post_id, author_id, body, created_at) VALUES (?, ?, ?, ?)').run(postId, id(by), text, now - ago * HOUR);
      }
    }

    for (const [host, hub, title, description, daysAhead, start, end, venue, onlineUrl, capacity, going, interested] of EVENTS) {
      const tz = HUB_TIMEZONES[hub] ?? HUB_TIMEZONES[REGION_FOR_CITY[cityOf.get(host)]] ?? 'UTC';
      const { date } = utcToZoned(now + daysAhead * DAY, tz);
      const startsAt = zonedToUtc(date, start, tz);
      let endsAt = zonedToUtc(date, end, tz);
      if (endsAt <= startsAt) endsAt += DAY;
      const hid = hubId(hub);
      join.run(hid, id(host), now - 100 * DAY);
      const { lastInsertRowid: eventId } = db
        .prepare(
          `INSERT INTO events (hub_id, host_id, title, description, starts_at, ends_at, timezone, venue, online_url, capacity, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(hid, id(host), title, description, startsAt, endsAt, tz, venue, onlineUrl, capacity, now - 3 * DAY);
      const rsvp = db.prepare('INSERT OR IGNORE INTO event_rsvps (event_id, user_id, status, created_at) VALUES (?, ?, ?, ?)');
      rsvp.run(eventId, id(host), 'going', now - 3 * DAY);
      for (const name of going) rsvp.run(eventId, id(name), 'going', now - 2 * DAY);
      for (const name of interested) rsvp.run(eventId, id(name), 'interested', now - DAY);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return ids.size;
}
