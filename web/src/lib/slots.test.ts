import { describe, expect, it } from 'vitest';
import {
  buildViewGrid,
  currentWeekMonday,
  dayKeys,
  formatMinuteRange,
  normalizeAvailability,
  paintRect,
  slotStartEpoch,
  slotsPerDay,
  strokeValue,
  totalSlots,
  type SlotEventShape,
} from './slots';
import { addDays, epochToWall, wallToEpoch, weekdayIndex } from './tz';

function ev(over: Partial<SlotEventShape>): SlotEventShape {
  return {
    mode: 'dates',
    dates: ['2024-10-14'],
    weekdays: [],
    startMinute: 9 * 60,
    endMinute: 17 * 60,
    slotMinutes: 60,
    timezone: 'America/New_York',
    ...over,
  };
}

describe('tz primitives', () => {
  it('converts wall time to epoch with standard and DST offsets', () => {
    expect(new Date(wallToEpoch(2024, 1, 15, 9 * 60, 'America/New_York')).toISOString()).toBe('2024-01-15T14:00:00.000Z');
    expect(new Date(wallToEpoch(2024, 7, 15, 9 * 60, 'America/New_York')).toISOString()).toBe('2024-07-15T13:00:00.000Z');
    expect(new Date(wallToEpoch(2024, 1, 15, 9 * 60, 'Asia/Kolkata')).toISOString()).toBe('2024-01-15T03:30:00.000Z');
  });

  it('round-trips through epochToWall', () => {
    const t = wallToEpoch(2024, 3, 9, 23 * 60 + 45, 'Europe/London');
    expect(epochToWall(t, 'Europe/London')).toEqual({ year: 2024, month: 3, day: 9, minute: 23 * 60 + 45 });
  });

  it('handles 24:00 as next-day midnight', () => {
    expect(wallToEpoch(2024, 10, 14, 1440, 'UTC')).toBe(Date.UTC(2024, 9, 15));
  });

  it('date helpers', () => {
    expect(addDays('2024-02-28', 2)).toBe('2024-03-01');
    expect(weekdayIndex('2024-01-01')).toBe(0);
    expect(weekdayIndex('2024-01-07')).toBe(6);
  });
});

describe('slot math', () => {
  it('counts slots', () => {
    const e = ev({ slotMinutes: 15, dates: ['2024-10-14', '2024-10-15'] });
    expect(slotsPerDay(e)).toBe(32);
    expect(totalSlots(e)).toBe(64);
  });

  it('slot start epochs follow dayIndex * slotsPerDay + slotOfDay', () => {
    const e = ev({ dates: ['2024-10-14', '2024-10-15'], slotMinutes: 60 });
    // 8 slots/day -> index 9 = day 1, slot 1 = 10:00 EDT = 14:00Z
    expect(new Date(slotStartEpoch(e, 9)).toISOString()).toBe('2024-10-15T14:00:00.000Z');
  });
});

describe('buildViewGrid', () => {
  it('same timezone is the identity grid', () => {
    const e = ev({ dates: ['2024-10-14', '2024-10-15'] });
    const g = buildViewGrid(e, 'America/New_York', 'en-US');
    expect(g.cols).toBe(2);
    expect(g.nrows).toBe(8);
    expect(g.rows[0].minute).toBe(540);
    expect(Array.from(g.cells)).not.toContain(-1);
    expect(g.cells[0]).toBe(0);
    expect(g.cells[1]).toBe(8); // row 0, col 1 = day 1 slot 0
    expect(g.columns[0].label).toBe('Mon');
    expect(g.columns[0].sublabel).toBe('Oct 14');
  });

  it('converts to another zone (NY -> LA shifts rows by 3h)', () => {
    const g = buildViewGrid(ev({}), 'America/Los_Angeles', 'en-US');
    expect(g.rows[0].minute).toBe(6 * 60);
    expect(g.rows[g.nrows - 1].minute).toBe(13 * 60);
    expect(g.cols).toBe(1);
  });

  it('cross-midnight conversion splits a day across two local columns with disabled cells', () => {
    // Tokyo 09:00-17:00 on Oct 14 (UTC+9) seen from Los Angeles (UTC-7 in Oct): previous day 17:00-01:00
    const e = ev({ timezone: 'Asia/Tokyo', startMinute: 9 * 60, endMinute: 17 * 60 });
    const g = buildViewGrid(e, 'America/Los_Angeles', 'en-US');
    expect(g.columns.map((c) => c.key)).toEqual(['2024-10-13', '2024-10-14']);
    // rows: 0:00 (slot 8:00? no) -> union of {17..23} and {0}
    expect(g.rows.map((r) => r.minute)).toEqual([0, 17 * 60, 18 * 60, 19 * 60, 20 * 60, 21 * 60, 22 * 60, 23 * 60]);
    // Tokyo 16:00 -> LA 00:00 on Oct 14 (col 1, row 0); everything else is on Oct 13
    expect(g.cells[0 * g.cols + 1]).toBe(7);
    expect(g.cells[0 * g.cols + 0]).toBe(-1);
    expect(g.cells[1 * g.cols + 1]).toBe(-1);
    expect(g.cells[1 * g.cols + 0]).toBe(0);
    expect(g.rows[1].gapBefore).toBe(true);
    // every slot is placed exactly once
    expect(Array.from(g.slotPos).every((p) => p >= 0)).toBe(true);
  });

  it('half-hour offset zones keep :30 rows and label them', () => {
    const g = buildViewGrid(ev({ startMinute: 9 * 60, endMinute: 12 * 60 }), 'Asia/Kolkata', 'en-US');
    // 09:00 EDT = 13:00Z = 18:30 IST
    expect(g.rows[0].minute).toBe(18 * 60 + 30);
    expect(g.rows.every((r) => r.showLabel)).toBe(true);
  });

  it('DST: dates straddling a viewer DST change produce a union of rows with disabled cells', () => {
    // Event in UTC, 12:00-14:00, Sat Mar 9 and Mon Mar 11 2024; viewer NY springs forward Mar 10.
    const e = ev({
      timezone: 'UTC',
      dates: ['2024-03-09', '2024-03-11'],
      startMinute: 12 * 60,
      endMinute: 14 * 60,
    });
    const g = buildViewGrid(e, 'America/New_York', 'en-US');
    // Mar 9: 07:00, 08:00 EST. Mar 11: 08:00, 09:00 EDT.
    expect(g.rows.map((r) => r.minute)).toEqual([7 * 60, 8 * 60, 9 * 60]);
    expect(g.cells[0 * g.cols + 0]).toBe(0);
    expect(g.cells[0 * g.cols + 1]).toBe(-1);
    expect(g.cells[2 * g.cols + 0]).toBe(-1);
    expect(g.cells[2 * g.cols + 1]).toBe(3);
  });

  it('DST: event-zone wall clock stays constant across its own DST change', () => {
    // NY 09:00 on Mar 8 (EST) and Mar 11 (EDT) viewed in UTC: 14:00Z vs 13:00Z
    const e = ev({ dates: ['2024-03-08', '2024-03-11'], startMinute: 9 * 60, endMinute: 10 * 60 });
    const g = buildViewGrid(e, 'UTC', 'en-US');
    expect(g.rows.map((r) => r.minute)).toEqual([13 * 60, 14 * 60]);
    expect(g.cells[1 * g.cols + 0]).toBe(0);
    expect(g.cells[0 * g.cols + 1]).toBe(1);
  });

  it('weekdays mode uses the current week (Mon 2024-01-01 when now is that week)', () => {
    const e = ev({ mode: 'weekdays', dates: [], weekdays: [0, 2, 6], timezone: 'UTC', startMinute: 0, endMinute: 120 });
    const now = Date.UTC(2024, 0, 3, 12); // Wed in the week of Mon 2024-01-01
    const same = buildViewGrid(e, 'UTC', 'en-US', now);
    expect(same.columns.map((c) => c.label)).toEqual(['Mon', 'Wed', 'Sun']);
    expect(same.columns.every((c) => c.sublabel === null)).toBe(true);
    // Viewer UTC-5: Monday 00:00 UTC becomes Sunday 19:00 (2023-12-31)
    const west = buildViewGrid(e, 'America/New_York', 'en-US', now);
    expect(west.columns[0].key).toBe('2023-12-31');
    expect(west.columns[0].label).toBe('Sun');
    expect(west.columns.map((c) => c.weekday)).toContain(6);
  });
});

describe('weekdays mode current week', () => {
  const weekly = (over: Partial<SlotEventShape> = {}) =>
    ev({ mode: 'weekdays', dates: [], weekdays: [0], startMinute: 9 * 60, endMinute: 10 * 60, ...over });

  it('currentWeekMonday uses the event timezone, not UTC', () => {
    // Sun 2024-10-13 23:30 in New York is already Mon 03:30Z; the NY week is still Mon Oct 7.
    const now = Date.UTC(2024, 9, 14, 3, 30);
    expect(currentWeekMonday('America/New_York', now)).toBe('2024-10-07');
    expect(currentWeekMonday('UTC', now)).toBe('2024-10-14');
    expect(currentWeekMonday('Asia/Tokyo', now)).toBe('2024-10-14');
  });

  it('dayKeys maps weekday indexes onto the current week', () => {
    const now = Date.UTC(2024, 9, 16, 12); // Wed Oct 16
    expect(dayKeys(weekly({ weekdays: [0, 2, 6] }), now)).toEqual(['2024-10-14', '2024-10-16', '2024-10-20']);
  });

  it('9 AM New York Monday is 10 PM Sunday in Tokyo during DST, 11 PM in winter', () => {
    const october = buildViewGrid(weekly(), 'Asia/Tokyo', 'en-US', Date.UTC(2024, 9, 16, 12));
    expect(october.rows[0].minute).toBe(22 * 60);
    expect(october.columns[0].label).toBe('Mon');
    const winter = buildViewGrid(weekly(), 'Asia/Tokyo', 'en-US', Date.UTC(2024, 0, 17, 12));
    expect(winter.rows[0].minute).toBe(23 * 60);
  });

  it('slotStartEpoch uses the current week too', () => {
    const now = Date.UTC(2024, 9, 16, 12);
    expect(new Date(slotStartEpoch(weekly(), 0, now)).toISOString()).toBe('2024-10-14T13:00:00.000Z');
  });
});

describe('painting helpers', () => {
  it('normalizes availability length', () => {
    expect(normalizeAvailability('11', 4)).toBe('1100');
    expect(normalizeAvailability('1122', 2)).toBe('11');
    expect(normalizeAvailability(undefined, 3)).toBe('000');
  });

  it('paints a rectangle and skips disabled cells', () => {
    const e = ev({ timezone: 'Asia/Tokyo' });
    const g = buildViewGrid(e, 'America/Los_Angeles', 'en-US');
    const base = '0'.repeat(g.totalSlots);
    const out = paintRect(base, g, { row: 0, col: 0 }, { row: 1, col: 1 }, '1');
    // cells (0,0) and (1,1) are disabled; (0,1)=slot 7 and (1,0)=slot 0 are painted
    expect(out[7]).toBe('1');
    expect(out[0]).toBe('1');
    expect(out.split('').filter((c) => c === '1')).toHaveLength(2);
  });

  it('erases when the stroke starts on a cell already in the active state', () => {
    expect(strokeValue('1', '1')).toBe('0');
    expect(strokeValue('0', '1')).toBe('1');
    expect(strokeValue('2', '1')).toBe('1');
    expect(strokeValue('2', '2')).toBe('0');
  });
});

describe('formatMinuteRange', () => {
  it('collapses a shared AM/PM', () => {
    const s = formatMinuteRange(14 * 60, 16 * 60, 'en-US').replace(/\s/g, ' ');
    expect(s).toBe('2:00–4:00 PM');
  });
  it('keeps both periods when they differ and handles 24:00', () => {
    expect(formatMinuteRange(11 * 60, 13 * 60, 'en-US').replace(/\s/g, ' ')).toBe('11:00 AM–1:00 PM');
    expect(formatMinuteRange(23 * 60, 1440, 'en-US').replace(/\s/g, ' ')).toBe('11:00 PM–12:00 AM');
  });
});
