import { Router } from 'express';
import { html, paragraphs } from '../views/html.js';
import { csrfField, avatar, errorList } from '../views/layout.js';
import { requireAuth } from '../middleware.js';
import { RateLimiter, limit } from '../security/rateLimit.js';
import * as v from '../security/validate.js';
import { audit } from '../db.js';
import { TIMEZONES, TIMEZONE_KEYS, HUB_TIMEZONES } from '../taxonomy.js';
import { zonedToUtc, utcToZoned, formatWhen, dateBlock, icsStamp } from '../time.js';

// Events: local meetups, dinners, watch parties and online sessions, with
// RSVPs and add-to-calendar. Online links are only revealed to people who are
// going, so an open link can't be passed around to gatecrashers.

const router = Router();
const createLimiter = new RateLimiter({ windowMs: 24 * 60 * 60 * 1000, max: 5 });
const HOUR = 60 * 60 * 1000;
const MAX_AHEAD = 366 * 24 * HOUR;
const MAX_LENGTH = 3 * 24 * HOUR;

const isStaff = (req) => req.user.role === 'admin' || req.user.role === 'moderator';

// Hides events whose host is suspended or in a block relationship with the viewer.
const VISIBLE_HOST = `u.status = 'active' AND NOT EXISTS (SELECT 1 FROM blocks b
  WHERE (b.blocker_id = ? AND b.blocked_id = u.id) OR (b.blocker_id = u.id AND b.blocked_id = ?))`;

const EVENT_COLS = `e.*, u.display_name AS host_name, h.name AS hub_name, h.slug AS hub_slug, h.kind AS hub_kind,
  (SELECT COUNT(*) FROM event_rsvps r WHERE r.event_id = e.id AND r.status = 'going') AS going_count,
  (SELECT status FROM event_rsvps r WHERE r.event_id = e.id AND r.user_id = ?) AS my_status`;

// Upcoming events, optionally narrowed. `where` fragments are fixed strings.
export function upcomingEvents(db, uid, { hubId = null, mine = false, going = false, limit: max = 50 } = {}) {
  const where = ['e.cancelled = 0', 'e.ends_at > ?', VISIBLE_HOST];
  const params = [uid, Date.now(), uid, uid];
  if (hubId) {
    where.push('e.hub_id = ?');
    params.push(hubId);
  }
  if (mine) {
    where.push('e.hub_id IN (SELECT hub_id FROM hub_members WHERE user_id = ?)');
    params.push(uid);
  }
  if (going) {
    where.push("EXISTS (SELECT 1 FROM event_rsvps r WHERE r.event_id = e.id AND r.user_id = ? AND r.status = 'going')");
    params.push(uid);
  }
  return db
    .prepare(
      `SELECT ${EVENT_COLS} FROM events e JOIN users u ON u.id = e.host_id JOIN hubs h ON h.id = e.hub_id
        WHERE ${where.join(' AND ')} ORDER BY e.starts_at LIMIT ${Number(max)}`,
    )
    .all(...params);
}

export function eventCard(e) {
  const d = dateBlock(e.starts_at, e.timezone);
  const where = e.venue ? `📍 ${e.venue.split('\n')[0]}` : '🌐 Online';
  const full = e.capacity && e.going_count >= e.capacity;
  return html`<article class="card event-card">
    <div class="date-block" aria-hidden="true"><span>${d.mon}</span><strong>${d.day}</strong><span>${d.dow}</span></div>
    <div class="event-body">
      <h3><a href="/events/${e.id}">${e.title}</a></h3>
      <p class="muted small">${formatWhen(e.starts_at, e.ends_at, e.timezone)}</p>
      <p class="small">${where} · <a href="/hubs/${e.hub_slug}">${e.hub_name}</a></p>
      <div class="badges">
        <span class="badge">${e.going_count} going${e.capacity ? ` / ${e.capacity}` : ''}</span>
        ${e.my_status === 'going' ? html`<span class="badge soft">✓ You're going</span>` : ''}
        ${e.my_status === 'interested' ? html`<span class="badge">Interested</span>` : ''}
        ${full && e.my_status !== 'going' ? html`<span class="badge danger">Full</span>` : ''}
      </div>
    </div>
  </article>`;
}

router.get('/events', requireAuth, (req, res) => {
  const { db } = req.app.locals;
  const show = v.oneOf(req.query.show, ['all', 'mine', 'going'], 'all');
  const events = upcomingEvents(db, req.user.id, { mine: show === 'mine', going: show === 'going' });
  const tabs = [['all', 'All upcoming'], ['mine', 'My hubs'], ['going', "I'm going"]];
  res.page({
    title: 'Events',
    wide: true,
    body: html`<div class="page-head"><div><p class="eyebrow">Meet in real life</p><h1>Events</h1></div>
        <a class="btn" href="/events/new">Host an event</a></div>
      <nav class="tabs">${tabs.map(([k, label]) => html`<a class="${show === k ? 'active' : ''}" href="/events?show=${k}">${label}</a>`)}</nav>
      ${events.length
        ? html`<div class="grid cards events">${events.map(eventCard)}</div>`
        : html`<div class="card empty">No upcoming events here yet. <a href="/events/new">Host the first one</a>.</div>`}`,
  });
});

// --- Create -----------------------------------------------------------------

function myHubs(db, uid) {
  return db
    .prepare('SELECT h.id, h.slug, h.name, h.kind FROM hubs h JOIN hub_members m ON m.hub_id = h.id WHERE m.user_id = ? ORDER BY h.kind DESC, h.name')
    .all(uid);
}

function defaultTimezone(db, uid, hubSlug) {
  if (HUB_TIMEZONES[hubSlug]) return HUB_TIMEZONES[hubSlug];
  const region = db
    .prepare("SELECT h.slug FROM hubs h JOIN hub_members m ON m.hub_id = h.id WHERE m.user_id = ? AND h.kind = 'region' AND h.slug != 'global-online' LIMIT 1")
    .get(uid);
  return HUB_TIMEZONES[region?.slug] ?? 'UTC';
}

function newEventPage(req, { values, errors = [] }) {
  const { db } = req.app.locals;
  const hubs = myHubs(db, req.user.id);
  return {
    title: 'Host an event',
    body: html`<section class="card">
      <p class="eyebrow">Host an event</p>
      <h1>Bring people together</h1>
      ${errorList(errors)}
      ${hubs.length
        ? html`<form method="post" action="/events" class="stack">${csrfField(req)}
          <label>Hub <select name="hub">${hubs.map(
            (h) => html`<option value="${h.slug}" ${values.hub === h.slug ? 'selected' : ''}>${h.kind === 'region' ? '📍' : '🧭'} ${h.name}</option>`,
          )}</select><small>Events appear in this hub and on the Events page.</small></label>
          <label>Title <input name="title" required maxlength="120" value="${values.title ?? ''}" placeholder="e.g. Longevity founders dinner"></label>
          <label>What's happening? <textarea name="description" rows="5" maxlength="4000" placeholder="Agenda, who it's for, what to bring">${values.description ?? ''}</textarea></label>
          <div class="row">
            <label>Date <input type="date" name="date" required value="${values.date ?? ''}"></label>
            <label>Time zone <select name="timezone">${TIMEZONES.map(
              ([k, label]) => html`<option value="${k}" ${values.timezone === k ? 'selected' : ''}>${label}</option>`,
            )}</select></label>
          </div>
          <div class="row">
            <label>Starts <input type="time" name="start" required value="${values.start ?? '18:00'}"></label>
            <label>Ends <input type="time" name="end" required value="${values.end ?? '20:00'}"></label>
          </div>
          <label>Venue / address <textarea name="venue" rows="2" maxlength="300" placeholder="Leave empty for online-only">${values.venue ?? ''}</textarea></label>
          <label>Online link <input name="online_url" maxlength="300" value="${values.online_url ?? ''}" placeholder="https:// (Zoom, Meet, livestream…)">
            <small>Only shown to people who RSVP "Going".</small></label>
          <label>Capacity <input type="number" name="capacity" min="1" max="10000" value="${values.capacity ?? ''}" placeholder="No limit"></label>
          <button class="btn">Publish event</button>
        </form>`
        : html`<p>Join a hub first — events belong to a hub. <a href="/hubs">Browse hubs</a></p>`}
    </section>`,
  };
}

router.get('/events/new', requireAuth, (req, res) => {
  const { db } = req.app.locals;
  const hub = typeof req.query.hub === 'string' ? req.query.hub.slice(0, 80) : '';
  const tz = defaultTimezone(db, req.user.id, hub);
  const nextWeek = utcToZoned(Date.now() + 7 * 24 * HOUR, tz);
  res.page(newEventPage(req, { values: { hub, timezone: tz, date: nextWeek.date } }));
});

router.post('/events', requireAuth, limit(createLimiter, (req) => `event:${req.user.id}`), (req, res) => {
  const { db } = req.app.locals;
  const uid = req.user.id;
  const values = {
    hub: typeof req.body.hub === 'string' ? req.body.hub.slice(0, 80) : '',
    title: v.text(req.body.title, { max: 120 }),
    description: v.text(req.body.description, { max: 4000, multiline: true }),
    date: v.text(req.body.date, { max: 10 }),
    start: v.text(req.body.start, { max: 5 }),
    end: v.text(req.body.end, { max: 5 }),
    timezone: v.oneOf(req.body.timezone, TIMEZONE_KEYS, 'UTC'),
    venue: v.text(req.body.venue, { max: 300, multiline: true }),
    online_url: req.body.online_url,
    capacity: req.body.capacity,
  };
  const errors = [];
  const hub = myHubs(db, uid).find((h) => h.slug === values.hub);
  if (!hub) errors.push('Choose one of your hubs.');
  if (values.title.length < 4) errors.push('Please add a title.');
  const onlineUrl = v.url(values.online_url);
  if (onlineUrl === null) errors.push('The online link must be a valid https:// address.');
  if (!values.venue && !onlineUrl) errors.push('Add a venue, an online link, or both.');
  let capacity = null;
  if (String(values.capacity ?? '').trim()) {
    capacity = Number(values.capacity);
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 10000) errors.push('Capacity must be a whole number between 1 and 10,000.');
  }
  const startsAt = zonedToUtc(values.date, values.start, values.timezone);
  let endsAt = zonedToUtc(values.date, values.end, values.timezone);
  if (startsAt === null || endsAt === null) errors.push('Please enter a valid date and times.');
  else {
    if (endsAt <= startsAt) endsAt += 24 * HOUR; // e.g. 10pm – 1am
    if (startsAt < Date.now()) errors.push('The event must start in the future.');
    if (startsAt > Date.now() + MAX_AHEAD) errors.push('Events can be scheduled up to a year ahead.');
    if (endsAt - startsAt > MAX_LENGTH) errors.push('Events can last at most 3 days.');
  }
  if (errors.length) return res.status(400).page(newEventPage(req, { values: { ...values, online_url: String(values.online_url ?? '') }, errors }));

  const now = Date.now();
  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO events (hub_id, host_id, title, description, starts_at, ends_at, timezone, venue, online_url, capacity, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(hub.id, uid, values.title, values.description, startsAt, endsAt, values.timezone, values.venue, onlineUrl ?? '', capacity, now);
  const id = Number(lastInsertRowid);
  db.prepare("INSERT INTO event_rsvps (event_id, user_id, status, created_at) VALUES (?, ?, 'going', ?)").run(id, uid, now);
  audit(db, uid, 'event.create', `event:${id}`);
  res.flash('event-created');
  res.redirect(303, `/events/${id}`);
});

// --- View / RSVP ------------------------------------------------------------

function loadEvent(db, id, uid) {
  return db
    .prepare(`SELECT ${EVENT_COLS} FROM events e JOIN users u ON u.id = e.host_id JOIN hubs h ON h.id = e.hub_id WHERE e.id = ? AND ${VISIBLE_HOST}`)
    .get(uid, id, uid, uid);
}

function googleCalendarUrl(e, pageUrl) {
  const q = new URLSearchParams({
    action: 'TEMPLATE',
    text: e.title,
    dates: `${icsStamp(e.starts_at)}/${icsStamp(e.ends_at)}`,
    details: `${e.description.slice(0, 1000)}\n\n${pageUrl}`,
    location: e.venue || 'Online',
  });
  return `https://calendar.google.com/calendar/render?${q}`;
}

router.get('/events/:id', requireAuth, (req, res, next) => {
  const { db, config } = req.app.locals;
  const uid = req.user.id;
  const id = v.id(req.params.id);
  const e = id && loadEvent(db, id, uid);
  if (!e) return next();
  const attendees = db
    .prepare(
      `SELECT u.id, u.display_name, r.status FROM event_rsvps r JOIN users u ON u.id = r.user_id
        WHERE r.event_id = ? AND ${VISIBLE_HOST} ORDER BY r.status, r.created_at`,
    )
    .all(id, uid, uid);
  const going = attendees.filter((a) => a.status === 'going');
  const interested = attendees.filter((a) => a.status === 'interested');
  const isHost = e.host_id === uid;
  const past = e.ends_at < Date.now();
  const full = e.capacity && e.going_count >= e.capacity && e.my_status !== 'going';
  const canSeeLink = e.my_status === 'going' || isHost || isStaff(req);
  const pageUrl = `${config.appUrl}/events/${e.id}`;
  const d = dateBlock(e.starts_at, e.timezone);

  const rsvpButton = (status, label, cls = '') =>
    html`<form method="post" action="/events/${e.id}/rsvp">${csrfField(req)}<input type="hidden" name="status" value="${status}">
      <button class="btn small ${cls}">${label}</button></form>`;

  res.page({
    title: e.title,
    body: html`<p><a href="/events">← All events</a></p>
      ${e.cancelled ? html`<div class="errors" role="alert">This event has been cancelled.</div>` : ''}
      <article class="card event-full">
        <div class="event-head">
          <div class="date-block lg" aria-hidden="true"><span>${d.mon}</span><strong>${d.day}</strong><span>${d.dow}</span></div>
          <div>
            <p class="eyebrow"><a href="/hubs/${e.hub_slug}">${e.hub_name}</a></p>
            <h1>${e.title}</h1>
            <p class="muted">${formatWhen(e.starts_at, e.ends_at, e.timezone)}</p>
          </div>
        </div>
        <dl class="facts">
          <div><dt>Where</dt><dd>${e.venue ? paragraphs(e.venue) : 'Online'}</dd></div>
          ${e.online_url
            ? html`<div><dt>Online</dt><dd>${canSeeLink
                ? html`<a href="${e.online_url}" rel="noopener noreferrer nofollow" target="_blank">${e.online_url}</a>`
                : html`<span class="muted">The link is shared once you RSVP "Going".</span>`}</dd></div>`
            : ''}
          <div><dt>Host</dt><dd>${avatar(e.host_name, 'xs')} <a href="/members/${e.host_id}">${e.host_name}</a></dd></div>
          <div><dt>Going</dt><dd>${e.going_count}${e.capacity ? ` of ${e.capacity} spots` : ''}</dd></div>
        </dl>
        ${!e.cancelled && !past
          ? html`<div class="actions rsvp">
              ${e.my_status === 'going'
                ? html`<span class="badge soft">✓ You're going</span>${isHost ? '' : rsvpButton('none', "Can't go any more", 'ghost')}`
                : html`${full ? html`<span class="badge danger">Full</span>` : rsvpButton('going', "I'm going")}
                    ${e.my_status === 'interested' ? rsvpButton('none', 'Not interested', 'ghost') : rsvpButton('interested', 'Interested', 'ghost')}`}
            </div>`
          : past ? html`<p class="muted">This event has ended.</p>` : ''}
        ${e.description ? html`<div class="prose">${paragraphs(e.description)}</div>` : ''}
        ${!e.cancelled
          ? html`<p class="calendar-links small"><a href="/events/${e.id}/calendar.ics">Add to calendar (.ics)</a> ·
              <a href="${googleCalendarUrl(e, pageUrl)}" rel="noopener noreferrer" target="_blank">Google Calendar</a></p>`
          : ''}
      </article>
      <section class="card">
        <h2>Who's going (${going.length})</h2>
        ${going.length ? html`<ul class="attendees">${going.map((a) => html`<li><a href="/members/${a.id}">${avatar(a.display_name, 'sm')} ${a.display_name}</a></li>`)}</ul>` : html`<p class="muted">Be the first.</p>`}
        ${interested.length ? html`<p class="muted small">${interested.length} interested</p>` : ''}
      </section>
      ${(isHost || isStaff(req)) && !e.cancelled
        ? html`<section class="safety-row"><form method="post" action="/events/${e.id}/cancel">${csrfField(req)}<button class="linklike">Cancel event</button></form></section>`
        : html`<section class="safety-row"><a href="/report?type=user&id=${e.host_id}">Report host</a></section>`}`,
  });
});

router.post('/events/:id/rsvp', requireAuth, (req, res, next) => {
  const { db } = req.app.locals;
  const uid = req.user.id;
  const id = v.id(req.params.id);
  const e = id && loadEvent(db, id, uid);
  if (!e || e.cancelled || e.ends_at < Date.now()) return next();
  const status = v.oneOf(req.body.status, ['going', 'interested', 'none']);
  if (!status) return res.redirect(303, `/events/${id}`);
  if (e.host_id === uid && status !== 'going') return res.redirect(303, `/events/${id}`); // hosts always attend

  if (status === 'none') {
    db.prepare('DELETE FROM event_rsvps WHERE event_id = ? AND user_id = ?').run(id, uid);
  } else {
    if (status === 'going' && e.my_status !== 'going' && e.capacity && e.going_count >= e.capacity) {
      res.flash('event-full');
      return res.redirect(303, `/events/${id}`);
    }
    db.prepare(
      'INSERT INTO event_rsvps (event_id, user_id, status, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (event_id, user_id) DO UPDATE SET status = excluded.status',
    ).run(id, uid, status, Date.now());
  }
  res.flash(status === 'going' ? 'rsvp-going' : 'rsvp-updated');
  res.redirect(303, `/events/${id}`);
});

router.post('/events/:id/cancel', requireAuth, (req, res, next) => {
  const { db } = req.app.locals;
  const id = v.id(req.params.id);
  const e = id && loadEvent(db, id, req.user.id);
  if (!e || (e.host_id !== req.user.id && !isStaff(req))) return next();
  db.prepare('UPDATE events SET cancelled = 1 WHERE id = ?').run(id);
  audit(db, req.user.id, 'event.cancel', `event:${id}`);
  res.flash('event-cancelled');
  res.redirect(303, `/events/${id}`);
});

// --- Add to calendar (.ics) --------------------------------------------------

const icsText = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

// RFC 5545 lines are folded at 75 octets.
function fold(line) {
  const out = [];
  let cur = '';
  for (const ch of line) {
    if (Buffer.byteLength(cur + ch) > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = '';
    }
    cur += ch;
  }
  out.push(cur);
  return out.join('\r\n ');
}

router.get('/events/:id/calendar.ics', requireAuth, (req, res, next) => {
  const { db, config } = req.app.locals;
  const id = v.id(req.params.id);
  const e = id && loadEvent(db, id, req.user.id);
  if (!e || e.cancelled) return next();
  const pageUrl = `${config.appUrl}/events/${e.id}`;
  const canSeeLink = e.my_status === 'going' || e.host_id === req.user.id;
  const details = [e.description, canSeeLink && e.online_url ? `Join online: ${e.online_url}` : '', pageUrl].filter(Boolean).join('\n\n');
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Community//Events//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:event-${e.id}@${new URL(config.appUrl).hostname}`,
    `DTSTAMP:${icsStamp(Date.now())}`,
    `DTSTART:${icsStamp(e.starts_at)}`,
    `DTEND:${icsStamp(e.ends_at)}`,
    `SUMMARY:${icsText(e.title)}`,
    `DESCRIPTION:${icsText(details)}`,
    `LOCATION:${icsText(e.venue || (canSeeLink && e.online_url) || 'Online')}`,
    `URL:${pageUrl}`,
    'END:VEVENT', 'END:VCALENDAR',
  ];
  res
    .type('text/calendar; charset=utf-8')
    .set('Content-Disposition', `attachment; filename="event-${e.id}.ics"`)
    .send(`${lines.map(fold).join('\r\n')}\r\n`);
});

export default router;
