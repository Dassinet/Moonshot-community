import { html } from './html.js';
import { MEMBER_TYPES } from '../taxonomy.js';

export function landing() {
  return html`<section class="hero center">
    <p class="eyebrow">Private · Members-only community</p>
    <h1>Where moonshot thinkers<br><span class="glow">find each other.</span></h1>
    <p class="lead">A members-only network for the Moonshots audience, connecting founders, investors, builders,
      researchers and mentors by <strong>where they are</strong> and <strong>what they're building</strong>.</p>
    <div class="hero-actions"><a class="btn" href="/signup">Join the community</a> <a class="btn ghost" href="/login">Member sign in</a></div>
    <div class="pill-row"><span>🤖 AI</span><span>🧬 Longevity</span><span>🛰️ Space</span><span>⚡ Energy</span><span>🌍 Climate</span><span>🦾 Robotics</span><span>+ more</span></div>
  </section>
  <section class="grid three">
    <article class="card feature"><span class="icon">📍</span><h2>Local hubs</h2><p>City chapters from the Bay Area to Sydney. Meet the
      people building the future near you, and turn online conversations into meetups.</p></article>
    <article class="card feature"><span class="icon">🧭</span><h2>Interest circles</h2><p>Go deep on AI, longevity, space, energy, biotech,
      robotics and more, with people who are actually working on them.</p></article>
    <article class="card feature"><span class="icon">🤝</span><h2>Warm introductions</h2><p>Smart matching pairs founders with investors,
      builders with founders and mentors with rising talent. Every intro starts with a personal note.</p></article>
  </section>
  <section class="card">
    <h2>Built for everyone in the ecosystem</h2>
    <div class="badges">${MEMBER_TYPES.map((t) => html`<span class="badge type-${t.key}">${t.label}</span>`)}</div>
  </section>
  <section class="card">
    <h2>Private and safe by design</h2>
    <ul class="ticks">
      <li>Members only: every account is activated by email, and nothing is visible to the public or search engines.</li>
      <li>Your email is never shown. Location is city-level only.</li>
      <li>Messages only open once both people accept a connection, so there's no cold-inbox spam.</li>
      <li>Outreach limits protect investors and high-profile members.</li>
      <li>Verified badges, one-click block and report, optional two-factor sign-in, and full account deletion.</li>
    </ul>
  </section>`;
}

export function codeOfConduct() {
  return html`<section class="card prose">
    <h1>Code of conduct</h1>
    <p>This community exists to help people working on humanity's biggest challenges find each other. Everyone agrees to the
      following when they join.</p>
    <h2>Be generous and respectful</h2>
    <ul>
      <li>Treat every member with respect, regardless of background, identity, role or seniority.</li>
      <li>No harassment, hate speech, threats or sexual content.</li>
      <li>Disagree with ideas, not people.</li>
    </ul>
    <h2>Connect with intent</h2>
    <ul>
      <li>Every connection request needs a genuine, personal note. Mass or copy-paste outreach is not allowed.</li>
      <li>No unsolicited pitching in messages. Use <em>Ask</em> posts in hubs, or wait until someone accepts your request.</li>
      <li>Respect "no" — and silence. Don't re-contact someone who declined or blocked you through other channels.</li>
    </ul>
    <h2>Protect people and money</h2>
    <ul>
      <li>Never share someone else's private information (contact details, decks, data room contents) without permission.</li>
      <li>Never ask members for passwords, seed phrases, or payments. Legitimate investors will never ask you to pay to pitch.</li>
      <li>Do your own due diligence. Nothing here is investment advice, and verified badges confirm identity, not investment quality.</li>
      <li>No impersonation. Represent yourself and your affiliations honestly.</li>
    </ul>
    <h2>Enforcement</h2>
    <p>Moderators review every report. Depending on severity we may remove content, restrict features, or suspend accounts.
      Report anything that feels wrong using the <strong>Report</strong> link found on every profile, post, comment and message —
      reports are confidential.</p>
  </section>`;
}
