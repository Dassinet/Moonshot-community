import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import { cookieName, setCookie } from './cookies.js';

// CSRF protection, three layers:
//  1. SameSite=Lax cookies (browsers won't send them on cross-site POSTs).
//  2. Origin / Sec-Fetch-Site check on every state-changing request.
//  3. A per-browser secret cookie plus an HMAC-derived token that must be
//     echoed back in every form (`_csrf` hidden field).

export function csrfMiddleware(config) {
  const name = cookieName('mc_csrf', config.secure);
  const tokenFor = (secret) => createHmac('sha256', config.secret).update(`csrf:${secret}`).digest('base64url');

  return (req, res, next) => {
    let secret = req.cookies[name];
    if (!secret || secret.length < 32) {
      secret = randomBytes(32).toString('base64url');
      setCookie(res, name, secret, { secure: config.secure });
    }
    req.csrfToken = tokenFor(secret);
    // Rotate on login / logout so a token captured before auth is useless after.
    req.rotateCsrf = () => {
      const fresh = randomBytes(32).toString('base64url');
      setCookie(res, name, fresh, { secure: config.secure });
      req.csrfToken = tokenFor(fresh);
    };

    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();

    if (!sameOrigin(req)) return res.status(403).type('text').send('Cross-site request blocked.');

    const sent = typeof req.body?._csrf === 'string' ? req.body._csrf : '';
    const expected = req.csrfToken;
    if (sent.length !== expected.length || !timingSafeEqual(Buffer.from(sent), Buffer.from(expected))) {
      return res.status(403).type('text').send('Your form expired. Go back, refresh the page and try again.');
    }
    next();
  };
}

function sameOrigin(req) {
  const site = req.get('sec-fetch-site');
  if (site && !['same-origin', 'none'].includes(site)) return false;
  const origin = req.get('origin');
  if (origin && origin !== 'null') {
    try {
      return new URL(origin).host === req.get('host');
    } catch {
      return false;
    }
  }
  return true;
}
