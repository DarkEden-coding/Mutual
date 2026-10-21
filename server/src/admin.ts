import type Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { readdir, stat, statfs } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { statements } from './database.js';
import type { RateLimiter } from './security.js';

interface Counts { eventsCreated: number; participantsJoined: number; availabilitySaves: number; throttled: number }
interface DailyRow { day: string; active_events: number | null; unique_people: number | null; events_created: number; participants_joined: number; availability_saves: number; throttled: number }
interface EventCounts { total: number; active: number; createdLast30Days: number; dates: number; weekdays: number; expiringWithin7Days: number }
interface PeopleCounts { uniquePeople: number; entries: number; withPassword: number; responded: number }
interface TopEvent { id: string; title: string; participants: number; updatedAt: string; expiresAt: string }
const dayMs = 86_400_000;
const dayAt = (now: number) => new Date(now).toISOString().slice(0, 10);
const emptyCounts = (): Counts => ({ eventsCreated: 0, participantsJoined: 0, availabilitySaves: 0, throttled: 0 });
async function fileSize(path: string) { try { return (await stat(path)).size; } catch { return 0; } }
async function backups(directory?: string) {
  const empty = { configured: false, snapshots: [], count: 0, totalBytes: 0, latestAt: null };
  if (!directory) return empty;
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    // A snapshot rotated away between readdir and stat must not make the whole listing look unconfigured.
    const files = (await Promise.all(entries.filter(entry => entry.isFile()).map(async entry => ({ name: entry.name, info: await stat(join(directory, entry.name)).catch(() => null) })))).flatMap(file => file.info ? [{ name: file.name, info: file.info }] : []);
    const names = new Set(files.map(file => file.name));
    const snapshots = files.filter(file => file.name.endsWith('.sqlite')).map(({ name, info }) => ({
      name: name.slice(0, -7), bytes: info.size, hasSecret: names.has(`${name.slice(0, -7)}.secret`), modifiedAt: info.mtime.toISOString(),
    })).sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt) || a.name.localeCompare(b.name));
    return { configured: true, snapshots: snapshots.slice(0, 20), count: snapshots.length, totalBytes: files.reduce((sum, file) => sum + file.info.size, 0), latestAt: snapshots[0]?.modifiedAt ?? null };
  } catch { return empty; }
}
async function storage(db: Database.Database, filename: string, tables: { name: string; bytes: number }[]) {
  if (filename === ':memory:') return { databaseBytes: 0, walBytes: 0, freeBytes: 0, tables: [], volume: null };
  const [databaseBytes, walBytes] = await Promise.all([fileSize(filename), fileSize(`${filename}-wal`)]);
  const freeBytes = (db.pragma('freelist_count', { simple: true }) as number) * (db.pragma('page_size', { simple: true }) as number);
  let volume = null;
  try { const info = await statfs(dirname(filename)); volume = { totalBytes: info.blocks * info.bsize, freeBytes: info.bavail * info.bsize }; } catch { /* filesystem information is optional */ }
  return { databaseBytes, walBytes, freeBytes, tables, volume };
}
export function adminMetrics(db: Database.Database, sql: ReturnType<typeof statements>, filename: string, backupDir?: string) {
  const started = Date.now(), startedAt = new Date(started).toISOString();
  const version = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version;
  let memoryLimit: number | null = null;
  try { const value = readFileSync('/sys/fs/cgroup/memory.max', 'utf8').trim(); if (/^\d+$/.test(value) && Number.isSafeInteger(Number(value))) memoryLimit = Number(value); } catch { /* cgroups are optional */ }
  const pending = new Map<string, Counts>(), throttles = new Map<number, { total: number; password: number }>();
  let tables: { name: string; bytes: number }[] = [], tablesAt: number | null = null;
  function tableSizes(now: number) {
    if (filename !== ':memory:' && (tablesAt === null || now - tablesAt >= 60_000)) {
      tables = [];
      try { tables = db.prepare('SELECT name, SUM(pgsize) AS bytes FROM dbstat GROUP BY name ORDER BY bytes DESC, name').all() as typeof tables; } catch { /* dbstat is optional */ }
      tablesAt = now;
    }
    return tables;
  }
  function increment(key: keyof Counts) {
    const day = dayAt(Date.now()), counts = pending.get(day) ?? emptyCounts();
    counts[key]++; pending.set(day, counts);
  }
  function recent(now: number) {
    for (const minute of throttles.keys()) if (minute <= Math.floor(now / 60_000) - 60) throttles.delete(minute);
    return [...throttles.values()].reduce((sum, counts) => ({ total: sum.total + counts.total, password: sum.password + counts.password }), { total: 0, password: 0 });
  }
  function throttled(password = false) {
    const now = Date.now(); recent(now);
    const minute = Math.floor(now / 60_000), counts = throttles.get(minute) ?? { total: 0, password: 0 };
    if (password) counts.password++; else { counts.total++; increment('throttled'); }
    throttles.set(minute, counts);
  }
  function liveCounts(now: number) {
    const events = sql.adminEvents.get({ now: new Date(now).toISOString(), since: new Date(now - 30 * dayMs).toISOString(), soon: new Date(now + 7 * dayMs).toISOString() }) as EventCounts;
    const people = sql.adminPeople.get(new Date(now).toISOString()) as PeopleCounts;
    return { events, people };
  }
  function flush() {
    const now = Date.now(), { events, people } = liveCounts(now);
    db.transaction(() => {
      for (const [day, counts] of pending) sql.incrementDailyStats.run(day, counts.eventsCreated, counts.participantsJoined, counts.availabilitySaves, counts.throttled);
      sql.snapshotDailyStats.run(dayAt(now), events.active, people.uniquePeople);
      sql.pruneDailyStats.run(dayAt(now - 400 * dayMs));
    })();
    pending.clear();
  }
  async function stats(limiter: RateLimiter, viewers: Map<string, { size: number }>, streamLimit: number) {
    const now = Date.now(), today = dayAt(now), { events, people } = liveCounts(now);
    const rows = new Map((sql.dailyStats.all(dayAt(now - 29 * dayMs)) as DailyRow[]).map(row => [row.day, row]));
    const history = Array.from({ length: 30 }, (_, index) => {
      const day = dayAt(now - (29 - index) * dayMs), row = rows.get(day), counts = pending.get(day) ?? emptyCounts();
      return { day, activeEvents: day === today ? events.active : row?.active_events ?? null, uniquePeople: day === today ? people.uniquePeople : row?.unique_people ?? null,
        eventsCreated: (row?.events_created ?? 0) + counts.eventsCreated, participantsJoined: (row?.participants_joined ?? 0) + counts.participantsJoined,
        availabilitySaves: (row?.availability_saves ?? 0) + counts.availabilitySaves, throttled: (row?.throttled ?? 0) + counts.throttled };
    });
    const clients = limiter.liveBuckets(now).flatMap(bucket => {
      const scope = bucket.key.startsWith('all:') ? 'all' : bucket.key.startsWith('auth:') ? 'auth' : bucket.key === 'admin-login' ? 'admin' : null;
      if (!scope) return [];
      const capacity = scope === 'all' ? 240 : scope === 'auth' ? 20 : 10, refill = scope === 'all' ? 4 : scope === 'auth' ? 1 / 6 : 10 / 3600;
      const tokens = Math.min(capacity, bucket.tokens + Math.max(0, now - bucket.updated) / 1000 * refill);
      return [{ key: scope === 'admin' ? 'global' : bucket.key.slice(bucket.key.indexOf(':') + 1), scope, tokens, capacity, blocked: tokens < 1 }];
    });
    const recentThrottles = recent(now), memory = process.memoryUsage();
    const [storageStats, backupStats] = await Promise.all([storage(db, filename, tableSizes(now)), backups(backupDir)]);
    return { generatedAt: new Date(now).toISOString(), server: { version, node: process.version, startedAt, uptimeSeconds: Math.max(0, (now - started) / 1000), memory: { rss: memory.rss, heapUsed: memory.heapUsed, limit: memoryLimit } },
      events: { total: events.total, active: events.active, createdLast30Days: events.createdLast30Days, byMode: { dates: events.dates, weekdays: events.weekdays }, expiringWithin7Days: events.expiringWithin7Days },
      people: { unique: people.uniquePeople, entries: people.entries, withPassword: people.withPassword, responded: people.responded, avgPerEvent: events.total ? Math.round(people.entries / events.total * 10) / 10 : 0 },
      storage: storageStats, live: { streams: [...viewers.values()].reduce((sum, set) => sum + set.size, 0), streamLimit, eventsWithViewers: viewers.size },
      topEvents: (sql.adminTopEvents.all(new Date(now).toISOString()) as TopEvent[]).map(event => ({ ...event, live: viewers.get(event.id)?.size ?? 0 })),
      rateLimits: { throttledLastHour: recentThrottles.total, passwordLockoutsLastHour: recentThrottles.password, trackedClients: new Set(clients.filter(client => client.scope !== 'admin').map(client => client.key)).size,
        clients: clients.sort((a, b) => a.tokens / a.capacity - b.tokens / b.capacity || a.key.localeCompare(b.key)).slice(0, 8) }, backups: backupStats, history };
  }
  return { increment, throttled, flush, stats };
}
