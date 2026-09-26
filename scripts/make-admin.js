// Usage: npm run make-admin -- someone@example.com
// Works against the local database, or Turso when TURSO_DATABASE_URL is set.
import { audit } from '../src/db.js';
import { bootstrap } from '../src/app.js';

const email = process.argv[2];
if (!email) {
  console.error('Usage: npm run make-admin -- <email>');
  process.exit(1);
}
const { db } = await bootstrap();
const user = await db.get('SELECT id FROM users WHERE email = ?', email);
if (!user) {
  console.error(`No account with email ${email}. Sign up first, then run this again.`);
  process.exit(1);
}
await db.batch([
  ["UPDATE users SET role = 'admin' WHERE id = ?", [user.id]],
  ['DELETE FROM sessions WHERE user_id = ?', [user.id]],
]);
await audit(db, null, 'user.role', `user:${user.id} admin (cli)`);
console.log(`${email} is now an admin. Sign in again to pick up the new role.`);
