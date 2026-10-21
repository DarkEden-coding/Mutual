import Database from 'better-sqlite3';
import { expiryFor, type EventDTO, type ParticipantDTO } from './model.js';
export interface EventRecord { id: string; dto: string; admin_hash: string; updated_at: string; expires_at: string }
export interface ParticipantRecord { id: string; event_id: string; name: string; name_key: string; password_salt: string | null; password_hash: string | null; availability: string; updated_at: string }
export const eventDTO = (row: EventRecord): EventDTO => JSON.parse(row.dto);
export const participantDTO = (row: ParticipantRecord): ParticipantDTO => ({ id: row.id, name: row.name, hasPassword: row.password_hash !== null, availability: row.availability, updatedAt: row.updated_at });
export function openDatabase(filename: string) {
  const db = new Database(filename);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.transaction(() => {
    const version = db.pragma('user_version', { simple: true }) as number;
    if (version > 4) throw new Error('Database schema is newer than this server');
    if (version < 1) {
      db.exec(`
        CREATE TABLE events (id TEXT PRIMARY KEY COLLATE NOCASE, dto TEXT NOT NULL, admin_hash TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE TABLE participants (id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
          name TEXT NOT NULL, name_key TEXT NOT NULL, password_salt TEXT, password_hash TEXT,
          availability TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(event_id, name_key));
        CREATE INDEX events_updated ON events(updated_at);
        CREATE INDEX participants_event ON participants(event_id);
        PRAGMA user_version = 1;
      `);
    }
    if (version < 2) {
      // Rate-limit buckets are saved on shutdown so a restart does not reset brute-force limits.
      db.exec(`
        CREATE TABLE rate_limits (key TEXT PRIMARY KEY, tokens REAL NOT NULL, updated INTEGER NOT NULL);
        PRAGMA user_version = 2;
      `);
    }
    if (version < 3) {
      // Events now carry their own deletion date. Existing ones get the default keep-alive, and at
      // least a month from now, so the upgrade never deletes anything straight away.
      db.exec('ALTER TABLE events ADD COLUMN expires_at TEXT NOT NULL DEFAULT \'\'');
      const update = db.prepare('UPDATE events SET dto = ?, expires_at = ? WHERE id = ?');
      for (const row of db.prepare('SELECT id, dto FROM events').all() as EventRecord[]) {
        const event: EventDTO = { ...JSON.parse(row.dto), keepMonths: 1 };
        event.expiresAt = expiryFor(event, 1);
        update.run(JSON.stringify(event), event.expiresAt, row.id);
      }
      db.exec(`
        DROP INDEX events_updated;
        CREATE INDEX events_expires ON events(expires_at);
        PRAGMA user_version = 3;
      `);
    }
    if (version < 4) {
      db.exec(`
        CREATE TABLE daily_stats (day TEXT PRIMARY KEY, active_events INTEGER, unique_people INTEGER,
          events_created INTEGER NOT NULL DEFAULT 0, participants_joined INTEGER NOT NULL DEFAULT 0,
          availability_saves INTEGER NOT NULL DEFAULT 0, throttled INTEGER NOT NULL DEFAULT 0);
        INSERT INTO daily_stats (day, events_created)
          SELECT substr(json_extract(dto, '$.createdAt'), 1, 10), count(*) FROM events
          WHERE json_valid(dto) AND length(json_extract(dto, '$.createdAt')) >= 10 GROUP BY 1;
        PRAGMA user_version = 4;
      `);
    }
  })();
  return db;
}
export function statements(db: Database.Database) {
  return {
    adminEvents: db.prepare(`SELECT count(*) AS total,
      coalesce(sum((SELECT count(*) FROM participants p WHERE p.event_id = e.id) >= 2), 0) AS active,
      coalesce(sum(json_extract(dto, '$.createdAt') >= @since), 0) AS createdLast30Days,
      coalesce(sum(json_extract(dto, '$.mode') = 'dates'), 0) AS dates,
      coalesce(sum(json_extract(dto, '$.mode') = 'weekdays'), 0) AS weekdays,
      coalesce(sum(expires_at <= @soon), 0) AS expiringWithin7Days FROM events e WHERE expires_at > @now`),
    adminPeople: db.prepare(`SELECT count(DISTINCT p.name_key) AS uniquePeople, count(*) AS entries,
      coalesce(sum(p.password_hash IS NOT NULL), 0) AS withPassword,
      coalesce(sum(p.availability GLOB '*[12]*'), 0) AS responded
      FROM participants p JOIN events e ON e.id = p.event_id WHERE e.expires_at > ?`),
    adminTopEvents: db.prepare(`SELECT e.id, json_extract(e.dto, '$.title') AS title, count(p.id) AS participants,
      e.updated_at AS updatedAt, e.expires_at AS expiresAt FROM events e
      LEFT JOIN participants p ON p.event_id = e.id WHERE e.expires_at > ? GROUP BY e.id
      ORDER BY participants DESC, e.updated_at DESC, e.id LIMIT 8`),
    dailyStats: db.prepare('SELECT * FROM daily_stats WHERE day >= ? ORDER BY day'),
    incrementDailyStats: db.prepare(`INSERT INTO daily_stats (day, events_created, participants_joined, availability_saves, throttled)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(day) DO UPDATE SET events_created = events_created + excluded.events_created,
      participants_joined = participants_joined + excluded.participants_joined,
      availability_saves = availability_saves + excluded.availability_saves, throttled = throttled + excluded.throttled`),
    snapshotDailyStats: db.prepare(`INSERT INTO daily_stats (day, active_events, unique_people) VALUES (?, ?, ?)
      ON CONFLICT(day) DO UPDATE SET active_events = excluded.active_events, unique_people = excluded.unique_people`),
    pruneDailyStats: db.prepare('DELETE FROM daily_stats WHERE day < ?'),
    event: db.prepare('SELECT * FROM events WHERE id = ?'),
    insertEvent: db.prepare('INSERT INTO events (id, dto, admin_hash, updated_at, expires_at) VALUES (?, ?, ?, ?, ?)'),
    updateEvent: db.prepare('UPDATE events SET dto = ?, updated_at = ?, expires_at = ? WHERE id = ?'),
    deleteEvent: db.prepare('DELETE FROM events WHERE id = ?'),
    expiredEvents: db.prepare('SELECT id FROM events WHERE expires_at <= ?'),
    participants: db.prepare('SELECT * FROM participants WHERE event_id = ? ORDER BY rowid'),
    participant: db.prepare('SELECT * FROM participants WHERE event_id = ? AND id = ?'),
    name: db.prepare('SELECT * FROM participants WHERE event_id = ? AND name_key = ?'),
    insertParticipant: db.prepare('INSERT INTO participants (id, event_id, name, name_key, password_salt, password_hash, availability, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
    availability: db.prepare('UPDATE participants SET availability = ?, updated_at = ? WHERE id = ?'),
    rateLimits: db.prepare('SELECT key, tokens, updated FROM rate_limits WHERE updated > ?'),
    clearRateLimits: db.prepare('DELETE FROM rate_limits'),
    insertRateLimit: db.prepare('INSERT INTO rate_limits (key, tokens, updated) VALUES (?, ?, ?)'),
  };
}
