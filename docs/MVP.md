# Moonshots Community — MVP product brief

## Vision

Give the audience around [moonshots.com](https://moonshots.com/) a trusted place to find each other and turn inspiration
into collaboration. The community connects people along two axes:

- **Place** — local hubs (city chapters) for meetups and local ecosystems.
- **Purpose** — interest circles for the moonshot domains (AI, longevity, space, energy, biotech, robotics…).

On top of both sits a **role layer**, so an investor, a founder and an engineer each get a different, relevant
experience.

## Member types

| Type | What they want from the community |
| --- | --- |
| Founder / Entrepreneur | Investors, co-founders, early hires, mentors, customers |
| Investor | Qualified deal flow, co-investors, domain experts for diligence |
| Builder / Engineer | Founders to join or co-found with, peers, interesting problems |
| Researcher / Scientist | Commercialisation partners, funding, collaborators |
| Mentor / Advisor | Founders and early-career people to help |
| Operator / Executive | Startups to join or advise |
| Corporate / Partner | Startups to pilot with or invest in, research partnerships |
| Policy & Impact | Researchers and founders working on public-good problems |
| Creator / Storyteller | Stories and people to feature |
| Student / Early career | Mentors, internships, a way in |

Members also choose who they **want to meet** (e.g. a founder seeking investors + builders). This drives suggestions.

## What the MVP includes

| Area | Features |
| --- | --- |
| Onboarding | Sign up with role + city, code-of-conduct acceptance, guided profile completion |
| Profiles | Headline, bio, interests, "looking for", who I want to meet, link, verified badge |
| Discovery | Member directory filtered by role, interest, city/country and keyword |
| Matching | Explainable suggestions ("Both into Energy", "Also in Sydney", "Matches who you are looking for") |
| Hubs | 15 local hubs + 15 interest circles; join/leave; posts typed as Discussion / Ask / Offer; comments |
| Events | Host meetups and online sessions in a hub; RSVP going/interested; capacity; attendee list; per-event time zone; add to calendar; online links only for attendees |
| Mobile | Installable to the home screen (manifest, icons, full-screen mode) |
| Connections | Request with a mandatory personal note → accept/decline; declines are silent |
| Messaging | 1:1 messages, only between accepted connections |
| Safety | Block, report (profiles, posts, comments, messages), moderation queue, suspend, hide content, verify identity |
| Account | 2FA (TOTP), password change, sign out everywhere, privacy controls, permanent account deletion |
| Admin | Stats overview, report queue, member management, role management, open new hubs, audit log |

## Core loops

1. **Join → complete profile → get suggestions → connect.** The dashboard nudges until the profile has a city,
   interests, headline and bio, because those drive matching quality.
2. **Join hubs → post an Ask or Offer → comments → connections.** Asks/Offers turn passive members into
   participants and create natural reasons to connect.
3. **Local events.** Event posts in city hubs are the bridge from online to in-person — historically the strongest
   retention driver for communities like this.

## Trust & safety principles

- **Consent before contact.** No one can message you unless you accepted their request. Every request carries a
  personal note, and daily caps (3/day for brand-new accounts, 10/day after) prevent mass outreach — the #1 complaint
  of investors on open networks.
- **Minimum necessary data.** Emails are never displayed. Location is city-level only. Members can hide from the
  directory, and restrict their full profile to connections only.
- **Graceful "no".** Declines look like "awaiting response" to the sender. Blocking is invisible to the blocked person
  and makes each side disappear for the other.
- **Scam resistance.** Verified badges (manually checked by moderators) for investors and prominent members, explicit
  "never pay to pitch" guidance, and a dedicated *Scam / suspicious investment* report reason.
- **Human moderation with an audit trail.** Every moderation action is logged.

## Success metrics for the pilot

- Activation: % of signups who complete profile (city + ≥2 interests) within 24h — target 60%.
- Connection rate: accepted connections per active member per month — target ≥2.
- Acceptance rate of requests — a quality signal for notes and matching; target ≥50%.
- Hub participation: % of weekly actives who post or comment — target 20%.
- Safety: reports per 1,000 messages, and median time-to-resolution (< 24h).

## Roadmap after the MVP

**Phase 2 — growth & engagement**
- Email verification, password reset, and email/push notifications (digests of new requests, hub activity).
- Event reminders and notifications; hub organisers (community leaders per city); recurring events.
- Sign in with LinkedIn / Google, and LinkedIn-assisted verification.
- Image avatars (with upload scanning), rich text posts.

**Phase 3 — deeper value for investors & founders**
- Founder "venture profiles" (stage, sector, raise) and investor theses — structured matching.
- Warm-intro requests via a mutual connection, and investor office hours.
- Private deal rooms with NDA acceptance and view logging.
- AI-assisted matching and summarisation of hub discussions.
- Mobile apps; passkeys; paid tiers / membership for premium features.

**Scaling the platform**
- PostgreSQL, Redis-backed rate limiting and sessions, background jobs, object storage.
- Automated spam/abuse classifiers to pre-sort the moderation queue.
- Data export (GDPR/Privacy Act access requests), formal privacy policy and terms, SOC 2 readiness.
