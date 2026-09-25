// Input normalisation helpers. Every value that comes from a form passes
// through one of these before it touches the database.

// Strip control characters (except newlines/tabs in multi-line text), trim and
// cap length.
export function text(value, { max = 200, multiline = false } = {}) {
  if (typeof value !== 'string') return '';
  let v = value.normalize('NFC');
  v = multiline
    ? v.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B-\u001F\u007F‪-‮⁦-⁩]/g, '')
    : v.replace(/[\u0000-\u001F\u007F‪-‮⁦-⁩]/g, ' ');
  v = v.trim();
  if (multiline) v = v.replace(/\n{3,}/g, '\n\n');
  return v.slice(0, max);
}

export function email(value) {
  const v = text(value, { max: 254 }).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) ? v : '';
}

// Only allow absolute http(s) URLs — blocks javascript:, data:, etc.
export function url(value) {
  const v = text(value, { max: 300 });
  if (!v) return '';
  try {
    const u = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (u.username || u.password) return null;
    return u.toString();
  } catch {
    return null;
  }
}

export function oneOf(value, allowed, fallback = null) {
  return allowed.includes(value) ? value : fallback;
}

// Form checkbox groups arrive as string | string[] | undefined.
export function manyOf(value, allowed) {
  const arr = Array.isArray(value) ? value : value === undefined ? [] : [value];
  return [...new Set(arr.filter((v) => allowed.includes(v)))];
}

export function id(value) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
