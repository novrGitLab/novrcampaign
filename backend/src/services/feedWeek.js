import { addDays } from 'date-fns';

// Feed week window: Monday 00:00:00 – Sunday 23:59:59.999 in Africa/Lagos.
//
// Nigeria is UTC+1 year-round (no DST), so we can bucket reliably by shifting
// the instant by a fixed +1h and reading its UTC date parts. This is the single
// canonical definition; frontend/src/lib/feedWeek.js is a deliberate mirror and
// both are pinned by tests so they cannot drift.

const LAGOS_OFFSET_MS = 60 * 60 * 1000; // UTC+1, no DST
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// The Lagos-local calendar date of `date`, as a UTC-midnight Date used purely
// for arithmetic and formatting.
function lagosDateOnly(date) {
  const d = new Date(date.getTime() + LAGOS_OFFSET_MS);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

// Monday of the week containing `date` (Lagos-local), as a UTC-midnight Date
// representing that calendar day.
export function mondayOf(date) {
  const day = lagosDateOnly(date);
  const dow = day.getUTCDay(); // 0 = Sunday
  const back = (dow + 6) % 7; // Sunday -> 6, Monday -> 0
  return addDays(day, -back);
}

// { start, end } as real UTC instants for the Lagos-local week containing
// `date`. start = Monday 00:00:00.000 Lagos; end = Sunday 23:59:59.999 Lagos.
export function weekRange(date) {
  const monday = mondayOf(date);
  const start = new Date(monday.getTime() - LAGOS_OFFSET_MS);
  const endExclusive = new Date(monday.getTime() + 7 * MS_PER_DAY - LAGOS_OFFSET_MS);
  const end = new Date(endExclusive.getTime() - 1);
  return { start, end };
}

// Date-range label, e.g. "10 – 16 Nov 2026". Uses the Lagos-local Monday.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function weekLabel(date) {
  const monday = mondayOf(date); // UTC-midnight representing the local Mon
  const sunday = addDays(monday, 6);
  const month = MONTHS[sunday.getUTCMonth()];
  const year = sunday.getUTCFullYear();
  return `${monday.getUTCDate()} – ${sunday.getUTCDate()} ${month} ${year}`;
}

export function parseWeekStart(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
