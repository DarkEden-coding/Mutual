import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app.js';
import { clientKey, sessionSecret } from '../src/security.js';

const input = { title: 'Meet up', description: 'Line one\nLine two', mode: 'dates', dates: ['2026-10-15', '2026-10-13'], startMinute: 540, endMinute: 600, slotMinutes: 30, timezone: 'America/Detroit' };
let runtime: ReturnType<typeof createApp>;
const cookie = (res: Response) => res.headers.get('set-cookie')!.split(';')[0];
async function request(path: string, method = 'GET', body?: unknown, auth?: string) {
  return runtime.app.request(`/api${path}`, { method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(auth ? { Cookie: auth } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function create(overrides = {}) {
  const res = await request('/events', 'POST', { ...input, ...overrides });
  expect(res.status).toBe(201);
  return { ...(await res.json()), auth: cookie(res) };
}
async function session(id: string, name = 'Alice', password?: string) {
  const res = await request(`/events/${id}/session`, 'POST', { name, ...(password === undefined ? {} : { password }) });
  expect(res.status).toBe(200);
  return { ...(await res.json()), auth: cookie(res) };
}
beforeEach(() => { runtime = createApp({ databasePath: ':memory:', secret: 'test-secret', rateLimit: false, ttlDays: 0 }); });
afterEach(() => { runtime.close(); vi.useRealTimers(); vi.unstubAllEnvs(); });

describe('events and slugs', () => {
  it('creates sorted DTOs, defaults slot size and description, hashes admin token and sets cookie flags', async () => {
    const res = await request('/events', 'POST', { ...input, description: undefined, slotMinutes: undefined });
    expect(res.status).toBe(201);
    const { event, adminToken } = await res.json();
    expect(event.id).toMatch(/^[abcdefghjkmnpqrstuvwxyz23456789]{10}$/);
    expect(event.dates).toEqual(['2026-10-13', '2026-10-15']);
    expect(event.slotMinutes).toBe(15); expect(event.description).toBe('');
    expect(adminToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const stored = runtime.db.prepare('SELECT admin_hash FROM events').get() as { admin_hash: string };
    expect(stored.admin_hash).toMatch(/^[a-f0-9]{64}$/); expect(stored.admin_hash).not.toBe(adminToken);
    expect(res.headers.get('set-cookie')).toContain('HttpOnly');
    expect(res.headers.get('set-cookie')).toContain('SameSite=Lax');
    expect(res.headers.get('set-cookie')).toContain('Max-Age=31536000');
    expect(res.headers.get('set-cookie')).toContain('Path=/');
    const get = await request(`/events/${event.id}`, 'GET', undefined, cookie(res));
    expect((await get.json()).viewer).toEqual({ isAdmin: true, participantId: null });
  });
  it.each([
    { title: '' }, { title: 'a'.repeat(101) }, { description: 'a'.repeat(1001) },
    { dates: [] }, { dates: ['2026-02-30'] }, { dates: ['2026-10-13', '2026-10-13'] }, { dates: Array.from({ length: 63 }, () => '2026-10-13') },
    { weekdays: [0] }, { startMinute: 541 }, { endMinute: 1441 }, { endMinute: 540 }, { slotMinutes: 20 }, { timezone: 'Not/AZone' }, { timezone: '+01:00' },
    { mode: 'weekdays', dates: [], weekdays: [7] }, { mode: 'weekdays', dates: [], weekdays: [1, 1] },
  ])('rejects invalid create input %j', async override => {
    const res = await request('/events', 'POST', { ...input, ...override });
    expect(res.status).toBe(400); expect((await res.json()).error.code).toBe('invalid_input');
  });
  it('accepts leap days, midnight end, and sorts weekdays', async () => {
    await create({ dates: ['2024-02-29'], endMinute: 1440 });
    const { event } = await create({ mode: 'weekdays', dates: [], weekdays: [6, 0, 2] });
    expect(event.weekdays).toEqual([0, 2, 6]);
  });
  it.each(['api', 'admin', 'assets', 'static', 'health', 'new', 'a', 'ab', '-abc', 'abc-', 'ABC', 'a_b', 'a'.repeat(49)])('rejects slug %s', async slug => {
    const check = await request(`/slugs/${slug}`);
    expect(await check.json()).toEqual({ available: false, valid: false });
    expect((await request('/events', 'POST', { ...input, slug })).status).toBe(400);
  });
  it('reports availability, enforces uniqueness and looks up ids case-insensitively', async () => {
    expect(await (await request('/slugs/our-event')).json()).toEqual({ available: true, valid: true });
    await create({ slug: 'our-event' });
    expect(await (await request('/slugs/our-event')).json()).toEqual({ available: false, valid: true });
    const duplicate = await request('/events', 'POST', { ...input, slug: 'our-event' });
    expect(duplicate.status).toBe(409); expect((await duplicate.json()).error.code).toBe('slug_taken');
    expect((await request('/events/OUR-EVENT')).status).toBe(200);
  });
});

describe('participants and authentication', () => {
  it('creates password-protected participant, logs in case-insensitively and rejects missing/wrong passwords', async () => {
    const { event } = await create();
    const signed = await session(event.id, '  Alice  ', 'correct');
    expect(signed.participant.name).toBe('Alice'); expect(signed.participant.hasPassword).toBe(true); expect(signed.participant.availability).toBe('0000');
    const stored = runtime.db.prepare('SELECT password_hash, password_salt FROM participants').get() as { password_hash: string; password_salt: string };
    expect(stored.password_hash).toHaveLength(128); expect(stored.password_salt).toHaveLength(32);
    for (const password of [undefined, 'incorrect']) {
      const res = await request(`/events/${event.id}/session`, 'POST', { name: 'alice', password });
      expect(res.status).toBe(401); expect((await res.json()).error.code).toBe('wrong_password');
    }
    expect((await session(event.id, 'ALICE', 'correct')).participant.id).toBe(signed.participant.id);
    expect((await (await request(`/events/${event.id}`, 'GET', undefined, signed.auth)).json()).viewer.participantId).toBe(signed.participant.id);
  });
  it('allows existing passwordless names, treats empty password as none, and clears session', async () => {
    const { event } = await create();
    const first = await session(event.id, 'Alice', '');
    expect(first.participant.hasPassword).toBe(false);
    expect((await session(event.id, ' alice ', 'anything')).participant.id).toBe(first.participant.id);
    const res = await request(`/events/${event.id}/session`, 'DELETE', undefined, first.auth);
    expect(res.status).toBe(204); expect(res.headers.get('set-cookie')).toContain('Max-Age=0');
    expect((await (await request(`/events/${event.id}`)).json()).participants).toHaveLength(1);
  });
  it.each([{ name: ' ' }, { name: 'a'.repeat(41) }, { name: 'A', password: 'x'.repeat(129) }])('validates sessions %j', async body => {
    const { event } = await create(); expect((await request(`/events/${event.id}/session`, 'POST', body)).status).toBe(400);
  });
  it('rejects forged and cross-event participant cookies; admin is not participant auth', async () => {
    const { event, auth } = await create(); const second = await create();
    const signed = await session(event.id);
    for (const bad of [undefined, auth, `mutual_p_${event.id}=${signed.participant.id}.fake`, signed.auth + 'tampered']) expect((await request(`/events/${event.id}/availability`, 'PUT', { availability: '1111' }, bad)).status).toBe(401);
    const moved = signed.auth.replace(`mutual_p_${event.id}=`, `mutual_p_${second.event.id}=`);
    expect((await request(`/events/${second.event.id}/availability`, 'PUT', { availability: '1111' }, moved)).status).toBe(401);
  });
  it('validates length and values when saving availability', async () => {
    const { event } = await create(); const signed = await session(event.id);
    for (const availability of ['111', '11111', '11x1', '1234', '', 1234]) expect((await request(`/events/${event.id}/availability`, 'PUT', { availability }, signed.auth)).status).toBe(400);
    const res = await request(`/events/${event.id}/availability`, 'PUT', { availability: '1201' }, signed.auth);
    expect(res.status).toBe(200); expect((await res.json()).participant.availability).toBe('1201');
  });
  it('caps participants at 200 and still permits login', async () => {
    const { event } = await create();
    for (let i = 0; i < 200; i++) await session(event.id, `Person ${i}`);
    const res = await request(`/events/${event.id}/session`, 'POST', { name: 'Overflow' });
    expect(res.status).toBe(409); expect((await res.json()).error.code).toBe('too_many_participants');
    await session(event.id, 'Person 0');
  });
  it('handles concurrent creation of the same protected name', async () => {
    const { event } = await create();
    const responses = await Promise.all([request(`/events/${event.id}/session`, 'POST', { name: 'Alice', password: 'one' }), request(`/events/${event.id}/session`, 'POST', { name: 'ALICE', password: 'two' })]);
    expect(responses.map(r => r.status).sort()).toEqual([200, 401]);
    expect((await (await request(`/events/${event.id}`)).json()).participants).toHaveLength(1);
  });
});

describe('admin and remapping', () => {
  it('claims admin, protects edits and deletes, rejects forged admin cookies', async () => {
    const { event, adminToken } = await create();
    for (const auth of [undefined, `mutual_admin_${event.id}=forged`]) {
      expect((await request(`/events/${event.id}`, 'PATCH', { title: 'Updated' }, auth)).status).toBe(403);
      expect((await request(`/events/${event.id}`, 'DELETE', undefined, auth)).status).toBe(403);
    }
    const wrong = await request(`/events/${event.id}/admin`, 'POST', { token: 'bad' });
    expect(wrong.status).toBe(403); expect((await wrong.json()).error.code).toBe('forbidden');
    const claim = await request(`/events/${event.id}/admin`, 'POST', { token: adminToken });
    expect((await claim.json()).viewer.isAdmin).toBe(true);
    const edited = await request(`/events/${event.id}`, 'PATCH', { title: 'Updated' }, cookie(claim));
    expect(edited.status).toBe(200); expect((await edited.json()).event.description).toBe(input.description);
    expect((await request(`/events/${event.id}`, 'DELETE', undefined, cookie(claim))).status).toBe(204);
    expect((await request(`/events/${event.id}`)).status).toBe(404);
    expect(runtime.db.prepare('SELECT count(*) AS n FROM participants').get()).toEqual({ n: 0 });
  });
  it.each(['dates', 'weekdays'])('remaps %s by dayKey and minute, clears new slots for every participant', async mode => {
    const overrides = mode === 'dates' ? {} : { mode, dates: [], weekdays: [0, 2] };
    const { event, auth } = await create(overrides);
    const alice = await session(event.id); const bob = await session(event.id, 'Bob');
    await request(`/events/${event.id}/availability`, 'PUT', { availability: '1201' }, alice.auth);
    await request(`/events/${event.id}/availability`, 'PUT', { availability: '2122' }, bob.auth);
    const patch = mode === 'dates' ? { dates: ['2026-10-15', '2026-10-16'] } : { weekdays: [2, 3] };
    const res = await request(`/events/${event.id}`, 'PATCH', { ...patch, startMinute: 570, endMinute: 630 }, auth);
    expect(res.status).toBe(200);
    const data = await res.json(); expect(data.participants.map((p: { availability: string }) => p.availability)).toEqual(['1000', '2000']);
    expect((await request(`/events/${event.id}/availability`, 'PUT', { availability: '1122' }, alice.auth)).status).toBe(200);
  });
  it('rejects immutable changes and invalid edit constraints', async () => {
    const { event, auth } = await create();
    for (const patch of [{ mode: 'weekdays' }, { timezone: 'UTC' }, { slotMinutes: 15 }, { dates: [] }, { startMinute: 599 }, { weekdays: [0] }]) expect((await request(`/events/${event.id}`, 'PATCH', patch, auth)).status).toBe(400);
  });
});

describe('SSE and runtime protections', () => {
  it('broadcasts participant creation, saves, edit and deletion, and closes deleted streams', async () => {
    const { event, auth } = await create();
    const stream = await request(`/events/${event.id}/stream`);
    expect(stream.headers.get('content-type')).toBe('text/event-stream');
    expect(stream.headers.get('cache-control')).toBe('no-cache, no-transform');
    expect(stream.headers.get('x-accel-buffering')).toBe('no');
    const reader = stream.body!.getReader(); const decode = (chunk: ReadableStreamReadResult<Uint8Array>) => new TextDecoder().decode(chunk.value);
    expect(decode(await reader.read())).toBe(': connected\n\n');
    const signed = await session(event.id);
    let chunk = decode(await reader.read()); expect(chunk).toContain('event: participant'); expect(chunk).toContain('"name":"Alice"'); expect(chunk).not.toContain('password_hash');
    await request(`/events/${event.id}/availability`, 'PUT', { availability: '1212' }, signed.auth);
    expect(decode(await reader.read())).toContain('"availability":"1212"');
    await request(`/events/${event.id}`, 'PATCH', { title: 'New title' }, auth);
    expect(decode(await reader.read())).toContain('event: event');
    await request(`/events/${event.id}`, 'DELETE', undefined, auth);
    expect(decode(await reader.read())).toBe('event: deleted\ndata: {}\n\n'); expect((await reader.read()).done).toBe(true);
    expect(runtime.subscriberCount()).toBe(0);
  });
  it('heartbeats every 20 seconds and cleans up cancellation', async () => {
    const { event } = await create(); vi.useFakeTimers();
    const stream = await request(`/events/${event.id}/stream`), reader = stream.body!.getReader();
    await reader.read(); expect(runtime.subscriberCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(new TextDecoder().decode((await reader.read()).value)).toBe(': heartbeat\n\n');
    await reader.cancel(); expect(runtime.subscriberCount()).toBe(0);
  });
  it('returns JSON errors, size limits and security headers', async () => {
    for (const path of ['/health', '/unknown', '/events/missing']) {
      const res = await request(path); expect(res.headers.get('x-content-type-options')).toBe('nosniff'); expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'"); expect(res.headers.get('content-security-policy')).toContain('https://fonts.googleapis.com');
    }
    const oversized = await request('/events', 'POST', { ...input, description: 'x'.repeat(66_000) });
    expect(oversized.status).toBe(413); expect((await oversized.json()).error.code).toBe('invalid_input');
    const malformed = await runtime.app.request('/api/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' }); expect(malformed.status).toBe(400);
  });
  it('limits strict endpoints by Cloudflare IP and refills tokens', async () => {
    runtime.close(); runtime = createApp({ databasePath: ':memory:', secret: 'test', trustProxy: 'cloudflare', ttlDays: 0 });
    vi.useFakeTimers();
    const attempt = (ip: string) => runtime.app.request('/api/events', { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip }, body: '{}' });
    for (let i = 0; i < 20; i++) expect((await attempt('1.2.3.4')).status).toBe(400);
    const limited = await attempt('1.2.3.4'); expect(limited.status).toBe(429); expect((await limited.json()).error.code).toBe('rate_limited');
    expect((await attempt('1.2.3.5')).status).toBe(400);
    await vi.advanceTimersByTimeAsync(6000); expect((await attempt('1.2.3.4')).status).toBe(400);
  });
  it.each([undefined, ''])('falls back to distinct socket IPs with Cloudflare header %j', async header => {
    runtime.close(); runtime = createApp({ databasePath: ':memory:', secret: 'test', trustProxy: 'cloudflare', ttlDays: 0 });
    vi.useFakeTimers();
    const attempt = (ip: string) => runtime.app.request('/api/events', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(header === undefined ? {} : { 'CF-Connecting-IP': header }) }, body: '{}',
    }, { incoming: { socket: { remoteAddress: ip } } });
    for (let i = 0; i < 20; i++) expect((await attempt('192.0.2.1')).status).toBe(400);
    expect((await attempt('192.0.2.1')).status).toBe(429);
    expect((await attempt('192.0.2.2')).status).toBe(400);
  });
  it.each([
    [true, undefined, true], [true, '', true], [true, 'false', false],
    [false, undefined, false], [false, 'true', true],
  ] as const)('uses production=%s and COOKIE_SECURE=%s for cookie security', async (production, override, secure) => {
    vi.stubEnv('COOKIE_SECURE', override);
    runtime.close(); runtime = createApp({ databasePath: ':memory:', secret: 'test', production, rateLimit: false, ttlDays: 0 });
    const created = await request('/events', 'POST', input);
    expect(created.headers.get('set-cookie')!.includes('; Secure')).toBe(secure);
    const { event } = await created.json();
    const signed = await request(`/events/${event.id}/session`, 'POST', { name: 'Alice' });
    expect(signed.headers.get('set-cookie')!.includes('; Secure')).toBe(secure);
    const cleared = await request(`/events/${event.id}/session`, 'DELETE');
    expect(cleared.headers.get('set-cookie')!.includes('; Secure')).toBe(secure);
  });
  it('rejects invalid COOKIE_SECURE values', () => {
    vi.stubEnv('COOKIE_SECURE', 'flase');
    expect(() => createApp({ databasePath: ':memory:', secret: 'test' })).toThrow('COOKIE_SECURE must be true or false');
  });
  it('deletes expired events with cascade and preserves active events', async () => {
    runtime.close(); runtime = createApp({ databasePath: ':memory:', secret: 'test', rateLimit: false, ttlDays: 180 });
    const old = await create(); await session(old.event.id); const current = await create();
    runtime.db.prepare('UPDATE events SET updated_at = ? WHERE id = ?').run('2020-01-01T00:00:00.000Z', old.event.id);
    runtime.housekeep(); expect((await request(`/events/${old.event.id}`)).status).toBe(404); expect((await request(`/events/${current.event.id}`)).status).toBe(200);
    expect(runtime.db.prepare('SELECT count(*) AS n FROM participants').get()).toEqual({ n: 0 });
  });
  it('serves SPA fallback, immutable assets, no-cache index, secure cookies and keeps API 404s JSON', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mutual-web-'));
    try {
      mkdirSync(join(dir, 'assets')); writeFileSync(join(dir, 'index.html'), '<html>Mutual</html>'); writeFileSync(join(dir, 'assets', 'app.js'), 'export {};');
      runtime.close(); runtime = createApp({ databasePath: ':memory:', secret: 'test', production: true, webDist: dir, rateLimit: false, ttlDays: 0 });
      const page = await runtime.app.request('/e/example'); expect(await page.text()).toBe('<html>Mutual</html>'); expect(page.headers.get('cache-control')).toBe('no-cache');
      const asset = await runtime.app.request('/assets/app.js'); expect(asset.headers.get('cache-control')).toContain('immutable'); expect(asset.headers.get('content-type')).toContain('javascript');
      expect((await runtime.app.request('/assets/missing.js')).status).toBe(404);
      const api = await request('/unknown'); expect(api.status).toBe(404); expect((await api.json()).error.code).toBe('not_found');
      const created = await request('/events', 'POST', input); expect(created.headers.get('set-cookie')).toContain('Secure');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('uses WAL and restores events, sessions and migrations after restart', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mutual-db-'));
    try {
      runtime.close(); runtime = createApp({ dataDir: dir, secret: 'persisted-key', rateLimit: false, ttlDays: 0 });
      const { event, auth } = await create(); const signed = await session(event.id, 'Alice', 'secret');
      await request(`/events/${event.id}/availability`, 'PUT', { availability: '1212' }, signed.auth);
      expect(runtime.db.pragma('journal_mode', { simple: true })).toBe('wal');
      expect(runtime.db.pragma('user_version', { simple: true })).toBe(2);
      runtime.close(); runtime = createApp({ dataDir: dir, secret: 'persisted-key', rateLimit: false, ttlDays: 0 });
      const restored = await (await request(`/events/${event.id}`, 'GET', undefined, `${auth}; ${signed.auth}`)).json();
      expect(restored.viewer).toEqual({ isAdmin: true, participantId: signed.participant.id });
      expect(restored.participants[0].availability).toBe('1212');
      expect((await session(event.id, 'alice', 'secret')).participant.id).toBe(signed.participant.id);
    } finally {
      runtime.close(); runtime = createApp({ databasePath: ':memory:', secret: 'test', rateLimit: false, ttlDays: 0 });
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('persists a generated session secret and honors SESSION_SECRET', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mutual-secret-'));
    const previous = process.env.SESSION_SECRET;
    try {
      delete process.env.SESSION_SECRET;
      const first = sessionSecret(dir); expect(first).toHaveLength(43); expect(sessionSecret(dir)).toBe(first); expect(readFileSync(join(dir, 'secret'), 'utf8')).toBe(first);
      process.env.SESSION_SECRET = 'configured'; expect(sessionSecret(dir)).toBe('configured');
    } finally { if (previous === undefined) delete process.env.SESSION_SECRET; else process.env.SESSION_SECRET = previous; rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('abuse protections', () => {
  const json = { 'Content-Type': 'application/json' };
  it('rejects non-JSON bodies and cross-origin or sibling-site writes', async () => {
    const { event, auth } = await create();
    const plain = await runtime.app.request(`/api/events/${event.id}/session`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{"name":"Mallory","password":"="}' });
    expect(plain.status).toBe(415);
    for (const headers of [{ Origin: 'https://evil.example' }, { Origin: 'null' }, { 'Sec-Fetch-Site': 'same-site' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
      const res = await runtime.app.request(`/api/events/${event.id}`, { method: 'PATCH', headers: { ...json, ...headers, Cookie: auth }, body: '{"title":"Pwned"}' });
      expect(res.status).toBe(403);
    }
    const deleted = await runtime.app.request(`/api/events/${event.id}`, { method: 'DELETE', headers: { Origin: 'https://evil.example', Cookie: auth } });
    expect(deleted.status).toBe(403);
    const same = await runtime.app.request(`/api/events/${event.id}`, { method: 'PATCH', headers: { ...json, Origin: 'http://localhost', 'Sec-Fetch-Site': 'same-origin', Cookie: auth }, body: '{"title":"Renamed"}' });
    expect(same.status).toBe(200);
    expect((await runtime.app.request(`/api/events/${event.id}`, { headers: { Origin: 'https://evil.example' } })).status).toBe(200);
  });
  it('limits password guesses per participant across many IPs', async () => {
    runtime.close(); runtime = createApp({ databasePath: ':memory:', secret: 'test', trustProxy: 'cloudflare', ttlDays: 0 });
    const { event } = await create(); await session(event.id, 'Alice', 'right');
    const attempt = (i: number, password: string) => runtime.app.request(`/api/events/${event.id}/session`, { method: 'POST', headers: { ...json, 'CF-Connecting-IP': `198.51.100.${i}` }, body: JSON.stringify({ name: 'alice', password }) });
    for (let i = 0; i < 9; i++) expect((await attempt(i, 'wrong')).status).toBe(401);
    expect((await attempt(9, 'right')).status).toBe(200);
    const limited = await attempt(10, 'right'); expect(limited.status).toBe(429); expect(limited.headers.get('retry-after')).toBe('360');
    expect((await attempt(11, 'anything')).status).toBe(429);
    expect((await runtime.app.request(`/api/events/${event.id}/session`, { method: 'POST', headers: { ...json, 'CF-Connecting-IP': '198.51.100.12' }, body: '{"name":"Bob"}' })).status).toBe(200);
  });
  it('groups IPv6 clients by /64 and normalizes IPv4-mapped addresses', () => {
    expect(clientKey('2001:db8:1:2:aaaa::1')).toBe('2001:db8:1:2::/64');
    expect(clientKey('2001:0db8:0001:0002:ffff:ffff:ffff:ffff')).toBe('2001:db8:1:2::/64');
    expect(clientKey('2001:db8::5')).toBe('2001:db8:0:0::/64');
    expect(clientKey('::1')).toBe('0:0:0:0::/64');
    expect(clientKey('::ffff:192.0.2.7')).toBe('192.0.2.7');
    expect(clientKey('192.0.2.7')).toBe('192.0.2.7');
  });
  it('rate limits a rotating IPv6 /64 as one client', async () => {
    runtime.close(); runtime = createApp({ databasePath: ':memory:', secret: 'test', trustProxy: 'cloudflare', ttlDays: 0 });
    const attempt = (ip: string) => runtime.app.request('/api/events', { method: 'POST', headers: { ...json, 'CF-Connecting-IP': ip }, body: '{}' });
    for (let i = 0; i < 20; i++) expect((await attempt(`2001:db8:1:2::${(i + 1).toString(16)}`)).status).toBe(400);
    expect((await attempt('2001:db8:1:2:ffff::1')).status).toBe(429);
    expect((await attempt('2001:db8:1:3::1')).status).toBe(400);
  });
  it('caps live update connections per IP, per event and in total', async () => {
    runtime.close(); runtime = createApp({ databasePath: ':memory:', secret: 'test', trustProxy: 'cloudflare', rateLimit: false, ttlDays: 0, streamLimits: { perIp: 2, perEvent: 3, total: 4 } });
    const one = (await create()).event.id, two = (await create()).event.id;
    const open = (id: string, ip: string) => runtime.app.request(`/api/events/${id}/stream`, { headers: { 'CF-Connecting-IP': ip } });
    const a = await open(one, '192.0.2.1'); await open(one, '192.0.2.1');
    const tooMany = await open(one, '192.0.2.1'); expect(tooMany.status).toBe(429); expect(tooMany.headers.get('retry-after')).toBe('30');
    await open(one, '192.0.2.2'); expect((await open(one, '192.0.2.3')).status).toBe(429);
    await open(two, '192.0.2.3'); expect((await open(two, '192.0.2.4')).status).toBe(429);
    expect(runtime.subscriberCount()).toBe(4);
    await a.body!.cancel(); expect(runtime.subscriberCount()).toBe(3);
    expect((await open(one, '192.0.2.1')).status).toBe(200);
  });
  it('keeps rate limits across a restart', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mutual-limits-'));
    try {
      runtime.close(); runtime = createApp({ dataDir: dir, secret: 'test', trustProxy: 'cloudflare', ttlDays: 0 });
      const attempt = () => runtime.app.request('/api/events', { method: 'POST', headers: { ...json, 'CF-Connecting-IP': '203.0.113.9' }, body: '{}' });
      for (let i = 0; i < 20; i++) await attempt();
      expect((await attempt()).status).toBe(429);
      runtime.close(); runtime = createApp({ dataDir: dir, secret: 'test', trustProxy: 'cloudflare', ttlDays: 0 });
      expect((await attempt()).status).toBe(429);
    } finally {
      runtime.close(); runtime = createApp({ databasePath: ':memory:', secret: 'test', rateLimit: false, ttlDays: 0 });
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
