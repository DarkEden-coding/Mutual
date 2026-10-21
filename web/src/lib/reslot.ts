/**
 * Client mirror of the server's availability remap (server/src/model.ts `remap`), used to
 * preview what an admin edit does to everyone's answers before it is saved.
 *
 * Answers carry over by (day, time overlap). Finer slots copy the old slot they fall in;
 * coarser slots keep the least committed answer they span (unavailable < if needed < available),
 * so nobody looks free for part of an hour they never offered.
 */
import { slotsPerDay, type SlotEventShape } from './slots';

/** Day identity as the server stores it: the date, or the weekday index. */
const dayKeys = (e: SlotEventShape): string[] => (e.mode === 'dates' ? e.dates : e.weekdays.map(String));

const commitment: Record<string, number> = { '0': 0, '2': 1, '1': 2 };

export function remapAvailability(previous: SlotEventShape, next: SlotEventShape, availability: string): string {
  const perDay = slotsPerDay(previous);
  const oldDays = new Map(dayKeys(previous).map((day, i) => [day, i * perDay]));
  let result = '';
  for (const day of dayKeys(next)) {
    const offset = oldDays.get(day);
    for (let minute = next.startMinute; minute < next.endMinute; minute += next.slotMinutes) {
      let merged: string | undefined;
      if (offset !== undefined) {
        const first = Math.max(0, Math.floor((minute - previous.startMinute) / previous.slotMinutes));
        const last = Math.min(perDay, Math.ceil((minute + next.slotMinutes - previous.startMinute) / previous.slotMinutes));
        for (let i = first; i < last; i++) {
          const value = availability[offset + i] ?? '0';
          if (merged === undefined || commitment[value] < commitment[merged]) merged = value;
        }
      }
      result += merged ?? '0';
    }
  }
  return result;
}

/** Snap hours outward so both ends land on the slot grid (never drops answered time). */
export function snapHours(start: number, end: number, slotMinutes: number): { start: number; end: number } {
  return {
    start: Math.floor(start / slotMinutes) * slotMinutes,
    end: Math.min(1440, Math.ceil(end / slotMinutes) * slotMinutes),
  };
}

export interface RemapImpact {
  /** Answered minutes whose value changes because slots were merged. */
  adjustedMinutes: number;
  /** Answered minutes that fall outside the edited days or hours. */
  clearedMinutes: number;
}

/**
 * Walk the old answers in 15-minute steps and compare each with what the edited event will
 * show at the same moment. Times that only exist in the new event are not counted.
 */
export function remapImpact(previous: SlotEventShape, next: SlotEventShape, availability: string): RemapImpact {
  const remapped = remapAvailability(previous, next, availability);
  const oldPerDay = slotsPerDay(previous);
  const newPerDay = slotsPerDay(next);
  const newDays = new Map(dayKeys(next).map((day, i) => [day, i * newPerDay]));
  const impact: RemapImpact = { adjustedMinutes: 0, clearedMinutes: 0 };
  dayKeys(previous).forEach((day, d) => {
    const newOffset = newDays.get(day);
    for (let minute = previous.startMinute; minute < previous.endMinute; minute += 15) {
      const before = availability[d * oldPerDay + Math.floor((minute - previous.startMinute) / previous.slotMinutes)] ?? '0';
      const inRange = newOffset !== undefined && minute >= next.startMinute && minute < next.endMinute;
      if (!inRange) {
        if (before !== '0') impact.clearedMinutes += 15;
        continue;
      }
      const after = remapped[newOffset + Math.floor((minute - next.startMinute) / next.slotMinutes)];
      if (after !== before) impact.adjustedMinutes += 15;
    }
  });
  return impact;
}

/** "45 min", "2 h", "1 h 30 min". */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}
