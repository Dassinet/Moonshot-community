import { Router } from 'express';
import { html } from '../views/html.js';
import { csrfField, avatar, badges } from '../views/layout.js';
import { startSession, endSession } from '../security/sessions.js';
import * as v from '../security/validate.js';

// Demo only: instead of signing up or logging in, visitors pick a sample member
// and explore the community as them. No passwords, no email.

const router = Router();

router.use('/explore', (req, res, next) => (req.app.locals.config.demo ? next() : res.status(404).type('text').send('Not found')));

router.get('/explore', (req, res) => {
  const { db } = req.app.locals;
  const members = db
    .prepare(
      `SELECT u.id, u.display_name, u.role, u.verified, p.member_type, p.headline, p.city, p.country, p.open_to_intros
         FROM users u JOIN profiles p ON p.user_id = u.id WHERE u.status = 'active' ORDER BY u.id`,
    )
    .all();
  const roleNote = (m) => (m.role === 'admin' ? 'Community admin' : m.role === 'moderator' ? 'Moderator' : '');
  res.page({
    title: 'Explore the demo',
    wide: true,
    body: html`<section class="center">
        <p class="eyebrow">Demo · No sign-up needed</p>
        <h1>Pick someone to explore as</h1>
        <p class="lead">See the community through the eyes of a founder, an investor, a builder or a moderator. You can switch any time.</p>
      </section>
      <div class="grid cards">${members.map(
        (m) => html`<article class="card member-card">
          <div class="member-link">${avatar(m.display_name)}<span><strong>${m.display_name}</strong><small>${m.headline}</small></span></div>
          <div class="badges">${badges(m)}${roleNote(m) ? html`<span class="badge soft">${roleNote(m)}</span>` : ''}</div>
          <p class="muted small">📍 ${[m.city, m.country].filter(Boolean).join(', ')}</p>
          <form method="post" action="/explore/${m.id}">${csrfField(req)}
            <button class="btn small">${req.user?.id === m.id ? 'Continue as' : 'Explore as'} ${m.display_name.split(' ')[0]}</button></form>
        </article>`,
      )}</div>`,
  });
});

router.post('/explore/:id', (req, res, next) => {
  const { db, config } = req.app.locals;
  const id = v.id(req.params.id);
  const member = id && db.prepare("SELECT id FROM users WHERE id = ? AND status = 'active'").get(id);
  if (!member) return next();
  endSession(db, config, req, res);
  req.rotateCsrf();
  startSession(db, config, res, member.id);
  res.flash('signed-in');
  res.redirect(303, '/');
});

export default router;
