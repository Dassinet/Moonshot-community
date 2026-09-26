import { Router } from 'express';
import { html } from '../views/html.js';
import { csrfField, errorList } from '../views/layout.js';
import { requireAuth } from '../middleware.js';
import * as v from '../security/validate.js';
import { MEMBER_TYPES, MEMBER_TYPE_KEYS } from '../taxonomy.js';

const router = Router();

function editPage(req, { profile, name, interests, mine, errors = [] }) {
  const seeking = new Set(profile.seeking ? profile.seeking.split(',') : []);
  return {
    title: 'Edit profile',
    body: html`<section class="card">
      <h1>Your profile</h1>
      ${errorList(errors)}
      <form method="post" action="/profile/edit" class="stack">
        ${csrfField(req)}
        <label>Name <input name="display_name" required maxlength="60" value="${name}"></label>
        <label>Headline <input name="headline" maxlength="120" placeholder="e.g. Building fusion-powered desalination · ex-SpaceX"
          value="${profile.headline}"></label>
        <label>I am primarily a…
          <select name="member_type">${MEMBER_TYPES.map(
            (t) => html`<option value="${t.key}" ${profile.member_type === t.key ? 'selected' : ''}>${t.label}</option>`,
          )}</select></label>
        <div class="row">
          <label>City <input name="city" maxlength="60" value="${profile.city}"></label>
          <label>Country <input name="country" maxlength="60" value="${profile.country}"></label>
        </div>
        <label>About you <textarea name="bio" rows="5" maxlength="2000">${profile.bio}</textarea></label>

        <fieldset><legend>Interests</legend><div class="checks">${interests.map(
          (i) => html`<label class="check"><input type="checkbox" name="interests" value="${i.slug}" ${mine.has(i.id) ? 'checked' : ''}> ${i.name}</label>`,
        )}</div></fieldset>

        <fieldset><legend>I'd like to meet…</legend><div class="checks">${MEMBER_TYPES.map(
          (t) => html`<label class="check"><input type="checkbox" name="seeking" value="${t.key}" ${seeking.has(t.key) ? 'checked' : ''}> ${t.label}</label>`,
        )}</div></fieldset>
        <label>What are you looking for right now? <textarea name="looking_for" rows="3" maxlength="500"
          placeholder="e.g. A technical co-founder with battery chemistry experience; seed investors in climate hardware">${profile.looking_for}</textarea></label>
        <label>Website or LinkedIn <input name="website" maxlength="300" value="${profile.website}" placeholder="https://"></label>

        <fieldset><legend>Privacy</legend>
          <label class="check"><input type="checkbox" name="in_directory" value="1" ${profile.in_directory ? 'checked' : ''}>
            Show me in the member directory and suggestions</label>
          <label>Who can see my full profile (bio, links, what I'm looking for)?
            <select name="visibility">
              <option value="members" ${profile.visibility === 'members' ? 'selected' : ''}>All signed-in members</option>
              <option value="connections" ${profile.visibility === 'connections' ? 'selected' : ''}>Only my connections</option>
            </select></label>
          <label class="check"><input type="checkbox" name="open_to_intros" value="1" ${profile.open_to_intros ? 'checked' : ''}>
            Open to new connection requests</label>
        </fieldset>
        <button class="btn">Save profile</button>
      </form>
    </section>`,
  };
}

async function load(db, uid) {
  return {
    profile: (await db.get('SELECT * FROM profiles WHERE user_id = ?', uid)),
    interests: (await db.all('SELECT * FROM interests ORDER BY name')),
    mine: new Set((await db.all('SELECT interest_id FROM user_interests WHERE user_id = ?', uid)).map((r) => r.interest_id)),
  };
}

router.get('/profile/edit', requireAuth, async (req, res) => {
  const { db } = req.app.locals;
  res.page(editPage(req, { ...(await load(db, req.user.id)), name: req.user.displayName }));
});

router.post('/profile/edit', requireAuth, async (req, res) => {
  const { db } = req.app.locals;
  const uid = req.user.id;
  const errors = [];
  const name = v.text(req.body.display_name, { max: 60 });
  if (name.length < 2) errors.push('Please enter your name.');
  const website = v.url(req.body.website);
  if (website === null) errors.push('Website must be a valid http(s) link.');

  const allInterests = (await db.all('SELECT id, slug FROM interests'));
  const chosen = v.manyOf(req.body.interests, allInterests.map((i) => i.slug));
  const profile = {
    member_type: v.oneOf(req.body.member_type, MEMBER_TYPE_KEYS, 'builder'),
    headline: v.text(req.body.headline, { max: 120 }),
    bio: v.text(req.body.bio, { max: 2000, multiline: true }),
    city: v.text(req.body.city, { max: 60 }),
    country: v.text(req.body.country, { max: 60 }),
    seeking: v.manyOf(req.body.seeking, MEMBER_TYPE_KEYS).join(','),
    looking_for: v.text(req.body.looking_for, { max: 500, multiline: true }),
    website: website ?? '',
    visibility: v.oneOf(req.body.visibility, ['members', 'connections'], 'members'),
    in_directory: req.body.in_directory === '1' ? 1 : 0,
    open_to_intros: req.body.open_to_intros === '1' ? 1 : 0,
  };

  if (errors.length) {
    const base = (await load(db, uid));
    const mine = new Set(allInterests.filter((i) => chosen.includes(i.slug)).map((i) => i.id));
    return res.status(400).page(editPage(req, { ...base, profile: { ...base.profile, ...profile }, mine, name, errors }));
  }

  // One atomic batch: the profile and its interests change together or not at all.
  await db.batch([
    ['UPDATE users SET display_name = ? WHERE id = ?', [name, uid]],
    [
      `UPDATE profiles SET member_type = ?, headline = ?, bio = ?, city = ?, country = ?, seeking = ?, looking_for = ?,
              website = ?, visibility = ?, in_directory = ?, open_to_intros = ?, updated_at = ? WHERE user_id = ?`,
      [profile.member_type, profile.headline, profile.bio, profile.city, profile.country, profile.seeking,
        profile.looking_for, profile.website, profile.visibility, profile.in_directory, profile.open_to_intros, Date.now(), uid],
    ],
    ['DELETE FROM user_interests WHERE user_id = ?', [uid]],
    ...allInterests.filter((i) => chosen.includes(i.slug)).map((i) => ['INSERT INTO user_interests (user_id, interest_id) VALUES (?, ?)', [uid, i.id]]),
  ]);
  res.flash('profile-saved');
  res.redirect(303, `/members/${uid}`);
});

export default router;
