import { html } from './html.js';
import { memberTypeLabel } from '../taxonomy.js';
import { BRAND } from '../brand.js';

// Flash messages are looked up from this fixed table by key, so nothing a user
// controls is ever reflected back through a flash.
export const FLASH = {
  welcome: 'Your account is active — welcome aboard! Finish your profile so the right people can find you.',
  'signed-in': 'Signed in.',
  'signed-out': 'You have been signed out.',
  'profile-saved': 'Profile saved.',
  'request-sent': 'Connection request sent.',
  'request-accepted': 'Connection accepted — you can now message each other.',
  'request-declined': 'Request declined. They will not be notified.',
  'connection-removed': 'Connection removed.',
  blocked: 'Member blocked. They can no longer see you, contact you or connect with you.',
  unblocked: 'Member unblocked.',
  'hub-joined': 'You joined the hub.',
  'hub-left': 'You left the hub.',
  'post-created': 'Posted.',
  'post-deleted': 'Post deleted.',
  'comment-added': 'Comment added.',
  reported: 'Thanks — a moderator will review your report. Reports are confidential.',
  'password-changed': 'Password changed. All other sessions were signed out.',
  'password-reset': 'Your password has been reset. Sign in with your new password.',
  'sessions-revoked': 'All other sessions were signed out.',
  '2fa-enabled': 'Two-factor authentication is on.',
  '2fa-disabled': 'Two-factor authentication is off.',
  'account-deleted': 'Your account and all of its data have been deleted.',
  'report-resolved': 'Report resolved.',
  'user-updated': 'Member updated.',
  'hub-created': 'Hub created.',
  'event-created': "Your event is live. You're down as going.",
  'event-cancelled': 'Event cancelled.',
  'event-full': 'Sorry — that event just filled up.',
  'rsvp-going': "You're going! Add it to your calendar below.",
  'rsvp-updated': 'RSVP updated.',
};

export function csrfField(req) {
  return html`<input type="hidden" name="_csrf" value="${req.csrfToken}">`;
}

export function avatar(name, size = '') {
  const initials = String(name)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
  let hue = 0;
  for (const ch of String(name)) hue = (hue * 31 + ch.codePointAt(0)) % 360;
  // Only the computed hue class is used — no user input reaches the attribute.
  return html`<span class="avatar ${size} hue-${Math.floor(hue / 30)}" aria-hidden="true">${initials || '?'}</span>`;
}

export function badges(m) {
  return html`<span class="badge type-${m.member_type}">${memberTypeLabel(m.member_type)}</span>
    ${m.verified ? html`<span class="badge verified" title="Identity verified by the moderation team">✓ Verified</span>` : ''}
    ${m.member_type === 'investor' && m.open_to_intros ? html`<span class="badge soft">Open to intros</span>` : ''}`;
}

export function memberCard(m, extra = '') {
  const place = [m.city, m.country].filter(Boolean).join(', ');
  return html`<article class="card member-card">
    <a class="member-link" href="/members/${m.id}">${avatar(m.display_name)}
      <span><strong>${m.display_name}</strong><small>${m.headline || ' '}</small></span></a>
    <div class="badges">${badges(m)}</div>
    ${place ? html`<p class="muted">📍 ${place}</p>` : ''}
    ${extra}
  </article>`;
}

export function layout(req, { title, body, wide = false }) {
  const u = req.user;
  const flash = req.flash && FLASH[req.flash];
  const staff = u && (u.role === 'admin' || u.role === 'moderator');
  return html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="referrer" content="strict-origin-when-cross-origin">
<title>${title ? `${title} · ` : ''}${BRAND.name}</title>
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#000000">
<link rel="icon" href="/static/logo.svg" type="image/svg+xml">
<link rel="icon" href="/static/icons/icon-192.png" type="image/png" sizes="192x192">
<link rel="apple-touch-icon" href="/static/icons/apple-touch-icon.png">
<link rel="manifest" href="/manifest.webmanifest" crossorigin="use-credentials">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black">
<meta name="apple-mobile-web-app-title" content="${BRAND.shortName}">
<link rel="stylesheet" href="/static/styles.css">
</head>
<body>
<header class="topbar">
  <a class="brand" href="/" aria-label="${BRAND.name} home"><span>${BRAND.shortName}</span><span class="slash" aria-hidden="true">/</span><span class="sub">Community</span></a>
  <nav>
    ${u
      ? html`<a href="/hubs">Hubs</a><a href="/events">Events</a><a href="/members">Members</a><a href="/connections">Connections</a>
        <a href="/messages">Messages${req.unread ? html` <span class="count">${req.unread}</span>` : ''}</a>
        ${staff ? html`<a href="/admin">Moderation</a>` : ''}
        <details class="menu"><summary>${avatar(u.displayName, 'sm')}</summary>
          <div class="menu-body">
            <a href="/members/${u.id}">My profile</a><a href="/profile/edit">Edit profile</a><a href="/settings">Security &amp; settings</a>
            <a href="/code-of-conduct">Code of conduct</a>
            ${req.app.locals.config?.demo ? html`<a href="/explore">Switch demo member</a>` : ''}
            <form method="post" action="/logout">${csrfField(req)}<button class="linklike">Sign out</button></form>
          </div></details>`
      : req.app.locals.config?.demo
        ? html`<a href="/code-of-conduct">Code of conduct</a><a class="btn small" href="/explore">Explore the demo</a>`
        : html`<a href="/code-of-conduct">Code of conduct</a><a href="/login">Sign in</a><a class="btn small" href="/signup">Join</a>`}
  </nav>
</header>
${req.app.locals.config?.demo
  ? html`<div class="demo-banner" role="note"><strong>Demo site.</strong> Explore as any sample member. Everyone shares the same demo data, and it resets regularly, so don't enter anything real.</div>`
  : ''}
<main class="${wide ? 'wide' : ''}">
  ${flash ? html`<div class="flash" role="status">${flash}</div>` : ''}
  ${body}
</main>
<footer class="footer">
  <p>A private, members-only community for the <a href="${BRAND.parentUrl}" rel="noopener noreferrer">Moonshots</a> audience ·
  <a href="/code-of-conduct">Code of conduct</a>${BRAND.supportEmail ? html` · <a href="mailto:${BRAND.supportEmail}">Contact</a>` : ''}</p>
  <p class="small">Never share passwords, or send money to someone you met here without doing your own due diligence.</p>
</footer>
</body>
</html>`;
}

export function errorList(errors) {
  if (!errors?.length) return '';
  return html`<div class="errors" role="alert"><ul>${errors.map((e) => html`<li>${e}</li>`)}</ul></div>`;
}
