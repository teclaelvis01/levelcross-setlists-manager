FROM node:22-slim

WORKDIR /app

# Install build dependencies for better-sqlite3 (including node-gyp)
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY package*.json tsconfig.json ./
COPY src/ ./src/
RUN npm ci && rm -rf node_modules/better-sqlite3/prebuilds && npx node-gyp rebuild --directory=node_modules/better-sqlite3 && npm run build

COPY views/ ./views/
COPY public/ ./public/

EXPOSE 3000

ENV NODE_ENV=production

CMD ["node", "dist/app.js"]