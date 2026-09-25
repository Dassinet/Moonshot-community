import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

// scrypt parameters (OWASP-recommended minimum is N=2^17,r=8,p=1; 2^15 keeps
// signup/login snappy on small instances while staying memory-hard). Stored
// alongside the hash so they can be raised later without breaking old hashes.
const N = 2 ** 15;
const R = 8;
const P = 1;
const KEYLEN = 64;
const MAXMEM = 64 * 1024 * 1024;

export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 200;

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scryptAsync(password.normalize('NFKC'), salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  const parts = String(stored).split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, keyB64] = parts;
  const expected = Buffer.from(keyB64, 'base64');
  const key = await scryptAsync(password.normalize('NFKC'), Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: MAXMEM,
  });
  return timingSafeEqual(key, expected);
}

// A real hash of a random password, used so that logins for unknown emails
// take the same time as logins for real accounts (prevents account enumeration
// by timing).
let dummyHash;
export async function burnPasswordCheck(password) {
  dummyHash ??= await hashPassword(randomBytes(16).toString('hex'));
  await verifyPassword(password, dummyHash);
  return false;
}

export function passwordProblems(password, { email = '', name = '' } = {}) {
  const problems = [];
  if (typeof password !== 'string' || password.length < PASSWORD_MIN) {
    problems.push(`Password must be at least ${PASSWORD_MIN} characters.`);
  } else if (password.length > PASSWORD_MAX) {
    problems.push(`Password must be at most ${PASSWORD_MAX} characters.`);
  } else {
    const lower = password.toLowerCase();
    const local = email.split('@')[0]?.toLowerCase();
    if ((local && local.length >= 4 && lower.includes(local)) || (name && name.length >= 4 && lower.includes(name.toLowerCase()))) {
      problems.push('Password must not contain your name or email.');
    }
    if (/^(.)\1+$/.test(password) || COMMON.has(lower)) {
      problems.push('That password is too easy to guess.');
    }
  }
  return problems;
}

const COMMON = new Set([
  'password1234', 'password12345', 'passwordpassword', '123456789012', 'qwertyuiopas',
  'moonshots123', 'moonshot1234', 'letmein12345', 'iloveyou1234', 'administrator',
]);
