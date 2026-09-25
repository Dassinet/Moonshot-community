# Moonshots Community (MVP)

A safe, secure community platform for the [Moonshots](https://moonshots.com/) audience. It connects **founders,
investors, builders, researchers, mentors, operators, corporate partners, policy makers, creators and students** by
**location** (city hubs) and **area of interest** (AI, longevity, space, energy, biotech, robotics…).

- 📄 Product brief, member types, metrics and roadmap: [`docs/MVP.md`](docs/MVP.md)
- 🔒 Security model and pre-launch checklist: [`docs/SECURITY.md`](docs/SECURITY.md)

## Features

- **Profiles** with role, city, interests, "looking for" and who you want to meet; privacy controls.
- **Member directory** filtered by role, interest, location and keyword.
- **Explainable suggestions**: founders ↔ investors, builders ↔ founders, mentors ↔ students, same city, shared interests.
- **Hubs**: 15 local hubs and 15 interest circles with Discussion / Ask / Offer / Event posts and comments.
- **Connections** with a required personal note, and **messaging only between connections**.
- **Safety**: block, report, moderation queue, suspend, hide content, verified badges, audit log.
- **Account security**: optional 2FA, sign out everywhere, password change, permanent account deletion.

## Quick start

Requires Node.js 22.13+ (uses the built-in `node:sqlite`; the only dependencies are `express` and `helmet`).

```bash
npm install
npm run seed      # optional: 12 demo members, posts and connections
npm run dev       # http://127.0.0.1:3000
npm test
```

Demo logins after seeding: `ada@example.com` (admin), `priya@example.com` (moderator), or any
`<firstname>@example.com` (e.g. `marcus@example.com`, an investor). Password: `moonshot-demo-pass`.

To make your own account an admin: sign up, then `npm run make-admin -- you@example.com`.

## Configuration

| Variable | Default | Notes |
| --- | --- | --- |
| `NODE_ENV` | — | Set to `production` for secure cookies, HSTS and required secrets |
| `SESSION_SECRET` | random (dev only) | **Required in production**, ≥32 random characters (`openssl rand -hex 32`) |
| `DATABASE_PATH` | `./data/dev.db` | SQLite file (`./data/community.db` in production) |
| `PORT` / `HOST` | `3000` / `127.0.0.1` | |
| `TRUST_PROXY` | `1` in prod | Number of reverse-proxy hops, so rate limits see real client IPs |
| `COOKIE_SECURE` | — | `true` to force Secure cookies outside production |

In production, run behind an HTTPS reverse proxy (e.g. Caddy, nginx, a managed platform) — see the checklist in
`docs/SECURITY.md`.

## Project layout

```
src/
  app.js            Express app, security headers, middleware wiring
  db.js             Schema (SQLite) and shared queries
  matching.js       Connection suggestions
  taxonomy.js       Member types, interests, hubs, report reasons
  security/         Passwords, sessions, CSRF, rate limiting, TOTP, input validation
  routes/           auth, home, profile, members, connections, messages, hubs, reports, settings, admin
  views/            Auto-escaping HTML templates and layout
public/styles.css   All styling (no client-side JavaScript)
scripts/            seed + make-admin
test/               Integration tests for the security-critical flows
```
