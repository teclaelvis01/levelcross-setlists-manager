import express from 'express';
import session from 'express-session';
import path from 'path';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import fs from 'fs';
import db from './db';
import { Song } from './types';

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || '';
const SALT_ROUNDS = 10;

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
app.set('trust proxy', 1);

app.use(session({
  secret: process.env.SESSION_SECRET || 'setlists-manager-secret-change-in-production',
  resave: true,
  saveUninitialized: true,
  cookie: {
    httpOnly: true,
    secure: true, // Coolify sirve sobre HTTPS
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
  if (!req.session || !req.session.userId) {
    return res.redirect(`${BASE_URL}/login`);
  }
  next();
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
  let songs: Song[];
  if (search) {
    songs = db.prepare(
      'SELECT * FROM songs WHERE title LIKE ? OR artist LIKE ? ORDER BY title ASC'
    ).all(`%${search}%`, `%${search}%`) as Song[];
  } else {
    songs = db.prepare('SELECT * FROM songs ORDER BY title ASC').all() as Song[];
  }
  res.render('index', { songs, search });
});

app.get('/songs/:slug', (req, res) => {
  if (!isSetupComplete()) {
    return res.redirect(url('/setup'));
  }
  const song = db.prepare('SELECT * FROM songs WHERE slug = ?').get(req.params.slug) as Song | undefined;
  if (!song) {
    return res.status(404).send('Canción no encontrada');
  }
  res.render('viewer', { song });
});

// ── Auth Routes ──

function isSetupComplete(): boolean {
  const user = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
  return user.count > 0;
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
    return res.render('login', { error: 'Usuario y contraseña requeridos' });
  }
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as { id: number; username: string; password_hash: string } | undefined;
  if (!user) {
    return res.render('login', { error: 'Credenciales inválidas' });
  }
  if (!bcrypt.compareSync(password, user.password_hash)) {
    return res.render('login', { error: 'Credenciales inválidas' });
  }
  if (req.session) {
    req.session.userId = user.id;
    req.session.username = user.username;
  }
  res.redirect(url('/admin'));
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect(url('/'));
  });
});

// ── Admin (Private) Routes ──

app.get('/admin', requireAuth, (req, res) => {
  const search = (req.query.search as string) || '';
  const dbError = (req.query.db_error as string) || null;
  const dbSuccess = (req.query.db_success as string) || null;
  let songs: Song[];
  if (search) {
    songs = db.prepare(
      'SELECT * FROM songs WHERE title LIKE ? OR artist LIKE ? ORDER BY title ASC'
    ).all(`%${search}%`, `%${search}%`) as Song[];
  } else {
    songs = db.prepare('SELECT * FROM songs ORDER BY title ASC').all() as Song[];
  }
  res.render('admin', { songs, search, dbError, dbSuccess });
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
    fs.unlinkSync(uploadedPath);
    delete require.cache[require.resolve('./db')];
    require('./db');
    res.redirect(url('/admin?db_success=Base+de+datos+importada+correctamente.+Reinicia+el+servidor+para+que+los+cambios+surtan+efecto+completo.'));
  } catch (err) {
    try { fs.unlinkSync(uploadedPath); } catch {}
    try {
      delete require.cache[require.resolve('./db')];
      require('./db');
    } catch {}
    res.redirect(url('/admin?db_error=Error+al+importar:+'+encodeURIComponent((err as Error).message)));
  }
});

app.listen(PORT, () => {
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

  const userCount = (db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number }).count;
  if (userCount === 0) {
    console.log(`⚠️  No hay usuarios configurados. Visita ${urlStr}/setup para crear el administrador.`);
  }
});