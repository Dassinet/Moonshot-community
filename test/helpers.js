import { createApp, loadConfig } from '../src/app.js';
import { openDb } from '../src/db.js';
import { memoryMailer } from '../src/mailer.js';

export const APP_URL = 'https://community.test';
let mailer;

// Most recent email sent to an address.
export function lastEmail(to) {
  return mailer.outbox.filter((m) => m.to === to).at(-1);
}

export function linkIn(email, path) {
  const m = email?.text.match(new RegExp(`${APP_URL}${path}\\?token=([A-Za-z0-9_-]+)`));
  return m && m[1];
}

// Options: sitePassword (private gate), email (false = no email service),
// demo (explore-as-member mode).
export async function startApp({ sitePassword = '', email = true, demo = false } = {}) {
  mailer = memoryMailer();
  const config = {
    ...loadConfig({ NODE_ENV: 'test', APP_URL, SITE_PASSWORD: sitePassword, ...(demo && { DEMO_MODE: 'true' }) }),
    ...(!email && { emailEnabled: false }),
    dbPath: ':memory:',
    trustProxy: 'loopback',
    mailer,
  };
  const db = openDb(':memory:');
  const app = createApp(config, db);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { app, db, config, base, mailer, close: () => new Promise((r) => server.close(r)) };
}

const rand = () => Math.floor(Math.random() * 254) + 1;

// Minimal cookie-keeping browser.
export class Client {
  constructor(base) {
    this.base = base;
    this.jar = new Map();
    // Each simulated browser gets its own IP so per-IP rate limits behave realistically.
    this.ip = `10.${rand()}.${rand()}.${rand()}`;
  }

  storeCookies(res) {
    for (const c of res.headers.getSetCookie()) {
      const [pair, ...attrs] = c.split(';');
      const i = pair.indexOf('=');
      const name = pair.slice(0, i).trim();
      const value = pair.slice(i + 1).trim();
      if (attrs.some((a) => a.trim().toLowerCase() === 'max-age=0') || value === '') this.jar.delete(name);
      else this.jar.set(name, value);
    }
  }

  headers(extra = {}) {
    const cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');
    return { 'x-forwarded-for': this.ip, ...(cookie && { cookie }), ...extra };
  }

  async get(path) {
    const res = await fetch(this.base + path, { headers: this.headers(), redirect: 'manual' });
    this.storeCookies(res);
    const body = await res.text();
    const m = body.match(/name="_csrf" value="([^"]+)"/);
    if (m) this.csrf = m[1];
    return { status: res.status, body, headers: res.headers };
  }

  async post(path, fields = {}, { csrf = true, headers = {} } = {}) {
    if (csrf && !this.csrf) {
      await this.get('/login');
      if (!this.csrf) await this.get('/private');
      if (!this.csrf) await this.get('/explore');
    }
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(fields)) {
      for (const item of Array.isArray(v) ? v : [v]) params.append(k, item);
    }
    if (csrf) params.append('_csrf', this.csrf);
    const res = await fetch(this.base + path, {
      method: 'POST',
      headers: this.headers({ 'content-type': 'application/x-www-form-urlencoded', ...headers }),
      body: params,
      redirect: 'manual',
    });
    this.storeCookies(res);
    const body = await res.text();
    return { status: res.status, body, location: res.headers.get('location'), headers: res.headers };
  }

  // Signs up without activating. Returns the signup response and the email used.
  async register(overrides = {}) {
    await this.get('/signup');
    const fields = {
      display_name: 'Test Person',
      email: `user${Math.random().toString(36).slice(2)}@example.com`,
      password: 'correct horse battery staple',
      member_type: 'founder',
      city: 'Sydney',
      country: 'Australia',
      accept_coc: 'yes',
      ...overrides,
    };
    const res = await this.post('/signup', fields);
    return { res, email: fields.email };
  }

  // Signs up and clicks the activation link. Returns the activation response.
  async signup(overrides = {}) {
    const { email } = await this.register(overrides);
    const token = linkIn(lastEmail(email), '/verify');
    await this.get(`/verify?token=${token}`);
    const res = await this.post('/verify', { token });
    await this.get('/'); // refresh CSRF token after rotation
    return res;
  }
}

export function userId(db, name) {
  return db.prepare('SELECT id FROM users WHERE display_name = ?').get(name).id;
}
