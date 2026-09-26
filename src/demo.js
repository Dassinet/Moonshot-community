// Loads the fictional sample community (src/demoData.js). Used by
// `npm run seed` and by demo deployments (DEMO_MODE=true) to populate an empty
// database on startup.
//
// Everything is written in ONE atomic batch with pre-assigned ids, so seeding
// a remote database (Turso) takes a single round trip instead of hundreds.
import { hashPassword } from './security/passwords.js';
import { INTERESTS, HUB_TIMEZONES } from './taxonomy.js';
import { zonedToUtc, utcToZoned } from './time.js';
import { MEMBERS, REGION_FOR_CITY, POSTS, EVENTS, CONNECTIONS, MESSAGES } from './demoData.js';

const INTEREST_NAMES = Object.fromEntries(INTERESTS);
export const DEFAULT_DEMO_PASSWORD = 'moonshot-demo-pass';
const HOUR = 3600_000;
const DAY = 24 * HOUR;
const CYCLE = 28 * DAY;

// Returns the number of members created, or 0 if the database already had users.
export async function seedDemo(db, password = DEFAULT_DEMO_PASSWORD) {
  if ((await db.get('SELECT COUNT(*) AS n FROM users')).n > 0) return 0;
  const hash = await hashPassword(password);
  const now = Date.now();

  const hubIds = new Map((await db.all('SELECT id, slug FROM hubs')).map((h) => [h.slug, h.id]));
  const interestIds = new Map((await db.all('SELECT id, slug FROM interests')).map((i) => [i.slug, i.id]));
  const hubId = (slug) => {
    const v = hubIds.get(slug);
    if (!v) throw new Error(`demo data refers to unknown hub "${slug}"`);
    return v;
  };
  const ids = new Map();
  const cityOf = new Map();
  const id = (name) => {
    const v = ids.get(name);
    if (!v) throw new Error(`demo data refers to unknown member "${name}"`);
    return v;
  };

  const stmts = [];
  const add = (sql, ...args) => stmts.push([sql, args]);
  const join = (hub, uid, at) => add('INSERT OR IGNORE INTO hub_members (hub_id, user_id, joined_at) VALUES (?, ?, ?)', hubId(hub), uid, at);

  MEMBERS.forEach(([name, role, type, headline, city, country, interests, seeking, verified, about, lookingFor], i) => {
    const uid = i + 1;
    ids.set(name, uid);
    cityOf.set(name, city);
    const email = `${name.split(' ')[0].toLowerCase()}@example.com`;
    const created = now - (90 - i) * DAY;
    const topics = interests.map((slug) => INTEREST_NAMES[slug]).join(', ');
    add(
      'INSERT INTO users (id, email, password_hash, display_name, role, verified, email_verified_at, coc_accepted_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      uid, email, hash, name, role, verified, created, created, created,
    );
    add(
      `INSERT INTO profiles (user_id, member_type, headline, bio, city, country, seeking, looking_for, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      uid, type, headline, `${about}\n\nHappy to chat about ${topics}.`, city, country, seeking, lookingFor, created,
    );
    for (const slug of interests) {
      add('INSERT INTO user_interests (user_id, interest_id) VALUES (?, ?)', uid, interestIds.get(slug));
      join(`topic-${slug}`, uid, created);
    }
    for (const slug of ['global-online', REGION_FOR_CITY[city]].filter(Boolean)) join(slug, uid, created);
  });

  for (const [from, to, status, note] of CONNECTIONS) {
    add(
      'INSERT INTO connections (requester_id, addressee_id, status, note, created_at, responded_at) VALUES (?, ?, ?, ?, ?, ?)',
      id(from), id(to), status, note, now - 6 * DAY, status === 'pending' ? null : now - 5 * DAY,
    );
  }

  for (const [from, to, body, hoursAgo] of MESSAGES) {
    add(
      'INSERT INTO messages (sender_id, recipient_id, body, created_at, read_at) VALUES (?, ?, ?, ?, ?)',
      id(from), id(to), body, now - hoursAgo * HOUR, hoursAgo > 24 ? now - (hoursAgo - 1) * HOUR : null,
    );
  }

  let postId = 0;
  for (const [author, hub, kind, title, body, hoursAgo, comments] of POSTS) {
    postId += 1;
    join(hub, id(author), now - 100 * DAY);
    add('INSERT INTO posts (id, hub_id, author_id, kind, title, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', postId, hubId(hub), id(author), kind, title, body, now - hoursAgo * HOUR);
    for (const [by, text, ago] of comments) {
      join(hub, id(by), now - 100 * DAY);
      add('INSERT INTO comments (post_id, author_id, body, created_at) VALUES (?, ?, ?, ?)', postId, id(by), text, now - ago * HOUR);
    }
  }

  let eventId = 0;
  for (const [host, hub, title, description, daysAhead, start, end, venue, onlineUrl, capacity, going, interested] of EVENTS) {
    eventId += 1;
    const tz = HUB_TIMEZONES[hub] ?? HUB_TIMEZONES[REGION_FOR_CITY[cityOf.get(host)]] ?? 'UTC';
    const { date } = utcToZoned(now + daysAhead * DAY, tz);
    const startsAt = zonedToUtc(date, start, tz);
    let endsAt = zonedToUtc(date, end, tz);
    if (endsAt <= startsAt) endsAt += DAY;
    join(hub, id(host), now - 100 * DAY);
    add(
      `INSERT INTO events (id, hub_id, host_id, title, description, starts_at, ends_at, timezone, venue, online_url, capacity, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      eventId, hubId(hub), id(host), title, description, startsAt, endsAt, tz, venue, onlineUrl, capacity, now - 3 * DAY,
    );
    const rsvp = (name, status, at) => add('INSERT OR IGNORE INTO event_rsvps (event_id, user_id, status, created_at) VALUES (?, ?, ?, ?)', eventId, id(name), status, at);
    rsvp(host, 'going', now - 3 * DAY);
    for (const name of going) rsvp(name, 'going', now - 2 * DAY);
    for (const name of interested) rsvp(name, 'interested', now - DAY);
  }

  await db.batch(stmts);
  return ids.size;
}

// Keeps a long-running demo lively: sample events that have finished roll
// forward in 4-week steps, so the Events page never goes empty. Only touches
// events hosted by the sample members.
export async function refreshDemoEvents(db) {
  const now = Date.now();
  const past = await db.all(
    "SELECT e.id, e.starts_at, e.ends_at FROM events e JOIN users u ON u.id = e.host_id WHERE e.ends_at < ? AND e.cancelled = 0 AND u.email LIKE '%@example.com'",
    now,
  );
  if (!past.length) return 0;
  await db.batch(
    past.map((e) => {
      const shift = Math.ceil((now - e.starts_at) / CYCLE) * CYCLE;
      return ['UPDATE events SET starts_at = ?, ends_at = ? WHERE id = ?', [e.starts_at + shift, e.ends_at + shift, e.id]];
    }),
  );
  return past.length;
}
