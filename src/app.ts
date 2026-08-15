import express from 'express';
import session from 'express-session';
import path from 'path';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import fs from 'fs';
import AdmZip from 'adm-zip';
import dbDefault, { openDatabase } from './db';
import { MusicalRole, Song } from './types';

let db = dbDefault;

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);
const BASE_URL = process.env.BASE_URL || '';
const isDev = process.env.NODE_ENV !== 'production';
const SALT_ROUNDS = 10;
const DEFAULT_SONGS_PER_PAGE = 12;
const PAGE_SIZE_OPTIONS = [5, 10, 50];

// Make baseUrl available to all views
app.locals.baseUrl = BASE_URL;

const dataRoot = path.join(__dirname, '..', 'data');
const uploadsRoot = path.join(dataRoot, 'uploads');
const peopleUploadsDir = path.join(uploadsRoot, 'people');
const tmpDir = path.join(dataRoot, 'tmp');
const MAX_PERSON_PHOTO_BYTES = 1 * 1024 * 1024; // 1 MB
const MAX_BACKUP_UPLOAD_BYTES = 100 * 1024 * 1024; // 100 MB
const ALLOWED_PERSON_PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const ALLOWED_MEDIA_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

if (!fs.existsSync(peopleUploadsDir)) {
  fs.mkdirSync(peopleUploadsDir, { recursive: true });
}
if (!fs.existsSync(tmpDir)) {
  fs.mkdirSync(tmpDir, { recursive: true });
}

// Multer: DB / multimedia backups
const backupUpload = multer({
  dest: tmpDir,
  limits: { fileSize: MAX_BACKUP_UPLOAD_BYTES },
});

// Multer: person photos
const personPhotoUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, peopleUploadsDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const safeExt = ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext)
        ? (ext === '.jpeg' ? '.jpg' : ext)
        : '.jpg';
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${safeExt}`);
    },
  }),
  limits: { fileSize: MAX_PERSON_PHOTO_BYTES },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_PERSON_PHOTO_TYPES.has(file.mimetype)) {
      cb(new Error('Solo se permiten imágenes JPG, PNG, WebP o GIF'));
      return;
    }
    cb(null, true);
  },
});

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ── BASE_URL prefix middleware ──
// Strips the BASE_URL prefix from the request path so that all internal routes
// can be defined at / regardless of whether the reverse proxy (Coolify/Caddy)
// forwards the full path with prefix or strips it.
// This makes the app work in both scenarios.
app.use((req, _res, next) => {
  if (BASE_URL && req.url.startsWith(BASE_URL)) {
    req.url = req.url.slice(BASE_URL.length);
    if (req.url === '') req.url = '/';
  }
  next();
});

// Static files (served at / regardless of BASE_URL)
const publicDir = path.join(__dirname, '..', 'public');
app.use(
  express.static(publicDir, isDev
    ? {
        etag: false,
        lastModified: false,
        setHeaders(res) {
          res.setHeader('Cache-Control', 'no-store, must-revalidate');
        },
      }
    : undefined)
);
app.use('/uploads', express.static(uploadsRoot));

// Trust the reverse proxy (Coolify/Caddy) so that req.protocol, req.hostname etc. are correct
app.set('trust proxy', true);

const sessionCookieSecure = process.env.SESSION_COOKIE_SECURE === 'true'
  ? true
  : process.env.SESSION_COOKIE_SECURE === 'false'
  ? false
  : process.env.NODE_ENV === 'production';

app.use(session({
  name: 'setlists_session',
  secret: process.env.SESSION_SECRET || 'setlists-manager-secret-change-in-production',
  resave: true,
  saveUninitialized: true,
  cookie: {
    httpOnly: true,
    secure: sessionCookieSecure,
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    path: BASE_URL || '/',
  },
}));

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.set('view cache', !isDev);

// ── Helpers ──

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>');
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function generateUniqueSlug(title: string, excludeId?: number): string {
  let slug = slugify(title);
  if (!slug) slug = 'untitled';
  let existing: Song | undefined;
  if (excludeId) {
    existing = db.prepare('SELECT * FROM songs WHERE slug = ? AND id != ?').get(slug, excludeId) as Song | undefined;
  } else {
    existing = db.prepare('SELECT * FROM songs WHERE slug = ?').get(slug) as Song | undefined;
  }
  if (!existing) return slug;
  let counter = 1;
  while (true) {
    const candidate = `${slug}-${counter}`;
    if (excludeId) {
      existing = db.prepare('SELECT * FROM songs WHERE slug = ? AND id != ?').get(candidate, excludeId) as Song | undefined;
    } else {
      existing = db.prepare('SELECT * FROM songs WHERE slug = ?').get(candidate) as Song | undefined;
    }
    if (!existing) return candidate;
    counter++;
  }
}

function generateUniqueActivitySlug(name: string, excludeId?: number): string {
  let slug = slugify(name);
  if (!slug) slug = 'actividad';
  let existing: { id: number; slug: string } | undefined;
  if (excludeId) {
    existing = db.prepare('SELECT * FROM activities WHERE slug = ? AND id != ?').get(slug, excludeId) as { id: number; slug: string } | undefined;
  } else {
    existing = db.prepare('SELECT * FROM activities WHERE slug = ?').get(slug) as { id: number; slug: string } | undefined;
  }
  if (!existing) return slug;
  let counter = 1;
  while (true) {
    const candidate = `${slug}-${counter}`;
    if (excludeId) {
      existing = db.prepare('SELECT * FROM activities WHERE slug = ? AND id != ?').get(candidate, excludeId) as { id: number; slug: string } | undefined;
    } else {
      existing = db.prepare('SELECT * FROM activities WHERE slug = ?').get(candidate) as { id: number; slug: string } | undefined;
    }
    if (!existing) return candidate;
    counter++;
  }
}

function getPersonRoles(personId: number): string[] {
  const rows = db.prepare('SELECT role FROM person_roles WHERE person_id = ? ORDER BY role ASC').all(personId) as { role: string }[];
  return rows.map(row => row.role);
}

function getActivityPersonRoles(activityId: number, personId: number): string[] {
  const rows = db.prepare(`
    SELECT role FROM activity_person_roles
    WHERE activity_id = ? AND person_id = ?
    ORDER BY role ASC
  `).all(activityId, personId) as { role: string }[];
  return rows.map(row => row.role);
}

function getPeopleWithRoles(people: any[]): any[] {
  return people.map((person) => ({
    ...person,
    roles: getPersonRoles(person.id),
  }));
}

function listActivePeopleWithRoles() {
  return getPeopleWithRoles(
    db.prepare('SELECT * FROM people WHERE deleted_at IS NULL ORDER BY name ASC').all() as any[]
  );
}

function listAssignablePeopleForActivity(assignedPeople: any[] = []) {
  const activePeople = listActivePeopleWithRoles();
  const byId = new Map<number, any>(activePeople.map((person) => [person.id, person]));

  for (const assigned of assignedPeople) {
    if (!byId.has(assigned.id)) {
      byId.set(assigned.id, {
        ...assigned,
        roles: assigned.roles || getPersonRoles(assigned.id),
      });
    }
  }

  return [...byId.values()].sort((a, b) => String(a.name).localeCompare(String(b.name), 'es'));
}

function getActivityRelations(activityId: number) {
  const activity = db.prepare('SELECT * FROM activities WHERE id = ?').get(activityId) as any;
  const songs = db.prepare(`
    SELECT s.*, a_s.position
    FROM activity_songs a_s
    JOIN songs s ON s.id = a_s.song_id
    WHERE a_s.activity_id = ?
    ORDER BY a_s.position ASC, s.title ASC
  `).all(activityId) as Array<Song & { position: number }>;
  const people = (db.prepare(`
    SELECT p.*
    FROM activity_people a_p
    JOIN people p ON p.id = a_p.person_id
    WHERE a_p.activity_id = ?
    ORDER BY p.name ASC
  `).all(activityId) as any[]).map((person) => {
    const availableRoles = getPersonRoles(person.id);
    const activityRoles = getActivityPersonRoles(activityId, person.id);
    return {
      ...person,
      roles: availableRoles,
      activityRoles,
    };
  });
  return { activity, songs, people };
}

function collectSelectedPeopleIds(input: unknown): number[] {
  const rawValues = Array.isArray(input) ? input : (input ? [input] : []);
  return [...new Set(
    rawValues
      .map((value) => Number(value))
      .filter((id) => Number.isInteger(id) && id > 0)
  )];
}

function collectActivityRolesByPerson(input: unknown): Record<number, string[]> {
  if (!input || typeof input !== 'object') return {};

  const result: Record<number, string[]> = {};
  for (const [personIdRaw, rolesRaw] of Object.entries(input as Record<string, unknown>)) {
    // Form fields use person_roles[p123][] so qs keeps an object (numeric keys become arrays).
    const personId = Number(String(personIdRaw).replace(/^p/i, ''));
    if (!Number.isInteger(personId) || personId <= 0) continue;
    result[personId] = collectSelectedRoles(rolesRaw);
  }
  return result;
}

function saveActivityPeople(activityId: number, personIds: number[], rolesByPerson: Record<number, string[]>) {
  const save = db.transaction(() => {
    db.prepare('DELETE FROM activity_person_roles WHERE activity_id = ?').run(activityId);
    db.prepare('DELETE FROM activity_people WHERE activity_id = ?').run(activityId);

    const insertPerson = db.prepare('INSERT INTO activity_people (activity_id, person_id) VALUES (?, ?)');
    const insertRole = db.prepare('INSERT INTO activity_person_roles (activity_id, person_id, role) VALUES (?, ?, ?)');
    const personExists = db.prepare('SELECT id FROM people WHERE id = ?');

    for (const personId of personIds) {
      if (!personExists.get(personId)) continue;

      const availableRoles = getPersonRoles(personId);
      insertPerson.run(activityId, personId);

      const submitted = Object.prototype.hasOwnProperty.call(rolesByPerson, personId);
      const selectedRoles = (rolesByPerson[personId] || [])
        .filter((role) => availableRoles.includes(role));
      // Respect unchecked roles. Only default to all available when nothing was submitted
      // (e.g. person without role checkboxes / legacy clients).
      const rolesToSave = submitted
        ? selectedRoles
        : (availableRoles.length > 0 ? availableRoles : []);

      for (const role of rolesToSave) {
        insertRole.run(activityId, personId, role);
      }
    }
  });

  save();
}

function saveActivitySongs(activityId: number, req: express.Request) {
  const selectedSongs = Array.isArray(req.body.song_ids) ? req.body.song_ids : (req.body.song_ids ? [req.body.song_ids] : []);
  const orderLookup = req.body.song_order && typeof req.body.song_order === 'object' ? req.body.song_order : {};
  const pairs: Array<{ songId: number; order: number }> = selectedSongs.map((songId: string | number, index: number) => {
    const numericId = Number(songId);
    const order = Number(orderLookup[String(songId)] ?? index + 1);
    return { songId: numericId, order: Number.isFinite(order) && order > 0 ? order : index + 1 };
  }).filter((item: { songId: number; order: number }) => !Number.isNaN(item.songId));

  const save = db.transaction(() => {
    db.prepare('DELETE FROM activity_songs WHERE activity_id = ?').run(activityId);
    const insertSong = db.prepare('INSERT INTO activity_songs (activity_id, song_id, position) VALUES (?, ?, ?)');
    const songExists = db.prepare('SELECT id FROM songs WHERE id = ?');

    for (const item of pairs.sort((a, b) => a.order - b.order)) {
      if (!songExists.get(item.songId)) continue;
      insertSong.run(activityId, item.songId, item.order);
    }
  });

  save();
}

function getActivityPeoplePreview(activityId: number) {
  return db.prepare(`
    SELECT p.id, p.name, p.photo_url
    FROM activity_people a_p
    JOIN people p ON p.id = a_p.person_id
    WHERE a_p.activity_id = ? AND p.deleted_at IS NULL
    ORDER BY p.name ASC
  `).all(activityId) as Array<{ id: number; name: string; photo_url: string }>;
}

function parseActivityDateTime(activityDate: string, activityTime?: string | null): Date {
  const [year, month, day] = String(activityDate || '').split('-').map(Number);
  const rawTime = String(activityTime || '').trim();
  const [hours, minutes] = (rawTime || '23:59').split(':').map(Number);
  return new Date(
    year || 1970,
    (month || 1) - 1,
    day || 1,
    Number.isFinite(hours) ? hours : 23,
    Number.isFinite(minutes) ? minutes : 59,
    0,
    0
  );
}

function getActivityStatus(activityDate: string, activityTime?: string | null): 'past' | 'today' | 'upcoming' {
  const when = parseActivityDateTime(activityDate, activityTime);
  const now = new Date();
  if (when.getTime() < now.getTime()) return 'past';

  const isSameDay =
    when.getFullYear() === now.getFullYear()
    && when.getMonth() === now.getMonth()
    && when.getDate() === now.getDate();

  return isSameDay ? 'today' : 'upcoming';
}

function listActivitiesWithPeople() {
  const activities = (db.prepare(`
    SELECT * FROM activities
    ORDER BY activity_date DESC, COALESCE(NULLIF(activity_time, ''), '00:00') DESC, name ASC
  `).all() as any[]).map((activity) => ({
    ...activity,
    people: getActivityPeoplePreview(activity.id),
    status: getActivityStatus(activity.activity_date, activity.activity_time),
  }));

  const sorted = activities.sort((a, b) => {
    const rank = (status: string) => (status === 'past' ? 1 : 0);
    if (rank(a.status) !== rank(b.status)) return rank(a.status) - rank(b.status);

    const aKey = `${a.activity_date}T${a.activity_time || '00:00'}`;
    const bKey = `${b.activity_date}T${b.activity_time || '00:00'}`;
    if (a.status === 'past') return bKey.localeCompare(aKey);
    return aKey.localeCompare(bKey);
  });

  let markedNext = false;
  return sorted.map((activity) => {
    if (activity.status === 'past') {
      return { ...activity, emphasis: 'past' as const };
    }
    if (!markedNext) {
      markedNext = true;
      return { ...activity, emphasis: 'next' as const };
    }
    return { ...activity, emphasis: 'upcoming' as const };
  });
}

function listMusicalRoles(): MusicalRole[] {
  return db.prepare('SELECT * FROM musical_roles ORDER BY position ASC, name ASC').all() as MusicalRole[];
}

function listMusicalRoleNames(): string[] {
  return listMusicalRoles().map((role) => role.name);
}

function getMusicalRoleById(id: number): MusicalRole | undefined {
  return db.prepare('SELECT * FROM musical_roles WHERE id = ?').get(id) as MusicalRole | undefined;
}

function nextMusicalRolePosition(): number {
  const row = db.prepare('SELECT COALESCE(MAX(position), 0) as maxPosition FROM musical_roles').get() as { maxPosition: number };
  return Number(row.maxPosition) + 1;
}

function renameRoleEverywhere(oldName: string, newName: string) {
  if (oldName === newName) return;
  db.prepare('UPDATE person_roles SET role = ? WHERE role = ?').run(newName, oldName);
  db.prepare('UPDATE activity_person_roles SET role = ? WHERE role = ?').run(newName, oldName);
}

function deleteRoleEverywhere(roleName: string) {
  db.prepare('DELETE FROM person_roles WHERE role = ?').run(roleName);
  db.prepare('DELETE FROM activity_person_roles WHERE role = ?').run(roleName);
  db.prepare('DELETE FROM musical_roles WHERE name = ?').run(roleName);
}

function collectSelectedRoles(input: unknown): string[] {
  const allowedRoles = new Set(listMusicalRoleNames());
  const rawValues = Array.isArray(input)
    ? input
    : input === undefined || input === null || input === ''
      ? []
      : [input];

  const values = rawValues
    .flatMap(value => typeof value === 'string' ? value.split(',') : [value])
    .map(value => String(value).trim())
    .filter(Boolean)
    .filter((value) => allowedRoles.has(value));

  return [...new Set(values)];
}

/** ChordPro / ChartPro chord token (e.g. G, Em7, Dsus4, C/G). */
function isChordToken(token: string): boolean {
  return /^[A-G][#b]?(?:maj|min|dim|aug|sus|add|m|M)?\d*(?:\([^)]*\))?(?:\/[A-G][#b]?)?$/.test(
    token.trim()
  );
}

type ChordSegment = { chord: string | null; text: string };

/** Parse a ChartPro line into chord+lyric columns (chord sits above following text). */
function parseChordProLine(line: string): ChordSegment[] {
  const segments: ChordSegment[] = [];
  let remaining = line;
  let current: ChordSegment = { chord: null, text: '' };

  while (remaining.length > 0) {
    const chordMatch = remaining.match(/^\[([^\]]*)\]/);
    if (chordMatch) {
      if (current.chord !== null || current.text) {
        segments.push(current);
      }
      current = { chord: chordMatch[1], text: '' };
      remaining = remaining.slice(chordMatch[0].length);
      continue;
    }

    const nextBracket = remaining.indexOf('[');
    if (nextBracket === -1) {
      current.text += remaining;
      remaining = '';
    } else {
      current.text += remaining.slice(0, nextBracket);
      remaining = remaining.slice(nextBracket);
    }
  }

  if (current.chord !== null || current.text) {
    segments.push(current);
  }
  return segments;
}

function renderLyrics(lyrics: string): string {
  if (!lyrics) return '';
  const lines = lyrics.split('\n');
  let html = '';
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '') {
      html += '<div class="lyrics-line lyrics-line--empty">&nbsp;</div>';
      continue;
    }

    const sectionMatch = trimmed.match(/^\[([^\]]+)\]$/);
    if (sectionMatch && !isChordToken(sectionMatch[1])) {
      html += '<div class="lyrics-section">' + escapeHtml(sectionMatch[1]) + '</div>';
      continue;
    }

    const blocks = parseChordProLine(line)
      .map((seg) => {
        const chordHtml =
          seg.chord !== null
            ? '<span class="chord">' + escapeHtml(seg.chord) + '</span>'
            : '<span class="chord chord--spacer" aria-hidden="true"></span>';
        return (
          '<span class="chord-block">' +
          chordHtml +
          '<span class="lyrics-text">' +
          escapeHtml(seg.text) +
          '</span></span>'
        );
      })
      .join('');

    html += '<div class="lyrics-line">' + blocks + '</div>';
  }
  return html;
}

app.locals.renderLyrics = renderLyrics;

// ── Auth middleware ──

function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  // if (!req.session || !req.session.userId) {
  //   return res.redirect(`${BASE_URL}/login`);
  // }
  next();
}

function verifyStoredPassword(inputPassword: string, storedHash: string): boolean {
  if (!storedHash) return false;
  if (storedHash === inputPassword) return true;
  try {
    return bcrypt.compareSync(inputPassword, storedHash);
  } catch {
    return false;
  }
}

function getDefaultAdminCredentials(): { username: string; password: string } {
  return {
    username: (process.env.DEFAULT_ADMIN_USERNAME || 'admin').trim(),
    password: process.env.DEFAULT_ADMIN_PASSWORD || 'admin',
  };
}

function getPaginatedSongs(search: string, page: number, pageSize?: number) {
  const trimmedSearch = search.trim();
  const normalizedSearch = trimmedSearch.length >= 3 ? trimmedSearch : '';
  const normalizedPageSize = PAGE_SIZE_OPTIONS.includes(pageSize || 0) ? (pageSize as number) : DEFAULT_SONGS_PER_PAGE;
  const whereClause = normalizedSearch ? 'WHERE title LIKE ? OR artist LIKE ?' : '';
  const countParams = normalizedSearch ? [`%${normalizedSearch}%`, `%${normalizedSearch}%`] : [];
  const countRow = db.prepare(`SELECT COUNT(*) as count FROM songs ${whereClause}`).get(...countParams) as { count: number };
  const totalCount = countRow.count;
  const totalPages = Math.max(1, Math.ceil(totalCount / normalizedPageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const offset = (currentPage - 1) * normalizedPageSize;
  const listParams = normalizedSearch
    ? [`%${normalizedSearch}%`, `%${normalizedSearch}%`, normalizedPageSize, offset]
    : [normalizedPageSize, offset];
  const songs = db.prepare(`SELECT * FROM songs ${whereClause} ORDER BY title ASC LIMIT ? OFFSET ?`).all(...listParams) as Song[];

  return {
    songs,
    currentPage,
    totalPages,
    totalCount,
    pageSize: normalizedPageSize,
    hasPrev: currentPage > 1,
    hasNext: currentPage < totalPages,
  };
}

app.use((req, res, next) => {
  if (req.session) {
    app.locals.isAuthenticated = !!req.session.userId;
    app.locals.username = req.session.username || '';
    if (req.session.flash) {
      res.locals.flash = req.session.flash;
      delete req.session.flash;
    } else {
      res.locals.flash = null;
    }
  } else {
    app.locals.isAuthenticated = false;
    app.locals.username = '';
    res.locals.flash = null;
  }
  next();
});

// ── URL helper for redirects ──

function url(pathName: string): string {
  return BASE_URL + pathName;
}

function setFlash(
  req: express.Request,
  type: 'error' | 'success' | 'info',
  message: string,
  extras: { title?: string; sticky?: boolean } = {}
) {
  if (req.session) {
    req.session.flash = {
      type,
      message,
      ...(extras.title ? { title: extras.title } : {}),
      ...(extras.sticky ? { sticky: true } : {}),
    };
  }
}

function flashRedirect(
  req: express.Request,
  res: express.Response,
  pathName: string,
  type: 'error' | 'success' | 'info',
  message: string,
  extras: { title?: string; sticky?: boolean } = {}
) {
  setFlash(req, type, message, extras);
  return res.redirect(url(pathName));
}

function showFormError(res: express.Response, message: string) {
  res.locals.flash = { type: 'error', message };
}

function buildAssignedPeopleFromBody(req: express.Request) {
  const selectedPeople = collectSelectedPeopleIds(req.body.person_ids);
  const rolesByPerson = collectActivityRolesByPerson(req.body.person_roles);
  const basePeople = listAssignablePeopleForActivity();
  return selectedPeople.map((personId) => {
    const person = basePeople.find((item) => item.id === personId) || { id: personId, name: `Persona ${personId}`, roles: [] as string[] };
    const activityRoles = rolesByPerson[personId] || person.roles || [];
    return { ...person, activityRoles };
  });
}

function buildAssignedSongsFromBody(req: express.Request) {
  const selectedSongs = Array.isArray(req.body.song_ids) ? req.body.song_ids : (req.body.song_ids ? [req.body.song_ids] : []);
  const orderLookup = req.body.song_order && typeof req.body.song_order === 'object' ? req.body.song_order : {};
  const allSongs = db.prepare('SELECT * FROM songs ORDER BY title ASC').all() as Song[];
  return selectedSongs.map((songId: string | number, index: number) => {
    const numericId = Number(songId);
    const song = allSongs.find((item) => item.id === numericId);
    const order = Number(orderLookup[String(songId)] ?? index + 1);
    return song
      ? { ...song, position: Number.isFinite(order) && order > 0 ? order : index + 1 }
      : null;
  }).filter(Boolean) as Array<Song & { position: number }>;
}

function isLocalPersonPhoto(photoUrl: string): boolean {
  return typeof photoUrl === 'string' && photoUrl.startsWith('/uploads/people/');
}

function photoSrc(photoUrl: string | null | undefined): string {
  if (!photoUrl) return '';
  if (photoUrl.startsWith('http://') || photoUrl.startsWith('https://')) return photoUrl;
  return url(photoUrl);
}

function deleteLocalPersonPhoto(photoUrl: string | null | undefined) {
  if (!photoUrl || !isLocalPersonPhoto(photoUrl)) return;
  const filename = path.basename(photoUrl);
  if (!filename || filename === '.' || filename === '..') return;
  const fullPath = path.join(peopleUploadsDir, filename);
  try {
    if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
  } catch {
    // ignore cleanup errors
  }
}

function countMultimediaFiles(dir: string = uploadsRoot): number {
  if (!fs.existsSync(dir)) return 0;
  let count = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      count += countMultimediaFiles(fullPath);
    } else if (entry.isFile()) {
      count += 1;
    }
  }
  return count;
}

function normalizeMediaZipEntryPath(entryName: string): string | null {
  const normalized = entryName.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.endsWith('/')) return null;
  if (normalized.includes('..')) return null;

  let relative = normalized;
  if (relative.startsWith('uploads/')) relative = relative.slice('uploads/'.length);
  if (!relative.includes('/')) relative = `people/${path.basename(relative)}`;

  const ext = path.extname(relative).toLowerCase();
  if (!ALLOWED_MEDIA_EXTENSIONS.has(ext)) return null;

  const parts = relative.split('/').filter(Boolean);
  if (parts.length === 0 || parts.some((part) => part === '.' || part === '..')) return null;

  return parts.join('/');
}

function importMultimediaZip(zipPath: string): number {
  const zip = new AdmZip(zipPath);
  let imported = 0;

  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    const relativePath = normalizeMediaZipEntryPath(entry.entryName);
    if (!relativePath) continue;

    const destination = path.join(uploadsRoot, relativePath);
    const destinationDir = path.dirname(destination);
    const relativeToUploads = path.relative(uploadsRoot, destination);
    if (!relativeToUploads || relativeToUploads.startsWith('..') || path.isAbsolute(relativeToUploads)) {
      continue;
    }

    fs.mkdirSync(destinationDir, { recursive: true });
    fs.writeFileSync(destination, entry.getData());
    imported += 1;
  }

  return imported;
}

function sanitizeKeptPhotoUrl(value: unknown): string {
  const raw = String(value || '').trim();
  if (!isLocalPersonPhoto(raw)) return '';
  const filename = path.basename(raw);
  if (!filename || filename === '.' || filename === '..') return '';
  const fullPath = path.join(peopleUploadsDir, filename);
  if (!fs.existsSync(fullPath)) return '';
  return `/uploads/people/${filename}`;
}

function resolvePersonPhotoDraft(req: express.Request, fallbackPhotoUrl = ''): string {
  const removePhoto = req.body?.remove_photo === '1' || req.body?.remove_photo === 'on';
  if (req.file) {
    return `/uploads/people/${req.file.filename}`;
  }
  if (removePhoto) {
    return '';
  }
  const kept = sanitizeKeptPhotoUrl(req.body?.kept_photo_url);
  if (kept) return kept;
  return fallbackPhotoUrl || '';
}

function resolvePersonPhotoForSave(req: express.Request, currentPhotoUrl = ''): string {
  const removePhoto = req.body?.remove_photo === '1' || req.body?.remove_photo === 'on';
  const kept = sanitizeKeptPhotoUrl(req.body?.kept_photo_url);
  const uploaded = req.file ? `/uploads/people/${req.file.filename}` : '';

  if (uploaded) {
    if (currentPhotoUrl && currentPhotoUrl !== uploaded) deleteLocalPersonPhoto(currentPhotoUrl);
    if (kept && kept !== uploaded && kept !== currentPhotoUrl) deleteLocalPersonPhoto(kept);
    return uploaded;
  }

  if (removePhoto) {
    if (currentPhotoUrl) deleteLocalPersonPhoto(currentPhotoUrl);
    if (kept && kept !== currentPhotoUrl) deleteLocalPersonPhoto(kept);
    return '';
  }

  if (kept) {
    if (currentPhotoUrl && currentPhotoUrl !== kept) deleteLocalPersonPhoto(currentPhotoUrl);
    return kept;
  }

  return currentPhotoUrl || '';
}

function renderPersonForm(
  res: express.Response,
  person: any,
  fieldErrors: Record<string, boolean> = {},
  status = 200
) {
  return res.status(status).render('admin-person-form', {
    person,
    roles: listMusicalRoleNames(),
    fieldErrors,
  });
}

function handlePersonPhotoUpload(req: express.Request, res: express.Response, next: express.NextFunction) {
  personPhotoUpload.single('photo')(req, res, (err: unknown) => {
    if (!err) return next();

    const message = err instanceof multer.MulterError
      ? (err.code === 'LIMIT_FILE_SIZE' ? 'La imagen supera el límite de 1 MB' : 'Error al subir la imagen')
      : (err instanceof Error ? err.message : 'Error al subir la imagen');

    const name = (req.body?.name || '').trim();
    const selectedRoles = collectSelectedRoles(req.body?.roles);
    let fallbackPhoto = sanitizeKeptPhotoUrl(req.body?.kept_photo_url);
    if (req.params.id) {
      const existing = db.prepare('SELECT * FROM people WHERE id = ? AND deleted_at IS NULL').get(req.params.id) as any | undefined;
      if (existing) {
        fallbackPhoto = fallbackPhoto || existing.photo_url || '';
        showFormError(res, message);
        return renderPersonForm(
          res,
          { ...existing, name, roles: selectedRoles, photo_url: fallbackPhoto },
          { photo: true },
          400
        );
      }
    }

    showFormError(res, message);
    return renderPersonForm(
      res,
      { name, roles: selectedRoles, photo_url: fallbackPhoto },
      { photo: true },
      400
    );
  });
}

app.locals.photoSrc = photoSrc;

// ── Public Routes ──

// All routes are defined at / (root). The BASE_URL middleware above strips
// the prefix from the request path before these routes are matched, so the
// app works regardless of whether the reverse proxy forwards the full path
// or strips the prefix.

app.get('/', (req, res) => {
  if (!isSetupComplete()) {
    return res.redirect(url('/setup'));
  }
  // Preserve old song-library query bookmarks at the root URL.
  if (req.query.search || req.query.page || req.query.pageSize) {
    const params = new URLSearchParams();
    for (const key of ['search', 'page', 'pageSize'] as const) {
      const value = req.query[key];
      if (typeof value === 'string' && value) params.set(key, value);
    }
    const qs = params.toString();
    return res.redirect(url(`/libreria${qs ? `?${qs}` : ''}`));
  }
  return res.redirect(url('/actividades'));
});

app.get('/libreria', (req, res) => {
  if (!isSetupComplete()) {
    return res.redirect(url('/setup'));
  }
  const rawSearch = ((req.query.search as string) || '').trim();
  const search = rawSearch.length >= 3 ? rawSearch : '';
  const requestedPage = parseInt(req.query.page as string, 10) || 1;
  const requestedPageSize = parseInt(req.query.pageSize as string, 10) || DEFAULT_SONGS_PER_PAGE;
  const { songs, currentPage, totalPages, totalCount, pageSize, hasPrev, hasNext } = getPaginatedSongs(search, requestedPage, requestedPageSize);
  res.render('index', { songs, search, currentPage, totalPages, totalCount, pageSize, hasPrev, hasNext });
});

app.get('/songs/:slug', (req, res) => {
  if (!isSetupComplete()) {
    return res.redirect(url('/setup'));
  }
  const song = db.prepare('SELECT * FROM songs WHERE slug = ?').get(req.params.slug) as Song | undefined;
  if (!song) {
    return flashRedirect(req, res, '/libreria', 'error', 'Canción no encontrada');
  }

  const rawFrom = typeof req.query.from === 'string' ? req.query.from : '';
  let returnTo: string | null = null;
  if (rawFrom) {
    let decoded = rawFrom;
    try {
      decoded = decodeURIComponent(rawFrom);
    } catch {
      decoded = rawFrom;
    }
    const pathOnly = decoded.startsWith(BASE_URL + '/') ? decoded.slice(BASE_URL.length) : decoded;
    if (
      pathOnly.startsWith('/') &&
      !pathOnly.startsWith('//') &&
      !pathOnly.includes('://') &&
      /^\/actividades\/[A-Za-z0-9_-]+\/?$/.test(pathOnly)
    ) {
      returnTo = url(pathOnly.replace(/\/$/, ''));
    }
  }

  res.render('viewer', { song, returnTo });
});

// ── Auth Routes ──

function isSetupComplete(): boolean {
  const user = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
  return user.count > 0;
}

function ensureDefaultAdminUser(username: string, password: string) {
  const defaultAdmin = getDefaultAdminCredentials();
  const normalizedUsername = username.trim();
  const isDefaultPassword = password === defaultAdmin.password;
  const isDefaultAdminUsername = normalizedUsername === 'admin' || normalizedUsername === defaultAdmin.username;

  if (!isDefaultPassword || !isDefaultAdminUsername) {
    return undefined;
  }

  const candidateUsernames = [...new Set([normalizedUsername, defaultAdmin.username, 'admin'].filter(Boolean))];
  for (const candidateUsername of candidateUsernames) {
    const existing = db.prepare('SELECT * FROM users WHERE username = ?').get(candidateUsername) as { id: number; username: string; password_hash: string } | undefined;
    if (!existing) {
      continue;
    }

    if (existing.password_hash !== defaultAdmin.password) {
      const hash = bcrypt.hashSync(defaultAdmin.password, SALT_ROUNDS);
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, existing.id);
    }

    return existing;
  }

  const hash = bcrypt.hashSync(defaultAdmin.password, SALT_ROUNDS);
  const insertResult = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(normalizedUsername, hash);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(insertResult.lastInsertRowid) as { id: number; username: string; password_hash: string } | undefined;
}

app.get('/setup', (req, res) => {
  if (isSetupComplete()) {
    return res.redirect(url('/login'));
  }
  res.render('setup', { formValues: { username: '', password: '', confirm_password: '' }, fieldErrors: {} });
});

app.post('/setup', (req, res) => {
  if (isSetupComplete()) {
    return res.redirect(url('/login'));
  }
  const { username, password, confirm_password } = req.body;
  const formValues = {
    username: username || '',
    password: '',
    confirm_password: '',
  };
  if (!username || !password || !confirm_password) {
    showFormError(res, 'Todos los campos son requeridos');
    return res.status(400).render('setup', {
      formValues,
      fieldErrors: {
        username: !username,
        password: !password,
        confirm_password: !confirm_password,
      },
    });
  }
  if (password !== confirm_password) {
    showFormError(res, 'Las contraseñas no coinciden');
    return res.status(400).render('setup', {
      formValues: { ...formValues, username },
      fieldErrors: { password: true, confirm_password: true },
    });
  }
  if (password.length < 4) {
    showFormError(res, 'La contraseña debe tener al menos 4 caracteres');
    return res.status(400).render('setup', {
      formValues: { ...formValues, username },
      fieldErrors: { password: true },
    });
  }
  const hash = bcrypt.hashSync(password, SALT_ROUNDS);
  try {
    db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(username, hash);
    if (req.session) {
      req.session.userId = 1;
      req.session.username = username;
      req.session.save((err) => {
        if (err) {
          return flashRedirect(req, res, '/setup', 'error', 'No se pudo iniciar la sesión. Intente de nuevo.');
        }
        res.redirect(url('/admin'));
      });
      return;
    }
    res.redirect(url('/admin'));
  } catch {
    return flashRedirect(req, res, '/setup', 'error', 'Error al crear el usuario. Intente de nuevo.');
  }
});

app.get('/login', (req, res) => {
  if (req.session && req.session.userId) {
    return res.redirect(url('/admin'));
  }
  if (!isSetupComplete()) {
    return res.redirect(url('/setup'));
  }
  res.render('login', { error: null });
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ success: false, error: 'Usuario y contraseña requeridos' });
  }

  const defaultAdmin = getDefaultAdminCredentials();
  const isDefaultAdminAttempt = username === defaultAdmin.username && password === defaultAdmin.password;

  let user = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as { id: number; username: string; password_hash: string } | undefined;

  if (!user && isDefaultAdminAttempt) {
    const hash = bcrypt.hashSync(defaultAdmin.password, SALT_ROUNDS);
    const inserted = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(defaultAdmin.username, hash) as { lastInsertRowid: number };
    user = {
      id: inserted.lastInsertRowid as number,
      username: defaultAdmin.username,
      password_hash: hash,
    };
  }

  if (!user) {
    return res.status(401).json({ success: false, error: 'Credenciales inválidas' });
  }

  const passwordMatches = verifyStoredPassword(password, user.password_hash);
  if (!passwordMatches) {
    return res.status(401).json({ success: false, error: 'Credenciales inválidas' });
  }

  if (isDefaultAdminAttempt || user.password_hash === password || user.password_hash.startsWith('$2') === false) {
    const hash = bcrypt.hashSync(password, SALT_ROUNDS);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user.id);
    user.password_hash = hash;
  }

  if (req.session) {
    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.save((err) => {
      if (err) {
        return res.status(500).json({ success: false, error: 'No se pudo iniciar la sesión. Intente de nuevo.' });
      }
      res.json({ success: true, redirectTo: url('/admin') });
    });
    return;
  }
  res.json({ success: true, redirectTo: url('/admin') });
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect(url('/'));
  });
});

app.get('/health', (_req, res) => {
  try {
    const result = db.prepare('SELECT 1 as ok').get() as { ok: number } | undefined;
    const isHealthy = !!result && result.ok === 1;
    res.status(isHealthy ? 200 : 500).json({
      status: isHealthy ? 'ok' : 'error',
      database: isHealthy ? 'connected' : 'unavailable',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      database: 'unavailable',
      error: error instanceof Error ? error.message : 'unknown error',
      timestamp: new Date().toISOString(),
    });
  }
});

// ── Admin (Private) Routes ──

app.get('/admin', requireAuth, (req, res) => {
  const rawSearch = ((req.query.search as string) || '').trim();
  const search = rawSearch.length >= 3 ? rawSearch : '';
  const requestedPage = parseInt(req.query.page as string, 10) || 1;
  const requestedPageSize = parseInt(req.query.pageSize as string, 10) || DEFAULT_SONGS_PER_PAGE;
  const { songs, currentPage, totalPages, totalCount, pageSize, hasPrev, hasNext } = getPaginatedSongs(search, requestedPage, requestedPageSize);
  res.render('admin', { songs, search, currentPage, totalPages, totalCount, pageSize, hasPrev, hasNext });
});

app.get('/admin/actividades', requireAuth, (_req, res) => {
  res.render('admin-activities', { activities: listActivitiesWithPeople() });
});

app.get('/admin/personas', requireAuth, (req, res) => {
  const search = ((req.query.search as string) || '').trim();
  const query = search.length >= 3 ? search.toLowerCase() : '';
  const allPeople = listActivePeopleWithRoles();
  const people = allPeople.filter((person) => {
    if (!query) return true;
    const nameMatch = String(person.name || '').toLowerCase().includes(query);
    const roleMatch = (person.roles || []).some((role: string) => String(role).toLowerCase().includes(query));
    return nameMatch || roleMatch;
  });
  res.render('admin-people', { people, search: query ? search : '', totalCount: allPeople.length });
});

app.get('/admin/personas/nueva', requireAuth, (_req, res) => {
  res.render('admin-person-form', { person: null, roles: listMusicalRoleNames(), fieldErrors: {} });
});

app.post('/admin/personas', requireAuth, handlePersonPhotoUpload, (req, res) => {
  const name = (req.body.name || '').trim();
  const roles = collectSelectedRoles(req.body.roles);
  if (!name || roles.length === 0) {
    showFormError(res, 'El nombre y al menos un rol son requeridos');
    return renderPersonForm(
      res,
      { name, roles, photo_url: resolvePersonPhotoDraft(req) },
      { name: !name, roles: roles.length === 0 },
      400
    );
  }

  const photoUrl = resolvePersonPhotoForSave(req);
  const insert = db.prepare('INSERT INTO people (name, photo_url) VALUES (?, ?)').run(name, photoUrl);
  const personId = Number(insert.lastInsertRowid);
  for (const role of roles) {
    db.prepare('INSERT INTO person_roles (person_id, role) VALUES (?, ?)').run(personId, role);
  }
  return flashRedirect(req, res, `/admin/personas/${personId}/editar`, 'success', 'Persona creada correctamente');
});

app.get('/admin/personas/:id/editar', requireAuth, (req, res) => {
  const person = db.prepare('SELECT * FROM people WHERE id = ? AND deleted_at IS NULL').get(req.params.id) as any | undefined;
  if (!person) {
    return flashRedirect(req, res, '/admin/personas', 'error', 'Persona no encontrada');
  }
  return renderPersonForm(res, { ...person, roles: getPersonRoles(person.id) });
});

app.post('/admin/personas/:id', requireAuth, handlePersonPhotoUpload, (req, res) => {
  const person = db.prepare('SELECT * FROM people WHERE id = ? AND deleted_at IS NULL').get(req.params.id) as any | undefined;
  if (!person) {
    if (req.file) deleteLocalPersonPhoto(`/uploads/people/${req.file.filename}`);
    return flashRedirect(req, res, '/admin/personas', 'error', 'Persona no encontrada');
  }
  const name = (req.body.name || '').trim();
  const roles = collectSelectedRoles(req.body.roles);
  if (!name || roles.length === 0) {
    showFormError(res, 'El nombre y al menos un rol son requeridos');
    return renderPersonForm(
      res,
      { ...person, name, roles, photo_url: resolvePersonPhotoDraft(req, person.photo_url || '') },
      { name: !name, roles: roles.length === 0 },
      400
    );
  }

  const photoUrl = resolvePersonPhotoForSave(req, person.photo_url || '');
  db.prepare('UPDATE people SET name = ?, photo_url = ? WHERE id = ?').run(name, photoUrl, person.id);
  db.prepare('DELETE FROM person_roles WHERE person_id = ?').run(person.id);
  for (const role of roles) {
    db.prepare('INSERT INTO person_roles (person_id, role) VALUES (?, ?)').run(person.id, role);
  }
  return flashRedirect(req, res, `/admin/personas/${person.id}/editar`, 'success', 'Persona actualizada correctamente');
});

app.post('/admin/personas/:id/delete', requireAuth, (req, res) => {
  const person = db.prepare('SELECT * FROM people WHERE id = ? AND deleted_at IS NULL').get(req.params.id) as any | undefined;
  if (!person) {
    return flashRedirect(req, res, '/admin/personas', 'error', 'Persona no encontrada');
  }
  db.prepare('UPDATE people SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?').run(person.id);
  return flashRedirect(req, res, '/admin/personas', 'success', 'Persona eliminada correctamente');
});

app.get('/admin/ajustes', requireAuth, (_req, res) => {
  const roles = listMusicalRoles();
  res.render('admin-settings', { roles, multimediaCount: countMultimediaFiles() });
});

app.get('/admin/ajustes/roles/nuevo', requireAuth, (_req, res) => {
  res.render('admin-role-form', { role: null, fieldErrors: {} });
});

app.post('/admin/ajustes/roles', requireAuth, (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) {
    showFormError(res, 'El nombre del rol es requerido');
    return res.status(400).render('admin-role-form', { role: { name: '' }, fieldErrors: { name: true } });
  }
  const existing = db.prepare('SELECT id FROM musical_roles WHERE LOWER(name) = LOWER(?)').get(name) as { id: number } | undefined;
  if (existing) {
    showFormError(res, 'Ya existe un rol con ese nombre');
    return res.status(400).render('admin-role-form', { role: { name }, fieldErrors: { name: true } });
  }
  const insert = db.prepare('INSERT INTO musical_roles (name, position) VALUES (?, ?)').run(name, nextMusicalRolePosition());
  const roleId = Number(insert.lastInsertRowid);
  return flashRedirect(req, res, `/admin/ajustes/roles/${roleId}/editar`, 'success', 'Rol creado correctamente');
});

app.get('/admin/ajustes/roles/:id/editar', requireAuth, (req, res) => {
  const role = getMusicalRoleById(Number(req.params.id));
  if (!role) {
    return flashRedirect(req, res, '/admin/ajustes', 'error', 'Rol no encontrado');
  }
  res.render('admin-role-form', { role, fieldErrors: {} });
});

app.post('/admin/ajustes/roles/:id', requireAuth, (req, res) => {
  const role = getMusicalRoleById(Number(req.params.id));
  if (!role) {
    return flashRedirect(req, res, '/admin/ajustes', 'error', 'Rol no encontrado');
  }
  const name = (req.body.name || '').trim();
  if (!name) {
    showFormError(res, 'El nombre del rol es requerido');
    return res.status(400).render('admin-role-form', { role: { ...role, name: '' }, fieldErrors: { name: true } });
  }
  const existing = db.prepare('SELECT id FROM musical_roles WHERE LOWER(name) = LOWER(?) AND id != ?').get(name, role.id) as { id: number } | undefined;
  if (existing) {
    showFormError(res, 'Ya existe un rol con ese nombre');
    return res.status(400).render('admin-role-form', { role: { ...role, name }, fieldErrors: { name: true } });
  }

  db.prepare('UPDATE musical_roles SET name = ? WHERE id = ?').run(name, role.id);
  renameRoleEverywhere(role.name, name);
  return flashRedirect(req, res, `/admin/ajustes/roles/${role.id}/editar`, 'success', 'Rol actualizado correctamente');
});

app.post('/admin/ajustes/roles/:id/delete', requireAuth, (req, res) => {
  const role = getMusicalRoleById(Number(req.params.id));
  if (!role) {
    return flashRedirect(req, res, '/admin/ajustes', 'error', 'Rol no encontrado');
  }
  deleteRoleEverywhere(role.name);
  return flashRedirect(req, res, '/admin/ajustes', 'success', 'Rol eliminado correctamente');
});

app.get('/admin/actividades/nueva', requireAuth, (req, res) => {
  const songs = db.prepare('SELECT * FROM songs ORDER BY title ASC').all() as Song[];
  const people = listAssignablePeopleForActivity();
  res.render('activity-form', {
    activity: null,
    songs,
    people,
    assignedSongs: [],
    assignedPeople: [],
    roles: listMusicalRoleNames(),
    fieldErrors: {},
    error: null,
  });
});

app.get('/admin/actividades/:id/editar', requireAuth, (req, res) => {
  const { activity, songs: assignedSongs, people: assignedPeople } = getActivityRelations(Number(req.params.id));
  if (!activity) {
    return flashRedirect(req, res, '/admin/actividades', 'error', 'Actividad no encontrada');
  }
  const songs = db.prepare('SELECT * FROM songs ORDER BY title ASC').all() as Song[];
  const people = listAssignablePeopleForActivity(assignedPeople);
  res.render('activity-form', { activity, songs, people, assignedSongs, assignedPeople, roles: listMusicalRoleNames(), fieldErrors: {}, error: null });
});

app.post('/admin/actividades', requireAuth, (req, res) => {
  const name = (req.body.name || '').trim();
  const activityDate = (req.body.activity_date || '').trim();
  const activityTime = (req.body.activity_time || '').trim();
  const detail = (req.body.detail || '').trim();
  if (!name || !activityDate) {
    const songs = db.prepare('SELECT * FROM songs ORDER BY title ASC').all() as Song[];
    const people = listAssignablePeopleForActivity();
    showFormError(res, 'El nombre y la fecha son requeridos');
    return res.status(400).render('activity-form', {
      activity: { name, activity_date: activityDate, activity_time: activityTime, detail },
      songs,
      people,
      assignedSongs: buildAssignedSongsFromBody(req),
      assignedPeople: buildAssignedPeopleFromBody(req),
      roles: listMusicalRoleNames(),
      fieldErrors: { name: !name, activity_date: !activityDate },
      error: null,
    });
  }

  try {
    const slug = generateUniqueActivitySlug(name);
    const insert = db.prepare('INSERT INTO activities (name, slug, activity_date, activity_time, detail) VALUES (?, ?, ?, ?, ?)')
      .run(name, slug, activityDate, activityTime, detail);
    const activityId = Number(insert.lastInsertRowid);

    const selectedPeople = collectSelectedPeopleIds(req.body.person_ids);
    const rolesByPerson = collectActivityRolesByPerson(req.body.person_roles);
    saveActivityPeople(activityId, selectedPeople, rolesByPerson);
    saveActivitySongs(activityId, req);

    return flashRedirect(req, res, `/admin/actividades/${activityId}/editar`, 'success', 'Actividad creada correctamente');
  } catch (error) {
    console.error(error);
    return flashRedirect(req, res, '/admin/actividades/nueva', 'error', 'No se pudo crear la actividad. Revisa los datos e inténtalo de nuevo.');
  }
});

app.post('/admin/actividades/:id', requireAuth, (req, res) => {
  const existing = db.prepare('SELECT * FROM activities WHERE id = ?').get(req.params.id) as any | undefined;
  if (!existing) {
    return flashRedirect(req, res, '/admin/actividades', 'error', 'Actividad no encontrada');
  }

  const name = (req.body.name || '').trim();
  const activityDate = (req.body.activity_date || '').trim();
  const activityTime = (req.body.activity_time || '').trim();
  const detail = (req.body.detail || '').trim();
  if (!name || !activityDate) {
    const songs = db.prepare('SELECT * FROM songs ORDER BY title ASC').all() as Song[];
    const people = listAssignablePeopleForActivity(buildAssignedPeopleFromBody(req));
    showFormError(res, 'El nombre y la fecha son requeridos');
    return res.status(400).render('activity-form', {
      activity: { ...existing, name, activity_date: activityDate, activity_time: activityTime, detail },
      songs,
      people,
      assignedSongs: buildAssignedSongsFromBody(req),
      assignedPeople: buildAssignedPeopleFromBody(req),
      roles: listMusicalRoleNames(),
      fieldErrors: { name: !name, activity_date: !activityDate },
      error: null,
    });
  }

  try {
    let slug = existing.slug;
    if (name !== existing.name) {
      slug = generateUniqueActivitySlug(name, existing.id);
    }

    db.prepare('UPDATE activities SET name = ?, slug = ?, activity_date = ?, activity_time = ?, detail = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(name, slug, activityDate, activityTime, detail, existing.id);

    const selectedPeople = collectSelectedPeopleIds(req.body.person_ids);
    const rolesByPerson = collectActivityRolesByPerson(req.body.person_roles);
    saveActivityPeople(existing.id, selectedPeople, rolesByPerson);
    saveActivitySongs(existing.id, req);

    return flashRedirect(req, res, `/admin/actividades/${existing.id}/editar`, 'success', 'Actividad actualizada correctamente');
  } catch (error) {
    console.error(error);
    return flashRedirect(
      req,
      res,
      `/admin/actividades/${existing.id}/editar`,
      'error',
      'No se pudo guardar la actividad. Revisa los datos e inténtalo de nuevo.'
    );
  }
});

app.post('/admin/actividades/:id/delete', requireAuth, (req, res) => {
  db.prepare('DELETE FROM activity_person_roles WHERE activity_id = ?').run(req.params.id);
  db.prepare('DELETE FROM activity_people WHERE activity_id = ?').run(req.params.id);
  db.prepare('DELETE FROM activity_songs WHERE activity_id = ?').run(req.params.id);
  db.prepare('DELETE FROM activities WHERE id = ?').run(req.params.id);
  return flashRedirect(req, res, '/admin/actividades', 'success', 'Actividad eliminada correctamente');
});

app.get('/actividades', (_req, res) => {
  res.render('activities', { activities: listActivitiesWithPeople() });
});

app.get('/actividades/:slug', (req, res) => {
  const activity = db.prepare('SELECT * FROM activities WHERE slug = ?').get(req.params.slug) as any | undefined;
  if (!activity) {
    return flashRedirect(req, res, '/actividades', 'error', 'Actividad no encontrada');
  }
  const { songs, people } = getActivityRelations(activity.id);
  res.render('activity-detail', { activity, songs, people });
});

app.get('/admin/songs/new', requireAuth, (req, res) => {
  res.render('form', { song: null, admin: true, fieldErrors: {} });
});

app.post('/admin/songs', requireAuth, (req, res) => {
  const { title, artist, lyrics, audio_url } = req.body;
  if (!title || !title.trim()) {
    showFormError(res, 'El título es requerido');
    return res.status(400).render('form', {
      song: {
        title: '',
        artist: (artist || '').trim(),
        lyrics: lyrics || '',
        audio_url: (audio_url || '').trim(),
      },
      admin: true,
      fieldErrors: { title: true },
    });
  }
  const cleanTitle = title.trim();
  const slug = generateUniqueSlug(cleanTitle);
  db.prepare(
    'INSERT INTO songs (title, slug, artist, lyrics, audio_url) VALUES (?, ?, ?, ?, ?)'
  ).run(cleanTitle, slug, (artist || '').trim(), lyrics || '', (audio_url || '').trim());
  return flashRedirect(req, res, `/admin/songs/${slug}/edit`, 'success', 'Canción creada correctamente');
});

app.get('/admin/songs/:slug/edit', requireAuth, (req, res) => {
  const song = db.prepare('SELECT * FROM songs WHERE slug = ?').get(req.params.slug) as Song | undefined;
  if (!song) {
    return flashRedirect(req, res, '/admin', 'error', 'Canción no encontrada');
  }
  res.render('form', { song, admin: true, fieldErrors: {} });
});

app.post('/admin/songs/:slug', requireAuth, (req, res) => {
  const { title, artist, lyrics, audio_url } = req.body;
  const existing = db.prepare('SELECT * FROM songs WHERE slug = ?').get(req.params.slug) as Song | undefined;
  if (!existing) {
    return flashRedirect(req, res, '/admin', 'error', 'Canción no encontrada');
  }
  if (!title || !title.trim()) {
    showFormError(res, 'El título es requerido');
    return res.status(400).render('form', {
      song: {
        ...existing,
        title: '',
        artist: (artist || '').trim(),
        lyrics: lyrics || '',
        audio_url: (audio_url || '').trim(),
      },
      admin: true,
      fieldErrors: { title: true },
    });
  }
  const cleanTitle = title.trim();
  let slug = existing.slug;
  if (cleanTitle !== existing.title) {
    slug = generateUniqueSlug(cleanTitle, existing.id);
  }
  db.prepare(
    'UPDATE songs SET title = ?, slug = ?, artist = ?, lyrics = ?, audio_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).run(cleanTitle, slug, (artist || '').trim(), lyrics || '', (audio_url || '').trim(), existing.id);
  return flashRedirect(req, res, `/admin/songs/${slug}/edit`, 'success', 'Canción actualizada correctamente');
});

app.post('/admin/songs/:slug/delete', requireAuth, (req, res) => {
  db.prepare('DELETE FROM songs WHERE slug = ?').run(req.params.slug);
  return flashRedirect(req, res, '/admin', 'success', 'Canción eliminada correctamente');
});

// ── Backup & multimedia Routes ──

app.get('/admin/export', requireAuth, (_req, res) => {
  const dbPath = path.join(dataRoot, 'setlists.db');
  if (!fs.existsSync(dbPath)) {
    return flashRedirect(_req, res, '/admin/ajustes', 'error', 'Base de datos no encontrada');
  }
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
  } catch {
    // Si el checkpoint falla, seguimos adelante con la copia actual.
  }
  const dateStr = new Date().toISOString().split('T')[0];
  res.download(dbPath, `setlists-backup-${dateStr}.db`);
});

app.post('/admin/import', requireAuth, backupUpload.single('database'), (req, res) => {
  if (!req.file) {
    return flashRedirect(req, res, '/admin/ajustes', 'error', 'Selecciona un archivo .db, .sqlite o .sqlite3 para continuar.', {
      title: 'No se importó la base de datos',
      sticky: true,
    });
  }
  const dbPath = path.join(dataRoot, 'setlists.db');
  const uploadedPath = req.file.path;
  const validExts = ['.db', '.sqlite', '.sqlite3'];
  const ext = path.extname(req.file.originalname).toLowerCase();
  if (!validExts.includes(ext)) {
    fs.unlinkSync(uploadedPath);
    return flashRedirect(req, res, '/admin/ajustes', 'error', 'El archivo debe tener extensión .db, .sqlite o .sqlite3.', {
      title: 'Archivo no válido',
      sticky: true,
    });
  }
  if (req.file.size > 50 * 1024 * 1024) {
    fs.unlinkSync(uploadedPath);
    return flashRedirect(req, res, '/admin/ajustes', 'error', 'El archivo supera el límite de 50 MB.', {
      title: 'Archivo demasiado grande',
      sticky: true,
    });
  }
  try {
    const testDb = require('better-sqlite3')(uploadedPath);
    testDb.pragma('journal_mode = WAL');
    const tables = testDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('songs', 'users')").all() as { name: string }[];
    if (tables.length < 2) {
      testDb.close();
      fs.unlinkSync(uploadedPath);
      return flashRedirect(req, res, '/admin/ajustes', 'error', 'El archivo no contiene las tablas songs y users.', {
        title: 'Base de datos no válida',
        sticky: true,
      });
    }
    testDb.close();
    db.close();
    fs.copyFileSync(uploadedPath, dbPath);
    try { fs.unlinkSync(dbPath + '-wal'); } catch {}
    try { fs.unlinkSync(dbPath + '-shm'); } catch {}
    fs.unlinkSync(uploadedPath);
    db = openDatabase();
    return flashRedirect(
      req,
      res,
      '/admin/ajustes',
      'success',
      'La copia se restauró correctamente. Si algún dato no aparece al momento, reinicia el servidor.',
      { title: 'Base de datos importada', sticky: true }
    );
  } catch (err) {
    try { fs.unlinkSync(uploadedPath); } catch {}
    try {
      db = openDatabase();
    } catch {}
    return flashRedirect(
      req,
      res,
      '/admin/ajustes',
      'error',
      ((err as Error).message || 'Error desconocido'),
      { title: 'Error al importar la base de datos', sticky: true }
    );
  }
});

app.get('/admin/ajustes/multimedia/export', requireAuth, (req, res) => {
  if (countMultimediaFiles() === 0) {
    return flashRedirect(req, res, '/admin/ajustes', 'error', 'No hay fotos ni archivos para exportar todavía.', {
      title: 'Multimedia vacía',
      sticky: true,
    });
  }

  try {
    const zip = new AdmZip();
    zip.addLocalFolder(uploadsRoot, 'uploads');
    const dateStr = new Date().toISOString().split('T')[0];
    const buffer = zip.toBuffer();
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="multimedia-backup-${dateStr}.zip"`);
    res.setHeader('Content-Length', String(buffer.length));
    return res.send(buffer);
  } catch (err) {
    return flashRedirect(
      req,
      res,
      '/admin/ajustes',
      'error',
      ((err as Error).message || 'Error desconocido'),
      { title: 'Error al exportar multimedia', sticky: true }
    );
  }
});

app.post('/admin/ajustes/multimedia/import', requireAuth, backupUpload.single('multimedia'), (req, res) => {
  if (!req.file) {
    return flashRedirect(req, res, '/admin/ajustes', 'error', 'Selecciona un archivo ZIP para continuar.', {
      title: 'No se importó la multimedia',
      sticky: true,
    });
  }

  const uploadedPath = req.file.path;
  const ext = path.extname(req.file.originalname).toLowerCase();
  if (ext !== '.zip') {
    try { fs.unlinkSync(uploadedPath); } catch {}
    return flashRedirect(req, res, '/admin/ajustes', 'error', 'El archivo debe ser un ZIP (.zip).', {
      title: 'Archivo no válido',
      sticky: true,
    });
  }

  try {
    const imported = importMultimediaZip(uploadedPath);
    try { fs.unlinkSync(uploadedPath); } catch {}
    if (imported === 0) {
      return flashRedirect(req, res, '/admin/ajustes', 'error', 'El ZIP no contenía imágenes JPG, PNG, WebP o GIF válidas.', {
        title: 'Sin archivos importados',
        sticky: true,
      });
    }
    return flashRedirect(
      req,
      res,
      '/admin/ajustes',
      'success',
      `Se restauraron ${imported} archivo${imported === 1 ? '' : 's'} en la carpeta de multimedia.`,
      { title: 'Multimedia importada', sticky: true }
    );
  } catch (err) {
    try { fs.unlinkSync(uploadedPath); } catch {}
    return flashRedirect(
      req,
      res,
      '/admin/ajustes',
      'error',
      ((err as Error).message || 'Error desconocido'),
      { title: 'Error al importar multimedia', sticky: true }
    );
  }
});

app.listen(PORT, '0.0.0.0', () => {
  const urlStr = BASE_URL ? `http://localhost:${PORT}${BASE_URL}` : `http://localhost:${PORT}`;
  console.log(`Setlists Manager running at ${urlStr}`);
  if (isDev) {
    console.log('Dev mode: hot reload on src/ changes; views/public reload without cache');
  }

  const songsWithoutSlug = db.prepare('SELECT * FROM songs WHERE slug IS NULL OR slug = \'\'').all() as Song[];
  for (const song of songsWithoutSlug) {
    const slug = generateUniqueSlug(song.title);
    db.prepare('UPDATE songs SET slug = ? WHERE id = ?').run(slug, song.id);
  }
  if (songsWithoutSlug.length > 0) {
    console.log(`✅ Slugs generados para ${songsWithoutSlug.length} canción(es) existente(s).`);
  }

  const activitiesWithoutSlug = db.prepare('SELECT * FROM activities WHERE slug IS NULL OR slug = \'\'').all() as any[];
  for (const activity of activitiesWithoutSlug) {
    const slug = generateUniqueActivitySlug(activity.name);
    db.prepare('UPDATE activities SET slug = ? WHERE id = ?').run(slug, activity.id);
  }
  if (activitiesWithoutSlug.length > 0) {
    console.log(`✅ Slugs generados para ${activitiesWithoutSlug.length} actividad(es) existente(s).`);
  }

  const userCount = (db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number }).count;
  if (userCount === 0) {
    console.log(`⚠️  No hay usuarios configurados. Visita ${urlStr}/setup para crear el administrador.`);
  }
});