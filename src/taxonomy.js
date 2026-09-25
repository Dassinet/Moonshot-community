// Fixed vocabularies. Everything user-selectable is validated against these
// lists, so nothing free-form ends up in filters, joins or CSS classes.

export const MEMBER_TYPES = [
  { key: 'founder', label: 'Founder / Entrepreneur' },
  { key: 'investor', label: 'Investor' },
  { key: 'builder', label: 'Builder / Engineer' },
  { key: 'researcher', label: 'Researcher / Scientist' },
  { key: 'mentor', label: 'Mentor / Advisor' },
  { key: 'operator', label: 'Operator / Executive' },
  { key: 'partner', label: 'Corporate / Partner' },
  { key: 'policy', label: 'Policy & Impact' },
  { key: 'creator', label: 'Creator / Storyteller' },
  { key: 'student', label: 'Student / Early career' },
];

export const MEMBER_TYPE_KEYS = MEMBER_TYPES.map((t) => t.key);

export function memberTypeLabel(key) {
  return MEMBER_TYPES.find((t) => t.key === key)?.label ?? 'Member';
}

// Who each type usually wants to meet. Used for suggestions when a member has
// not said explicitly who they are looking for.
export const COMPLEMENTS = {
  founder: ['investor', 'builder', 'mentor', 'operator'],
  investor: ['founder', 'investor', 'researcher'],
  builder: ['founder', 'builder', 'researcher'],
  researcher: ['founder', 'investor', 'builder'],
  mentor: ['founder', 'student'],
  operator: ['founder', 'investor'],
  partner: ['founder', 'researcher', 'investor'],
  policy: ['researcher', 'founder', 'partner'],
  creator: ['founder', 'researcher'],
  student: ['mentor', 'founder', 'researcher'],
};

export const INTERESTS = [
  ['ai', 'AI & Exponential Tech'],
  ['longevity', 'Longevity & Health'],
  ['space', 'Space'],
  ['energy', 'Energy'],
  ['climate', 'Climate & Environment'],
  ['robotics', 'Robotics & Automation'],
  ['biotech', 'Biotech'],
  ['quantum', 'Quantum Computing'],
  ['bci', 'Brain-Computer Interfaces'],
  ['education', 'Future of Education'],
  ['work', 'Future of Work'],
  ['food-water', 'Food & Water Abundance'],
  ['mobility', 'Mobility & Transport'],
  ['digital-assets', 'Digital Assets'],
  ['philanthropy', 'Abundance & Philanthropy'],
];

export const REGION_HUBS = [
  ['global-online', 'Global / Online', 'For members anywhere in the world. Virtual meetups and async discussion.'],
  ['sf-bay-area', 'San Francisco Bay Area', 'Founders, investors and builders across SF, the Peninsula and the East Bay.'],
  ['new-york', 'New York', 'The New York moonshot community.'],
  ['los-angeles', 'Los Angeles', 'Space, media, health and deep tech in LA.'],
  ['austin', 'Austin', 'The Austin and Texas moonshot community.'],
  ['toronto', 'Toronto', 'Toronto and the wider Canadian ecosystem.'],
  ['london', 'London', 'London and the UK.'],
  ['berlin', 'Berlin', 'Berlin and continental Europe.'],
  ['dubai', 'Dubai', 'Dubai, Abu Dhabi and the Gulf.'],
  ['bangalore', 'Bangalore', 'Bangalore and the Indian ecosystem.'],
  ['singapore', 'Singapore', 'Singapore and South-East Asia.'],
  ['sydney', 'Sydney', 'Sydney and NSW.'],
  ['melbourne', 'Melbourne', 'Melbourne and Victoria.'],
  ['sao-paulo', 'São Paulo', 'São Paulo and Latin America.'],
  ['lagos', 'Lagos', 'Lagos and the African ecosystem.'],
];

export const POST_KINDS = [
  { key: 'discussion', label: 'Discussion' },
  { key: 'ask', label: 'Ask (I need…)' },
  { key: 'offer', label: 'Offer (I can help with…)' },
  { key: 'event', label: 'Event / Meetup' },
];
export const POST_KIND_KEYS = POST_KINDS.map((k) => k.key);

export const REPORT_REASONS = [
  { key: 'spam', label: 'Spam or unsolicited promotion' },
  { key: 'scam', label: 'Scam, fraud or suspicious investment offer' },
  { key: 'impersonation', label: 'Impersonation / fake identity' },
  { key: 'harassment', label: 'Harassment or hate' },
  { key: 'privacy', label: 'Sharing private information' },
  { key: 'other', label: 'Something else' },
];
export const REPORT_REASON_KEYS = REPORT_REASONS.map((r) => r.key);
