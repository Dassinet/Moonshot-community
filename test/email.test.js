import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, Client, lastEmail, linkIn, APP_URL } from './helpers.js';

let ctx;
before(async () => {
  ctx = await startApp();
});
after(() => ctx.close());

const PASSWORD = 'correct horse battery staple';

test('signup does not sign you in until the email is activated', async () => {
  const c = new Client(ctx.base);
  const { res, email } = await c.register({ email: 'new@example.com' });
  assert.equal(res.status, 303);
  assert.equal(res.location, '/signup/check-email');
  assert.equal(c.jar.has('mc_sid'), false);
  assert.equal((await c.get('/members')).status, 303);
  const mail = lastEmail(email);
  assert.match(mail.subject, /Activate/);
  assert.ok(mail.text.includes(`${APP_URL}/verify?token=`));
});

test('unactivated accounts cannot sign in, and get a fresh link instead', async () => {
  const c = new Client(ctx.base);
  await c.register({ email: 'pending@example.com' });
  const before = ctx.mailer.outbox.length;
  await c.get('/login');
  const res = await c.post('/login', { email: 'pending@example.com', password: PASSWORD });
  assert.equal(res.status, 403);
  assert.match(res.body, /activated yet/);
  assert.equal(c.jar.has('mc_sid'), false);
  assert.equal(ctx.mailer.outbox.length, before + 1);
});

test('opening the activation link does not activate (scanner-safe); confirming does, once', async () => {
  const c = new Client(ctx.base);
  const { email } = await c.register({ email: 'scan@example.com' });
  const token = linkIn(lastEmail(email), '/verify');
  const page = await c.get(`/verify?token=${token}`);
  assert.equal(page.status, 200);
  assert.equal((await ctx.db.get('SELECT email_verified_at FROM users WHERE email = ?', email)).email_verified_at, null);

  const ok = await c.post('/verify', { token });
  assert.equal(ok.status, 303);
  assert.equal(ok.location, '/profile/edit');
  assert.ok(c.jar.has('mc_sid'));
  assert.equal((await c.get('/members')).status, 200);

  const reused = await new Client(ctx.base).post('/verify', { token });
  assert.equal(reused.status, 400);
});

test('bad or missing tokens are rejected', async () => {
  const c = new Client(ctx.base);
  assert.equal((await c.get('/verify?token=nope')).status, 400);
  assert.equal((await c.get(`/verify?token=${'A'.repeat(43)}`)).status, 400);
  assert.equal((await c.post('/verify', { token: 'A'.repeat(43) })).status, 400);
});

test('signing up with an existing email looks identical and notifies the owner', async () => {
  const owner = new Client(ctx.base);
  await owner.signup({ email: 'taken@example.com', display_name: 'Original Owen' });
  const attacker = new Client(ctx.base);
  const fresh = await attacker.register({ email: 'brandnew@example.com' });
  const dupe = await attacker.register({ email: 'taken@example.com', display_name: 'Impostor' });
  assert.equal(dupe.res.status, fresh.res.status);
  assert.equal(dupe.res.location, fresh.res.location);
  assert.match(lastEmail('taken@example.com').subject, /already have/);
  assert.equal((await ctx.db.get("SELECT display_name FROM users WHERE email = 'taken@example.com'")).display_name, 'Original Owen');
});

test('emailed links use APP_URL, never the Host header', async () => {
  const c = new Client(ctx.base);
  await c.get('/signup');
  await c.post(
    '/signup',
    { display_name: 'Host Hank', email: 'hank@example.com', password: PASSWORD, accept_coc: 'yes' },
    { headers: { 'x-forwarded-host': 'evil.example' } },
  );
  const mail = lastEmail('hank@example.com');
  assert.ok(mail.text.includes(`${APP_URL}/verify`));
  assert.ok(!mail.text.includes('evil.example'));
});

test('password reset: generic response, single-use link, sessions revoked', async () => {
  const member = new Client(ctx.base);
  await member.signup({ email: 'reset@example.com', display_name: 'Reset Rosa' });
  assert.equal((await member.get('/members')).status, 200);

  const anon = new Client(ctx.base);
  await anon.get('/forgot');
  const unknown = await anon.post('/forgot', { email: 'ghost@example.com' });
  const known = await anon.post('/forgot', { email: 'reset@example.com' });
  assert.equal(unknown.status, known.status);
  assert.equal(lastEmail('ghost@example.com'), undefined);

  const token = linkIn(lastEmail('reset@example.com'), '/reset');
  assert.ok(token);
  await anon.get(`/reset?token=${token}`);
  assert.equal((await anon.post('/reset', { token, password: 'short' })).status, 400);
  const done = await anon.post('/reset', { token, password: 'a brand new passphrase' });
  assert.equal(done.status, 303);
  assert.equal(done.location, '/login');
  assert.match(lastEmail('reset@example.com').subject, /password was changed/);

  // Old session is gone, token is burned, new password works.
  assert.equal((await member.get('/members')).status, 303);
  await anon.get('/forgot'); // CSRF token rotates after a reset, as in a real browser
  assert.equal((await anon.post('/reset', { token, password: 'another new passphrase' })).status, 400);
  await anon.get('/login');
  const login = await anon.post('/login', { email: 'reset@example.com', password: 'a brand new passphrase' });
  assert.equal(login.status, 303);
});

test('reset and activation emails are throttled per account', async () => {
  const c = new Client(ctx.base);
  await c.signup({ email: 'throttle@example.com' });
  const anon = new Client(ctx.base);
  await anon.get('/forgot');
  for (let i = 0; i < 5; i++) await anon.post('/forgot', { email: 'throttle@example.com' });
  const resets = ctx.mailer.outbox.filter((m) => m.to === 'throttle@example.com' && /Reset your/.test(m.subject));
  assert.equal(resets.length, 3);
});

test('reset tokens expire', async () => {
  const c = new Client(ctx.base);
  await c.signup({ email: 'expire@example.com' });
  await c.get('/forgot');
  await c.post('/forgot', { email: 'expire@example.com' });
  const token = linkIn(lastEmail('expire@example.com'), '/reset');
  (await ctx.db.run("UPDATE email_tokens SET expires_at = ? WHERE purpose = 'reset'", Date.now() - 1));
  assert.equal((await c.get(`/reset?token=${token}`)).status, 400);
});

test('private: search engines are told not to index', async () => {
  const c = new Client(ctx.base);
  const home = await c.get('/');
  assert.equal(home.headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.match((await c.get('/robots.txt')).body, /Disallow: \//);
});
