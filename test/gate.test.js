import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, Client, lastEmail } from './helpers.js';

const codeIn = (mail) => mail?.text.match(/access code is (\d{6})/)?.[1];

async function passGate(c, email) {
  await c.get('/gate');
  await c.post('/gate', { email });
  await c.get('/gate/verify');
  return c.post('/gate/verify', { code: codeIn(lastEmail(email)) });
}

describe('private gate (open to any email)', () => {
  let ctx;
  before(async () => {
    ctx = await startApp({ gate: true });
  });
  after(() => ctx.close());

  test('nothing is visible without a code', async () => {
    const c = new Client(ctx.base);
    for (const path of ['/', '/signup', '/login', '/members', '/code-of-conduct', '/hubs/sydney']) {
      const res = await c.get(path);
      assert.equal(res.status, 303, path);
      assert.equal(res.headers.get('location'), '/gate', path);
    }
    await c.get('/gate');
    assert.equal((await c.post('/login', { email: 'a@example.com', password: 'x' })).status, 403);
    assert.equal((await c.get('/robots.txt')).status, 200);
    assert.equal((await c.get('/static/styles.css')).status, 200);
  });

  test('the gate page is unbranded', async () => {
    const page = await new Client(ctx.base).get('/gate');
    assert.equal(page.status, 200);
    assert.ok(!/moonshot/i.test(page.body), 'gate page must not mention the brand');
    assert.match(page.body, /Private preview/);
  });

  test('a correct emailed code grants access; wrong codes do not', async () => {
    const c = new Client(ctx.base);
    await c.get('/gate');
    await c.post('/gate', { email: 'visitor@example.com' });
    const mail = lastEmail('visitor@example.com');
    assert.ok(codeIn(mail));
    assert.ok(!/moonshot/i.test(mail.text + mail.subject), 'code email must not mention the brand');
    await c.get('/gate/verify');
    const wrongCode = codeIn(mail) === '000000' ? '111111' : '000000';
    assert.equal((await c.post('/gate/verify', { code: wrongCode })).status, 401);
    assert.equal((await c.get('/')).status, 303);

    const ok = await c.post('/gate/verify', { code: codeIn(mail) });
    assert.equal(ok.status, 303);
    const home = await c.get('/');
    assert.equal(home.status, 200);
    assert.match(home.body, /find each other/);
  });

  test('codes are single-use and lock after 5 wrong guesses', async () => {
    const a = new Client(ctx.base);
    await passGate(a, 'once@example.com');
    const code = codeIn(lastEmail('once@example.com'));
    const b = new Client(ctx.base);
    await b.get('/gate');
    await b.post('/gate', { email: 'once@example.com' });
    const fresh = codeIn(lastEmail('once@example.com'));
    await b.get('/gate/verify');
    if (code !== fresh) assert.equal((await b.post('/gate/verify', { code })).status, 401);

    const c = new Client(ctx.base);
    await c.get('/gate');
    await c.post('/gate', { email: 'guess@example.com' });
    const real = codeIn(lastEmail('guess@example.com'));
    await c.get('/gate/verify');
    for (let i = 0; i < 5; i++) {
      const guess = String((Number(real) + 1 + i) % 1_000_000).padStart(6, '0');
      await c.post('/gate/verify', { code: guess });
    }
    assert.equal((await c.post('/gate/verify', { code: real })).status, 401);
  });

  test('a forged access cookie is rejected', async () => {
    const c = new Client(ctx.base);
    c.jar.set('mc_gate', `${Buffer.from('me@example.com').toString('base64url')}.${Date.now() + 1e9}.forged`);
    assert.equal((await c.get('/')).status, 303);
  });

  test('signing up with the gate-verified email skips the activation email', async () => {
    const c = new Client(ctx.base);
    await passGate(c, 'joiner@example.com');
    const before = ctx.mailer.outbox.length;
    await c.get('/signup');
    const res = await c.post('/signup', {
      display_name: 'Gate Joiner', email: 'joiner@example.com', password: 'correct horse battery staple', accept_coc: 'yes',
    });
    assert.equal(res.location, '/profile/edit');
    assert.equal(ctx.mailer.outbox.length, before, 'no activation email needed');
    assert.equal((await c.get('/members')).status, 200);
  });
});

describe('private gate (invite list)', () => {
  let ctx;
  before(async () => {
    ctx = await startApp({ gate: true, gateAllowed: 'vip@example.com,@invited.org' });
  });
  after(() => ctx.close());

  test('only invited emails and domains receive a code, with an identical response', async () => {
    const c = new Client(ctx.base);
    await c.get('/gate');
    const outsider = await c.post('/gate', { email: 'random@example.com' });
    const vip = await c.post('/gate', { email: 'vip@example.com' });
    const domain = await c.post('/gate', { email: 'someone@invited.org' });
    assert.equal(outsider.status, vip.status);
    assert.equal(outsider.location, vip.location);
    assert.equal(lastEmail('random@example.com'), undefined);
    assert.ok(codeIn(lastEmail('vip@example.com')));
    assert.ok(codeIn(lastEmail('someone@invited.org')));
  });
});
