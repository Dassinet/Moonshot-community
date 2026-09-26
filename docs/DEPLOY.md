# Seeing the app on your phone

You can't run `npm` on a phone, and `http://127.0.0.1:3000` only works on the computer running the app. Pick one of
these instead.

## Option 1 — Your computer + home Wi-Fi (quickest, free, private)

On a Mac, Windows or Linux computer with [Node.js 22.13+](https://nodejs.org/) installed:

```bash
git clone https://github.com/dassinet/moonshot-community.git
cd moonshot-community
git checkout claude/moonshots-community-mvp-25t5ia   # until it's merged to main
npm install
npm run seed
npm run dev:phone
```

The terminal prints an address like `http://192.168.1.23:3000`. Open that on a phone **connected to the same Wi-Fi**.
Sign in with `ada@example.com` / `moonshot-demo-pass`.

If the page doesn't load, allow Node.js through your computer's firewall when prompted (macOS: System Settings →
Network → Firewall). Office or guest Wi-Fi networks often block device-to-device traffic; home Wi-Fi works.

## Option 2 — Vercel (a link you can share)

On Vercel the app runs as a **demo**: it starts with 51 sample members across 15 cities, plus posts, events and connections. Visitors don't sign up
or log in. They tap **Explore the demo** and pick a member to explore as (a founder, an investor, a moderator…).
**No email service, keys or other setup is needed.**

1. Sign in at [vercel.com](https://vercel.com) with GitHub, then **Add New… → Project** and import
   `dassinet/moonshot-community`. **Framework Preset:** `Other`.
2. Optional **Environment Variables**:
   | Name | What it does |
   | --- | --- |
   | `SITE_PASSWORD` | Makes the site **private**. Visitors see only a plain, unbranded "Private preview" page until they enter this password (remembered for 30 days on that device). Leave it out for a public site. |
   | `SESSION_SECRET` | 64 random characters (e.g. `openssl rand -hex 32`). Recommended: keeps visitors signed in when Vercel restarts. |
3. **Deploy**, then open the `https://….vercel.app` link on your phone.
4. To install it like an app: on iPhone tap **Share → Add to Home Screen**; on Android tap **⋮ → Install app**.

To switch between public and private later: Vercel → project → **Settings → Environment Variables**, add, change or
remove `SITE_PASSWORD`, then **Deployments → Redeploy**. Changing the password locks out everyone who used the old one.

You can delete any `RESEND_API_KEY`, `MAIL_FROM`, `APP_URL`, `SEED_PASSWORD` or `GATE_ALLOWED` variables you added
earlier; they're no longer needed.

> ⚠️ Vercel keeps no permanent disk, so demo data resets whenever Vercel recycles the server (often within hours),
> and everyone shares the same sample members. A yellow banner says so. That's fine for showing people the idea;
> for real members see Option 3.

## Email (optional)

The app works without email. New accounts on a real (non-demo) deployment are active straight away, and a
moderator resets forgotten passwords. To add email activation and "forgot password" emails later, create a
[Resend](https://resend.com) account, verify your domain, and set `RESEND_API_KEY`, `MAIL_FROM` and `APP_URL`.

## Option 3 — Real hosting for actual members

The app is a normal Node server with a SQLite file, so it runs unchanged on any host that has a **persistent disk**:

- **Railway**, **Render** (paid instance with a disk) or **Fly.io**: create a service from the GitHub repo, attach
  a volume (e.g. mounted at `/data`), and set:
  `NODE_ENV=production`, `SESSION_SECRET=<random>`, `DATABASE_PATH=/data/community.db`, `HOST=0.0.0.0`,
  and optionally `SITE_PASSWORD` (private) and the email settings above.
  Start command: `npm start`. These hosts provide HTTPS automatically.
- Then sign up with your own email and run `npm run make-admin -- you@example.com` from the host's shell.

To keep Vercel for production, the database needs to move to a hosted service (e.g. Turso, which is SQLite-compatible,
or Neon Postgres). That's a follow-up code change. Before inviting real members, work through the checklist in
[`SECURITY.md`](SECURITY.md).
