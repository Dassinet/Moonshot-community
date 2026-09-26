# Security model

This MVP was built security-first. This document explains the controls in place, how they map to common threats,
and what must be done before a public launch.

## Controls

### Authentication
- Passwords hashed with **scrypt** (memory-hard, per-user salt, parameters stored with the hash so they can be raised
  later). Minimum 12 characters, rejects passwords containing your name/email and a common-password list.
- **Generic login errors** and a dummy hash check for unknown emails, so attackers can't discover who is a member by
  message or timing.
- **Account lockout** for 15 minutes after 5 failed attempts, plus per-IP rate limits on login, signup and 2FA.
- Optional **TOTP two-factor auth** (RFC 6238, works with any authenticator app), with replay protection. The
  password step only issues a short-lived, HMAC-signed "pending" cookie; a session is created only after the code.
- Re-authentication (current password) required to change password, disable 2FA or delete the account.
- **Email activation** (when email is configured): accounts can't sign in (and sessions aren't honoured) until the member confirms
  their address. Activation and **password-reset** links are single-use, stored only as SHA-256 hashes, expire (24h /
  1h), are throttled to 3 per account per hour, and are built only from the configured `APP_URL`, never the request's
  Host header (prevents reset-link poisoning). Opening a link shows a confirm button; nothing changes on a GET, so
  corporate link scanners can't consume or trigger them.
- **No account enumeration**: signup, "resend activation" and "forgot password" respond identically whether or not
  the email exists; the real owner of an already-registered address gets a heads-up email instead.
- A successful reset revokes all sessions and clears lockouts; password changes and resets send an alert email.

### Sessions
- 256-bit random tokens; only their **SHA-256 hash** is stored, so a database leak doesn't leak live sessions.
- Cookies are `HttpOnly`, `SameSite=Lax`, and in production `Secure` with the `__Host-` prefix.
- New session id on every login (no fixation). 14-day absolute expiry.
- Password change, suspension and role changes **revoke all sessions**. "Sign out everywhere" in settings.

### Cross-site attacks
- **XSS**: all HTML is produced by an auto-escaping template tag with no raw-HTML escape hatch. The **CSP** allows
  no scripts at all (`script-src 'none'`) — the app works entirely without client-side JavaScript. Profile links are
  restricted to `http(s)` and rendered with `rel="nofollow noopener noreferrer ugc"`.
- **CSRF**: `SameSite` cookies + Origin/`Sec-Fetch-Site` checks + an HMAC-derived per-browser token on every form.
  Tokens rotate on login and logout.
- **Clickjacking**: `frame-ancestors 'none'` and `X-Frame-Options`.
- Helmet security headers, HSTS in production, strict referrer policy, restrictive `Permissions-Policy`,
  `Cache-Control: no-store` on all pages.

### Data & access control
- **SQL injection**: every query is a prepared statement with bound parameters; `LIKE` wildcards are escaped.
- **Database**: local SQLite or hosted Turso over TLS with a scoped auth token (kept in environment variables, never in
  code). Multi-step changes (profile + interests, block + disconnect, account deletion) run as atomic batches, and
  account deletion removes every related row explicitly rather than relying on foreign-key cascades.
- All user input is normalised (control and bidi-override characters stripped), length-capped and validated against
  fixed enums for roles, interests, post types and report reasons.
- Authorisation checks on every action: only the addressee can accept a request, only connected and unblocked
  members can message, only authors can delete their posts, only staff reach `/admin` (which returns 404 to others),
  moderators can't act on admins or promote themselves.
- Blocked or suspended members are indistinguishable from non-existent ones (404).
- **Private mode** (`SITE_PASSWORD`): until the shared password is entered, every page shows only an unbranded
  screen. Attempts are rate limited per IP, the comparison is constant-time, and the pass is an HMAC-signed HttpOnly
  cookie bound to the current password, so changing it revokes every pass.
- **Demo mode**: visitors explore as shared sample members with no credentials. Anything that could lock other
  visitors out (suspensions, role changes, password/2FA changes, account deletion) is disabled.
- **Private by default**: everything except the landing, sign-up, sign-in and code-of-conduct pages requires an
  activated account; `robots.txt`, `X-Robots-Tag` and a robots meta tag keep the site out of search engines.
- Request bodies limited to 20 KB / 100 fields; no file uploads in the MVP; request/header timeouts against slowloris.
- Full **account deletion** cascades through all of a member's data.
- Security-relevant events (logins, failures, lockouts, 2FA changes, blocks, moderation actions) go to an audit log.

### Abuse prevention
- Mandatory personal note (≥20 chars) on connection requests; 3/day for accounts < 24h old, 10/day after.
- Rate limits on posts, comments, messages and reports; honeypot field on signup.
- Reporting on every profile, post, comment and message; moderators only see the specific reported message.

## Tests

`npm test` runs integration tests for: security headers, cookie flags, CSRF and cross-origin rejection, stored-XSS
escaping, URL validation, generic login errors and lockout, session rotation and revocation, connection-gated
messaging, blocking, outreach caps, profile privacy, staff-only moderation and privilege boundaries, account deletion,
the full 2FA flow (including tampering and replay), and RFC 6238 test vectors.

## Before a public launch

- [ ] Run behind HTTPS (TLS-terminating proxy) with `NODE_ENV=production`, a strong `SESSION_SECRET`, and
      `TRUST_PROXY` set to your proxy hop count.
- [ ] Turn on email (Resend: `RESEND_API_KEY`, `MAIL_FROM`, `APP_URL`, with SPF/DKIM on your domain) so accounts
      are email-verified and members can reset passwords themselves. Without it, anyone can sign up with any address.
- [ ] Move rate limiting to a shared store (Redis) if running more than one instance; add WAF/bot protection.
- [ ] Encrypt TOTP secrets at rest (e.g. KMS envelope encryption) and add 2FA recovery codes.
- [ ] Encrypted, tested database backups; retention policy for audit logs and messages.
- [ ] Dependency scanning (`npm audit`, Dependabot) and a third-party penetration test.
- [ ] Privacy policy, terms of service and a data-subject request process (GDPR / Australian Privacy Act / CCPA).
- [ ] A staffed moderation rota with response-time targets and an escalation path for threats of harm.
