import { Router } from 'express';
import { html } from '../views/html.js';
import { csrfField, errorList } from '../views/layout.js';
import { requireAuth } from '../middleware.js';
import { RateLimiter, limit } from '../security/rateLimit.js';
import * as v from '../security/validate.js';
import { REPORT_REASONS, REPORT_REASON_KEYS } from '../taxonomy.js';

const router = Router();
const reportLimiter = new RateLimiter({ windowMs: 60 * 60 * 1000, max: 20 });
const TYPES = ['user', 'post', 'comment', 'message'];

// A member can only report things they can actually see: messages sent to
// them, and existing posts/comments/users.
async function targetExists(db, type, id, uid) {
  switch (type) {
    case 'user':
      return !!(await db.get('SELECT 1 FROM users WHERE id = ? AND id != ?', id, uid));
    case 'post':
      return !!(await db.get('SELECT 1 FROM posts WHERE id = ?', id));
    case 'comment':
      return !!(await db.get('SELECT 1 FROM comments WHERE id = ?', id));
    case 'message':
      return !!(await db.get('SELECT 1 FROM messages WHERE id = ? AND recipient_id = ?', id, uid));
    default:
      return false;
  }
}

function reportPage(req, type, id, errors = []) {
  return {
    title: 'Report',
    body: html`<section class="narrow card">
      <h1>Report ${type === 'user' ? 'a member' : `a ${type}`}</h1>
      <p class="muted">Reports are confidential — the person will not know who reported them. If someone is in immediate danger, contact local emergency services.</p>
      ${errorList(errors)}
      <form method="post" action="/report" class="stack">
        ${csrfField(req)}
        <input type="hidden" name="type" value="${type}">
        <input type="hidden" name="id" value="${id}">
        <fieldset><legend>What's wrong?</legend>${REPORT_REASONS.map(
          (r, i) => html`<label class="check"><input type="radio" name="reason" value="${r.key}" ${i === 0 ? 'required' : ''}> ${r.label}</label>`,
        )}</fieldset>
        <label>Anything else we should know? <textarea name="details" rows="4" maxlength="2000"></textarea></label>
        <button class="btn">Send report</button>
      </form>
    </section>`,
  };
}

router.get('/report', requireAuth, async (req, res, next) => {
  const type = v.oneOf(req.query.type, TYPES);
  const id = v.id(req.query.id);
  if (!type || !id || !(await targetExists(req.app.locals.db, type, id, req.user.id))) return next();
  res.page(reportPage(req, type, id));
});

router.post('/report', requireAuth, limit(reportLimiter, (req) => `report:${req.user.id}`), async (req, res, next) => {
  const { db } = req.app.locals;
  const type = v.oneOf(req.body.type, TYPES);
  const id = v.id(req.body.id);
  if (!type || !id || !(await targetExists(db, type, id, req.user.id))) return next();
  const reason = v.oneOf(req.body.reason, REPORT_REASON_KEYS);
  if (!reason) return res.status(400).page(reportPage(req, type, id, ['Please choose a reason.']));
  (await db.run('INSERT INTO reports (reporter_id, target_type, target_id, reason, details, created_at) VALUES (?, ?, ?, ?, ?, ?)', req.user.id,
    type,
    id,
    reason,
    v.text(req.body.details, { max: 2000, multiline: true }),
    Date.now()));
  res.flash('reported');
  res.redirect(303, '/');
});

export default router;
