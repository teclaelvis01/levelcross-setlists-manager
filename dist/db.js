"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const Database = require("better-sqlite3");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const dbPath = path_1.default.join(__dirname, '..', 'data', 'setlists.db');
const dataDir = path_1.default.join(__dirname, '..', 'data');
const uploadsDir = path_1.default.join(__dirname, '..', 'data', 'uploads');
if (!fs_1.default.existsSync(dataDir)) {
    fs_1.default.mkdirSync(dataDir, { recursive: true });
}
if (!fs_1.default.existsSync(uploadsDir)) {
    fs_1.default.mkdirSync(uploadsDir, { recursive: true });
}
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
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
const hasSlugCol = db.prepare("SELECT COUNT(*) as count FROM pragma_table_info('songs') WHERE name = 'slug'").get();
if (hasSlugCol.count === 0) {
    db.exec(`ALTER TABLE songs ADD COLUMN slug TEXT DEFAULT ''`);
}
// Remove UNIQUE constraint on title if it existed before (we handle uniqueness via app logic + slug)
// Remove the unique index on title to allow slug-based uniqueness
try {
    db.exec('DROP INDEX IF EXISTS songs_title_unique');
}
catch { }
try {
    db.exec('DROP INDEX IF EXISTS sqlite_autoindex_songs_1');
}
catch { }
// Ensure we have a unique index on slug
try {
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_songs_slug ON songs(slug)');
}
catch { }
exports.default = db;
//# sourceMappingURL=db.js.map