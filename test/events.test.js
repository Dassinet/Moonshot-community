import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, Client, userId } from './helpers.js';
import { zonedToUtc, utcToZoned } from '../src/time.js';

const DAY = 86400_000;
const future = (days = 7, tz = 'Australia/Sydney') => utcToZoned(Date.now() + days * DAY, tz).date;

let ctx;
before(async () => {
  ctx = await startApp();
});
after(() => ctx.close());

async function member(name) {
  const c = new Client(ctx.base);
  await c.signup({ display_name: name });
  await c.post('/hubs/sydney/join');
  await c.get('/');
  return c;
}

async function createEvent(c, overrides = {}) {
  await c.get('/events/new?hub=sydney');
  return c.post('/events', {
    hub: 'sydney', title: 'Robotics night', description: 'Talks and drinks', date: future(), start: '18:00', end: '20:00',
    timezone: 'Australia/Sydney', venue: '12 Foster St, Surry Hills', online_url: '', capacity: '', ...overrides,
  });
}

const eventIdFrom = (res) => Number(res.location.split('/').pop());

describe('events', () => {
  test('a hub member can host an event and is automatically going', async () => {
    const host = await member('Host Hana');
    const res = await createEvent(host);
    assert.equal(res.status, 303);
    const id = eventIdFrom(res);
    const page = await host.get(`/events/${id}`);
    assert.match(page.body, /Robotics night/);
    assert.match(page.body, /You.re going/);
    assert.match((await host.get('/events')).body, /Robotics night/);
    assert.match((await host.get('/hubs/sydney')).body, /Robotics night/);
    const row = (await ctx.db.get('SELECT starts_at, timezone FROM events WHERE id = ?', id));
    assert.equal(row.starts_at, zonedToUtc(future(), '18:00', 'Australia/Sydney'));
  });

  test('invalid events are rejected', async () => {
    const host = await member('Picky Pete');
    const past = utcToZoned(Date.now() - 2 * DAY, 'Australia/Sydney').date;
    assert.equal((await createEvent(host, { date: past })).status, 400);
    assert.equal((await createEvent(host, { venue: '', online_url: '' })).status, 400);
    assert.equal((await createEvent(host, { venue: '', online_url: 'javascript:alert(1)' })).status, 400);
    assert.equal((await createEvent(host, { capacity: '0' })).status, 400);
    assert.equal((await createEvent(host, { hub: 'london' })).status, 400, 'must be a member of the hub');
  });

  test('event text is escaped', async () => {
    const host = await member('Xss Xena');
    const res = await createEvent(host, { title: '<script>alert(1)</script> night' });
    const page = await host.get(res.location);
    assert.ok(!page.body.includes('<script>alert(1)</script>'));
    assert.ok(page.body.includes('&lt;script&gt;'));
  });

  test('RSVPs, capacity and the online link', async () => {
    const host = await member('Online Olly');
    const res = await createEvent(host, { venue: '', online_url: 'https://meet.example.com/secret-room', capacity: '2' });
    const id = eventIdFrom(res);
    const a = await member('Guest Gia');
    const b = await member('Guest Gus');

    let page = await a.get(`/events/${id}`);
    assert.ok(!page.body.includes('secret-room'), 'link hidden before RSVP');
    assert.ok(!(await a.get(`/events/${id}/calendar.ics`)).body.includes('secret-room'));

    await a.post(`/events/${id}/rsvp`, { status: 'going' });
    page = await a.get(`/events/${id}`);
    assert.ok(page.body.includes('https://meet.example.com/secret-room'), 'link shown once going');
    assert.ok((await a.get(`/events/${id}/calendar.ics`)).body.includes('secret-room'));

    // Host + Gia = 2 = full.
    await b.get(`/events/${id}`);
    await b.post(`/events/${id}/rsvp`, { status: 'going' });
    assert.equal((await ctx.db.get("SELECT COUNT(*) AS n FROM event_rsvps WHERE event_id = ? AND status = 'going'", id)).n, 2);
    await b.post(`/events/${id}/rsvp`, { status: 'interested' });
    assert.equal((await ctx.db.get('SELECT status FROM event_rsvps WHERE event_id = ? AND user_id = ?', id, await userId(ctx.db, 'Guest Gus'))).status, 'interested');

    // Gia leaves → a spot opens.
    await a.post(`/events/${id}/rsvp`, { status: 'none' });
    await b.post(`/events/${id}/rsvp`, { status: 'going' });
    assert.equal((await ctx.db.get('SELECT status FROM event_rsvps WHERE event_id = ? AND user_id = ?', id, await userId(ctx.db, 'Guest Gus'))).status, 'going');

    // The host can't drop out of their own event.
    await host.post(`/events/${id}/rsvp`, { status: 'none' });
    assert.ok((await ctx.db.get('SELECT 1 FROM event_rsvps WHERE event_id = ? AND user_id = ?', id, await userId(ctx.db, 'Online Olly'))));
  });

  test('calendar file is valid iCalendar', async () => {
    const host = await member('Cal Cara');
    const id = eventIdFrom(await createEvent(host, { title: 'Dinner; drinks, talks', description: 'Line one\nLine two' }));
    const res = await host.get(`/events/${id}/calendar.ics`);
    assert.equal(res.headers.get('content-type'), 'text/calendar; charset=utf-8');
    assert.match(res.body, /^BEGIN:VCALENDAR\r\n/);
    assert.match(res.body, /DTSTART:\d{8}T\d{6}Z\r\n/);
    assert.ok(res.body.includes('SUMMARY:Dinner\\; drinks\\, talks\r\n'), 'commas and semicolons escaped');
    assert.match(res.body, /Line one\\nLine two/);
    assert.ok(res.body.split('\r\n').every((line) => Buffer.byteLength(line) <= 75));
  });

  test('only the host (or staff) can cancel; cancelled events disappear from lists', async () => {
    const host = await member('Cancel Cam');
    const id = eventIdFrom(await createEvent(host, { title: 'Soon cancelled' }));
    const other = await member('Random Rae');
    await other.get(`/events/${id}`);
    assert.equal((await other.post(`/events/${id}/cancel`)).status, 404);
    assert.equal((await host.post(`/events/${id}/cancel`)).status, 303);
    assert.ok(!(await other.get('/events')).body.includes('Soon cancelled'));
    assert.match((await other.get(`/events/${id}`)).body, /has been cancelled/);
    assert.equal((await other.post(`/events/${id}/rsvp`, { status: 'going' })).status, 404);
  });

  test('timezone conversion handles daylight saving', () => {
    // Sydney is UTC+10 in winter and UTC+11 in summer.
    assert.equal(new Date(zonedToUtc('2026-07-01', '18:00', 'Australia/Sydney')).toISOString(), '2026-07-01T08:00:00.000Z');
    assert.equal(new Date(zonedToUtc('2026-12-01', '18:00', 'Australia/Sydney')).toISOString(), '2026-12-01T07:00:00.000Z');
    assert.equal(new Date(zonedToUtc('2026-07-01', '18:00', 'America/Los_Angeles')).toISOString(), '2026-07-02T01:00:00.000Z');
  });
});

describe('home screen app', () => {
  test('manifest is served with icons', async () => {
    const c = new Client(ctx.base);
    const res = await c.get('/manifest.webmanifest');
    assert.equal(res.status, 200);
    const m = JSON.parse(res.body);
    assert.equal(m.display, 'standalone');
    assert.ok(m.icons.some((i) => i.sizes === '512x512' && i.purpose === 'maskable'));
    for (const icon of m.icons) assert.equal((await c.get(icon.src)).status, 200, icon.src);
    assert.equal((await c.get('/static/icons/apple-touch-icon.png')).status, 200);
    assert.match((await c.get('/login')).body, /rel="manifest" href="\/manifest.webmanifest" crossorigin="use-credentials"/);
  });

  test('manifest stays behind the private gate', async () => {
    const priv = await startApp({ sitePassword: 'secret-pass' });
    const res = await new Client(priv.base).get('/manifest.webmanifest');
    assert.equal(res.status, 303);
    await priv.close();
  });
});
