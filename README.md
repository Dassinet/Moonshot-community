# Moonshots Community (MVP)

A safe, secure community platform for the [Moonshots](https://moonshots.com/) audience. It connects **founders,
investors, builders, researchers, mentors, operators, corporate partners, policy makers, creators and students** by
**location** (city hubs) and **area of interest** (AI, longevity, space, energy, biotech, robotics…).

- 📄 Product brief, member types, metrics and roadmap: [`docs/MVP.md`](docs/MVP.md)
- 🔒 Security model and pre-launch checklist: [`docs/SECURITY.md`](docs/SECURITY.md)
- 📱 Viewing it on your phone / deploying (Wi-Fi, Vercel demo, real hosting): [`docs/DEPLOY.md`](docs/DEPLOY.md)

## Features

- **Profiles** with role, city, interests, "looking for" and who you want to meet; privacy controls.
- **Member directory** filtered by role, interest, location and keyword.
- **Explainable suggestions**: founders ↔ investors, builders ↔ founders, mentors ↔ students, same city, shared interests.
- **Hubs**: 15 local hubs and 15 interest circles with Discussion / Ask / Offer posts and comments.
- **Events**: meetups, dinners and online sessions with RSVPs (going / interested), capacity limits, attendee lists, time zones, and add-to-calendar (.ics / Google). Online links are only shown to people who are going.
- **Home-screen app**: installable on iPhone and Android (web app manifest + icons), opens full-screen.
- **Connections** with a required personal note, and **messaging only between connections**.
- **Safety**: block, report, moderation queue, suspend, hide content, verified badges, audit log.
- **Public or private**: set `SITE_PASSWORD` to hide the whole site behind one shared password (on an unbranded page); leave it unset for a public site. Hidden from search engines either way.
- **No email needed**: optional email activation and password-reset emails if you add Resend.
- **Demo mode**: no sign-up or log-in; visitors pick a sample member to explore as.
- **Account security**: optional 2FA, sign out everywhere, password change (with email alert), permanent account deletion.

## Quick start

Requires Node.js 22.13+ (uses the built-in `node:sqlite`; the only dependencies are `express` and `helmet`).

```bash
npm install
npm run seed      # optional: 51 demo members, 45 posts, 15 events, connections and messages
npm run dev       # http://127.0.0.1:3000
npm run dev:phone # same, plus a link to open on a phone on your Wi-Fi
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
| `DEMO_MODE` | — | `true`: demo banner, and visitors "explore as" sample members instead of signing up or logging in (always on for the Vercel entry point, which also auto-seeds) |
| `SITE_PASSWORD` | — | Makes the whole site private behind one shared password, on an unbranded page. Unset = public |
| `SEED_PASSWORD` | `moonshot-demo-pass` | Password for accounts created by `npm run seed` |
| `RESEND_API_KEY` / `MAIL_FROM` / `APP_URL` | — | Optional email via [Resend](https://resend.com) for account activation and password-reset emails. Without it, accounts are active immediately |
| `SUPPORT_EMAIL` | — | Optional contact address shown in the footer |

In production, run behind an HTTPS reverse proxy (e.g. Caddy, nginx, a managed platform) — see the checklist in
`docs/SECURITY.md`.

## Project layout

```
src/
  app.js            Express app, security headers, middleware wiring
  db.js             Schema (SQLite) and shared queries
  matching.js       Connection suggestions
  taxonomy.js       Member types, interests, hubs, report reasons
  brand.js          Brand name, tagline and links (colours: "Brand tokens" in public/styles.css)
  mailer.js         Optional email sending (Resend), otherwise logged
  gate.js           Optional shared-password private mode (SITE_PASSWORD)
  security/         Passwords, sessions, CSRF, rate limiting, TOTP, input validation
  routes/           auth, home, profile, members, connections, messages, hubs, events, explore, reports, settings, admin
  demo.js / demoData.js  The fictional sample community
  time.js           Time-zone handling for events
  views/            Auto-escaping HTML templates and layout
public/styles.css   All styling (no client-side JavaScript); logo.svg and self-hosted fonts in public/
api/index.js        Vercel entry point (demo mode) — see docs/DEPLOY.md
scripts/            seed + make-admin
test/               Integration tests for the security-critical flows
```
