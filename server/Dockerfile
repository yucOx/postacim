# context = repo root (npm workspaces)
FROM node:22-slim AS buildtools
# native modules (better-sqlite3, argon2) may fall back to source builds
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

FROM buildtools AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/tsconfig.json ./server/
COPY web/package.json ./web/
RUN npm ci -w server
COPY server/src ./server/src
RUN cd server && npx tsc -p tsconfig.json

FROM buildtools AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY web/package.json ./web/
RUN npm ci -w server --omit=dev && npm cache clean --force

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/server/dist ./server/dist
WORKDIR /app/server

# Container içinde root olarak çalıştırma — escape vulnerability'de host
# root olma riskini azaltır. node:22-slim image'ı 'node' user içerir (uid
# 1000). /data volume'unun bu user'a yazılabilir olması gerekir
# (deploy/data dizini 1000:1000 ile chown edilmiş olmalı).
USER node
EXPOSE 4000
CMD ["node", "dist/index.js"]
