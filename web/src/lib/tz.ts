/**
 * Timezone primitives built on Intl only (no date library).
 * Everything here is pure and deterministic for a given (instant, IANA zone).
 */

const fmtCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    fmtCache.set(tz, f);
  }
  return f;
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export interface WallTime {
  year: number;
  month: number; // 1-12
  day: number;
  /** minutes since local midnight, 0..1439 */
  minute: number;
}

function wallParts(ms: number, tz: string) {
  const out = { year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0 };
  for (const p of formatterFor(tz).formatToParts(new Date(ms))) {
    switch (p.type) {
      case 'year':
        out.year = Number(p.value);
        break;
      case 'month':
        out.month = Number(p.value);
        break;
      case 'day':
        out.day = Number(p.value);
        break;
      case 'hour':
        out.hour = Number(p.value) % 24;
        break;
      case 'minute':
        out.minute = Number(p.value);
        break;
      case 'second':
        out.second = Number(p.value);
        break;
    }
  }
  return out;
}

/** Offset (zone wall clock minus UTC) in ms at the given instant. */
export function tzOffsetMs(ms: number, tz: string): number {
  const whole = Math.floor(ms / 1000) * 1000;
  const p = wallParts(whole, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - whole;
}

/** Wall-clock reading of an instant in `tz`. */
export function epochToWall(ms: number, tz: string): WallTime {
  const p = wallParts(ms, tz);
  return { year: p.year, month: p.month, day: p.day, minute: p.hour * 60 + p.minute };
}

/**
 * Instant for a wall-clock time in `tz`. `minuteOfDay` may be 1440 (end of day).
 * Ambiguous times (DST fall-back) resolve to the earlier instant; nonexistent
 * times (spring-forward gap) resolve forward by the gap length.
 */
export function wallToEpoch(
  year: number,
  month: number,
  day: number,
  minuteOfDay: number,
  tz: string,
): number {
  const naive = Date.UTC(year, month - 1, day, 0, minuteOfDay);
  const off1 = tzOffsetMs(naive, tz);
  const guess = naive - off1;
  const off2 = tzOffsetMs(guess, tz);
  if (off1 === off2) return guess;
  const guess2 = naive - off2;
  // If the second guess round-trips, use it; otherwise we are inside a gap.
  return tzOffsetMs(guess2, tz) === off2 ? guess2 : Math.max(guess, guess2);
}

// ---- date key helpers ('YYYY-MM-DD') -------------------------------------------------

export function parseDateKey(key: string): { year: number; month: number; day: number } {
  const [y, m, d] = key.split('-').map(Number);
  return { year: y, month: m, day: d };
}

export function toDateKey(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function addDays(key: string, n: number): string {
  const { year, month, day } = parseDateKey(key);
  const d = new Date(Date.UTC(year, month - 1, day + n));
  return toDateKey(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** 0 = Monday ... 6 = Sunday */
export function weekdayIndex(key: string): number {
  const { year, month, day } = parseDateKey(key);
  const dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay(); // 0 = Sunday
  return (dow + 6) % 7;
}

export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** Today's date key in a given timezone. */
export function todayKey(tz: string = browserTimeZone(), now: number = Date.now()): string {
  const w = epochToWall(now, tz);
  return toDateKey(w.year, w.month, w.day);
}

export function listTimeZones(): string[] {
  let zones: string[] = [];
  try {
    const sv = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
    if (sv) zones = sv('timeZone');
  } catch {
    /* fall through */
  }
  if (!zones.includes('UTC')) zones = ['UTC', ...zones];
  const browser = browserTimeZone();
  if (!zones.includes(browser)) zones = [browser, ...zones];
  return zones;
}

/** e.g. "GMT-5", "GMT+5:30" for display in the timezone picker. */
export function offsetLabel(tz: string, now: number = Date.now()): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      timeZoneName: 'shortOffset',
    }).formatToParts(new Date(now));
    return parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
  } catch {
    return '';
  }
}

export function prettyZoneName(tz: string): string {
  return tz.replace(/_/g, ' ').replace(/\//g, ' / ');
}
