# Accounting WEB — production static SPA image.
# Build context MUST be the repository root (npm workspaces + packages/domain).
# Dokploy: Build Type = Dockerfile, Dockerfile path = apps/web/Dockerfile,
# Docker Context Path = . (or empty), Root Directory = empty.
FROM node:24-alpine AS build
WORKDIR /app

COPY package*.json ./
COPY apps/api/package*.json apps/api/
COPY apps/web/package*.json apps/web/
COPY packages/domain/package*.json packages/domain/
COPY scripts/ scripts/

RUN npm ci

COPY . .

# Vite inlines these at build time (public client values, not secrets).
ARG VITE_ERP_URL=
ARG VITE_ERP_API_URL=
ARG VITE_ACCOUNTING_API_URL=
ENV VITE_ERP_URL=$VITE_ERP_URL \
    VITE_ERP_API_URL=$VITE_ERP_API_URL \
    VITE_ACCOUNTING_API_URL=$VITE_ACCOUNTING_API_URL

RUN npm run build -w @exceledge/accounting-domain \
 && npm run build -w @exceledge/accounting-web

FROM caddy:2-alpine AS runtime
COPY apps/web/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/web/dist /srv
EXPOSE 80
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
