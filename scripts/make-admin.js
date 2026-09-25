// Usage: npm run make-admin -- someone@example.com
import { openDb, audit } from '../src/db.js';
import { loadConfig } from '../src/app.js';

const email = process.argv[2];
if (!email) {
  console.error('Usage: npm run make-admin -- <email>');
  process.exit(1);
}
const db = openDb(loadConfig().dbPath);
const user = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
if (!user) {
  console.error(`No account with email ${email}. Sign up first, then run this again.`);
  process.exit(1);
}
db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(user.id);
db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
audit(db, null, 'user.role', `user:${user.id} admin (cli)`);
console.log(`${email} is now an admin. Sign in again to pick up the new role.`);
