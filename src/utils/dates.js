// Jojo Market operates in Lagos (WAT, UTC+1, no daylight saving).
const TZ = 'Africa/Lagos';

/** Today's date in Lagos as YYYY-MM-DD. */
export function lagosToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** Current hour (0–23) in Lagos. */
export function lagosHour(now = new Date()) {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }).format(now));
}

/** Add days to a YYYY-MM-DD string. */
export function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday for a YYYY-MM-DD string. */
export const weekday = (isoDate) => new Date(`${isoDate}T00:00:00Z`).getUTCDay();

export const daysBetween = (a, b) => Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86_400_000);

/** mysql2 returns DATE columns as JS Dates at UTC midnight (pool timezone 'Z'); normalise to YYYY-MM-DD. */
export const isoDate = (v) => (v == null ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));

export const hoursFromNow = (h) => new Date(Date.now() + h * 3_600_000);
