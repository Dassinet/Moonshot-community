import { Router } from 'express';
import { html, paragraphs, timeAgo } from '../views/html.js';
import { csrfField, errorList } from '../views/layout.js';
import { requireAuth, requireStaff } from '../middleware.js';
import * as v from '../security/validate.js';
import { audit } from '../db.js';
import { endAllSessions } from '../security/sessions.js';
import { REPORT_REASONS, memberTypeLabel } from '../taxonomy.js';

const router = Router();
router.use('/admin', requireAuth, requireStaff);

const reasonLabel = (k) => REPORT_REASONS.find((r) => r.key === k)?.label ?? k;
const isAdmin = (req) => req.user.role === 'admin';

// Returns { preview, ownerId, hideable } describing what a report points at.
function describeTarget(db, type, id) {
  if (type === 'user') {
    const u = db.prepare('SELECT id, display_name, status FROM users WHERE id = ?').get(id);
    return u ? { ownerId: u.id, preview: html`Member: <a href="/members/${u.id}">${u.display_name}</a> (${u.status})` } : null;
  }
  if (type === 'post') {
    const p = db.prepare('SELECT p.*, u.display_name FROM posts p JOIN users u ON u.id = p.author_id WHERE p.id = ?').get(id);
    return p
      ? { ownerId: p.author_id, hideable: true, hidden: !!p.hidden,
          preview: html`Post by <a href="/members/${p.author_id}">${p.display_name}</a>: <strong>${p.title}</strong>${paragraphs(p.body.slice(0, 600))}` }
      : null;
  }
  if (type === 'comment') {
    const c = db.prepare('SELECT c.*, u.display_name FROM comments c JOIN users u ON u.id = c.author_id WHERE c.id = ?').get(id);
    return c
      ? { ownerId: c.author_id, hideable: true, hidden: !!c.hidden,
          preview: html`Comment by <a href="/members/${c.author_id}">${c.display_name}</a> on <a href="/posts/${c.post_id}">post #${c.post_id}</a>${paragraphs(c.body.slice(0, 600))}` }
      : null;
  }
  if (type === 'message') {
    // Moderators only ever see the specific message that was reported to them.
    const m = db.prepare('SELECT m.*, u.display_name FROM messages m JOIN users u ON u.id = m.sender_id WHERE m.id = ?').get(id);
    return m ? { ownerId: m.sender_id, preview: html`Private message from <a href="/members/${m.sender_id}">${m.display_name}</a>${paragraphs(m.body.slice(0, 600))}` } : null;
  }
  return null;
}

router.get('/admin', (req, res) => {
  const { db } = req.app.locals;
  const count = (sql, ...p) => db.prepare(sql).get(...p).n;
  const weekAgo = Date.now() - 7 * 86400_000;
  const stats = {
    members: count("SELECT COUNT(*) AS n FROM users WHERE status = 'active'"),
    newThisWeek: count('SELECT COUNT(*) AS n FROM users WHERE created_at > ?', weekAgo),
    connections: count("SELECT COUNT(*) AS n FROM connections WHERE status = 'accepted'"),
    posts: count('SELECT COUNT(*) AS n FROM posts WHERE created_at > ?', weekAgo),
    openReports: count("SELECT COUNT(*) AS n FROM reports WHERE status = 'open'"),
  };
  const byType = db.prepare("SELECT p.member_type, COUNT(*) AS n FROM profiles p JOIN users u ON u.id = p.user_id WHERE u.status = 'active' GROUP BY 1 ORDER BY 2 DESC").all();

  res.page({
    title: 'Moderation',
    wide: true,
    body: html`<h1>Moderation</h1>
      <nav class="tabs"><a class="active" href="/admin">Overview</a><a href="/admin/reports">Reports (${stats.openReports})</a><a href="/admin/users">Members</a>
        <a href="/admin/hubs">Hubs</a>${isAdmin(req) ? html`<a href="/admin/audit">Audit log</a>` : ''}</nav>
      <div class="grid stats">
        <div class="card stat"><strong>${stats.members}</strong><span>active members</span></div>
        <div class="card stat"><strong>${stats.newThisWeek}</strong><span>joined this week</span></div>
        <div class="card stat"><strong>${stats.connections}</strong><span>connections made</span></div>
        <div class="card stat"><strong>${stats.posts}</strong><span>posts this week</span></div>
        <div class="card stat ${stats.openReports ? 'alert' : ''}"><strong>${stats.openReports}</strong><span>open reports</span></div>
      </div>
      <section class="card"><h2>Members by type</h2><ul class="plain">${byType.map((t) => html`<li>${memberTypeLabel(t.member_type)}: ${t.n}</li>`)}</ul></section>`,
  });
});

router.get('/admin/reports', (req, res) => {
  const { db } = req.app.locals;
  const status = v.oneOf(req.query.status, ['open', 'actioned', 'dismissed'], 'open');
  const reports = db
    .prepare(
      `SELECT r.*, u.display_name AS reporter_name FROM reports r LEFT JOIN users u ON u.id = r.reporter_id
        WHERE r.status = ? ORDER BY r.created_at ${status === 'open' ? 'ASC' : 'DESC'} LIMIT 100`,
    )
    .all(status);
  res.page({
    title: 'Reports',
    wide: true,
    body: html`<h1>Reports</h1>
      <nav class="tabs"><a href="/admin">Overview</a>${['open', 'actioned', 'dismissed'].map(
        (s) => html`<a class="${status === s ? 'active' : ''}" href="/admin/reports?status=${s}">${s}</a>`,
      )}</nav>
      ${reports.length
        ? reports.map((r) => {
            const t = describeTarget(db, r.target_type, r.target_id);
            return html`<article class="card report">
              <header><span class="badge danger">${reasonLabel(r.reason)}</span>
                <span class="muted small">reported by ${r.reporter_name ?? 'deleted member'} · ${timeAgo(r.created_at)}</span></header>
              <div class="inset">${t ? t.preview : html`<em>The reported ${r.target_type} no longer exists.</em>`}</div>
              ${r.details ? html`<p><strong>Reporter's note:</strong></p>${paragraphs(r.details)}` : ''}
              ${r.status === 'open'
                ? html`<form method="post" action="/admin/reports/${r.id}/resolve" class="stack">${csrfField(req)}
                    <label>Resolution note <input name="note" maxlength="500"></label>
                    <div class="actions">
                      <button class="btn ghost small" name="action" value="dismiss">Dismiss</button>
                      ${t?.hideable && !t.hidden ? html`<button class="btn small" name="action" value="hide">Hide content</button>` : ''}
                      ${t ? html`<button class="btn danger small" name="action" value="suspend">Suspend member</button>` : ''}
                    </div></form>`
                : html`<p class="muted small">${r.status} · ${r.resolution_note}</p>`}
            </article>`;
          })
        : html`<div class="card empty">No ${status} reports. 🎉</div>`}`,
  });
});

function suspend(db, actor, userId, why, demo = false) {
  if (demo) return false; // demo members are shared by every visitor
  const target = db.prepare('SELECT id, role FROM users WHERE id = ?').get(userId);
  if (!target || target.id === actor.id) return false;
  // Moderators can't suspend admins or other moderators.
  if (actor.role !== 'admin' && target.role !== 'member') return false;
  db.prepare("UPDATE users SET status = 'suspended' WHERE id = ?").run(userId);
  endAllSessions(db, userId);
  audit(db, actor.id, 'user.suspend', `user:${userId} ${why}`);
  return true;
}

router.post('/admin/reports/:id/resolve', (req, res, next) => {
  const { db } = req.app.locals;
  const id = v.id(req.params.id);
  const report = id && db.prepare("SELECT * FROM reports WHERE id = ? AND status = 'open'").get(id);
  if (!report) return next();
  const action = v.oneOf(req.body.action, ['dismiss', 'hide', 'suspend']);
  if (!action) return res.redirect(303, '/admin/reports');
  const note = v.text(req.body.note, { max: 500 });
  const target = describeTarget(db, report.target_type, report.target_id);

  if (action === 'hide' && target?.hideable) {
    const table = report.target_type === 'post' ? 'posts' : 'comments';
    db.prepare(`UPDATE ${table} SET hidden = 1 WHERE id = ?`).run(report.target_id);
    audit(db, req.user.id, `${report.target_type}.hide`, `${report.target_type}:${report.target_id}`);
  }
  if (action === 'suspend' && target) {
    if (!suspend(db, req.user, target.ownerId, `report:${id}`, req.app.locals.config.demo)) {
      return res.status(403).type('text').send('You cannot suspend that account.');
    }
  }
  db.prepare('UPDATE reports SET status = ?, resolved_by = ?, resolution_note = ?, resolved_at = ? WHERE id = ?').run(
    action === 'dismiss' ? 'dismissed' : 'actioned',
    req.user.id,
    note || action,
    Date.now(),
    id,
  );
  audit(db, req.user.id, `report.${action}`, `report:${id}`);
  res.flash('report-resolved');
  res.redirect(303, '/admin/reports');
});

router.get('/admin/users', (req, res) => {
  const { db } = req.app.locals;
  const q = v.text(req.query.q, { max: 100 });
  const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const users = db
    .prepare(
      `SELECT u.id, u.email, u.display_name, u.role, u.status, u.verified, u.created_at, p.member_type,
              (SELECT COUNT(*) FROM reports r WHERE r.target_type = 'user' AND r.target_id = u.id) AS reports
         FROM users u JOIN profiles p ON p.user_id = u.id
        WHERE (? = '' OR u.display_name LIKE ? ESCAPE '\\' OR u.email LIKE ? ESCAPE '\\')
        ORDER BY u.created_at DESC LIMIT 100`,
    )
    .all(q, like, like);
  res.page({
    title: 'Members admin',
    wide: true,
    body: html`<h1>Members</h1>
      <nav class="tabs"><a href="/admin">Overview</a><a href="/admin/reports">Reports</a><a class="active" href="/admin/users">Members</a></nav>
      <form method="get" class="card filters"><input name="q" value="${q}" placeholder="Name or email"><button class="btn">Search</button></form>
      <div class="table-wrap"><table>
        <thead><tr><th>Member</th><th>Type</th><th>Role</th><th>Status</th><th>Reports</th><th>Joined</th><th>Actions</th></tr></thead>
        <tbody>${users.map(
          (u) => html`<tr>
            <td><a href="/members/${u.id}">${u.display_name}</a>${u.verified ? ' ✓' : ''}<br><small class="muted">${u.email}</small></td>
            <td>${u.member_type}</td><td>${u.role}</td><td>${u.status}</td><td>${u.reports}</td><td>${timeAgo(u.created_at)}</td>
            <td><form method="post" action="/admin/users/${u.id}" class="actions">${csrfField(req)}
              <button class="btn ghost small" name="action" value="${u.verified ? 'unverify' : 'verify'}">${u.verified ? 'Unverify' : 'Verify'}</button>
              ${u.id !== req.user.id
                ? html`<button class="btn ghost small" name="action" value="${u.status === 'active' ? 'suspend' : 'reinstate'}">${u.status === 'active' ? 'Suspend' : 'Reinstate'}</button>`
                : ''}
              ${isAdmin(req) && u.id !== req.user.id
                ? html`<select name="role">${['member', 'moderator', 'admin'].map((r) => html`<option ${u.role === r ? 'selected' : ''}>${r}</option>`)}</select>
                  <button class="btn ghost small" name="action" value="role">Set role</button>`
                : ''}
            </form></td></tr>`,
        )}</tbody></table></div>`,
  });
});

router.post('/admin/users/:id', (req, res, next) => {
  const { db } = req.app.locals;
  const id = v.id(req.params.id);
  const target = id && db.prepare('SELECT id, role FROM users WHERE id = ?').get(id);
  if (!target) return next();
  const action = v.oneOf(req.body.action, ['verify', 'unverify', 'suspend', 'reinstate', 'role']);
  const deny = () =>
    res.status(403).type('text').send(req.app.locals.config.demo ? 'Suspensions and role changes are turned off in the demo.' : 'Not allowed.');

  switch (action) {
    case 'verify':
    case 'unverify':
      db.prepare('UPDATE users SET verified = ? WHERE id = ?').run(action === 'verify' ? 1 : 0, id);
      audit(db, req.user.id, `user.${action}`, `user:${id}`);
      break;
    case 'suspend':
      if (!suspend(db, req.user, id, 'manual', req.app.locals.config.demo)) return deny();
      break;
    case 'reinstate':
      if (!isAdmin(req) && target.role !== 'member') return deny();
      db.prepare("UPDATE users SET status = 'active' WHERE id = ?").run(id);
      audit(db, req.user.id, 'user.reinstate', `user:${id}`);
      break;
    case 'role': {
      if (req.app.locals.config.demo) return deny();
      const role = v.oneOf(req.body.role, ['member', 'moderator', 'admin']);
      if (!isAdmin(req) || !role || id === req.user.id) return deny();
      db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
      endAllSessions(db, id); // privileges change → force a fresh login
      audit(db, req.user.id, 'user.role', `user:${id} ${role}`);
      break;
    }
    default:
      return res.redirect(303, '/admin/users');
  }
  res.flash('user-updated');
  res.redirect(303, '/admin/users');
});

function hubsPage(req, errors = [], values = {}) {
  const { db } = req.app.locals;
  const hubs = db.prepare('SELECT h.*, (SELECT COUNT(*) FROM hub_members m WHERE m.hub_id = h.id) AS members FROM hubs h ORDER BY kind, name').all();
  return {
    title: 'Hubs admin',
    wide: true,
    body: html`<h1>Hubs</h1>
      <nav class="tabs"><a href="/admin">Overview</a><a href="/admin/reports">Reports</a><a href="/admin/users">Members</a><a class="active" href="/admin/hubs">Hubs</a></nav>
      <form method="post" action="/admin/hubs" class="card stack"><h2>Open a new local hub</h2>${csrfField(req)}${errorList(errors)}
        <label>Name <input name="name" required maxlength="60" value="${values.name ?? ''}" placeholder="e.g. Brisbane"></label>
        <label>Description <input name="description" maxlength="200" value="${values.description ?? ''}"></label>
        <button class="btn small">Create hub</button></form>
      <div class="table-wrap"><table><thead><tr><th>Hub</th><th>Kind</th><th>Members</th></tr></thead>
        <tbody>${hubs.map((h) => html`<tr><td><a href="/hubs/${h.slug}">${h.name}</a></td><td>${h.kind}</td><td>${h.members}</td></tr>`)}</tbody></table></div>`,
  };
}

router.get('/admin/hubs', (req, res) => res.page(hubsPage(req)));

router.post('/admin/hubs', (req, res) => {
  const { db } = req.app.locals;
  const name = v.text(req.body.name, { max: 60 });
  const description = v.text(req.body.description, { max: 200 });
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const errors = [];
  if (name.length < 2 || !slug) errors.push('Please enter a hub name.');
  else if (db.prepare('SELECT 1 FROM hubs WHERE slug = ?').get(slug)) errors.push('A hub with that name already exists.');
  if (errors.length) return res.status(400).page(hubsPage(req, errors, { name, description }));
  db.prepare("INSERT INTO hubs (slug, name, kind, description, created_at) VALUES (?, ?, 'region', ?, ?)").run(slug, name, description, Date.now());
  audit(db, req.user.id, 'hub.create', `hub:${slug}`);
  res.flash('hub-created');
  res.redirect(303, '/admin/hubs');
});

router.get('/admin/audit', (req, res, next) => {
  if (!isAdmin(req)) return next();
  const { db } = req.app.locals;
  const rows = db
    .prepare('SELECT a.*, u.display_name FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id ORDER BY a.id DESC LIMIT 200')
    .all();
  res.page({
    title: 'Audit log',
    wide: true,
    body: html`<h1>Audit log</h1>
      <div class="table-wrap"><table><thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Target</th></tr></thead>
      <tbody>${rows.map((r) => html`<tr><td>${new Date(r.created_at).toISOString().replace('T', ' ').slice(0, 19)}</td>
        <td>${r.display_name ?? (r.actor_id ? `#${r.actor_id}` : '—')}</td><td><code>${r.action}</code></td><td>${r.target}</td></tr>`)}</tbody></table></div>`,
  });
});

export default router;
