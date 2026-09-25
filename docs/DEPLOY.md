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

## Option 2 — Vercel (a public link you can share)

> ⚠️ **Vercel runs this as a demo.** Vercel functions have no permanent disk, so the app starts from sample data and
> anything you add (new accounts, posts, messages) is **wiped** whenever Vercel recycles the server, often within
> minutes to hours. You may occasionally be signed out. A yellow banner on every page says so. That's fine for showing
> people what it looks like; it is not suitable for real members (see Option 3).

1. Sign in at [vercel.com](https://vercel.com) with your GitHub account.
2. **Add New… → Project**, and import `dassinet/moonshot-community`. If it isn't listed, choose
   **Adjust GitHub App Permissions** and grant Vercel access to that repository.
3. On the configure screen:
   - **Framework Preset:** `Other`. Leave the build and output settings as they are (`vercel.json` handles them).
   - **Environment Variables**, add:
     | Name | Value |
     | --- | --- |
     | `SESSION_SECRET` | 64 random characters, e.g. from `openssl rand -hex 32` or any password generator |
     | `SEED_PASSWORD` | A password of your choice (12+ characters) for the demo accounts. **Required**: the default is public in this repo, so without your own anyone could sign in as the demo admin. |
     | `APP_URL` | Your site's address, e.g. `https://moonshot-community.vercel.app`. Used in emailed links. |
     | `RESEND_API_KEY` | From Resend. **Required**: see "Email activation" below. |
     | `MAIL_FROM` | The sender, e.g. `Moonshots Community <hello@yourdomain.com>` |
4. Click **Deploy**. Vercel deploys the default branch (`main`), so merge the MVP branch first, or open the preview
   deployment Vercel creates for the `claude/moonshots-community-mvp-25t5ia` branch.
5. Open the `https://….vercel.app` link on your phone. Sign in with `ada@example.com` (admin) or
   `marcus@example.com` (investor) and the `SEED_PASSWORD` you chose.

If the page shows a server error, open the project in Vercel → **Logs**. The most common cause is a missing
`SESSION_SECRET` or `SEED_PASSWORD`. Under **Settings → Build and Deployment → Node.js Version**, choose 22.x or newer.

## Email activation (required in production)

New members must click a link in their email before they can sign in, and "Forgot password" also works by email.
The app sends email through [Resend](https://resend.com), which has a free tier:

1. Create a Resend account and **add your domain** (Domains → Add domain). Resend shows a few DNS records; add them
   where your domain's DNS is managed (e.g. GoDaddy, Cloudflare, Squarespace). Verification usually takes minutes.
2. Create an **API key** (API Keys → Create, "Sending access").
3. In Vercel → your project → **Settings → Environment Variables**, add `RESEND_API_KEY`, `MAIL_FROM` (an address
   on the domain you verified) and `APP_URL`. Then go to **Deployments** and **Redeploy** the latest deployment.

Until those are set, the site won't start in production. That's deliberate: a members-only site shouldn't quietly
accept accounts it can't verify. For a quick test without a domain, Resend lets you send from
`onboarding@resend.dev`, but **only to the email address you signed up to Resend with**.

The demo accounts (`ada@example.com` etc.) come pre-activated so you can still sign in to them.

Developing locally, no email service is needed: activation and reset emails are printed in the terminal, and you
can copy the link from there.

## Option 3 — Real hosting for actual members

The app is a normal Node server with a SQLite file, so it runs unchanged on any host that has a **persistent disk**:

- **Railway**, **Render** (paid instance with a disk) or **Fly.io**: create a service from the GitHub repo, attach
  a volume (e.g. mounted at `/data`), and set:
  `NODE_ENV=production`, `SESSION_SECRET=<random>`, `DATABASE_PATH=/data/community.db`, `HOST=0.0.0.0`,
  `APP_URL=<your https address>`, `RESEND_API_KEY` and `MAIL_FROM` (see "Email activation").
  Start command: `npm start`. These hosts provide HTTPS automatically.
- Then sign up with your own email and run `npm run make-admin -- you@example.com` from the host's shell.

To keep Vercel for production, the database needs to move to a hosted service (e.g. Turso, which is SQLite-compatible,
or Neon Postgres). That's a follow-up code change. Before inviting real members, work through the checklist in
[`SECURITY.md`](SECURITY.md).
