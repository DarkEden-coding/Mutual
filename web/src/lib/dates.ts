/** Re-exports of date-key helpers plus small UI formatting helpers. */
export { addDays, parseDateKey, toDateKey, weekdayIndex, todayKey } from './tz';

/** Any Monday; used to render localized weekday names. */
export const REFERENCE_DAY_FIX = '2024-01-01';

export const WEEKDAY_NAMES_LONG = (locale?: string): string[] => {
  const f = new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' });
  return Array.from({ length: 7 }, (_, i) => f.format(new Date(Date.UTC(2024, 0, 1 + i))));
};

export const WEEKDAY_NAMES_SHORT = (locale?: string): string[] => {
  const f = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' });
  return Array.from({ length: 7 }, (_, i) => f.format(new Date(Date.UTC(2024, 0, 1 + i))));
};

export function formatHourOption(minute: number, locale?: string): string {
  if (minute >= 1440) return locale?.startsWith('en') || !locale ? '12:00 AM (midnight)' : '24:00';
  return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(
    new Date(Date.UTC(1970, 0, 1, 0, minute)),
  );
}

export function formatRelative(ms: number, now = Date.now()): string {
  const diff = Math.max(0, now - ms);
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} day${d === 1 ? '' : 's'} ago`;
  return new Date(ms).toLocaleDateString();
}
