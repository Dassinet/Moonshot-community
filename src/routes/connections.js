import { Router } from 'express';
import { html, paragraphs, timeAgo } from '../views/html.js';
import { csrfField, memberCard } from '../views/layout.js';
import { requireAuth } from '../middleware.js';
import * as v from '../security/validate.js';
import { audit } from '../db.js';

const router = Router();

const MEMBER_COLS = 'u.id, u.display_name, u.verified, p.member_type, p.headline, p.city, p.country, p.open_to_intros';

router.get('/connections', requireAuth, (req, res) => {
  const { db } = req.app.locals;
  const uid = req.user.id;
  const incoming = db
    .prepare(
      `SELECT c.id AS conn_id, c.note, c.created_at AS requested_at, ${MEMBER_COLS}
         FROM connections c JOIN users u ON u.id = c.requester_id JOIN profiles p ON p.user_id = u.id
        WHERE c.addressee_id = ? AND c.status = 'pending' AND u.status = 'active' ORDER BY c.created_at DESC`,
    )
    .all(uid);
  const outgoing = db
    .prepare(
      `SELECT c.id AS conn_id, ${MEMBER_COLS}
         FROM connections c JOIN users u ON u.id = c.addressee_id JOIN profiles p ON p.user_id = u.id
        WHERE c.requester_id = ? AND c.status IN ('pending','declined') AND u.status = 'active' ORDER BY c.created_at DESC`,
    )
    .all(uid);
  const accepted = db
    .prepare(
      `SELECT c.id AS conn_id, ${MEMBER_COLS}
         FROM connections c JOIN users u ON u.id = CASE WHEN c.requester_id = ? THEN c.addressee_id ELSE c.requester_id END
         JOIN profiles p ON p.user_id = u.id
        WHERE (c.requester_id = ? OR c.addressee_id = ?) AND c.status = 'accepted' AND u.status = 'active'
        ORDER BY u.display_name`,
    )
    .all(uid, uid, uid);

  res.page({
    title: 'Connections',
    wide: true,
    body: html`<h1>Connections</h1>
      <h2>Requests for you (${incoming.length})</h2>
      ${incoming.length
        ? html`<div class="grid cards">${incoming.map((m) =>
            memberCard(
              m,
              html`<div class="note">${paragraphs(m.note)}<small class="muted">${timeAgo(m.requested_at)}</small></div>
                <div class="actions">
                  <form method="post" action="/connections/${m.conn_id}/accept">${csrfField(req)}<button class="btn small">Accept</button></form>
                  <form method="post" action="/connections/${m.conn_id}/decline">${csrfField(req)}<button class="btn ghost small">Decline</button></form>
                  <a class="small" href="/report?type=user&id=${m.id}">Report</a>
                </div>`,
            ),
          )}</div>`
        : html`<p class="muted">No pending requests.</p>`}
      <h2>Your connections (${accepted.length})</h2>
      ${accepted.length
        ? html`<div class="grid cards">${accepted.map((m) => memberCard(m, html`<div class="actions"><a class="btn small" href="/messages/${m.id}">Message</a></div>`))}</div>`
        : html`<p class="muted">No connections yet — check your <a href="/">suggestions</a>.</p>`}
      <h2>Sent requests (${outgoing.length})</h2>
      ${outgoing.length
        ? html`<div class="grid cards">${outgoing.map((m) =>
            memberCard(m, html`<p class="muted small">Awaiting response</p>`),
          )}</div>`
        : html`<p class="muted">None.</p>`}`,
  });
});

function respond(status, flash) {
  return (req, res, next) => {
    const { db } = req.app.locals;
    const id = v.id(req.params.id);
    // Only the addressee can accept or decline, and only while pending.
    const conn = id && db.prepare("SELECT * FROM connections WHERE id = ? AND addressee_id = ? AND status = 'pending'").get(id, req.user.id);
    if (!conn) return next();
    db.prepare('UPDATE connections SET status = ?, responded_at = ? WHERE id = ?').run(status, Date.now(), id);
    audit(db, req.user.id, `connection.${status}`, `connection:${id}`);
    res.flash(flash);
    res.redirect(303, '/connections');
  };
}

router.post('/connections/:id/accept', requireAuth, respond('accepted', 'request-accepted'));
router.post('/connections/:id/decline', requireAuth, respond('declined', 'request-declined'));

router.post('/connections/:id/remove', requireAuth, (req, res, next) => {
  const { db } = req.app.locals;
  const uid = req.user.id;
  const id = v.id(req.params.id);
  // Either side can end an accepted connection; the sender can withdraw a
  // pending one via the API. A declined request stays on file (shown to the
  // sender as "awaiting response") so it can't be re-sent.
  const conn =
    id &&
    db
      .prepare(
        `SELECT * FROM connections WHERE id = ? AND (
           (status = 'accepted' AND (requester_id = ? OR addressee_id = ?)) OR (status = 'pending' AND requester_id = ?))`,
      )
      .get(id, uid, uid, uid);
  if (!conn) return next();
  db.prepare('DELETE FROM connections WHERE id = ?').run(id);
  audit(db, uid, 'connection.remove', `connection:${id}`);
  res.flash('connection-removed');
  res.redirect(303, '/connections');
});

export default router;
