import { Router } from 'express';
import { html, paragraphs, timeAgo } from '../views/html.js';
import { csrfField, avatar, errorList } from '../views/layout.js';
import { requireAuth } from '../middleware.js';
import { RateLimiter, limit } from '../security/rateLimit.js';
import * as v from '../security/validate.js';
import { audit } from '../db.js';
import { POST_KINDS, POST_KIND_KEYS } from '../taxonomy.js';
import { upcomingEvents, eventCard } from './events.js';

const router = Router();
const postLimiter = new RateLimiter({ windowMs: 60 * 60 * 1000, max: 10 });
const commentLimiter = new RateLimiter({ windowMs: 60 * 60 * 1000, max: 60 });

const kindLabel = (k) => POST_KINDS.find((p) => p.key === k)?.label.split(' (')[0] ?? (k === 'event' ? 'Event' : 'Post');

// Excludes hidden content, suspended authors and anyone in a block relationship
// with the viewer. Callers bind (viewerId, viewerId).
const VISIBLE_AUTHOR = `u.status = 'active' AND NOT EXISTS (SELECT 1 FROM blocks b
  WHERE (b.blocker_id = ? AND b.blocked_id = u.id) OR (b.blocker_id = u.id AND b.blocked_id = ?))`;

export function postSummary(p, { showHub = false } = {}) {
  return html`<article class="card post">
    <header><span class="badge kind-${p.kind}">${kindLabel(p.kind)}</span>
      ${showHub ? html`<a class="muted small" href="/hubs/${p.hub_slug}">${p.hub_name}</a>` : ''}</header>
    <h3><a href="/posts/${p.id}">${p.title}</a></h3>
    <p class="muted small">${avatar(p.display_name, 'xs')} <a href="/members/${p.author_id}">${p.display_name}</a> · ${timeAgo(p.created_at)}
      · ${p.comment_count} comment${p.comment_count === 1 ? '' : 's'}</p>
  </article>`;
}

router.get('/hubs', requireAuth, async (req, res) => {
  const { db } = req.app.locals;
  const uid = req.user.id;
  const me = (await db.get('SELECT city, country FROM profiles WHERE user_id = ?', uid));
  const hubs = (await db.all(`SELECT h.*, (SELECT COUNT(*) FROM hub_members m WHERE m.hub_id = h.id) AS members,
              EXISTS (SELECT 1 FROM hub_members m WHERE m.hub_id = h.id AND m.user_id = ?) AS joined
         FROM hubs h ORDER BY h.name`, uid));
  const near = (h) =>
    h.kind === 'region' &&
    [me.city, me.country].some((place) => place && place.length > 2 && h.name.toLowerCase().includes(place.toLowerCase()));

  const hubCard = (h) => html`<article class="card hub ${near(h) ? 'near' : ''}">
    <h3><a href="/hubs/${h.slug}">${h.name}</a></h3>
    <p class="muted small">${h.description}</p>
    <p class="small">${h.members} member${h.members === 1 ? '' : 's'}${near(h) ? html` · <strong>Near you</strong>` : ''}</p>
    ${joinButton(req, h)}
  </article>`;

  res.page({
    title: 'Hubs',
    wide: true,
    body: html`<h1>Hubs</h1>
      <p class="muted">Join local hubs to meet people near you, and interest circles to go deep on a topic.</p>
      <h2>📍 Local hubs</h2>
      <div class="grid cards">${hubs.filter((h) => h.kind === 'region').sort((a, b) => near(b) - near(a)).map(hubCard)}</div>
      <h2>🧭 Interest circles</h2>
      <div class="grid cards">${hubs.filter((h) => h.kind === 'interest').map(hubCard)}</div>
      <p class="muted small">Don't see your city? Ask in <a href="/hubs/global-online">Global / Online</a> and a moderator can open a new hub.</p>`,
  });
});

function joinButton(req, h) {
  return html`<form method="post" action="/hubs/${h.slug}/${h.joined ? 'leave' : 'join'}">${csrfField(req)}
    <button class="btn small ${h.joined ? 'ghost' : ''}">${h.joined ? 'Leave' : 'Join'}</button></form>`;
}

async function loadHub(db, slug, uid) {
  return (await db.get(`SELECT h.*, (SELECT COUNT(*) FROM hub_members m WHERE m.hub_id = h.id) AS members,
              EXISTS (SELECT 1 FROM hub_members m WHERE m.hub_id = h.id AND m.user_id = ?) AS joined
         FROM hubs h WHERE h.slug = ?`, uid, String(slug).slice(0, 80)));
}

async function hubPage(req, db, hub, { errors = [], values = {} } = {}) {
  const uid = req.user.id;
  const kind = v.oneOf(req.query.kind, POST_KIND_KEYS, '');
  const posts = (await db.all(`SELECT p.*, u.display_name, (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id AND c.hidden = 0) AS comment_count
         FROM posts p JOIN users u ON u.id = p.author_id
        WHERE p.hub_id = ? AND p.hidden = 0 AND (? = '' OR p.kind = ?) AND ${VISIBLE_AUTHOR}
        ORDER BY p.created_at DESC LIMIT 50`, hub.id, kind, kind, uid, uid));
  const events = await upcomingEvents(db, uid, { hubId: hub.id, limit: 3 });
  return {
    title: hub.name,
    wide: true,
    body: html`<section class="card hub-head">
        <div><h1>${hub.kind === 'region' ? '📍' : '🧭'} ${hub.name}</h1><p class="muted">${hub.description}</p>
        <p class="small">${hub.members} member${hub.members === 1 ? '' : 's'}</p></div>
        ${joinButton(req, hub)}
      </section>
      <div class="dashboard">
        <div class="col-main">
          <nav class="tabs"><a class="${kind ? '' : 'active'}" href="/hubs/${hub.slug}">All</a>${POST_KINDS.map(
            (k) => html`<a class="${kind === k.key ? 'active' : ''}" href="/hubs/${hub.slug}?kind=${k.key}">${kindLabel(k.key)}s</a>`,
          )}</nav>
          ${posts.length ? posts.map((p) => postSummary(p)) : html`<div class="card empty">No posts yet — start the conversation.</div>`}
        </div>
        <aside class="col-side">
          <div class="side-head"><h2>Upcoming events</h2>${hub.joined ? html`<a class="btn small ghost" href="/events/new?hub=${hub.slug}">+ Host</a>` : ''}</div>
          ${events.length ? events.map(eventCard) : html`<div class="card empty small">No events planned yet.</div>`}
          ${hub.joined
            ? html`<form method="post" action="/hubs/${hub.slug}/posts" class="card stack">
                <h2>New post</h2>
                ${csrfField(req)}
                ${errorList(errors)}
                <label>Type <select name="kind">${POST_KINDS.map(
                  (k) => html`<option value="${k.key}" ${values.kind === k.key ? 'selected' : ''}>${k.label}</option>`,
                )}</select></label>
                <label>Title <input name="title" required maxlength="140" value="${values.title ?? ''}"></label>
                <label>Details <textarea name="body" rows="6" required maxlength="5000">${values.body ?? ''}</textarea></label>
                <small class="muted">Posts are visible to all signed-in members. Don't share private contact details.</small>
                <button class="btn">Post</button>
              </form>`
            : html`<div class="card"><p>Join this hub to post and comment.</p></div>`}
        </aside>
      </div>`,
  };
}

router.get('/hubs/:slug', requireAuth, async (req, res, next) => {
  const { db } = req.app.locals;
  const hub = (await loadHub(db, req.params.slug, req.user.id));
  if (!hub) return next();
  res.page((await hubPage(req, db, hub)));
});

router.post('/hubs/:slug/join', requireAuth, async (req, res, next) => {
  const { db } = req.app.locals;
  const hub = (await loadHub(db, req.params.slug, req.user.id));
  if (!hub) return next();
  (await db.run('INSERT OR IGNORE INTO hub_members (hub_id, user_id, joined_at) VALUES (?, ?, ?)', hub.id, req.user.id, Date.now()));
  res.flash('hub-joined');
  res.redirect(303, `/hubs/${hub.slug}`);
});

router.post('/hubs/:slug/leave', requireAuth, async (req, res, next) => {
  const { db } = req.app.locals;
  const hub = (await loadHub(db, req.params.slug, req.user.id));
  if (!hub) return next();
  (await db.run('DELETE FROM hub_members WHERE hub_id = ? AND user_id = ?', hub.id, req.user.id));
  res.flash('hub-left');
  res.redirect(303, `/hubs/${hub.slug}`);
});

router.post('/hubs/:slug/posts', requireAuth, limit(postLimiter, (req) => `post:${req.user.id}`), async (req, res, next) => {
  const { db } = req.app.locals;
  const hub = (await loadHub(db, req.params.slug, req.user.id));
  if (!hub) return next();
  if (!hub.joined) return res.status(403).type('text').send('Join the hub to post.');
  const values = {
    kind: v.oneOf(req.body.kind, POST_KIND_KEYS, 'discussion'),
    title: v.text(req.body.title, { max: 140 }),
    body: v.text(req.body.body, { max: 5000, multiline: true }),
  };
  const errors = [];
  if (values.title.length < 4) errors.push('Please add a title.');
  if (values.body.length < 10) errors.push('Please add some details.');
  if (errors.length) return res.status(400).page((await hubPage(req, db, hub, { errors, values })));
  const { lastInsertRowid } = (await db.run('INSERT INTO posts (hub_id, author_id, kind, title, body, created_at) VALUES (?, ?, ?, ?, ?, ?)', hub.id, req.user.id, values.kind, values.title, values.body, Date.now()));
  res.flash('post-created');
  res.redirect(303, `/posts/${lastInsertRowid}`);
});

async function loadPost(db, id, uid) {
  return (await db.get(`SELECT p.*, u.display_name, h.name AS hub_name, h.slug AS hub_slug,
              EXISTS (SELECT 1 FROM hub_members m WHERE m.hub_id = p.hub_id AND m.user_id = ?) AS joined
         FROM posts p JOIN users u ON u.id = p.author_id JOIN hubs h ON h.id = p.hub_id
        WHERE p.id = ? AND p.hidden = 0 AND ${VISIBLE_AUTHOR}`, uid, id, uid, uid));
}

router.get('/posts/:id', requireAuth, async (req, res, next) => {
  const { db } = req.app.locals;
  const uid = req.user.id;
  const id = v.id(req.params.id);
  const post = id && (await loadPost(db, id, uid));
  if (!post) return next();
  const comments = (await db.all(`SELECT c.*, u.display_name FROM comments c JOIN users u ON u.id = c.author_id
        WHERE c.post_id = ? AND c.hidden = 0 AND ${VISIBLE_AUTHOR} ORDER BY c.created_at`, id, uid, uid));
  res.page({
    title: post.title,
    body: html`<p><a href="/hubs/${post.hub_slug}">← ${post.hub_name}</a></p>
      <article class="card post-full">
        <span class="badge kind-${post.kind}">${kindLabel(post.kind)}</span>
        <h1>${post.title}</h1>
        <p class="muted small">${avatar(post.display_name, 'xs')} <a href="/members/${post.author_id}">${post.display_name}</a> · ${timeAgo(post.created_at)}</p>
        <div class="prose">${paragraphs(post.body)}</div>
        <footer class="safety-row">
          ${post.author_id === uid
            ? html`<form method="post" action="/posts/${post.id}/delete">${csrfField(req)}<button class="linklike">Delete post</button></form>`
            : html`<a href="/report?type=post&id=${post.id}">Report</a>`}
        </footer>
      </article>
      <section>
        <h2>${comments.length} comment${comments.length === 1 ? '' : 's'}</h2>
        ${comments.map(
          (c) => html`<article class="card comment" id="c${c.id}">
            <p class="muted small">${avatar(c.display_name, 'xs')} <a href="/members/${c.author_id}">${c.display_name}</a> · ${timeAgo(c.created_at)}
              ${c.author_id !== uid ? html` · <a href="/report?type=comment&id=${c.id}">Report</a>` : ''}</p>
            ${paragraphs(c.body)}
          </article>`,
        )}
        ${post.joined
          ? html`<form method="post" action="/posts/${post.id}/comments" class="card stack">
              ${csrfField(req)}
              <label>Add a comment <textarea name="body" rows="3" maxlength="2000" required></textarea></label>
              <button class="btn">Comment</button>
            </form>`
          : html`<p class="muted">Join <a href="/hubs/${post.hub_slug}">${post.hub_name}</a> to comment.</p>`}
      </section>`,
  });
});

router.post('/posts/:id/comments', requireAuth, limit(commentLimiter, (req) => `comment:${req.user.id}`), async (req, res, next) => {
  const { db } = req.app.locals;
  const id = v.id(req.params.id);
  const post = id && (await loadPost(db, id, req.user.id));
  if (!post) return next();
  if (!post.joined) return res.status(403).type('text').send('Join the hub to comment.');
  const body = v.text(req.body.body, { max: 2000, multiline: true });
  if (!body) return res.redirect(303, `/posts/${id}`);
  const { lastInsertRowid } = (await db.run('INSERT INTO comments (post_id, author_id, body, created_at) VALUES (?, ?, ?, ?)', id, req.user.id, body, Date.now()));
  res.flash('comment-added');
  res.redirect(303, `/posts/${id}#c${lastInsertRowid}`);
});

router.post('/posts/:id/delete', requireAuth, async (req, res, next) => {
  const { db } = req.app.locals;
  const id = v.id(req.params.id);
  const post = id && (await db.get('SELECT p.id, h.slug FROM posts p JOIN hubs h ON h.id = p.hub_id WHERE p.id = ? AND p.author_id = ?', id, req.user.id));
  if (!post) return next();
  await db.batch([['DELETE FROM comments WHERE post_id = ?', [id]], ['DELETE FROM posts WHERE id = ?', [id]]]);
  (await audit(db, req.user.id, 'post.delete', `post:${id}`));
  res.flash('post-deleted');
  res.redirect(303, `/hubs/${post.slug}`);
});

export default router;
