export function parseCookies(header = '') {
  const out = Object.create(null);
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const name = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    if (!name || name in out) continue;
    try {
      out[name] = decodeURIComponent(value);
    } catch {
      // ignore malformed cookie values
    }
  }
  return out;
}

// In production we use the __Host- prefix, which browsers only accept when the
// cookie is Secure, has Path=/ and no Domain — so a subdomain can never
// overwrite it.
export function cookieName(base, secure) {
  return secure ? `__Host-${base}` : base;
}

export function setCookie(res, name, value, { secure, maxAgeSeconds, sameSite = 'Lax' } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', `SameSite=${sameSite}`];
  if (secure) parts.push('Secure');
  if (maxAgeSeconds !== undefined) parts.push(`Max-Age=${maxAgeSeconds}`);
  res.append('Set-Cookie', parts.join('; '));
}

export function clearCookie(res, name, { secure } = {}) {
  setCookie(res, name, '', { secure, maxAgeSeconds: 0 });
}
