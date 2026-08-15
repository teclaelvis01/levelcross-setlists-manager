# Setlists Manager 🎵

Aplicación web para gestionar setlists de canciones con visualización de letras en formato ChartPro. Construida con Node.js, Express, TypeScript y SQLite.

## ✨ Características

- **Gestión de canciones** — CRUD completo: crear, editar, eliminar canciones
- **Visualización de letras** — Renderizado de letras con acordes en formato ChartPro
- **URLs amigables** — Rutas basadas en slug del título (`/songs/mi-cancion`)
- **Autenticación** — Login admin con Google OAuth, sesión de 2 horas y bootstrap por email
- **Búsqueda** — Filtro por título o artista
- **Backup de base de datos** — Exportar e importar la base de datos SQLite desde el panel admin
- **Docker** — Imagen optimizada lista para producción (ARM64 y AMD64)
- **Subpath** — Soporte para desplegar bajo un subdirectorio con `BASE_URL`

## 🚀 Inicio rápido

### Requisitos

- Node.js 20+
- npm
- Credenciales OAuth de Google (Client ID y Client Secret)

### Instalación

```bash
# Clonar el repositorio
git clone <url-del-repo>
cd levelcross-setlists-manager

# Instalar dependencias
npm install

# Compilar TypeScript
npm run build

# Iniciar servidor (con variables OAuth)
APP_URL=http://localhost:3000 \
GOOGLE_CLIENT_ID=... \
GOOGLE_CLIENT_SECRET=... \
npm start
```

El servidor arranca en `http://localhost:3000`.

### Primera ejecución

El sitio público funciona sin administrador. Para configurar el admin:

1. Visita `/admin`
2. Completa `/setup` con el **correo** del administrador (el mismo que usarás en Google)
3. En `/login`, pulsa **Continuar con Google**
4. Solo ese correo verificado podrá acceder a `/admin`

### Configurar Google OAuth

1. En [Google Cloud Console](https://console.cloud.google.com/) crea un proyecto (o usa uno existente)
2. Configura la pantalla de consentimiento OAuth (External / Testing) e incluye el email admin de prueba
3. Crea credenciales **OAuth client ID** de tipo **Aplicación web**
4. Añade Authorized redirect URIs:
   - Local: `http://localhost:3000/auth/google/callback`
   - Producción: `https://tu-dominio.com/auth/google/callback`
   - Con subpath: `https://tu-dominio.com/setlist-2026/auth/google/callback`
5. Copia `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` a las variables de entorno

## 🐳 Docker

### docker-compose (recomendado para producción)

Usa `docker-compose.prod.yml` para levantar la aplicación con persistencia de datos:

```bash
# Sin subpath (raíz)
APP_URL=https://tu-dominio.com \
GOOGLE_CLIENT_ID=... \
GOOGLE_CLIENT_SECRET=... \
SESSION_SECRET=tu-secreto \
docker compose -f docker-compose.prod.yml up -d

# Con subpath (ej. /setlist-2026)
APP_URL=https://tu-dominio.com \
BASE_URL=/setlist-2026 \
GOOGLE_CLIENT_ID=... \
GOOGLE_CLIENT_SECRET=... \
SESSION_SECRET=tu-secreto \
docker compose -f docker-compose.prod.yml up -d
```

La base de datos se persiste en un volumen Docker (`data`) automáticamente.

### docker CLI

```bash
# Construir la imagen
docker build -t setlists-manager .

# Ejecutar el contenedor
docker run -d -p 3000:3000 \
  -e APP_URL=https://tu-dominio.com \
  -e GOOGLE_CLIENT_ID=... \
  -e GOOGLE_CLIENT_SECRET=... \
  -e SESSION_SECRET=tu-secreto \
  -v setlists-data:/app/data setlists-manager
```

### Despliegue bajo subpath (Coolify, nginx, etc.)

Si la aplicación se despliega bajo un subdirectorio (por ejemplo `https://dominio.com/mi-application/`), usa la variable de entorno `BASE_URL`:

#### En Coolify

1. Ve al dashboard de tu servicio en Coolify
2. En **Environment Variables**, agrega al menos:
   - `APP_URL=https://dominio.com` (origen público **sin** subpath)
   - `BASE_URL=/setlist-2026` (si usas subpath)
   - `GOOGLE_CLIENT_ID=...`
   - `GOOGLE_CLIENT_SECRET=...`
   - `SESSION_SECRET=...` (secreto fuerte)
3. En Google Cloud, registra el redirect URI con el subpath incluido
4. Haz clic en **Redeploy**

Solo eso. La aplicación detecta automáticamente el prefijo y responde en `https://dominio.com/setlist-2026/`.

#### En docker CLI

```bash
docker run -d -p 3000:3000 \
  -e APP_URL=https://dominio.com \
  -e BASE_URL=/mi-application \
  -e GOOGLE_CLIENT_ID=... \
  -e GOOGLE_CLIENT_SECRET=... \
  -v setlists-data:/app/data setlists-manager
```

Con `BASE_URL` configurada, todas las rutas, redirecciones, enlaces y formularios usan el prefijo `/mi-application`:
- `https://dominio.com/mi-application/` → lista de canciones
- `https://dominio.com/mi-application/setup` → configuración inicial
- `https://dominio.com/mi-application/login` → inicio de sesión
- `https://dominio.com/mi-application/admin` → panel de administración

Sin `BASE_URL` la aplicación responde en la raíz (`/`) como siempre.

> **Importante**: En Coolify asegúrate de que los **Ports Mappings** tengan el puerto del contenedor en `3000`.

### Nota para ARM64 (Apple Silicon, Raspberry Pi, etc.)

La imagen base `node:22-slim` (Debian Bookworm) no incluye binarios precompilados de `better-sqlite3` para `linux-arm64` compatibles con su versión de GLIBC. El Dockerfile resuelve esto automáticamente:

1. Instala `python3`, `make` y `g++` como dependencias de compilación
2. Elimina los prebuilds de `better-sqlite3`
3. Ejecuta `npx node-gyp rebuild` para compilar el binding nativo desde fuente

Esto añade ~80 segundos al tiempo de construcción, pero garantiza compatibilidad total en ARM64.

## 🗄️ Backup de base de datos

Desde el panel de administración (`/admin`):

- **Exportar** — Descarga el archivo `setlists.db` completo
- **Importar** — Sube un archivo `.db`, `.sqlite` o `.sqlite3` para restaurar datos

## 🛠️ Tecnologías

- **Backend**: Node.js, Express, TypeScript
- **Base de datos**: SQLite (better-sqlite3)
- **Frontend**: EJS templates, CSS personalizado
- **Autenticación**: express-session, Google OAuth
- **Contenedor**: Docker, Node 22 Slim (Debian Bookworm)

## 📁 Estructura del proyecto

```
├── src/
│   ├── app.ts          # Servidor Express (rutas, middleware, lógica)
│   ├── db.ts           # Conexión y esquema SQLite
│   ├── google-auth.ts  # Cliente OAuth de Google
│   └── types.ts        # Tipos TypeScript
├── views/
│   ├── partials/       # Head y foot compartidos
│   ├── index.ejs       # Lista pública de canciones
│   ├── viewer.ejs      # Visualizador de letras
│   ├── admin.ejs       # Panel de administración
│   ├── form.ejs        # Formulario crear/editar canción
│   ├── setup.ejs       # Bootstrap del email administrador
│   └── login.ejs       # Inicio de sesión con Google
├── public/
│   └── styles.css      # Estilos
├── data/               # Base de datos SQLite (no incluido en git)
├── dist/               # Código compilado (no incluido en git)
├── Dockerfile
├── .dockerignore
└── package.json
```

## 🔧 Comandos útiles

| Comando | Descripción |
|---------|-------------|
| `npm run build` | Compila TypeScript a JavaScript |
| `npm start` | Inicia el servidor en producción |
| `sqlite3 data/setlists.db "SELECT id, email FROM users;"` | Ver usuarios registrados |
| `BASE_URL=/mi-application npm start` | Iniciar con prefijo de ruta |
| `docker build --no-cache -t setlists-manager .` | Reconstruir imagen sin caché |
| `docker exec -it <container> sh` | Acceder al contenedor |

## 🌐 Variables de entorno

| Variable | Valor por defecto | Descripción |
|----------|-------------------|-------------|
| `PORT` | `3000` | Puerto del servidor |
| `APP_URL` | `http://localhost:PORT` | Origen público sin subpath (necesario para el redirect URI de Google) |
| `BASE_URL` | `''` | Prefijo de ruta para desplegar bajo subdirectorio |
| `GOOGLE_CLIENT_ID` | — | Client ID de Google OAuth |
| `GOOGLE_CLIENT_SECRET` | — | Client Secret de Google OAuth |
| `SESSION_SECRET` | Valor fijo por defecto | Secreto para firmar cookies de sesión (cambiar en producción) |
| `SESSION_COOKIE_SECURE` | según `NODE_ENV` | Forzar cookie `Secure` (`true`/`false`) |

## 📝 Formato de letras (ChartPro)

Los acordes se escriben entre corchetes sobre la letra:

```
[Am]Let it [G]be, let it [C]be
[F]Let it [C]be, let it [G]be
```

Las secciones se indican con títulos entre corchetes (sin acordes internos):

```
[Verso 1]
[Estribillo]
```
