// Vercel serverless entry point. Every request is routed here by vercel.json.
//
// Data lives in Turso (hosted SQLite) when TURSO_DATABASE_URL and
// TURSO_AUTH_TOKEN are set, so it's permanent and shared by every server
// instance. Without them the app falls back to a temporary SQLite file in
// /tmp, which Vercel wipes whenever it recycles the server.
//
// This deployment runs as a DEMO: visitors explore as sample members (no
// sign-up, log-in or email). Set SITE_PASSWORD to make it private.
import { randomBytes } from 'node:crypto';
import { bootstrap, createApp } from '../src/app.js';
import { seedDemo, refreshDemoEvents } from '../src/demo.js';

const env = { DEMO_MODE: 'true', DATABASE_PATH: '/tmp/moonshots-community.db', ...process.env };
const { config, db } = await bootstrap(env);
config.ephemeral = db.kind !== 'turso';

if (config.demo) {
  try {
    // Demo members are reached through "Explore as", so their passwords are
    // random and never used.
    await seedDemo(db, randomBytes(24).toString('base64url'));
  } catch (err) {
    // Another instance may have seeded at the same moment; that's fine.
    if (!(await db.get('SELECT COUNT(*) AS n FROM users')).n) throw err;
  }
  await refreshDemoEvents(db);
}

export default createApp(config, db);
