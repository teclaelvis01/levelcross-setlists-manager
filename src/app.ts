import express from 'express';
import session from 'express-session';
import path from 'path';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import fs from 'fs';
import dbDefault, { openDatabase } from './db';
import { Song } from './types';

let db = dbDefault;

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);
const BASE_URL = process.env.BASE_URL || '';
const SALT_ROUNDS = 10;
const DEFAULT_SONGS_PER_PAGE = 12;
const PAGE_SIZE_OPTIONS = [5, 10, 50];
const MUSICAL_ROLES = [
  'Bajo',
  'Guitarra eléctrica',
  'Guitarra acústica',
  'Batería',
  'Voz principal',
  'Voces',
  'Técnico de sonido',
] as const;

// Make baseUrl available to all views
app.locals.baseUrl = BASE_URL;

// Multer config for file uploads (import DB)
const upload = multer({ dest: path.join(__dirname, '..', 'data', 'uploads') });

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
app.use(express.static(path.join(__dirname, '..', 'public')));

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
      activityRoles: activityRoles.length > 0 ? activityRoles : availableRoles,
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
    const personId = Number(personIdRaw);
    if (!Number.isInteger(personId) || personId <= 0) continue;
    result[personId] = collectSelectedRoles(rolesRaw);
  }
  return result;
}

function saveActivityPeople(activityId: number, personIds: number[], rolesByPerson: Record<number, string[]>) {
  db.prepare('DELETE FROM activity_person_roles WHERE activity_id = ?').run(activityId);
  db.prepare('DELETE FROM activity_people WHERE activity_id = ?').run(activityId);

  const insertPerson = db.prepare('INSERT INTO activity_people (activity_id, person_id) VALUES (?, ?)');
  const insertRole = db.prepare('INSERT INTO activity_person_roles (activity_id, person_id, role) VALUES (?, ?, ?)');

  for (const personId of personIds) {
    const availableRoles = getPersonRoles(personId);
    insertPerson.run(activityId, personId);

    if (availableRoles.length === 0) continue;

    const selectedRoles = (rolesByPerson[personId] || [])
      .filter((role) => availableRoles.includes(role));
    const rolesToSave = selectedRoles.length > 0 ? selectedRoles : availableRoles;

    for (const role of rolesToSave) {
      insertRole.run(activityId, personId, role);
    }
  }
}

function getActivityPeoplePreview(activityId: number) {
  return db.prepare(`
    SELECT p.id, p.name, p.photo_url
    FROM activity_people a_p
    JOIN people p ON p.id = a_p.person_id
    WHERE a_p.activity_id = ?
    ORDER BY p.name ASC
  `).all(activityId) as Array<{ id: number; name: string; photo_url: string }>;
}

function collectSelectedRoles(input: unknown): string[] {
  const rawValues = Array.isArray(input)
    ? input
    : input === undefined || input === null || input === ''
      ? []
      : [input];

  const values = rawValues
    .flatMap(value => typeof value === 'string' ? value.split(',') : [value])
    .map(value => String(value).trim())
    .filter(Boolean)
    .filter((value) => MUSICAL_ROLES.includes(value as typeof MUSICAL_ROLES[number]));

  return [...new Set(values)];
}

function renderLyrics(lyrics: string): string {
  if (!lyrics) return '';
  const lines = lyrics.split('\n');
  let html = '';
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '') {
      html += '<div class="lyrics-line lyrics-line--empty">&nbsp;</div>';
    } else if (/^\[[^\]]+\]$/.test(trimmed) && !trimmed.includes('] [')) {
      html += '<div class="lyrics-section">' + escapeHtml(trimmed) + '</div>';
    } else {
      const parts: { type: 'chord' | 'text'; text: string }[] = [];
      let remaining = line;
      while (remaining.length > 0) {
        const chordMatch = remaining.match(/^\[([^\]]+)\]/);
        if (chordMatch) {
          parts.push({ type: 'chord', text: chordMatch[1] });
          remaining = remaining.slice(chordMatch[0].length);
        } else {
          const nextChord = remaining.match(/\[([^\]]+)\]/);
          if (nextChord) {
            const textBefore = remaining.slice(0, nextChord.index);
            if (textBefore) parts.push({ type: 'text', text: textBefore });
            remaining = remaining.slice(nextChord.index!);
          } else {
            parts.push({ type: 'text', text: remaining });
            remaining = '';
          }
        }
      }
      const chordSpans = parts.map(p =>
        p.type === 'chord'
          ? '<span class="chord">' + escapeHtml(p.text) + '</span>'
          : '<span class="chord"></span>'
      );
      const textSpans = parts.map(p =>
        p.type === 'text'
          ? '<span class="lyrics-text">' + escapeHtml(p.text) + '</span>'
          : '<span class="lyrics-text"></span>'
      );
      html += '<div class="lyrics-line"><div class="chord-row">' + chordSpans.join('') + '</div><div class="text-row">' + textSpans.join('') + '</div></div>';
    }
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
  const normalizedSearch = search.trim();
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

app.use((req, _res, next) => {
  if (req.session) {
    app.locals.isAuthenticated = !!req.session.userId;
    app.locals.username = req.session.username || '';
  } else {
    app.locals.isAuthenticated = false;
    app.locals.username = '';
  }
  next();
});

// ── URL helper for redirects ──

function url(path: string): string {
  return BASE_URL + path;
}

// ── Public Routes ──

// All routes are defined at / (root). The BASE_URL middleware above strips
// the prefix from the request path before these routes are matched, so the
// app works regardless of whether the reverse proxy forwards the full path
// or strips the prefix.

app.get('/', (req, res) => {
  if (!isSetupComplete()) {
    return res.redirect(url('/setup'));
  }
  const search = (req.query.search as string) || '';
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
    return res.status(404).send('Canción no encontrada');
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
  res.render('setup', { error: null });
});

app.post('/setup', (req, res) => {
  if (isSetupComplete()) {
    return res.redirect(url('/login'));
  }
  const { username, password, confirm_password } = req.body;
  if (!username || !password || !confirm_password) {
    return res.render('setup', { error: 'Todos los campos son requeridos' });
  }
  if (password !== confirm_password) {
    return res.render('setup', { error: 'Las contraseñas no coinciden' });
  }
  if (password.length < 4) {
    return res.render('setup', { error: 'La contraseña debe tener al menos 4 caracteres' });
  }
  const hash = bcrypt.hashSync(password, SALT_ROUNDS);
  try {
    db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(username, hash);
    if (req.session) {
      req.session.userId = 1;
      req.session.username = username;
      req.session.save((err) => {
        if (err) {
          return res.status(500).render('setup', { error: 'No se pudo iniciar la sesión. Intente de nuevo.' });
        }
        res.redirect(url('/admin'));
      });
      return;
    }
    res.redirect(url('/admin'));
  } catch {
    res.render('setup', { error: 'Error al crear el usuario. Intente de nuevo.' });
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
  const search = (req.query.search as string) || '';
  const dbError = (req.query.db_error as string) || null;
  const dbSuccess = (req.query.db_success as string) || null;
  const requestedPage = parseInt(req.query.page as string, 10) || 1;
  const requestedPageSize = parseInt(req.query.pageSize as string, 10) || DEFAULT_SONGS_PER_PAGE;
  const { songs, currentPage, totalPages, totalCount, pageSize, hasPrev, hasNext } = getPaginatedSongs(search, requestedPage, requestedPageSize);
  res.render('admin', { songs, search, dbError, dbSuccess, currentPage, totalPages, totalCount, pageSize, hasPrev, hasNext });
});

app.get('/admin/actividades', requireAuth, (_req, res) => {
  const activities = db.prepare('SELECT * FROM activities ORDER BY activity_date DESC, activity_time DESC, name ASC').all() as any[];
  res.render('admin-activities', { activities });
});

app.get('/admin/personas', requireAuth, (_req, res) => {
  const people = listActivePeopleWithRoles();
  res.render('admin-people', { people });
});

app.get('/admin/personas/nueva', requireAuth, (_req, res) => {
  res.render('admin-person-form', { person: null, roles: MUSICAL_ROLES });
});

app.post('/admin/personas', requireAuth, (req, res) => {
  const name = (req.body.name || '').trim();
  const photoUrl = (req.body.photo_url || '').trim();
  const roles = collectSelectedRoles(req.body.roles);
  if (!name || roles.length === 0) {
    return res.status(400).send('El nombre y al menos un rol son requeridos');
  }

  const insert = db.prepare('INSERT INTO people (name, photo_url) VALUES (?, ?)').run(name, photoUrl);
  const personId = Number(insert.lastInsertRowid);
  for (const role of roles) {
    db.prepare('INSERT INTO person_roles (person_id, role) VALUES (?, ?)').run(personId, role);
  }
  res.redirect(url('/admin/personas'));
});

app.get('/admin/personas/:id/editar', requireAuth, (req, res) => {
  const person = db.prepare('SELECT * FROM people WHERE id = ? AND deleted_at IS NULL').get(req.params.id) as any | undefined;
  if (!person) {
    return res.status(404).send('Persona no encontrada');
  }
  res.render('admin-person-form', {
    person: { ...person, roles: getPersonRoles(person.id) },
    roles: MUSICAL_ROLES,
  });
});

app.post('/admin/personas/:id', requireAuth, (req, res) => {
  const person = db.prepare('SELECT * FROM people WHERE id = ? AND deleted_at IS NULL').get(req.params.id) as any | undefined;
  if (!person) {
    return res.status(404).send('Persona no encontrada');
  }
  const name = (req.body.name || '').trim();
  const photoUrl = (req.body.photo_url || '').trim();
  const roles = collectSelectedRoles(req.body.roles);
  if (!name || roles.length === 0) {
    return res.status(400).send('El nombre y al menos un rol son requeridos');
  }

  db.prepare('UPDATE people SET name = ?, photo_url = ? WHERE id = ?').run(name, photoUrl, person.id);
  db.prepare('DELETE FROM person_roles WHERE person_id = ?').run(person.id);
  for (const role of roles) {
    db.prepare('INSERT INTO person_roles (person_id, role) VALUES (?, ?)').run(person.id, role);
  }
  res.redirect(url('/admin/personas'));
});

app.post('/admin/personas/:id/delete', requireAuth, (req, res) => {
  const person = db.prepare('SELECT * FROM people WHERE id = ? AND deleted_at IS NULL').get(req.params.id) as any | undefined;
  if (!person) {
    return res.status(404).send('Persona no encontrada');
  }
  db.prepare('UPDATE people SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?').run(person.id);
  res.redirect(url('/admin/personas'));
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
    roles: MUSICAL_ROLES,
    error: null,
  });
});

app.get('/admin/actividades/:id/editar', requireAuth, (req, res) => {
  const { activity, songs: assignedSongs, people: assignedPeople } = getActivityRelations(Number(req.params.id));
  if (!activity) {
    return res.status(404).send('Actividad no encontrada');
  }
  const songs = db.prepare('SELECT * FROM songs ORDER BY title ASC').all() as Song[];
  const people = listAssignablePeopleForActivity(assignedPeople);
  res.render('activity-form', { activity, songs, people, assignedSongs, assignedPeople, roles: MUSICAL_ROLES, error: null });
});

app.post('/admin/actividades', requireAuth, (req, res) => {
  const name = (req.body.name || '').trim();
  const activityDate = (req.body.activity_date || '').trim();
  const activityTime = (req.body.activity_time || '').trim();
  const detail = (req.body.detail || '').trim();
  if (!name || !activityDate) {
    return res.status(400).send('El nombre y la fecha son requeridos');
  }

  const slug = generateUniqueActivitySlug(name);
  const insert = db.prepare('INSERT INTO activities (name, slug, activity_date, activity_time, detail) VALUES (?, ?, ?, ?, ?)')
    .run(name, slug, activityDate, activityTime, detail);
  const activityId = Number(insert.lastInsertRowid);

  const selectedPeople = collectSelectedPeopleIds(req.body.person_ids);
  const rolesByPerson = collectActivityRolesByPerson(req.body.person_roles);
  saveActivityPeople(activityId, selectedPeople, rolesByPerson);

  const selectedSongs = Array.isArray(req.body.song_ids) ? req.body.song_ids : (req.body.song_ids ? [req.body.song_ids] : []);
  const orderLookup = req.body.song_order && typeof req.body.song_order === 'object' ? req.body.song_order : {};
  const pairs: Array<{ songId: number; order: number }> = selectedSongs.map((songId: string | number, index: number) => {
    const numericId = Number(songId);
    const order = Number(orderLookup[String(songId)] ?? index + 1);
    return { songId: numericId, order: Number.isFinite(order) && order > 0 ? order : index + 1 };
  }).filter((item: { songId: number; order: number }) => !Number.isNaN(item.songId));

  for (const item of pairs.sort((a: { songId: number; order: number }, b: { songId: number; order: number }) => a.order - b.order)) {
    db.prepare('INSERT INTO activity_songs (activity_id, song_id, position) VALUES (?, ?, ?)').run(activityId, item.songId, item.order);
  }

  res.redirect(url('/admin/actividades'));
});

app.post('/admin/actividades/:id', requireAuth, (req, res) => {
  const existing = db.prepare('SELECT * FROM activities WHERE id = ?').get(req.params.id) as any | undefined;
  if (!existing) {
    return res.status(404).send('Actividad no encontrada');
  }

  const name = (req.body.name || '').trim();
  const activityDate = (req.body.activity_date || '').trim();
  const activityTime = (req.body.activity_time || '').trim();
  const detail = (req.body.detail || '').trim();
  if (!name || !activityDate) {
    return res.status(400).send('El nombre y la fecha son requeridos');
  }

  let slug = existing.slug;
  if (name !== existing.name) {
    slug = generateUniqueActivitySlug(name, existing.id);
  }

  db.prepare('UPDATE activities SET name = ?, slug = ?, activity_date = ?, activity_time = ?, detail = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(name, slug, activityDate, activityTime, detail, existing.id);

  db.prepare('DELETE FROM activity_songs WHERE activity_id = ?').run(existing.id);

  const selectedPeople = collectSelectedPeopleIds(req.body.person_ids);
  const rolesByPerson = collectActivityRolesByPerson(req.body.person_roles);
  saveActivityPeople(existing.id, selectedPeople, rolesByPerson);

  const selectedSongs = Array.isArray(req.body.song_ids) ? req.body.song_ids : (req.body.song_ids ? [req.body.song_ids] : []);
  const orderLookup = req.body.song_order && typeof req.body.song_order === 'object' ? req.body.song_order : {};
  const pairs: Array<{ songId: number; order: number }> = selectedSongs.map((songId: string | number, index: number) => {
    const numericId = Number(songId);
    const order = Number(orderLookup[String(songId)] ?? index + 1);
    return { songId: numericId, order: Number.isFinite(order) && order > 0 ? order : index + 1 };
  }).filter((item: { songId: number; order: number }) => !Number.isNaN(item.songId));
  for (const item of pairs.sort((a: { songId: number; order: number }, b: { songId: number; order: number }) => a.order - b.order)) {
    db.prepare('INSERT INTO activity_songs (activity_id, song_id, position) VALUES (?, ?, ?)').run(existing.id, item.songId, item.order);
  }

  res.redirect(url('/admin/actividades'));
});

app.post('/admin/actividades/:id/delete', requireAuth, (req, res) => {
  db.prepare('DELETE FROM activity_person_roles WHERE activity_id = ?').run(req.params.id);
  db.prepare('DELETE FROM activity_people WHERE activity_id = ?').run(req.params.id);
  db.prepare('DELETE FROM activity_songs WHERE activity_id = ?').run(req.params.id);
  db.prepare('DELETE FROM activities WHERE id = ?').run(req.params.id);
  res.redirect(url('/admin/actividades'));
});

app.get('/actividades', (_req, res) => {
  const activities = (db.prepare('SELECT * FROM activities ORDER BY activity_date DESC, activity_time DESC, name ASC').all() as any[])
    .map((activity) => ({
      ...activity,
      people: getActivityPeoplePreview(activity.id),
    }));
  res.render('activities', { activities });
});

app.get('/actividades/:slug', (req, res) => {
  const activity = db.prepare('SELECT * FROM activities WHERE slug = ?').get(req.params.slug) as any | undefined;
  if (!activity) {
    return res.status(404).send('Actividad no encontrada');
  }
  const { songs, people } = getActivityRelations(activity.id);
  res.render('activity-detail', { activity, songs, people });
});

app.get('/admin/songs/new', requireAuth, (req, res) => {
  res.render('form', { song: null, admin: true });
});

app.post('/admin/songs', requireAuth, (req, res) => {
  const { title, artist, lyrics, audio_url } = req.body;
  if (!title || !title.trim()) {
    return res.status(400).send('El título es requerido');
  }
  const cleanTitle = title.trim();
  const slug = generateUniqueSlug(cleanTitle);
  db.prepare(
    'INSERT INTO songs (title, slug, artist, lyrics, audio_url) VALUES (?, ?, ?, ?, ?)'
  ).run(cleanTitle, slug, (artist || '').trim(), lyrics || '', (audio_url || '').trim());
  res.redirect(url('/admin'));
});

app.get('/admin/songs/:slug/edit', requireAuth, (req, res) => {
  const song = db.prepare('SELECT * FROM songs WHERE slug = ?').get(req.params.slug) as Song | undefined;
  if (!song) {
    return res.status(404).send('Canción no encontrada');
  }
  res.render('form', { song, admin: true });
});

app.post('/admin/songs/:slug', requireAuth, (req, res) => {
  const { title, artist, lyrics, audio_url } = req.body;
  if (!title || !title.trim()) {
    return res.status(400).send('El título es requerido');
  }
  const existing = db.prepare('SELECT * FROM songs WHERE slug = ?').get(req.params.slug) as Song | undefined;
  if (!existing) {
    return res.status(404).send('Canción no encontrada');
  }
  const cleanTitle = title.trim();
  let slug = existing.slug;
  if (cleanTitle !== existing.title) {
    slug = generateUniqueSlug(cleanTitle, existing.id);
  }
  db.prepare(
    'UPDATE songs SET title = ?, slug = ?, artist = ?, lyrics = ?, audio_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).run(cleanTitle, slug, (artist || '').trim(), lyrics || '', (audio_url || '').trim(), existing.id);
  res.redirect(url('/admin'));
});

app.post('/admin/songs/:slug/delete', requireAuth, (req, res) => {
  db.prepare('DELETE FROM songs WHERE slug = ?').run(req.params.slug);
  res.redirect(url('/admin'));
});

// ── Database Backup Routes ──

app.get('/admin/export', requireAuth, (req, res) => {
  const dbPath = path.join(__dirname, '..', 'data', 'setlists.db');
  if (!fs.existsSync(dbPath)) {
    return res.status(404).send('Base de datos no encontrada');
  }
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
  } catch {
    // Si el checkpoint falla, seguimos adelante con la copia actual.
  }
  const dateStr = new Date().toISOString().split('T')[0];
  res.download(dbPath, `setlists-backup-${dateStr}.db`);
});

app.post('/admin/import', requireAuth, upload.single('database'), (req, res) => {
  if (!req.file) {
    return res.redirect(url('/admin?db_error=No+se+seleccionó+ningún+archivo'));
  }
  const dbPath = path.join(__dirname, '..', 'data', 'setlists.db');
  const uploadedPath = req.file.path;
  const validExts = ['.db', '.sqlite', '.sqlite3'];
  const ext = path.extname(req.file.originalname).toLowerCase();
  if (!validExts.includes(ext)) {
    fs.unlinkSync(uploadedPath);
    return res.redirect(url('/admin?db_error=El+archivo+debe+tener+extensión+.db+,+.sqlite+o+.sqlite3'));
  }
  if (req.file.size > 50 * 1024 * 1024) {
    fs.unlinkSync(uploadedPath);
    return res.redirect(url('/admin?db_error=El+archivo+es+demasiado+grande+(máximo+50MB)'));
  }
  try {
    const testDb = require('better-sqlite3')(uploadedPath);
    testDb.pragma('journal_mode = WAL');
    const tables = testDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('songs', 'users')").all() as { name: string }[];
    if (tables.length < 2) {
      testDb.close();
      fs.unlinkSync(uploadedPath);
      return res.redirect(url('/admin?db_error=El+archivo+no+es+una+base+de+datos+válida+(debe+contener+las+tablas+songs+y+users)'));
    }
    testDb.close();
    db.close();
    fs.copyFileSync(uploadedPath, dbPath);
    try { fs.unlinkSync(dbPath + '-wal'); } catch {}
    try { fs.unlinkSync(dbPath + '-shm'); } catch {}
    fs.unlinkSync(uploadedPath);
    db = openDatabase();
    res.redirect(url('/admin?db_success=Base+de+datos+importada+correctamente.+Reinicia+el+servidor+para+que+los+cambios+surtan+efecto+completo.'));
  } catch (err) {
    try { fs.unlinkSync(uploadedPath); } catch {}
    try {
      db = openDatabase();
    } catch {}
    res.redirect(url('/admin?db_error=Error+al+importar:+'+encodeURIComponent((err as Error).message)));
  }
});

app.listen(PORT, '0.0.0.0', () => {
  const urlStr = BASE_URL ? `http://localhost:${PORT}${BASE_URL}` : `http://localhost:${PORT}`;
  console.log(`Setlists Manager running at ${urlStr}`);

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