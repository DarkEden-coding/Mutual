/** Pure formatting helpers for the admin dashboard. */

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

/** 1536 -> "1.5 KB". One decimal below 10, none above; bytes are shown whole. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < UNITS.length - 1) {
    v /= 1024;
    i++;
  }
  if (i === 0) return `${Math.round(v)} B`;
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${UNITS[i]}`;
}

/** 360000 s -> "4d 4h"; under a day "5h 12m"; under an hour "12m"; under a minute "42s". */
export function formatUptime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

/** Whole seconds since an ISO timestamp, never negative. */
export function secondsSince(iso: string, now: number): number {
  return Math.max(0, Math.floor((now - Date.parse(iso)) / 1000));
}

/**
 * Change of `current` against the earliest non-null snapshot; null when there is no baseline
 * or the baseline is today's own entry (the last element), which says nothing about a trend.
 */
export function deltaFromHistory(
  current: number,
  series: readonly (number | null)[],
): { diff: number; base: number } | null {
  const i = series.findIndex((v) => v !== null);
  if (i === -1 || i >= series.length - 1) return null;
  const base = series[i] as number;
  return { diff: current - base, base };
}

/** Date plus time, e.g. "Oct 21, 14:18" in the viewer's local time. */
export function formatStamp(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  const date = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return `${date}, ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** "1 participant", "2 participants". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

export function formatDelta(diff: number): string {
  if (diff === 0) return '±0';
  return `${diff > 0 ? '+' : '−'}${Math.abs(diff).toLocaleString()}`;
}

/** Fraction clamped to 0..1; 0 when the whole is not positive. */
export function fraction(part: number, whole: number | null): number {
  if (!whole || whole <= 0) return 0;
  return Math.min(1, Math.max(0, part / whole));
}

/** HH:MM:SS in the viewer's locale-independent 24h form. */
export function formatClock(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
