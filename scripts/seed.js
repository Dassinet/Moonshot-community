// Seeds a development database with demo data. Refuses to run in production.
import { openDb } from '../src/db.js';
import { loadConfig } from '../src/app.js';
import { seedDemo, DEFAULT_DEMO_PASSWORD } from '../src/demo.js';

const config = loadConfig();
if (config.production) {
  console.error('Refusing to seed a production database.');
  process.exit(1);
}
const password = process.env.SEED_PASSWORD || DEFAULT_DEMO_PASSWORD;
const created = await seedDemo(openDb(config.dbPath), password);
if (!created) {
  console.log('Database already has users — skipping seed. Delete data/dev.db to reseed.');
} else {
  console.log(`Seeded ${created} members. Sign in as ada@example.com (admin), priya@example.com (moderator) or any <firstname>@example.com.`);
  console.log(`Password for all demo accounts: ${password}`);
}
