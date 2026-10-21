/** Event keep-alive rules. Mirrors server/src/model.ts so the create form can preview the date. */

export const MAX_KEEP_MONTHS = 6;
/** The event page offers a one-month extension once deletion is this close. */
export const EXTEND_WINDOW_DAYS = 10;

const DAY = 86_400_000;

/** UTC midnight of `day` (YYYY-MM-DD) plus whole months, clamped to the end of shorter months. */
function addMonths(day: string, months: number): Date {
  const [y, m, d] = day.split('-').map(Number);
  const length = new Date(Date.UTC(y, m - 1 + months + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + months, Math.min(d, length)));
}

/** End of the day `months` after the last date, counted from today when there is no later date. */
export function expiryFor(dates: string[], months: number, now = Date.now()): Date {
  const today = new Date(now).toISOString().slice(0, 10);
  const last = dates.reduce((a, b) => (a > b ? a : b), today);
  return new Date(addMonths(last, months).getTime() + DAY);
}

/** Where the deletion date would land after one more extension. */
export const extendedExpiry = (expiresAt: string): Date => addMonths(expiresAt.slice(0, 10), 1);

export const canExtend = (expiresAt: string, now = Date.now()): boolean =>
  Date.parse(expiresAt) - now <= EXTEND_WINDOW_DAYS * DAY;

/** "6 days" / "1 day" / "5 hours": time remaining, rounded up so it never reads as zero early. */
export function timeLeft(expiresAt: string, now = Date.now()): { value: number; unit: string } {
  const ms = Math.max(0, Date.parse(expiresAt) - now);
  if (ms > DAY) {
    const days = Math.ceil(ms / DAY);
    return { value: days, unit: days === 1 ? 'day' : 'days' };
  }
  const hours = Math.max(1, Math.ceil(ms / 3_600_000));
  return { value: hours, unit: hours === 1 ? 'hour' : 'hours' };
}

/** Deletion happens at a fixed instant, so it is shown in the viewer's own timezone. */
export const formatExpiryDate = (d: Date | string, withTime = false, locale?: string): string =>
  new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    ...(withTime ? { hour: 'numeric', minute: '2-digit' } : {}),
  }).format(new Date(d));
