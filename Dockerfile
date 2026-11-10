# syntax=docker/dockerfile:1

# Build stage: produce the static UI. Nothing from this stage ships except dist/.
FROM node:24-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY tsconfig.json vite.config.ts index.html ./
COPY public ./public
COPY shared ./shared
COPY src ./src
COPY server ./server
RUN npm run build

# Production dependencies: the runtime needs sharp for cover thumbnails.
FROM node:24-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Runtime stage: TypeScript runs through Node's built-in type stripping.
FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY shared ./shared
COPY server ./server
COPY --from=build /app/dist ./dist

RUN mkdir -p /data && chown -R node:node /data
ENV C10_DATA_DIR=/data
USER node

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 8787) + '/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]

CMD ["node", "server/index.ts"]
