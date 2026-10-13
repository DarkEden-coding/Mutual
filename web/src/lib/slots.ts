/**
 * Slot model + timezone projection (SPEC section 2 and "Timezones").
 *
 * Event slots live in the event timezone. A viewer sees them in their own timezone:
 *   - columns = viewer-local days containing at least one slot
 *   - rows    = union of viewer-local times of day
 *   - cells that are not a real slot are -1 (rendered disabled)
 * Weekdays mode projects the CURRENT Monday-to-Sunday week (the week containing "now"
 * in the event timezone), so DST-observing zones convert with today's offsets. A viewer
 * far from the event timezone may get up to 8 columns (e.g. a Sunday column on each end
 * of the week); headers only show weekday names.
 */
import { addDays, epochToWall, parseDateKey, toDateKey, todayKey, wallToEpoch, weekdayIndex } from './tz';

export type EventMode = 'dates' | 'weekdays';

export interface SlotEventShape {
  mode: EventMode;
  dates: string[];
  weekdays: number[];
  startMinute: number;
  endMinute: number;
  slotMinutes: number;
  timezone: string;
}

/** Monday date key of the week containing `now`, as seen in `tz`. */
export function currentWeekMonday(tz: string, now: number = Date.now()): string {
  const today = todayKey(tz, now);
  return addDays(today, -weekdayIndex(today));
}

export function slotsPerDay(e: Pick<SlotEventShape, 'startMinute' | 'endMinute' | 'slotMinutes'>): number {
  return Math.max(0, Math.floor((e.endMinute - e.startMinute) / e.slotMinutes));
}

/** Concrete calendar date key per event "day" (current-week dates for weekdays mode). */
export function dayKeys(
  e: Pick<SlotEventShape, 'mode' | 'dates' | 'weekdays' | 'timezone'>,
  now: number = Date.now(),
): string[] {
  if (e.mode === 'dates') return e.dates;
  const monday = currentWeekMonday(e.timezone, now);
  return e.weekdays.map((w) => addDays(monday, w));
}

export function totalSlots(e: SlotEventShape): number {
  return (e.mode === 'dates' ? e.dates.length : e.weekdays.length) * slotsPerDay(e);
}

/** Absolute instant (ms) at which the slot starts. */
export function slotStartEpoch(e: SlotEventShape, slotIndex: number, now: number = Date.now()): number {
  const per = slotsPerDay(e);
  const dayIndex = Math.floor(slotIndex / per);
  const slotOfDay = slotIndex % per;
  const { year, month, day } = parseDateKey(dayKeys(e, now)[dayIndex]);
  return wallToEpoch(year, month, day, e.startMinute + slotOfDay * e.slotMinutes, e.timezone);
}

export interface ViewColumn {
  /** viewer-local date key */
  key: string;
  /** 0 = Monday */
  weekday: number;
  /** short weekday, e.g. "Tue" */
  label: string;
  /** e.g. "Oct 14"; null in weekdays mode */
  sublabel: string | null;
  /** e.g. "Tue, Oct 14" (or "Tuesday" in weekdays mode) */
  fullLabel: string;
}

export interface ViewRow {
  /** viewer-local minute of day (0..1439) */
  minute: number;
  label: string;
  showLabel: boolean;
  /** true when there is a time gap between this row and the previous one */
  gapBefore: boolean;
}

export interface ViewGrid {
  cols: number;
  nrows: number;
  columns: ViewColumn[];
  rows: ViewRow[];
  /** row-major (row * cols + col): slot index or -1 */
  cells: Int32Array;
  /** per slot index: row * cols + col, or -1 if it collided (DST overlap) and is hidden */
  slotPos: Int32Array;
  slotMinutes: number;
  totalSlots: number;
  mode: EventMode;
}

export function cellSlot(grid: ViewGrid, row: number, col: number): number {
  return grid.cells[row * grid.cols + col];
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(locale: string | undefined, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale ?? ''}|${JSON.stringify(opts)}`;
  let f = fmtCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, { timeZone: 'UTC', ...opts });
    fmtCache.set(key, f);
  }
  return f;
}

function dateKeyToUtc(key: string): Date {
  const { year, month, day } = parseDateKey(key);
  return new Date(Date.UTC(year, month - 1, day));
}

/** "9 AM" / "9:30 AM" depending on the minute. */
export function formatMinute(minute: number, locale?: string): string {
  const m = ((minute % 1440) + 1440) % 1440;
  const d = new Date(Date.UTC(1970, 0, 1, 0, m));
  return minute % 60 === 0
    ? fmt(locale, { hour: 'numeric' }).format(d)
    : fmt(locale, { hour: 'numeric', minute: '2-digit' }).format(d);
}

/** Always includes minutes: "9:00 AM". */
export function formatClock(minute: number, locale?: string): string {
  const m = ((minute % 1440) + 1440) % 1440;
  return fmt(locale, { hour: 'numeric', minute: '2-digit' }).format(new Date(Date.UTC(1970, 0, 1, 0, m)));
}

/** "2:00–4:00 PM" (collapses a shared day period); end may be 1440. */
export function formatMinuteRange(start: number, end: number, locale?: string): string {
  const f = fmt(locale, { hour: 'numeric', minute: '2-digit' });
  const parts = (min: number) => f.formatToParts(new Date(Date.UTC(1970, 0, 1, 0, ((min % 1440) + 1440) % 1440)));
  const sp = parts(start);
  const ep = parts(end);
  const period = (p: Intl.DateTimeFormatPart[]) => p.find((x) => x.type === 'dayPeriod')?.value;
  const text = (p: Intl.DateTimeFormatPart[]) => p.map((x) => x.value).join('');
  let startText = text(sp);
  const sPeriod = period(sp);
  if (sPeriod && sPeriod === period(ep)) {
    startText = text(sp.filter((x) => x.type !== 'dayPeriod')).replace(/\s+$/, "");
  }
  return `${startText}–${text(ep)}`;
}

function columnFor(key: string, mode: EventMode, locale?: string): ViewColumn {
  const date = dateKeyToUtc(key);
  const weekday = weekdayIndex(key);
  const label = fmt(locale, { weekday: 'short' }).format(date);
  if (mode === 'weekdays') {
    return { key, weekday, label, sublabel: null, fullLabel: fmt(locale, { weekday: 'long' }).format(date) };
  }
  return {
    key,
    weekday,
    label,
    sublabel: fmt(locale, { month: 'short', day: 'numeric' }).format(date),
    fullLabel: fmt(locale, { weekday: 'short', month: 'short', day: 'numeric' }).format(date),
  };
}

/** Project the event's slots onto a viewer-timezone grid. */
export function buildViewGrid(
  e: SlotEventShape,
  viewerTz: string,
  locale?: string,
  now: number = Date.now(),
): ViewGrid {
  const per = slotsPerDay(e);
  const days = dayKeys(e, now);
  const total = days.length * per;

  const localDay = new Array<string>(total);
  const localMinute = new Int32Array(total);
  const dayKeySet = new Set<string>();
  const minuteSet = new Set<number>();

  for (let d = 0; d < days.length; d++) {
    const { year, month, day } = parseDateKey(days[d]);
    for (let s = 0; s < per; s++) {
      const idx = d * per + s;
      const epoch = wallToEpoch(year, month, day, e.startMinute + s * e.slotMinutes, e.timezone);
      const w = epochToWall(epoch, viewerTz);
      const key = toDateKey(w.year, w.month, w.day);
      localDay[idx] = key;
      localMinute[idx] = w.minute;
      dayKeySet.add(key);
      minuteSet.add(w.minute);
    }
  }

  const colKeys = [...dayKeySet].sort();
  const minutes = [...minuteSet].sort((a, b) => a - b);
  const colIndex = new Map(colKeys.map((k, i) => [k, i]));
  const rowIndex = new Map(minutes.map((m, i) => [m, i]));
  const cols = colKeys.length;
  const nrows = minutes.length;

  const cells = new Int32Array(cols * nrows).fill(-1);
  const slotPos = new Int32Array(total).fill(-1);
  for (let i = 0; i < total; i++) {
    const pos = rowIndex.get(localMinute[i])! * cols + colIndex.get(localDay[i])!;
    if (cells[pos] === -1) {
      cells[pos] = i;
      slotPos[i] = pos;
    }
  }

  // Label rows on whole hours when any exist, otherwise on the dominant offset (e.g. :30 zones).
  const labelMod = minutes.some((m) => m % 60 === 0) ? 0 : (minutes[0] ?? 0) % 60;
  const rows: ViewRow[] = minutes.map((minute, i) => {
    const gapBefore = i > 0 && minute - minutes[i - 1] > e.slotMinutes;
    return {
      minute,
      label: formatMinute(minute, locale),
      showLabel: i === 0 || gapBefore || minute % 60 === labelMod,
      gapBefore,
    };
  });

  return {
    cols,
    nrows,
    columns: colKeys.map((k) => columnFor(k, e.mode, locale)),
    rows,
    cells,
    slotPos,
    slotMinutes: e.slotMinutes,
    totalSlots: total,
    mode: e.mode,
  };
}

/** Normalise an availability string to exactly `total` chars of 0/1/2. */
export function normalizeAvailability(avail: string | undefined, total: number): string {
  const a = avail ?? '';
  if (a.length === total) return a;
  if (a.length > total) return a.slice(0, total);
  return a + '0'.repeat(total - a.length);
}

export type SlotValue = '0' | '1' | '2';

/**
 * Apply a brush to a rectangle of grid cells (inclusive corners, any order).
 * Disabled cells (-1) are skipped. Returns a new string.
 */
export function paintRect(
  base: string,
  grid: ViewGrid,
  a: { row: number; col: number },
  b: { row: number; col: number },
  value: SlotValue,
): string {
  const r0 = Math.min(a.row, b.row);
  const r1 = Math.max(a.row, b.row);
  const c0 = Math.min(a.col, b.col);
  const c1 = Math.max(a.col, b.col);
  const chars = base.split('');
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const slot = grid.cells[r * grid.cols + c];
      if (slot >= 0) chars[slot] = value;
    }
  }
  return chars.join('');
}

/**
 * Brush semantics (SPEC "Painting"): dragging that starts on a cell already in the active
 * state erases; otherwise it paints the active brush.
 */
export function strokeValue(startCellValue: string, brush: '1' | '2'): SlotValue {
  return startCellValue === brush ? '0' : brush;
}
