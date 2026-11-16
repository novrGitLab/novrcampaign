import { addDays } from 'date-fns';

// Feed week window: Monday 00:00:00 – Sunday 23:59:59.999 in Africa/Lagos.
//
// This is a deliberate mirror of backend/src/services/feedWeek.js (the backend
// and frontend cannot share a module without a bundling change). Keep the two in
// lockstep — both are pinned by tests. Nigeria is UTC+1 year-round (no DST), so
// we bucket by shifting the instant by a fixed +1h and reading UTC date parts.

const LAGOS_OFFSET_MS = 60 * 60 * 1000; // UTC+1, no DST

function lagosDateOnly(date) {
  const d = new Date(date.getTime() + LAGOS_OFFSET_MS);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

// Monday of the week containing `date` (Lagos-local), as a UTC-midnight Date.
export function mondayOf(date) {
  const day = lagosDateOnly(date);
  const dow = day.getUTCDay(); // 0 = Sunday
  const back = (dow + 6) % 7; // Sunday -> 6, Monday -> 0
  return addDays(day, -back);
}

// Date-range label, e.g. "10 – 16 Nov 2026".
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function weekLabel(date) {
  const monday = mondayOf(date);
  const sunday = addDays(monday, 6);
  const month = MONTHS[sunday.getUTCMonth()];
  const year = sunday.getUTCFullYear();
  return `${monday.getUTCDate()} – ${sunday.getUTCDate()} ${month} ${year}`;
}

// Monday (Lagos-local) of `date` as an ISO string at Lagos-local midnight,
// suitable for the `weekStart` API query param.
export function weekStartIso(date) {
  const monday = mondayOf(date);
  return new Date(monday.getTime() - LAGOS_OFFSET_MS).toISOString();
}

export function addWeeks(date, n) {
  return addDays(date, n * 7);
}
