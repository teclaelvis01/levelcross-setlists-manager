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
    position INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY(activity_id) REFERENCES activities(id) ON DELETE CASCADE,
    FOREIGN KEY(person_id) REFERENCES people(id) ON DELETE CASCADE
  )
`);

const hasActivityPeoplePositionCol = db
  .prepare("SELECT COUNT(*) as count FROM pragma_table_info('activity_people') WHERE name = 'position'")
  .get() as { count: number };
if (hasActivityPeoplePositionCol.count === 0) {
  db.exec(`ALTER TABLE activity_people ADD COLUMN position INTEGER NOT NULL DEFAULT 0`);
  const activityIds = db.prepare('SELECT DISTINCT activity_id FROM activity_people').all() as Array<{ activity_id: number }>;
  const updatePos = db.prepare('UPDATE activity_people SET position = ? WHERE id = ?');
  for (const row of activityIds) {
    const peopleRows = db.prepare(`
      SELECT a_p.id
      FROM activity_people a_p
      JOIN people p ON p.id = a_p.person_id
      WHERE a_p.activity_id = ?
      ORDER BY p.name ASC, a_p.id ASC
    `).all(row.activity_id) as Array<{ id: number }>;
    peopleRows.forEach((personRow, index) => {
      updatePos.run(index + 1, personRow.id);
    });
  }
}

db.exec(`
  CREATE TABLE IF NOT EXISTS activity_person_category_order (
    activity_id INTEGER NOT NULL,
    category TEXT NOT NULL,
    person_id INTEGER NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (activity_id, category, person_id),
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
    category TEXT NOT NULL DEFAULT 'Otros',
    position INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

function inferRoleCategory(name: string): string {
  const normalized = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

  if (normalized.includes('sonido')) return 'Sonido';
  if (
    normalized.includes('voz') ||
    normalized === 'voces' ||
    normalized.includes('cantante') ||
    normalized.includes('director')
  ) {
    return 'Cantantes';
  }
  if (
    normalized.includes('bajo') ||
    normalized.includes('guitarra') ||
    normalized.includes('bater') ||
    normalized.includes('teclado') ||
    normalized.includes('piano') ||
    normalized.includes('violin') ||
    normalized.includes('sax') ||
    normalized.includes('trompet') ||
    normalized.includes('percusion') ||
    normalized.includes('ukelele') ||
    normalized.includes('ukulele')
  ) {
    return 'Músicos';
  }
  return 'Otros';
}

const hasMusicalRoleCategoryCol = db
  .prepare("SELECT COUNT(*) as count FROM pragma_table_info('musical_roles') WHERE name = 'category'")
  .get() as { count: number };
if (hasMusicalRoleCategoryCol.count === 0) {
  db.exec(`ALTER TABLE musical_roles ADD COLUMN category TEXT NOT NULL DEFAULT 'Otros'`);
  const existingRoles = db.prepare('SELECT id, name FROM musical_roles').all() as Array<{ id: number; name: string }>;
  const updateRoleCategory = db.prepare('UPDATE musical_roles SET category = ? WHERE id = ?');
  for (const role of existingRoles) {
    updateRoleCategory.run(inferRoleCategory(role.name), role.id);
  }
}

// Migrate legacy slug categories (musicos/cantantes/…) to display labels.
const legacyCategoryMap: Record<string, string> = {
  musicos: 'Músicos',
  cantantes: 'Cantantes',
  sonido: 'Sonido',
  otros: 'Otros',
};
const rolesWithLegacyCategory = db
  .prepare('SELECT id, category FROM musical_roles')
  .all() as Array<{ id: number; category: string }>;
const updateLegacyCategory = db.prepare('UPDATE musical_roles SET category = ? WHERE id = ?');
for (const role of rolesWithLegacyCategory) {
  const key = String(role.category || '').trim().toLowerCase();
  if (legacyCategoryMap[key] && role.category !== legacyCategoryMap[key]) {
    updateLegacyCategory.run(legacyCategoryMap[key], role.id);
  }
}

const defaultMusicalRoles: Array<{ name: string; category: string }> = [
  { name: 'Bajo', category: 'Músicos' },
  { name: 'Guitarra eléctrica', category: 'Músicos' },
  { name: 'Guitarra acústica', category: 'Músicos' },
  { name: 'Batería', category: 'Músicos' },
  { name: 'Voz principal', category: 'Cantantes' },
  { name: 'Voces', category: 'Cantantes' },
  { name: 'Técnico de sonido', category: 'Sonido' },
];
const musicalRoleCount = db.prepare('SELECT COUNT(*) as count FROM musical_roles').get() as { count: number };
if (musicalRoleCount.count === 0) {
  const insertRole = db.prepare('INSERT INTO musical_roles (name, category, position) VALUES (?, ?, ?)');
  defaultMusicalRoles.forEach((role, index) => {
    insertRole.run(role.name, role.category, index + 1);
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