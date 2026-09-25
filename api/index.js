// Vercel serverless entry point. Every request is routed here by vercel.json.
//
// Vercel functions have no persistent disk: the only writable path is /tmp,
// and it is wiped whenever an instance is recycled. So this deployment is a
// DEMO — it starts from sample data, visitors explore as sample members (no
// sign-up, log-in or email), and changes are temporary. Set SITE_PASSWORD in
// Vercel to make it private. For real members, see docs/DEPLOY.md.
import { randomBytes } from 'node:crypto';
import { createApp, loadConfig } from '../src/app.js';
import { openDb } from '../src/db.js';
import { seedDemo } from '../src/demo.js';

const env = { DEMO_MODE: 'true', DATABASE_PATH: '/tmp/moonshots-community.db', ...process.env };
const config = loadConfig(env);
const db = openDb(config.dbPath);
// Demo members are reached through "Explore as", so their passwords are random
// and never used.
if (config.demo) await seedDemo(db, randomBytes(24).toString('base64url'));

export default createApp(config, db);
