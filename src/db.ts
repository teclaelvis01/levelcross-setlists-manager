import Database = require('better-sqlite3');
import path from 'path';
import fs from 'fs';

const dbPath = path.join(__dirname, '..', 'data', 'setlists.db');

const dataDir = path.join(__dirname, '..', 'data');
const uploadsDir = path.join(__dirname, '..', 'data', 'uploads');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

export function openDatabase() {
  const instance = new Database(dbPath);
  instance.pragma('journal_mode = WAL');
  return instance;
}

const db = openDatabase();

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS songs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL UNIQUE,
    slug TEXT NOT NULL UNIQUE,
    artist TEXT DEFAULT '',
    lyrics TEXT DEFAULT '',
    audio_url TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Migration: add slug column if upgrading from a previous version
const hasSlugCol = db.prepare("SELECT COUNT(*) as count FROM pragma_table_info('songs') WHERE name = 'slug'").get() as { count: number };
if (hasSlugCol.count === 0) {
  db.exec(`ALTER TABLE songs ADD COLUMN slug TEXT DEFAULT ''`);
}
// Remove UNIQUE constraint on title if it existed before (we handle uniqueness via app logic + slug)
// Remove the unique index on title to allow slug-based uniqueness
try { db.exec('DROP INDEX IF EXISTS songs_title_unique'); } catch {}
try { db.exec('DROP INDEX IF EXISTS sqlite_autoindex_songs_1'); } catch {}
// Ensure we have a unique index on slug
try { db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_songs_slug ON songs(slug)'); } catch {}

export default db;