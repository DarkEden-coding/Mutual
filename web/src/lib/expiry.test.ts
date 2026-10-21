import { describe, expect, it } from 'vitest';
import { canExtend, expiryFor, extendedExpiry, timeLeft } from './expiry';

const now = Date.parse('2026-10-01T12:00:00Z');

describe('expiry', () => {
  it('matches the server: end of the day N months after the last date, else from today', () => {
    expect(expiryFor(['2026-10-13', '2026-10-15'], 1, now).toISOString()).toBe('2026-11-16T00:00:00.000Z');
    expect(expiryFor(['2027-01-31'], 1, now).toISOString()).toBe('2027-03-01T00:00:00.000Z');
    expect(expiryFor(['2025-01-01'], 1, now).toISOString()).toBe('2026-11-02T00:00:00.000Z');
    expect(expiryFor([], 2, now).toISOString()).toBe('2026-12-02T00:00:00.000Z');
    expect(extendedExpiry('2026-11-16T00:00:00.000Z').toISOString()).toBe('2026-12-16T00:00:00.000Z');
  });
  it('opens the extension window 10 days out and counts time left upwards', () => {
    expect(canExtend('2026-10-11T12:00:01Z', now)).toBe(false);
    expect(canExtend('2026-10-11T12:00:00Z', now)).toBe(true);
    expect(timeLeft('2026-10-07T00:00:00Z', now)).toEqual({ value: 6, unit: 'days' });
    expect(timeLeft('2026-10-02T13:00:00Z', now)).toEqual({ value: 2, unit: 'days' });
    expect(timeLeft('2026-10-02T12:00:00Z', now)).toEqual({ value: 24, unit: 'hours' });
    expect(timeLeft('2026-10-01T12:30:00Z', now)).toEqual({ value: 1, unit: 'hour' });
  });
});
