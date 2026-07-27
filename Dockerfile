FROM node:20-alpine

WORKDIR /app

# Install build dependencies for better-sqlite3
RUN apk add --no-cache python3 make g++

COPY package*.json tsconfig.json ./
RUN npm ci && npm run build

COPY views/ ./views/
COPY public/ ./public/

EXPOSE 3000

ENV NODE_ENV=production

CMD ["node", "dist/app.js"]