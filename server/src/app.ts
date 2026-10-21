import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono, type Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { bodyLimit } from 'hono/body-limit';
import { getConnInfo } from '@hono/node-server/conninfo';
import type { z } from 'zod';
import { openDatabase, statements, eventDTO, participantDTO, type EventRecord, type ParticipantRecord } from './database.js';
import { createSchema, eventFields, patchSchema, sessionSchema, availabilitySchema, adminSchema, checkEvent, sortDays, totalSlots, remap, validSlug, type EventDTO } from './model.js';
import { equal, tokenHash, hashPassword, verifyPassword, sessionSecret, signParticipant, readParticipant, clientKey, RateLimiter, type Bucket } from './security.js';

class ApiError extends Error {
  constructor(public status: 400 | 401 | 403 | 404 | 409 | 413 | 415 | 429, public code: string, message: string, public retryAfter = 6) { super(message); }
}
interface StreamLimits { perIp: number; perEvent: number; total: number }
interface Options { databasePath?: string; dataDir?: string; secret?: string; production?: boolean; webDist?: string; trustProxy?: string; rateLimit?: boolean; ttlDays?: number; streamLimits?: StreamLimits }
export function createApp(options: Options = {}) {
  const production = options.production ?? process.env.NODE_ENV === 'production';
  const cookieSecureEnv = process.env.COOKIE_SECURE;
  if (cookieSecureEnv && cookieSecureEnv !== 'true' && cookieSecureEnv !== 'false') throw new Error('COOKIE_SECURE must be true or false');
  const cookieSecure = cookieSecureEnv ? cookieSecureEnv === 'true' : production;
  const dataDir = resolve(options.dataDir ?? process.env.DATA_DIR ?? './data');
  const filename = options.databasePath ?? resolve(dataDir, 'mutual.sqlite');
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
  const db = openDatabase(filename), sql = statements(db);
  const secret = options.secret ?? sessionSecret(dataDir);
  const webDist = resolve(options.webDist ?? process.env.WEB_DIST ?? fileURLToPath(new URL('../../web/dist', import.meta.url)));
  const proxy = options.trustProxy ?? process.env.TRUST_PROXY;
  const limiter = new RateLimiter();
  limiter.restore(sql.rateLimits.all(Date.now() - 3_600_000) as Bucket[]);
  const streamLimits = options.streamLimits ?? { perIp: 20, perEvent: 300, total: 2000 };
  const streamsByIp = new Map<string, number>();
  const app = new Hono<{ Variables: { ip: string } }>();
  const subscribers = new Map<string, Set<{ send: (chunk: Uint8Array) => void; close: () => void }>>();
  const encoder = new TextEncoder();
  const heartbeatChunk = encoder.encode(': heartbeat\n\n'), connectedChunk = encoder.encode(': connected\n\n');
  function broadcast(id: string, event: string, data: unknown) {
    const set = subscribers.get(id);
    if (!set) return;
    // Encode once and share the chunk: an event payload carries every participant's availability.
    const chunk = encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    for (const subscriber of [...set]) {
      subscriber.send(chunk);
      if (event === 'deleted') subscriber.close();
    }
  }
  const cookieOptions = { httpOnly: true, sameSite: 'Lax' as const, secure: cookieSecure, path: '/', maxAge: 365 * 24 * 60 * 60 };
  const findEvent = (id: string) => {
    const row = sql.event.get(id) as EventRecord | undefined;
    if (!row) throw new ApiError(404, 'not_found', 'Event not found');
    return row;
  };
  const participants = (id: string) => (sql.participants.all(id) as ParticipantRecord[]).map(participantDTO);
  const isAdmin = (c: Context, row: EventRecord) => {
    const cookie = getCookie(c, `mutual_admin_${row.id}`);
    return !!cookie && equal(tokenHash(cookie), row.admin_hash);
  };
  const viewer = (c: Context, row: EventRecord) => {
    const id = readParticipant(secret, row.id, getCookie(c, `mutual_p_${row.id}`));
    return { isAdmin: isAdmin(c, row), participantId: id && sql.participant.get(row.id, id) ? id : null };
  };
  const requireAdmin = (c: Context, row: EventRecord) => {
    if (!isAdmin(c, row)) throw new ApiError(403, 'forbidden', 'Admin access required');
  };
  async function parse<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
    // Requiring JSON forces a CORS preflight, so HTML forms on other sites cannot submit these bodies.
    if (!/^application\/json\s*(;|$)/i.test(c.req.header('Content-Type') ?? '')) throw new ApiError(415, 'invalid_input', 'Expected Content-Type: application/json');
    let body: unknown;
    try { body = await c.req.json(); } catch { throw new ApiError(400, 'invalid_input', 'Expected a JSON body'); }
    const result = schema.safeParse(body);
    if (!result.success) throw new ApiError(400, 'invalid_input', result.error.issues.map(issue => `${issue.path.join('.') || 'body'}: ${issue.message}`).join('; '));
    return result.data;
  }
  function touch(row: EventRecord) {
    const event = { ...eventDTO(row), updatedAt: new Date().toISOString() };
    sql.updateEvent.run(JSON.stringify(event), event.updatedAt, event.id);
  }
  app.use('*', async (c, next) => {
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    c.header('X-Frame-Options', 'DENY');
    c.header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
    if (c.req.path === '/api' || c.req.path.startsWith('/api/')) {
      if (!c.res.headers.has('Cache-Control')) c.header('Cache-Control', 'no-store');
    }
  });
  app.use('*', bodyLimit({ maxSize: 64 * 1024, onError: c => c.json({ error: { code: 'invalid_input', message: 'Request body exceeds 64 KiB' } }, 413) }));
  app.use('/api/*', async (c, next) => {
    let socket = 'unknown';
    try { socket = getConnInfo(c).remote.address ?? socket; } catch { /* app.request has no socket */ }
    const ip = clientKey(proxy === 'cloudflare' ? c.req.header('CF-Connecting-IP') || socket : socket);
    c.set('ip', ip);
    if (options.rateLimit !== false) {
      if (!limiter.take(`all:${ip}`, 240, 4)) throw new ApiError(429, 'rate_limited', 'Too many requests');
      if (c.req.method === 'POST' && (c.req.path === '/api/events' || /\/(session|admin)$/.test(c.req.path))) {
        if (!limiter.take(`auth:${ip}`, 20, 1 / 6)) throw new ApiError(429, 'rate_limited', 'Too many create or sign-in attempts');
      }
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
      // SameSite=Lax still sends cookies from sibling subdomains, so reject anything not from this exact origin.
      const site = c.req.header('Sec-Fetch-Site'), origin = c.req.header('Origin');
      let sameOrigin = !origin;
      if (origin) try { sameOrigin = new URL(origin).host === new URL(c.req.url).host; } catch { /* "null" or malformed */ }
      if (!sameOrigin || (site && site !== 'same-origin' && site !== 'none')) throw new ApiError(403, 'forbidden', 'Cross-origin request rejected');
    }
    await next();
  });
  app.onError((error, c) => {
    if (error instanceof ApiError) {
      if (error.status === 429) c.header('Retry-After', String(error.retryAfter));
      return c.json({ error: { code: error.code, message: error.message } }, error.status);
    }
    console.error(error);
    return c.json({ error: { code: 'internal_error', message: 'Internal server error' } }, 500);
  });
  app.get('/api/health', c => c.json({ ok: true }));
  app.get('/api/slugs/:slug', c => {
    const slug = c.req.param('slug'), valid = validSlug(slug);
    return c.json({ available: valid && !sql.event.get(slug), valid });
  });
  app.post('/api/events', async c => {
    const { slug, ...input } = await parse(c, createSchema);
    let id = slug;
    if (id && sql.event.get(id)) throw new ApiError(409, 'slug_taken', 'This slug is already in use');
    const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
    if (!id) do { id = Array.from({ length: 10 }, () => alphabet[randomInt(alphabet.length)]).join(''); } while (sql.event.get(id));
    const now = new Date().toISOString();
    const event: EventDTO = sortDays({ ...input, id, createdAt: now, updatedAt: now });
    const adminToken = randomBytes(32).toString('base64url');
    sql.insertEvent.run(id, JSON.stringify(event), tokenHash(adminToken), now);
    setCookie(c, `mutual_admin_${id}`, adminToken, cookieOptions);
    return c.json({ event, adminToken }, 201);
  });
  app.get('/api/events/:id', c => {
    const row = findEvent(c.req.param('id'));
    return c.json({ event: eventDTO(row), participants: participants(row.id), viewer: viewer(c, row) });
  });
  app.patch('/api/events/:id', async c => {
    let row = findEvent(c.req.param('id'));
    requireAdmin(c, row);
    const patch = await parse(c, patchSchema);
    row = findEvent(row.id);
    requireAdmin(c, row);
    const previous = eventDTO(row);
    // DTO metadata is deliberately removed before validating the editable event fields.
    const { id: _id, createdAt: _created, updatedAt: _updated, ...fields } = previous;
    const result = eventFields.safeParse({ ...fields, ...patch });
    if (!result.success || !checkEvent(result.data)) throw new ApiError(400, 'invalid_input', 'Invalid event days or hours');
    const event: EventDTO = sortDays({ ...previous, ...result.data, updatedAt: new Date().toISOString() });
    db.transaction(() => {
      for (const participant of sql.participants.all(row.id) as ParticipantRecord[]) sql.availability.run(remap(previous, event, participant.availability), event.updatedAt, participant.id);
      sql.updateEvent.run(JSON.stringify(event), event.updatedAt, row.id);
    })();
    const payload = { event, participants: participants(row.id) };
    broadcast(row.id, 'event', payload);
    return c.json(payload);
  });
  app.delete('/api/events/:id', c => {
    const row = findEvent(c.req.param('id')); requireAdmin(c, row);
    sql.deleteEvent.run(row.id);
    broadcast(row.id, 'deleted', {});
    deleteCookie(c, `mutual_admin_${row.id}`, cookieOptions);
    deleteCookie(c, `mutual_p_${row.id}`, cookieOptions);
    return c.body(null, 204);
  });
  app.post('/api/events/:id/admin', async c => {
    const id = findEvent(c.req.param('id')).id;
    const { token } = await parse(c, adminSchema);
    const row = findEvent(id);
    if (!equal(tokenHash(token), row.admin_hash)) throw new ApiError(403, 'forbidden', 'Invalid admin token');
    setCookie(c, `mutual_admin_${row.id}`, token, cookieOptions);
    return c.json({ viewer: { ...viewer(c, row), isAdmin: true } });
  });
  // Per-participant limit, so guesses spread across many IPs still cannot brute-force one password.
  const checkPassword = async (participant: ParticipantRecord, password: string) => {
    if (!participant.password_hash) return;
    if (options.rateLimit !== false && !limiter.take(`password:${participant.id}`, 10, 10 / 3600)) throw new ApiError(429, 'rate_limited', 'Too many password attempts for this name. Try again later.', 360);
    if (!await verifyPassword(password, participant.password_salt!, participant.password_hash)) throw new ApiError(401, 'wrong_password', 'Incorrect password');
  };
  app.post('/api/events/:id/session', async c => {
    const id = findEvent(c.req.param('id')).id;
    const { name, password } = await parse(c, sessionSchema);
    const key = name.toLowerCase();
    let participant = sql.name.get(id, key) as ParticipantRecord | undefined;
    if (participant) await checkPassword(participant, password);
    if (!participant) {
      const hashed = password ? await hashPassword(password) : null;
      const row = findEvent(id);
      // A competing request may have created the name while scrypt was running.
      participant = sql.name.get(id, key) as ParticipantRecord | undefined;
      if (participant) {
        await checkPassword(participant, password);
      } else {
        if (participants(id).length >= 200) throw new ApiError(409, 'too_many_participants', 'This event already has 200 participants');
        const participantId = randomUUID(), now = new Date().toISOString();
        db.transaction(() => {
          sql.insertParticipant.run(participantId, id, name, key, hashed?.salt ?? null, hashed?.hash ?? null, '0'.repeat(totalSlots(eventDTO(row))), now);
          touch(row);
        })();
        participant = sql.participant.get(id, participantId) as ParticipantRecord;
        broadcast(id, 'participant', participantDTO(participant));
      }
    }
    const row = findEvent(id);
    participant = sql.participant.get(id, participant.id) as ParticipantRecord;
    setCookie(c, `mutual_p_${id}`, signParticipant(secret, id, participant.id), cookieOptions);
    return c.json({ participant: participantDTO(participant), viewer: { isAdmin: isAdmin(c, row), participantId: participant.id } });
  });
  app.delete('/api/events/:id/session', c => {
    const row = findEvent(c.req.param('id'));
    deleteCookie(c, `mutual_p_${row.id}`, cookieOptions);
    return c.body(null, 204);
  });
  app.put('/api/events/:id/availability', async c => {
    const id = findEvent(c.req.param('id')).id;
    const { availability } = await parse(c, availabilitySchema);
    const row = findEvent(id), participantId = viewer(c, row).participantId;
    if (!participantId) throw new ApiError(401, 'unauthorized', 'Sign in to save availability');
    if (availability.length !== totalSlots(eventDTO(row))) throw new ApiError(400, 'invalid_input', 'Availability length must equal totalSlots');
    db.transaction(() => { sql.availability.run(availability, new Date().toISOString(), participantId); touch(row); })();
    const participant = participantDTO(sql.participant.get(id, participantId) as ParticipantRecord);
    broadcast(id, 'participant', participant);
    return c.json({ participant });
  });
  app.get('/api/events/:id/stream', c => {
    const id = findEvent(c.req.param('id')).id, ip = c.get('ip');
    const total = [...subscribers.values()].reduce((sum, set) => sum + set.size, 0);
    if ((streamsByIp.get(ip) ?? 0) >= streamLimits.perIp || (subscribers.get(id)?.size ?? 0) >= streamLimits.perEvent || total >= streamLimits.total) {
      throw new ApiError(429, 'rate_limited', 'Too many live update connections', 30);
    }
    let cleanup = () => {};
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        let closed = false;
        const close = () => { if (closed) return; closed = true; cleanup(); controller.close(); };
        const enqueue = (chunk: Uint8Array) => {
          if (closed) return;
          if ((controller.desiredSize ?? 0) < -64) { close(); return; }
          controller.enqueue(chunk);
        };
        const subscriber = { send: enqueue, close };
        const set = subscribers.get(id) ?? new Set();
        set.add(subscriber); subscribers.set(id, set);
        streamsByIp.set(ip, (streamsByIp.get(ip) ?? 0) + 1);
        let released = false;
        const heartbeat = setInterval(() => enqueue(heartbeatChunk), 20_000);
        heartbeat.unref();
        cleanup = () => {
          closed = true; clearInterval(heartbeat); set.delete(subscriber); if (!set.size) subscribers.delete(id); c.req.raw.signal.removeEventListener('abort', close);
          if (released) return;
          released = true;
          const count = (streamsByIp.get(ip) ?? 1) - 1;
          if (count > 0) streamsByIp.set(ip, count); else streamsByIp.delete(ip);
        };
        c.req.raw.signal.addEventListener('abort', close, { once: true });
        if (c.req.raw.signal.aborted) close(); else enqueue(connectedChunk);
      },
      cancel() { cleanup(); },
    });
    return c.newResponse(body, 200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' });
  });
  const mime: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.webp': 'image/webp', '.txt': 'text/plain; charset=utf-8' };
  app.get('*', async c => {
    if (!production || c.req.path === '/api' || c.req.path.startsWith('/api/')) throw new ApiError(404, 'not_found', 'Not found');
    let path: string;
    try { path = resolve(webDist, `.${decodeURIComponent(c.req.path)}`); } catch { throw new ApiError(404, 'not_found', 'Not found'); }
    if (path !== webDist && !path.startsWith(webDist + sep)) throw new ApiError(404, 'not_found', 'Not found');
    try { if (!(await stat(path)).isFile()) path = resolve(webDist, 'index.html'); }
    catch { if (c.req.path.startsWith('/assets/')) throw new ApiError(404, 'not_found', 'Asset not found'); path = resolve(webDist, 'index.html'); }
    try {
      const content = await readFile(path);
      c.header('Content-Type', mime[extname(path)] ?? 'application/octet-stream');
      c.header('Cache-Control', c.req.path.startsWith('/assets/') && extname(path) !== '.html' ? 'public, max-age=31536000, immutable' : 'no-cache');
      return c.body(content);
    } catch { throw new ApiError(404, 'not_found', 'Web build not found'); }
  });
  app.notFound(c => c.json({ error: { code: 'not_found', message: 'Not found' } }, 404));
  const ttlDays = options.ttlDays ?? Number(process.env.EVENT_TTL_DAYS ?? 180);
  if (!Number.isFinite(ttlDays) || ttlDays < 0) { db.close(); throw new Error('EVENT_TTL_DAYS must be a non-negative number'); }
  function housekeep() {
    if (!ttlDays) return;
    const cutoff = new Date(Date.now() - ttlDays * 86_400_000).toISOString();
    for (const { id } of sql.staleEvents.all(cutoff) as { id: string }[]) { sql.deleteEvent.run(id); broadcast(id, 'deleted', {}); }
  }
  housekeep();
  const housekeeping = ttlDays ? setInterval(housekeep, 86_400_000) : undefined;
  housekeeping?.unref();
  return { app, db, housekeep, subscriberCount: () => [...subscribers.values()].reduce((sum, set) => sum + set.size, 0), close: () => {
    if (!db.open) return;
    if (housekeeping) clearInterval(housekeeping);
    for (const set of [...subscribers.values()]) for (const subscriber of [...set]) subscriber.close();
    db.transaction((buckets: Bucket[]) => {
      sql.clearRateLimits.run();
      for (const { key, tokens, updated } of buckets) sql.insertRateLimit.run(key, tokens, updated);
    })(limiter.snapshot());
    db.close();
  } };
}
