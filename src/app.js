import express from 'express';
import helmet from 'helmet';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { createMailer } from './mailer.js';
import { parseCookies, setCookie, clearCookie } from './security/cookies.js';
import { sessionMiddleware } from './security/sessions.js';
import { csrfMiddleware } from './security/csrf.js';
import { RateLimiter, limit } from './security/rateLimit.js';
import { layout, FLASH } from './views/layout.js';
import { html } from './views/html.js';
import authRoutes from './routes/auth.js';
import homeRoutes from './routes/home.js';
import profileRoutes from './routes/profile.js';
import memberRoutes from './routes/members.js';
import connectionRoutes from './routes/connections.js';
import messageRoutes from './routes/messages.js';
import hubRoutes from './routes/hubs.js';
import reportRoutes from './routes/reports.js';
import settingsRoutes from './routes/settings.js';
import adminRoutes from './routes/admin.js';

export function loadConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  let secret = env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    if (production) throw new Error('SESSION_SECRET must be set to at least 32 random characters in production.');
    secret = randomBytes(32).toString('hex');
  }
  return {
    production,
    secret,
    // Secure cookies whenever we're served over HTTPS (always in production).
    secure: production || env.COOKIE_SECURE === 'true',
    dbPath: env.DATABASE_PATH ?? (production ? './data/community.db' : './data/dev.db'),
    trustProxy: env.TRUST_PROXY ?? (production ? '1' : 'false'),
    // Demo deployments show a banner and are auto-seeded with sample data.
    demo: env.DEMO_MODE === 'true',
    appUrl: appUrl(env, production),
    mail: { resendApiKey: env.RESEND_API_KEY, from: env.MAIL_FROM },
  };
}

// The public base URL used in emailed links. It comes only from configuration —
// never from the request's Host header, which an attacker controls (that would
// let them send victims password-reset links pointing at their own server).
function appUrl(env, production) {
  const raw = env.APP_URL || (env.VERCEL_PROJECT_PRODUCTION_URL && `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`);
  if (raw) return raw.replace(/\/+$/, '');
  if (production) throw new Error('APP_URL must be set in production (e.g. https://community.example.com).');
  return `http://localhost:${env.PORT || 3000}`;
}

export function createApp(config = loadConfig(), db = openDb(config.dbPath)) {
  const app = express();
  app.locals.db = db;
  app.locals.config = config;
  app.locals.mailer = config.mailer ?? createMailer(config);
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy === 'false' ? false : Number(config.trustProxy) || config.trustProxy);

  // Security headers. No inline scripts or styles anywhere, so the CSP is strict.
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'none'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", 'data:'],
          fontSrc: ["'self'"],
          connectSrc: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
          baseUri: ["'none'"],
          objectSrc: ["'none'"],
          ...(config.production ? { upgradeInsecureRequests: [] } : {}),
        },
      },
      strictTransportSecurity: config.production ? { maxAge: 63072000, includeSubDomains: true } : false,
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      crossOriginEmbedderPolicy: false,
    }),
  );
  // Private community: ask search engines not to index anything.
  app.get('/robots.txt', (req, res) => res.type('text').send('User-agent: *\nDisallow: /\n'));
  app.use((req, res, next) => {
    res.set('X-Robots-Tag', 'noindex, nofollow');
    res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
    next();
  });

  app.use(
    '/static',
    express.static(fileURLToPath(new URL('../public', import.meta.url)), { maxAge: '1h', index: false }),
  );

  // Small bodies only; no file uploads in the MVP (removes a whole class of risk).
  app.use(express.urlencoded({ extended: false, limit: '20kb', parameterLimit: 100 }));

  // Coarse global limiter per IP, plus tighter per-route limits in the routers.
  const globalLimiter = new RateLimiter({ windowMs: 60_000, max: 300 });
  app.use(limit(globalLimiter, (req) => `ip:${req.ip}`));

  app.use((req, res, next) => {
    req.cookies = parseCookies(req.headers.cookie);
    const flashKey = req.cookies.mc_flash;
    if (flashKey) {
      if (FLASH[flashKey]) req.flash = flashKey;
      clearCookie(res, 'mc_flash', config);
    }
    res.flash = (key) => setCookie(res, 'mc_flash', key, { secure: config.secure, maxAgeSeconds: 60 });
    res.page = (opts) => res.type('html').send(layout(req, opts).toString());
    // Pages behind auth must never be cached by shared caches or the back button.
    res.set('Cache-Control', 'no-store');
    next();
  });

  app.use(sessionMiddleware(db, config));
  app.use(csrfMiddleware(config));

  const unread = db.prepare(
    `SELECT COUNT(*) AS n FROM messages m
      WHERE m.recipient_id = ? AND m.read_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM blocks b WHERE b.blocker_id = m.recipient_id AND b.blocked_id = m.sender_id)`,
  );
  app.use((req, res, next) => {
    if (req.user) req.unread = unread.get(req.user.id).n;
    next();
  });

  app.use(authRoutes);
  app.use(homeRoutes);
  app.use(profileRoutes);
  app.use(memberRoutes);
  app.use(connectionRoutes);
  app.use(messageRoutes);
  app.use(hubRoutes);
  app.use(reportRoutes);
  app.use(settingsRoutes);
  app.use(adminRoutes);

  app.use((req, res) => {
    res.status(404).page({
      title: 'Not found',
      body: html`<section class="narrow card"><h1>Not found</h1><p>That page doesn't exist or you don't have access to it.</p><p><a href="/">Go home</a></p></section>`,
    });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.too.large') return res.status(413).type('text').send('Request too large.');
    if (err.type === 'parameters.too.many') return res.status(413).type('text').send('Too many form fields.');
    // Never leak stack traces or internals to the client.
    console.error(err);
    res.status(500).type('text').send('Something went wrong. Please try again.');
  });

  return app;
}
