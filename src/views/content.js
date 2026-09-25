import { html } from './html.js';
import { MEMBER_TYPES } from '../taxonomy.js';

export function landing() {
  return html`<section class="hero">
    <h1>Find your moonshot people.</h1>
    <p class="lead">A trusted community for the Moonshots audience — connecting founders, investors, builders, researchers
      and mentors by <strong>where they are</strong> and <strong>what they're working on</strong>.</p>
    <p><a class="btn" href="/signup">Join the community</a> <a class="btn ghost" href="/login">Sign in</a></p>
  </section>
  <section class="grid three">
    <article class="card"><h2>📍 Local hubs</h2><p>City chapters from the Bay Area to Sydney. Meet people nearby, organise meetups and
      share what's happening in your ecosystem.</p></article>
    <article class="card"><h2>🧭 Interest circles</h2><p>AI, longevity, space, energy, biotech, robotics and more. Go deep with the people
      building the future of each field.</p></article>
    <article class="card"><h2>🤝 Warm connections</h2><p>Smart suggestions match founders with investors, builders with founders and
      mentors with those starting out — every intro starts with a personal note.</p></article>
  </section>
  <section class="card">
    <h2>Built for everyone in the ecosystem</h2>
    <div class="badges">${MEMBER_TYPES.map((t) => html`<span class="badge type-${t.key}">${t.label}</span>`)}</div>
  </section>
  <section class="card">
    <h2>Safe by design</h2>
    <ul class="ticks">
      <li>Your email is never shown. Location is city-level only.</li>
      <li>Messages only open once both people accept a connection — no cold inbox spam.</li>
      <li>Rate limits on connection requests protect investors and high-profile members.</li>
      <li>Verified badges for identity-checked members, plus one-click block and report.</li>
      <li>Optional two-factor authentication and full account deletion at any time.</li>
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
