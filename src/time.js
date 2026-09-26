import { TIMEZONES } from './taxonomy.js';

// Timezone helpers built on Intl (no date library). Event times are stored as
// UTC milliseconds plus the IANA zone they should be shown in.

function parts(ms, tz) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  return Object.fromEntries(dtf.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
}

// Offset of `tz` from UTC at the given instant, in ms.
function offsetMs(ms, tz) {
  const p = parts(ms, tz);
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(ms / 1000) * 1000;
}

// '2026-10-01' + '18:30' in 'Australia/Sydney' → UTC ms (DST-aware).
export function zonedToUtc(date, time, tz) {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date ?? ''));
  const t = /^(\d{2}):(\d{2})$/.exec(String(time ?? ''));
  if (!d || !t) return null;
  const wall = Date.UTC(+d[1], +d[2] - 1, +d[3], +t[1], +t[2]);
  if (Number.isNaN(wall)) return null;
  let utc = wall - offsetMs(wall, tz);
  utc = wall - offsetMs(utc, tz); // second pass settles DST transitions
  return utc;
}

// UTC ms → { date: 'YYYY-MM-DD', time: 'HH:mm' } in tz (for form defaults).
export function utcToZoned(ms, tz) {
  const p = parts(ms, tz);
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

// A readable zone name: a familiar abbreviation where one exists (AEST, EDT,
// BST…), otherwise the city ("Lagos time") rather than "GMT+1".
function zoneLabel(ms, tz) {
  if (tz === 'UTC') return 'UTC';
  for (const locale of ['en-AU', 'en-US', 'en-GB']) {
    const name = new Intl.DateTimeFormat(locale, { timeZone: tz, timeZoneName: 'short' })
      .formatToParts(new Date(ms)).find((p) => p.type === 'timeZoneName')?.value;
    if (name && !/^(GMT|UTC)/.test(name)) return name;
  }
  const city = TIMEZONES.find(([k]) => k === tz)?.[1].split(/ [/(]/)[0] ?? tz.split('/').pop().replace(/_/g, ' ');
  return `${city} time`;
}

export function formatWhen(startMs, endMs, tz) {
  const day = new Intl.DateTimeFormat('en-AU', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' });
  const time = new Intl.DateTimeFormat('en-AU', { timeZone: tz, hour: 'numeric', minute: '2-digit' });
  return `${day.format(startMs)} · ${time.format(startMs)} – ${time.format(endMs)} ${zoneLabel(startMs, tz)}`;
}

// { dow: 'THU', day: '1', mon: 'OCT' } for the calendar-style date block.
export function dateBlock(ms, tz) {
  const f = (o) => new Intl.DateTimeFormat('en-US', { timeZone: tz, ...o }).format(ms);
  return { dow: f({ weekday: 'short' }).toUpperCase(), day: f({ day: 'numeric' }), mon: f({ month: 'short' }).toUpperCase() };
}

// 20261001T083000Z (iCalendar / Google Calendar UTC format)
export const icsStamp = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
