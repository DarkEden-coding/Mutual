import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app.js';
import { openDatabase } from '../src/database.js';
import { RateLimiter } from '../src/security.js';

const token = 'admin-token-'.repeat(4), secret = 'console-test-secret';
const input = { title: 'Meet up', mode: 'weekdays', weekdays: [0], startMinute: 540, endMinute: 600, slotMinutes: 30, timezone: 'UTC' };
let runtime: ReturnType<typeof createApp>;
const directories: string[] = [];
const temp = () => { const dir = mkdtempSync(join(tmpdir(), 'mutual-admin-')); directories.push(dir); return dir; };
const cookie = (res: Response) => res.headers.get('set-cookie')!.split(';')[0];
function request(path: string, method = 'GET', body?: unknown, auth?: string, ip?: string) {
  return runtime.app.request(`/api${path}`, { method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(auth ? { Cookie: auth } : {}), ...(ip ? { 'CF-Connecting-IP': ip } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
const login = () => request('/admin/login', 'POST', { token });
const stats = async (auth: string) => { const res = await request('/admin/stats', 'GET', undefined, auth); expect(res.status).toBe(200); return res.json(); };
const create = async (overrides = {}) => { const res = await request('/events', 'POST', { ...input, ...overrides }); expect(res.status).toBe(201); return (await res.json()).event; };
const session = async (id: string, name: string, password?: string) => { const res = await request(`/events/${id}/session`, 'POST', { name, password }); expect(res.status).toBe(200); return cookie(res); };
beforeEach(() => { vi.stubEnv('ADMIN_TOKEN', ''); vi.stubEnv('BACKUP_DIR', ''); runtime = createApp({ databasePath: ':memory:', secret, adminToken: token, rateLimit: false }); });
afterEach(() => { runtime.close(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe('site admin authentication', () => {
  it('disables every admin route and rejects short tokens before opening the database', async () => {
    runtime.close(); runtime = createApp({ databasePath: ':memory:', secret, adminToken: '', rateLimit: false });
    for (const [path, method] of [['stats', 'GET'], ['login', 'POST'], ['logout', 'POST'], ['missing', 'DELETE']]) {
      const res = await request(`/admin/${path}`, method);
      expect(res.status).toBe(404); expect((await res.json()).error.code).toBe('not_found');
      expect(res.headers.get('x-robots-tag')).toBe('noindex');
    }
    expect(() => createApp({ databasePath: ':memory:', secret, adminToken: 'short' })).toThrow('ADMIN_TOKEN must be at least 32 characters');
    vi.stubEnv('ADMIN_TOKEN', 'short');
    const disabled = createApp({ databasePath: ':memory:', secret, adminToken: '' }); disabled.close();
    expect(() => createApp({ databasePath: ':memory:', secret })).toThrow('ADMIN_TOKEN must be at least 32 characters');
  });
  it('validates login bodies, logs failures, sets strict cookies and clears logout', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const body of [{}, { token: 1 }, { token: 'x'.repeat(201) }, { token, extra: true }]) expect((await request('/admin/login', 'POST', body)).status).toBe(400);
    expect((await request('/admin/login', 'POST', { token }, undefined, '192.0.2.1')).status).toBe(200);
    const wrong = await request('/admin/login', 'POST', { token: 'wrong' });
    expect(wrong.status).toBe(403); expect(await wrong.json()).toEqual({ error: { code: 'forbidden', message: 'Invalid admin token' } });
    expect(warning).toHaveBeenCalledWith('Failed admin login from "unknown"');
    const signed = await login(), header = signed.headers.get('set-cookie')!;
    expect(await signed.json()).toEqual({ ok: true });
    for (const flag of ['mutual_console=', 'HttpOnly', 'SameSite=Strict', 'Path=/api/admin', 'Max-Age=43200']) expect(header).toContain(flag);
    expect(header).not.toContain(token); expect(header).not.toContain('; Secure');
    expect(signed.headers.get('cache-control')).toBe('no-store'); expect(signed.headers.get('x-robots-tag')).toBe('noindex');
    await stats(cookie(signed));
    for (const auth of [undefined, cookie(signed)]) {
      const res = await request('/admin/logout', 'POST', undefined, auth); expect(res.status).toBe(204);
      expect(res.headers.get('set-cookie')).toContain('Max-Age=0'); expect(res.headers.get('set-cookie')).toContain('Path=/api/admin');
    }
  });
  it('rejects missing, tampered, expired and rotated sessions', async () => {
    expect((await request('/admin/stats')).status).toBe(401);
    const signed = cookie(await login());
    expect((await request('/admin/stats', 'GET', undefined, signed + 'x')).status).toBe(401);
    vi.useFakeTimers(); vi.setSystemTime(Date.now() + 12 * 3_600_000);
    expect((await request('/admin/stats', 'GET', undefined, signed)).status).toBe(401);
    vi.useRealTimers();
    const dir = temp(); runtime.close(); runtime = createApp({ dataDir: dir, secret, adminToken: token, rateLimit: false });
    const old = cookie(await login()); runtime.close(); runtime = createApp({ dataDir: dir, secret, adminToken: 'rotated-token-'.repeat(4), rateLimit: false });
    expect((await request('/admin/stats', 'GET', undefined, old)).status).toBe(401);
  });
  it('uses secure cookies and rejects cross-origin login and logout', async () => {
    vi.stubEnv('COOKIE_SECURE', 'true'); runtime.close(); runtime = createApp({ databasePath: ':memory:', secret, adminToken: token, rateLimit: false });
    expect((await login()).headers.get('set-cookie')).toContain('; Secure');
    expect((await request('/admin/logout', 'POST')).headers.get('set-cookie')).toContain('; Secure');
    for (const path of ['login', 'logout']) expect((await runtime.app.request(`/api/admin/${path}`, { method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) })).status).toBe(403);
  });
  it('shares the per-IP auth bucket with event creation and sign-in', async () => {
    runtime.close(); runtime = createApp({ databasePath: ':memory:', secret, adminToken: token, trustProxy: 'cloudflare' });
    vi.useFakeTimers();
    for (let i = 0; i < 20; i++) expect((await request('/events', 'POST', {}, undefined, '192.0.2.1')).status).toBe(400);
    expect((await request('/admin/login', 'POST', { token }, undefined, '192.0.2.1')).status).toBe(429);
    expect((await request('/admin/login', 'POST', { token }, undefined, '192.0.2.2')).status).toBe(200);
    vi.setSystemTime(Date.now() + 6000);
    expect((await request('/admin/login', 'POST', { token }, undefined, '192.0.2.1')).status).toBe(200);
  });
  it('checks refilled tokens without mutating or creating buckets', () => {
    vi.useFakeTimers();
    const limiter = new RateLimiter();
    expect(limiter.peek('admin-login', 10, 10 / 3600)).toBe(true); expect(limiter.snapshot()).toEqual([]);
    for (let i = 0; i < 10; i++) expect(limiter.take('admin-login', 10, 10 / 3600)).toBe(true);
    const before = limiter.snapshot();
    expect(limiter.peek('admin-login', 10, 10 / 3600)).toBe(false);
    vi.setSystemTime(Date.now() + 360_000);
    expect(limiter.peek('admin-login', 10, 10 / 3600)).toBe(true); expect(limiter.snapshot()).toEqual(before);
    expect(limiter.take('admin-login', 10, 10 / 3600)).toBe(true);
    expect(limiter.peek('admin-login', 10, 10 / 3600)).toBe(false);
  });
  it('does not consume the global bucket on successful logins', async () => {
    runtime.close(); runtime = createApp({ databasePath: ':memory:', secret, adminToken: token, trustProxy: 'cloudflare' });
    vi.useFakeTimers();
    for (let i = 0; i < 12; i++) expect((await request('/admin/login', 'POST', { token }, undefined, `192.0.2.${i}`)).status).toBe(200);
    expect((await stats(cookie(await login()))).rateLimits.clients.some((client: { scope: string }) => client.scope === 'admin')).toBe(false);
  });
  it('escapes control characters in failed-login client keys', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    runtime.close(); runtime = createApp({ databasePath: ':memory:', secret, adminToken: token, trustProxy: 'cloudflare', rateLimit: false });
    const ip = '192.0.2.1\tforged';
    expect((await request('/admin/login', 'POST', { token: 'wrong' }, undefined, ip)).status).toBe(403);
    expect(warning).toHaveBeenCalledWith(`Failed admin login from ${JSON.stringify(ip)}`);
    expect(warning.mock.calls[0][0]).not.toContain('\t');
  });
  it('caps distributed admin guessing globally and reports throttles', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    runtime.close(); runtime = createApp({ databasePath: ':memory:', secret, adminToken: token, trustProxy: 'cloudflare' });
    vi.useFakeTimers();
    const auth = cookie(await login());
    for (let i = 0; i < 10; i++) expect((await request('/admin/login', 'POST', { token: 'wrong' }, undefined, `192.0.2.${i}`)).status).toBe(403);
    const limited = await request('/admin/login', 'POST', { token }, undefined, '192.0.2.99');
    expect(limited.status).toBe(429); expect((await limited.json()).error.code).toBe('rate_limited');
    const data = await stats(auth); expect(data.rateLimits.throttledLastHour).toBe(1);
    expect(data.rateLimits.clients).toContainEqual(expect.objectContaining({ key: 'global', scope: 'admin', capacity: 10, blocked: true }));
    expect(data.history.at(-1).throttled).toBe(1);
    vi.setSystemTime(Date.now() + 360_000);
    expect((await request('/admin/login', 'POST', { token }, undefined, '192.0.2.99')).status).toBe(200);
    vi.setSystemTime(Date.now() + 3_240_000);
    expect((await stats(auth)).rateLimits.throttledLastHour).toBe(0);
  });
});

describe('site admin statistics', () => {
  it('caches dbstat table sizes for 60 seconds while other statistics stay live', async () => {
    runtime.close(); runtime = createApp({ dataDir: temp(), secret, adminToken: token, rateLimit: false });
    vi.useFakeTimers();
    const prepare = vi.spyOn(runtime.db, 'prepare'), auth = cookie(await login());
    const scans = () => prepare.mock.calls.filter(([query]) => query.includes('FROM dbstat')).length;
    const initial = await stats(auth); expect(scans()).toBe(1);
    await create();
    vi.setSystemTime(Date.now() + 59_999);
    const cached = await stats(auth);
    expect(scans()).toBe(1); expect(cached.storage.tables).toEqual(initial.storage.tables);
    expect(cached.events.total).toBe(1); expect(cached.generatedAt).not.toBe(initial.generatedAt);
    vi.setSystemTime(Date.now() + 1);
    await stats(auth); expect(scans()).toBe(2);
  });
  it('counts current events and people, orders top events, tracks live viewers and merges history', async () => {
    const auth = cookie(await login());
    const one = await create({ title: 'One' }), two = await create({ title: 'Two' }), three = await create({ title: 'Three', mode: 'dates', weekdays: [], dates: ['2027-01-01'] });
    const alice = await session(one.id, 'Alice', 'secret'); await session(one.id, 'Bob');
    await session(two.id, 'alice'); await session(two.id, 'Carol'); await session(two.id, 'Dave'); await session(three.id, 'Eve');
    await request(`/events/${one.id}/availability`, 'PUT', { availability: '12' }, alice);
    const stream = await request(`/events/${two.id}/stream`);
    const data = await stats(auth);
    expect(data.events).toEqual({ total: 3, active: 2, createdLast30Days: 3, byMode: { dates: 1, weekdays: 2 }, expiringWithin7Days: 0 });
    expect(data.people).toEqual({ unique: 5, entries: 6, withPassword: 1, responded: 1, avgPerEvent: 2 });
    expect(data.topEvents.map((event: { id: string }) => event.id)).toEqual([two.id, one.id, three.id]);
    expect(data.topEvents[0]).toMatchObject({ title: 'Two', participants: 3, live: 1 });
    expect(data.live).toEqual({ streams: 1, streamLimit: 2000, eventsWithViewers: 1 }); await stream.body!.cancel();
    expect(data.history).toHaveLength(30); expect(data.history[0]).toMatchObject({ activeEvents: null, uniquePeople: null, eventsCreated: 0 });
    expect(data.history.at(-1)).toEqual({ day: new Date().toISOString().slice(0, 10), activeEvents: 2, uniquePeople: 5, eventsCreated: 3, participantsJoined: 6, availabilitySaves: 1, throttled: 0 });
    expect(data.history.map((row: { day: string }) => row.day)).toEqual([...data.history.map((row: { day: string }) => row.day)].sort());
    runtime.housekeep(); expect((await stats(auth)).history).toEqual(data.history);
    expect(data.storage).toEqual({ databaseBytes: 0, walBytes: 0, freeBytes: 0, tables: [], volume: null });
    expect(data.server).toMatchObject({ version: '0.1.0', node: process.version, memory: { rss: expect.any(Number), heapUsed: expect.any(Number) } });
    runtime.db.prepare('UPDATE events SET expires_at = ? WHERE id = ?').run(new Date().toISOString(), two.id);
    const unexpired = await stats(auth);
    expect(unexpired.events).toMatchObject({ total: 2, active: 1, createdLast30Days: 2, byMode: { dates: 1, weekdays: 1 } });
    expect(unexpired.people).toMatchObject({ unique: 3, entries: 3, withPassword: 1, responded: 1, avgPerEvent: 1.5 });
    expect(unexpired.topEvents.map((event: { id: string }) => event.id)).not.toContain(two.id);
  });
  it('persists counters on close, retains each UTC day across midnight and prunes old history', async () => {
    const dir = temp(); vi.useFakeTimers(); vi.setSystemTime('2026-10-21T23:59:00Z');
    runtime.close(); runtime = createApp({ dataDir: dir, secret, adminToken: token, rateLimit: false });
    const event = await create(); await session(event.id, 'Alice');
    vi.setSystemTime('2026-10-22T00:01:00Z'); await create(); runtime.housekeep();
    runtime.db.prepare('INSERT INTO daily_stats (day) VALUES (?)').run('2020-01-01'); runtime.housekeep();
    expect(runtime.db.prepare('SELECT day FROM daily_stats WHERE day = ?').get('2020-01-01')).toBeUndefined();
    await create(); runtime.close(); runtime = createApp({ dataDir: dir, secret, adminToken: token, rateLimit: false });
    const history = (await stats(cookie(await login()))).history;
    expect(history.at(-2)).toMatchObject({ day: '2026-10-21', eventsCreated: 1, participantsJoined: 1 });
    expect(history.at(-1)).toMatchObject({ day: '2026-10-22', eventsCreated: 2, participantsJoined: 0 });
  });
  it('lists backup metadata and disk storage, tolerating missing backup directories', async () => {
    const dir = temp(), backupDir = join(dir, 'backups'); mkdirSync(backupDir);
    writeFileSync(join(backupDir, 'x.sqlite'), 'xxx'); writeFileSync(join(backupDir, 'x.secret'), 'secret'); writeFileSync(join(backupDir, 'y.sqlite'), 'yy'); mkdirSync(join(backupDir, 'ignored.sqlite'));
    utimesSync(join(backupDir, 'x.sqlite'), new Date('2026-10-19Z'), new Date('2026-10-19Z'));
    utimesSync(join(backupDir, 'y.sqlite'), new Date('2026-10-20Z'), new Date('2026-10-20Z'));
    runtime.close(); runtime = createApp({ dataDir: dir, secret, adminToken: token, backupDir, rateLimit: false });
    const data = await stats(cookie(await login()));
    expect(data.backups).toEqual({ configured: true, count: 2, totalBytes: 11, latestAt: '2026-10-20T00:00:00.000Z', snapshots: [
      { name: 'y', bytes: 2, hasSecret: false, modifiedAt: '2026-10-20T00:00:00.000Z' }, { name: 'x', bytes: 3, hasSecret: true, modifiedAt: '2026-10-19T00:00:00.000Z' },
    ] });
    expect(data.storage.databaseBytes).toBeGreaterThan(0); expect(data.storage.walBytes).toBeGreaterThanOrEqual(0); expect(data.storage.volume.totalBytes).toBeGreaterThan(0);
    rmSync(backupDir, { recursive: true });
    expect((await stats(cookie(await login()))).backups).toEqual({ configured: false, count: 0, totalBytes: 0, latestAt: null, snapshots: [] });
  });
  it('reports password lockouts without exposing password buckets', async () => {
    runtime.close(); runtime = createApp({ databasePath: ':memory:', secret, adminToken: token, trustProxy: 'cloudflare' });
    const auth = cookie(await login()), event = await create(); await session(event.id, 'Alice', 'right');
    for (let i = 0; i < 10; i++) expect((await request(`/events/${event.id}/session`, 'POST', { name: 'Alice', password: 'wrong' }, undefined, `198.51.100.${i}`)).status).toBe(401);
    expect((await request(`/events/${event.id}/session`, 'POST', { name: 'Alice', password: 'right' }, undefined, '198.51.100.20')).status).toBe(429);
    const data = await stats(auth);
    expect(data.rateLimits.throttledLastHour).toBe(1); expect(data.rateLimits.passwordLockoutsLastHour).toBe(1);
    expect(data.rateLimits.trackedClients).toBe(12); expect(data.rateLimits.clients.length).toBeLessThanOrEqual(8);
    expect(JSON.stringify(data.rateLimits)).not.toContain('password:');
  });
  it('keeps expiring events when the statistics flush fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const event = await create(); await session(event.id, 'Alice');
    runtime.db.exec('DROP TABLE daily_stats');
    runtime.db.prepare('UPDATE events SET expires_at = ? WHERE id = ?').run(new Date().toISOString(), event.id);
    expect(() => runtime.housekeep()).not.toThrow();
    expect(runtime.db.prepare('SELECT count(*) AS n FROM events').get()).toEqual({ n: 0 });
    expect(error).toHaveBeenCalled();
    expect(() => runtime.close()).not.toThrow();
  });
  it('upgrades v3 databases and backfills creation counts by UTC day', () => {
    const filename = join(temp(), 'legacy.sqlite'), db = openDatabase(filename);
    db.exec('DROP TABLE daily_stats; PRAGMA user_version = 3');
    const insert = db.prepare('INSERT INTO events (id, dto, admin_hash, updated_at, expires_at) VALUES (?, ?, ?, ?, ?)');
    for (const [id, created] of [['one', '2026-10-19'], ['two', '2026-10-19'], ['three', '2026-10-20']]) insert.run(id, JSON.stringify({ createdAt: `${created}T12:00:00.000Z` }), 'hash', '2026-10-20T00:00:00.000Z', '2027-01-01T00:00:00.000Z');
    db.close(); const upgraded = openDatabase(filename);
    try {
      expect(upgraded.pragma('user_version', { simple: true })).toBe(4);
      expect(upgraded.prepare('SELECT day, events_created, active_events FROM daily_stats ORDER BY day').all()).toEqual([
        { day: '2026-10-19', events_created: 2, active_events: null }, { day: '2026-10-20', events_created: 1, active_events: null },
      ]);
    } finally { upgraded.close(); }
  });
});
