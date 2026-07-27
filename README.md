# Setlists Manager 🎵

Aplicación web para gestionar setlists de canciones con visualización de letras en formato ChartPro. Construida con Node.js, Express, TypeScript y SQLite.

## ✨ Características

- **Gestión de canciones** — CRUD completo: crear, editar, eliminar canciones
- **Visualización de letras** — Renderizado de letras con acordes en formato ChartPro
- **URLs amigables** — Rutas basadas en slug del título (`/songs/mi-cancion`)
- **Autenticación** — Sesiones con bcryptjs, setup inicial del administrador
- **Búsqueda** — Filtro por título o artista
- **Backup de base de datos** — Exportar e importar la base de datos SQLite desde el panel admin
- **Docker** — Imagen optimizada lista para producción (ARM64 y AMD64)
- **Subpath** — Soporte para desplegar bajo un subdirectorio con `BASE_URL`

## 🚀 Inicio rápido

### Requisitos

- Node.js 20+
- npm

### Instalación

```bash
# Clonar el repositorio
git clone <url-del-repo>
cd levelcross-setlists-manager

# Instalar dependencias
npm install

# Compilar TypeScript
npm run build

# Iniciar servidor
npm start
```

El servidor arranca en `http://localhost:3000`.

### Primera ejecución

Al iniciar por primera vez sin usuarios registrados:

1. La aplicación redirige automáticamente a `/setup`
2. Completa el formulario con usuario y contraseña del administrador
3. Se inicia sesión automáticamente y accedes al panel `/admin`

## 🐳 Docker

```bash
# Construir la imagen
docker build -t setlists-manager .

# Ejecutar el contenedor
docker run -d -p 3000:3000 -v setlists-data:/app/data setlists-manager
```

La base de datos se persiste en el volumen `setlists-data`.

### Despliegue bajo subpath (Coolify, nginx, etc.)

Si la aplicación se despliega bajo un subdirectorio (por ejemplo `https://dominio.com/mi-application/`), usa la variable de entorno `BASE_URL`:

#### En Coolify

1. Ve al dashboard de tu servicio en Coolify
2. En la sección **Environment Variables**, agrega: `BASE_URL=/mi-application`
3. Haz clic en **Redeploy**

Solo eso. Coolify reconstruye la imagen con la variable y el reverse proxy enruta el tráfico automáticamente. No necesitas configurar nada adicional.

#### En docker CLI

```bash
docker run -d -p 3000:3000 -e BASE_URL=/mi-application -v setlists-data:/app/data setlists-manager
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
- **Autenticación**: express-session, bcryptjs
- **Contenedor**: Docker, Node 22 Slim (Debian Bookworm)

## 📁 Estructura del proyecto

```
├── src/
│   ├── app.ts          # Servidor Express (rutas, middleware, lógica)
│   ├── db.ts           # Conexión y esquema SQLite
│   └── types.ts        # Tipos TypeScript
├── views/
│   ├── partials/       # Head y foot compartidos
│   ├── index.ejs       # Lista pública de canciones
│   ├── viewer.ejs      # Visualizador de letras
│   ├── admin.ejs       # Panel de administración
│   ├── form.ejs        # Formulario crear/editar canción
│   ├── setup.ejs       # Configuración inicial
│   └── login.ejs       # Inicio de sesión
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
| `sqlite3 data/setlists.db "SELECT id, username FROM users;"` | Ver usuarios registrados |
| `BASE_URL=/mi-application npm start` | Iniciar con prefijo de ruta |
| `docker build --no-cache -t setlists-manager .` | Reconstruir imagen sin caché |
| `docker exec -it <container> sh` | Acceder al contenedor |

## 🌐 Variables de entorno

| Variable | Valor por defecto | Descripción |
|----------|-------------------|-------------|
| `PORT` | `3000` | Puerto del servidor |
| `BASE_URL` | `''` | Prefijo de ruta para desplegar bajo subdirectorio |
| `SESSION_SECRET` | Valor fijo por defecto | Secreto para firmar cookies de sesión (cambiar en producción) |

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