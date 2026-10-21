import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
const derive = promisify(scrypt);
export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
export function equal(a: string, b: string): boolean {
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const hash = (await derive(password, salt, 64) as Buffer).toString('hex');
  return { salt, hash };
}
export async function verifyPassword(password: string, salt: string, hash: string) {
  return equal((await derive(password, salt, 64) as Buffer).toString('hex'), hash);
}
export function sessionSecret(dataDir: string): string {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  mkdirSync(dataDir, { recursive: true });
  const path = join(dataDir, 'secret');
  try { writeFileSync(path, randomBytes(32).toString('base64url'), { flag: 'wx', mode: 0o600 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  const secret = readFileSync(path, 'utf8').trim();
  if (!secret) throw new Error('Session secret file is empty');
  return secret;
}
export function signParticipant(secret: string, eventId: string, id: string): string {
  return `${id}.${createHmac('sha256', secret).update(`${eventId}:${id}`).digest('base64url')}`;
}
export function readParticipant(secret: string, eventId: string, cookie?: string): string | null {
  if (!cookie) return null;
  const index = cookie.lastIndexOf('.');
  if (index < 1) return null;
  const id = cookie.slice(0, index);
  return equal(cookie, signParticipant(secret, eventId, id)) ? id : null;
}
export function signConsole(secret: string, adminHash: string, expiry = Date.now() + 12 * 3_600_000): string {
  const key = createHmac('sha256', secret).update(`console:${adminHash}`).digest();
  return `${expiry}.${createHmac('sha256', key).update(String(expiry)).digest('base64url')}`;
}
export function readConsole(secret: string, adminHash: string, cookie?: string): boolean {
  if (!cookie) return false;
  const expiry = Number(cookie.split('.')[0]);
  return Number.isSafeInteger(expiry) && expiry > Date.now() && equal(cookie, signConsole(secret, adminHash, expiry));
}
/** Rate-limit key for a client address. IPv6 clients usually control a whole /64, so they share one bucket. */
export function clientKey(ip: string): string {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return mapped[1];
  if (!ip.includes(':')) return ip;
  const address = ip.split('%')[0].toLowerCase();
  const [head, tail = ''] = address.split('::');
  const left = head ? head.split(':') : [], right = tail ? tail.split(':') : [];
  const groups = address.includes('::') ? [...left, ...Array<string>(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right] : left;
  return `${groups.slice(0, 4).map(group => group.replace(/^0+(?=.)/, '')).join(':')}::/64`;
}
export interface Bucket { key: string; tokens: number; updated: number }
export class RateLimiter {
  private buckets = new Map<string, { tokens: number; updated: number }>();
  private calls = 0;
  /** Buckets touched within the last hour, for persisting across restarts. */
  snapshot(now = Date.now()): Bucket[] { return this.liveBuckets(now); }
  liveBuckets(now = Date.now()): Bucket[] {
    return [...this.buckets].filter(([, bucket]) => now - bucket.updated < 3_600_000).map(([key, bucket]) => ({ key, ...bucket }));
  }
  restore(buckets: Bucket[]) {
    for (const { key, tokens, updated } of buckets) this.buckets.set(key, { tokens, updated });
  }
  peek(key: string, capacity: number, refillPerSecond: number) {
    const bucket = this.buckets.get(key);
    return (bucket ? Math.min(capacity, bucket.tokens + (Date.now() - bucket.updated) / 1000 * refillPerSecond) : capacity) >= 1;
  }
  take(key: string, capacity: number, refillPerSecond: number) {
    const now = Date.now();
    if (++this.calls % 256 === 0) for (const [id, bucket] of this.buckets) if (now - bucket.updated > 3_600_000) this.buckets.delete(id);
    const bucket = this.buckets.get(key) ?? { tokens: capacity, updated: now };
    bucket.tokens = Math.min(capacity, bucket.tokens + (now - bucket.updated) / 1000 * refillPerSecond);
    bucket.updated = now;
    const allowed = bucket.tokens >= 1;
    if (allowed) bucket.tokens--;
    this.buckets.set(key, bucket);
    return allowed;
  }
}
