import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, Client, userId } from './helpers.js';
import { codeAt, currentStep, verifyCode, generateSecret } from '../src/security/totp.js';
import { hashPassword, verifyPassword } from '../src/security/passwords.js';
import * as v from '../src/security/validate.js';

let ctx;
before(async () => {
  ctx = await startApp();
});
after(() => ctx.close());

test('security headers are set', async () => {
  const c = new Client(ctx.base);
  const res = await c.get('/');
  const csp = res.headers.get('content-security-policy');
  assert.match(csp, /script-src 'none'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-powered-by'), null);
  assert.equal(res.headers.get('cache-control'), 'no-store');
});

test('signup creates a session and the member pages require auth', async () => {
  const anon = new Client(ctx.base);
  assert.equal((await anon.get('/members')).status, 303);
  const c = new Client(ctx.base);
  const res = await c.signup({ display_name: 'Signup Sam' });
  assert.equal(res.status, 303);
  assert.equal(res.location, '/profile/edit');
  assert.equal((await c.get('/members')).status, 200);
});

test('session cookie is HttpOnly and SameSite', async () => {
  const c = new Client(ctx.base);
  const res = await c.signup({ display_name: 'Cookie Carl', email: 'carl@example.com' });
  const sid = res.headers.getSetCookie().find((h) => h.startsWith('mc_sid='));
  assert.ok(sid);
  assert.match(sid, /HttpOnly/);
  assert.match(sid, /SameSite=Lax/);
});

test('weak passwords and missing code-of-conduct are rejected', async () => {
  const c = new Client(ctx.base);
  await c.get('/signup');
  const weak = await c.post('/signup', { display_name: 'Weak', email: 'weak@example.com', password: 'short', accept_coc: 'yes' });
  assert.equal(weak.status, 400);
  const noCoc = await c.post('/signup', { display_name: 'NoCoc', email: 'nococ@example.com', password: 'long enough passphrase' });
  assert.equal(noCoc.status, 400);
});

test('POST without a valid CSRF token is rejected', async () => {
  const c = new Client(ctx.base);
  await c.signup({ display_name: 'Csrf Cathy' });
  const res = await c.post('/profile/edit', { display_name: 'Hacked' }, { csrf: false });
  assert.equal(res.status, 403);
  const forged = await c.post('/profile/edit', { display_name: 'Hacked', _csrf: 'x'.repeat(43) }, { csrf: false });
  assert.equal(forged.status, 403);
});

test('cross-origin POST is rejected even with a token', async () => {
  const c = new Client(ctx.base);
  await c.signup({ display_name: 'Origin Olga' });
  const res = await c.post('/profile/edit', { display_name: 'X' }, { headers: { origin: 'https://evil.example' } });
  assert.equal(res.status, 403);
});

test('user content is HTML-escaped (no stored XSS)', async () => {
  const c = new Client(ctx.base);
  await c.signup({ display_name: 'Xss Xavier' });
  const payload = '<script>alert(1)</script><img src=x onerror=alert(1)>';
  await c.get('/profile/edit');
  const saved = await c.post('/profile/edit', {
    display_name: 'Xss Xavier', headline: payload, bio: payload, member_type: 'builder', visibility: 'members',
  });
  assert.equal(saved.status, 303);
  const page = await c.get(saved.location);
  assert.ok(!page.body.includes('<script>alert(1)</script>'));
  assert.ok(!page.body.includes('<img src=x'));
  assert.ok(page.body.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
});

test('javascript: URLs are rejected for website field', async () => {
  assert.equal(v.url('javascript:alert(1)'), null);
  assert.equal(v.url('data:text/html,hi'), null);
  assert.equal(v.url('https://user:pw@example.com'), null);
  assert.equal(v.url('example.com'), 'https://example.com/');
});

test('login is generic on failure and locks after repeated failures', async () => {
  const owner = new Client(ctx.base);
  await owner.signup({ display_name: 'Lock Lucy', email: 'lucy@example.com' });
  const attacker = new Client(ctx.base);
  await attacker.get('/login');
  const unknown = await attacker.post('/login', { email: 'nobody@example.com', password: 'whatever whatever' });
  const wrong = await attacker.post('/login', { email: 'lucy@example.com', password: 'wrong wrong wrong' });
  assert.equal(unknown.status, 401);
  assert.equal(wrong.status, 401);
  assert.ok(unknown.body.includes('Email or password is incorrect.'));
  assert.ok(wrong.body.includes('Email or password is incorrect.'));
  for (let i = 0; i < 4; i++) await attacker.post('/login', { email: 'lucy@example.com', password: 'wrong wrong wrong' });
  const locked = await attacker.post('/login', { email: 'lucy@example.com', password: 'correct horse battery staple' });
  assert.equal(locked.status, 429);
});

test('login rotates the session id (no fixation)', async () => {
  const a = new Client(ctx.base);
  await a.signup({ display_name: 'Fix Fiona', email: 'fiona@example.com' });
  const first = a.jar.get('mc_sid');
  await a.post('/logout');
  await a.get('/login');
  await a.post('/login', { email: 'fiona@example.com', password: 'correct horse battery staple' });
  assert.ok(a.jar.get('mc_sid'));
  assert.notEqual(a.jar.get('mc_sid'), first);
  // The logged-out session token no longer works.
  const stale = new Client(ctx.base);
  stale.jar.set('mc_sid', first);
  assert.equal((await stale.get('/members')).status, 303);
});

test('messaging requires an accepted connection', async () => {
  const a = new Client(ctx.base);
  const b = new Client(ctx.base);
  await a.signup({ display_name: 'Msg Alice' });
  await b.signup({ display_name: 'Msg Bob' });
  const bobId = await userId(ctx.db, 'Msg Bob');
  const aliceId = await userId(ctx.db, 'Msg Alice');

  assert.equal((await a.post(`/messages/${bobId}`, { body: 'hi' })).status, 404);

  const shortNote = await a.post(`/members/${bobId}/connect`, { note: 'hey' });
  assert.equal(shortNote.status, 400);
  const req = await a.post(`/members/${bobId}/connect`, { note: 'Hi Bob, I am building in climate and would love to connect.' });
  assert.equal(req.status, 303);
  const conn = (await ctx.db.get('SELECT id FROM connections WHERE requester_id = ? AND addressee_id = ?', aliceId, bobId));

  // Requester cannot accept their own request.
  assert.equal((await a.post(`/connections/${conn.id}/accept`)).status, 404);
  assert.equal((await a.post(`/messages/${bobId}`, { body: 'hi' })).status, 404);

  assert.equal((await b.post(`/connections/${conn.id}/accept`)).status, 303);
  const sent = await a.post(`/messages/${bobId}`, { body: 'Thanks for connecting!' });
  assert.equal(sent.status, 303);
  assert.ok((await b.get(`/messages/${aliceId}`)).body.includes('Thanks for connecting!'));
});

test('blocking hides profiles, severs connections and prevents contact', async () => {
  const a = new Client(ctx.base);
  const b = new Client(ctx.base);
  await a.signup({ display_name: 'Block Anna' });
  await b.signup({ display_name: 'Block Ben' });
  const annaId = await userId(ctx.db, 'Block Anna');
  const benId = await userId(ctx.db, 'Block Ben');
  await b.post(`/members/${annaId}/connect`, { note: 'Hello Anna, would love to talk about space startups.' });

  assert.equal((await a.post(`/members/${benId}/block`)).status, 303);
  assert.equal((await ctx.db.get('SELECT COUNT(*) AS n FROM connections WHERE requester_id = ?', benId)).n, 0);
  assert.equal((await b.get(`/members/${annaId}`)).status, 404);
  assert.equal((await b.post(`/members/${annaId}/connect`, { note: 'Please accept my request, it is important!!' })).status, 404);
  assert.ok(!(await b.get('/members')).body.includes('Block Anna'));
});

test('new accounts are limited in how many connection requests they send', async () => {
  const spammer = new Client(ctx.base);
  await spammer.signup({ display_name: 'Spammy Sid' });
  const targets = [];
  for (let i = 0; i < 4; i++) {
    const t = new Client(ctx.base);
    await t.signup({ display_name: `Target ${i}` });
    targets.push(await userId(ctx.db, `Target ${i}`));
  }
  const note = 'Hi there! I would love to pitch you my amazing opportunity.';
  for (let i = 0; i < 3; i++) assert.equal((await spammer.post(`/members/${targets[i]}/connect`, { note })).status, 303);
  const fourth = await spammer.post(`/members/${targets[3]}/connect`, { note });
  assert.equal(fourth.status, 400);
  assert.match(fourth.body, /limit/);
});

test('members-only profiles hide details from non-connections', async () => {
  const a = new Client(ctx.base);
  const b = new Client(ctx.base);
  await a.signup({ display_name: 'Private Pat' });
  await b.signup({ display_name: 'Curious Cal' });
  await a.get('/profile/edit');
  await a.post('/profile/edit', { display_name: 'Private Pat', bio: 'My secret bio text', visibility: 'connections', member_type: 'investor' });
  const page = await b.get(`/members/${await userId(ctx.db, 'Private Pat')}`);
  assert.equal(page.status, 200);
  assert.ok(!page.body.includes('My secret bio text'));
  assert.ok(!page.body.includes('@example.com'), 'email must never appear on profiles');
});

test('moderation is staff-only, and reports can suspend a member', async () => {
  const member = new Client(ctx.base);
  await member.signup({ display_name: 'Regular Rita' });
  assert.equal((await member.get('/admin')).status, 404);
  assert.equal((await member.post('/admin/users/1', { action: 'verify' })).status, 404);

  const bad = new Client(ctx.base);
  await bad.signup({ display_name: 'Scammer Steve' });
  const steveId = await userId(ctx.db, 'Scammer Steve');
  assert.equal((await member.post('/report', { type: 'user', id: steveId, reason: 'scam', details: 'Asked for crypto' })).status, 303);

  const mod = new Client(ctx.base);
  await mod.signup({ display_name: 'Mod Mia', email: 'mia@example.com' });
  (await ctx.db.run("UPDATE users SET role = 'moderator' WHERE email = 'mia@example.com'"));
  assert.equal((await mod.get('/admin/reports')).status, 200);
  const report = (await ctx.db.get("SELECT id FROM reports WHERE target_id = ? AND target_type = 'user'", steveId));
  assert.equal((await mod.post(`/admin/reports/${report.id}/resolve`, { action: 'suspend', note: 'fraud' })).status, 303);

  // Suspension revokes existing sessions immediately.
  assert.equal((await bad.get('/members')).status, 303);
  assert.equal((await member.get(`/members/${steveId}`)).status, 404);
  // Moderators cannot promote themselves.
  const miaId = await userId(ctx.db, 'Mod Mia');
  assert.equal((await mod.post(`/admin/users/${miaId}`, { action: 'role', role: 'admin' })).status, 403);
});

test('account deletion removes all personal data', async () => {
  const c = new Client(ctx.base);
  await c.signup({ display_name: 'Delete Dana', email: 'dana@example.com' });
  const id = await userId(ctx.db, 'Delete Dana');
  await c.get('/settings');
  const res = await c.post('/settings/delete', { password: 'correct horse battery staple', confirm: 'yes' });
  assert.equal(res.status, 303);
  assert.equal((await ctx.db.get('SELECT COUNT(*) AS n FROM users WHERE id = ?', id)).n, 0);
  assert.equal((await ctx.db.get('SELECT COUNT(*) AS n FROM profiles WHERE user_id = ?', id)).n, 0);
  assert.equal((await ctx.db.get('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?', id)).n, 0);
});

test('two-factor login flow', async () => {
  const c = new Client(ctx.base);
  await c.signup({ display_name: 'Totp Tom', email: 'tom@example.com' });
  await c.get('/settings');
  const setup = await c.post('/settings/2fa/setup');
  const secret = setup.body.match(/name="secret" value="([A-Z2-7]{32})"/)[1];
  const binding = setup.body.match(/name="binding" value="([^"]+)"/)[1];
  c.csrf = setup.body.match(/name="_csrf" value="([^"]+)"/)[1];

  // Tampering with the secret is rejected.
  await c.post('/settings/2fa/enable', { secret: generateSecret(), binding, code: codeAt(secret, currentStep()) });
  assert.equal((await ctx.db.get("SELECT totp_secret FROM users WHERE email = 'tom@example.com'")).totp_secret, null);

  await c.post('/settings/2fa/enable', { secret, binding, code: codeAt(secret, currentStep()) });
  assert.equal((await ctx.db.get("SELECT totp_secret FROM users WHERE email = 'tom@example.com'")).totp_secret, secret);

  const fresh = new Client(ctx.base);
  await fresh.get('/login');
  const pw = await fresh.post('/login', { email: 'tom@example.com', password: 'correct horse battery staple' });
  assert.equal(pw.location, '/login/2fa');
  assert.equal(fresh.jar.has('mc_sid'), false, 'no session before second factor');
  await fresh.get('/login/2fa');
  assert.equal((await fresh.post('/login/2fa', { code: '000000' })).status, 401);
  // Codes from the same step already used at enrolment are rejected (replay), so use the next step.
  const ok = await fresh.post('/login/2fa', { code: codeAt(secret, currentStep() + 1) });
  assert.equal(ok.status, 303);
  assert.ok(fresh.jar.has('mc_sid'));
});

test('password hashing and TOTP primitives', async () => {
  const h = await hashPassword('some passphrase here');
  assert.ok(h.startsWith('scrypt$'));
  assert.equal(await verifyPassword('some passphrase here', h), true);
  assert.equal(await verifyPassword('wrong', h), false);
  // RFC 6238 test vector (SHA-1, T=59s → step 1, secret "12345678901234567890").
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  assert.equal(codeAt(secret, 1), '287082');
  assert.equal(verifyCode(secret, '287082', { now: 59_000 }), 1);
  assert.equal(verifyCode(secret, '287082', { now: 59_000, lastStep: 1 }), null);
});
