import { z } from 'zod';

export const reservedSlugs = new Set(['api', 'e', 'new', 'admin', 'assets', 'static', 'health', 'events', 'session', 'stream', 'slugs', 'login', 'logout', 'settings', 'favicon', 'robots', 'data']);
export const validSlug = (slug: string) => /^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$/.test(slug) && !reservedSlugs.has(slug.toLowerCase());
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, 'Invalid calendar date');
const timezone = z.string().min(1).max(100).refine(value => {
  if (/^[+-]/.test(value)) return false;
  try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; }
}, 'Invalid IANA timezone');
export const eventFields = z.object({
  title: z.string().trim().min(1).max(100),
  description: z.string().max(1000).default(''),
  mode: z.enum(['dates', 'weekdays']),
  dates: z.array(date).max(62).default([]),
  weekdays: z.array(z.number().int().min(0).max(6)).max(7).default([]),
  startMinute: z.number().int().min(0).max(1439),
  endMinute: z.number().int().min(1).max(1440),
  slotMinutes: z.union([z.literal(15), z.literal(30), z.literal(60)]).default(15),
  timezone,
}).strict();
export type EventInput = z.infer<typeof eventFields>;
export interface EventDTO extends EventInput { id: string; createdAt: string; updatedAt: string }
export interface ParticipantDTO { id: string; name: string; hasPassword: boolean; availability: string; updatedAt: string }
export const checkEvent = (event: EventInput) => {
  const days = event.mode === 'dates' ? event.dates : event.weekdays;
  return days.length > 0 && new Set<string | number>(days).size === days.length &&
    (event.mode === 'dates' ? event.weekdays.length === 0 : event.dates.length === 0) &&
    event.startMinute < event.endMinute && event.startMinute % event.slotMinutes === 0 && event.endMinute % event.slotMinutes === 0;
};
export const createSchema = eventFields.extend({ slug: z.string().refine(validSlug, 'Invalid or reserved slug').optional() }).refine(checkEvent, 'Invalid days or hours');
export const patchSchema = z.object({
  title: eventFields.shape.title.optional(), description: eventFields.shape.description.removeDefault().optional(),
  dates: eventFields.shape.dates.removeDefault().optional(), weekdays: eventFields.shape.weekdays.removeDefault().optional(),
  startMinute: eventFields.shape.startMinute.optional(), endMinute: eventFields.shape.endMinute.optional(),
  slotMinutes: eventFields.shape.slotMinutes.removeDefault().optional(),
}).strict();
export const sessionSchema = z.object({ name: z.string().trim().min(1).max(40), password: z.string().max(128).default('') }).strict();
export const availabilitySchema = z.object({ availability: z.string().regex(/^[012]*$/) }).strict();
export const adminSchema = z.object({ token: z.string().max(200) }).strict();
export const daysOf = (event: EventInput): (string | number)[] => event.mode === 'dates' ? event.dates : event.weekdays;
export const totalSlots = (event: EventInput) => daysOf(event).length * (event.endMinute - event.startMinute) / event.slotMinutes;
export function sortDays<T extends EventInput>(event: T): T {
  return { ...event, dates: [...event.dates].sort(), weekdays: [...event.weekdays].sort((a, b) => a - b) };
}
// Merging slots keeps the least committed answer: unavailable < if needed < available.
const commitment: Record<string, number> = { '0': 0, '2': 1, '1': 2 };
/**
 * Carries answers over to the edited event by (day, time overlap). A new slot takes the value of
 * the old slot it falls in when slots get finer, or the least committed of the old slots it spans
 * when they get coarser. Times nobody answered for become '0'.
 */
export function remap(previous: EventDTO, next: EventDTO, availability: string): string {
  const perDay = (previous.endMinute - previous.startMinute) / previous.slotMinutes;
  const oldDays = new Map<string | number, number>(daysOf(previous).map((day, i) => [day, i * perDay]));
  let result = '';
  for (const day of daysOf(next)) {
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
