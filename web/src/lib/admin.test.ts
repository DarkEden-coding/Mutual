import { describe, expect, it } from 'vitest';
import { deltaFromHistory, formatBytes, formatDelta, formatStamp, formatUptime, fraction, plural, secondsSince } from './admin';

describe('admin helpers', () => {
  it('formats bytes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatBytes(120 * 1024 * 1024)).toBe('120 MB');
    expect(formatBytes(3.2 * 1024 ** 3)).toBe('3.2 GB');
  });

  it('formats uptime', () => {
    expect(formatUptime(42)).toBe('42s');
    expect(formatUptime(125)).toBe('2m');
    expect(formatUptime(5 * 3600 + 12 * 60)).toBe('5h 12m');
    expect(formatUptime(6 * 86400 + 4 * 3600 + 59)).toBe('6d 4h');
  });

  it('computes the delta against the earliest non-null snapshot', () => {
    expect(deltaFromHistory(142, [null, null, 100, 120])).toEqual({ diff: 42, base: 100 });
    expect(deltaFromHistory(10, [null, null])).toBeNull();
    expect(deltaFromHistory(10, [])).toBeNull();
    expect(deltaFromHistory(10, [null, null, 10])).toBeNull();
    expect(deltaFromHistory(10, [10])).toBeNull();
    expect(deltaFromHistory(12, [10, 10, 12])).toEqual({ diff: 2, base: 10 });
    expect(formatDelta(42)).toBe('+42');
    expect(formatDelta(-3)).toBe('−3');
    expect(formatDelta(0)).toBe('±0');
  });

  it('pluralizes and stamps', () => {
    expect(plural(1, 'participant')).toBe('1 participant');
    expect(plural(0, 'participant')).toBe('0 participants');
    expect(plural(1234, 'event')).toBe('1,234 events');
    expect(formatStamp('2026-10-21T14:18:00')).toMatch(/14:18$/);
  });

  it('clamps fractions and ages', () => {
    expect(fraction(5, 10)).toBe(0.5);
    expect(fraction(15, 10)).toBe(1);
    expect(fraction(5, null)).toBe(0);
    expect(fraction(5, 0)).toBe(0);
    expect(secondsSince('2026-10-01T00:00:10Z', Date.parse('2026-10-01T00:00:00Z'))).toBe(0);
    expect(secondsSince('2026-10-01T00:00:00Z', Date.parse('2026-10-01T00:00:30Z'))).toBe(30);
  });
});
