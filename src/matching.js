import { COMPLEMENTS } from './taxonomy.js';

// Transparent, rule-based suggestions. Every suggestion comes with the human-
// readable reasons it was made, so members understand (and trust) why they are
// seeing someone. Fine for thousands of members; move to a precomputed table
// or vector search once the community is larger.

export async function suggestConnections(db, viewerId, { limit = 6 } = {}) {
  const me = (await db.get('SELECT p.*, u.display_name FROM profiles p JOIN users u ON u.id = p.user_id WHERE p.user_id = ?', viewerId));
  if (!me) return [];
  const myInterests = new Set(
    (await db.all('SELECT interest_id FROM user_interests WHERE user_id = ?', viewerId)).map((r) => r.interest_id),
  );
  const interestNames = new Map((await db.all('SELECT id, name FROM interests')).map((r) => [r.id, r.name]));
  const seeking = me.seeking ? me.seeking.split(',') : COMPLEMENTS[me.member_type] ?? [];

  const candidates = (await db.all(`SELECT u.id, u.display_name, u.verified, p.member_type, p.headline, p.city, p.country, p.seeking, p.open_to_intros
         FROM users u JOIN profiles p ON p.user_id = u.id
        WHERE u.id != ? AND u.status = 'active' AND p.in_directory = 1
          AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = ? AND b.blocked_id = u.id) OR (b.blocker_id = u.id AND b.blocked_id = ?))
          AND NOT EXISTS (SELECT 1 FROM connections c WHERE (c.requester_id = ? AND c.addressee_id = u.id) OR (c.requester_id = u.id AND c.addressee_id = ?))`, viewerId, viewerId, viewerId, viewerId, viewerId));

  // One query for everyone's interests (not one per candidate — matters when
  // the database is remote).
  const interestsByUser = new Map();
  for (const r of await db.all('SELECT user_id, interest_id FROM user_interests')) {
    if (!interestsByUser.has(r.user_id)) interestsByUser.set(r.user_id, []);
    interestsByUser.get(r.user_id).push(r.interest_id);
  }
  const scored = [];
  for (const c of candidates) {
    const reasons = [];
    let score = 0;
    const shared = (interestsByUser.get(c.id) ?? []).filter((i) => myInterests.has(i));
    if (shared.length) {
      score += 3 * shared.length;
      reasons.push(`Both into ${shared.slice(0, 2).map((i) => interestNames.get(i)).join(' & ')}`);
    }
    const sameCity = me.city && c.city && me.city.toLowerCase() === c.city.toLowerCase();
    if (sameCity) {
      score += 4;
      reasons.push(`Also in ${c.city}`);
    } else if (me.country && c.country && me.country.toLowerCase() === c.country.toLowerCase()) {
      score += 1;
      reasons.push(`Also in ${c.country}`);
    }
    if (seeking.includes(c.member_type)) {
      score += 3;
      reasons.push('Matches who you are looking for');
    }
    const theySeek = c.seeking ? c.seeking.split(',') : COMPLEMENTS[c.member_type] ?? [];
    if (theySeek.includes(me.member_type)) {
      score += 2;
      if (!seeking.includes(c.member_type)) reasons.push('Looking for people like you');
    }
    if (c.member_type === 'investor' && !c.open_to_intros) score -= 3;
    if (score > 0) scored.push({ ...c, score, reasons });
  }
  scored.sort((a, b) => b.score - a.score || b.verified - a.verified || a.id - b.id);
  return scored.slice(0, limit);
}
