import Database = require('better-sqlite3');
import path from 'path';
import fs from 'fs';
import bcrypt from 'bcryptjs';

const dbPath = path.join(__dirname, '..', 'data', 'setlists.db');

const dataDir = path.join(__dirname, '..', 'data');
const uploadsDir = path.join(__dirname, '..', 'data', 'uploads');
const peopleUploadsDir = path.join(uploadsDir, 'people');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
if (!fs.existsSync(peopleUploadsDir)) {
  fs.mkdirSync(peopleUploadsDir, { recursive: true });
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

db.exec(`
  CREATE TABLE IF NOT EXISTS people (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    photo_url TEXT DEFAULT '',
    deleted_at DATETIME DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS person_roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    person_id INTEGER NOT NULL,
    role TEXT NOT NULL,
    FOREIGN KEY(person_id) REFERENCES people(id) ON DELETE CASCADE
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS activities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    activity_date TEXT NOT NULL,
    activity_time TEXT DEFAULT '',
    detail TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS activity_songs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    activity_id INTEGER NOT NULL,
    song_id INTEGER NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY(activity_id) REFERENCES activities(id) ON DELETE CASCADE,
    FOREIGN KEY(song_id) REFERENCES songs(id) ON DELETE CASCADE
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS activity_people (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    activity_id INTEGER NOT NULL,
    person_id INTEGER NOT NULL,
    FOREIGN KEY(activity_id) REFERENCES activities(id) ON DELETE CASCADE,
    FOREIGN KEY(person_id) REFERENCES people(id) ON DELETE CASCADE
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS activity_person_roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    activity_id INTEGER NOT NULL,
    person_id INTEGER NOT NULL,
    role TEXT NOT NULL,
    FOREIGN KEY(activity_id) REFERENCES activities(id) ON DELETE CASCADE,
    FOREIGN KEY(person_id) REFERENCES people(id) ON DELETE CASCADE,
    UNIQUE(activity_id, person_id, role)
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS musical_roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    position INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

const defaultMusicalRoles = [
  'Bajo',
  'Guitarra eléctrica',
  'Guitarra acústica',
  'Batería',
  'Voz principal',
  'Voces',
  'Técnico de sonido',
];
const musicalRoleCount = db.prepare('SELECT COUNT(*) as count FROM musical_roles').get() as { count: number };
if (musicalRoleCount.count === 0) {
  const insertRole = db.prepare('INSERT INTO musical_roles (name, position) VALUES (?, ?)');
  defaultMusicalRoles.forEach((name, index) => {
    insertRole.run(name, index + 1);
  });
}
// Migration: add slug column if upgrading from a previous version
const hasSlugCol = db.prepare("SELECT COUNT(*) as count FROM pragma_table_info('songs') WHERE name = 'slug'").get() as { count: number };
if (hasSlugCol.count === 0) {
  db.exec(`ALTER TABLE songs ADD COLUMN slug TEXT DEFAULT ''`);
}
const hasActivitySlugCol = db.prepare("SELECT COUNT(*) as count FROM pragma_table_info('activities') WHERE name = 'slug'").get() as { count: number };
if (hasActivitySlugCol.count === 0) {
  db.exec(`ALTER TABLE activities ADD COLUMN slug TEXT DEFAULT ''`);
}
const hasPhotoUrlCol = db.prepare("SELECT COUNT(*) as count FROM pragma_table_info('people') WHERE name = 'photo_url'").get() as { count: number };
if (hasPhotoUrlCol.count === 0) {
  db.exec(`ALTER TABLE people ADD COLUMN photo_url TEXT DEFAULT ''`);
}
const hasPeopleDeletedAtCol = db.prepare("SELECT COUNT(*) as count FROM pragma_table_info('people') WHERE name = 'deleted_at'").get() as { count: number };
if (hasPeopleDeletedAtCol.count === 0) {
  db.exec(`ALTER TABLE people ADD COLUMN deleted_at DATETIME DEFAULT NULL`);
}
const peopleColumns = db.prepare("PRAGMA table_info('people')").all() as Array<{ name: string }>; 
const hasLegacyRoleCol = peopleColumns.some((column) => column.name === 'role');
if (hasLegacyRoleCol) {
  const legacyRows = db.prepare("SELECT id, role FROM people WHERE role IS NOT NULL AND TRIM(role) != ''").all() as { id: number; role: string }[];
  for (const row of legacyRows) {
    const existing = db.prepare('SELECT id FROM person_roles WHERE person_id = ? AND role = ?').get(row.id, row.role) as { id: number } | undefined;
    if (!existing) {
      db.prepare('INSERT INTO person_roles (person_id, role) VALUES (?, ?)').run(row.id, row.role);
    }
  }

  try {
    db.exec('ALTER TABLE people DROP COLUMN role');
  } catch {
    const tempTable = 'people_legacy_backup';
    db.exec(`ALTER TABLE people RENAME TO ${tempTable}`);
    db.exec(`CREATE TABLE people (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      photo_url TEXT DEFAULT '',
      deleted_at DATETIME DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    db.exec(`INSERT INTO people (id, name, photo_url, created_at)
      SELECT id, name, photo_url, created_at FROM ${tempTable}`);
    db.exec(`DROP TABLE ${tempTable}`);
  }
}
// Remove UNIQUE constraint on title if it existed before (we handle uniqueness via app logic + slug)
// Remove the unique index on title to allow slug-based uniqueness
try { db.exec('DROP INDEX IF EXISTS songs_title_unique'); } catch {}
try { db.exec('DROP INDEX IF EXISTS sqlite_autoindex_songs_1'); } catch {}
// Ensure we have a unique index on slug
try { db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_songs_slug ON songs(slug)'); } catch {}
try { db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_activities_slug ON activities(slug)'); } catch {}

// Ensure a default admin user exists for fresh deployments.
// This keeps the initial login flow working even when the database was just created.
const defaultAdminUsername = process.env.DEFAULT_ADMIN_USERNAME || 'admin';
const defaultAdminPassword = process.env.DEFAULT_ADMIN_PASSWORD || 'admin';
const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
if (userCount.count === 0) {
  const passwordHash = bcrypt.hashSync(defaultAdminPassword, 10);
  db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(defaultAdminUsername, passwordHash);
}

export default db;