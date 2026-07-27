# Setlists Manager 🎵

Aplicación web para gestionar setlists de canciones con visualización de letras en formato ChartPro. Construida con Node.js, Express, TypeScript y SQLite.

## ✨ Características

- **Gestión de canciones** — CRUD completo: crear, editar, eliminar canciones
- **Visualización de letras** — Renderizado de letras con acordes en formato ChartPro
- **URLs amigables** — Rutas basadas en slug del título (`/songs/mi-cancion`)
- **Autenticación** — Sesiones con bcryptjs, setup inicial del administrador
- **Búsqueda** — Filtro por título o artista
- **Backup de base de datos** — Exportar e importar la base de datos SQLite desde el panel admin
- **Docker** — Imagen optimizada lista para producción

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

## 🗄️ Backup de base de datos

Desde el panel de administración (`/admin`):

- **Exportar** — Descarga el archivo `setlists.db` completo
- **Importar** — Sube un archivo `.db`, `.sqlite` o `.sqlite3` para restaurar datos

## 🛠️ Tecnologías

- **Backend**: Node.js, Express, TypeScript
- **Base de datos**: SQLite (better-sqlite3)
- **Frontend**: EJS templates, CSS personalizado
- **Autenticación**: express-session, bcryptjs
- **Contenedor**: Docker, Node 20 Alpine

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