import { createApp, loadConfig } from '../src/app.js';
import { openDb } from '../src/db.js';

export async function startApp() {
  const config = { ...loadConfig({ NODE_ENV: 'test' }), dbPath: ':memory:', trustProxy: 'loopback' };
  const db = openDb(':memory:');
  const app = createApp(config, db);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { app, db, config, base, close: () => new Promise((r) => server.close(r)) };
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
    if (csrf && !this.csrf) await this.get('/');
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

  async signup(overrides = {}) {
    await this.get('/signup');
    const res = await this.post('/signup', {
      display_name: 'Test Person',
      email: `user${Math.random().toString(36).slice(2)}@example.com`,
      password: 'correct horse battery staple',
      member_type: 'founder',
      city: 'Sydney',
      country: 'Australia',
      accept_coc: 'yes',
      ...overrides,
    });
    await this.get('/'); // refresh CSRF token after rotation
    return res;
  }
}

export function userId(db, name) {
  return db.prepare('SELECT id FROM users WHERE display_name = ?').get(name).id;
}
