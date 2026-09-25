// Seeds a development database with realistic demo members, posts and
// connections. Refuses to run in production.
import { openDb } from '../src/db.js';
import { loadConfig } from '../src/app.js';
import { hashPassword } from '../src/security/passwords.js';
import { INTERESTS } from '../src/taxonomy.js';

const INTEREST_NAMES = Object.fromEntries(INTERESTS);

const config = loadConfig();
if (config.production) {
  console.error('Refusing to seed a production database.');
  process.exit(1);
}
const db = openDb(config.dbPath);
if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0) {
  console.log('Database already has users — skipping seed. Delete data/dev.db to reseed.');
  process.exit(0);
}

const PASSWORD = process.env.SEED_PASSWORD || 'moonshot-demo-pass';
const hash = await hashPassword(PASSWORD);
const now = Date.now();
const day = 86400_000;

const people = [
  ['Ada Okafor', 'admin', 'founder', 'Founder @ HelioGrid — solid-state grid storage', 'Lagos', 'Nigeria', ['energy', 'climate'], 'investor,builder', 1],
  ['Marcus Chen', 'member', 'investor', 'Partner, Frontier Deep Tech Fund · Seed–Series A', 'San Francisco', 'USA', ['ai', 'robotics', 'space'], 'founder', 1],
  ['Priya Raman', 'moderator', 'researcher', 'Longevity researcher · senolytics & epigenetic clocks', 'Bangalore', 'India', ['longevity', 'biotech'], 'founder,investor', 1],
  ['Liam Walsh', 'member', 'builder', 'Robotics engineer · ex-autonomous trucking', 'Sydney', 'Australia', ['robotics', 'ai', 'mobility'], 'founder', 0],
  ['Sofia Martins', 'member', 'founder', 'Building vertical farms for megacities', 'São Paulo', 'Brazil', ['food-water', 'climate'], 'investor,mentor', 0],
  ['Hannah Weiss', 'member', 'mentor', '3x founder, now angel & mentor', 'Berlin', 'Germany', ['ai', 'work', 'education'], 'founder,student', 1],
  ['Omar Haddad', 'member', 'investor', 'Family office · climate & water', 'Dubai', 'UAE', ['climate', 'food-water', 'energy'], 'founder', 1],
  ['Grace Liu', 'member', 'student', 'Aerospace PhD student', 'Toronto', 'Canada', ['space', 'quantum'], 'mentor,researcher', 0],
  ['Noah Patel', 'member', 'operator', 'COO, scaling hardware startups', 'Austin', 'USA', ['energy', 'robotics'], 'founder', 0],
  ['Chloe Nguyen', 'member', 'builder', 'Full-stack + ML · open to co-founding', 'Melbourne', 'Australia', ['ai', 'longevity'], 'founder', 0],
  ['James Carter', 'member', 'partner', 'Head of Venture, global energy corp', 'London', 'UK', ['energy', 'climate'], 'founder,researcher', 1],
  ['Aiko Tanaka', 'member', 'founder', 'BCI startup — non-invasive neural interfaces', 'Singapore', 'Singapore', ['bci', 'biotech', 'ai'], 'investor,researcher', 0],
];

const hubId = db.prepare('SELECT id FROM hubs WHERE slug = ?');
const regionFor = { 'San Francisco': 'sf-bay-area', Lagos: 'lagos', Bangalore: 'bangalore', Sydney: 'sydney', 'São Paulo': 'sao-paulo', Berlin: 'berlin', Dubai: 'dubai', Toronto: 'toronto', Austin: 'austin', Melbourne: 'melbourne', London: 'london', Singapore: 'singapore' };
const ids = [];
people.forEach(([name, role, type, headline, city, country, interests, seeking, verified], i) => {
  const email = `${name.split(' ')[0].toLowerCase()}@example.com`;
  const created = now - (60 - i * 3) * day;
  const { lastInsertRowid: id } = db.prepare(
    'INSERT INTO users (email, password_hash, display_name, role, verified, coc_accepted_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(email, hash, name, role, verified, created, created);
  ids.push(Number(id));
  db.prepare(
    `INSERT INTO profiles (user_id, member_type, headline, bio, city, country, seeking, looking_for, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, type, headline, `Hi, I'm ${name.split(' ')[0]}. ${headline}.\n\nHappy to chat about ${interests.map((slug) => INTEREST_NAMES[slug]).join(', ')}.`, city, country, seeking,
    type === 'investor' ? 'Ambitious teams tackling billion-person problems.' : 'Smart people who want to build the future.', created);
  for (const slug of interests) {
    db.prepare('INSERT INTO user_interests (user_id, interest_id) SELECT ?, id FROM interests WHERE slug = ?').run(id, slug);
    db.prepare('INSERT OR IGNORE INTO hub_members (hub_id, user_id, joined_at) VALUES (?, ?, ?)').run(hubId.get(`topic-${slug}`).id, id, created);
  }
  for (const slug of ['global-online', regionFor[city]]) {
    db.prepare('INSERT OR IGNORE INTO hub_members (hub_id, user_id, joined_at) VALUES (?, ?, ?)').run(hubId.get(slug).id, id, created);
  }
});

const connect = (a, b, status, note) =>
  db.prepare('INSERT INTO connections (requester_id, addressee_id, status, note, created_at, responded_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(ids[a], ids[b], status, note, now - 5 * day, status === 'pending' ? null : now - 4 * day);
connect(0, 6, 'accepted', 'Omar — loved your talk on water abundance. HelioGrid could pair storage with desal. Would love 20 mins.');
connect(4, 5, 'accepted', 'Hannah, I would really value mentorship as we plan our second vertical farm.');
connect(9, 2, 'pending', 'Priya, I build ML pipelines and would love to help with your epigenetic clock work.');
connect(3, 1, 'pending', 'Marcus — robotics engineer exploring a warehouse-automation startup. Would value your perspective.');

db.prepare('INSERT INTO messages (sender_id, recipient_id, body, created_at) VALUES (?, ?, ?, ?)').run(ids[6], ids[0], 'Great to connect, Ada. Are you in Dubai for the energy summit next month?', now - 3 * day);

const post = (author, hub, kind, title, body, ago) =>
  db.prepare('INSERT INTO posts (hub_id, author_id, kind, title, body, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(hubId.get(hub).id, ids[author], kind, title, body, now - ago);
post(3, 'sydney', 'event', 'Sydney Moonshots meetup — robotics & AI night', 'Casual drinks + 3 lightning talks. Thursday 6pm, Surry Hills. Reply here if you want to give a talk!', 2 * day);
post(9, 'topic-ai', 'offer', 'Offering: ML architecture reviews for early-stage founders', 'Happy to spend an hour reviewing your ML stack or data pipeline. Pre-seed / seed only.', 1 * day);
post(4, 'topic-food-water', 'ask', 'Looking for: agronomist with controlled-environment experience', 'We are hiring our first head of growing in São Paulo. Intros welcome.', 3 * day);
post(1, 'global-online', 'discussion', 'What does a great first message to an investor look like?', 'I get a lot of requests. The best ones are short: who you are, what you are building, why me specifically. What works for you?', 6 * 3600_000);
db.prepare('INSERT INTO comments (post_id, author_id, body, created_at) VALUES (4, ?, ?, ?)').run(ids[5], 'Traction first, then the ask. And make it easy to say no.', now - 3 * 3600_000);

console.log(`Seeded ${ids.length} members. Sign in as ada@example.com (admin), priya@example.com (moderator) or any <firstname>@example.com.`);
console.log(`Password for all demo accounts: ${PASSWORD}`);
