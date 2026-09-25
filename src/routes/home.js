import { Router } from 'express';
import { html } from '../views/html.js';
import { memberCard } from '../views/layout.js';
import { landing } from '../views/content.js';
import { suggestConnections } from '../matching.js';
import { postSummary } from './hubs.js';

const router = Router();

router.get('/', (req, res) => {
  if (!req.user) return res.page({ body: landing({ demo: req.app.locals.config.demo }) });
  const { db } = req.app.locals;
  const uid = req.user.id;

  const profile = db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(uid);
  const interestCount = db.prepare('SELECT COUNT(*) AS n FROM user_interests WHERE user_id = ?').get(uid).n;
  const missing = [];
  if (!profile.headline) missing.push('a headline');
  if (!profile.city) missing.push('your city');
  if (!interestCount) missing.push('your interests');
  if (!profile.bio) missing.push('a short bio');

  const incoming = db
    .prepare("SELECT COUNT(*) AS n FROM connections WHERE addressee_id = ? AND status = 'pending'")
    .get(uid).n;
  const suggestions = suggestConnections(db, uid);
  const myHubs = db
    .prepare(
      `SELECT h.slug, h.name, h.kind FROM hubs h JOIN hub_members m ON m.hub_id = h.id
        WHERE m.user_id = ? ORDER BY h.kind DESC, h.name`,
    )
    .all(uid);
  const feed = db
    .prepare(
      `SELECT p.*, u.display_name, h.name AS hub_name, h.slug AS hub_slug,
              (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id AND c.hidden = 0) AS comment_count
         FROM posts p JOIN users u ON u.id = p.author_id JOIN hubs h ON h.id = p.hub_id
        WHERE p.hidden = 0 AND u.status = 'active'
          AND p.hub_id IN (SELECT hub_id FROM hub_members WHERE user_id = ?)
          AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = ? AND b.blocked_id = p.author_id) OR (b.blocker_id = p.author_id AND b.blocked_id = ?))
        ORDER BY p.created_at DESC LIMIT 15`,
    )
    .all(uid, uid, uid);

  res.page({
    title: 'Home',
    wide: true,
    body: html`<div class="dashboard">
      <div class="col-main">
        <h1>Welcome back, ${req.user.displayName.split(' ')[0]}</h1>
        ${missing.length
          ? html`<div class="card nudge"><strong>Complete your profile</strong> — add ${missing.join(', ')} so we can suggest better connections.
              <a class="btn small" href="/profile/edit">Edit profile</a></div>`
          : ''}
        ${incoming
          ? html`<div class="card nudge"><strong>${incoming} connection request${incoming > 1 ? 's' : ''}</strong> waiting for you.
              <a class="btn small" href="/connections">Review</a></div>`
          : ''}
        <h2>From your hubs</h2>
        ${feed.length
          ? feed.map((p) => postSummary(p, { showHub: true }))
          : html`<div class="card empty">Nothing here yet. <a href="/hubs">Join a few hubs</a> for your city and interests.</div>`}
      </div>
      <aside class="col-side">
        <h2>Suggested for you</h2>
        ${suggestions.length
          ? suggestions.map((s) => memberCard(s, html`<ul class="reasons">${s.reasons.map((r) => html`<li>${r}</li>`)}</ul>`))
          : html`<div class="card empty">Add interests and a city to your profile to get suggestions.</div>`}
        <p><a href="/members">Browse all members →</a></p>
        <h2>Your hubs</h2>
        <div class="card"><ul class="plain">${myHubs.map(
          (h) => html`<li><a href="/hubs/${h.slug}">${h.kind === 'region' ? '📍' : '🧭'} ${h.name}</a></li>`,
        )}</ul><a href="/hubs">Find more hubs →</a></div>
      </aside>
    </div>`,
  });
});

export default router;
