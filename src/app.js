import express from 'express';
import helmet from 'helmet';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openDb, storedSecret } from './db.js';
import { createMailer } from './mailer.js';
import { BRAND } from './brand.js';
import { parseCookies, setCookie, clearCookie } from './security/cookies.js';
import { sessionMiddleware } from './security/sessions.js';
import { csrfMiddleware } from './security/csrf.js';
import { RateLimiter, limit } from './security/rateLimit.js';
import { layout, FLASH } from './views/layout.js';
import { html } from './views/html.js';
import gateRoutes, { gateMiddleware } from './gate.js';
import exploreRoutes from './routes/explore.js';
import authRoutes from './routes/auth.js';
import homeRoutes from './routes/home.js';
import profileRoutes from './routes/profile.js';
import memberRoutes from './routes/members.js';
import connectionRoutes from './routes/connections.js';
import messageRoutes from './routes/messages.js';
import hubRoutes from './routes/hubs.js';
import eventRoutes from './routes/events.js';
import reportRoutes from './routes/reports.js';
import settingsRoutes from './routes/settings.js';
import adminRoutes from './routes/admin.js';

export function loadConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const demo = env.DEMO_MODE === 'true';
  // Without SESSION_SECRET, bootstrap() uses a secret stored in the database
  // (shared by all instances) when the database is persistent.
  const secretFromEnv = !!env.SESSION_SECRET && env.SESSION_SECRET.length >= 32;
  const secret = secretFromEnv ? env.SESSION_SECRET : randomBytes(32).toString('hex');
  return {
    production,
    secret,
    secretFromEnv,
    // Secure cookies whenever we're served over HTTPS (always in production).
    secure: production || env.COOKIE_SECURE === 'true',
    dbPath: env.DATABASE_PATH ?? (production ? './data/community.db' : './data/dev.db'),
    // Hosted database (Turso). When set, it's used instead of the local file.
    dbUrl: env.TURSO_DATABASE_URL || env.LIBSQL_URL || '',
    dbToken: env.TURSO_AUTH_TOKEN || env.LIBSQL_AUTH_TOKEN || '',
    trustProxy: env.TRUST_PROXY ?? (production ? '1' : 'false'),
    // Demo deployments show a banner, are auto-seeded with sample data, and let
    // visitors explore as a sample member instead of signing up or logging in.
    demo,
    appUrl: appUrl(env),
    mail: { resendApiKey: env.RESEND_API_KEY, from: env.MAIL_FROM },
    // Optional shared password for the whole site. Empty = public.
    sitePassword: env.SITE_PASSWORD ?? '',
  };
}

// The public base URL used in emailed links. It comes only from configuration —
// never from the request's Host header, which an attacker controls (that would
// let them send victims password-reset links pointing at their own server).
function appUrl(env) {
  const raw = env.APP_URL || (env.VERCEL_PROJECT_PRODUCTION_URL && `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`);
  if (raw) return raw.replace(/\/+$/, '');
  return `http://localhost:${env.PORT || 3000}`;
}

// Opens the configured database and finalises config. Use this, then createApp.
export async function bootstrap(env = process.env) {
  const config = loadConfig(env);
  const db = await openDb(config.dbUrl ? { url: config.dbUrl, authToken: config.dbToken } : { path: config.dbPath });
  if (!config.secretFromEnv) {
    if (db.persistent) config.secret = await storedSecret(db);
    else if (config.production && !config.demo) {
      throw new Error('SESSION_SECRET must be set to at least 32 random characters in production.');
    }
  }
  return { config, db };
}

export function createApp(config, db) {
  if (!db) throw new Error('createApp needs a database — use bootstrap() first.');
  const app = express();
  app.locals.db = db;
  app.locals.config = config;
  app.locals.mailer = config.mailer ?? createMailer(config);
  // Email is optional. Without it, new accounts are active immediately and
  // password reset is handled by moderators.
  app.locals.emailEnabled = config.emailEnabled ?? !!(config.mailer || config.mail?.resendApiKey);
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
  app.get('/robots.txt', async (req, res) => res.type('text').send('User-agent: *\nDisallow: /\n'));
  app.use(async (req, res, next) => {
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

  app.use(async (req, res, next) => {
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
  app.use(gateMiddleware(config));
  app.use(gateRoutes);

  // Web app manifest for "Add to Home Screen". Served after the private gate
  // (the page links it with crossorigin="use-credentials" so the pass cookie
  // is sent), so the app name isn't exposed to people without access.
  app.get('/manifest.webmanifest', async (req, res) => {
    res.type('application/manifest+json').set('Cache-Control', 'no-cache').send(
      JSON.stringify({
        name: BRAND.name,
        short_name: BRAND.shortName,
        description: BRAND.tagline,
        id: '/',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#000000',
        theme_color: '#000000',
        icons: [
          { src: '/static/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/static/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/static/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      }),
    );
  });
  app.use(exploreRoutes);

  const UNREAD = `SELECT COUNT(*) AS n FROM messages m
      WHERE m.recipient_id = ? AND m.read_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM blocks b WHERE b.blocker_id = m.recipient_id AND b.blocked_id = m.sender_id)`;
  app.use(async (req, res, next) => {
    if (req.user) req.unread = (await db.get(UNREAD, req.user.id)).n;
    next();
  });

  app.use(authRoutes);
  app.use(homeRoutes);
  app.use(profileRoutes);
  app.use(memberRoutes);
  app.use(connectionRoutes);
  app.use(messageRoutes);
  app.use(hubRoutes);
  app.use(eventRoutes);
  app.use(reportRoutes);
  app.use(settingsRoutes);
  app.use(adminRoutes);

  app.use(async (req, res) => {
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
