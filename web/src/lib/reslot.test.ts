import { describe, expect, it } from 'vitest';
import { formatDuration, remapAvailability, remapImpact, snapHours } from './reslot';
import type { SlotEventShape } from './slots';

function ev(over: Partial<SlotEventShape>): SlotEventShape {
  return {
    mode: 'dates',
    dates: ['2024-10-14'],
    weekdays: [],
    startMinute: 9 * 60,
    endMinute: 11 * 60,
    slotMinutes: 30,
    timezone: 'UTC',
    ...over,
  };
}

describe('remapAvailability', () => {
  it('splits slots without losing anything when they get finer', () => {
    expect(remapAvailability(ev({}), ev({ slotMinutes: 15 }), '1120')).toBe('11112200');
  });

  it('keeps the least committed answer when slots merge', () => {
    expect(remapAvailability(ev({}), ev({ slotMinutes: 60 }), '1120')).toBe('10');
    expect(remapAvailability(ev({}), ev({ slotMinutes: 60 }), '1221')).toBe('22');
  });

  it('matches days and fills new time with unavailable', () => {
    const weekly = ev({ mode: 'weekdays', dates: [], weekdays: [0, 2] });
    expect(remapAvailability(weekly, { ...weekly, weekdays: [2, 3], startMinute: 480, slotMinutes: 60 }, '11112222')).toBe('022000');
  });
});

describe('remapImpact', () => {
  it('reports nothing for a lossless change', () => {
    expect(remapImpact(ev({}), ev({ slotMinutes: 15 }), '1120')).toEqual({ adjustedMinutes: 0, clearedMinutes: 0 });
  });

  it('counts merged and cleared minutes separately', () => {
    expect(remapImpact(ev({}), ev({ slotMinutes: 60 }), '1120')).toEqual({ adjustedMinutes: 30, clearedMinutes: 0 });
    expect(remapImpact(ev({}), ev({ endMinute: 600 }), '1122')).toEqual({ adjustedMinutes: 0, clearedMinutes: 60 });
  });
});

it('snaps hours outward onto the slot grid', () => {
  expect(snapHours(555, 1005, 60)).toEqual({ start: 540, end: 1020 });
  expect(snapHours(540, 1020, 30)).toEqual({ start: 540, end: 1020 });
});

it('formats durations', () => {
  expect([formatDuration(45), formatDuration(120), formatDuration(90)]).toEqual(['45 min', '2 h', '1 h 30 min']);
});
