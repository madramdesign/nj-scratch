import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MIGRATIONS } from './migrations.ts';

export type DB = DatabaseSync;

export const DEFAULT_DB_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../../../data/njscratch.db');

export const SOURCES = {
  official: { key: 'njlottery-api', name: 'NJ Lottery instant-games API (official)', url: 'https://www.njlottery.com/api/v1/instant-games/games/?size=1000', isOfficial: 1 },
  archive: { key: 'internet-archive', name: 'Internet Archive capture of the official NJ Lottery API', url: 'https://web.archive.org/', isOfficial: 1 },
} as const;
export type SourceKey = keyof typeof SOURCES;

export function openDatabase(path = process.env.NJ_DB_PATH ?? DEFAULT_DB_PATH): DB {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

export function migrate(db: DB): number[] {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)');
  const applied = new Set((db.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: number }>).map((r) => r.version));
  const ran: number[] = [];
  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue;
    transaction(db, () => {
      db.exec(m.sql);
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(m.version, m.name, Date.now());
    });
    ran.push(m.version);
  }
  for (const s of Object.values(SOURCES)) {
    db.prepare('INSERT INTO data_sources (key, name, url, is_official) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET name = excluded.name, url = excluded.url').run(s.key, s.name, s.url, s.isOfficial);
  }
  return ran;
}

export function transaction<T>(db: DB, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
