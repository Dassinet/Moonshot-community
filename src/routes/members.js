import { Router } from 'express';
import { html, paragraphs } from '../views/html.js';
import { csrfField, memberCard, avatar, badges, errorList } from '../views/layout.js';
import { requireAuth } from '../middleware.js';
import * as v from '../security/validate.js';
import { audit, isBlocked, connectionBetween } from '../db.js';
import { MEMBER_TYPES, MEMBER_TYPE_KEYS, memberTypeLabel } from '../taxonomy.js';

const router = Router();
const PAGE_SIZE = 24;

// Anti-spam limits on outreach. These protect investors and well-known members
// from being flooded, and slow down throwaway accounts.
export const DAILY_REQUEST_LIMIT = 10;
export const NEW_ACCOUNT_REQUEST_LIMIT = 3;
const NEW_ACCOUNT_MS = 24 * 60 * 60 * 1000;
export const NOTE_MIN = 20;

const likeEscape = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

router.get('/members', requireAuth, async (req, res) => {
  const { db } = req.app.locals;
  const uid = req.user.id;
  const interests = (await db.all('SELECT * FROM interests ORDER BY name'));
  const f = {
    q: v.text(req.query.q, { max: 60 }),
    type: v.oneOf(req.query.type, MEMBER_TYPE_KEYS, ''),
    interest: v.oneOf(req.query.interest, interests.map((i) => i.slug), ''),
    city: v.text(req.query.city, { max: 60 }),
    page: Math.min(v.id(req.query.page) ?? 1, 1000),
  };

  const where = [
    "u.status = 'active'",
    'p.in_directory = 1',
    'u.id != ?',
    'NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = ? AND b.blocked_id = u.id) OR (b.blocker_id = u.id AND b.blocked_id = ?))',
  ];
  const params = [uid, uid, uid];
  if (f.q) {
    where.push("(u.display_name LIKE ? ESCAPE '\\' OR p.headline LIKE ? ESCAPE '\\')");
    params.push(`%${likeEscape(f.q)}%`, `%${likeEscape(f.q)}%`);
  }
  if (f.type) {
    where.push('p.member_type = ?');
    params.push(f.type);
  }
  if (f.city) {
    where.push("(p.city LIKE ? ESCAPE '\\' OR p.country LIKE ? ESCAPE '\\')");
    params.push(`%${likeEscape(f.city)}%`, `%${likeEscape(f.city)}%`);
  }
  if (f.interest) {
    where.push('EXISTS (SELECT 1 FROM user_interests ui JOIN interests i ON i.id = ui.interest_id WHERE ui.user_id = u.id AND i.slug = ?)');
    params.push(f.interest);
  }

  const rows = (await db.all(`SELECT u.id, u.display_name, u.verified, p.member_type, p.headline, p.city, p.country, p.open_to_intros
         FROM users u JOIN profiles p ON p.user_id = u.id
        WHERE ${where.join(' AND ')}
        ORDER BY u.verified DESC, p.updated_at DESC
        LIMIT ${PAGE_SIZE + 1} OFFSET ${(f.page - 1) * PAGE_SIZE}`, ...params));
  const hasMore = rows.length > PAGE_SIZE;
  const qs = (page) =>
    new URLSearchParams({ ...(f.q && { q: f.q }), ...(f.type && { type: f.type }), ...(f.interest && { interest: f.interest }), ...(f.city && { city: f.city }), page: String(page) }).toString();

  res.page({
    title: 'Members',
    wide: true,
    body: html`<h1>Members</h1>
      <form method="get" action="/members" class="card filters">
        <input name="q" placeholder="Name or headline" value="${f.q}" maxlength="60">
        <select name="type"><option value="">Any role</option>${MEMBER_TYPES.map(
          (t) => html`<option value="${t.key}" ${f.type === t.key ? 'selected' : ''}>${t.label}</option>`,
        )}</select>
        <select name="interest"><option value="">Any interest</option>${interests.map(
          (i) => html`<option value="${i.slug}" ${f.interest === i.slug ? 'selected' : ''}>${i.name}</option>`,
        )}</select>
        <input name="city" placeholder="City or country" value="${f.city}" maxlength="60">
        <button class="btn">Filter</button>
      </form>
      ${rows.length
        ? html`<div class="grid cards">${rows.slice(0, PAGE_SIZE).map((m) => memberCard(m))}</div>`
        : html`<div class="card empty">No members match those filters yet.</div>`}
      <nav class="pager">
        ${f.page > 1 ? html`<a href="/members?${qs(f.page - 1)}">← Previous</a>` : ''}
        ${hasMore ? html`<a href="/members?${qs(f.page + 1)}">Next →</a>` : ''}
      </nav>`,
  });
});

async function loadMember(db, id) {
  return (await db.get(`SELECT u.id, u.display_name, u.verified, u.status, u.role, u.created_at, p.*
         FROM users u JOIN profiles p ON p.user_id = u.id WHERE u.id = ?`, id));
}

function connectBox(req, m, conn, errors = [], note = '') {
  const uid = req.user.id;
  if (!conn) {
    if (!m.open_to_intros) return html`<p class="muted">${m.display_name} isn't accepting new connection requests right now.</p>`;
    return html`<form method="post" action="/members/${m.id}/connect" class="stack">
      ${csrfField(req)}
      ${errorList(errors)}
      <label>Add a personal note <small>(required — say who you are and why you'd like to connect)</small>
        <textarea name="note" rows="3" minlength="${NOTE_MIN}" maxlength="500" required>${note}</textarea></label>
      <button class="btn">Send connection request</button>
    </form>`;
  }
  if (conn.status === 'accepted') {
    return html`<div class="actions"><a class="btn" href="/messages/${m.id}">Message</a>
      <form method="post" action="/connections/${conn.id}/remove">${csrfField(req)}<button class="btn ghost small">Remove connection</button></form></div>`;
  }
  if (conn.requester_id === uid) {
    // A declined request looks "pending" to the sender, so declining is never awkward.
    return html`<p class="muted">Connection request sent.</p>`;
  }
  if (conn.status === 'pending') {
    return html`<div class="card inset"><p><strong>${m.display_name} wants to connect:</strong></p>${paragraphs(conn.note)}
      <div class="actions">
        <form method="post" action="/connections/${conn.id}/accept">${csrfField(req)}<button class="btn small">Accept</button></form>
        <form method="post" action="/connections/${conn.id}/decline">${csrfField(req)}<button class="btn ghost small">Decline</button></form>
      </div></div>`;
  }
  return '';
}

async function profilePage(req, db, m, { errors = [], note = '' } = {}) {
  const uid = req.user.id;
  const self = m.id === uid;
  const conn = self ? null : (await connectionBetween(db, uid, m.id));
  const staff = req.user.role === 'admin' || req.user.role === 'moderator';
  const full = self || staff || m.visibility === 'members' || conn?.status === 'accepted';
  const interests = (await db.all('SELECT i.slug, i.name FROM interests i JOIN user_interests ui ON ui.interest_id = i.id WHERE ui.user_id = ? ORDER BY i.name', m.id));
  const hubs = (await db.all("SELECT h.slug, h.name FROM hubs h JOIN hub_members hm ON hm.hub_id = h.id WHERE hm.user_id = ? AND h.kind = 'region'", m.id));
  const iBlocked = !self && !!(await db.get('SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?', uid, m.id));
  const seeking = m.seeking ? m.seeking.split(',').map(memberTypeLabel) : [];
  const place = [m.city, m.country].filter(Boolean).join(', ');

  return {
    title: m.display_name,
    body: html`<section class="card profile">
      <div class="profile-head">${avatar(m.display_name, 'lg')}
        <div><h1>${m.display_name}</h1>
          ${m.headline ? html`<p class="lead">${m.headline}</p>` : ''}
          <div class="badges">${badges(m)}${m.status !== 'active' ? html`<span class="badge danger">Suspended</span>` : ''}</div>
          ${place ? html`<p class="muted">📍 ${place}</p>` : ''}
        </div>
      </div>
      ${self ? html`<p><a class="btn ghost small" href="/profile/edit">Edit profile</a></p>` : connectBox(req, m, conn, errors, note)}
    </section>
    ${full
      ? html`<section class="card">
          ${m.bio ? html`<h2>About</h2>${paragraphs(m.bio)}` : ''}
          ${m.looking_for ? html`<h2>Looking for</h2>${paragraphs(m.looking_for)}` : ''}
          ${seeking.length ? html`<h2>Wants to meet</h2><p>${seeking.join(' · ')}</p>` : ''}
          ${interests.length ? html`<h2>Interests</h2><div class="badges">${interests.map((i) => html`<a class="badge soft" href="/members?interest=${i.slug}">${i.name}</a>`)}</div>` : ''}
          ${hubs.length ? html`<h2>Local hubs</h2><p>${hubs.map((h, i) => html`${i ? ' · ' : ''}<a href="/hubs/${h.slug}">${h.name}</a>`)}</p>` : ''}
          ${m.website ? html`<h2>Links</h2><p><a href="${m.website}" rel="nofollow noopener noreferrer ugc" target="_blank">${m.website}</a></p>` : ''}
          ${!m.bio && !m.looking_for && !interests.length ? html`<p class="muted">No details yet.</p>` : ''}
        </section>`
      : html`<section class="card"><p class="muted">🔒 ${m.display_name} shares their full profile with connections only.</p></section>`}
    ${self
      ? ''
      : html`<section class="safety-row">
          ${iBlocked
            ? html`<form method="post" action="/members/${m.id}/unblock">${csrfField(req)}<button class="linklike">Unblock</button></form>`
            : html`<form method="post" action="/members/${m.id}/block">${csrfField(req)}<button class="linklike">Block</button></form>`}
          <a href="/report?type=user&id=${m.id}">Report profile</a>
        </section>`}`,
  };
}

router.get('/members/:id', requireAuth, async (req, res, next) => {
  const { db } = req.app.locals;
  const id = v.id(req.params.id);
  const m = id && (await loadMember(db, id));
  const staff = req.user.role === 'admin' || req.user.role === 'moderator';
  if (!m) return next();
  // Blocked (either direction) or suspended members are indistinguishable from
  // non-existent ones, except to moderators.
  if (!staff && m.id !== req.user.id && (m.status !== 'active' || (await isBlocked(db, req.user.id, m.id)))) return next();
  res.page((await profilePage(req, db, m)));
});

router.post('/members/:id/connect', requireAuth, async (req, res, next) => {
  const { db } = req.app.locals;
  const uid = req.user.id;
  const id = v.id(req.params.id);
  const m = id && (await loadMember(db, id));
  if (!m || m.id === uid || m.status !== 'active' || (await isBlocked(db, uid, m.id))) return next();

  const note = v.text(req.body.note, { max: 500, multiline: true });
  const errors = [];
  if (!m.open_to_intros) errors.push("This member isn't accepting connection requests.");
  if ((await connectionBetween(db, uid, m.id))) errors.push('There is already a connection or request between you.');
  if (note.length < NOTE_MIN) errors.push(`Please write a note of at least ${NOTE_MIN} characters explaining why you'd like to connect.`);

  const since = Date.now() - 24 * 60 * 60 * 1000;
  const sentToday = (await db.get('SELECT COUNT(*) AS n FROM connections WHERE requester_id = ? AND created_at > ?', uid, since)).n;
  const account = (await db.get('SELECT created_at FROM users WHERE id = ?', uid));
  const cap = Date.now() - account.created_at < NEW_ACCOUNT_MS ? NEW_ACCOUNT_REQUEST_LIMIT : DAILY_REQUEST_LIMIT;
  if (sentToday >= cap) {
    errors.push(`You've reached today's limit of ${cap} connection requests. This keeps outreach thoughtful — try again tomorrow.`);
  }

  if (errors.length) return res.status(400).page((await profilePage(req, db, m, { errors, note })));

  (await db.run('INSERT INTO connections (requester_id, addressee_id, note, created_at) VALUES (?, ?, ?, ?)', uid, m.id, note, Date.now()));
  (await audit(db, uid, 'connection.request', `user:${m.id}`));
  res.flash('request-sent');
  res.redirect(303, `/members/${m.id}`);
});

router.post('/members/:id/block', requireAuth, async (req, res, next) => {
  const { db } = req.app.locals;
  const uid = req.user.id;
  const id = v.id(req.params.id);
  if (!id || id === uid || !(await db.get('SELECT 1 FROM users WHERE id = ?', id))) return next();
  await db.batch([
    ['INSERT OR IGNORE INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)', [uid, id, Date.now()]],
    // Blocking severs any connection or pending request.
    ['DELETE FROM connections WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)', [uid, id, id, uid]],
  ]);
  (await audit(db, uid, 'user.block', `user:${id}`));
  res.flash('blocked');
  res.redirect(303, '/members');
});

router.post('/members/:id/unblock', requireAuth, async (req, res, next) => {
  const { db } = req.app.locals;
  const id = v.id(req.params.id);
  if (!id) return next();
  (await db.run('DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?', req.user.id, id));
  res.flash('unblocked');
  res.redirect(303, `/members/${id}`);
});

export default router;
