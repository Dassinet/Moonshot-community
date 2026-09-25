import { Router } from 'express';
import { html, paragraphs, timeAgo } from '../views/html.js';
import { csrfField, avatar, errorList } from '../views/layout.js';
import { requireAuth } from '../middleware.js';
import { RateLimiter, limit } from '../security/rateLimit.js';
import * as v from '../security/validate.js';
import { areConnected, isBlocked } from '../db.js';

const router = Router();
const messageLimiter = new RateLimiter({ windowMs: 60_000, max: 20 });

router.get('/messages', requireAuth, (req, res) => {
  const { db } = req.app.locals;
  const uid = req.user.id;
  // One row per accepted connection, with the latest message (if any).
  const threads = db
    .prepare(
      `SELECT u.id, u.display_name,
              (SELECT body FROM messages m WHERE (m.sender_id = u.id AND m.recipient_id = ?) OR (m.sender_id = ? AND m.recipient_id = u.id)
                ORDER BY m.id DESC LIMIT 1) AS last_body,
              (SELECT MAX(created_at) FROM messages m WHERE (m.sender_id = u.id AND m.recipient_id = ?) OR (m.sender_id = ? AND m.recipient_id = u.id)) AS last_at,
              (SELECT COUNT(*) FROM messages m WHERE m.sender_id = u.id AND m.recipient_id = ? AND m.read_at IS NULL) AS unread
         FROM connections c JOIN users u ON u.id = CASE WHEN c.requester_id = ? THEN c.addressee_id ELSE c.requester_id END
        WHERE (c.requester_id = ? OR c.addressee_id = ?) AND c.status = 'accepted' AND u.status = 'active'
        ORDER BY last_at IS NULL, last_at DESC, u.display_name`,
    )
    .all(uid, uid, uid, uid, uid, uid, uid, uid);

  res.page({
    title: 'Messages',
    body: html`<h1>Messages</h1>
      <p class="muted">You can message people once you're connected. Never send money, passwords or sensitive documents to someone you haven't verified.</p>
      ${threads.length
        ? html`<ul class="threads card">${threads.map(
            (t) => html`<li><a href="/messages/${t.id}">${avatar(t.display_name, 'sm')}
              <span><strong>${t.display_name}</strong>${t.unread ? html` <span class="count">${t.unread}</span>` : ''}
              <small class="muted">${t.last_body ? t.last_body.slice(0, 80) : 'Say hello 👋'}</small></span>
              ${t.last_at ? html`<small class="muted">${timeAgo(t.last_at)}</small>` : ''}</a></li>`,
          )}</ul>`
        : html`<div class="card empty">No conversations yet. <a href="/members">Find people to connect with</a>.</div>`}`,
  });
});

function threadPage(req, db, other, errors = []) {
  const uid = req.user.id;
  const msgs = db
    .prepare(
      `SELECT * FROM messages WHERE (sender_id = ? AND recipient_id = ?) OR (sender_id = ? AND recipient_id = ?)
        ORDER BY id DESC LIMIT 200`,
    )
    .all(uid, other.id, other.id, uid)
    .reverse();
  db.prepare('UPDATE messages SET read_at = ? WHERE sender_id = ? AND recipient_id = ? AND read_at IS NULL').run(Date.now(), other.id, uid);
  return {
    title: `Messages with ${other.display_name}`,
    body: html`<h1><a href="/members/${other.id}">${other.display_name}</a></h1>
      <section class="card thread">
        ${msgs.length
          ? msgs.map(
              (m) => html`<div class="msg ${m.sender_id === uid ? 'mine' : 'theirs'}" id="m${m.id}">
                ${paragraphs(m.body)}
                <small class="muted">${timeAgo(m.created_at)}${m.sender_id !== uid ? html` · <a href="/report?type=message&id=${m.id}">Report</a>` : ''}</small>
              </div>`,
            )
          : html`<p class="muted">No messages yet.</p>`}
      </section>
      <form method="post" action="/messages/${other.id}" class="card stack">
        ${csrfField(req)}
        ${errorList(errors)}
        <label>Message <textarea name="body" rows="3" maxlength="2000" required></textarea></label>
        <button class="btn">Send</button>
      </form>`,
  };
}

function loadPeer(req) {
  const { db } = req.app.locals;
  const id = v.id(req.params.userId);
  if (!id || id === req.user.id) return null;
  const other = db.prepare("SELECT id, display_name FROM users WHERE id = ? AND status = 'active'").get(id);
  // Messaging requires an accepted connection and no block in either direction.
  if (!other || isBlocked(db, req.user.id, id) || !areConnected(db, req.user.id, id)) return null;
  return other;
}

router.get('/messages/:userId', requireAuth, (req, res, next) => {
  const other = loadPeer(req);
  if (!other) return next();
  res.page(threadPage(req, req.app.locals.db, other));
});

router.post('/messages/:userId', requireAuth, limit(messageLimiter, (req) => `msg:${req.user.id}`), (req, res, next) => {
  const { db } = req.app.locals;
  const other = loadPeer(req);
  if (!other) return next();
  const body = v.text(req.body.body, { max: 2000, multiline: true });
  if (!body) return res.status(400).page(threadPage(req, db, other, ['Message cannot be empty.']));
  const { lastInsertRowid } = db
    .prepare('INSERT INTO messages (sender_id, recipient_id, body, created_at) VALUES (?, ?, ?, ?)')
    .run(req.user.id, other.id, body, Date.now());
  res.redirect(303, `/messages/${other.id}#m${lastInsertRowid}`);
});

export default router;
