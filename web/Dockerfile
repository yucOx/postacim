# context = repo root (npm workspaces)
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY web/package.json web/tsconfig.json web/vite.config.ts web/index.html ./web/
RUN npm ci -w web
COPY web/src ./web/src
WORKDIR /app/web
RUN npm run build

FROM nginx:alpine
COPY web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/web/dist /usr/share/nginx/html
EXPOSE 80
