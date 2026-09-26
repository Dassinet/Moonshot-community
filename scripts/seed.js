// Seeds a database with the demo community. Refuses to run in production
// unless DEMO_MODE=true (a demo deployment).
import { bootstrap } from '../src/app.js';
import { seedDemo, DEFAULT_DEMO_PASSWORD } from '../src/demo.js';

const { config, db } = await bootstrap();
if (config.production && !config.demo) {
  console.error('Refusing to seed a production database.');
  process.exit(1);
}
const password = process.env.SEED_PASSWORD || DEFAULT_DEMO_PASSWORD;
const created = await seedDemo(db, password);
if (!created) {
  console.log('Database already has users — skipping seed. Delete data/dev.db to reseed.');
} else {
  console.log(`Seeded ${created} members into the ${db.kind} database. Sign in as ada@example.com (admin), priya@example.com (moderator) or any <firstname>@example.com.`);
  console.log(`Password for all demo accounts: ${password}`);
}
