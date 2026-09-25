// Vercel serverless entry point. Every request is routed here by vercel.json.
//
// Vercel functions have no persistent disk: the only writable path is /tmp,
// and it is wiped whenever an instance is recycled. So this deployment is a
// DEMO — it starts from sample data and changes are temporary. For real members,
// use a host with a persistent disk or a hosted database (see docs/DEPLOY.md).
import { createApp, loadConfig } from '../src/app.js';
import { openDb } from '../src/db.js';
import { seedDemo } from '../src/demo.js';

const env = { DEMO_MODE: 'true', DATABASE_PATH: '/tmp/moonshots-community.db', ...process.env };
const config = loadConfig(env);
const db = openDb(config.dbPath);
if (config.demo) {
  // The default demo password is published in this repo, so a public demo must
  // set its own — otherwise anyone could sign in as the demo admin.
  if (!env.SEED_PASSWORD || env.SEED_PASSWORD.length < 12) {
    throw new Error('Set the SEED_PASSWORD environment variable (12+ characters) for the demo accounts.');
  }
  await seedDemo(db, env.SEED_PASSWORD);
}

export default createApp(config, db);
