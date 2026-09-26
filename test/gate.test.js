import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, Client, userId } from './helpers.js';
import { seedDemo } from '../src/demo.js';

describe('private mode (SITE_PASSWORD)', () => {
  let ctx;
  before(async () => {
    ctx = await startApp({ sitePassword: 'launch-2026' });
  });
  after(() => ctx.close());

  test('nothing is visible without the password', async () => {
    const c = new Client(ctx.base);
    for (const path of ['/', '/signup', '/login', '/members', '/code-of-conduct', '/hubs/sydney']) {
      const res = await c.get(path);
      assert.equal(res.status, 303, path);
      assert.equal(res.headers.get('location'), '/private', path);
    }
    await c.get('/private');
    assert.equal((await c.post('/login', { email: 'a@example.com', password: 'x' })).status, 403);
    assert.equal((await c.get('/robots.txt')).status, 200);
    assert.equal((await c.get('/static/styles.css')).status, 200);
  });

  test('the password page is unbranded', async () => {
    const page = await new Client(ctx.base).get('/private');
    assert.equal(page.status, 200);
    assert.ok(!/moonshot/i.test(page.body));
  });

  test('wrong password is rejected, right password lets you in', async () => {
    const c = new Client(ctx.base);
    await c.get('/private');
    assert.equal((await c.post('/private', { password: 'guess' })).status, 401);
    assert.equal((await c.get('/')).status, 303);
    assert.equal((await c.post('/private', { password: 'launch-2026' })).status, 303);
    const home = await c.get('/');
    assert.equal(home.status, 200);
    assert.match(home.body, /find each other/);
  });

  test('a forged pass cookie is rejected', async () => {
    const c = new Client(ctx.base);
    c.jar.set('mc_private', `${Date.now() + 1e9}.forged`);
    assert.equal((await c.get('/')).status, 303);
  });

  test('changing the password invalidates existing passes', async () => {
    const c = new Client(ctx.base);
    await c.get('/private');
    await c.post('/private', { password: 'launch-2026' });
    assert.equal((await c.get('/')).status, 200);
    ctx.config.sitePassword = 'new-password';
    assert.equal((await c.get('/')).status, 303);
    ctx.config.sitePassword = 'launch-2026';
  });
});

describe('public mode with no email service', () => {
  let ctx;
  before(async () => {
    ctx = await startApp({ email: false });
  });
  after(() => ctx.close());

  test('the site is public', async () => {
    const home = await new Client(ctx.base).get('/');
    assert.equal(home.status, 200);
    assert.match(home.body, /find each other/);
  });

  test('sign-up works immediately without any email', async () => {
    const c = new Client(ctx.base);
    const { res } = await c.register({ email: 'noemail@example.com', display_name: 'No Email Nia' });
    assert.equal(res.location, '/profile/edit');
    assert.equal(ctx.mailer.outbox.length, 0);
    assert.equal((await c.get('/members')).status, 200);
    // And they can sign back in later.
    await c.post('/logout');
    await c.get('/login');
    assert.equal((await c.post('/login', { email: 'noemail@example.com', password: 'correct horse battery staple' })).status, 303);
  });

  test('forgot password points to a moderator instead of email', async () => {
    const page = await new Client(ctx.base).get('/forgot');
    assert.match(page.body, /contact a moderator/);
  });
});

describe('demo mode (no log-in)', () => {
  let ctx;
  before(async () => {
    ctx = await startApp({ demo: true, email: false });
    await seedDemo(ctx.db, 'unused-random-password');
  });
  after(() => ctx.close());

  test('sign-up and log-in are replaced by "explore as"', async () => {
    const c = new Client(ctx.base);
    for (const path of ['/signup', '/login', '/forgot']) {
      const res = await c.get(path);
      assert.equal(res.headers.get('location'), '/explore', path);
    }
    const picker = await c.get('/explore');
    assert.equal(picker.status, 200);
    assert.match(picker.body, /Explore as Marcus/);
  });

  test('picking a member signs you in as them', async () => {
    const c = new Client(ctx.base);
    await c.get('/explore');
    const res = await c.post(`/explore/${userId(ctx.db, 'Marcus Chen')}`);
    assert.equal(res.status, 303);
    const home = await c.get('/');
    assert.match(home.body, /Welcome back, Marcus/);
  });

  test('demo visitors cannot lock others out', async () => {
    const admin = new Client(ctx.base);
    await admin.get('/explore');
    await admin.post(`/explore/${userId(ctx.db, 'Ada Okafor')}`);
    await admin.get('/admin/users');
    const marcus = userId(ctx.db, 'Marcus Chen');
    assert.equal((await admin.post(`/admin/users/${marcus}`, { action: 'suspend' })).status, 403);
    assert.equal((await admin.post(`/admin/users/${marcus}`, { action: 'role', role: 'admin' })).status, 403);
    await admin.get('/settings');
    assert.equal((await admin.post('/settings/delete', { password: 'x', confirm: 'yes' })).status, 403);
    assert.equal((await admin.post('/settings/password', { current: 'x', password: 'another long passphrase' })).status, 403);
    assert.equal(ctx.db.prepare("SELECT COUNT(*) AS n FROM users WHERE status = 'suspended'").get().n, 0);
  });

  test('explore is not available outside demo mode', async () => {
    const other = await startApp();
    assert.equal((await new Client(other.base).get('/explore')).status, 404);
    await other.close();
  });
});
