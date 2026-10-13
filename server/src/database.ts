import Database from 'better-sqlite3';
import type { EventDTO, ParticipantDTO } from './model.js';
export interface EventRecord { id: string; dto: string; admin_hash: string; updated_at: string }
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
    if (version > 2) throw new Error('Database schema is newer than this server');
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
  })();
  return db;
}
export function statements(db: Database.Database) {
  return {
    event: db.prepare('SELECT * FROM events WHERE id = ?'),
    insertEvent: db.prepare('INSERT INTO events (id, dto, admin_hash, updated_at) VALUES (?, ?, ?, ?)'),
    updateEvent: db.prepare('UPDATE events SET dto = ?, updated_at = ? WHERE id = ?'),
    deleteEvent: db.prepare('DELETE FROM events WHERE id = ?'),
    staleEvents: db.prepare('SELECT id FROM events WHERE updated_at < ?'),
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
